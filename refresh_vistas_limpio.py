"""
Refresh de vistas activas para Turso.
Reutiliza la definicion actual del modelo, pero excluye vistas legadas de AT/capacidad
que ya no se usan en el reporte de horas.
"""

import logging

from refresh_vistas import VISTAS
from turso_conn import TursoConn, conectar_turso

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("refresh_vistas_limpio")

VISTAS_LEGADAS = {
    "FACT_CAPACIDAD",
    "RPT_CAPACIDAD_SEMANA",
    "AT_WORKLOAD_RESUMEN_DIARIO",
    "RPT_AT_HORAS_USADAS_EVENTO",
    "RPT_AT_HORAS_PERSONA_TIPO",
}

REFERENCIA_AT_AVAILABILITY = "    UNION SELECT dia                  FROM at_availability WHERE dia IS NOT NULL\n"


def vistas_activas():
    activas = []
    for nombre, sql_vista in VISTAS:
        if nombre in VISTAS_LEGADAS:
            continue
        sql_limpio = sql_vista.replace(REFERENCIA_AT_AVAILABILITY, "")
        activas.append((nombre, sql_limpio))
    return activas


def limpiar_vistas_legadas(conn: TursoConn):
    for nombre in sorted(VISTAS_LEGADAS):
        conn.execute(f"DROP VIEW IF EXISTS {nombre}")
    conn.commit()


def refresh(conn: TursoConn):
    log.info("=" * 55)
    log.info("REFRESH VISTAS ACTIVAS → Turso")
    log.info("=" * 55)

    limpiar_vistas_legadas(conn)

    ok = 0
    errores = 0

    for nombre, sql_vista in vistas_activas():
        try:
            conn.execute(f"DROP VIEW IF EXISTS {nombre}")
            conn.commit()
            conn.execute(sql_vista.strip())
            conn.commit()
            log.info("  ✓ %s", nombre)
            ok += 1
        except Exception as exc:
            log.error("  ✗ %s: %s", nombre, exc)
            errores += 1

    log.info("\n✓ %s vistas creadas  |  %s errores", ok, errores)
    return errores == 0


if __name__ == "__main__":
    conn = conectar_turso()
    exito = refresh(conn)
    conn.close()
    if not exito:
        raise SystemExit(1)
