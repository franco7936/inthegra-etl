"""
Runner v3: agrega deduplicacion fuerte sobre at_workload.

Se apoya en etl_runner_v2 para conservar el matching robusto de personas y
proyectos, y agrega una clave unica funcional por actividad de ActivityTimeline.
"""

import hashlib
import re

import etl
import etl_runner_v2  # noqa: F401 - importa y aplica los parches v2 sobre etl


_original_crear_tablas = etl.crear_tablas
_original_upsert = etl.upsert


def _has_table(conn, table):
    row = conn.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name=?", (table,)).fetchone()
    return bool(row)


def _has_column(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]).lower() == column.lower() for row in rows)


def _clean(value):
    value = str(value or "").strip().lower()
    return re.sub(r"\s+", " ", value)


def _date_part(value):
    value = str(value or "").strip()
    return value[:10] if len(value) >= 10 else value


def _num_part(value):
    try:
        return f"{float(value or 0):.4f}"
    except (TypeError, ValueError):
        return "0.0000"


def at_workload_dedupe_key(row):
    """Devuelve una huella estable para detectar la misma actividad dos veces."""
    parts = [
        str(row.get("person_id") or ""),
        str(row.get("project_id") or ""),
        _clean(row.get("issue_key")).upper(),
        _clean(row.get("event_type")),
        _clean(row.get("summary"))[:500],
        _date_part(row.get("planned_start")),
        _date_part(row.get("planned_end")),
        _num_part(row.get("tiempo_empleado")),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _row_from_tuple(row):
    return {
        "workload_id": row[0],
        "person_id": row[1],
        "project_id": row[2],
        "issue_key": row[3],
        "event_type": row[4],
        "summary": row[5],
        "planned_start": row[6],
        "planned_end": row[7],
        "tiempo_empleado": row[8],
    }


def ensure_at_workload_dedupe(conn):
    """Crea columna, completa historico, elimina duplicados y crea indice unico."""
    if not _has_table(conn, "at_workload"):
        return

    if not _has_column(conn, "at_workload", "dedupe_key"):
        conn.execute("ALTER TABLE at_workload ADD COLUMN dedupe_key TEXT")
        conn.commit()

    rows = conn.execute("""
        SELECT workload_id, person_id, project_id, issue_key, event_type, summary,
               planned_start, planned_end, tiempo_empleado
        FROM at_workload
        WHERE dedupe_key IS NULL OR TRIM(dedupe_key) = ''
    """).fetchall()

    updates = []
    for row in rows:
        row_dict = _row_from_tuple(row)
        updates.append((at_workload_dedupe_key(row_dict), row_dict["workload_id"]))

    if updates:
        conn.executemany("UPDATE at_workload SET dedupe_key=? WHERE workload_id=?", updates)
        conn.commit()

    duplicate_row = conn.execute("""
        SELECT COUNT(*)
        FROM at_workload
        WHERE dedupe_key IS NOT NULL
          AND TRIM(dedupe_key) <> ''
          AND workload_id NOT IN (
              SELECT MIN(workload_id)
              FROM at_workload
              WHERE dedupe_key IS NOT NULL AND TRIM(dedupe_key) <> ''
              GROUP BY dedupe_key
          )
    """).fetchone()
    duplicate_count = int(duplicate_row[0] or 0) if duplicate_row else 0

    conn.execute("""
        DELETE FROM at_workload
        WHERE dedupe_key IS NOT NULL
          AND TRIM(dedupe_key) <> ''
          AND workload_id NOT IN (
              SELECT MIN(workload_id)
              FROM at_workload
              WHERE dedupe_key IS NOT NULL AND TRIM(dedupe_key) <> ''
              GROUP BY dedupe_key
          )
    """)
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_at_workload_dedupe_key ON at_workload(dedupe_key)")
    conn.commit()

    if duplicate_count:
        etl.log.warning("at_workload: %s duplicados historicos eliminados por dedupe_key", duplicate_count)


def deduplicar_at_workload_rows(rows):
    dedup = {}
    duplicados = 0
    for row in rows:
        key = at_workload_dedupe_key(row)
        if key in dedup:
            duplicados += 1
            continue
        row = dict(row)
        row["dedupe_key"] = key
        dedup[key] = row
    if duplicados:
        etl.log.warning("at_workload: %s duplicados omitidos antes de insertar", duplicados)
    return list(dedup.values()), duplicados


def crear_tablas_v3(conn):
    _original_crear_tablas(conn)
    ensure_at_workload_dedupe(conn)


def upsert_v3(conn, tabla, rows):
    if tabla != "at_workload":
        return _original_upsert(conn, tabla, rows)

    ensure_at_workload_dedupe(conn)
    dedup_rows, duplicados = deduplicar_at_workload_rows(rows)
    insertados = _original_upsert(conn, tabla, dedup_rows)
    if duplicados:
        etl.log.info("at_workload: %s registros finales luego de deduplicar", insertados)
    return insertados


etl.crear_tablas = crear_tablas_v3
etl.upsert = upsert_v3


if __name__ == "__main__":
    etl.main()
