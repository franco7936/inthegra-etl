"""
ETL incremental: Jira API + ActivityTimeline API → SQLite
Primera ejecucion: trae todo el historial completo.
Ejecuciones siguientes: solo trae lo modificado desde la ultima carga.

Uso:
    python etl.py                    # incremental automatico
    python etl.py --full             # fuerza carga completa
    python etl.py --desde 2025-01-01 # desde una fecha especifica
    python etl.py --solo-conexion    # solo verifica conexion
    python etl.py --sin-jsm          # omite tickets de soporte
    python etl.py --sin-worklogs     # omite horas de Jira
    python etl.py --sin-at           # omite ActivityTimeline
"""

import os
import sys
import time
import logging
import argparse
from turso_conn import TursoConn, conectar_turso
from datetime import datetime, timezone, timedelta

import requests
import pandas as pd
from dotenv import load_dotenv

# ── CONFIG ────────────────────────────────────────────────────────────────────
load_dotenv()

JIRA_BASE  = os.getenv("JIRA_BASE_URL", "").rstrip("/")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "")
JIRA_TOKEN = os.getenv("JIRA_API_TOKEN", "")
PROJECTS   = [p.strip() for p in os.getenv("JIRA_PROJECTS", "").split(",") if p.strip()]
TURSO_URL   = os.getenv("TURSO_URL", "").replace("libsql://", "https://")
TURSO_TOKEN = os.getenv("TURSO_TOKEN", "")

