"""
Runner v4: extiende el modelo con carga manual PGI y usuarios de la web.

Mantiene los parches de v3 sobre at_workload y agrega:
- pgi_workload para horas manuales no provenientes de Jira/ActivityTimeline.
- app_users, app_roles y app_role_permissions para login y permisos por rol.
- app_report_permissions queda solo por compatibilidad con datos anteriores.
- Vistas de horas con desglose horas_at / horas_pgi / total.
"""

import etl
import etl_runner_v3  # noqa: F401 - aplica los parches v3 antes de extender el modelo


_original_crear_tablas = etl.crear_tablas
_original_refrescar_vistas = etl.refrescar_vistas
_original_validar_modelo = etl.validar_modelo

ADMIN_PASSWORD_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9"  # admin123
REPORT_KEYS = [
    "horas",
    "novedades-laborales",
    "status-semanal",
    "inversion-estrategica",
    "entrega-calidad",
    "calidad-performance",
]


def asegurar_tablas_app(conn):
    conn.executescript(f"""
        CREATE TABLE IF NOT EXISTS pgi_workload (
            pgi_id INTEGER PRIMARY KEY AUTOINCREMENT,
            person_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            horas REAL NOT NULL,
            comentario TEXT,
            creado_por TEXT,
            activo INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS app_roles (
            role_key TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            enabled INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS app_role_permissions (
            permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_key TEXT NOT NULL,
            report_key TEXT NOT NULL,
            can_view INTEGER DEFAULT 1,
            fecha_carga TEXT,
            UNIQUE(role_key, report_key)
        );
        CREATE TABLE IF NOT EXISTS app_users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            enabled INTEGER DEFAULT 1,
            fecha_carga TEXT
        );
        CREATE TABLE IF NOT EXISTS app_report_permissions (
            permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            report_key TEXT NOT NULL,
            can_view INTEGER DEFAULT 1,
            fecha_carga TEXT,
            UNIQUE(username, report_key)
        );
        INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga)
        VALUES ('admin', 'Administrador', 1, 1, datetime('now'));
        INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga)
        VALUES ('viewer', 'Usuario operativo', 0, 1, datetime('now'));
        INSERT OR IGNORE INTO app_users (username, password_hash, role, enabled, fecha_carga)
        VALUES ('admin', '{ADMIN_PASSWORD_HASH}', 'admin', 1, datetime('now'));
    """)
    for report_key in REPORT_KEYS:
        conn.execute(
            """
            INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga)
            VALUES ('admin', ?, 1, datetime('now'))
            """,
            (report_key,),
        )
    conn.execute(
        """
        INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga)
        VALUES ('viewer', 'horas', 1, datetime('now'))
        """
    )
    conn.commit()


def crear_tablas_v4(conn):
    _original_crear_tablas(conn)
    asegurar_tablas_app(conn)


def refrescar_vistas_v4(conn):
    etl.log.info("Refrescando vistas de reporte con PGI...")
    for name in ["VW_REPORTE_HORAS_DETALLE", "VW_REPORTE_HORAS_PERSONA_TIPO", "VW_REPORTE_HORAS_EQUIPO_TIPO"]:
        conn.execute(f"DROP VIEW IF EXISTS {name}")
    conn.execute("""
        CREATE VIEW VW_REPORTE_HORAS_DETALLE AS
        SELECT
            'AT-' || w.workload_id AS registro_id,
            'AT' AS fuente,
            w.workload_id,
            NULL AS pgi_id,
            w.person_id,
            COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
            w.project_id,
            COALESCE(me.nombre_rpt, me.nombre_at, 'Sin proyecto') AS proyecto,
            me.project_key_rpt,
            me.team_id_at,
            w.issue_key,
            w.event_type,
            w.summary,
            date(w.planned_start) AS fecha,
            w.planned_start,
            w.planned_end,
            w.orig_estimate,
            w.rem_estimate,
            ROUND(COALESCE(w.tiempo_empleado, 0), 2) AS horas_at,
            0.0 AS horas_pgi,
            ROUND(COALESCE(w.tiempo_empleado, 0), 2) AS tiempo_empleado,
            w.fecha_carga
        FROM at_workload w
        LEFT JOIN map_personas mp ON mp.person_id = w.person_id
        LEFT JOIN map_equipo_proyecto me ON me.project_id = w.project_id
        WHERE w.person_id IS NOT NULL AND w.project_id IS NOT NULL

        UNION ALL

        SELECT
            'PGI-' || p.pgi_id AS registro_id,
            'PGI' AS fuente,
            NULL AS workload_id,
            p.pgi_id,
            p.person_id,
            COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
            p.project_id,
            COALESCE(me.nombre_rpt, me.nombre_at, 'Sin proyecto') AS proyecto,
            me.project_key_rpt,
            me.team_id_at,
            NULL AS issue_key,
            'PGI' AS event_type,
            COALESCE(p.comentario, 'PGI log') AS summary,
            date(p.fecha) AS fecha,
            p.fecha AS planned_start,
            p.fecha AS planned_end,
            0.0 AS orig_estimate,
            0.0 AS rem_estimate,
            0.0 AS horas_at,
            ROUND(COALESCE(p.horas, 0), 2) AS horas_pgi,
            ROUND(COALESCE(p.horas, 0), 2) AS tiempo_empleado,
            p.fecha_carga
        FROM pgi_workload p
        LEFT JOIN map_personas mp ON mp.person_id = p.person_id
        LEFT JOIN map_equipo_proyecto me ON me.project_id = p.project_id
        WHERE COALESCE(p.activo, 1) = 1
    """)
    conn.execute("""
        CREATE VIEW VW_REPORTE_HORAS_PERSONA_TIPO AS
        SELECT
            fecha,
            person_id,
            persona,
            project_id,
            proyecto,
            project_key_rpt,
            event_type,
            ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at,
            ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi,
            ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas,
            COUNT(*) AS registros
        FROM VW_REPORTE_HORAS_DETALLE
        GROUP BY fecha, person_id, persona, project_id, proyecto, project_key_rpt, event_type
    """)
    conn.execute("""
        CREATE VIEW VW_REPORTE_HORAS_EQUIPO_TIPO AS
        SELECT
            fecha,
            project_id,
            proyecto,
            project_key_rpt,
            event_type,
            ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at,
            ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi,
            ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas,
            COUNT(DISTINCT person_id) AS personas,
            COUNT(*) AS registros
        FROM VW_REPORTE_HORAS_DETALLE
        GROUP BY fecha, project_id, proyecto, project_key_rpt, event_type
    """)
    conn.commit()


def validar_modelo_v4(conn):
    _original_validar_modelo(conn)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall()}
    required = {"pgi_workload", "app_users", "app_roles", "app_role_permissions", "app_report_permissions"}
    missing = required - tables
    if missing:
        raise RuntimeError("Faltan tablas v4: " + ", ".join(sorted(missing)))
    etl.log.info("Modelo v4 validado")


etl.crear_tablas = crear_tablas_v4
etl.refrescar_vistas = refrescar_vistas_v4
etl.validar_modelo = validar_modelo_v4


if __name__ == "__main__":
    etl.main()
