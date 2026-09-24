"""
Limpia datos transaccionales anteriores a una fecha en Turso.

Uso seguro:
    python limpiar_turso_desde.py --desde 2026-08-01 --confirmar

La limpieza conserva tablas de mapeo y catalogos necesarios para asociar datos:
- map_personas
- map_equipo_proyecto
- rpt_sprints
- rpt_epicas
- rpt_issues

Solo borra hechos de horas anteriores a la fecha indicada:
- at_workload
- rpt_worklogs
"""

import argparse
import logging
from datetime import datetime

from dotenv import load_dotenv

from turso_conn import conectar_turso

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("limpiar_turso")


def validar_fecha(value):
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("La fecha debe tener formato YYYY-MM-DD") from exc
    return value


def contar(conn, sql, params):
    row = conn.execute(sql, params).fetchone()
    return int(row[0] or 0) if row else 0


def limpiar(conn, desde, confirmar=False):
    operaciones = [
        {
            "tabla": "at_workload",
            "count_sql": """
                SELECT COUNT(*)
                FROM at_workload
                WHERE date(COALESCE(planned_start, planned_end)) < date(?)
            """,
            "delete_sql": """
                DELETE FROM at_workload
                WHERE date(COALESCE(planned_start, planned_end)) < date(?)
            """,
        },
        {
            "tabla": "rpt_worklogs",
            "count_sql": """
                SELECT COUNT(*)
                FROM rpt_worklogs
                WHERE date(date_worked) < date(?)
            """,
            "delete_sql": """
                DELETE FROM rpt_worklogs
                WHERE date(date_worked) < date(?)
            """,
        },
    ]

    total = 0
    for op in operaciones:
        try:
            cantidad = contar(conn, op["count_sql"], (desde,))
        except Exception as exc:
            log.warning("No se pudo contar %s: %s", op["tabla"], exc)
            cantidad = 0
        total += cantidad
        log.info("%s: %s filas anteriores a %s", op["tabla"], cantidad, desde)

    if not confirmar:
        log.info("Modo simulacion. Para borrar, ejecutar con --confirmar")
        return total

    for op in operaciones:
        try:
            conn.execute(op["delete_sql"], (desde,))
            conn.commit()
            log.info("%s: limpieza aplicada", op["tabla"])
        except Exception as exc:
            log.warning("No se pudo limpiar %s: %s", op["tabla"], exc)

    try:
        conn.execute(
            """
            INSERT INTO etl_log (fecha, modo, tabla, registros, estado, detalle)
            VALUES (datetime('now'), ?, ?, ?, 'OK', ?)
            """,
            ("limpieza", "limpieza_turso_desde", total, f"Datos transaccionales conservados desde {desde}"),
        )
        conn.commit()
    except Exception as exc:
        log.warning("No se pudo registrar limpieza en etl_log: %s", exc)

    return total


def main():
    parser = argparse.ArgumentParser(description="Limpia datos transaccionales antiguos en Turso")
    parser.add_argument("--desde", required=True, type=validar_fecha, help="Fecha minima a conservar, formato YYYY-MM-DD")
    parser.add_argument("--confirmar", action="store_true", help="Aplica el borrado. Sin esto solo informa conteos")
    args = parser.parse_args()

    conn = conectar_turso()
    try:
        total = limpiar(conn, args.desde, confirmar=args.confirmar)
        log.info("Filas candidatas/procesadas: %s", total)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
