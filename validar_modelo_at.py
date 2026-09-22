"""
Valida que el pipeline haya dejado Turso con el modelo AT esperado.
Si falta algo o quedan objetos legados, falla la corrida.
"""

from turso_conn import conectar_turso

REQUIRED_TABLES = {
    "at_equipos",
    "at_usuarios",
    "at_workload",
    "at_capacity",
    "at_eventos",
    "map_at_equipo_proyecto",
    "map_persona_fuentes",
}

REQUIRED_VIEWS = {
    "RPT_AT_EVENTOS_DETALLE_HORAS",
    "RPT_AT_HORAS_PERSONA_TIPO_PERIODO",
    "RPT_AT_HORAS_EQUIPO_TIPO_PERIODO",
}

REQUIRED_COLUMNS = {
    "at_workload": {
        "issue_key",
        "tipo_registro",
        "time_spent_seconds",
        "horas_usadas",
        "worklog_count",
    },
    "at_capacity": {
        "team_id",
        "username",
        "full_name",
        "dia",
        "dia_semana",
        "horas_cap",
        "capacidad_origen",
    },
    "at_eventos": {
        "evento_id",
        "username",
        "team_id",
        "project_key",
        "issue_key",
        "issue_id",
        "issue_type",
        "event_type",
        "summary",
        "planned_start",
        "planned_end",
        "orig_estimate",
        "rem_estimate",
        "daily_time_estimate",
        "estimate_per_work_day",
        "approved_by",
        "extra_link",
        "color",
    },
}

FORBIDDEN_TABLES = {
    "at_availability",
}

FORBIDDEN_VIEWS = {
    "FACT_CAPACIDAD",
    "RPT_CAPACIDAD_SEMANA",
    "AT_WORKLOAD_RESUMEN_DIARIO",
    "RPT_AT_HORAS_PERSONA_TIPO",
    "RPT_AT_HORAS_USADAS_EVENTO",
}


def object_names(conn, object_type: str) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_schema WHERE type = ?",
        (object_type,),
    ).fetchall()
    return {row[0] for row in rows}


def table_columns(conn, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def main():
    conn = conectar_turso()
    errores = []
    try:
        tables = object_names(conn, "table")
        views = object_names(conn, "view")

        missing_tables = sorted(REQUIRED_TABLES - tables)
        missing_views = sorted(REQUIRED_VIEWS - views)
        forbidden_tables = sorted(FORBIDDEN_TABLES & tables)
        forbidden_views = sorted(FORBIDDEN_VIEWS & views)

        if missing_tables:
            errores.append(f"Faltan tablas: {', '.join(missing_tables)}")
        if missing_views:
            errores.append(f"Faltan vistas: {', '.join(missing_views)}")

        for table_name, required_columns in REQUIRED_COLUMNS.items():
            if table_name not in tables:
                continue
            existing_columns = table_columns(conn, table_name)
            missing_columns = sorted(required_columns - existing_columns)
            if missing_columns:
                errores.append(f"Faltan columnas en {table_name}: {', '.join(missing_columns)}")

        if forbidden_tables:
            errores.append(f"Siguen existiendo tablas legadas: {', '.join(forbidden_tables)}")
        if forbidden_views:
            errores.append(f"Siguen existiendo vistas legadas: {', '.join(forbidden_views)}")

        print("Tablas AT encontradas:")
        for name in sorted(t for t in tables if t.startswith("at_") or t.startswith("map_")):
            print(f"- {name}")

        print("Vistas AT encontradas:")
        for name in sorted(v for v in views if v.startswith("RPT_AT") or v.startswith("AT_") or v in FORBIDDEN_VIEWS):
            print(f"- {name}")

        if errores:
            print("\nVALIDACION FALLIDA")
            for error in errores:
                print(f"- {error}")
            raise SystemExit(1)

        print("\nValidacion AT correcta")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
