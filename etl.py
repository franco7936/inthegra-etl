"""
ETL principal Inthegra: Jira + ActivityTimeline -> Turso.

Este archivo concentra el proceso completo. No depende de SQL sueltos ni de
scripts auxiliares para migraciones, vistas o validaciones.

Uso:
    python etl.py
    python etl.py --full
    python etl.py --desde 2026-09-01
    python etl.py --sin-jsm
    python etl.py --sin-at
    python etl.py --solo-conexion
"""

import argparse
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote

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
        resp = self.session.get(url, params=params or {}, timeout=45)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError:
            log.error("Jira HTTP %s en %s: %s", resp.status_code, url, resp.text[:300])
            raise
        return resp.json()

    def post(self, path, payload, api="platform"):
        base = f"{JIRA_BASE}/rest/api/3" if api == "platform" else f"{JIRA_BASE}/rest/{api}"
        resp = self.session.post(f"{base}/{path.lstrip('/')}", json=payload, timeout=45)
        resp.raise_for_status()
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
        resp = self.session.get(url, params=params or {}, timeout=45)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError:
            log.error("AT HTTP %s en %s: %s", resp.status_code, url, resp.text[:300])
            raise
        return resp.json()


def seg_a_hs(seconds):
    return round((seconds or 0) / 3600, 2)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def rango_at(full=False, dias=60):
    hoy = datetime.now(timezone.utc).date()
    desde = hoy - timedelta(days=365 if full else dias)
    return desde.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")


def table_columns(conn, table):
    try:
        return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    except Exception:
        return set()


def ensure_columns(conn, table, columns):
    existing = table_columns(conn, table)
    for name, definition in columns.items():
        if name not in existing:
            log.info("Agregando columna %s.%s", table, name)
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
    conn.commit()