AT_BASE    = os.getenv("AT_BASE_URL", JIRA_BASE).rstrip("/")
AT_TOKEN   = os.getenv("AT_TOKEN", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("jira_etl")

# ── CLIENTE JIRA ──────────────────────────────────────────────────────────────
class JiraClient:
    def __init__(self):
        if not all([JIRA_BASE, JIRA_EMAIL, JIRA_TOKEN]):
            raise ValueError("Faltan JIRA_BASE_URL, JIRA_EMAIL o JIRA_API_TOKEN en .env")
        self.session = requests.Session()
        self.session.auth = (JIRA_EMAIL, JIRA_TOKEN)
        self.session.headers.update({"Accept": "application/json"})

    def get(self, path: str, params: dict = None, api: str = "platform") -> dict:
        bases = {
            "platform": f"{JIRA_BASE}/rest/api/3",
            "agile":    f"{JIRA_BASE}/rest/agile/1.0",
            "jsm":      f"{JIRA_BASE}/rest/servicedeskapi",
        }
        url = f"{bases[api]}/{path.lstrip('/')}"
        try:
            resp = self.session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.HTTPError:
            log.error(f"HTTP {resp.status_code} en {url}: {resp.text[:300]}")
            raise
        except requests.exceptions.ConnectionError:
            log.error(f"No se pudo conectar a {url}.")
            raise

    def paginar(self, path: str, params: dict = None, api: str = "platform",
                key_valores: str = "issues", max_items: int = 50000) -> list:
        params    = params or {}
        es_jsm    = (api == "jsm")
        key_start = "start"  if es_jsm else "startAt"
        key_limit = "limit"  if es_jsm else "maxResults"

        params[key_limit] = 100
        params[key_start] = 0
        todos = []

        while True:
            data  = self.get(path, params, api)
            items = data.get(key_valores, data.get("values", []))
            todos.extend(items)

            es_ultima = data.get("isLast", data.get("isLastPage", False))
            total     = data.get("total", 0)

            if es_jsm and es_ultima:
                break
            if not es_jsm and (len(todos) >= total or not items):
                break
            if len(todos) >= max_items:
                log.warning(f"Limite {max_items} en {path}")
                break

            params[key_start] += len(items)
            time.sleep(0.2)

        return todos


# ── CLIENTE ACTIVITY TIMELINE ─────────────────────────────────────────────────
class ATClient:
    def __init__(self):
        if not AT_TOKEN:
            raise ValueError("Falta AT_TOKEN en .env")
        self.session = requests.Session()
        self.session.headers.update({
            "auth-token": AT_TOKEN,
            "Accept":     "application/json",
        })
        self.base = f"{AT_BASE}/rest/api/1"

    def get(self, path: str, params: dict = None) -> any:
        url = f"{self.base}/{path.lstrip('/')}"
        try:
            resp = self.session.get(url, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.HTTPError:
            log.error(f"AT HTTP {resp.status_code} en {url}: {resp.text[:300]}")
            raise

    def get_paginado(self, path: str, params: dict = None,
                     offset_key: str = "startOffset", max_items: int = 5000) -> list:
        """Para endpoints que paginan con startOffset (users, projects)."""
        params    = params or {}
        todos     = []
        params[offset_key] = 0

        while True:
            data = self.get(path, params)
            if not isinstance(data, list):
                # Algunos endpoints devuelven objeto con members
                data = data.get("members", [data]) if isinstance(data, dict) else [data]
            todos.extend(data)
            if len(data) < 100 or len(todos) >= max_items:
                break
            params[offset_key] += len(data)
            time.sleep(0.2)

        return todos


# ── BASE DE DATOS ─────────────────────────────────────────────────────────────
def crear_tablas(conn: TursoConn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS rpt_proyectos (
            project_key  TEXT PRIMARY KEY,
            nombre       TEXT,
            tipo         TEXT,
            lead         TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_versiones (
            id           TEXT PRIMARY KEY,
            project_key  TEXT,
            nombre       TEXT,
            descripcion  TEXT,
            released     INTEGER,
            release_date TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_componentes (
            id           TEXT PRIMARY KEY,
            project_key  TEXT,
            nombre       TEXT,
            descripcion  TEXT,
            lead         TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_sprints (
            sprint_id    INTEGER PRIMARY KEY,
            sprint_name  TEXT,
            project_key  TEXT,
            board_id     INTEGER,
            state        TEXT,
            start_date   TEXT,
            end_date     TEXT,
            goal         TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_epicas (
            epic_key     TEXT PRIMARY KEY,
            project_key  TEXT,
            board_id     INTEGER,
            nombre       TEXT,
            summary      TEXT,
            status       TEXT,
            done         INTEGER,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_issues (
            issue_key            TEXT PRIMARY KEY,
            sprint_id            INTEGER,
            epic_key             TEXT,
            project_key          TEXT,
            issue_type           TEXT,
            status               TEXT,
            status_category      TEXT,
            priority             TEXT,
            assignee_id          TEXT,
            assignee_name        TEXT,
            reporter_name        TEXT,
            summary              TEXT,
            estimado_hs          REAL,
            restante_hs          REAL,
            estimado_total_hs    REAL,
            restante_total_hs    REAL,
            version_fix          TEXT,
            componentes          TEXT,
            cant_comentarios     INTEGER,
            cant_subtareas       INTEGER,
            cant_links           INTEGER,
            cant_watchers        INTEGER,
            created_date         TEXT,
            updated_date         TEXT,
            resolved_date        TEXT,
            fecha_carga          TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_issue_links (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key         TEXT,
            link_type         TEXT,
            direccion         TEXT,
            issue_relacionado TEXT,
            fecha_carga       TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_changelog (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key    TEXT,
            project_key  TEXT,
            autor_id     TEXT,
            autor_nombre TEXT,
            fecha_cambio TEXT,
            campo        TEXT,
            valor_desde  TEXT,
            valor_hasta  TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_comentarios (
            comentario_id  TEXT PRIMARY KEY,
            issue_key      TEXT,
            project_key    TEXT,
            autor_id       TEXT,
            autor_nombre   TEXT,
            fecha          TEXT,
            cuerpo_preview TEXT,
            fecha_carga    TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_worklogs (
            worklog_id   TEXT PRIMARY KEY,
            issue_key    TEXT,
            project_key  TEXT,
            user_id      TEXT,
            user_name    TEXT,
            date_worked  TEXT,
            hours_logged REAL,
            comentario   TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_jsm_tickets (
            issue_key       TEXT PRIMARY KEY,
            service_desk_id TEXT,
            request_type    TEXT,
            status          TEXT,
            prioridad       TEXT,
            reporter_id     TEXT,
            reporter_name   TEXT,
            summary         TEXT,
            created_date    TEXT,
            resolved_date   TEXT,
            fecha_carga     TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_jsm_slas (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key       TEXT,
            sla_nombre      TEXT,
            completado      INTEGER,
            breached        INTEGER,
            tiempo_objetivo TEXT,
            tiempo_real     TEXT,
            fecha_carga     TEXT
        );

        -- ── ACTIVITY TIMELINE ─────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS at_equipos (
            team_id      TEXT PRIMARY KEY,
            nombre       TEXT,
            team_type    TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS at_usuarios (
            username     TEXT PRIMARY KEY,
            full_name    TEXT,
            email        TEXT,
            posicion     TEXT,
            involvement  REAL,
            enabled      INTEGER,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS at_workload (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id      TEXT,
            username     TEXT,
            full_name    TEXT,
            dia          TEXT,
            dia_semana   TEXT,
            horas_plan   REAL,
            project_key  TEXT,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS at_availability (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id      TEXT,
            username     TEXT,
            full_name    TEXT,
            dia          TEXT,
            dia_semana   TEXT,
            horas_disp   REAL,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS at_capacity (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            team_id      TEXT,
            username     TEXT,
            full_name    TEXT,
            dia          TEXT,
            dia_semana   TEXT,
            horas_cap    REAL,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS at_eventos (
            evento_id    TEXT PRIMARY KEY,
            username     TEXT,
            team_id      TEXT,
            issue_key    TEXT,
            event_type   TEXT,
            summary      TEXT,
            planned_start TEXT,
            planned_end   TEXT,
            orig_estimate REAL,
            rem_estimate  REAL,
            fecha_carga  TEXT
        );

        CREATE TABLE IF NOT EXISTS rpt_etl_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha      TEXT,
            modo       TEXT,
            tabla      TEXT,
            registros  INTEGER,
            estado     TEXT,
            detalle    TEXT
        );
    """)
    conn.commit()
    log.info("✓ Schema verificado en SQLite")


def upsert(conn: TursoConn, tabla: str, df: pd.DataFrame):
    if df.empty:
        log.info(f"  Sin datos para {tabla}.")
        return 0
    n = conn.to_sql_df(df, tabla, if_exists="append", chunksize=50)
    log.info(f"  ✓ {tabla}: {n} registros")
    return n


def insertar_append(conn: TursoConn, tabla: str, df: pd.DataFrame):
    if df.empty:
        return 0
    n = conn.to_sql_df(df, tabla, if_exists="append", chunksize=50)
    log.info(f"  ✓ {tabla}: {n} registros (append)")
    return n


def log_etl(conn, modo, tabla, n, estado, detalle=""):
    conn.execute(
        "INSERT INTO rpt_etl_log (fecha,modo,tabla,registros,estado,detalle) VALUES (?,?,?,?,?,?)",
        (datetime.now(timezone.utc).isoformat(), modo, tabla, n, estado, detalle)
    )
    conn.commit()


def seg_a_hs(s):
    return round(s / 3600, 2) if s is not None else None


def ultima_carga(conn: TursoConn, tabla: str):
    try:
        row = conn.execute(
            "SELECT MAX(fecha) FROM rpt_etl_log WHERE tabla=? AND estado='OK'", (tabla,)
        ).fetchone()
        return row[0] if row and row[0] else None
    except Exception:
        return None


# ── EXTRACTORES JIRA ──────────────────────────────────────────────────────────
def extraer_proyectos(client: JiraClient, conn: TursoConn, modo: str):
    log.info("→ Proyectos Jira...")
    now = datetime.now(timezone.utc).isoformat()
    try:
        items = client.paginar("project/search", key_valores="values")
        if not items:
            data  = client.get("project")
            items = data if isinstance(data, list) else []
        rows = [{
            "project_key": p.get("key"),
            "nombre":      p.get("name"),
            "tipo":        p.get("projectTypeKey"),
            "lead":        (p.get("lead") or {}).get("displayName"),
            "fecha_carga": now,
        } for p in items]
        n = upsert(conn, "rpt_proyectos", pd.DataFrame(rows))
        log_etl(conn, modo, "rpt_proyectos", n, "OK")
        return [r["project_key"] for r in rows]
    except Exception as e:
        log.error(f"Error proyectos: {e}")
        log_etl(conn, modo, "rpt_proyectos", 0, "ERROR", str(e))
        return []


def extraer_versiones(client: JiraClient, conn: TursoConn,
                      project_keys: list, modo: str):
    log.info("→ Versiones...")
    now  = datetime.now(timezone.utc).isoformat()
    rows = []
    for pk in project_keys:
        try:
            for v in (client.get(f"project/{pk}/versions") or []):
                rows.append({
                    "id": str(v.get("id")), "project_key": pk,
                    "nombre": v.get("name"), "descripcion": v.get("description", ""),
                    "released": 1 if v.get("released") else 0,
                    "release_date": v.get("releaseDate"), "fecha_carga": now,
                })
        except Exception as e:
            log.warning(f"  Versiones {pk}: {e}")
    n = upsert(conn, "rpt_versiones", pd.DataFrame(rows))
    log_etl(conn, modo, "rpt_versiones", n, "OK")


def extraer_componentes(client: JiraClient, conn: TursoConn,
                        project_keys: list, modo: str):
    log.info("→ Componentes...")
    now  = datetime.now(timezone.utc).isoformat()
    rows = []
    for pk in project_keys:
        try:
            for c in (client.get(f"project/{pk}/components") or []):
                rows.append({
                    "id": str(c.get("id")), "project_key": pk,
                    "nombre": c.get("name"), "descripcion": c.get("description", ""),
                    "lead": (c.get("lead") or {}).get("displayName"), "fecha_carga": now,
                })
        except Exception as e:
            log.warning(f"  Componentes {pk}: {e}")
    n = upsert(conn, "rpt_componentes", pd.DataFrame(rows))
    log_etl(conn, modo, "rpt_componentes", n, "OK")


def extraer_boards_y_sprints(client: JiraClient, conn: TursoConn,
                              project_keys: list, modo: str):
    log.info("→ Sprints...")
    sprints_map = {}
    boards_map  = {}
    rows        = []
    now         = datetime.now(timezone.utc).isoformat()

    for pk in project_keys:
        try:
            boards = client.paginar("board", params={"projectKeyOrId": pk, "type": "scrum"},
                                    api="agile", key_valores="values")
            for board in boards:
                bid = board["id"]
                boards_map.setdefault(pk, []).append(bid)
                try:
                    for s in client.paginar(f"board/{bid}/sprint",
                                            params={"state": "active,closed"},
                                            api="agile", key_valores="values"):
                        sid = s["id"]
                        sprints_map[sid] = {"sprint": s, "board_id": bid, "project_key": pk}
                        rows.append({
                            "sprint_id": sid, "sprint_name": s.get("name"),
                            "project_key": pk, "board_id": bid,
                            "state": s.get("state"), "start_date": s.get("startDate"),
                            "end_date": s.get("endDate"), "goal": s.get("goal", ""),
                            "fecha_carga": now,
                        })
                except Exception as e:
                    log.warning(f"  Board {bid}: {e}")
        except Exception as e:
            log.warning(f"  Proyecto {pk}: {e}")

    log.info(f"  {len(rows)} sprints")
    n = upsert(conn, "rpt_sprints", pd.DataFrame(rows))
    log_etl(conn, modo, "rpt_sprints", n, "OK")
    return sprints_map, boards_map


def extraer_epicas(client: JiraClient, conn: TursoConn,
                   boards_map: dict, modo: str):
    log.info("→ Epicas...")
    now  = datetime.now(timezone.utc).isoformat()
    rows = []
    for pk, board_ids in boards_map.items():
        for bid in board_ids:
            try:
                for e in client.paginar(f"board/{bid}/epic", api="agile", key_valores="values"):
                    rows.append({
                        "epic_key": e.get("key"), "project_key": pk, "board_id": bid,
                        "nombre": e.get("name", ""), "summary": e.get("summary", ""),
                        "status": (e.get("status") or {}).get("name", ""),
                        "done": 1 if e.get("done") else 0, "fecha_carga": now,
                    })
            except Exception as e:
                log.warning(f"  Epicas board {bid}: {e}")
    log.info(f"  {len(rows)} epicas")
    n = upsert(conn, "rpt_epicas", pd.DataFrame(rows))
    log_etl(conn, modo, "rpt_epicas", n, "OK")


def extraer_issues(client: JiraClient, conn: TursoConn,
                   project_keys: list, modo: str, desde: str = None):
    log.info("→ Issues...")
    now = datetime.now(timezone.utc).isoformat()
    pks = ",".join(project_keys)
    fields = [
        "summary", "status", "issuetype", "assignee", "reporter",
        "priority", "created", "updated", "resolutiondate",
        "customfield_10020", "customfield_10014",
        "timeoriginalestimate", "timeestimate",
        "aggregatetimeoriginalestimate", "aggregatetimeestimate",
        "fixVersions", "components", "comment", "subtasks", "issuelinks", "watches",
    ]

    if desde:
        jql = f"project in ({pks}) AND updated >= '{desde}' ORDER BY updated ASC"
        modo_desc = f"incremental forzado desde {desde}"
    else:
        uc = ultima_carga(conn, "rpt_issues")
        if uc:
            jql = f"project in ({pks}) AND updated >= '{uc[:10]}' ORDER BY updated ASC"
            modo_desc = f"incremental desde {uc[:10]}"
        else:
            jql = f"project in ({pks}) ORDER BY created ASC"
            modo_desc = "carga inicial completa"

    log.info(f"  Modo: {modo_desc}")

    try:
        issues = client.paginar("search/jql",
                                params={"jql": jql, "fields": ",".join(fields), "expand": "changelog"},
                                key_valores="issues")
        log.info(f"  {len(issues)} issues")

        rows_i  = []
        rows_cl = []
        rows_lk = []
        rows_cm = []

        for iss in issues:
            f   = iss.get("fields", {})
            key = iss.get("key", "")
            pk  = key.split("-")[0]

            sprint_id  = None
            sprint_raw = f.get("customfield_10020")
            if isinstance(sprint_raw, list) and sprint_raw:
                sprint_id = sprint_raw[-1].get("id")
            elif isinstance(sprint_raw, dict):
                sprint_id = sprint_raw.get("id")

            versions    = f.get("fixVersions") or []
            comps       = f.get("components") or []

            rows_i.append({
                "issue_key": key, "sprint_id": sprint_id,
                "epic_key": f.get("customfield_10014"), "project_key": pk,
                "issue_type": (f.get("issuetype") or {}).get("name"),
                "status": (f.get("status") or {}).get("name"),
                "status_category": ((f.get("status") or {}).get("statusCategory") or {}).get("name"),
                "priority": (f.get("priority") or {}).get("name"),
                "assignee_id": (f.get("assignee") or {}).get("accountId"),
                "assignee_name": (f.get("assignee") or {}).get("displayName"),
                "reporter_name": (f.get("reporter") or {}).get("displayName"),
                "summary": f.get("summary", "")[:500],
                "estimado_hs": seg_a_hs(f.get("timeoriginalestimate")),
                "restante_hs": seg_a_hs(f.get("timeestimate")),
                "estimado_total_hs": seg_a_hs(f.get("aggregatetimeoriginalestimate")),
                "restante_total_hs": seg_a_hs(f.get("aggregatetimeestimate")),
                "version_fix": ", ".join([v.get("name","") for v in versions]) or None,
                "componentes": ", ".join([c.get("name","") for c in comps]) or None,
                "cant_comentarios": (f.get("comment") or {}).get("total", 0),
                "cant_subtareas": len(f.get("subtasks") or []),
                "cant_links": len(f.get("issuelinks") or []),
                "cant_watchers": (f.get("watches") or {}).get("watchCount", 0),
                "created_date": f.get("created"), "updated_date": f.get("updated"),
                "resolved_date": f.get("resolutiondate"), "fecha_carga": now,
            })

            for h in (iss.get("changelog") or {}).get("histories", []):
                autor = h.get("author", {})
                for item in h.get("items", []):
                    if item.get("field") in ("status","assignee","priority","sprint",
                                             "Fix Version","resolution","Flagged"):
                        rows_cl.append({
                            "issue_key": key, "project_key": pk,
                            "autor_id": autor.get("accountId"),
                            "autor_nombre": autor.get("displayName"),
                            "fecha_cambio": h.get("created"),
                            "campo": item.get("field"),
                            "valor_desde": item.get("fromString",""),
                            "valor_hasta": item.get("toString",""),
                            "fecha_carga": now,
                        })

            for link in (f.get("issuelinks") or []):
                tipo = (link.get("type") or {}).get("name","")
                if link.get("inwardIssue"):
                    rows_lk.append({"issue_key": key, "link_type": tipo,
                                    "direccion": "inward",
                                    "issue_relacionado": link["inwardIssue"].get("key"),
                                    "fecha_carga": now})
                if link.get("outwardIssue"):
                    rows_lk.append({"issue_key": key, "link_type": tipo,
                                    "direccion": "outward",
                                    "issue_relacionado": link["outwardIssue"].get("key"),
                                    "fecha_carga": now})

            for c in (f.get("comment") or {}).get("comments", []):
                cuerpo = c.get("body","")
                rows_cm.append({
                    "comentario_id": str(c.get("id")),
                    "issue_key": key, "project_key": pk,
                    "autor_id": (c.get("author") or {}).get("accountId"),
                    "autor_nombre": (c.get("author") or {}).get("displayName"),
                    "fecha": c.get("created"),
                    "cuerpo_preview": (cuerpo[:200] if isinstance(cuerpo, str) else ""),
                    "fecha_carga": now,
                })

        n_i = upsert(conn, "rpt_issues", pd.DataFrame(rows_i))
        log_etl(conn, modo, "rpt_issues", n_i, "OK", modo_desc)

        if rows_cl:
            iks = ",".join([f"'{r['issue_key']}'" for r in rows_i])
            conn.execute(f"DELETE FROM rpt_changelog WHERE issue_key IN ({iks})")
            conn.commit()
            insertar_append(conn, "rpt_changelog", pd.DataFrame(rows_cl))
            log_etl(conn, modo, "rpt_changelog", len(rows_cl), "OK")

        if rows_lk:
            conn.execute(f"DELETE FROM rpt_issue_links WHERE issue_key IN ({iks})")
            conn.commit()
            insertar_append(conn, "rpt_issue_links", pd.DataFrame(rows_lk))
            log_etl(conn, modo, "rpt_issue_links", len(rows_lk), "OK")

        if rows_cm:
            upsert(conn, "rpt_comentarios", pd.DataFrame(rows_cm))
            log_etl(conn, modo, "rpt_comentarios", len(rows_cm), "OK")

        return [r["issue_key"] for r in rows_i]

    except Exception as e:
        log.error(f"Error issues: {e}")
        log_etl(conn, modo, "rpt_issues", 0, "ERROR", str(e))
        return []


def extraer_worklogs(client: JiraClient, conn: TursoConn,
                     modo: str, full: bool = False):
    log.info("→ Worklogs Jira...")
    now = datetime.now(timezone.utc).isoformat()
    try:
        if full:
            since_ms = int(time.time() * 1000) - (365 * 24 * 3600 * 1000)
            log.info("  Modo: completo (365 dias)")
        else:
            uc = ultima_carga(conn, "rpt_worklogs")
            if uc:
                from datetime import datetime as dt
                fecha_uc = dt.fromisoformat(uc.replace("Z", "+00:00"))
                since_ms = int(fecha_uc.timestamp() * 1000)
                log.info(f"  Modo: incremental desde {uc[:10]}")
            else:
                since_ms = int(time.time() * 1000) - (365 * 24 * 3600 * 1000)
                log.info("  Modo: primera carga (365 dias)")

        data        = client.get("worklog/updated", params={"since": since_ms})
        worklog_ids = [str(w["worklogId"]) for w in data.get("values", [])]

        if not worklog_ids:
            log.info("  Sin worklogs nuevos.")
            log_etl(conn, modo, "rpt_worklogs", 0, "OK", "sin cambios")
            return

        log.info(f"  {len(worklog_ids)} worklogs")
        rows = []
        for i in range(0, len(worklog_ids), 1000):
            lote = worklog_ids[i:i+1000]
            resp = client.session.post(
                f"{JIRA_BASE}/rest/api/3/worklog/list",
                json={"ids": [int(x) for x in lote]}, timeout=30
            )
            resp.raise_for_status()
            for w in resp.json():
                issue_key  = w.get("issueId", "")
                comentario = w.get("comment", "")
                rows.append({
                    "worklog_id":   str(w.get("id")),
                    "issue_key":    issue_key,
                    "project_key":  issue_key.split("-")[0] if "-" in issue_key else "",
                    "user_id":      (w.get("author") or {}).get("accountId"),
                    "user_name":    (w.get("author") or {}).get("displayName"),
                    "date_worked":  w.get("started","")[:10],
                    "hours_logged": round((w.get("timeSpentSeconds") or 0) / 3600, 2),
                    "comentario":   comentario[:300] if isinstance(comentario, str) else "",
                    "fecha_carga":  now,
                })
            time.sleep(0.3)

        n = upsert(conn, "rpt_worklogs", pd.DataFrame(rows))
        log_etl(conn, modo, "rpt_worklogs", n, "OK")
    except Exception as e:
        log.error(f"Error worklogs: {e}")
        log_etl(conn, modo, "rpt_worklogs", 0, "ERROR", str(e))


def extraer_jsm(client: JiraClient, conn: TursoConn, modo: str):
    log.info("→ JSM tickets...")
    now = datetime.now(timezone.utc).isoformat()
    try:
        desks = client.paginar("servicedesk", api="jsm", key_valores="values")
        if not desks:
            log.info("  Sin service desks.")
            return

        rows_t = []
        rows_s = []
        for desk in desks:
            did = desk["id"]
            log.info(f"  Desk: {desk.get('projectName')} (id={did})")
            tickets = client.paginar("request",
                                     params={"serviceDeskId": did, "requestStatus": "ALL_REQUESTS"},
                                     api="jsm", key_valores="values")
            log.info(f"    {len(tickets)} tickets")
            for t in tickets:
                ik = t.get("issueKey","")
                rows_t.append({
                    "issue_key": ik, "service_desk_id": str(did),
                    "request_type": (t.get("requestType") or {}).get("name",""),
                    "status": (t.get("currentStatus") or {}).get("status",""),
                    "prioridad": "",
                    "reporter_id": (t.get("reporter") or {}).get("accountId",""),
                    "reporter_name": (t.get("reporter") or {}).get("displayName",""),
                    "summary": t.get("requestFieldValues",[{}])[0].get("value","")[:300]
                               if t.get("requestFieldValues") else "",
                    "created_date": (t.get("createdDate") or {}).get("iso8601",""),
                    "resolved_date": "", "fecha_carga": now,
                })
                try:
                    for sla in client.get(f"request/{ik}/sla", api="jsm").get("values",[]):
                        ongoing = sla.get("ongoingCycle",{})
                        rows_s.append({
                            "issue_key": ik, "sla_nombre": sla.get("name",""),
                            "completado": 1 if sla.get("completedCycles") else 0,
                            "breached": 1 if ongoing.get("breached") else 0,
                            "tiempo_objetivo": (ongoing.get("goalDuration") or {}).get("friendly",""),
                            "tiempo_real": (ongoing.get("elapsedTime") or {}).get("friendly",""),
                            "fecha_carga": now,
                        })
                    time.sleep(0.15)
                except Exception:
                    pass

        upsert(conn, "rpt_jsm_tickets", pd.DataFrame(rows_t))
        log_etl(conn, modo, "rpt_jsm_tickets", len(rows_t), "OK")
        upsert(conn, "rpt_jsm_slas", pd.DataFrame(rows_s))
        log_etl(conn, modo, "rpt_jsm_slas", len(rows_s), "OK")
    except Exception as e:
        log.error(f"Error JSM: {e}")
        log_etl(conn, modo, "rpt_jsm_tickets", 0, "ERROR", str(e))


# ── EXTRACTORES ACTIVITY TIMELINE ─────────────────────────────────────────────
def extraer_at_equipos(at: ATClient, conn: TursoConn, modo: str) -> list:
    """Devuelve lista de equipos [{team_id, nombre, team_type}]"""
    log.info("→ AT equipos...")
    now = datetime.now(timezone.utc).isoformat()
    try:
        data = at.get("team/list")
        rows = [{
            "team_id":    str(t.get("id")),
            "nombre":     t.get("name",""),
            "team_type":  t.get("teamType",""),
            "fecha_carga": now,
        } for t in (data if isinstance(data, list) else [])]
        n = upsert(conn, "at_equipos", pd.DataFrame(rows))
        log_etl(conn, modo, "at_equipos", n, "OK")
        log.info(f"  {n} equipos")
        return rows
    except Exception as e:
        log.error(f"Error AT equipos: {e}")
        log_etl(conn, modo, "at_equipos", 0, "ERROR", str(e))
        return []


def extraer_at_usuarios(at: ATClient, conn: TursoConn, modo: str):
    log.info("→ AT usuarios...")
    now = datetime.now(timezone.utc).isoformat()
    try:
        todos = []
        offset = 0
        while True:
            data = at.get("user", params={"startOffset": offset})
            if not isinstance(data, list) or not data:
                break
            todos.extend(data)
            if len(data) < 100:
                break
            offset += len(data)
            time.sleep(0.2)

        rows = [{
            "username":    u.get("username",""),
            "full_name":   u.get("fullName",""),
            "email":       u.get("email",""),
            "posicion":    (u.get("position") or {}).get("positionNameLong",""),
            "involvement": u.get("involvement"),
            "enabled":     1 if u.get("enabled") else 0,
            "fecha_carga": now,
        } for u in todos if u.get("username")]

        n = upsert(conn, "at_usuarios", pd.DataFrame(rows))
        log_etl(conn, modo, "at_usuarios", n, "OK")
        log.info(f"  {n} usuarios")
    except Exception as e:
        log.error(f"Error AT usuarios: {e}")
        log_etl(conn, modo, "at_usuarios", 0, "ERROR", str(e))


def _rango_semanas(full: bool, semanas: int = 8) -> tuple:
    """Devuelve (start_str, end_str) para el rango de extraccion."""
    hoy    = datetime.now(timezone.utc).date()
    end    = hoy
    if full:
        start = hoy - timedelta(weeks=52)   # 1 año atras en carga completa
    else:
        start = hoy - timedelta(weeks=semanas)  # ultimas N semanas en incremental
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def extraer_at_workload(at: ATClient, conn: TursoConn,
                        equipos: list, modo: str, full: bool = False):
    """
    Extrae workload (horas planificadas) por equipo, usuario y dia.
    Incluye breakdown por proyecto si AT lo soporta.
    """
    log.info("→ AT workload (horas planificadas)...")
    now          = datetime.now(timezone.utc).isoformat()
    start, end   = _rango_semanas(full)
    log.info(f"  Periodo: {start} → {end}")
    rows = []

    for eq in equipos:
        tid  = eq["team_id"]
        tnombre = eq["nombre"]
        try:
            # includeProjectDetails=true da breakdown por proyecto
            data = at.get("workload", params={
                "teamId": tid, "start": start, "end": end,
                "maxUsers": 50, "includeProjectDetails": "true",
            })
            members = data.get("members", []) if isinstance(data, dict) else []
            for m in members:
                uname = m.get("username","")
                fname = m.get("userRealName","")
                for w in (m.get("workload") or []):
                    horas = w.get("hours", 0)
                    dia   = w.get("day","")
                    dow   = w.get("dayOfWeek","")

                    if isinstance(horas, dict):
                        # Breakdown por proyecto
                        for pk, hs in horas.items():
                            try:
                                hs_num = float(hs)
                            except (TypeError, ValueError):
                                hs_num = 0.0
                            if hs_num > 0:
                                rows.append({
                                    "team_id": tid, "username": uname,
                                    "full_name": fname, "dia": dia,
                                    "dia_semana": dow, "horas_plan": hs_num,
                                    "project_key": pk, "fecha_carga": now,
                                })
                    else:
                        # Numero simple (horas < 0 = dia no laborable en AT)
                        try:
                            horas_num = float(horas)
                        except (TypeError, ValueError):
                            horas_num = 0.0
                        hs = max(horas_num, 0)
                        rows.append({
                            "team_id": tid, "username": uname,
                            "full_name": fname, "dia": dia,
                            "dia_semana": dow, "horas_plan": hs,
                            "project_key": None, "fecha_carga": now,
                        })
            time.sleep(0.3)
        except Exception as e:
            log.warning(f"  Workload equipo {tnombre}: {e}")

    # Borrar el periodo y reinsertar (datos planificados pueden cambiar)
    conn.execute("DELETE FROM at_workload WHERE dia >= ? AND dia <= ?", (start, end))
    conn.commit()
    n = insertar_append(conn, "at_workload", pd.DataFrame(rows))
    log_etl(conn, modo, "at_workload", n, "OK", f"{start} a {end}")
    log.info(f"  {n} registros de workload")


def extraer_at_availability(at: ATClient, conn: TursoConn,
                             equipos: list, modo: str, full: bool = False):
    """Extrae disponibilidad real (capacidad libre) por usuario y dia."""
    log.info("→ AT availability (horas disponibles)...")
    now        = datetime.now(timezone.utc).isoformat()
    start, end = _rango_semanas(full)
    rows       = []

    for eq in equipos:
        tid = eq["team_id"]
        try:
            data    = at.get("availability", params={"teamId": tid, "start": start,
                                                      "end": end, "maxUsers": 50})
            members = data.get("members", []) if isinstance(data, dict) else []
            for m in members:
                uname = m.get("username","")
                fname = m.get("userRealName","")
                for a in (m.get("availability") or []):
                    rows.append({
                        "team_id": tid, "username": uname, "full_name": fname,
                        "dia": a.get("day",""), "dia_semana": a.get("dayOfWeek",""),
                        "horas_disp": float(a.get("hours") or 0),
                        "fecha_carga": now,
                    })
            time.sleep(0.3)
        except Exception as e:
            log.warning(f"  Availability equipo {eq['nombre']}: {e}")

    conn.execute("DELETE FROM at_availability WHERE dia >= ? AND dia <= ?", (start, end))
    conn.commit()
    n = insertar_append(conn, "at_availability", pd.DataFrame(rows))
    log_etl(conn, modo, "at_availability", n, "OK", f"{start} a {end}")
    log.info(f"  {n} registros de availability")


def extraer_at_capacity(at: ATClient, conn: TursoConn,
                        equipos: list, modo: str, full: bool = False):
    """Extrae capacidad teorica (sin considerar tareas asignadas)."""
    log.info("→ AT capacity (capacidad teorica)...")
    now        = datetime.now(timezone.utc).isoformat()
    start, end = _rango_semanas(full)
    rows       = []

    for eq in equipos:
        tid = eq["team_id"]
        try:
            data    = at.get("capacity", params={"teamId": tid, "start": start,
                                                  "end": end, "maxUsers": 50})
            members = data.get("members", []) if isinstance(data, dict) else []
            for m in members:
                uname = m.get("username","")
                fname = m.get("userRealName","")
                for c in (m.get("capacity") or []):
                    rows.append({
                        "team_id": tid, "username": uname, "full_name": fname,
                        "dia": c.get("day",""), "dia_semana": c.get("dayOfWeek",""),
                        "horas_cap": float(c.get("hours") or 0),
                        "fecha_carga": now,
                    })
            time.sleep(0.3)
        except Exception as e:
            log.warning(f"  Capacity equipo {eq['nombre']}: {e}")

    conn.execute("DELETE FROM at_capacity WHERE dia >= ? AND dia <= ?", (start, end))
    conn.commit()
    n = insertar_append(conn, "at_capacity", pd.DataFrame(rows))
    log_etl(conn, modo, "at_capacity", n, "OK", f"{start} a {end}")
    log.info(f"  {n} registros de capacity")


def extraer_at_eventos(at: ATClient, conn: TursoConn,
                       equipos: list, modo: str, full: bool = False):
    """
    Extrae eventos del timeline: vacaciones, dias libres, bookings, placeholders.
    Son los eventos NO-issue que afectan la capacidad real del equipo.
    """
    log.info("→ AT eventos (vacaciones, ausencias, bookings)...")
    now        = datetime.now(timezone.utc).isoformat()
    start, end = _rango_semanas(full)
    rows       = []

    # Tipos de eventos que nos interesan para reportes de capacidad
    tipos_no_trabajo = ["DAY_OFF", "HOLIDAY", "SICK_LEAVE", "VACATION"]

    for eq in equipos:
        tid = eq["team_id"]
        try:
            data = at.get("timeline", params={
                "teamId": tid, "start": start, "end": end,
            })
            members = data.get("members", []) if isinstance(data, dict) else []
            for m in members:
                uname = m.get("username","")
                for iss in (m.get("issues") or []):
                    tipo = iss.get("issueType","")
                    rows.append({
                        "evento_id":    str(iss.get("id","")),
                        "username":     uname,
                        "team_id":      tid,
                        "issue_key":    iss.get("issueKey",""),
                        "event_type":   tipo,
                        "summary":      iss.get("summary","")[:300],
                        "planned_start": iss.get("plannedStart",""),
                        "planned_end":   iss.get("plannedEnd",""),
                        "orig_estimate": seg_a_hs(iss.get("originalTimeEstimate")),
                        "rem_estimate":  seg_a_hs(iss.get("remainingTimeEstimate")),
                        "fecha_carga":   now,
                    })
            time.sleep(0.3)
        except Exception as e:
            log.warning(f"  Eventos equipo {eq['nombre']}: {e}")

    conn.execute("DELETE FROM at_eventos WHERE planned_start >= ? AND planned_start <= ?",
                 (start, end))
    conn.commit()
    n = upsert(conn, "at_eventos", pd.DataFrame(rows))
    log_etl(conn, modo, "at_eventos", n, "OK", f"{start} a {end}")
    log.info(f"  {n} eventos")


# ── VERIFICACION ──────────────────────────────────────────────────────────────
def verificar_conexion(jira: JiraClient, at: ATClient = None):
    log.info("→ Verificando conexion Jira...")
    ok_jira = False
    try:
        me = jira.get("myself")
        log.info(f"  ✓ Jira: {me.get('displayName')} ({me.get('emailAddress')})")
        proyectos = jira.paginar("project/search", key_valores="values")
        log.info(f"  ✓ {len(proyectos)} proyectos visibles")
        ok_jira = True
    except Exception as e:
        log.error(f"  ✗ Jira: {e}")

    if at:
        log.info("→ Verificando conexion ActivityTimeline...")
        try:
            teams = at.get("team/list")
            log.info(f"  ✓ AT: {len(teams)} equipos")
        except Exception as e:
            log.error(f"  ✗ AT: {e}")

    return ok_jira


def mostrar_resumen(conn: TursoConn):
    log.info("\n" + "="*58)
    log.info("RESUMEN DE LA BASE DE DATOS")
    log.info("="*58)
    tablas = [
        "rpt_proyectos","rpt_versiones","rpt_componentes","rpt_sprints","rpt_epicas",
        "rpt_issues","rpt_changelog","rpt_issue_links","rpt_comentarios",
        "rpt_worklogs","rpt_jsm_tickets","rpt_jsm_slas",
        "at_equipos","at_usuarios","at_workload","at_availability","at_capacity","at_eventos",
    ]
    for t in tablas:
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            log.info(f"  {t:<28} {n:>7} registros")
        except Exception:
            log.info(f"  {t:<28}  (vacia)")

    try:
        log.info("\n  Issues por proyecto:")
        for r in conn.execute("""
            SELECT project_key, COUNT(*) total,
                   SUM(CASE WHEN status_category='Done' THEN 1 ELSE 0 END) done,
                   SUM(CASE WHEN status_category!='Done' THEN 1 ELSE 0 END) abiertos
            FROM rpt_issues GROUP BY project_key ORDER BY total DESC
        """).fetchall():
            log.info(f"    {r[0]:<12} total:{r[1]}  done:{r[2]}  abiertos:{r[3]}")
    except Exception:
        pass

    try:
        log.info("\n  AT — workload esta semana (horas planificadas por persona):")
        hoy   = datetime.now(timezone.utc).date()
        lunes = hoy - timedelta(days=hoy.weekday())
        for r in conn.execute("""
            SELECT username, full_name, SUM(horas_plan) hs
            FROM at_workload WHERE dia >= ? GROUP BY username ORDER BY hs DESC LIMIT 8
        """, (lunes.strftime("%Y-%m-%d"),)).fetchall():
            log.info(f"    {r[1]:<25} {r[2]:.1f}hs planificadas")
    except Exception:
        pass


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="ETL incremental Jira + AT → SQLite")
    parser.add_argument("--solo-conexion", action="store_true")
    parser.add_argument("--full",          action="store_true", help="Carga completa")
    parser.add_argument("--desde",         type=str, default=None, help="Issues desde YYYY-MM-DD")
    parser.add_argument("--sin-worklogs",  action="store_true")
    parser.add_argument("--sin-jsm",       action="store_true")
    parser.add_argument("--sin-at",        action="store_true", help="Omite ActivityTimeline")
    args = parser.parse_args()

    modo = "full" if args.full else (f"desde-{args.desde}" if args.desde else "incremental")

    log.info("="*58)
    log.info("ETL JIRA + ACTIVITY TIMELINE → TURSO  |  Inthegra")
    log.info("="*58)
    log.info(f"Jira:      {JIRA_BASE}")
    log.info(f"AT:        {AT_BASE}")
    log.info(f"DB:        {TURSO_URL}")
    log.info(f"Modo:      {modo}")
    log.info(f"Proyectos: {PROJECTS or 'TODOS'}")

    jira = JiraClient()
    at   = None if args.sin_at else (ATClient() if AT_TOKEN else None)

    if not at and not args.sin_at:
        log.warning("AT_TOKEN no configurado — se omite ActivityTimeline. Agregalo al .env")

    if args.solo_conexion:
        verificar_conexion(jira, at)
        return

    if not verificar_conexion(jira, at):
        sys.exit(1)

    conn = conectar_turso()
    crear_tablas(conn)

    try:
        inicio = time.time()

        pks = PROJECTS if PROJECTS else extraer_proyectos(jira, conn, modo)
        if not pks:
            log.warning("No se encontraron proyectos.")
            return

        # Siempre extraer proyectos para mantener tabla actualizada
        extraer_proyectos(jira, conn, modo)
        extraer_versiones(jira, conn, pks, modo)
        extraer_componentes(jira, conn, pks, modo)

        _, boards_map = extraer_boards_y_sprints(jira, conn, pks, modo)
        extraer_epicas(jira, conn, boards_map, modo)

        if args.full:
            conn.execute("DELETE FROM rpt_etl_log WHERE tabla IN ('rpt_issues','rpt_worklogs')")
            conn.commit()

        desde = None if args.full else args.desde
        extraer_issues(jira, conn, pks, modo, desde=desde)

        if not args.sin_worklogs:
            extraer_worklogs(jira, conn, modo, full=args.full)

        if not args.sin_jsm:
            extraer_jsm(jira, conn, modo)

        # ── Activity Timeline ─────────────────────────────────────────────
        if at:
            log.info("\n── Activity Timeline ──────────────────────────────────")
            equipos = extraer_at_equipos(at, conn, modo)
            if equipos:
                extraer_at_usuarios(at, conn, modo)
                extraer_at_workload(at, conn, equipos, modo, full=args.full)
                extraer_at_availability(at, conn, equipos, modo, full=args.full)
                extraer_at_capacity(at, conn, equipos, modo, full=args.full)
                extraer_at_eventos(at, conn, equipos, modo, full=args.full)

        log.info(f"\n✓ ETL completado en {round(time.time()-inicio, 1)}s")
        mostrar_resumen(conn)

    finally:
        conn.close()

if __name__ == "__main__":
    main()
