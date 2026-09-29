"""
Runner seguro para etl.py.

Este archivo es el unico wrapper vigente del ETL. Mantiene `etl.py` como fuente
principal del proceso y aplica las correcciones operativas necesarias antes de
ejecutar `main()`:

- Reintentos y paginacion controlada para Jira.
- Matching robusto de personas y proyectos de ActivityTimeline.
- Carga de todos los event_type de AT con persona conocida, incluso sin proyecto.
- Deduplicacion de `at_workload`.
- Tablas de app: usuarios, roles, permisos y PGI manual.
- Vistas de reporte con PGI y vistas SQL complementarias versionadas.
"""

import hashlib
import logging
import os
import re
import time

import etl

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

_original_crear_tablas = etl.crear_tablas
_original_upsert = etl.upsert
_original_jira_get = etl.JiraClient.get
_original_validar_modelo = etl.validar_modelo

ADMIN_PASSWORD_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"  # admin123
REPORT_KEYS = [
    "horas",
    "novedades-laborales",
    "status-semanal",
    "inversion-estrategica",
    "entrega-calidad",
    "calidad-performance",
]


def _norm(value):
    return str(value or "").strip().lower()


def _clean(value):
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _date_part(value):
    value = str(value or "").strip()
    return value[:10] if len(value) >= 10 else value


def _num_part(value):
    try:
        return f"{float(value or 0):.4f}"
    except (TypeError, ValueError):
        return "0.0000"


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


def _has_table(conn, table):
    row = conn.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name=?", (table,)).fetchone()
    return bool(row)


def _has_column(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]).lower() == column.lower() for row in rows)


