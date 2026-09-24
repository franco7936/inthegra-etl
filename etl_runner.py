"""
Runner seguro para etl.py.

Mantiene el ETL principal como fuente de verdad, pero aplica correcciones defensivas
antes de ejecutar main():
- reintenta llamadas transitorias de Jira si la conexion se corta;
- reduce el tamano de pagina de Jira para evitar respuestas demasiado pesadas;
- corta la paginacion de usuarios de ActivityTimeline si el endpoint repite pagina;
- corta la paginacion de workload de ActivityTimeline si crece sin control;
- guarda claves fuente de ActivityTimeline para rematchear at_workload;
- recalcula person_id y project_id de at_workload usando map_personas y map_equipo_proyecto;
- evita reutilizar la misma persona AT al matchear usuarios Jira por nombre;
- baja el ruido de logs HTTP;
- crea vistas SQL complementarias versionadas cuando corresponde.
"""

import logging
import os
import time

import etl

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)


_original_crear_tablas = etl.crear_tablas
_original_jira_get = etl.JiraClient.get


def _norm(value):
    return str(value or "").strip().lower()


def _has_column(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]).lower() == column.lower() for row in rows)


def ensure_at_workload_source_columns(conn):
    extra_columns = {
        "username_at": "TEXT",
        "team_id_at": "TEXT",
        "project_key_at": "TEXT",
    }
    for column, column_type in extra_columns.items():
        if not _has_column(conn, "at_workload", column):
            conn.execute(f"ALTER TABLE at_workload ADD COLUMN {column} {column_type}")
    conn.commit()


def crear_tablas_seguro(conn):
    _original_crear_tablas(conn)
    ensure_at_workload_source_columns(conn)


def jira_get_seguro(self, path, params=None, api="platform"):
    max_retries = int(os.getenv("JIRA_MAX_RETRIES", "5"))
    base_sleep = float(os.getenv("JIRA_RETRY_BASE_SECONDS", "5"))

    for attempt in range(1, max_retries + 1):
        try:
            return _original_jira_get(self, path, params=params, api=api)
        except etl.requests.exceptions.HTTPError as exc:
            status_code = getattr(exc.response, "status_code", None)
            if status_code not in {429, 500, 502, 503, 504} or attempt == max_retries:
                raise
            retry_after = getattr(exc.response, "headers", {}).get("Retry-After") if exc.response is not None else None
            wait = float(retry_after) if retry_after and str(retry_after).isdigit() else min(90, base_sleep * attempt)
            etl.log.warning("Jira HTTP %s en %s; reintento %s/%s en %ss", status_code, path, attempt, max_retries, wait)
            time.sleep(wait)
        except etl.requests.exceptions.RequestException as exc:
            if attempt == max_retries:
                raise
            wait = min(90, base_sleep * attempt)
            etl.log.warning("Jira conexion interrumpida en %s: %s; reintento %s/%s en %ss", path, exc, attempt, max_retries, wait)
            time.sleep(wait)


def jira_paginar_seguro(self, path, params=None, api="platform", key_valores="values", max_items=50000):
    params = dict(params or {})
    start_key = "start" if api == "jsm" else "startAt"
    limit_key = "limit" if api == "jsm" else "maxResults"
    page_size = int(os.getenv("JIRA_PAGE_SIZE", "50"))
    page_sleep = float(os.getenv("JIRA_PAGE_SLEEP_SECONDS", "0.25"))

    params[start_key] = int(params.get(start_key, 0) or 0)
    params[limit_key] = min(page_size, int(params.get(limit_key, page_size) or page_size))
    rows = []
    previous_start = None

    while True:
        if previous_start == params[start_key]:
            etl.log.warning("Jira paginacion detenida en %s por start repetido=%s", path, params[start_key])
            break
        previous_start = params[start_key]

        data = self.get(path, params=params, api=api)
        items = data.get(key_valores, data.get("values", []))
        if not items:
            break

        rows.extend(items)
        total = data.get("total")
        is_last = data.get("isLast", data.get("isLastPage", False))

        etl.log.info("Jira %s: pagina start=%s items=%s acumulado=%s", path, params[start_key], len(items), len(rows))

        if is_last or len(rows) >= max_items:
            break
        if total is not None and len(rows) >= total:
            break

        params[start_key] += len(items)
        time.sleep(page_sleep)

    if len(rows) >= max_items:
        etl.log.warning("Jira %s alcanzo limite max_items=%s", path, max_items)
    return rows


