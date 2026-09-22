"""
Aplica los cambios necesarios para los reportes de ActivityTimeline.
Es seguro para ejecutar en cada corrida del pipeline.
"""

from pathlib import Path

from extract_at_worklogs import asegurar_columnas
from turso_conn import conectar_turso

MIGRATIONS_DIR = Path("migrations")
TABLE_MIGRATIONS = [
    "2026-09-22_add_manual_mapping_tables.sql",
]
VIEW_MIGRATIONS = [
    "2026-09-22_add_at_event_type_report_views.sql",
]
CLEANUP_MIGRATIONS = [
    "2026-09-22_remove_at_availability.sql",
    "2026-09-22_remove_legacy_at_views.sql",
]

REQUIRED_COLUMNS = {
    "at_workload": {
        "issue_key": "TEXT",
        "tipo_registro": "TEXT DEFAULT 'PLANIFICADO'",
        "time_spent_seconds": "INTEGER DEFAULT 0",
        "horas_usadas": "REAL DEFAULT 0",
        "worklog_count": "INTEGER DEFAULT 0",
    },
    "at_capacity": {
        "capacidad_origen": "TEXT DEFAULT 'AT_CAPACITY'",
    },
    "at_eventos": {
        "project_key": "TEXT",
        "issue_id": "TEXT",
        "issue_type": "TEXT",
        "daily_time_estimate": "REAL DEFAULT 0",
        "estimate_per_work_day": "REAL DEFAULT 0",
        "approved_by": "TEXT",
        "extra_link": "TEXT",
        "color": "TEXT",
    },
}


def split_sql_script(sql: str) -> list[str]:
    statements = []
    current = []
    for raw_line in sql.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("--"):
            continue
        current.append(raw_line)
        if line.endswith(";"):
            statement = "\n".join(current).strip().rstrip(";").strip()
            if statement:
                statements.append(statement)
            current = []
    tail = "\n".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def execute_sql_file(conn, path: Path):
    if not path.exists():
        print(f"- Omitida: {path} no existe")
        return
    statements = split_sql_script(path.read_text(encoding="utf-8"))
    print(f"- Aplicando {path.name}: {len(statements)} statements")
    for statement in statements:
        conn.execute(statement)
    conn.commit()


def columnas_tabla(conn, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def asegurar_columnas_reporte(conn):
    print("Asegurando columnas requeridas para reportes AT...")
    for table_name, columns in REQUIRED_COLUMNS.items():
        existentes = columnas_tabla(conn, table_name)
        if not existentes:
            print(f"- Tabla {table_name} todavia no existe; se omite hasta que ETL la cree")
            continue
        for column_name, definition in columns.items():
            if column_name not in existentes:
                print(f"- Agregando {table_name}.{column_name}")
                conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
        conn.commit()

    conn.execute("UPDATE at_workload SET tipo_registro = 'PLANIFICADO' WHERE tipo_registro IS NULL OR tipo_registro = ''")
    conn.execute("UPDATE at_workload SET time_spent_seconds = 0 WHERE time_spent_seconds IS NULL")
    conn.execute("UPDATE at_workload SET horas_usadas = 0 WHERE horas_usadas IS NULL")
    conn.execute("UPDATE at_workload SET worklog_count = 0 WHERE worklog_count IS NULL")
    conn.execute("UPDATE at_capacity SET capacidad_origen = 'AT_CAPACITY' WHERE capacidad_origen IS NULL OR capacidad_origen = ''")
    conn.execute("UPDATE at_eventos SET daily_time_estimate = COALESCE(daily_time_estimate, orig_estimate, 0)")
    conn.execute("UPDATE at_eventos SET estimate_per_work_day = COALESCE(estimate_per_work_day, daily_time_estimate, orig_estimate, 0)")
    conn.commit()


def main():
    conn = conectar_turso()
    try:
        print("Asegurando columnas nuevas en at_workload...")
        asegurar_columnas(conn)
        asegurar_columnas_reporte(conn)

        print("Aplicando tablas manuales de mapeo...")
        for filename in TABLE_MIGRATIONS:
            execute_sql_file(conn, MIGRATIONS_DIR / filename)

        print("Aplicando vistas AT actuales para reportes...")
        for filename in VIEW_MIGRATIONS:
            execute_sql_file(conn, MIGRATIONS_DIR / filename)

        print("Eliminando objetos AT legados...")
        for filename in CLEANUP_MIGRATIONS:
            execute_sql_file(conn, MIGRATIONS_DIR / filename)

        print("Migraciones AT aplicadas correctamente")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
