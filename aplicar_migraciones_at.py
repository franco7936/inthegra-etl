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


def main():
    conn = conectar_turso()
    try:
        print("Asegurando columnas nuevas en at_workload...")
        asegurar_columnas(conn)

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