def cargar_at_usuarios_en_map_seguro(at, conn, modo):
    if not at:
        return []

    etl.log.info("Map personas desde ActivityTimeline...")
    now = etl.now_iso()
    rows = []
    offset = 0
    seen_page_users = set()
    max_pages = int(os.getenv("AT_USERS_MAX_PAGES", "50"))

    for page in range(max_pages):
        data = at.get("user", params={"startOffset": offset})
        if not isinstance(data, list) or not data:
            break

        page_users = {u.get("username") for u in data if u.get("username")}
        new_page_users = page_users - seen_page_users
        if page > 0 and not new_page_users:
            etl.log.warning(
                "ActivityTimeline user devolvio una pagina repetida en startOffset=%s; se corta paginacion para evitar timeout",
                offset,
            )
            break

        seen_page_users.update(page_users)
        for u in data:
            username = u.get("username")
            if username:
                rows.append({
                    "username_at": username,
                    "full_name_at": u.get("fullName", ""),
                    "enabled_at": 1 if u.get("enabled") else 0,
                    "fecha_carga_at": now,
                })

        if len(data) < 100:
            break
        offset += len(data)
        time.sleep(0.15)
    else:
        etl.log.warning("ActivityTimeline user alcanzo AT_USERS_MAX_PAGES=%s; se corta paginacion", max_pages)

    dedup = {r["username_at"]: r for r in rows}
    rows = list(dedup.values())

    existentes = conn.execute("SELECT person_id, username_at FROM map_personas WHERE username_at IS NOT NULL").fetchall()
    por_username = {_norm(r[1]): r[0] for r in existentes if _norm(r[1])}
    altas = 0

    for r in rows:
        key = _norm(r["username_at"])
        if key in por_username:
            conn.execute(
                """
                UPDATE map_personas
                SET full_name_at=?, enabled_at=?, fecha_carga_at=?, fecha_carga=?
                WHERE person_id=?
                """,
                (r["full_name_at"], r["enabled_at"], r["fecha_carga_at"], now, por_username[key]),
            )
        else:
            conn.execute(
                """
                INSERT INTO map_personas
                (username_at,full_name_at,enabled_at,fecha_carga_at,criterio_match,activo,fecha_carga)
                VALUES (?,?,?,?,?,?,?)
                """,
                (r["username_at"], r["full_name_at"], r["enabled_at"], r["fecha_carga_at"], "pendiente", 1, now),
            )
            altas += 1
    conn.commit()
    etl.log.info("Map personas AT: %s usuarios procesados", len(rows))
    etl.log_etl(conn, modo, "map_personas_at", altas, detalle="usuarios AT nuevos; existentes actualizados")
    return rows


def cargar_jira_personas_en_map_seguro(conn, personas_jira, modo):
    etl.log.info("Map personas desde Jira...")
    now = etl.now_iso()
    at_rows = conn.execute("""
        SELECT person_id, full_name_at, user_id_rpt, user_name_rpt
        FROM map_personas
        WHERE COALESCE(activo, 1) = 1
        ORDER BY person_id
    """).fetchall()
    por_user_id = {str(r[2]).strip(): r[0] for r in at_rows if str(r[2] or "").strip()}
    usados = set(por_user_id.values())
    altas = 0

    for user_id, user_name in sorted(personas_jira, key=lambda row: (_norm(row[1]), str(row[0] or ""))):
        user_id = str(user_id or "").strip()
        user_name = str(user_name or "").strip()
        if not user_id and not user_name:
            continue

        if user_id and user_id in por_user_id:
            conn.execute(
                "UPDATE map_personas SET user_name_rpt=?, fecha_carga_rpt=?, fecha_carga=? WHERE person_id=?",
                (user_name, now, now, por_user_id[user_id]),
            )
            continue

        candidatos = [r for r in at_rows if not r[2] and r[0] not in usados]
        match = next((r for r in candidatos if _norm(r[1]) and _norm(r[1]) == _norm(user_name)), None)
        if not match:
            match = next((r for r in candidatos if etl.personas_compatibles(user_name, r[1])), None)

        if match:
            usados.add(match[0])
            conn.execute(
                """
                UPDATE map_personas
                SET user_id_rpt=?, user_name_rpt=?, fecha_carga_rpt=?,
                    criterio_match=CASE WHEN criterio_match='pendiente' THEN 'nombre_auto' ELSE criterio_match END,
                    fecha_carga=?
                WHERE person_id=?
                """,
                (user_id or None, user_name, now, now, match[0]),
            )
        else:
            conn.execute(
                """
                INSERT INTO map_personas
                (user_id_rpt,user_name_rpt,fecha_carga_rpt,criterio_match,activo,fecha_carga)
                VALUES (?,?,?,?,?,?)
                """,
                (user_id or None, user_name, now, "pendiente", 1, now),
            )
            altas += 1
    conn.commit()
    etl.log_etl(conn, modo, "map_personas_jira", altas, detalle="usuarios Jira nuevos; matching automatico por nombre")


