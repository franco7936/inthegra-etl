"""
Runner v2 para aplicar matching robusto de personas en ActivityTimeline.

Importa etl_runner para conservar las protecciones actuales y agrega:
- columnas fuente adicionales en at_workload: user_real_name_at y user_email_at;
- columna email_at en map_personas;
- match de person_id por username, email o nombre real;
- extraccion de bookings desde timeline manteniendo la persona del member.
"""

import os
import time

import etl
import etl_runner


_original_cargar_at_usuarios_en_map = etl.cargar_at_usuarios_en_map


def _norm(value):
    return str(value or "").strip().lower()


def _has_column(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]).lower() == column.lower() for row in rows)


def _first_value(*values):
    for value in values:
        if value is not None and str(value).strip() != "":
            return value
    return None


def _nested(source, *path):
    value = source
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def ensure_match_columns(conn):
    at_workload_columns = {
        "username_at": "TEXT",
        "team_id_at": "TEXT",
        "project_key_at": "TEXT",
        "user_real_name_at": "TEXT",
        "user_email_at": "TEXT",
    }
    for column, column_type in at_workload_columns.items():
        if not _has_column(conn, "at_workload", column):
            conn.execute(f"ALTER TABLE at_workload ADD COLUMN {column} {column_type}")

    if not _has_column(conn, "map_personas", "email_at"):
        conn.execute("ALTER TABLE map_personas ADD COLUMN email_at TEXT")
    conn.commit()


def cargar_at_usuarios_en_map_v2(at, conn, modo):
    if not at:
        return []

    ensure_match_columns(conn)
    etl.log.info("Map personas desde ActivityTimeline con email/nombre real...")
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
            etl.log.warning("ActivityTimeline user repitio pagina en startOffset=%s; se corta", offset)
            break

        seen_page_users.update(page_users)
        for u in data:
            username = u.get("username")
            if username:
                rows.append({
                    "username_at": username,
                    "full_name_at": _first_value(u.get("fullName"), u.get("userRealName"), u.get("displayName"), u.get("name"), ""),
                    "email_at": _first_value(u.get("email"), u.get("emailAddress"), u.get("mail")),
                    "enabled_at": 1 if u.get("enabled") else 0,
                    "fecha_carga_at": now,
                })

        if len(data) < 100:
            break
        offset += len(data)
        time.sleep(0.15)
    else:
        etl.log.warning("ActivityTimeline user alcanzo AT_USERS_MAX_PAGES=%s; se corta paginacion", max_pages)

    dedup = {_norm(r["username_at"]): r for r in rows if _norm(r["username_at"])}
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
                SET full_name_at=?, email_at=COALESCE(?, email_at), enabled_at=?, fecha_carga_at=?, fecha_carga=?
                WHERE person_id=?
                """,
                (r["full_name_at"], r["email_at"], r["enabled_at"], r["fecha_carga_at"], now, por_username[key]),
            )
        else:
            conn.execute(
                """
                INSERT INTO map_personas
                (username_at,full_name_at,email_at,enabled_at,fecha_carga_at,criterio_match,activo,fecha_carga)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (r["username_at"], r["full_name_at"], r["email_at"], r["enabled_at"], r["fecha_carga_at"], "pendiente", 1, now),
            )
            altas += 1
    conn.commit()
    etl.log.info("Map personas AT: %s usuarios procesados", len(rows))
    etl.log_etl(conn, modo, "map_personas_at", altas, detalle="usuarios AT nuevos; existentes actualizados con email")
    return rows


def mapas_personas_v2(conn):
    ensure_match_columns(conn)
    rows = conn.execute("""
        SELECT person_id, username_at, full_name_at, user_name_rpt, email_at
        FROM map_personas
        WHERE COALESCE(activo, 1) = 1
        ORDER BY person_id
    """).fetchall()
    by_username = {}
    by_name = {}
    by_email = {}

    for person_id, username_at, full_name_at, user_name_rpt, email_at in rows:
        username_key = _norm(username_at)
        if username_key and username_key not in by_username:
            by_username[username_key] = person_id

        for name in [full_name_at, user_name_rpt]:
            name_key = _norm(name)
            if name_key and name_key not in by_name:
                by_name[name_key] = person_id

        email_key = _norm(email_at)
        if email_key and email_key not in by_email:
            by_email[email_key] = person_id

    return {"username": by_username, "name": by_name, "email": by_email}


