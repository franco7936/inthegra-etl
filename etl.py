"""
ETL principal Inthegra: Jira + ActivityTimeline -> Turso.

Modelo v2:
- No mantiene tablas catalogo separadas para equipos AT ni proyectos Jira.
- La asociacion de proyecto/equipo vive en map_equipo_proyecto.
- La asociacion de personas AT/Jira vive en map_personas.
- ActivityTimeline queda consolidado en at_workload.
- Jira queda consolidado en rpt_issues, rpt_worklogs, rpt_sprints y rpt_epicas.

Uso:
    python etl.py --solo-conexion
    python etl.py --recrear-modelo --full --sin-jsm   # solo primera corrida del modelo v2
    python etl.py --full --sin-jsm
    python etl.py --desde 2026-09-01 --sin-jsm
    python etl.py --sin-jsm
"""

import argparse
import logging
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests
from dotenv import load_dotenv

from turso_conn import TursoConn, conectar_turso

load_dotenv()

JIRA_BASE = os.getenv("JIRA_BASE_URL", "").rstrip("/")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "")
JIRA_TOKEN = os.getenv("JIRA_API_TOKEN", "")
PROJECTS = [p.strip() for p in os.getenv("JIRA_PROJECTS", "").split(",") if p.strip()]
TURSO_URL = os.getenv("TURSO_URL", "").replace("libsql://", "https://")
AT_BASE = os.getenv("AT_BASE_URL", JIRA_BASE).rstrip("/")
AT_TOKEN = os.getenv("AT_TOKEN", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("inthegra_etl")


class JiraClient:
    def __init__(self):
        if not all([JIRA_BASE, JIRA_EMAIL, JIRA_TOKEN]):
            raise ValueError("Faltan JIRA_BASE_URL, JIRA_EMAIL o JIRA_API_TOKEN")
        self.session = requests.Session()
        self.session.auth = (JIRA_EMAIL, JIRA_TOKEN)
        self.session.headers.update({"Accept": "application/json"})

    def get(self, path, params=None, api="platform"):
        bases = {
            "platform": f"{JIRA_BASE}/rest/api/3",
            "agile": f"{JIRA_BASE}/rest/agile/1.0",
            "jsm": f"{JIRA_BASE}/rest/servicedeskapi",
        }
        url = f"{bases[api]}/{path.lstrip('/')}"
        resp = self.session.get(url, params=params or {}, timeout=60)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError:
            log.error("Jira HTTP %s en %s: %s", resp.status_code, url, resp.text[:300])
            raise
        return resp.json()

    def paginar(self, path, params=None, api="platform", key_valores="values", max_items=50000):
        params = dict(params or {})
        start_key = "start" if api == "jsm" else "startAt"
        limit_key = "limit" if api == "jsm" else "maxResults"
        params[start_key] = 0
        params[limit_key] = 100
        rows = []
        while True:
            data = self.get(path, params=params, api=api)
            items = data.get(key_valores, data.get("values", []))
            rows.extend(items)
            total = data.get("total")
            is_last = data.get("isLast", data.get("isLastPage", False))
            if is_last or not items or len(rows) >= max_items:
                break
            if total is not None and len(rows) >= total:
                break
            params[start_key] += len(items)
            time.sleep(0.15)
        return rows


class ATClient:
    def __init__(self):
        if not AT_TOKEN:
            raise ValueError("Falta AT_TOKEN")
        self.base = f"{AT_BASE}/rest/api/1"
        self.session = requests.Session()
        self.session.headers.update({"auth-token": AT_TOKEN, "Accept": "application/json"})

    def get(self, path, params=None):
        url = f"{self.base}/{path.lstrip('/')}"
        resp = self.session.get(url, params=params or {}, timeout=60)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError:
            log.error("AT HTTP %s en %s: %s", resp.status_code, url, resp.text[:300])
            raise
        return resp.json()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def seg_a_hs(seconds):
    try:
        return round(float(seconds or 0) / 3600, 2)
    except (TypeError, ValueError):
        return 0


def rango_at(full=False, dias=60):
    hoy = datetime.now(timezone.utc).date()
    desde = hoy - timedelta(days=365 if full else dias)
    return desde.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")


def normalizar(texto):
    raw = unicodedata.normalize("NFKD", str(texto or ""))
    sin_acentos = "".join(c for c in raw if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", sin_acentos.lower()).strip()


def tokens_nombre(texto):
    stop = {"de", "del", "la", "el", "los", "las", "and", "the", "team", "equipo", "proyecto", "project"}
    return [t for t in normalizar(texto).split() if len(t) >= 3 and t not in stop]


def nombres_compatibles(base_rpt, nombre_at):
    base = normalizar(base_rpt)
    target = normalizar(nombre_at)
    if not base or not target:
        return False
    if base in target or target in base:
        return True
    return any(token in target for token in tokens_nombre(base_rpt))


def personas_compatibles(nombre_jira, nombre_at):
    jira = set(tokens_nombre(nombre_jira))
    at = set(tokens_nombre(nombre_at))
    if not jira or not at:
        return False
    return jira.issubset(at) or at.issubset(jira) or len(jira & at) >= min(2, len(jira), len(at))


def q(value):
    return str(value or "").replace("'", "''")


def table_exists(conn, table):
    row = conn.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name=?", (table,)).fetchone()
    return bool(row)


def upsert(conn, tabla, rows):
    if not rows:
        log.info("%s: sin registros", tabla)
        return 0
    df = pd.DataFrame(rows)
    n = conn.to_sql_df(df, tabla, if_exists="append", chunksize=50)
    log.info("%s: %s registros", tabla, n)
    return n


def recrear_modelo(conn: TursoConn):
    log.warning("Recreando modelo v2: se eliminan tablas/vistas legadas y tablas del modelo actual")
    for view in [
        "RPT_AT_EVENTOS_DETALLE_HORAS", "RPT_AT_HORAS_PERSONA_TIPO_PERIODO", "RPT_AT_HORAS_EQUIPO_TIPO_PERIODO",
        "VW_REPORTE_HORAS_DETALLE", "VW_REPORTE_HORAS_PERSONA_TIPO", "VW_REPORTE_HORAS_EQUIPO_TIPO",
        "FACT_CAPACIDAD", "RPT_CAPACIDAD_SEMANA", "AT_WORKLOAD_RESUMEN_DIARIO", "RPT_AT_HORAS_PERSONA_TIPO",
        "RPT_AT_HORAS_USADAS_EVENTO",
    ]:
        conn.execute(f"DROP VIEW IF EXISTS {view}")
    for table in [
        "at_availability", "at_capacity", "at_eventos", "at_equipos", "at_usuarios",
        "map_at_equipo_proyecto", "map_persona_fuentes", "map_equipo_proyecto", "map_personas",
        "rpt_proyectos", "rpt_versiones", "rpt_componentes", "rpt_issue_links", "rpt_changelog", "rpt_comentarios",
        "rpt_jsm_tickets", "rpt_jsm_slas", "rpt_worklogs", "rpt_issues", "rpt_sprints", "rpt_epicas",
        "at_workload", "rpt_etl_log", "etl_log",
    ]:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()


def crear_tablas(conn: TursoConn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS map_equipo_proyecto (
            project_id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id_at TEXT,
            nombre_at TEXT,
            team_type_at TEXT,
            fecha_carga_at TEXT,
            project_key_rpt TEXT,
            board_id_rpt INTEGER,
            nombre_rpt TEXT,
            tipo_rpt TEXT,
            lead_rpt TEXT,
            fecha_carga_rpt TEXT,
            criterio_match TEXT DEFAULT 'pendiente',
            activo INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS map_personas (
            person_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username_at TEXT,
            full_name_at TEXT,
            enabled_at INTEGER,
            fecha_carga_at TEXT,
            user_id_rpt TEXT,
            user_name_rpt TEXT,
            fecha_carga_rpt TEXT,
            criterio_match TEXT DEFAULT 'pendiente',
            activo INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_sprints (
            sprint_id INTEGER PRIMARY KEY,
            sprint_name TEXT,
            project_id INTEGER,
            board_id INTEGER,
            state TEXT,
            start_date TEXT,
            end_date TEXT,
            goal TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_epicas (
            epic_key TEXT PRIMARY KEY,
            project_id INTEGER,
            board_id INTEGER,
            nombre TEXT,
            summary TEXT,
            status TEXT,
            done INTEGER,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_issues (
            issue_key TEXT PRIMARY KEY,
            sprint_id INTEGER,
            epic_key TEXT,
            project_id INTEGER,
            issue_type TEXT,
            status TEXT,
            status_category TEXT,
            priority TEXT,
            assignee_id TEXT,
            assignee_name TEXT,
            reporter_name TEXT,
            summary TEXT,
            estimado_hs REAL,
            restante_hs REAL,
            estimado_total_hs REAL,
            restante_total_hs REAL,
            version_fix TEXT,
            componentes TEXT,
            cant_comentarios INTEGER,
            cant_subtareas INTEGER,
            cant_links INTEGER,
            cant_watchers INTEGER,
            created_date TEXT,
            updated_date TEXT,
            resolved_date TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_worklogs (
            worklog_id TEXT PRIMARY KEY,
            issue_key TEXT,
            project_id INTEGER,
            person_id INTEGER,
            user_name TEXT,
            date_worked TEXT,
            hours_logged REAL,
            comentario TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS at_workload (
            workload_id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER,
            project_id INTEGER,
            issue_key TEXT,
            event_type TEXT,
            summary TEXT,
            planned_start TEXT,
            planned_end TEXT,
            orig_estimate REAL,
            rem_estimate REAL,
            tiempo_empleado REAL,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS etl_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT,
            modo TEXT,
            tabla TEXT,
            registros INTEGER,
            estado TEXT,
            detalle TEXT
        );
    """)
    conn.commit()


def log_etl(conn, modo, tabla, n, estado="OK", detalle=""):
    conn.execute(
        "INSERT INTO etl_log (fecha,modo,tabla,registros,estado,detalle) VALUES (?,?,?,?,?,?)",
        (now_iso(), modo, tabla, n, estado, detalle),
    )
    conn.commit()


def ultima_carga(conn, tabla):
    try:
        row = conn.execute("SELECT MAX(fecha) FROM etl_log WHERE tabla=? AND estado='OK'", (tabla,)).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def consultar_proyectos_jira(jira):
    items = jira.paginar("project/search", key_valores="values")
    if not items:
        data = jira.get("project")
        items = data if isinstance(data, list) else []
    if PROJECTS:
        permitidos = set(PROJECTS)
        items = [p for p in items if p.get("key") in permitidos]
    return [p for p in items if p.get("key")]


def consultar_equipos_at(at):
    if not at:
        return []
    data = at.get("team/list")
    return data if isinstance(data, list) else []


def board_principal(jira, project_key):
    try:
        boards = jira.paginar("board", params={"projectKeyOrId": project_key}, api="agile", key_valores="values")
    except Exception as exc:
        log.warning("Boards %s: %s", project_key, exc)
        return None
    if not boards:
        return None
    scrum = next((b for b in boards if b.get("type") == "scrum"), None)
    return scrum or boards[0]


def cargar_map_equipo_proyecto(jira, at, conn, modo):
    log.info("Map equipo/proyecto...")
    now = now_iso()
    proyectos = consultar_proyectos_jira(jira)
    equipos = consultar_equipos_at(at)
    usados_at = set()
    actuales = conn.execute("SELECT project_id, team_id_at, project_key_rpt FROM map_equipo_proyecto").fetchall()
    por_key = {r[2]: r[0] for r in actuales if r[2]}
    por_team = {r[1]: r[0] for r in actuales if r[1]}
    insertados = 0

    for proyecto in proyectos:
        key = proyecto.get("key")
        nombre = proyecto.get("name", "")
        board = board_principal(jira, key)
        match = next((e for e in equipos if nombres_compatibles(nombre, e.get("name", ""))), None)
        if match:
            usados_at.add(str(match.get("id")))
        lead = (proyecto.get("lead") or {}).get("displayName")
        valores = {
            "team_id_at": str(match.get("id")) if match else None,
            "nombre_at": match.get("name", "") if match else None,
            "team_type_at": match.get("teamType", "") if match else None,
            "fecha_carga_at": now if match else None,
            "project_key_rpt": key,
            "board_id_rpt": board.get("id") if board else None,
            "nombre_rpt": nombre,
            "tipo_rpt": proyecto.get("projectTypeKey"),
            "lead_rpt": lead,
            "fecha_carga_rpt": now,
            "criterio_match": "nombre_auto" if match else "pendiente",
            "fecha_carga": now,
        }
        if key in por_key:
            conn.execute(
                """
                UPDATE map_equipo_proyecto
                SET team_id_at=COALESCE(team_id_at, ?), nombre_at=COALESCE(nombre_at, ?),
                    team_type_at=COALESCE(team_type_at, ?), fecha_carga_at=COALESCE(fecha_carga_at, ?),
                    board_id_rpt=?, nombre_rpt=?, tipo_rpt=?, lead_rpt=?, fecha_carga_rpt=?,
                    criterio_match=CASE WHEN criterio_match='pendiente' AND ? IS NOT NULL THEN 'nombre_auto' ELSE criterio_match END,
                    fecha_carga=?
                WHERE project_key_rpt=?
                """,
                (valores["team_id_at"], valores["nombre_at"], valores["team_type_at"], valores["fecha_carga_at"],
                 valores["board_id_rpt"], valores["nombre_rpt"], valores["tipo_rpt"], valores["lead_rpt"], valores["fecha_carga_rpt"],
                 valores["team_id_at"], now, key),
            )
        else:
            conn.execute(
                """
                INSERT INTO map_equipo_proyecto
                (team_id_at,nombre_at,team_type_at,fecha_carga_at,project_key_rpt,board_id_rpt,nombre_rpt,tipo_rpt,lead_rpt,fecha_carga_rpt,criterio_match,activo,fecha_carga)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (valores["team_id_at"], valores["nombre_at"], valores["team_type_at"], valores["fecha_carga_at"], key,
                 valores["board_id_rpt"], nombre, valores["tipo_rpt"], lead, now, valores["criterio_match"], 1, now),
            )
            insertados += 1

    for equipo in equipos:
        team_id = str(equipo.get("id"))
        if not team_id or team_id in usados_at or team_id in por_team:
            continue
        conn.execute(
            """
            INSERT INTO map_equipo_proyecto
            (team_id_at,nombre_at,team_type_at,fecha_carga_at,criterio_match,activo,fecha_carga)
            VALUES (?,?,?,?,?,?,?)
            """,
            (team_id, equipo.get("name", ""), equipo.get("teamType", ""), now, "pendiente", 1, now),
        )
        insertados += 1
    conn.commit()
    log_etl(conn, modo, "map_equipo_proyecto", insertados, detalle="altas nuevas; filas existentes actualizadas")
    return proyectos, equipos


def mapa_project_por_key(conn):
    rows = conn.execute("SELECT project_id, project_key_rpt FROM map_equipo_proyecto WHERE project_key_rpt IS NOT NULL").fetchall()
    return {r[1]: r[0] for r in rows}


def mapa_project_por_team(conn):
    rows = conn.execute("SELECT project_id, team_id_at FROM map_equipo_proyecto WHERE team_id_at IS NOT NULL").fetchall()
    return {str(r[1]): r[0] for r in rows}


def cargar_at_usuarios_en_map(at, conn, modo):
    if not at:
        return []
    log.info("Map personas desde ActivityTimeline...")
    now = now_iso()
    rows, offset = [], 0
    while True:
        data = at.get("user", params={"startOffset": offset})
        if not isinstance(data, list) or not data:
            break
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

    existentes = conn.execute("SELECT person_id, username_at FROM map_personas WHERE username_at IS NOT NULL").fetchall()
    por_username = {r[1]: r[0] for r in existentes}
    altas = 0
    for r in rows:
        if r["username_at"] in por_username:
            conn.execute(
                """
                UPDATE map_personas
                SET full_name_at=?, enabled_at=?, fecha_carga_at=?, fecha_carga=?
                WHERE username_at=?
                """,
                (r["full_name_at"], r["enabled_at"], r["fecha_carga_at"], now, r["username_at"]),
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
    log_etl(conn, modo, "map_personas_at", altas, detalle="usuarios AT nuevos; existentes actualizados")
    return rows


def cargar_jira_personas_en_map(conn, personas_jira, modo):
    log.info("Map personas desde Jira...")
    now = now_iso()
    at_rows = conn.execute("SELECT person_id, full_name_at, user_id_rpt FROM map_personas").fetchall()
    por_user_id = {r[2]: r[0] for r in at_rows if r[2]}
    altas = 0
    for user_id, user_name in sorted(personas_jira):
        if not user_id and not user_name:
            continue
        if user_id in por_user_id:
            conn.execute(
                "UPDATE map_personas SET user_name_rpt=?, fecha_carga_rpt=?, fecha_carga=? WHERE user_id_rpt=?",
                (user_name, now, now, user_id),
            )
            continue
        match = next((r for r in at_rows if not r[2] and personas_compatibles(user_name, r[1])), None)
        if match:
            conn.execute(
                """
                UPDATE map_personas
                SET user_id_rpt=?, user_name_rpt=?, fecha_carga_rpt=?,
                    criterio_match=CASE WHEN criterio_match='pendiente' THEN 'nombre_auto' ELSE criterio_match END,
                    fecha_carga=?
                WHERE person_id=?
                """,
                (user_id, user_name, now, now, match[0]),
            )
        else:
            conn.execute(
                """
                INSERT INTO map_personas
                (user_id_rpt,user_name_rpt,fecha_carga_rpt,criterio_match,activo,fecha_carga)
                VALUES (?,?,?,?,?,?)
                """,
                (user_id, user_name, now, "pendiente", 1, now),
            )
            altas += 1
    conn.commit()
    log_etl(conn, modo, "map_personas_jira", altas, detalle="usuarios Jira nuevos; matching automatico por nombre")


def mapa_person_por_at(conn):
    rows = conn.execute("SELECT person_id, username_at FROM map_personas WHERE username_at IS NOT NULL").fetchall()
    return {r[1]: r[0] for r in rows}


def mapa_person_por_jira(conn):
    rows = conn.execute("SELECT person_id, user_id_rpt FROM map_personas WHERE user_id_rpt IS NOT NULL").fetchall()
    return {r[1]: r[0] for r in rows}


def extraer_sprints_epicas(jira, conn, modo):
    log.info("Jira sprints y epicas...")
    now = now_iso()
    proyectos = conn.execute("SELECT project_id, project_key_rpt, board_id_rpt FROM map_equipo_proyecto WHERE project_key_rpt IS NOT NULL").fetchall()
    sprints, epicas = [], []
    for project_id, project_key, board_id in proyectos:
        if not board_id:
            continue
        try:
            for sprint in jira.paginar(f"board/{board_id}/sprint", params={"state": "active,closed"}, api="agile", key_valores="values"):
                sprints.append({
                    "sprint_id": sprint.get("id"),
                    "sprint_name": sprint.get("name"),
                    "project_id": project_id,
                    "board_id": board_id,
                    "state": sprint.get("state"),
                    "start_date": sprint.get("startDate"),
                    "end_date": sprint.get("endDate"),
                    "goal": sprint.get("goal", ""),
                    "fecha_carga": now,
                })
        except Exception as exc:
            log.warning("Sprints %s: %s", project_key, exc)
        try:
            for epic in jira.paginar(f"board/{board_id}/epic", api="agile", key_valores="values"):
                epicas.append({
                    "epic_key": epic.get("key"),
                    "project_id": project_id,
                    "board_id": board_id,
                    "nombre": epic.get("name", ""),
                    "summary": epic.get("summary", ""),
                    "status": (epic.get("status") or {}).get("name", ""),
                    "done": 1 if epic.get("done") else 0,
                    "fecha_carga": now,
                })
        except Exception as exc:
            log.warning("Epicas %s: %s", project_key, exc)
    if sprints:
        ids = ",".join(str(r["sprint_id"]) for r in sprints if r.get("sprint_id"))
        if ids:
            conn.execute(f"DELETE FROM rpt_sprints WHERE sprint_id IN ({ids})")
    if epicas:
        keys = ",".join(f"'{q(r['epic_key'])}'" for r in epicas if r.get("epic_key"))
        if keys:
            conn.execute(f"DELETE FROM rpt_epicas WHERE epic_key IN ({keys})")
    conn.commit()
    log_etl(conn, modo, "rpt_sprints", upsert(conn, "rpt_sprints", sprints))
    log_etl(conn, modo, "rpt_epicas", upsert(conn, "rpt_epicas", epicas))


def extraer_issues(jira, conn, modo, desde=None):
    log.info("Jira issues...")
    now = now_iso()
    project_map = mapa_project_por_key(conn)
    project_keys = list(project_map.keys())
    if not project_keys:
        log.warning("No hay proyectos Jira en map_equipo_proyecto")
        return set()
    pks = ",".join(project_keys)
    fields = [
        "summary", "status", "issuetype", "assignee", "reporter", "priority",
        "created", "updated", "resolutiondate", "customfield_10020", "customfield_10014",
        "timeoriginalestimate", "timeestimate", "aggregatetimeoriginalestimate",
        "aggregatetimeestimate", "fixVersions", "components", "comment", "subtasks", "issuelinks", "watches",
    ]
    if desde:
        jql = f"project in ({pks}) AND updated >= '{desde}' ORDER BY updated ASC"
    else:
        uc = ultima_carga(conn, "rpt_issues")
        jql = f"project in ({pks}) AND updated >= '{uc[:10]}' ORDER BY updated ASC" if uc else f"project in ({pks}) ORDER BY created ASC"
    issues = jira.paginar("search/jql", params={"jql": jql, "fields": ",".join(fields)}, key_valores="issues")
    rows, personas = [], set()
    for issue in issues:
        f = issue.get("fields", {})
        key = issue.get("key", "")
        project_key = key.split("-")[0]
        sprint_raw = f.get("customfield_10020")
        sprint_id = None
        if isinstance(sprint_raw, list) and sprint_raw:
            sprint_id = sprint_raw[-1].get("id")
        elif isinstance(sprint_raw, dict):
            sprint_id = sprint_raw.get("id")
        assignee = f.get("assignee") or {}
        reporter = f.get("reporter") or {}
        if assignee.get("accountId") or assignee.get("displayName"):
            personas.add((assignee.get("accountId"), assignee.get("displayName", "")))
        if reporter.get("accountId") or reporter.get("displayName"):
            personas.add((reporter.get("accountId"), reporter.get("displayName", "")))
        rows.append({
            "issue_key": key,
            "sprint_id": sprint_id,
            "epic_key": f.get("customfield_10014"),
            "project_id": project_map.get(project_key),
            "issue_type": (f.get("issuetype") or {}).get("name"),
            "status": (f.get("status") or {}).get("name"),
            "status_category": ((f.get("status") or {}).get("statusCategory") or {}).get("name"),
            "priority": (f.get("priority") or {}).get("name"),
            "assignee_id": assignee.get("accountId"),
            "assignee_name": assignee.get("displayName"),
            "reporter_name": reporter.get("displayName"),
            "summary": (f.get("summary") or "")[:500],
            "estimado_hs": seg_a_hs(f.get("timeoriginalestimate")),
            "restante_hs": seg_a_hs(f.get("timeestimate")),
            "estimado_total_hs": seg_a_hs(f.get("aggregatetimeoriginalestimate")),
            "restante_total_hs": seg_a_hs(f.get("aggregatetimeestimate")),
            "version_fix": ", ".join(v.get("name", "") for v in (f.get("fixVersions") or [])) or None,
            "componentes": ", ".join(c.get("name", "") for c in (f.get("components") or [])) or None,
            "cant_comentarios": (f.get("comment") or {}).get("total", 0),
            "cant_subtareas": len(f.get("subtasks") or []),
            "cant_links": len(f.get("issuelinks") or []),
            "cant_watchers": (f.get("watches") or {}).get("watchCount", 0),
            "created_date": f.get("created"),
            "updated_date": f.get("updated"),
            "resolved_date": f.get("resolutiondate"),
            "fecha_carga": now,
        })
    if rows:
        keys = ",".join(f"'{q(r['issue_key'])}'" for r in rows)
        conn.execute(f"DELETE FROM rpt_issues WHERE issue_key IN ({keys})")
        conn.commit()
    log_etl(conn, modo, "rpt_issues", upsert(conn, "rpt_issues", rows))
    return personas


def obtener_issue_key_por_id(jira, issue_id):
    try:
        data = jira.get(f"issue/{issue_id}", params={"fields": "key"})
        return data.get("key", "")
    except Exception:
        return ""


def extraer_worklogs_jira(jira, conn, modo, full=False):
    log.info("Jira worklogs...")
    now = now_iso()
    if full:
        since_ms = int(time.time() * 1000) - 365 * 24 * 3600 * 1000
    else:
        uc = ultima_carga(conn, "rpt_worklogs")
        since_ms = int(datetime.fromisoformat(uc.replace("Z", "+00:00")).timestamp() * 1000) if uc else int(time.time() * 1000) - 365 * 24 * 3600 * 1000
    data = jira.get("worklog/updated", params={"since": since_ms})
    ids = [str(w.get("worklogId")) for w in data.get("values", []) if w.get("worklogId")]
    raw_rows, personas = [], set()
    issue_cache = {}
    for i in range(0, len(ids), 1000):
        lote = ids[i:i + 1000]
        response = jira.session.post(f"{JIRA_BASE}/rest/api/3/worklog/list", json={"ids": [int(x) for x in lote]}, timeout=60)
        response.raise_for_status()
        for w in response.json():
            author = w.get("author") or {}
            user_id = author.get("accountId")
            user_name = author.get("displayName", "")
            if user_id or user_name:
                personas.add((user_id, user_name))
            issue_key = w.get("issueKey") or ""
            if not issue_key and w.get("issueId"):
                issue_id = str(w.get("issueId"))
                if issue_id not in issue_cache:
                    issue_cache[issue_id] = obtener_issue_key_por_id(jira, issue_id)
                issue_key = issue_cache[issue_id]
            raw_rows.append({
                "worklog_id": str(w.get("id")),
                "issue_key": issue_key,
                "user_id_rpt": user_id,
                "user_name": user_name,
                "date_worked": (w.get("started") or "")[:10],
                "hours_logged": seg_a_hs(w.get("timeSpentSeconds")),
                "comentario": (w.get("comment") or "")[:300] if isinstance(w.get("comment"), str) else "",
                "fecha_carga": now,
            })
        time.sleep(0.2)
    cargar_jira_personas_en_map(conn, personas, modo)
    person_map = mapa_person_por_jira(conn)
    project_map = mapa_project_por_key(conn)
    rows = []
    for r in raw_rows:
        project_key = r["issue_key"].split("-")[0] if "-" in r["issue_key"] else ""
        rows.append({
            "worklog_id": r["worklog_id"],
            "issue_key": r["issue_key"],
            "project_id": project_map.get(project_key),
            "person_id": person_map.get(r["user_id_rpt"]),
            "user_name": r["user_name"],
            "date_worked": r["date_worked"],
            "hours_logged": r["hours_logged"],
            "comentario": r["comentario"],
            "fecha_carga": r["fecha_carga"],
        })
    if rows:
        ids_sql = ",".join(f"'{q(r['worklog_id'])}'" for r in rows)
        conn.execute(f"DELETE FROM rpt_worklogs WHERE worklog_id IN ({ids_sql})")
        conn.commit()
    log_etl(conn, modo, "rpt_worklogs", upsert(conn, "rpt_worklogs", rows))


def extraer_at_workload(at, conn, equipos, modo, full=False):
    if not at:
        return
    log.info("ActivityTimeline workload consolidado...")
    now = now_iso()
    start, end = rango_at(full)
    person_map = mapa_person_por_at(conn)
    project_by_team = mapa_project_por_team(conn)
    rows = []

    for equipo in equipos:
        team_id = str(equipo.get("id"))
        project_id = project_by_team.get(team_id)
        try:
            data = at.get("timeline", params={"teamId": team_id, "start": start, "end": end})
            for member in data.get("members", []) if isinstance(data, dict) else []:
                person_id = person_map.get(member.get("username"))
                for item in member.get("issues", []) or []:
                    event_type = item.get("issueType", "") or "SIN_TIPO"
                    tiempo = item.get("dailyTimeEstimate")
                    if tiempo is None:
                        tiempo = item.get("originalTimeEstimate")
                    rows.append({
                        "person_id": person_id,
                        "project_id": project_id,
                        "issue_key": item.get("issueKey", ""),
                        "event_type": event_type,
                        "summary": (item.get("summary") or "")[:500],
                        "planned_start": item.get("plannedStart", ""),
                        "planned_end": item.get("plannedEnd", ""),
                        "orig_estimate": seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": seg_a_hs(item.get("remainingTimeEstimate")),
                        "tiempo_empleado": seg_a_hs(tiempo),
                        "fecha_carga": now,
                    })
            time.sleep(0.2)
        except Exception as exc:
            log.warning("Timeline equipo %s: %s", equipo.get("name"), exc)

        try:
            offset = 0
            while True:
                data = at.get("worklog/list", params={
                    "teamId": team_id,
                    "start": start,
                    "end": end,
                    "startOffset": offset,
                    "recordType": "worklogs,bookings,calendarEvents",
                })
                if not isinstance(data, list) or not data:
                    break
                for item in data:
                    username = item.get("username")
                    person_id = person_map.get(username)
                    issue_key = item.get("issueKey", "")
                    project_key = item.get("projectKey", "") or (issue_key.split("-")[0] if "-" in issue_key else "")
                    project_id_row = project_id or mapa_project_por_key(conn).get(project_key)
                    is_worklog = bool(item.get("worklogId"))
                    event_type = "WORKLOG" if is_worklog else item.get("issueType", "CALENDAR_EVENT")
                    rows.append({
                        "person_id": person_id,
                        "project_id": project_id_row,
                        "issue_key": issue_key,
                        "event_type": event_type,
                        "summary": (item.get("comment") or item.get("summary") or "")[:500],
                        "planned_start": (item.get("date") or item.get("plannedStart") or "")[:10],
                        "planned_end": (item.get("date") or item.get("plannedEnd") or "")[:10],
                        "orig_estimate": seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": seg_a_hs(item.get("remainingTimeEstimate")),
                        "tiempo_empleado": seg_a_hs(item.get("timeSpent") if is_worklog else item.get("dailyTimeEstimate") or item.get("originalTimeEstimate")),
                        "fecha_carga": now,
                    })
                if len(data) < 1000:
                    break
                offset += len(data)
                time.sleep(0.2)
        except Exception as exc:
            log.warning("Worklog/list equipo %s: %s", equipo.get("name"), exc)

    conn.execute("DELETE FROM at_workload WHERE planned_start >= ? AND planned_start <= ?", (start, end))
    conn.commit()
    log_etl(conn, modo, "at_workload", upsert(conn, "at_workload", rows), detalle=f"{start} a {end}")


def refrescar_vistas(conn):
    log.info("Refrescando vistas de reporte...")
    for name in ["VW_REPORTE_HORAS_DETALLE", "VW_REPORTE_HORAS_PERSONA_TIPO", "VW_REPORTE_HORAS_EQUIPO_TIPO"]:
        conn.execute(f"DROP VIEW IF EXISTS {name}")
    conn.execute("""
        CREATE VIEW VW_REPORTE_HORAS_DETALLE AS
        SELECT
            w.workload_id,
            w.person_id,
            COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
            w.project_id,
            COALESCE(me.nombre_rpt, me.nombre_at, 'Sin proyecto') AS proyecto,
            me.project_key_rpt,
            me.team_id_at,
            w.issue_key,
            w.event_type,
            w.summary,
            date(w.planned_start) AS fecha,
            w.planned_start,
            w.planned_end,
            w.orig_estimate,
            w.rem_estimate,
            w.tiempo_empleado,
            w.fecha_carga
        FROM at_workload w
        LEFT JOIN map_personas mp ON mp.person_id = w.person_id
        LEFT JOIN map_equipo_proyecto me ON me.project_id = w.project_id
    """)
    conn.execute("""
        CREATE VIEW VW_REPORTE_HORAS_PERSONA_TIPO AS
        SELECT
            fecha,
            person_id,
            persona,
            project_id,
            proyecto,
            project_key_rpt,
            event_type,
            ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas,
            COUNT(*) AS registros
        FROM VW_REPORTE_HORAS_DETALLE
        GROUP BY fecha, person_id, persona, project_id, proyecto, project_key_rpt, event_type
    """)
    conn.execute("""
        CREATE VIEW VW_REPORTE_HORAS_EQUIPO_TIPO AS
        SELECT
            fecha,
            project_id,
            proyecto,
            project_key_rpt,
            event_type,
            ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas,
            COUNT(DISTINCT person_id) AS personas,
            COUNT(*) AS registros
        FROM VW_REPORTE_HORAS_DETALLE
        GROUP BY fecha, project_id, proyecto, project_key_rpt, event_type
    """)
    conn.commit()


def validar_modelo(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall()}
    views = {r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type='view'").fetchall()}
    required = {"map_equipo_proyecto", "map_personas", "rpt_sprints", "rpt_epicas", "rpt_issues", "rpt_worklogs", "at_workload", "etl_log"}
    forbidden = {"at_capacity", "at_eventos", "at_equipos", "at_usuarios", "rpt_proyectos", "rpt_componentes", "rpt_comentarios", "rpt_issue_links", "rpt_jsm_slas", "rpt_jsm_tickets", "rpt_versiones", "rpt_changelog", "rpt_etl_log"}
    required_views = {"VW_REPORTE_HORAS_DETALLE", "VW_REPORTE_HORAS_PERSONA_TIPO", "VW_REPORTE_HORAS_EQUIPO_TIPO"}
    errors = []
    if required - tables:
        errors.append("Faltan tablas: " + ", ".join(sorted(required - tables)))
    if forbidden & tables:
        errors.append("Siguen tablas legadas: " + ", ".join(sorted(forbidden & tables)))
    if required_views - views:
        errors.append("Faltan vistas: " + ", ".join(sorted(required_views - views)))
    if errors:
        for error in errors:
            log.error(error)
        raise RuntimeError("Modelo v2 incompleto")
    log.info("Modelo v2 validado")


def verificar_conexion(jira, at=None):
    try:
        me = jira.get("myself")
        log.info("Jira conectado: %s", me.get("displayName"))
    except Exception as exc:
        log.error("Jira no conecta: %s", exc)
        return False
    if at:
        teams = at.get("team/list")
        log.info("ActivityTimeline conectado: %s equipos", len(teams) if isinstance(teams, list) else 0)
    return True


def mostrar_resumen(conn):
    log.info("Resumen de tablas principales")
    for table in ["map_equipo_proyecto", "map_personas", "rpt_sprints", "rpt_epicas", "rpt_issues", "rpt_worklogs", "at_workload", "etl_log"]:
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            log.info("%-24s %8s", table, n)
        except Exception as exc:
            log.info("%-24s error: %s", table, exc)


def main():
    parser = argparse.ArgumentParser(description="ETL principal Jira + ActivityTimeline -> Turso")
    parser.add_argument("--solo-conexion", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--desde", type=str, default=None)
    parser.add_argument("--sin-worklogs", action="store_true")
    parser.add_argument("--sin-jsm", action="store_true", help="Parametro conservado por compatibilidad; JSM no crea tablas en modelo v2")
    parser.add_argument("--sin-at", action="store_true")
    parser.add_argument("--recrear-modelo", action="store_true", help="Usar solo una vez para borrar el modelo viejo y crear el modelo v2 limpio")
    args = parser.parse_args()

    modo = "full" if args.full else (f"desde-{args.desde}" if args.desde else "incremental")
    if args.recrear_modelo:
        modo = f"recrear-modelo-{modo}"
    log.info("ETL principal Inthegra | modo=%s | db=%s", modo, TURSO_URL)

    jira = JiraClient()
    at = None if args.sin_at else (ATClient() if AT_TOKEN else None)
    if args.solo_conexion:
        ok = verificar_conexion(jira, at)
        raise SystemExit(0 if ok else 1)
    if not verificar_conexion(jira, at):
        raise SystemExit(1)

    conn = conectar_turso()
    try:
        inicio = time.time()
        if args.recrear_modelo:
            recrear_modelo(conn)
        crear_tablas(conn)
        proyectos, equipos = cargar_map_equipo_proyecto(jira, at, conn, modo)
        cargar_at_usuarios_en_map(at, conn, modo)
        extraer_sprints_epicas(jira, conn, modo)
        personas_issues = extraer_issues(jira, conn, modo, desde=None if args.full else args.desde)
        cargar_jira_personas_en_map(conn, personas_issues, modo)
        if not args.sin_worklogs:
            extraer_worklogs_jira(jira, conn, modo, full=args.full)
        if at and equipos:
            extraer_at_workload(at, conn, equipos, modo, full=args.full)
        refrescar_vistas(conn)
        validar_modelo(conn)
        mostrar_resumen(conn)
        log.info("ETL completado en %ss", round(time.time() - inicio, 1))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