def mapa_person_por_at_seguro(conn):
    rows = conn.execute("""
        SELECT person_id, username_at
        FROM map_personas
        WHERE username_at IS NOT NULL AND TRIM(username_at) <> '' AND COALESCE(activo, 1) = 1
        ORDER BY person_id
    """).fetchall()
    mapping = {}
    duplicates = set()
    for person_id, username in rows:
        key = _norm(username)
        if key in mapping:
            duplicates.add(key)
            continue
        mapping[key] = person_id
    if duplicates:
        etl.log.warning("map_personas tiene usernames AT duplicados: %s", ", ".join(sorted(duplicates)[:10]))
    return mapping


def mapa_project_por_team_seguro(conn):
    rows = conn.execute("""
        SELECT project_id, team_id_at
        FROM map_equipo_proyecto
        WHERE team_id_at IS NOT NULL AND TRIM(team_id_at) <> '' AND COALESCE(activo, 1) = 1
        ORDER BY project_id
    """).fetchall()
    mapping = {}
    duplicates = set()
    for project_id, team_id in rows:
        key = str(team_id).strip()
        if key in mapping:
            duplicates.add(key)
            continue
        mapping[key] = project_id
    if duplicates:
        etl.log.warning("map_equipo_proyecto tiene team_id_at duplicados: %s", ", ".join(sorted(duplicates)[:10]))
    return mapping


def mapa_project_por_key_seguro(conn):
    rows = conn.execute("""
        SELECT project_id, project_key_rpt
        FROM map_equipo_proyecto
        WHERE project_key_rpt IS NOT NULL AND TRIM(project_key_rpt) <> '' AND COALESCE(activo, 1) = 1
        ORDER BY project_id
    """).fetchall()
    mapping = {}
    duplicates = set()
    for project_id, project_key in rows:
        key = str(project_key).strip().upper()
        if key in mapping:
            duplicates.add(key)
            continue
        mapping[key] = project_id
    if duplicates:
        etl.log.warning("map_equipo_proyecto tiene project_key_rpt duplicados: %s", ", ".join(sorted(duplicates)[:10]))
    return mapping


def _firma_worklog_item(item):
    return "|".join([
        str(item.get("worklogId") or ""),
        str(item.get("issueKey") or ""),
        str(item.get("username") or ""),
        str(item.get("date") or item.get("plannedStart") or ""),
        str(item.get("timeSpent") or item.get("dailyTimeEstimate") or item.get("originalTimeEstimate") or ""),
    ])


def _project_key_from_item(item):
    issue_key = item.get("issueKey", "") or ""
    return (item.get("projectKey", "") or (issue_key.split("-")[0] if "-" in issue_key else "")).strip().upper()


def _project_id_for(project_by_key, project_by_team, project_key, team_id):
    return project_by_key.get(str(project_key or "").strip().upper()) or project_by_team.get(str(team_id or "").strip())