def person_id_for(maps, username=None, real_name=None, email=None):
    return (
        maps["username"].get(_norm(username))
        or maps["email"].get(_norm(email))
        or maps["name"].get(_norm(real_name))
    )


def _member_identity(member):
    return {
        "username": _first_value(member.get("username"), member.get("accountId"), member.get("userKey")),
        "real_name": _first_value(member.get("userRealName"), member.get("fullName"), member.get("displayName"), member.get("name")),
        "email": _first_value(member.get("email"), member.get("emailAddress"), member.get("mail")),
    }


def _item_identity(item):
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    assignee = item.get("assignee") if isinstance(item.get("assignee"), dict) else {}
    owner = item.get("owner") if isinstance(item.get("owner"), dict) else {}

    return {
        "username": _first_value(
            item.get("username"), item.get("userName"), item.get("accountId"), item.get("userKey"),
            item.get("resourceUsername"), item.get("ownerUsername"), item.get("assigneeUsername"),
            _nested(user, "username"), _nested(user, "accountId"), _nested(author, "accountId"), _nested(author, "username"),
            _nested(assignee, "accountId"), _nested(assignee, "username"), _nested(owner, "username"), _nested(owner, "accountId"),
        ),
        "real_name": _first_value(
            item.get("userRealName"), item.get("fullName"), item.get("displayName"), item.get("name"),
            _nested(user, "displayName"), _nested(user, "fullName"), _nested(author, "displayName"),
            _nested(assignee, "displayName"), _nested(owner, "displayName"),
        ),
        "email": _first_value(
            item.get("email"), item.get("emailAddress"), item.get("userEmail"),
            _nested(user, "email"), _nested(user, "emailAddress"), _nested(author, "emailAddress"),
            _nested(assignee, "emailAddress"), _nested(owner, "emailAddress"),
        ),
    }


