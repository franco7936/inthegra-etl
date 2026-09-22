"""
Agrega tiempo usado real desde ActivityTimeline dentro de at_workload.

Fuente:
    /rest/api/1/timeline/{username}?start=YYYY-MM-DD&end=YYYY-MM-DD&eventType=WORKLOG

Uso:
    python extract_at_worklogs.py --mes 2026-09
    python extract_at_worklogs.py --desde 2026-09-01 --hasta 2026-09-30
    python extract_at_worklogs.py --dias 60
"""

import argparse
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
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
log = logging.getLogger("at_workload_usage")


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


def asegurar_columnas(conn: TursoConn):
    existentes = {row[1] for row in conn.execute("PRAGMA table_info(at_workload)").fetchall()}
    columnas = {
        "issue_key": "TEXT",
        "tipo_registro": "TEXT DEFAULT 'PLANIFICADO'",
        "time_spent_seconds": "INTEGER DEFAULT 0",
        "horas_usadas": "REAL DEFAULT 0",
        "worklog_count": "INTEGER DEFAULT 0",
    }
    for nombre, definicion in columnas.items():
        if nombre not in existentes:
            conn.execute(f"ALTER TABLE at_workload ADD COLUMN {nombre} {definicion}")
    conn.commit()

    conn.execute("UPDATE at_workload SET tipo_registro = 'PLANIFICADO' WHERE tipo_registro IS NULL OR tipo_registro = ''")
    conn.execute("UPDATE at_workload SET time_spent_seconds = 0 WHERE time_spent_seconds IS NULL")
    conn.execute("UPDATE at_workload SET horas_usadas = 0 WHERE horas_usadas IS NULL")
    conn.execute("UPDATE at_workload SET worklog_count = 0 WHERE worklog_count IS NULL")
    conn.commit()

    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_at_workload_tipo_fecha
            ON at_workload (tipo_registro, dia)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_at_workload_usuario_fecha
            ON at_workload (username, dia)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_at_workload_issue
            ON at_workload (issue_key)
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


def normalizar_df(df: pd.DataFrame) -> pd.DataFrame:
    columnas = ["username", "dia", "project_key", "issue_key", "time_spent_seconds", "horas_usadas", "worklog_count"]
    if df.empty:
        return pd.DataFrame(columns=columnas)
    for col in ["username", "dia", "project_key", "issue_key"]:
        df[col] = df[col].fillna("").astype(str)
    df["time_spent_seconds"] = df["time_spent_seconds"].fillna(0).astype(int)
    df["horas_usadas"] = df["horas_usadas"].fillna(0).round(2)
    df["worklog_count"] = df["worklog_count"].fillna(0).astype(int)
    return df[columnas].sort_values(["username", "dia", "project_key", "issue_key"]).reset_index(drop=True)


def leer_worklogs_existentes(conn: TursoConn, desde: str, hasta: str) -> pd.DataFrame:
    rows = conn.execute("""
        SELECT
            username,
            dia,
            COALESCE(project_key, '') AS project_key,
            COALESCE(issue_key, '') AS issue_key,
            COALESCE(time_spent_seconds, 0) AS time_spent_seconds,
            ROUND(COALESCE(horas_usadas, 0), 2) AS horas_usadas,
            COALESCE(worklog_count, 0) AS worklog_count
        FROM at_workload
        WHERE tipo_registro = 'WORKLOG'
          AND dia >= ?
          AND dia <= ?
        ORDER BY username, dia, project_key, issue_key
    """, (desde, hasta)).fetchall()
    return normalizar_df(pd.DataFrame(rows, columns=[
        "username",
        "dia",
        "project_key",
        "issue_key",
        "time_spent_seconds",
        "horas_usadas",
        "worklog_count",
    ]))


def mismos_worklogs(actual: pd.DataFrame, nuevo: pd.DataFrame) -> bool:
    actual_norm = normalizar_df(actual.copy())
    nuevo_norm = normalizar_df(nuevo.copy())
    if len(actual_norm) != len(nuevo_norm):
        return False
    return actual_norm.equals(nuevo_norm)


def preparar_worklogs(registros: list[dict]) -> pd.DataFrame:
    if not registros:
        return pd.DataFrame(columns=[
            "username",
            "dia",
            "project_key",
            "issue_key",
            "time_spent_seconds",
            "horas_usadas",
            "worklog_count",
        ])
    df = pd.DataFrame(registros)
    df = df.groupby(["username", "dia", "project_key", "issue_key"], as_index=False).agg(
        time_spent_seconds=("time_spent_seconds", "sum"),
        horas_usadas=("horas_usadas", "sum"),
        worklog_count=("horas_usadas", "count"),
    )
    df["horas_usadas"] = df["horas_usadas"].round(2)
    return normalizar_df(df)


