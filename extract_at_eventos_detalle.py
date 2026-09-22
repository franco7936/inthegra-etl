"""
Actualiza at_eventos con campos detallados de ActivityTimeline para el reporte de horas.

Uso:
    python extract_at_eventos_detalle.py --dias 60
    python extract_at_eventos_detalle.py --mes 2026-09
"""

import argparse
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import requests
from dotenv import load_dotenv

from aplicar_migraciones_at import asegurar_columnas_reporte
from turso_conn import conectar_turso

load_dotenv()

JIRA_BASE = os.getenv("JIRA_BASE_URL", "").rstrip("/")
AT_BASE = os.getenv("AT_BASE_URL", JIRA_BASE).rstrip("/")
AT_TOKEN = os.getenv("AT_TOKEN", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("at_eventos_detalle")


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


def resolver_mes(mes: str) -> tuple[str, str]:
    inicio = datetime.strptime(f"{mes}-01", "%Y-%m-%d").date()
    siguiente = date(inicio.year + 1, 1, 1) if inicio.month == 12 else date(inicio.year, inicio.month + 1, 1)
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


def equipos_desde_db(conn):
    rows = conn.execute("""
        SELECT team_id, nombre
        FROM at_equipos
        WHERE team_id IS NOT NULL AND team_id != ''
        ORDER BY nombre
    """).fetchall()
    return [{"team_id": row[0], "nombre": row[1]} for row in rows]


def equipos_desde_api(at: ATClient):
    data = at.get("team/list")
    equipos = []
    for item in data if isinstance(data, list) else []:
        if item.get("id"):
            equipos.append({"team_id": str(item.get("id")), "nombre": item.get("name", "")})
    return equipos


def extraer_eventos(at: ATClient, conn, desde: str, hasta: str):
    asegurar_columnas_reporte(conn)
    equipos = equipos_desde_db(conn) or equipos_desde_api(at)
    log.info("Equipos AT a consultar: %s", len(equipos))

    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for index, equipo in enumerate(equipos, start=1):
        team_id = equipo["team_id"]
        try:
            data = at.get("timeline", params={"teamId": team_id, "start": desde, "end": hasta})
            members = data.get("members", []) if isinstance(data, dict) else []
            for member in members:
                username = member.get("username", "")
                for item in member.get("issues", []) or []:
                    evento_id = str(item.get("id", ""))
                    if not evento_id:
                        continue
                    daily_seconds = item.get("dailyTimeEstimate")
                    original_seconds = item.get("originalTimeEstimate")
                    rows.append({
                        "evento_id": evento_id,
                        "username": username,
                        "team_id": team_id,
                        "project_key": item.get("projectKey", ""),
                        "issue_key": item.get("issueKey", ""),
                        "issue_id": str(item.get("issueId", "") or ""),
                        "issue_type": item.get("issueType", ""),
                        "event_type": item.get("issueType", ""),
                        "summary": item.get("summary", "")[:300],
                        "planned_start": item.get("plannedStart", ""),
                        "planned_end": item.get("plannedEnd", ""),
                        "orig_estimate": seg_a_hs(original_seconds),
                        "rem_estimate": seg_a_hs(item.get("remainingTimeEstimate")),
                        "daily_time_estimate": seg_a_hs(daily_seconds if daily_seconds is not None else original_seconds),
                        "estimate_per_work_day": seg_a_hs(item.get("estimatePerWorkDay")),
                        "approved_by": item.get("approvedBy", ""),
                        "extra_link": item.get("extraLink", ""),
                        "color": item.get("color", ""),
                        "fecha_carga": now,
                    })
            time.sleep(0.25)
        except Exception as exc:
            log.warning("Equipo %s omitido: %s", equipo.get("nombre") or team_id, exc)

        if index % 5 == 0:
            log.info("Procesados %s/%s equipos", index, len(equipos))

    conn.execute(
        "DELETE FROM at_eventos WHERE planned_start >= ? AND planned_start <= ?",
        (desde, hasta),
    )
    conn.commit()

    df = pd.DataFrame(rows)
    if df.empty:
        log.info("Sin eventos AT para %s a %s", desde, hasta)
        return 0

    n = conn.to_sql_df(df, "at_eventos", if_exists="append", chunksize=50)
    log.info("at_eventos detalle: %s registros actualizados", n)
    return n


def main():
    parser = argparse.ArgumentParser(description="Actualiza at_eventos con detalle completo para reportes")
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
        extraer_eventos(at, conn, desde, hasta)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