def extraer_at_workload_seguro(at, conn, equipos, modo, full=False):
    if not at:
        return

    ensure_at_workload_source_columns(conn)
    etl.log.info("ActivityTimeline workload consolidado...")
    now = etl.now_iso()
    start, end = etl.rango_at(full)
    person_map = mapa_person_por_at_seguro(conn)
    project_by_team = mapa_project_por_team_seguro(conn)
    project_by_key = mapa_project_por_key_seguro(conn)
    rows = []

    max_pages_per_team = int(os.getenv("AT_WORKLOG_MAX_PAGES_PER_TEAM", "25"))
    max_rows_per_team = int(os.getenv("AT_WORKLOG_MAX_ROWS_PER_TEAM", "10000"))

    for equipo in equipos:
        team_id = str(equipo.get("id") or "").strip()
        team_name = equipo.get("name")
        team_rows_before = len(rows)

        try:
            data = at.get("timeline", params={"teamId": team_id, "start": start, "end": end})
            for member in data.get("members", []) if isinstance(data, dict) else []:
                username = member.get("username")
                person_id = person_map.get(_norm(username))
                for item in member.get("issues", []) or []:
                    event_type = item.get("issueType", "") or "SIN_TIPO"
                    tiempo = item.get("dailyTimeEstimate")
                    if tiempo is None:
                        tiempo = item.get("originalTimeEstimate")
                    project_key = _project_key_from_item(item)
                    rows.append({
                        "person_id": person_id,
                        "project_id": _project_id_for(project_by_key, project_by_team, project_key, team_id),
                        "username_at": username,
                        "team_id_at": team_id,
                        "project_key_at": project_key,
                        "issue_key": item.get("issueKey", ""),
                        "event_type": event_type,
                        "summary": (item.get("summary") or "")[:500],
                        "planned_start": item.get("plannedStart", ""),
                        "planned_end": item.get("plannedEnd", ""),
                        "orig_estimate": etl.seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": etl.seg_a_hs(item.get("remainingTimeEstimate")),
                        "tiempo_empleado": etl.seg_a_hs(tiempo),
                        "fecha_carga": now,
                    })
            time.sleep(0.2)
        except Exception as exc:
            etl.log.warning("Timeline equipo %s: %s", team_name, exc)

        try:
            offset = 0
            seen_page_signatures = set()
            seen_items = set()
            for page in range(max_pages_per_team):
                try:
                    data = at.get("worklog/list", params={
                        "teamId": team_id,
                        "start": start,
                        "end": end,
                        "startOffset": offset,
                        "recordType": "worklogs,bookings,calendarEvents",
                    })
                except Exception as exc:
                    if "429" in str(exc):
                        etl.log.warning("Worklog/list equipo %s recibio 429; se corta ese equipo para evitar timeout", team_name)
                        break
                    raise

                if not isinstance(data, list) or not data:
                    break

                page_signature = tuple(_firma_worklog_item(item) for item in data[:25])
                if page > 0 and page_signature in seen_page_signatures:
                    etl.log.warning("Worklog/list equipo %s repitio pagina en offset=%s; se corta paginacion", team_name, offset)
                    break
                seen_page_signatures.add(page_signature)

                nuevos_en_pagina = 0
                for item in data:
                    item_signature = _firma_worklog_item(item)
                    if item_signature in seen_items:
                        continue
                    seen_items.add(item_signature)
                    nuevos_en_pagina += 1

                    username = item.get("username")
                    person_id = person_map.get(_norm(username))
                    issue_key = item.get("issueKey", "")
                    project_key = _project_key_from_item(item)
                    is_worklog = bool(item.get("worklogId"))
                    event_type = "WORKLOG" if is_worklog else item.get("issueType", "CALENDAR_EVENT")
                    rows.append({
                        "person_id": person_id,
                        "project_id": _project_id_for(project_by_key, project_by_team, project_key, team_id),
                        "username_at": username,
                        "team_id_at": team_id,
                        "project_key_at": project_key,
                        "issue_key": issue_key,
                        "event_type": event_type,
                        "summary": (item.get("comment") or item.get("summary") or "")[:500],
                        "planned_start": (item.get("date") or item.get("plannedStart") or "")[:10],
                        "planned_end": (item.get("date") or item.get("plannedEnd") or "")[:10],
                        "orig_estimate": etl.seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": etl.seg_a_hs(item.get("remainingTimeEstimate")),
                        "tiempo_empleado": etl.seg_a_hs(item.get("timeSpent") if is_worklog else item.get("dailyTimeEstimate") or item.get("originalTimeEstimate")),
                        "fecha_carga": now,
                    })

                if nuevos_en_pagina == 0:
                    etl.log.warning("Worklog/list equipo %s no trajo registros nuevos en offset=%s; se corta paginacion", team_name, offset)
                    break
                if len(data) < 1000:
                    break
                if len(rows) - team_rows_before >= max_rows_per_team:
                    etl.log.warning("Worklog/list equipo %s alcanzo limite %s filas; se corta paginacion", team_name, max_rows_per_team)
                    break

                offset += len(data)
                time.sleep(0.35)
            else:
                etl.log.warning("Worklog/list equipo %s alcanzo limite %s paginas; se corta paginacion", team_name, max_pages_per_team)
        except Exception as exc:
            etl.log.warning("Worklog/list equipo %s: %s", team_name, exc)

        etl.log.info("ActivityTimeline equipo %s: %s filas acumuladas", team_name, len(rows) - team_rows_before)

    conn.execute("DELETE FROM at_workload WHERE planned_start >= ? AND planned_start <= ?", (start, end))
    conn.commit()
    etl.log_etl(conn, modo, "at_workload", etl.upsert(conn, "at_workload", rows), detalle=f"{start} a {end}")
    rematchear_at_workload_ids(conn)