def extraer_at_workload_usage(at: ATClient, conn: TursoConn, desde: str, hasta: str):
    asegurar_columnas(conn)
    usuarios = usuarios_desde_db(conn) or usuarios_desde_api(at)
    log.info("Usuarios AT a consultar: %s", len(usuarios))

    now = datetime.now(timezone.utc).isoformat()
    registros = []

    for index, username in enumerate(usuarios, start=1):
        try:
            data = at.get(
                f"timeline/{quote(username, safe='')}",
                params={"start": desde, "end": hasta, "eventType": "WORKLOG"},
            )
            for item in data.get("issues", []) if isinstance(data, dict) else []:
                seconds = int(item.get("timeSpent") or 0)
                registros.append({
                    "username": item.get("username") or username,
                    "dia": (item.get("date") or "")[:10],
                    "project_key": item.get("projectKey", ""),
                    "issue_key": item.get("issueKey", ""),
                    "time_spent_seconds": seconds,
                    "horas_usadas": seg_a_hs(seconds),
                })
        except Exception as exc:
            log.warning("Usuario %s omitido: %s", username, exc)

        if index % 10 == 0:
            log.info("Procesados %s/%s usuarios", index, len(usuarios))
        time.sleep(0.15)

    df = preparar_worklogs(registros)
    existentes = leer_worklogs_existentes(conn, desde, hasta)

    if mismos_worklogs(existentes, df):
        conn.execute(
            "INSERT INTO rpt_etl_log (fecha,modo,tabla,registros,estado,detalle) VALUES (?,?,?,?,?,?)",
            (now, "at-workload-usage", "at_workload", 0, "OK", f"sin cambios | {desde} a {hasta}"),
        )
        conn.commit()
        log.info("at_workload WORKLOG: sin cambios para %s a %s", desde, hasta)
        return 0

    conn.execute(
        "DELETE FROM at_workload WHERE tipo_registro = 'WORKLOG' AND dia >= ? AND dia <= ?",
        (desde, hasta),
    )
    conn.commit()

    if not df.empty:
        df["team_id"] = None
        df["full_name"] = None
        df["dia_semana"] = None
        df["horas_plan"] = 0
        df["tipo_registro"] = "WORKLOG"
        df["fecha_carga"] = now
        df = df[[
            "team_id",
            "username",
            "full_name",
            "dia",
            "dia_semana",
            "horas_plan",
            "project_key",
            "fecha_carga",
            "issue_key",
            "tipo_registro",
            "time_spent_seconds",
            "horas_usadas",
            "worklog_count",
        ]]
        n = conn.to_sql_df(df, "at_workload", if_exists="append", chunksize=50)
    else:
        n = 0

    conn.execute(
        "INSERT INTO rpt_etl_log (fecha,modo,tabla,registros,estado,detalle) VALUES (?,?,?,?,?,?)",
        (now, "at-workload-usage", "at_workload", n, "OK", f"actualizado | {desde} a {hasta}"),
    )
    conn.commit()
    log.info("at_workload WORKLOG: %s registros actualizados", n)
    return n


def resolver_mes(mes: str) -> tuple[str, str]:
    inicio = datetime.strptime(f"{mes}-01", "%Y-%m-%d").date()
    if inicio.month == 12:
        siguiente = date(inicio.year + 1, 1, 1)
    else:
        siguiente = date(inicio.year, inicio.month + 1, 1)
    fin = siguiente - timedelta(days=1)
    return inicio.strftime("%Y-%m-%d"), fin.strftime("%Y-%m-%d")


def resolver_periodo(args):
    if args.mes:
        return resolver_mes(args.mes)
    if args.desde and args.hasta:
        return args.desde, args.hasta
    hasta = datetime.now(timezone.utc).date()
    desde = hasta - timedelta(days=args.dias)
    return desde.strftime("%Y-%m-%d"), hasta.strftime("%Y-%m-%d")


def main():
    parser = argparse.ArgumentParser(description="Agrega horas usadas de ActivityTimeline dentro de at_workload")
    parser.add_argument("--mes", type=str, default=None, help="Mes calendario completo YYYY-MM")
    parser.add_argument("--desde", type=str, default=None, help="Fecha inicial YYYY-MM-DD")
    parser.add_argument("--hasta", type=str, default=None, help="Fecha final YYYY-MM-DD")
    parser.add_argument("--dias", type=int, default=60, help="Dias hacia atras si no se pasa desde/hasta/mes")
    args = parser.parse_args()

    desde, hasta = resolver_periodo(args)
    log.info("Periodo: %s a %s", desde, hasta)

    at = ATClient()
    conn = conectar_turso()
    try:
        extraer_at_workload_usage(at, conn, desde, hasta)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