def crear_tablas(conn: TursoConn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS rpt_proyectos (
            project_key TEXT PRIMARY KEY,
            nombre TEXT,
            tipo TEXT,
            lead TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_versiones (
            id TEXT PRIMARY KEY,
            project_key TEXT,
            nombre TEXT,
            descripcion TEXT,
            released INTEGER,
            release_date TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_componentes (
            id TEXT PRIMARY KEY,
            project_key TEXT,
            nombre TEXT,
            descripcion TEXT,
            lead TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_sprints (
            sprint_id INTEGER PRIMARY KEY,
            sprint_name TEXT,
            project_key TEXT,
            board_id INTEGER,
            state TEXT,
            start_date TEXT,
            end_date TEXT,
            goal TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_epicas (
            epic_key TEXT PRIMARY KEY,
            project_key TEXT,
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
            project_key TEXT,
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
        CREATE TABLE IF NOT EXISTS rpt_issue_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT,
            link_type TEXT,
            direccion TEXT,
            issue_relacionado TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_changelog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT,
            project_key TEXT,
            autor_id TEXT,
            autor_nombre TEXT,
            fecha_cambio TEXT,
            campo TEXT,
            valor_desde TEXT,
            valor_hasta TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_comentarios (
            comentario_id TEXT PRIMARY KEY,
            issue_key TEXT,
            project_key TEXT,
            autor_id TEXT,
            autor_nombre TEXT,
            fecha TEXT,
            cuerpo_preview TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_worklogs (
            worklog_id TEXT PRIMARY KEY,
            issue_key TEXT,
            project_key TEXT,
            user_id TEXT,
            user_name TEXT,
            date_worked TEXT,
            hours_logged REAL,
            comentario TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_jsm_tickets (
            issue_key TEXT PRIMARY KEY,
            service_desk_id TEXT,
            request_type TEXT,
            status TEXT,
            prioridad TEXT,
            reporter_id TEXT,
            reporter_name TEXT,
            summary TEXT,
            created_date TEXT,
            resolved_date TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS rpt_jsm_slas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT,
            sla_nombre TEXT,
            completado INTEGER,
            breached INTEGER,
            tiempo_objetivo TEXT,
            tiempo_real TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS at_equipos (
            team_id TEXT PRIMARY KEY,
            nombre TEXT,
            team_type TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS at_usuarios (
            username TEXT PRIMARY KEY,
            full_name TEXT,
            email TEXT,
            posicion TEXT,
            involvement REAL,
            enabled INTEGER,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS at_workload (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id TEXT,
            username TEXT,
            full_name TEXT,
            dia TEXT,
            dia_semana TEXT,
            horas_plan REAL,
            project_key TEXT,
            issue_key TEXT,
            tipo_registro TEXT DEFAULT 'PLANIFICADO',
            time_spent_seconds INTEGER DEFAULT 0,
            horas_usadas REAL DEFAULT 0,
            worklog_count INTEGER DEFAULT 0,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS at_capacity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id TEXT,
            username TEXT,
            full_name TEXT,
            dia TEXT,
            dia_semana TEXT,
            horas_cap REAL,
            capacidad_origen TEXT DEFAULT 'AT_CAPACITY',
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS at_eventos (
            evento_id TEXT PRIMARY KEY,
            username TEXT,
            team_id TEXT,
            project_key TEXT,
            issue_key TEXT,
            issue_id TEXT,
            issue_type TEXT,
            event_type TEXT,
            summary TEXT,
            planned_start TEXT,
            planned_end TEXT,
            orig_estimate REAL,
            rem_estimate REAL,
            daily_time_estimate REAL DEFAULT 0,
            estimate_per_work_day REAL DEFAULT 0,
            approved_by TEXT,
            extra_link TEXT,
            color TEXT,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS map_at_equipo_proyecto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at_team_id TEXT NOT NULL,
            at_equipo_nombre TEXT,
            jira_project_key TEXT NOT NULL,
            jira_project_name TEXT,
            criterio_match TEXT DEFAULT 'manual',
            activo INTEGER DEFAULT 1,
            notas TEXT,
            fecha_carga TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(at_team_id, jira_project_key)
        );
        CREATE TABLE IF NOT EXISTS map_persona_fuentes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            persona_nombre TEXT,
            at_username TEXT,
            jira_account_id TEXT,
            email TEXT,
            criterio_match TEXT DEFAULT 'manual',
            activo INTEGER DEFAULT 1,
            notas TEXT,
            fecha_carga TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(at_username, jira_account_id)
        );
        CREATE TABLE IF NOT EXISTS rpt_etl_log (
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
    asegurar_modelo_at(conn)


def asegurar_modelo_at(conn: TursoConn):
    ensure_columns(conn, "at_workload", {
        "issue_key": "TEXT",
        "tipo_registro": "TEXT DEFAULT 'PLANIFICADO'",
        "time_spent_seconds": "INTEGER DEFAULT 0",
        "horas_usadas": "REAL DEFAULT 0",
        "worklog_count": "INTEGER DEFAULT 0",
    })
    ensure_columns(conn, "at_capacity", {"capacidad_origen": "TEXT DEFAULT 'AT_CAPACITY'"})
    ensure_columns(conn, "at_eventos", {
        "project_key": "TEXT",
        "issue_id": "TEXT",
        "issue_type": "TEXT",
        "daily_time_estimate": "REAL DEFAULT 0",
        "estimate_per_work_day": "REAL DEFAULT 0",
        "approved_by": "TEXT",
        "extra_link": "TEXT",
        "color": "TEXT",
    })
    conn.execute("UPDATE at_workload SET tipo_registro = 'PLANIFICADO' WHERE tipo_registro IS NULL OR tipo_registro = ''")
    conn.execute("UPDATE at_workload SET time_spent_seconds = 0 WHERE time_spent_seconds IS NULL")
    conn.execute("UPDATE at_workload SET horas_usadas = 0 WHERE horas_usadas IS NULL")
    conn.execute("UPDATE at_workload SET worklog_count = 0 WHERE worklog_count IS NULL")
    conn.execute("UPDATE at_capacity SET capacidad_origen = 'AT_CAPACITY' WHERE capacidad_origen IS NULL OR capacidad_origen = ''")
    conn.execute("UPDATE at_eventos SET daily_time_estimate = COALESCE(daily_time_estimate, orig_estimate, 0)")
    conn.execute("UPDATE at_eventos SET estimate_per_work_day = COALESCE(estimate_per_work_day, daily_time_estimate, orig_estimate, 0)")
    conn.execute("DROP TABLE IF EXISTS at_availability")
    conn.commit()


def upsert(conn, tabla, rows):
    if not rows:
        log.info("%s: sin registros", tabla)
        return 0
    df = pd.DataFrame(rows)
    n = conn.to_sql_df(df, tabla, if_exists="append", chunksize=50)
    log.info("%s: %s registros", tabla, n)
    return n


def log_etl(conn, modo, tabla, n, estado="OK", detalle=""):
    conn.execute(
        "INSERT INTO rpt_etl_log (fecha,modo,tabla,registros,estado,detalle) VALUES (?,?,?,?,?,?)",
        (now_iso(), modo, tabla, n, estado, detalle),
    )
    conn.commit()


def ultima_carga(conn, tabla):
    try:
        row = conn.execute("SELECT MAX(fecha) FROM rpt_etl_log WHERE tabla=? AND estado='OK'", (tabla,)).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


def extraer_proyectos(jira, conn, modo):
    log.info("Jira proyectos...")
    now = now_iso()
    items = jira.paginar("project/search", key_valores="values")
    if not items:
        data = jira.get("project")
        items = data if isinstance(data, list) else []
    rows = [{
        "project_key": p.get("key"),
        "nombre": p.get("name"),
        "tipo": p.get("projectTypeKey"),
        "lead": (p.get("lead") or {}).get("displayName"),
        "fecha_carga": now,
    } for p in items if p.get("key")]
    n = upsert(conn, "rpt_proyectos", rows)
    log_etl(conn, modo, "rpt_proyectos", n)
    return [r["project_key"] for r in rows]


def extraer_catalogos_jira(jira, conn, project_keys, modo):
    now = now_iso()
    versiones, componentes = [], []
    for pk in project_keys:
        try:
            for item in jira.get(f"project/{pk}/versions") or []:
                versiones.append({
                    "id": str(item.get("id")),
                    "project_key": pk,
                    "nombre": item.get("name"),
                    "descripcion": item.get("description", ""),
                    "released": 1 if item.get("released") else 0,
                    "release_date": item.get("releaseDate"),
                    "fecha_carga": now,
                })
        except Exception as exc:
            log.warning("Versiones %s: %s", pk, exc)
        try:
            for item in jira.get(f"project/{pk}/components") or []:
                componentes.append({
                    "id": str(item.get("id")),
                    "project_key": pk,
                    "nombre": item.get("name"),
                    "descripcion": item.get("description", ""),
                    "lead": (item.get("lead") or {}).get("displayName"),
                    "fecha_carga": now,
                })
        except Exception as exc:
            log.warning("Componentes %s: %s", pk, exc)
    log_etl(conn, modo, "rpt_versiones", upsert(conn, "rpt_versiones", versiones))
    log_etl(conn, modo, "rpt_componentes", upsert(conn, "rpt_componentes", componentes))


def extraer_sprints_epicas(jira, conn, project_keys, modo):
    now = now_iso()
    sprints, epicas = [], []
    board_map = {}
    for pk in project_keys:
        try:
            boards = jira.paginar("board", params={"projectKeyOrId": pk, "type": "scrum"}, api="agile", key_valores="values")
        except Exception as exc:
            log.warning("Boards %s: %s", pk, exc)
            boards = []
        for board in boards:
            bid = board.get("id")
            board_map.setdefault(pk, []).append(bid)
            try:
                for sprint in jira.paginar(f"board/{bid}/sprint", params={"state": "active,closed"}, api="agile", key_valores="values"):
                    sprints.append({
                        "sprint_id": sprint.get("id"),
                        "sprint_name": sprint.get("name"),
                        "project_key": pk,
                        "board_id": bid,
                        "state": sprint.get("state"),
                        "start_date": sprint.get("startDate"),
                        "end_date": sprint.get("endDate"),
                        "goal": sprint.get("goal", ""),
                        "fecha_carga": now,
                    })
            except Exception as exc:
                log.warning("Sprints board %s: %s", bid, exc)
            try:
                for epic in jira.paginar(f"board/{bid}/epic", api="agile", key_valores="values"):
                    epicas.append({
                        "epic_key": epic.get("key"),
                        "project_key": pk,
                        "board_id": bid,
                        "nombre": epic.get("name", ""),
                        "summary": epic.get("summary", ""),
                        "status": (epic.get("status") or {}).get("name", ""),
                        "done": 1 if epic.get("done") else 0,
                        "fecha_carga": now,
                    })
            except Exception as exc:
                log.warning("Epicas board %s: %s", bid, exc)
    log_etl(conn, modo, "rpt_sprints", upsert(conn, "rpt_sprints", sprints))
    log_etl(conn, modo, "rpt_epicas", upsert(conn, "rpt_epicas", epicas))


def extraer_issues(jira, conn, project_keys, modo, desde=None):
    log.info("Jira issues...")
    now = now_iso()
    pks = ",".join(project_keys)
    fields = [
        "summary", "status", "issuetype", "assignee", "reporter", "priority",
        "created", "updated", "resolutiondate", "customfield_10020", "customfield_10014",
        "timeoriginalestimate", "timeestimate", "aggregatetimeoriginalestimate",
        "aggregatetimeestimate", "fixVersions", "components", "comment", "subtasks",
        "issuelinks", "watches",
    ]
    if desde:
        jql = f"project in ({pks}) AND updated >= '{desde}' ORDER BY updated ASC"
    else:
        uc = ultima_carga(conn, "rpt_issues")
        jql = f"project in ({pks}) AND updated >= '{uc[:10]}' ORDER BY updated ASC" if uc else f"project in ({pks}) ORDER BY created ASC"

    issues = jira.paginar("search/jql", params={"jql": jql, "fields": ",".join(fields), "expand": "changelog"}, key_valores="issues")
    issue_rows, changelog_rows, link_rows, comment_rows = [], [], [], []
    for issue in issues:
        f = issue.get("fields", {})
        key = issue.get("key", "")
        pk = key.split("-")[0]
        sprint_raw = f.get("customfield_10020")
        sprint_id = None
        if isinstance(sprint_raw, list) and sprint_raw:
            sprint_id = sprint_raw[-1].get("id")
        elif isinstance(sprint_raw, dict):
            sprint_id = sprint_raw.get("id")
        issue_rows.append({
            "issue_key": key,
            "sprint_id": sprint_id,
            "epic_key": f.get("customfield_10014"),
            "project_key": pk,
            "issue_type": (f.get("issuetype") or {}).get("name"),
            "status": (f.get("status") or {}).get("name"),
            "status_category": ((f.get("status") or {}).get("statusCategory") or {}).get("name"),
            "priority": (f.get("priority") or {}).get("name"),
            "assignee_id": (f.get("assignee") or {}).get("accountId"),
            "assignee_name": (f.get("assignee") or {}).get("displayName"),
            "reporter_name": (f.get("reporter") or {}).get("displayName"),
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
        for hist in (issue.get("changelog") or {}).get("histories", []):
            author = hist.get("author", {})
            for item in hist.get("items", []):
                if item.get("field") in ("status", "assignee", "priority", "sprint", "Fix Version", "resolution", "Flagged"):
                    changelog_rows.append({
                        "issue_key": key,
                        "project_key": pk,
                        "autor_id": author.get("accountId"),
                        "autor_nombre": author.get("displayName"),
                        "fecha_cambio": hist.get("created"),
                        "campo": item.get("field"),
                        "valor_desde": item.get("fromString", ""),
                        "valor_hasta": item.get("toString", ""),
                        "fecha_carga": now,
                    })
        for link in f.get("issuelinks") or []:
            tipo = (link.get("type") or {}).get("name", "")
            if link.get("inwardIssue"):
                link_rows.append({"issue_key": key, "link_type": tipo, "direccion": "inward", "issue_relacionado": link["inwardIssue"].get("key"), "fecha_carga": now})
            if link.get("outwardIssue"):
                link_rows.append({"issue_key": key, "link_type": tipo, "direccion": "outward", "issue_relacionado": link["outwardIssue"].get("key"), "fecha_carga": now})
        for comment in (f.get("comment") or {}).get("comments", []):
            body = comment.get("body", "")
            comment_rows.append({
                "comentario_id": str(comment.get("id")),
                "issue_key": key,
                "project_key": pk,
                "autor_id": (comment.get("author") or {}).get("accountId"),
                "autor_nombre": (comment.get("author") or {}).get("displayName"),
                "fecha": comment.get("created"),
                "cuerpo_preview": body[:200] if isinstance(body, str) else "",
                "fecha_carga": now,
            })
    n = upsert(conn, "rpt_issues", issue_rows)
    log_etl(conn, modo, "rpt_issues", n)
    if issue_rows:
        keys = ",".join(f"'{r['issue_key']}'" for r in issue_rows)
        conn.execute(f"DELETE FROM rpt_changelog WHERE issue_key IN ({keys})")
        conn.execute(f"DELETE FROM rpt_issue_links WHERE issue_key IN ({keys})")
        conn.commit()
    log_etl(conn, modo, "rpt_changelog", upsert(conn, "rpt_changelog", changelog_rows))
    log_etl(conn, modo, "rpt_issue_links", upsert(conn, "rpt_issue_links", link_rows))
    log_etl(conn, modo, "rpt_comentarios", upsert(conn, "rpt_comentarios", comment_rows))


def extraer_worklogs_jira(jira, conn, modo, full=False):
    log.info("Jira worklogs...")
    now = now_iso()
    if full:
        since_ms = int(time.time() * 1000) - 365 * 24 * 3600 * 1000
    else:
        uc = ultima_carga(conn, "rpt_worklogs")
        if uc:
            since_ms = int(datetime.fromisoformat(uc.replace("Z", "+00:00")).timestamp() * 1000)
        else:
            since_ms = int(time.time() * 1000) - 365 * 24 * 3600 * 1000
    data = jira.get("worklog/updated", params={"since": since_ms})
    ids = [str(w.get("worklogId")) for w in data.get("values", []) if w.get("worklogId")]
    rows = []
    for i in range(0, len(ids), 1000):
        lote = ids[i:i + 1000]
        response = jira.session.post(f"{JIRA_BASE}/rest/api/3/worklog/list", json={"ids": [int(x) for x in lote]}, timeout=45)
        response.raise_for_status()
        for w in response.json():
            issue_key = w.get("issueId", "")
            rows.append({
                "worklog_id": str(w.get("id")),
                "issue_key": issue_key,
                "project_key": issue_key.split("-")[0] if "-" in issue_key else "",
                "user_id": (w.get("author") or {}).get("accountId"),
                "user_name": (w.get("author") or {}).get("displayName"),
                "date_worked": (w.get("started") or "")[:10],
                "hours_logged": seg_a_hs(w.get("timeSpentSeconds")),
                "comentario": (w.get("comment") or "")[:300] if isinstance(w.get("comment"), str) else "",
                "fecha_carga": now,
            })
        time.sleep(0.2)
    log_etl(conn, modo, "rpt_worklogs", upsert(conn, "rpt_worklogs", rows))


def extraer_jsm(jira, conn, modo):
    log.info("JSM tickets...")
    now = now_iso()
    tickets, slas = [], []
    try:
        desks = jira.paginar("servicedesk", api="jsm", key_valores="values")
    except Exception as exc:
        log.warning("JSM omitido: %s", exc)
        return
    for desk in desks:
        did = desk.get("id")
        try:
            rows = jira.paginar("request", params={"serviceDeskId": did, "requestStatus": "ALL_REQUESTS"}, api="jsm", key_valores="values")
        except Exception as exc:
            log.warning("JSM desk %s: %s", did, exc)
            continue
        for item in rows:
            issue_key = item.get("issueKey", "")
            tickets.append({
                "issue_key": issue_key,
                "service_desk_id": str(did),
                "request_type": (item.get("requestType") or {}).get("name", ""),
                "status": (item.get("currentStatus") or {}).get("status", ""),
                "prioridad": "",
                "reporter_id": (item.get("reporter") or {}).get("accountId", ""),
                "reporter_name": (item.get("reporter") or {}).get("displayName", ""),
                "summary": "",
                "created_date": (item.get("createdDate") or {}).get("iso8601", ""),
                "resolved_date": "",
                "fecha_carga": now,
            })
            try:
                for sla in jira.get(f"request/{issue_key}/sla", api="jsm").get("values", []):
                    ongoing = sla.get("ongoingCycle", {})
                    slas.append({
                        "issue_key": issue_key,
                        "sla_nombre": sla.get("name", ""),
                        "completado": 1 if sla.get("completedCycles") else 0,
                        "breached": 1 if ongoing.get("breached") else 0,
                        "tiempo_objetivo": (ongoing.get("goalDuration") or {}).get("friendly", ""),
                        "tiempo_real": (ongoing.get("elapsedTime") or {}).get("friendly", ""),
                        "fecha_carga": now,
                    })
            except Exception:
                pass
    log_etl(conn, modo, "rpt_jsm_tickets", upsert(conn, "rpt_jsm_tickets", tickets))
    log_etl(conn, modo, "rpt_jsm_slas", upsert(conn, "rpt_jsm_slas", slas))


def extraer_at_equipos(at, conn, modo):
    now = now_iso()
    data = at.get("team/list")
    rows = [{"team_id": str(t.get("id")), "nombre": t.get("name", ""), "team_type": t.get("teamType", ""), "fecha_carga": now} for t in data if t.get("id")]
    log_etl(conn, modo, "at_equipos", upsert(conn, "at_equipos", rows))
    return rows


def extraer_at_usuarios(at, conn, modo):
    now = now_iso()
    rows, offset = [], 0
    while True:
        data = at.get("user", params={"startOffset": offset})
        if not isinstance(data, list) or not data:
            break
        for u in data:
            if u.get("username"):
                rows.append({
                    "username": u.get("username"),
                    "full_name": u.get("fullName", ""),
                    "email": u.get("email", ""),
                    "posicion": (u.get("position") or {}).get("positionNameLong", ""),
                    "involvement": u.get("involvement"),
                    "enabled": 1 if u.get("enabled") else 0,
                    "fecha_carga": now,
                })
        if len(data) < 100:
            break
        offset += len(data)
        time.sleep(0.15)
    log_etl(conn, modo, "at_usuarios", upsert(conn, "at_usuarios", rows))


def extraer_at_workload(at, conn, equipos, modo, full=False):
    log.info("AT workload planificado...")
    now = now_iso()
    start, end = rango_at(full)
    rows = []
    for equipo in equipos:
        tid = equipo["team_id"]
        try:
            data = at.get("workload", params={"teamId": tid, "start": start, "end": end, "maxUsers": 50, "includeProjectDetails": "true"})
            for member in data.get("members", []) if isinstance(data, dict) else []:
                username = member.get("username", "")
                fullname = member.get("userRealName", "")
                for item in member.get("workload", []) or []:
                    hours = item.get("hours", 0)
                    day = item.get("day", "")
                    dow = item.get("dayOfWeek", "")
                    if isinstance(hours, dict):
                        for project_key, value in hours.items():
                            try:
                                hs = max(float(value), 0)
                            except (TypeError, ValueError):
                                hs = 0
                            if hs > 0:
                                rows.append({"team_id": tid, "username": username, "full_name": fullname, "dia": day, "dia_semana": dow, "horas_plan": hs, "project_key": project_key, "issue_key": "", "tipo_registro": "PLANIFICADO", "time_spent_seconds": 0, "horas_usadas": 0, "worklog_count": 0, "fecha_carga": now})
                    else:
                        try:
                            hs = max(float(hours), 0)
                        except (TypeError, ValueError):
                            hs = 0
                        rows.append({"team_id": tid, "username": username, "full_name": fullname, "dia": day, "dia_semana": dow, "horas_plan": hs, "project_key": None, "issue_key": "", "tipo_registro": "PLANIFICADO", "time_spent_seconds": 0, "horas_usadas": 0, "worklog_count": 0, "fecha_carga": now})
            time.sleep(0.2)
        except Exception as exc:
            log.warning("Workload equipo %s: %s", equipo.get("nombre"), exc)
    conn.execute("DELETE FROM at_workload WHERE COALESCE(tipo_registro, 'PLANIFICADO') = 'PLANIFICADO' AND dia >= ? AND dia <= ?", (start, end))
    conn.commit()
    log_etl(conn, modo, "at_workload", upsert(conn, "at_workload", rows), detalle=f"{start} a {end}")


def extraer_at_capacity(at, conn, equipos, modo, full=False):
    log.info("AT capacity...")
    now = now_iso()
    start, end = rango_at(full)
    rows = []
    for equipo in equipos:
        tid = equipo["team_id"]
        try:
            data = at.get("capacity", params={"teamId": tid, "start": start, "end": end, "maxUsers": 50})
            for member in data.get("members", []) if isinstance(data, dict) else []:
                for item in member.get("capacity", []) or []:
                    rows.append({
                        "team_id": tid,
                        "username": member.get("username", ""),
                        "full_name": member.get("userRealName", ""),
                        "dia": item.get("day", ""),
                        "dia_semana": item.get("dayOfWeek", ""),
                        "horas_cap": float(item.get("hours") or 0),
                        "capacidad_origen": "AT_CAPACITY",
                        "fecha_carga": now,
                    })
            time.sleep(0.2)
        except Exception as exc:
            log.warning("Capacity equipo %s: %s", equipo.get("nombre"), exc)
    conn.execute("DELETE FROM at_capacity WHERE dia >= ? AND dia <= ?", (start, end))
    conn.commit()
    log_etl(conn, modo, "at_capacity", upsert(conn, "at_capacity", rows), detalle=f"{start} a {end}")


def extraer_at_eventos(at, conn, equipos, modo, full=False):
    log.info("AT eventos...")
    now = now_iso()
    start, end = rango_at(full)
    rows = []
    for equipo in equipos:
        tid = equipo["team_id"]
        try:
            data = at.get("timeline", params={"teamId": tid, "start": start, "end": end})
            for member in data.get("members", []) if isinstance(data, dict) else []:
                username = member.get("username", "")
                for item in member.get("issues", []) or []:
                    if not item.get("id"):
                        continue
                    issue_type = item.get("issueType", "")
                    rows.append({
                        "evento_id": str(item.get("id")),
                        "username": username,
                        "team_id": tid,
                        "project_key": item.get("projectKey", ""),
                        "issue_key": item.get("issueKey", ""),
                        "issue_id": str(item.get("issueId", "") or ""),
                        "issue_type": issue_type,
                        "event_type": issue_type,
                        "summary": item.get("summary", "")[:300],
                        "planned_start": item.get("plannedStart", ""),
                        "planned_end": item.get("plannedEnd", ""),
                        "orig_estimate": seg_a_hs(item.get("originalTimeEstimate")),
                        "rem_estimate": seg_a_hs(item.get("remainingTimeEstimate")),
                        "daily_time_estimate": seg_a_hs(item.get("dailyTimeEstimate") if item.get("dailyTimeEstimate") is not None else item.get("originalTimeEstimate")),
                        "estimate_per_work_day": seg_a_hs(item.get("estimatePerWorkDay")),
                        "approved_by": item.get("approvedBy", ""),
                        "extra_link": item.get("extraLink", ""),
                        "color": item.get("color", ""),
                        "fecha_carga": now,
                    })
            time.sleep(0.2)
        except Exception as exc:
            log.warning("Eventos equipo %s: %s", equipo.get("nombre"), exc)
    conn.execute("DELETE FROM at_eventos WHERE planned_start >= ? AND planned_start <= ?", (start, end))
    conn.commit()
    log_etl(conn, modo, "at_eventos", upsert(conn, "at_eventos", rows), detalle=f"{start} a {end}")


def extraer_at_worklogs(at, conn, modo, full=False):
    log.info("AT worklogs reales...")
    now = now_iso()
    start, end = rango_at(full)
    users = [r[0] for r in conn.execute("SELECT username FROM at_usuarios WHERE username IS NOT NULL AND username != '' ORDER BY username").fetchall()]
    rows = []
    for i, username in enumerate(users, start=1):
        try:
            data = at.get(f"timeline/{quote(username, safe='')}", params={"start": start, "end": end, "eventType": "WORKLOG"})
            for item in data.get("issues", []) if isinstance(data, dict) else []:
                seconds = int(item.get("timeSpent") or 0)
                rows.append({
                    "team_id": None,
                    "username": item.get("username") or username,
                    "full_name": None,
                    "dia": (item.get("date") or "")[:10],
                    "dia_semana": None,
                    "horas_plan": 0,
                    "project_key": item.get("projectKey", ""),
                    "issue_key": item.get("issueKey", ""),
                    "tipo_registro": "WORKLOG",
                    "time_spent_seconds": seconds,
                    "horas_usadas": seg_a_hs(seconds),
                    "worklog_count": 1,
                    "fecha_carga": now,
                })
        except Exception as exc:
            log.warning("Worklogs AT usuario %s: %s", username, exc)
        if i % 10 == 0:
            log.info("%s/%s usuarios AT consultados", i, len(users))
    conn.execute("DELETE FROM at_workload WHERE tipo_registro = 'WORKLOG' AND dia >= ? AND dia <= ?", (start, end))
    conn.commit()
    log_etl(conn, modo, "at_workload_worklogs", upsert(conn, "at_workload", rows), detalle=f"{start} a {end}")


def refrescar_vistas_at(conn):
    log.info("Refrescando vistas AT...")
    for name in [
        "FACT_CAPACIDAD", "RPT_CAPACIDAD_SEMANA", "AT_WORKLOAD_RESUMEN_DIARIO",
        "RPT_AT_HORAS_PERSONA_TIPO", "RPT_AT_HORAS_USADAS_EVENTO",
        "RPT_AT_EVENTOS_DETALLE_HORAS", "RPT_AT_HORAS_PERSONA_TIPO_PERIODO",
        "RPT_AT_HORAS_EQUIPO_TIPO_PERIODO",
    ]:
        conn.execute(f"DROP VIEW IF EXISTS {name}")
    conn.execute("DROP TABLE IF EXISTS at_availability")
    conn.commit()
    conn.execute("""
        CREATE VIEW RPT_AT_EVENTOS_DETALLE_HORAS AS
        SELECT
            e.evento_id,
            date(COALESCE(NULLIF(e.planned_start, ''), NULLIF(e.planned_end, ''))) AS fecha,
            e.username,
            COALESCE(u.full_name, e.username) AS persona,
            e.team_id,
            COALESCE(eq.nombre, e.team_id, 'Sin equipo') AS equipo,
            e.project_key,
            COALESCE(NULLIF(e.event_type, ''), 'Sin tipo') AS event_type,
            e.issue_key,
            e.issue_id,
            e.issue_type,
            e.summary,
            e.planned_start,
            e.planned_end,
            ROUND(COALESCE(e.daily_time_estimate, e.orig_estimate, 0), 2) AS horas_at,
            ROUND(COALESCE(e.orig_estimate, 0), 2) AS horas_estimadas_originales,
            ROUND(COALESCE(e.rem_estimate, 0), 2) AS horas_restantes,
            1 AS eventos
        FROM at_eventos e
        LEFT JOIN at_usuarios u ON u.username = e.username
        LEFT JOIN at_equipos eq ON eq.team_id = e.team_id
    """)
    conn.execute("""
        CREATE VIEW RPT_AT_HORAS_PERSONA_TIPO_PERIODO AS
        SELECT fecha, username, persona, team_id, equipo, project_key, event_type,
               ROUND(SUM(horas_at), 2) AS horas_at,
               COUNT(*) AS eventos
        FROM RPT_AT_EVENTOS_DETALLE_HORAS
        GROUP BY fecha, username, persona, team_id, equipo, project_key, event_type
    """)
    conn.execute("""
        CREATE VIEW RPT_AT_HORAS_EQUIPO_TIPO_PERIODO AS
        SELECT fecha, team_id, equipo, project_key, event_type,
               ROUND(SUM(horas_at), 2) AS horas_at,
               COUNT(*) AS eventos,
               COUNT(DISTINCT username) AS personas
        FROM RPT_AT_EVENTOS_DETALLE_HORAS
        GROUP BY fecha, team_id, equipo, project_key, event_type
    """)
    conn.commit()


def validar_modelo_at(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type = 'table'").fetchall()}
    views = {r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type = 'view'").fetchall()}
    errors = []
    required_tables = {"at_equipos", "at_usuarios", "at_workload", "at_capacity", "at_eventos", "map_at_equipo_proyecto", "map_persona_fuentes"}
    required_views = {"RPT_AT_EVENTOS_DETALLE_HORAS", "RPT_AT_HORAS_PERSONA_TIPO_PERIODO", "RPT_AT_HORAS_EQUIPO_TIPO_PERIODO"}
    forbidden_views = {"FACT_CAPACIDAD", "RPT_CAPACIDAD_SEMANA", "AT_WORKLOAD_RESUMEN_DIARIO", "RPT_AT_HORAS_PERSONA_TIPO", "RPT_AT_HORAS_USADAS_EVENTO"}
    if required_tables - tables:
        errors.append("Faltan tablas: " + ", ".join(sorted(required_tables - tables)))
    if required_views - views:
        errors.append("Faltan vistas: " + ", ".join(sorted(required_views - views)))
    if "at_availability" in tables:
        errors.append("Sigue existiendo tabla legada: at_availability")
    if forbidden_views & views:
        errors.append("Siguen vistas legadas: " + ", ".join(sorted(forbidden_views & views)))
    required_columns = {
        "at_workload": {"issue_key", "tipo_registro", "time_spent_seconds", "horas_usadas", "worklog_count"},
        "at_capacity": {"capacidad_origen"},
        "at_eventos": {"project_key", "issue_id", "issue_type", "daily_time_estimate", "estimate_per_work_day", "approved_by", "extra_link", "color"},
    }
    for table, columns in required_columns.items():
        missing = columns - table_columns(conn, table)
        if missing:
            errors.append(f"Faltan columnas en {table}: " + ", ".join(sorted(missing)))
    if errors:
        for error in errors:
            log.error(error)
        raise RuntimeError("Modelo AT incompleto")
    log.info("Modelo AT validado")


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
    for table in [
        "rpt_proyectos", "rpt_sprints", "rpt_epicas", "rpt_issues", "rpt_worklogs",
        "at_equipos", "at_usuarios", "at_workload", "at_capacity", "at_eventos",
        "map_at_equipo_proyecto", "map_persona_fuentes",
    ]:
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            log.info("%-28s %8s", table, n)
        except Exception as exc:
            log.info("%-28s error: %s", table, exc)


def main():
    parser = argparse.ArgumentParser(description="ETL principal Jira + ActivityTimeline -> Turso")
    parser.add_argument("--solo-conexion", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--desde", type=str, default=None)
    parser.add_argument("--sin-worklogs", action="store_true")
    parser.add_argument("--sin-jsm", action="store_true")
    parser.add_argument("--sin-at", action="store_true")
    args = parser.parse_args()

    modo = "full" if args.full else (f"desde-{args.desde}" if args.desde else "incremental")
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
        crear_tablas(conn)
        project_keys = PROJECTS if PROJECTS else extraer_proyectos(jira, conn, modo)
        if not project_keys:
            log.warning("No hay proyectos configurados/visibles")
            return
        extraer_proyectos(jira, conn, modo)
        extraer_catalogos_jira(jira, conn, project_keys, modo)
        extraer_sprints_epicas(jira, conn, project_keys, modo)
        if args.full:
            conn.execute("DELETE FROM rpt_etl_log WHERE tabla IN ('rpt_issues','rpt_worklogs')")
            conn.commit()
        extraer_issues(jira, conn, project_keys, modo, desde=None if args.full else args.desde)
        if not args.sin_worklogs:
            extraer_worklogs_jira(jira, conn, modo, full=args.full)
        if not args.sin_jsm:
            extraer_jsm(jira, conn, modo)
        if at:
            equipos = extraer_at_equipos(at, conn, modo)
            extraer_at_usuarios(at, conn, modo)
            if equipos:
                extraer_at_workload(at, conn, equipos, modo, full=args.full)
                extraer_at_capacity(at, conn, equipos, modo, full=args.full)
                extraer_at_eventos(at, conn, equipos, modo, full=args.full)
                extraer_at_worklogs(at, conn, modo, full=args.full)
                refrescar_vistas_at(conn)
                validar_modelo_at(conn)
        mostrar_resumen(conn)
        log.info("ETL completado en %ss", round(time.time() - inicio, 1))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