def rematchear_at_workload_ids(conn):
    ensure_at_workload_source_columns(conn)
    etl.log.info("Rematcheando at_workload contra map_personas y map_equipo_proyecto...")
    conn.execute("""
        UPDATE at_workload
        SET person_id = (
            SELECT mp.person_id
            FROM map_personas mp
            WHERE lower(trim(mp.username_at)) = lower(trim(at_workload.username_at))
              AND COALESCE(mp.activo, 1) = 1
            ORDER BY mp.person_id
            LIMIT 1
        )
        WHERE username_at IS NOT NULL AND trim(username_at) <> ''
    """)
    conn.execute("""
        UPDATE at_workload
        SET project_id = COALESCE(
            (
                SELECT me.project_id
                FROM map_equipo_proyecto me
                WHERE upper(trim(me.project_key_rpt)) = upper(trim(at_workload.project_key_at))
                  AND COALESCE(me.activo, 1) = 1
                ORDER BY me.project_id
                LIMIT 1
            ),
            (
                SELECT me.project_id
                FROM map_equipo_proyecto me
                WHERE trim(me.team_id_at) = trim(at_workload.team_id_at)
                  AND COALESCE(me.activo, 1) = 1
                ORDER BY me.project_id
                LIMIT 1
            )
        )
        WHERE (project_key_at IS NOT NULL AND trim(project_key_at) <> '')
           OR (team_id_at IS NOT NULL AND trim(team_id_at) <> '')
    """)
    conn.commit()


def aplicar_vistas_complementarias(conn):
    for filename in ["vw_novedades_laborales.sql", "vw_auditoria_at_workload_match.sql"]:
        sql_path = os.path.join(os.path.dirname(__file__), "sql", filename)
        if os.path.exists(sql_path):
            with open(sql_path, "r", encoding="utf-8") as file:
                conn.executescript(file.read())
            conn.commit()
            etl.log.info("Vista complementaria aplicada desde %s", filename)


_original_refrescar_vistas = etl.refrescar_vistas


def refrescar_vistas_seguro(conn):
    rematchear_at_workload_ids(conn)
    _original_refrescar_vistas(conn)
    aplicar_vistas_complementarias(conn)


etl.crear_tablas = crear_tablas_seguro
etl.JiraClient.get = jira_get_seguro
etl.JiraClient.paginar = jira_paginar_seguro
etl.cargar_at_usuarios_en_map = cargar_at_usuarios_en_map_seguro
etl.cargar_jira_personas_en_map = cargar_jira_personas_en_map_seguro
etl.extraer_at_workload = extraer_at_workload_seguro
etl.refrescar_vistas = refrescar_vistas_seguro

if __name__ == "__main__":
    etl.main()