def extraer_at_workload_v2(at, conn, equipos, modo, full=False):
    if not at:
        return

    ensure_match_columns(conn)
    etl.log.info("ActivityTimeline workload consolidado con match robusto de persona...")
    now = etl.now_iso()
    start, end = etl.rango_at(full)
    person_maps = mapas_personas_v2(conn)
    project_by_team = etl_runner.mapa_project_por_team_seguro(conn)
    project_by_key = etl_runner.mapa_project_por_key_seguro(conn)
    rows = []
    sin_persona = 0

    max_pages_per_team = int(os.getenv("AT_WORKLOG_MAX_PAGES_PER_TEAM", "25"))
    max_rows_per_team = int(os.getenv("AT_WORKLOG_MAX_ROWS_PER_TEAM", "10000"))

    for equipo in equipos:
        team_id = str(equipo.get("id") or "").strip()
        team_name = equipo.get("name")
        team_rows_before = len(rows)

        try:
            data = at.get("timeline", params={"teamId": team_id, "start": start, "end": end})
            for member in data.get("members", []) if isinstance(data, dict) else []:
                identity = _member_identity(member)
                person_id = person_id_for(person_maps, **identity)
                if not person_id:
                    sin_persona += len(member.get("issues", []) or [])
                    etl.log.warning(
                        "AT timeline sin match persona: username=%s real_name=%s email=%s team=%s",
                        identity["username"], identity["real_name"], identity["email"], team_name,
                    )
                for item in member.get("issues", []) or []:
                    event_type = item.get("issueType", "") or "SIN_TIPO"
                    tiempo = item.get("dailyTimeEstimate")
                    if tiempo is None:
                        tiempo = item.get("originalTimeEstimate")
                    project_key = etl_runner._project_key_from_item(item)
                    rows.append({
                        "person_id": person_id,
                        "project_id": etl_runner._project_id_for(project_by_key, project_by_team, project_key, team_id),
                        "username_at": identity["username"],
                        "team_id_at": team_id,
                        "project_key_at": project_key,
                        "user_real_name_at": identity["real_name"],
                        "user_email_at": identity["email"],
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
                        etl.log.warning("Worklog/list equipo %s recibio 429; se corta ese equipo", team_name)
                        break
                    raise

                if not isinstance(data, list) or not data:
                    break

                page_signature = tuple(etl_runner._firma_worklog_item(item) for item in data[:25])
                if page > 0 and page_signature in seen_page_signatures:
                    etl.log.warning("Worklog/list equipo %s repitio pagina en offset=%s; se corta", team_name, offset)
                    break
                seen_page_signatures.add(page_signature)

                nuevos_en_pagina = 0
                for item in data:
                    item_signature = etl_runner._firma_worklog_item(item)
                    if item_signature in seen_items:
                        continue
                    seen_items.add(item_signature)
                    nuevos_en_pagina += 1

                    identity = _item_identity(item)
                    person_id = person_id_for(person_maps, **identity)
                    if not person_id:
                        sin_persona += 1

                    issue_key = item.get("issueKey", "")
                    project_key = etl_runner._project_key_from_item(item)
                    is_worklog = bool(item.get("worklogId"))
                    event_type = "WORKLOG" if is_worklog else item.get("issueType", "CALENDAR_EVENT")
                    rows.append({
                        "person_id": person_id,
                        "project_id": etl_runner._project_id_for(project_by_key, project_by_team, project_key, team_id),
                        "username_at": identity["username"],
                        "team_id_at": team_id,
                        "project_key_at": project_key,
                        "user_real_name_at": identity["real_name"],
                        "user_email_at": identity["email"],
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
                    etl.log.warning("Worklog/list equipo %s no trajo registros nuevos en offset=%s; se corta", team_name, offset)
                    break
                if len(data) < 1000:
                    break
                if len(rows) - team_rows_before >= max_rows_per_team:
                    etl.log.warning("Worklog/list equipo %s alcanzo limite %s filas; se corta", team_name, max_rows_per_team)
                    break

                offset += len(data)
                time.sleep(0.35)
            else:
                etl.log.warning("Worklog/list equipo %s alcanzo limite %s paginas; se corta", team_name, max_pages_per_team)
        except Exception as exc:
            etl.log.warning("Worklog/list equipo %s: %s", team_name, exc)

        etl.log.info("ActivityTimeline equipo %s: %s filas acumuladas", team_name, len(rows) - team_rows_before)

    conn.execute("DELETE FROM at_workload WHERE planned_start >= ? AND planned_start <= ?", (start, end))
    conn.commit()
    etl.log_etl(conn, modo, "at_workload", etl.upsert(conn, "at_workload", rows), detalle=f"{start} a {end}; sin_persona={sin_persona}")
    rematchear_at_workload_ids_v2(conn)


def rematchear_at_workload_ids_v2(conn):
    ensure_match_columns(conn)
    etl.log.info("Rematcheando at_workload por username, email o nombre real...")
    conn.execute("""
        UPDATE at_workload
        SET person_id = COALESCE(
            (
                SELECT mp.person_id
                FROM map_personas mp
                WHERE lower(trim(mp.username_at)) = lower(trim(at_workload.username_at))
                  AND COALESCE(mp.activo, 1) = 1
                ORDER BY mp.person_id
                LIMIT 1
            ),
            (
                SELECT mp.person_id
                FROM map_personas mp
                WHERE lower(trim(mp.email_at)) = lower(trim(at_workload.user_email_at))
                  AND COALESCE(mp.activo, 1) = 1
                ORDER BY mp.person_id
                LIMIT 1
            ),
            (
                SELECT mp.person_id
                FROM map_personas mp
                WHERE lower(trim(mp.full_name_at)) = lower(trim(at_workload.user_real_name_at))
                  AND COALESCE(mp.activo, 1) = 1
                ORDER BY mp.person_id
                LIMIT 1
            ),
            (
                SELECT mp.person_id
                FROM map_personas mp
                WHERE lower(trim(mp.user_name_rpt)) = lower(trim(at_workload.user_real_name_at))
                  AND COALESCE(mp.activo, 1) = 1
                ORDER BY mp.person_id
                LIMIT 1
            )
        )
        WHERE (username_at IS NOT NULL AND trim(username_at) <> '')
           OR (user_email_at IS NOT NULL AND trim(user_email_at) <> '')
           OR (user_real_name_at IS NOT NULL AND trim(user_real_name_at) <> '')
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


_original_refrescar_vistas = etl.refrescar_vistas


def refrescar_vistas_v2(conn):
    rematchear_at_workload_ids_v2(conn)
    _original_refrescar_vistas(conn)
    etl_runner.aplicar_vistas_complementarias(conn)


etl.cargar_at_usuarios_en_map = cargar_at_usuarios_en_map_v2
etl.extraer_at_workload = extraer_at_workload_v2
etl.refrescar_vistas = refrescar_vistas_v2

if __name__ == "__main__":
    etl.main()
