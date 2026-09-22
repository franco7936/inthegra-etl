"""
Extrae tiempo usado real desde ActivityTimeline.

Fuente:
    /rest/api/1/timeline/{username}?start=YYYY-MM-DD&end=YYYY-MM-DD&eventType=WORKLOG

Uso:
    python extract_at_worklogs.py --desde 2026-09-01 --hasta 2026-09-30
    python extract_at_worklogs.py --dias 60
"""

import argparse
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import pandas as pd
import requests
from dotenv import load_dotenv

from turso_conn import TursoConn, conectar_turso

load_dotenv()

JIRA_BASE = os.getenv("JIRA_BASE_URL", "").rstrip("/")
AT_BASE = os.getenv("AT_BASE_URL", JIRA_BASE).rstrip("/")
AT_TOKEN = os.getenv("AT_TOKEN", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("at_worklogs")


class ATClient:
    def __init__(self):
        if not AT_TOKEN:
            raise ValueError("Falta AT_TOKEN en .env")
        self.base = f"{AT_BASE}/rest/api/1"
        self.session = requests.Session()
        self.session.headers.update({"auth-token": AT_TOKEN, "Accept": "application/json"})

    def get(self, path: str, params: dict | None = None):
        url = f"{self.base}/{path.lstrip('/')}"
        resp = self.session.get(url, params=params, timeout=45)
        try:
            resp.raise_for_status()
        except requests.exceptions.HTTPError:
            log.error("AT HTTP %s en %s: %s", resp.status_code, url, resp.text[:300])
            raise
        return resp.json()


def seg_a_hs(seconds):
    return round((seconds or 0) / 3600, 2)


def crear_tabla(conn: TursoConn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS at_worklogs (
            worklog_id          TEXT PRIMARY KEY,
            username            TEXT,
            issue_key           TEXT,
            project_key         TEXT,
            fecha               TEXT,
            fecha_hora          TEXT,
            comentario          TEXT,
            categoria           TEXT,
            time_spent_seconds  INTEGER,
            horas_usadas        REAL,
            fecha_carga         TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_at_worklogs_fecha
            ON at_worklogs (fecha);

        CREATE INDEX IF NOT EXISTS idx_at_worklogs_usuario_fecha
            ON at_worklogs (username, fecha);

        CREATE INDEX IF NOT EXISTS idx_at_worklogs_issue
            ON at_worklogs (issue_key);
    """)
    conn.commit()


def usuarios_desde_db(conn: TursoConn) -> list[str]:
    rows = conn.execute("""
        SELECT DISTINCT username
        FROM at_usuarios
        WHERE username IS NOT NULL AND username != ''
        ORDER BY username
    """).fetchall()
    return [r[0] for r in rows]


def usuarios_desde_api(at: ATClient) -> list[str]:
    usuarios = []
    offset = 0
    while True:
        data = at.get("user", params={"startOffset": offset})
        if not isinstance(data, list) or not data:
            break
        usuarios.extend(u.get("username") for u in data if u.get("username"))
        if len(data) < 100:
            break
        offset += len(data)
        time.sleep(0.2)
    return sorted(set(usuarios))


def extraer_at_worklogs(at: ATClient, conn: TursoConn, desde: str, hasta: str):
    crear_tabla(conn)
    usuarios = usuarios_desde_db(conn) or usuarios_desde_api(at)
    log.info("Usuarios AT a consultar: %s", len(usuarios))

    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for index, username in enumerate(usuarios, start=1):
        try:
            data = at.get(
                f"timeline/{quote(username, safe='')}",
                params={"start": desde, "end": hasta, "eventType": "WORKLOG"},
            )
            for item in data.get("issues", []) if isinstance(data, dict) else []:
                seconds = int(item.get("timeSpent") or 0)
                rows.append({
                    "worklog_id": str(item.get("id", "")),
                    "username": item.get("username") or username,
                    "issue_key": item.get("issueKey", ""),
                    "project_key": item.get("projectKey", ""),
                    "fecha": (item.get("date") or "")[:10],
                    "fecha_hora": item.get("date", ""),
                    "comentario": (item.get("comment") or "")[:500],
                    "categoria": item.get("category", ""),
                    "time_spent_seconds": seconds,
                    "horas_usadas": seg_a_hs(seconds),
                    "fecha_carga": now,
                })
        except Exception as exc:
            log.warning("Usuario %s omitido: %s", username, exc)

        if index % 10 == 0:
            log.info("Procesados %s/%s usuarios", index, len(usuarios))
        time.sleep(0.15)

    conn.execute("DELETE FROM at_worklogs WHERE fecha >= ? AND fecha <= ?", (desde, hasta))
    conn.commit()

    if rows:
        df = pd.DataFrame(rows).drop_duplicates(subset=["worklog_id"])
        n = conn.to_sql_df(df, "at_worklogs", if_exists="append", chunksize=50)
    else:
        n = 0

    conn.execute(
        "INSERT INTO rpt_etl_log (fecha,modo,tabla,registros,estado,detalle) VALUES (?,?,?,?,?,?)",
        (now, "at-worklogs", "at_worklogs", n, "OK", f"{desde} a {hasta}"),
    )
    conn.commit()
    log.info("at_worklogs: %s registros", n)
    return n


def resolver_periodo(args):
    if args.desde and args.hasta:
        return args.desde, args.hasta
    hasta = datetime.now(timezone.utc).date()
    desde = hasta - timedelta(days=args.dias)
    return desde.strftime("%Y-%m-%d"), hasta.strftime("%Y-%m-%d")


def main():
    parser = argparse.ArgumentParser(description="Extrae worklogs reales desde ActivityTimeline")
    parser.add_argument("--desde", type=str, default=None, help="Fecha inicial YYYY-MM-DD")
    parser.add_argument("--hasta", type=str, default=None, help="Fecha final YYYY-MM-DD")
    parser.add_argument("--dias", type=int, default=60, help="Dias hacia atras si no se pasa desde/hasta")
    args = parser.parse_args()

    desde, hasta = resolver_periodo(args)
    log.info("Periodo: %s a %s", desde, hasta)

    at = ATClient()
    conn = conectar_turso()
    try:
        extraer_at_worklogs(at, conn, desde, hasta)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