def _ensure_column(conn, table, column, definition):
    if _has_table(conn, table) and not _has_column(conn, table, column):
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def ensure_modelo_extendido(conn):
    for column, column_type in {
        "username_at": "TEXT",
        "team_id_at": "TEXT",
        "project_key_at": "TEXT",
        "user_real_name_at": "TEXT",
        "user_email_at": "TEXT",
        "activity_detail_at": "TEXT",
        "dedupe_key": "TEXT",
    }.items():
        _ensure_column(conn, "at_workload", column, column_type)
    _ensure_column(conn, "map_personas", "email_at", "TEXT")
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS pgi_workload (
            pgi_id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            horas REAL NOT NULL,
            incidence_type TEXT DEFAULT 'pgi',
            comentario TEXT,
            creado_por TEXT,
            activo INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS app_roles (
            role_key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS app_role_permissions (
            permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_key TEXT NOT NULL,
            report_key TEXT NOT NULL,
            can_view INTEGER DEFAULT 1,
            fecha_carga TEXT,
            UNIQUE(role_key, report_key)
        );
        CREATE TABLE IF NOT EXISTS app_users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            project_id INTEGER,
            enabled INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS app_report_permissions (
            permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            report_key TEXT NOT NULL,
            can_view INTEGER DEFAULT 1,
            fecha_carga TEXT,
            UNIQUE(username, report_key)
        );
        INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga)
        VALUES ('admin', 'Administrador', 1, 1, datetime('now'));
        INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga)
        VALUES ('viewer', 'Usuario operativo', 0, 1, datetime('now'));
        INSERT OR IGNORE INTO app_users (username, password_hash, role, enabled, fecha_carga)
        VALUES ('admin', '{ADMIN_PASSWORD_HASH}', 'admin', 1, datetime('now'));
    """)
    _ensure_column(conn, "pgi_workload", "incidence_type", "TEXT DEFAULT 'pgi'")
    _ensure_column(conn, "app_users", "project_id", "INTEGER")
    for report_key in REPORT_KEYS:
        conn.execute(
            "INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES ('admin', ?, 1, datetime('now'))",
            (report_key,),
        )
    conn.execute(
        "INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES ('viewer', 'horas', 1, datetime('now'))"
    )
    conn.commit()


def crear_tablas_seguro(conn):
    _original_crear_tablas(conn)
    ensure_modelo_extendido(conn)
    ensure_at_workload_dedupe(conn)


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
    ensure_modelo_extendido(conn)
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
    rows = list({_norm(r["username_at"]): r for r in rows if _norm(r["username_at"])}.values())
    existentes = conn.execute("SELECT person_id, username_at FROM map_personas WHERE username_at IS NOT NULL").fetchall()
    por_username = {_norm(r[1]): r[0] for r in existentes if _norm(r[1])}
    altas = 0
    for r in rows:
        key = _norm(r["username_at"])
        if key in por_username:
            conn.execute(
                "UPDATE map_personas SET full_name_at=?, email_at=COALESCE(?, email_at), enabled_at=?, fecha_carga_at=?, fecha_carga=? WHERE person_id=?",
                (r["full_name_at"], r["email_at"], r["enabled_at"], r["fecha_carga_at"], now, por_username[key]),
            )
        else:
            conn.execute(
                "INSERT INTO map_personas (username_at,full_name_at,email_at,enabled_at,fecha_carga_at,criterio_match,activo,fecha_carga) VALUES (?,?,?,?,?,?,?,?)",
                (r["username_at"], r["full_name_at"], r["email_at"], r["enabled_at"], r["fecha_carga_at"], "pendiente", 1, now),
            )
            altas += 1
    conn.commit()
    etl.log.info("Map personas AT: %s usuarios procesados", len(rows))
    etl.log_etl(conn, modo, "map_personas_at", altas, detalle="usuarios AT nuevos; existentes actualizados con email")
    return rows


def cargar_jira_personas_en_map_seguro(conn, personas_jira, modo):
    etl.log.info("Map personas desde Jira...")
    ensure_modelo_extendido(conn)
    now = etl.now_iso()
    at_rows = conn.execute("SELECT person_id, full_name_at, user_id_rpt, user_name_rpt FROM map_personas WHERE COALESCE(activo, 1) = 1 ORDER BY person_id").fetchall()
    por_user_id = {str(r[2]).strip(): r[0] for r in at_rows if str(r[2] or "").strip()}
    usados = set(por_user_id.values())
    altas = 0
    for user_id, user_name in sorted(personas_jira, key=lambda row: (_norm(row[1]), str(row[0] or ""))):
        user_id = str(user_id or "").strip()
        user_name = str(user_name or "").strip()
        if not user_id and not user_name:
            continue
        if user_id and user_id in por_user_id:
            conn.execute("UPDATE map_personas SET user_name_rpt=?, fecha_carga_rpt=?, fecha_carga=? WHERE person_id=?", (user_name, now, now, por_user_id[user_id]))
            continue
        candidatos = [r for r in at_rows if not r[2] and r[0] not in usados]
        match = next((r for r in candidatos if _norm(r[1]) and _norm(r[1]) == _norm(user_name)), None)
        if not match:
            match = next((r for r in candidatos if etl.personas_compatibles(user_name, r[1])), None)
        if match:
            usados.add(match[0])
            conn.execute(
                "UPDATE map_personas SET user_id_rpt=?, user_name_rpt=?, fecha_carga_rpt=?, criterio_match=CASE WHEN criterio_match='pendiente' THEN 'nombre_auto' ELSE criterio_match END, fecha_carga=? WHERE person_id=?",
                (user_id or None, user_name, now, now, match[0]),
            )
        else:
            conn.execute(
                "INSERT INTO map_personas (user_id_rpt,user_name_rpt,fecha_carga_rpt,criterio_match,activo,fecha_carga) VALUES (?,?,?,?,?,?)",
                (user_id or None, user_name, now, "pendiente", 1, now),
            )
            altas += 1
    conn.commit()
    etl.log_etl(conn, modo, "map_personas_jira", altas, detalle="usuarios Jira nuevos; matching automatico por nombre")


def mapas_personas(conn):
    rows = conn.execute("SELECT person_id, username_at, full_name_at, user_name_rpt, email_at FROM map_personas WHERE COALESCE(activo, 1) = 1 ORDER BY person_id").fetchall()
    maps = {"username": {}, "name": {}, "email": {}}
    for person_id, username_at, full_name_at, user_name_rpt, email_at in rows:
        if _norm(username_at) and _norm(username_at) not in maps["username"]:
            maps["username"][_norm(username_at)] = person_id
        for name in [full_name_at, user_name_rpt]:
            if _norm(name) and _norm(name) not in maps["name"]:
                maps["name"][_norm(name)] = person_id
        if _norm(email_at) and _norm(email_at) not in maps["email"]:
            maps["email"][_norm(email_at)] = person_id
    return maps


def person_id_for(maps, username=None, real_name=None, email=None):
    return maps["username"].get(_norm(username)) or maps["email"].get(_norm(email)) or maps["name"].get(_norm(real_name))


def mapa_project_por_key(conn):
    rows = conn.execute("SELECT project_id, project_key_rpt FROM map_equipo_proyecto WHERE project_key_rpt IS NOT NULL AND TRIM(project_key_rpt) <> '' AND COALESCE(activo, 1) = 1 ORDER BY project_id").fetchall()
    mapping = {}
    for project_id, project_key in rows:
        key = str(project_key or "").strip().upper()
        if key and key not in mapping:
            mapping[key] = project_id
    return mapping


def mapa_project_por_team_valido(conn):
    rows = conn.execute("SELECT project_id, team_id_at FROM map_equipo_proyecto WHERE team_id_at IS NOT NULL AND TRIM(team_id_at) <> '' AND project_key_rpt IS NOT NULL AND TRIM(project_key_rpt) <> '' AND COALESCE(activo, 1) = 1 ORDER BY project_id").fetchall()
    mapping = {}
    for project_id, team_id in rows:
        key = str(team_id or "").strip()
        if key and key not in mapping:
            mapping[key] = project_id
    return mapping


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
        "username": _first_value(item.get("username"), item.get("userName"), item.get("accountId"), item.get("userKey"), item.get("resourceUsername"), item.get("ownerUsername"), item.get("assigneeUsername"), _nested(user, "username"), _nested(user, "accountId"), _nested(author, "accountId"), _nested(author, "username"), _nested(assignee, "accountId"), _nested(assignee, "username"), _nested(owner, "username"), _nested(owner, "accountId")),
        "real_name": _first_value(item.get("userRealName"), item.get("fullName"), item.get("displayName"), item.get("name"), _nested(user, "displayName"), _nested(user, "fullName"), _nested(author, "displayName"), _nested(assignee, "displayName"), _nested(owner, "displayName")),
        "email": _first_value(item.get("email"), item.get("emailAddress"), item.get("userEmail"), _nested(user, "email"), _nested(user, "emailAddress"), _nested(author, "emailAddress"), _nested(assignee, "emailAddress"), _nested(owner, "emailAddress")),
    }


def _project_key_from_item(item, project_by_key):
    explicit = _first_value(item.get("projectKey"), _nested(item.get("project") if isinstance(item.get("project"), dict) else {}, "key"))
    if explicit and str(explicit).strip().upper() in project_by_key:
        return str(explicit).strip().upper()
    candidates = []
    issue_key = str(item.get("issueKey") or "").strip().upper()
    if issue_key:
        if "-" in issue_key:
            candidates.append(issue_key.split("-", 1)[0])
        candidates.append(issue_key)
    summary = str(item.get("summary") or item.get("comment") or "").upper()
    bracket_match = re.search(r"\[BOOKING\]\s*([A-Z0-9_]+)", summary)
    if bracket_match:
        candidates.append(bracket_match.group(1))
    for candidate in candidates:
        candidate = re.sub(r"[^A-Z0-9_].*$", "", candidate)
        if candidate in project_by_key:
            return candidate
    for key in sorted(project_by_key, key=len, reverse=True):
        if issue_key.startswith(key) or summary.startswith(key) or f" {key} " in f" {summary} ":
            return key
    return ""


def _activity_detail_from_item(item):
    event_type = str(item.get("issueType") or item.get("recordType") or "").strip().upper()
    summary = str(item.get("summary") or item.get("comment") or "").strip()
    if event_type == "BOOKING" and "|" in summary:
        detail = summary.rsplit("|", 1)[1].strip()
        return detail[:200]
    return _first_value(
        item.get("activityType"),
        item.get("activityTypeName"),
        item.get("bookingType"),
        item.get("bookingTypeName"),
        item.get("category"),
        item.get("categoryName"),
        item.get("typeName"),
    )


def _firma_worklog_item(item):
    return "|".join([str(item.get("worklogId") or ""), str(item.get("issueKey") or ""), str(item.get("username") or item.get("userName") or ""), str(item.get("date") or item.get("plannedStart") or ""), str(item.get("timeSpent") or item.get("dailyTimeEstimate") or item.get("originalTimeEstimate") or "")])


ISSUE_PREFIXES_OMITIR_SIN_PROYECTO = ("SCRR", "SML", "EC", "DEMO")


def _issue_sin_proyecto_omitido(row):
    issue_key = str(row.get("issue_key") or "").strip().upper()
    return not row.get("project_id") and issue_key.startswith(ISSUE_PREFIXES_OMITIR_SIN_PROYECTO)


def append_at_row(rows, row, counters, source, team_name, item, project_by_team):
    if _issue_sin_proyecto_omitido(row):
        counters["issue_omitido_sin_proyecto"] += 1
        counters["omitidos"] += 1
        etl.log.warning("AT %s omitido por issue sin proyecto no permitido | team=%s issue=%s type=%s summary=%s", source, team_name, row.get("issue_key", ""), item.get("issueType", item.get("recordType", "")), (item.get("summary") or item.get("comment") or "")[:120])
        return False
    if not row.get("project_id"):
        fallback = project_by_team.get(str(row.get("team_id_at") or "").strip())
        if fallback:
            row["project_id"] = fallback
            if not row.get("project_key_at"):
                row["project_key_at"] = f"TEAM:{row.get('team_id_at')}"
    if not row.get("person_id"):
        counters["sin_persona"] += 1
        counters["omitidos"] += 1
        etl.log.warning("AT %s omitido sin persona | team=%s issue=%s type=%s summary=%s", source, team_name, item.get("issueKey", ""), item.get("issueType", item.get("recordType", "")), (item.get("summary") or item.get("comment") or "")[:120])
        return False
    if not row.get("project_id"):
        counters["sin_proyecto"] += 1
        etl.log.warning("AT %s sin proyecto asociado; se conserva para revision admin | team=%s issue=%s type=%s summary=%s", source, team_name, item.get("issueKey", ""), item.get("issueType", item.get("recordType", "")), (item.get("summary") or item.get("comment") or "")[:120])
    rows.append(row)
    return True


def extraer_at_workload_seguro(at, conn, equipos, modo, full=False):
    if not at:
        return
    ensure_modelo_extendido(conn)
    etl.log.info("ActivityTimeline workload consolidado con match robusto...")
    now = etl.now_iso()
    start, end = etl.rango_at(full)
    person_maps = mapas_personas(conn)
    project_by_key = mapa_project_por_key(conn)
    project_by_team = mapa_project_por_team_valido(conn)
    rows = []
    counters = {"sin_persona": 0, "sin_proyecto": 0, "issue_omitido_sin_proyecto": 0, "omitidos": 0}
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
                for item in member.get("issues", []) or []:
                    event_type = item.get("issueType", "") or "SIN_TIPO"
                    tiempo = item.get("dailyTimeEstimate")
                    if tiempo is None:
                        tiempo = item.get("originalTimeEstimate")
                    project_key = _project_key_from_item(item, project_by_key)
                    append_at_row(rows, {
                        "person_id": person_id,
                        "project_id": project_by_key.get(project_key),
                        "username_at": identity["username"],
                        "team_id_at": team_id,
                        "project_key_at": project_key,
                        "user_real_name_at": identity["real_name"],
                        "user_email_at": identity["email"],
                        "issue_key": item.get("issueKey", ""),
                        "event_type": event_type,
                        "activity_detail_at": _activity_detail_from_item(item),
                        "summary": (item.get("summary") or "")[:500],
                        "planned_start": item.get("plannedStart", ""),
                        "planned_end": item.get("plannedEnd", ""),
                        "orig_estimate": etl.seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": etl.seg_a_hs(item.get("remainingTimeEstimate")),
                        "tiempo_empleado": etl.seg_a_hs(tiempo),
                        "fecha_carga": now,
                    }, counters, "timeline", team_name, item, project_by_team)
            time.sleep(0.2)
        except Exception as exc:
            etl.log.warning("Timeline equipo %s: %s", team_name, exc)
        try:
            offset = 0
            seen_page_signatures = set()
            seen_items = set()
            for page in range(max_pages_per_team):
                try:
                    data = at.get("worklog/list", params={"teamId": team_id, "start": start, "end": end, "startOffset": offset, "recordType": "worklogs,bookings,calendarEvents"})
                except Exception as exc:
                    if "429" in str(exc):
                        etl.log.warning("Worklog/list equipo %s recibio 429; se corta ese equipo", team_name)
                        break
                    raise
                if not isinstance(data, list) or not data:
                    break
                page_signature = tuple(_firma_worklog_item(item) for item in data[:25])
                if page > 0 and page_signature in seen_page_signatures:
                    etl.log.warning("Worklog/list equipo %s repitio pagina en offset=%s; se corta", team_name, offset)
                    break
                seen_page_signatures.add(page_signature)
                nuevos_en_pagina = 0
                for item in data:
                    item_signature = _firma_worklog_item(item)
                    if item_signature in seen_items:
                        continue
                    seen_items.add(item_signature)
                    nuevos_en_pagina += 1
                    identity = _item_identity(item)
                    person_id = person_id_for(person_maps, **identity)
                    issue_key = item.get("issueKey", "")
                    project_key = _project_key_from_item(item, project_by_key)
                    is_worklog = bool(item.get("worklogId"))
                    event_type = "WORKLOG" if is_worklog else item.get("issueType", "CALENDAR_EVENT")
                    append_at_row(rows, {
                        "person_id": person_id,
                        "project_id": project_by_key.get(project_key),
                        "username_at": identity["username"],
                        "team_id_at": team_id,
                        "project_key_at": project_key,
                        "user_real_name_at": identity["real_name"],
                        "user_email_at": identity["email"],
                        "issue_key": issue_key,
                        "event_type": event_type,
                        "activity_detail_at": _activity_detail_from_item(item),
                        "summary": (item.get("comment") or item.get("summary") or "")[:500],
                        "planned_start": (item.get("date") or item.get("plannedStart") or "")[:10],
                        "planned_end": (item.get("date") or item.get("plannedEnd") or "")[:10],
                        "orig_estimate": etl.seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": etl.seg_a_hs(item.get("remainingTimeEstimate")),
                        "tiempo_empleado": etl.seg_a_hs(item.get("timeSpent") if is_worklog else item.get("dailyTimeEstimate") or item.get("originalTimeEstimate")),
                        "fecha_carga": now,
                    }, counters, "worklog/list", team_name, item, project_by_team)
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
    detalle = f"{start} a {end}; sin_persona={counters['sin_persona']}; sin_proyecto={counters['sin_proyecto']}; issue_omitido_sin_proyecto={counters['issue_omitido_sin_proyecto']}; omitidos={counters['omitidos']}"
    etl.log_etl(conn, modo, "at_workload", etl.upsert(conn, "at_workload", rows), detalle=detalle)
    limpiar_at_workload_invalido(conn, start, end)
    rematchear_at_workload_ids(conn)


def limpiar_at_workload_invalido(conn, start=None, end=None):
    date_clause = ""
    params = []
    if start and end:
        date_clause = "AND planned_start >= ? AND planned_start <= ?"
        params = [start, end]
    issue_prefix_clause = "(project_id IS NULL AND (upper(trim(issue_key)) LIKE 'SCRR%' OR upper(trim(issue_key)) LIKE 'SML%' OR upper(trim(issue_key)) LIKE 'EC%' OR upper(trim(issue_key)) LIKE 'DEMO%'))"
    row = conn.execute(f"""
        SELECT COUNT(*) FROM at_workload
        WHERE (person_id IS NULL OR {issue_prefix_clause} OR (project_id IS NOT NULL AND project_id NOT IN (
            SELECT project_id FROM map_equipo_proyecto
            WHERE project_key_rpt IS NOT NULL AND TRIM(project_key_rpt) <> '' AND COALESCE(activo, 1) = 1
        ))) {date_clause}
    """, params).fetchone()
    count = int(row[0] or 0) if row else 0
    conn.execute(f"""
        DELETE FROM at_workload
        WHERE (person_id IS NULL OR {issue_prefix_clause} OR (project_id IS NOT NULL AND project_id NOT IN (
            SELECT project_id FROM map_equipo_proyecto
            WHERE project_key_rpt IS NOT NULL AND TRIM(project_key_rpt) <> '' AND COALESCE(activo, 1) = 1
        ))) {date_clause}
    """, params)
    conn.commit()
    if count:
        etl.log.warning("at_workload: %s filas sin persona o con proyecto invalido eliminadas", count)


def rematchear_at_workload_ids(conn):
    ensure_modelo_extendido(conn)
    etl.log.info("Rematcheando at_workload por username, email, nombre real y project_key...")
    conn.execute("""
        UPDATE at_workload
        SET person_id = COALESCE(
            (SELECT mp.person_id FROM map_personas mp WHERE lower(trim(mp.username_at)) = lower(trim(at_workload.username_at)) AND COALESCE(mp.activo, 1) = 1 ORDER BY mp.person_id LIMIT 1),
            (SELECT mp.person_id FROM map_personas mp WHERE lower(trim(mp.email_at)) = lower(trim(at_workload.user_email_at)) AND COALESCE(mp.activo, 1) = 1 ORDER BY mp.person_id LIMIT 1),
            (SELECT mp.person_id FROM map_personas mp WHERE lower(trim(mp.full_name_at)) = lower(trim(at_workload.user_real_name_at)) AND COALESCE(mp.activo, 1) = 1 ORDER BY mp.person_id LIMIT 1),
            (SELECT mp.person_id FROM map_personas mp WHERE lower(trim(mp.user_name_rpt)) = lower(trim(at_workload.user_real_name_at)) AND COALESCE(mp.activo, 1) = 1 ORDER BY mp.person_id LIMIT 1)
        )
        WHERE (username_at IS NOT NULL AND trim(username_at) <> '')
           OR (user_email_at IS NOT NULL AND trim(user_email_at) <> '')
           OR (user_real_name_at IS NOT NULL AND trim(user_real_name_at) <> '')
    """)
    conn.execute("""
        UPDATE at_workload
        SET project_id = COALESCE(
            (SELECT me.project_id FROM map_equipo_proyecto me WHERE upper(trim(me.project_key_rpt)) = upper(trim(at_workload.project_key_at)) AND me.project_key_rpt IS NOT NULL AND trim(me.project_key_rpt) <> '' AND COALESCE(me.activo, 1) = 1 ORDER BY me.project_id LIMIT 1),
            (SELECT me.project_id FROM map_equipo_proyecto me WHERE trim(me.team_id_at) = trim(at_workload.team_id_at) AND me.project_key_rpt IS NOT NULL AND trim(me.project_key_rpt) <> '' AND COALESCE(me.activo, 1) = 1 ORDER BY me.project_id LIMIT 1)
        )
        WHERE (project_key_at IS NOT NULL AND trim(project_key_at) <> '')
           OR (team_id_at IS NOT NULL AND trim(team_id_at) <> '')
    """)
    conn.commit()
    limpiar_at_workload_invalido(conn)


def at_workload_dedupe_key(row):
    raw = "|".join([
        str(row.get("person_id") or ""),
        str(row.get("project_id") or ""),
        _clean(row.get("issue_key")).upper(),
        _clean(row.get("event_type")),
        _clean(row.get("activity_detail_at")),
        _clean(row.get("summary"))[:500],
        _date_part(row.get("planned_start")),
        _date_part(row.get("planned_end")),
        _num_part(row.get("tiempo_empleado")),
    ])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def ensure_at_workload_dedupe(conn):
    if not _has_table(conn, "at_workload"):
        return
    _ensure_column(conn, "at_workload", "dedupe_key", "TEXT")
    _ensure_column(conn, "at_workload", "activity_detail_at", "TEXT")
    rows = conn.execute("SELECT workload_id, person_id, project_id, issue_key, event_type, activity_detail_at, summary, planned_start, planned_end, tiempo_empleado FROM at_workload WHERE dedupe_key IS NULL OR TRIM(dedupe_key) = ''").fetchall()
    updates = []
    for row in rows:
        row_dict = {"person_id": row[1], "project_id": row[2], "issue_key": row[3], "event_type": row[4], "activity_detail_at": row[5], "summary": row[6], "planned_start": row[7], "planned_end": row[8], "tiempo_empleado": row[9]}
        updates.append((at_workload_dedupe_key(row_dict), row[0]))
    if updates:
        conn.executemany("UPDATE at_workload SET dedupe_key=? WHERE workload_id=?", updates)
        conn.commit()
    duplicate_row = conn.execute("SELECT COUNT(*) FROM at_workload WHERE dedupe_key IS NOT NULL AND TRIM(dedupe_key) <> '' AND workload_id NOT IN (SELECT MIN(workload_id) FROM at_workload WHERE dedupe_key IS NOT NULL AND TRIM(dedupe_key) <> '' GROUP BY dedupe_key)").fetchone()
    duplicate_count = int(duplicate_row[0] or 0) if duplicate_row else 0
    conn.execute("DELETE FROM at_workload WHERE dedupe_key IS NOT NULL AND TRIM(dedupe_key) <> '' AND workload_id NOT IN (SELECT MIN(workload_id) FROM at_workload WHERE dedupe_key IS NOT NULL AND TRIM(dedupe_key) <> '' GROUP BY dedupe_key)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_at_workload_dedupe_key ON at_workload(dedupe_key)")
    conn.commit()
    if duplicate_count:
        etl.log.warning("at_workload: %s duplicados historicos eliminados por dedupe_key", duplicate_count)


def deduplicar_at_workload_rows(rows):
    dedup = {}
    duplicados = 0
    for row in rows:
        key = at_workload_dedupe_key(row)
        if key in dedup:
            duplicados += 1
            continue
        row = dict(row)
        row["dedupe_key"] = key
        dedup[key] = row
    if duplicados:
        etl.log.warning("at_workload: %s duplicados omitidos antes de insertar", duplicados)
    return list(dedup.values())


def upsert_seguro(conn, tabla, rows):
    if tabla != "at_workload":
        return _original_upsert(conn, tabla, rows)
    ensure_at_workload_dedupe(conn)
    return _original_upsert(conn, tabla, deduplicar_at_workload_rows(rows))


def refrescar_vistas_seguro(conn):
    rematchear_at_workload_ids(conn)
    etl.log.info("Refrescando vistas de reporte de horas desde SQL versionado...")
    sql_path = os.path.join(os.path.dirname(__file__), "sql", "vw_reporte_horas_pgi.sql")
    with open(sql_path, "r", encoding="utf-8") as file:
        conn.executescript(file.read())
    aplicar_vistas_complementarias(conn)


def aplicar_vistas_complementarias(conn):
    for filename in ["vw_novedades_laborales.sql", "vw_auditoria_at_workload_match.sql"]:
        sql_path = os.path.join(os.path.dirname(__file__), "sql", filename)
        if os.path.exists(sql_path):
            with open(sql_path, "r", encoding="utf-8") as file:
                conn.executescript(file.read())
            conn.commit()
            etl.log.info("Vista complementaria aplicada desde %s", filename)


def validar_modelo_seguro(conn):
    _original_validar_modelo(conn)
    ensure_modelo_extendido(conn)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall()}
    required = {"pgi_workload", "app_users", "app_roles", "app_role_permissions", "app_report_permissions"}
    missing = required - tables
    if missing:
        raise RuntimeError("Faltan tablas app: " + ", ".join(sorted(missing)))
    pgi_cols = {row[1] for row in conn.execute("PRAGMA table_info(pgi_workload)").fetchall()}
    if "incidence_type" not in pgi_cols:
        raise RuntimeError("Falta columna pgi_workload.incidence_type")
    app_user_cols = {row[1] for row in conn.execute("PRAGMA table_info(app_users)").fetchall()}
    if "project_id" not in app_user_cols:
        raise RuntimeError("Falta columna app_users.project_id")
    etl.log.info("Modelo extendido validado")


etl.crear_tablas = crear_tablas_seguro
etl.upsert = upsert_seguro
etl.JiraClient.get = jira_get_seguro
etl.JiraClient.paginar = jira_paginar_seguro
etl.cargar_at_usuarios_en_map = cargar_at_usuarios_en_map_seguro
etl.cargar_jira_personas_en_map = cargar_jira_personas_en_map_seguro
etl.extraer_at_workload = extraer_at_workload_seguro
etl.refrescar_vistas = refrescar_vistas_seguro
etl.validar_modelo = validar_modelo_seguro

if __name__ == "__main__":
    etl.main()
