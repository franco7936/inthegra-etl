"""
Refresh del modelo estrella en Turso.
Aplica todas las vistas del modelo estrella despues de cada ETL.
Se ejecuta como Job 2 en GitHub Actions, despues del ETL.

Uso: python refresh_vistas.py
"""

import os
import logging
from turso_conn import TursoConn, conectar_turso

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("refresh_vistas")

# ── VISTAS DEL MODELO ESTRELLA ────────────────────────────────────────────────
# Incluye todas las vistas: DIM_*, FACT_*, RPT_*
# Compatible con SQLite/Turso (sin FULL OUTER JOIN, sin CTE recursiva)

VISTAS = [

# ── DIMENSIONES ───────────────────────────────────────────────────────────────

("DIM_TIEMPO", """
CREATE VIEW DIM_TIEMPO AS
SELECT DISTINCT
    date(fecha)                                                   AS fecha,
    CAST(strftime('%Y', fecha) AS INTEGER)                        AS anio,
    CAST(strftime('%m', fecha) AS INTEGER)                        AS mes,
    CAST(strftime('%d', fecha) AS INTEGER)                        AS dia_mes,
    CASE CAST(strftime('%m', fecha) AS INTEGER)
        WHEN 1  THEN 'Enero'      WHEN 2  THEN 'Febrero'
        WHEN 3  THEN 'Marzo'      WHEN 4  THEN 'Abril'
        WHEN 5  THEN 'Mayo'       WHEN 6  THEN 'Junio'
        WHEN 7  THEN 'Julio'      WHEN 8  THEN 'Agosto'
        WHEN 9  THEN 'Septiembre' WHEN 10 THEN 'Octubre'
        WHEN 11 THEN 'Noviembre'  WHEN 12 THEN 'Diciembre'
    END                                                           AS nombre_mes,
    CASE
        WHEN CAST(strftime('%m', fecha) AS INTEGER) <= 3  THEN 'Q1'
        WHEN CAST(strftime('%m', fecha) AS INTEGER) <= 6  THEN 'Q2'
        WHEN CAST(strftime('%m', fecha) AS INTEGER) <= 9  THEN 'Q3'
        ELSE 'Q4'
    END                                                           AS trimestre,
    strftime('%Y', fecha) || '-' ||
    CASE
        WHEN CAST(strftime('%m', fecha) AS INTEGER) <= 3  THEN 'Q1'
        WHEN CAST(strftime('%m', fecha) AS INTEGER) <= 6  THEN 'Q2'
        WHEN CAST(strftime('%m', fecha) AS INTEGER) <= 9  THEN 'Q3'
        ELSE 'Q4'
    END                                                           AS anio_trimestre,
    CAST(strftime('%W', fecha) AS INTEGER)                        AS semana_anio,
    strftime('%Y', fecha) || '-W' ||
        printf('%02d', CAST(strftime('%W', fecha) AS INTEGER))    AS anio_semana,
    CASE CAST(strftime('%w', fecha) AS INTEGER)
        WHEN 0 THEN 'Domingo'  WHEN 1 THEN 'Lunes'
        WHEN 2 THEN 'Martes'   WHEN 3 THEN 'Miercoles'
        WHEN 4 THEN 'Jueves'   WHEN 5 THEN 'Viernes'
        WHEN 6 THEN 'Sabado'
    END                                                           AS dia_semana,
    CASE WHEN CAST(strftime('%w', fecha) AS INTEGER) IN (0,6)
         THEN 0 ELSE 1
    END                                                           AS es_dia_habil
FROM (
    SELECT date(created_date)  AS fecha FROM rpt_issues WHERE created_date IS NOT NULL
    UNION SELECT date(updated_date)   FROM rpt_issues WHERE updated_date IS NOT NULL
    UNION SELECT date(resolved_date)  FROM rpt_issues WHERE resolved_date IS NOT NULL
    UNION SELECT date_worked          FROM rpt_worklogs WHERE date_worked IS NOT NULL
    UNION SELECT start_date           FROM rpt_sprints WHERE start_date IS NOT NULL
    UNION SELECT end_date             FROM rpt_sprints WHERE end_date IS NOT NULL
    UNION SELECT date(fecha_cambio)   FROM rpt_changelog WHERE fecha_cambio IS NOT NULL
    UNION SELECT dia                  FROM at_workload WHERE dia IS NOT NULL
    UNION SELECT dia                  FROM at_availability WHERE dia IS NOT NULL
    UNION SELECT dia                  FROM at_capacity WHERE dia IS NOT NULL
)
WHERE fecha IS NOT NULL
ORDER BY fecha
"""),

("DIM_PROYECTO", """
CREATE VIEW DIM_PROYECTO AS
SELECT
    p.project_key,
    p.nombre                                     AS nombre_proyecto,
    p.tipo                                        AS tipo_proyecto,
    p.lead                                        AS lider,
    CASE p.project_key
        WHEN 'HEALTH'    THEN 'HealthCare'
        WHEN 'CREDIT'    THEN 'Credito & Finanzas'
        WHEN 'BUSINESS'  THEN 'Business'
        WHEN 'IMPL'      THEN 'Implementaciones'
        WHEN 'SOLUTIONS' THEN 'Solutions'
        ELSE p.project_key
    END                                           AS vertical,
    CASE p.project_key
        WHEN 'BUSINESS'  THEN '2144395923319442701'
        WHEN 'CREDIT'    THEN '4607552451305227984'
        WHEN 'HEALTH'    THEN '1887964038729056425'
        WHEN 'IMPL'      THEN '4943724420684009274'
        WHEN 'SOLUTIONS' THEN '5363132200178437734'
        ELSE NULL
    END                                           AS at_team_id
FROM rpt_proyectos p
WHERE p.project_key != 'DEMO'
"""),

("DIM_SPRINT", """
CREATE VIEW DIM_SPRINT AS
SELECT
    s.sprint_id,
    s.sprint_name                                                AS nombre_sprint,
    s.project_key,
    s.state                                                      AS estado,
    s.start_date                                                 AS fecha_inicio,
    s.end_date                                                   AS fecha_fin,
    s.goal                                                       AS objetivo,
    CAST(
        julianday(COALESCE(s.end_date, date('now'))) -
        julianday(s.start_date)
    AS INTEGER)                                                  AS duracion_dias
FROM rpt_sprints s
"""),

("DIM_EPIC", """
CREATE VIEW DIM_EPIC AS
SELECT
    e.epic_key,
    e.project_key,
    e.nombre   AS nombre_epic,
    e.summary  AS resumen,
    e.status   AS estado,
    e.done     AS completada
FROM rpt_epicas e
"""),

("DIM_PERSONA", """
CREATE VIEW DIM_PERSONA AS
SELECT
    COALESCE(u.username, j.assignee_id)     AS username,
    COALESCE(u.full_name, j.assignee_name)  AS nombre_completo,
    u.email,
    u.posicion,
    u.involvement                           AS horas_contrato_dia,
    u.enabled
FROM at_usuarios u
LEFT JOIN (
    SELECT DISTINCT assignee_id, assignee_name
    FROM rpt_issues WHERE assignee_id IS NOT NULL
) j ON j.assignee_id = u.username
GROUP BY COALESCE(u.username, j.assignee_id)
"""),

("DIM_ESTADO", """
CREATE VIEW DIM_ESTADO AS
SELECT DISTINCT
    status           AS estado,
    status_category  AS categoria,
    CASE status_category
        WHEN 'To Do'       THEN 1
        WHEN 'In Progress' THEN 2
        WHEN 'Done'        THEN 3
        ELSE 4
    END              AS orden
FROM rpt_issues WHERE status IS NOT NULL
"""),

("DIM_TIPO_ISSUE", """
CREATE VIEW DIM_TIPO_ISSUE AS
SELECT DISTINCT
    issue_type AS tipo,
    CASE issue_type
        WHEN 'Bug'      THEN 'Defecto'
        WHEN 'Story'    THEN 'Historia'
        WHEN 'Task'     THEN 'Tarea'
        WHEN 'Epic'     THEN 'Epica'
        WHEN 'Subtask'  THEN 'Subtarea'
        WHEN 'Subtarea' THEN 'Subtarea'
        ELSE 'Otro'
    END        AS categoria_tipo,
    CASE issue_type WHEN 'Bug' THEN 1 ELSE 0 END AS es_bug
FROM rpt_issues WHERE issue_type IS NOT NULL
"""),

# ── HECHOS ────────────────────────────────────────────────────────────────────

("FACT_ISSUES", """
CREATE VIEW FACT_ISSUES AS
SELECT
    i.issue_key,
    i.project_key,
    i.sprint_id,
    i.epic_key,
    i.assignee_id        AS username,
    i.assignee_name,
    i.issue_type,
    i.status,
    i.status_category,
    i.priority,
    date(i.created_date) AS fecha_creacion,
    date(i.updated_date) AS fecha_actualizacion,
    date(i.resolved_date) AS fecha_resolucion,
    COALESCE(i.estimado_hs, 0)        AS estimado_hs,
    COALESCE(i.restante_hs, 0)        AS restante_hs,
    COALESCE(i.estimado_total_hs, 0)  AS estimado_total_hs,
    COALESCE(i.restante_total_hs, 0)  AS restante_total_hs,
    COALESCE(w.horas_reales, 0)       AS horas_reales,
    ROUND(COALESCE(i.estimado_hs, 0) - COALESCE(w.horas_reales, 0), 2) AS variacion_hs,
    CASE
        WHEN COALESCE(i.estimado_hs, 0) = 0 THEN NULL
        ELSE ROUND(100.0 * COALESCE(w.horas_reales, 0) / COALESCE(i.estimado_hs, 0), 1)
    END                               AS pct_ejecutado,
    CASE
        WHEN i.resolved_date IS NOT NULL
        THEN CAST(julianday(date(i.resolved_date)) - julianday(date(i.created_date)) AS INTEGER)
        ELSE CAST(julianday(date('now')) - julianday(date(i.created_date)) AS INTEGER)
    END                               AS lead_time_dias,
    CASE
        WHEN ip.fecha_inicio_progress IS NOT NULL AND i.resolved_date IS NOT NULL
        THEN CAST(julianday(date(i.resolved_date)) - julianday(date(ip.fecha_inicio_progress)) AS INTEGER)
        WHEN ip.fecha_inicio_progress IS NOT NULL
        THEN CAST(julianday(date('now')) - julianday(date(ip.fecha_inicio_progress)) AS INTEGER)
        ELSE NULL
    END                               AS cycle_time_dias,
    COALESCE(i.cant_comentarios, 0)   AS cant_comentarios,
    COALESCE(i.cant_subtareas, 0)     AS cant_subtareas,
    COALESCE(i.cant_links, 0)         AS cant_links,
    COALESCE(i.cant_watchers, 0)      AS cant_watchers,
    CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END       AS es_bug,
    CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END  AS esta_done,
    CASE WHEN i.resolved_date IS NOT NULL THEN 1 ELSE 0 END  AS fue_resuelto,
    i.version_fix,
    i.componentes,
    i.summary AS resumen
FROM rpt_issues i
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
LEFT JOIN (
    SELECT issue_key, MIN(fecha_cambio) AS fecha_inicio_progress
    FROM rpt_changelog
    WHERE campo = 'status'
      AND (valor_hasta LIKE '%Progress%' OR valor_hasta LIKE '%curso%' OR valor_hasta LIKE '%Progreso%')
    GROUP BY issue_key
) ip ON ip.issue_key = i.issue_key
"""),

("FACT_HORAS", """
CREATE VIEW FACT_HORAS AS
SELECT
    w.worklog_id,
    w.issue_key,
    w.project_key,
    w.user_id    AS username,
    w.user_name  AS nombre_persona,
    w.date_worked AS fecha,
    w.hours_logged AS horas_reales,
    CAST(strftime('%Y', w.date_worked) AS INTEGER) AS anio,
    CAST(strftime('%m', w.date_worked) AS INTEGER) AS mes,
    CAST(strftime('%W', w.date_worked) AS INTEGER) AS semana,
    strftime('%Y', w.date_worked) || '-W' ||
        printf('%02d', CAST(strftime('%W', w.date_worked) AS INTEGER)) AS anio_semana,
    i.issue_type,
    i.status_category,
    i.sprint_id,
    i.epic_key
FROM rpt_worklogs w
LEFT JOIN rpt_issues i ON i.issue_key = w.issue_key
"""),

("FACT_CAPACIDAD", """
CREATE VIEW FACT_CAPACIDAD AS
SELECT
    usr, nombre AS nombre_persona, fecha, team_id, project_key,
    SUM(horas_capacidad)    AS horas_capacidad,
    SUM(horas_disponibles)  AS horas_disponibles,
    SUM(horas_planificadas) AS horas_planificadas,
    SUM(horas_reales)       AS horas_reales,
    ROUND(SUM(horas_capacidad)    - SUM(horas_planificadas), 2) AS horas_asignadas,
    ROUND(SUM(horas_planificadas) - SUM(horas_reales), 2)       AS variacion_plan_real,
    CASE WHEN SUM(horas_capacidad)    = 0 THEN NULL
         ELSE ROUND(100.0 * SUM(horas_reales) / SUM(horas_capacidad), 1)
    END AS pct_utilizacion,
    CASE WHEN SUM(horas_planificadas) = 0 THEN NULL
         ELSE ROUND(100.0 * SUM(horas_reales) / SUM(horas_planificadas), 1)
    END AS pct_ejecucion_vs_plan,
    CAST(strftime('%Y', fecha) AS INTEGER) AS anio,
    CAST(strftime('%m', fecha) AS INTEGER) AS mes,
    strftime('%Y', fecha) || '-W' ||
        printf('%02d', CAST(strftime('%W', fecha) AS INTEGER)) AS anio_semana
FROM (
    SELECT
        cap.username AS usr, cap.full_name AS nombre, cap.dia AS fecha,
        cap.team_id, COALESCE(wl.project_key, '') AS project_key,
        cap.horas_cap              AS horas_capacidad,
        COALESCE(av.horas_disp, 0) AS horas_disponibles,
        COALESCE(wl.horas_plan, 0) AS horas_planificadas,
        COALESCE(wr.horas_reales,0) AS horas_reales
    FROM at_capacity cap
    LEFT JOIN at_availability av ON av.username = cap.username AND av.dia = cap.dia AND av.team_id = cap.team_id
    LEFT JOIN at_workload wl     ON wl.username = cap.username AND wl.dia = cap.dia AND wl.team_id = cap.team_id
    LEFT JOIN (
        SELECT user_id, date_worked, ROUND(SUM(hours_logged), 2) AS horas_reales
        FROM rpt_worklogs GROUP BY user_id, date_worked
    ) wr ON wr.user_id = cap.username AND wr.date_worked = cap.dia

    UNION ALL

    SELECT
        w.user_id AS usr, w.user_name AS nombre, w.date_worked AS fecha,
        NULL AS team_id, w.project_key,
        0 AS horas_capacidad, 0 AS horas_disponibles, 0 AS horas_planificadas,
        ROUND(SUM(w.hours_logged), 2) AS horas_reales
    FROM rpt_worklogs w
    WHERE NOT EXISTS (
        SELECT 1 FROM at_capacity cap
        WHERE cap.username = w.user_id AND cap.dia = w.date_worked
    )
    GROUP BY w.user_id, w.user_name, w.date_worked, w.project_key
)
GROUP BY usr, nombre, fecha, team_id, project_key
"""),

("FACT_SPRINT_METRICAS", """
CREATE VIEW FACT_SPRINT_METRICAS AS
SELECT
    s.sprint_id, s.sprint_name AS nombre_sprint, s.project_key,
    s.state AS estado_sprint, s.start_date AS fecha_inicio, s.end_date AS fecha_fin,
    s.goal  AS objetivo,
    COUNT(i.issue_key)                                           AS total_issues,
    SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END) AS issues_done,
    SUM(CASE WHEN i.status_category = 'In Progress' THEN 1 ELSE 0 END) AS issues_en_progreso,
    SUM(CASE WHEN i.status_category = 'To Do' THEN 1 ELSE 0 END) AS issues_pendientes,
    SUM(CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END)       AS bugs_totales,
    SUM(CASE WHEN i.issue_type = 'Bug' AND i.status_category = 'Done' THEN 1 ELSE 0 END) AS bugs_resueltos,
    ROUND(100.0 * SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(i.issue_key), 0), 1)                   AS pct_completitud,
    ROUND(100.0 * SUM(CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(i.issue_key), 0), 1)                   AS pct_bugs,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)), 1)                   AS hs_estimadas_total,
    ROUND(SUM(COALESCE(w.horas_reales, 0)), 1)                  AS hs_reales_total,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)) - SUM(COALESCE(w.horas_reales, 0)), 1) AS variacion_hs,
    ROUND(100.0 * SUM(COALESCE(w.horas_reales, 0)) / NULLIF(SUM(COALESCE(i.estimado_hs, 0)), 0), 1) AS pct_ejecucion_hs,
    COUNT(DISTINCT i.assignee_id)                               AS devs_activos,
    ROUND(AVG(CASE WHEN i.resolved_date IS NOT NULL
        THEN julianday(date(i.resolved_date)) - julianday(date(i.created_date)) END), 1) AS lead_time_promedio_dias
FROM rpt_sprints s
LEFT JOIN rpt_issues i ON i.sprint_id = s.sprint_id
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
GROUP BY s.sprint_id, s.sprint_name, s.project_key, s.state, s.start_date, s.end_date, s.goal
"""),

("FACT_EPICAS_AVANCE", """
CREATE VIEW FACT_EPICAS_AVANCE AS
SELECT
    e.epic_key, e.project_key, e.nombre AS nombre_epic,
    e.status AS estado_epic, e.done AS epic_completada,
    COUNT(i.issue_key)                                           AS total_issues,
    SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END) AS issues_done,
    ROUND(100.0 * SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(i.issue_key), 0), 1)                   AS pct_avance,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)), 1)                   AS hs_estimadas,
    ROUND(SUM(COALESCE(w.horas_reales, 0)), 1)                  AS hs_reales,
    COUNT(DISTINCT i.assignee_id)                               AS devs_involucrados,
    SUM(CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END)       AS bugs
FROM rpt_epicas e
LEFT JOIN rpt_issues i ON i.epic_key = e.epic_key
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
GROUP BY e.epic_key, e.project_key, e.nombre, e.status, e.done
"""),

# ── REPORTES ─────────────────────────────────────────────────────────────────

("RPT_SEMANA_ACTUAL", """
CREATE VIEW RPT_SEMANA_ACTUAL AS
SELECT
    i.project_key, i.assignee_name, i.issue_type,
    i.status, i.status_category,
    COUNT(*)                             AS issues,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)), 1) AS hs_estimadas,
    ROUND(SUM(COALESCE(w.horas_reales, 0)), 1) AS hs_reales
FROM rpt_issues i
LEFT JOIN (
    SELECT issue_key, SUM(hours_logged) AS horas_reales
    FROM rpt_worklogs
    WHERE date_worked >= date('now', 'weekday 0', '-7 days')
    GROUP BY issue_key
) w ON w.issue_key = i.issue_key
JOIN rpt_sprints s ON s.sprint_id = i.sprint_id AND s.state = 'active'
GROUP BY i.project_key, i.assignee_name, i.issue_type, i.status, i.status_category
"""),

("RPT_BUGS_ABIERTOS", """
CREATE VIEW RPT_BUGS_ABIERTOS AS
SELECT
    i.issue_key, i.project_key, i.summary AS resumen,
    i.status, i.priority, i.assignee_name,
    i.created_date,
    CAST(julianday('now') - julianday(i.created_date) AS INTEGER) AS dias_abierto,
    COALESCE(i.estimado_hs, 0)  AS estimado_hs,
    COALESCE(w.horas_reales, 0) AS hs_trabajadas
FROM rpt_issues i
LEFT JOIN (
    SELECT issue_key, SUM(hours_logged) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
WHERE i.issue_type = 'Bug' AND i.status_category != 'Done'
ORDER BY dias_abierto DESC
"""),

("RPT_CAPACIDAD_SEMANA", """
CREATE VIEW RPT_CAPACIDAD_SEMANA AS
SELECT
    fc.username, fc.nombre_persona, fc.team_id,
    ROUND(SUM(fc.horas_capacidad),    1) AS capacidad_total_hs,
    ROUND(SUM(fc.horas_planificadas), 1) AS planificado_hs,
    ROUND(SUM(fc.horas_disponibles),  1) AS disponible_hs,
    ROUND(SUM(fc.horas_reales),       1) AS real_hs,
    ROUND(SUM(fc.horas_capacidad) - SUM(fc.horas_planificadas), 1) AS sin_asignar_hs,
    CASE WHEN SUM(fc.horas_capacidad) = 0 THEN NULL
         ELSE ROUND(100.0 * SUM(fc.horas_reales) / SUM(fc.horas_capacidad), 1)
    END AS pct_utilizacion
FROM FACT_CAPACIDAD fc
WHERE fc.fecha >= date('now', '-7 days') AND fc.fecha <= date('now')
GROUP BY fc.username, fc.nombre_persona, fc.team_id
ORDER BY real_hs DESC
"""),

("RPT_VELOCITY_HISTORICA", """
CREATE VIEW RPT_VELOCITY_HISTORICA AS
SELECT
    project_key, sprint_id, nombre_sprint, fecha_inicio, fecha_fin,
    total_issues, issues_done, pct_completitud,
    hs_estimadas_total, hs_reales_total, variacion_hs, pct_ejecucion_hs,
    bugs_totales, pct_bugs, lead_time_promedio_dias
FROM FACT_SPRINT_METRICAS
WHERE estado_sprint IN ('active','closed')
ORDER BY project_key, fecha_inicio
"""),

]


def refresh(conn: TursoConn):
    log.info("="*55)
    log.info("REFRESH MODELO ESTRELLA → Turso")
    log.info("="*55)

    ok = 0
    errores = 0

    for nombre, sql_vista in VISTAS:
        try:
            conn.execute(f"DROP VIEW IF EXISTS {nombre}")
            conn.commit()
            conn.execute(sql_vista.strip())
            conn.commit()
            log.info(f"  ✓ {nombre}")
            ok += 1
        except Exception as e:
            log.error(f"  ✗ {nombre}: {e}")
            errores += 1

    log.info(f"\n✓ {ok} vistas creadas  |  {errores} errores")
    return errores == 0


if __name__ == "__main__":
    conn = conectar_turso()
    exito = refresh(conn)
    conn.close()
    if not exito:
        exit(1)
