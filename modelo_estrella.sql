-- ============================================================
-- MODELO ESTRELLA — Inthegra Reporting
-- Base: SQLite (compatible Oracle ADW con minimos cambios)
-- Ejecutar completo una sola vez para crear todas las vistas
-- ============================================================


-- ============================================================
-- DIMENSIONES
-- ============================================================

-- ── DIM_TIEMPO ───────────────────────────────────────────────
-- Calendario completo 2023-2027
-- En Oracle ADW esto seria una tabla fisica poblada con un script
-- En SQLite usamos una CTE recursiva via vista

DROP VIEW IF EXISTS DIM_TIEMPO;
CREATE VIEW DIM_TIEMPO AS
WITH RECURSIVE fechas(dia) AS (
    SELECT date('2023-01-01')
    UNION ALL
    SELECT date(dia, '+1 day')
    FROM fechas
    WHERE dia < '2027-12-31'
)
SELECT
    dia                                                          AS fecha,
    CAST(strftime('%Y', dia) AS INTEGER)                         AS anio,
    CAST(strftime('%m', dia) AS INTEGER)                         AS mes,
    CAST(strftime('%d', dia) AS INTEGER)                         AS dia_mes,
    CASE CAST(strftime('%m', dia) AS INTEGER)
        WHEN 1 THEN 'Enero'   WHEN 2  THEN 'Febrero'
        WHEN 3 THEN 'Marzo'   WHEN 4  THEN 'Abril'
        WHEN 5 THEN 'Mayo'    WHEN 6  THEN 'Junio'
        WHEN 7 THEN 'Julio'   WHEN 8  THEN 'Agosto'
        WHEN 9 THEN 'Septiembre' WHEN 10 THEN 'Octubre'
        WHEN 11 THEN 'Noviembre' WHEN 12 THEN 'Diciembre'
    END                                                          AS nombre_mes,
    CASE
        WHEN CAST(strftime('%m', dia) AS INTEGER) <= 3  THEN 'Q1'
        WHEN CAST(strftime('%m', dia) AS INTEGER) <= 6  THEN 'Q2'
        WHEN CAST(strftime('%m', dia) AS INTEGER) <= 9  THEN 'Q3'
        ELSE 'Q4'
    END                                                          AS trimestre,
    CAST(strftime('%Y', dia) AS TEXT) || '-' ||
    CASE
        WHEN CAST(strftime('%m', dia) AS INTEGER) <= 3  THEN 'Q1'
        WHEN CAST(strftime('%m', dia) AS INTEGER) <= 6  THEN 'Q2'
        WHEN CAST(strftime('%m', dia) AS INTEGER) <= 9  THEN 'Q3'
        ELSE 'Q4'
    END                                                          AS anio_trimestre,
    CAST(strftime('%W', dia) AS INTEGER)                         AS semana_anio,
    strftime('%Y', dia) || '-W' ||
        printf('%02d', CAST(strftime('%W', dia) AS INTEGER))     AS anio_semana,
    CASE CAST(strftime('%w', dia) AS INTEGER)
        WHEN 0 THEN 'Domingo'   WHEN 1 THEN 'Lunes'
        WHEN 2 THEN 'Martes'    WHEN 3 THEN 'Miercoles'
        WHEN 4 THEN 'Jueves'    WHEN 5 THEN 'Viernes'
        WHEN 6 THEN 'Sabado'
    END                                                          AS dia_semana,
    CASE WHEN CAST(strftime('%w', dia) AS INTEGER) IN (0, 6)
         THEN 0 ELSE 1
    END                                                          AS es_dia_habil
FROM fechas;


-- ── DIM_PROYECTO ─────────────────────────────────────────────
DROP VIEW IF EXISTS DIM_PROYECTO;
CREATE VIEW DIM_PROYECTO AS
SELECT
    p.project_key,
    p.nombre                                                     AS nombre_proyecto,
    p.tipo                                                       AS tipo_proyecto,
    p.lead                                                       AS lider,
    CASE p.project_key
        WHEN 'HEALTH'    THEN 'HealthCare'
        WHEN 'CREDIT'    THEN 'Credito & Finanzas'
        WHEN 'BUSINESS'  THEN 'Business'
        WHEN 'IMPL'      THEN 'Implementaciones'
        WHEN 'SOLUTIONS' THEN 'Solutions'
        ELSE p.project_key
    END                                                          AS vertical
FROM rpt_proyectos p;


-- ── DIM_SPRINT ───────────────────────────────────────────────
DROP VIEW IF EXISTS DIM_SPRINT;
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
    AS INTEGER)                                                  AS duracion_dias,
    CASE s.state
        WHEN 'active' THEN 1
        WHEN 'closed' THEN 2
        ELSE 3
    END                                                          AS orden_estado
FROM rpt_sprints s;


-- ── DIM_EPIC ─────────────────────────────────────────────────
DROP VIEW IF EXISTS DIM_EPIC;
CREATE VIEW DIM_EPIC AS
SELECT
    e.epic_key,
    e.project_key,
    e.nombre                                                     AS nombre_epic,
    e.summary                                                    AS resumen,
    e.status                                                     AS estado,
    e.done                                                       AS completada
FROM rpt_epicas e;


-- ── DIM_PERSONA ──────────────────────────────────────────────
-- Combina usuarios de Jira (assignees) con perfiles de AT
DROP VIEW IF EXISTS DIM_PERSONA;
CREATE VIEW DIM_PERSONA AS
SELECT
    COALESCE(u.username, j.assignee_id)                         AS username,
    COALESCE(u.full_name, j.assignee_name)                      AS nombre_completo,
    u.email,
    u.posicion,
    u.involvement                                                AS horas_contrato_dia,
    u.enabled,
    eq.nombre                                                    AS equipo_at,
    eq.team_type                                                 AS tipo_equipo
FROM at_usuarios u
LEFT JOIN (
    SELECT DISTINCT assignee_id, assignee_name
    FROM rpt_issues
    WHERE assignee_id IS NOT NULL
) j ON j.assignee_id = u.username
LEFT JOIN at_equipos eq ON 1=1   -- se puede refinar si AT expone team por usuario
GROUP BY COALESCE(u.username, j.assignee_id);


-- ── DIM_ESTADO ───────────────────────────────────────────────
DROP VIEW IF EXISTS DIM_ESTADO;
CREATE VIEW DIM_ESTADO AS
SELECT DISTINCT
    status                                                       AS estado,
    status_category                                              AS categoria,
    CASE status_category
        WHEN 'To Do'       THEN 1
        WHEN 'In Progress' THEN 2
        WHEN 'Done'        THEN 3
        ELSE 4
    END                                                          AS orden
FROM rpt_issues
WHERE status IS NOT NULL;


-- ── DIM_TIPO_ISSUE ───────────────────────────────────────────
DROP VIEW IF EXISTS DIM_TIPO_ISSUE;
CREATE VIEW DIM_TIPO_ISSUE AS
SELECT DISTINCT
    issue_type                                                   AS tipo,
    CASE issue_type
        WHEN 'Bug'      THEN 'Defecto'
        WHEN 'Story'    THEN 'Historia'
        WHEN 'Task'     THEN 'Tarea'
        WHEN 'Epic'     THEN 'Epica'
        WHEN 'Subtask'  THEN 'Subtarea'
        WHEN 'Subtarea' THEN 'Subtarea'
        ELSE 'Otro'
    END                                                          AS categoria_tipo,
    CASE issue_type
        WHEN 'Bug' THEN 1 ELSE 0
    END                                                          AS es_bug
FROM rpt_issues
WHERE issue_type IS NOT NULL;


-- ============================================================
-- TABLAS DE HECHOS
-- ============================================================

-- ── FACT_ISSUES ──────────────────────────────────────────────
-- Granularidad: un registro por issue
-- Metricas: estimaciones, tiempos, contadores
DROP VIEW IF EXISTS FACT_ISSUES;
CREATE VIEW FACT_ISSUES AS
SELECT
    -- Claves de dimension
    i.issue_key,
    i.project_key,
    i.sprint_id,
    i.epic_key,
    i.assignee_id                                                AS username,
    i.issue_type,
    i.status,
    i.status_category,
    i.priority,
    -- Fechas (clave para DIM_TIEMPO)
    date(i.created_date)                                         AS fecha_creacion,
    date(i.updated_date)                                         AS fecha_actualizacion,
    date(i.resolved_date)                                        AS fecha_resolucion,
    -- Metricas de estimacion (horas)
    COALESCE(i.estimado_hs, 0)                                   AS estimado_hs,
    COALESCE(i.restante_hs, 0)                                   AS restante_hs,
    COALESCE(i.estimado_total_hs, 0)                             AS estimado_total_hs,
    COALESCE(i.restante_total_hs, 0)                             AS restante_total_hs,
    -- Horas reales registradas (desde worklogs)
    COALESCE(w.horas_reales, 0)                                  AS horas_reales,
    -- Variacion estimado vs real
    COALESCE(i.estimado_hs, 0) - COALESCE(w.horas_reales, 0)   AS variacion_hs,
    CASE
        WHEN COALESCE(i.estimado_hs, 0) = 0 THEN NULL
        ELSE ROUND(
            100.0 * COALESCE(w.horas_reales, 0) /
            COALESCE(i.estimado_hs, 0), 1)
    END                                                          AS pct_ejecutado,
    -- Lead time (dias desde creacion hasta resolucion)
    CASE
        WHEN i.resolved_date IS NOT NULL
        THEN CAST(julianday(date(i.resolved_date)) -
                  julianday(date(i.created_date)) AS INTEGER)
        ELSE CAST(julianday(date('now')) -
                  julianday(date(i.created_date)) AS INTEGER)
    END                                                          AS lead_time_dias,
    -- Cycle time (dias en In Progress — desde changelog)
    COALESCE(ct.cycle_time_dias, 0)                             AS cycle_time_dias,
    -- Contadores
    COALESCE(i.cant_comentarios, 0)                              AS cant_comentarios,
    COALESCE(i.cant_subtareas, 0)                                AS cant_subtareas,
    COALESCE(i.cant_links, 0)                                    AS cant_links,
    COALESCE(i.cant_watchers, 0)                                 AS cant_watchers,
    -- Flags
    CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END            AS es_bug,
    CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END      AS esta_done,
    CASE WHEN i.resolved_date IS NOT NULL THEN 1 ELSE 0 END      AS fue_resuelto,
    -- Campos extra
    i.version_fix,
    i.componentes,
    i.summary                                                    AS resumen
FROM rpt_issues i
-- Horas reales acumuladas por issue
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs
    GROUP BY issue_key
) w ON w.issue_key = i.issue_key
-- Cycle time: tiempo total en estado "In Progress"
LEFT JOIN (
    SELECT
        issue_key,
        ROUND(SUM(
            CAST(julianday(COALESCE(
                LEAD(fecha_cambio) OVER (PARTITION BY issue_key ORDER BY fecha_cambio),
                datetime('now')
            )) - julianday(fecha_cambio) AS REAL)
        ), 1) AS cycle_time_dias
    FROM rpt_changelog
    WHERE campo = 'status'
      AND valor_hasta IN ('In Progress', 'En curso', 'En Progreso')
    GROUP BY issue_key
) ct ON ct.issue_key = i.issue_key;


-- ── FACT_HORAS ───────────────────────────────────────────────
-- Granularidad: un registro por worklog (hora registrada)
-- Metricas: horas reales trabajadas por persona, dia, proyecto, issue
DROP VIEW IF EXISTS FACT_HORAS;
CREATE VIEW FACT_HORAS AS
SELECT
    w.worklog_id,
    w.issue_key,
    w.project_key,
    w.user_id                                                    AS username,
    w.user_name                                                  AS nombre_persona,
    w.date_worked                                                AS fecha,
    w.hours_logged                                               AS horas_reales,
    -- Dimension tiempo
    CAST(strftime('%Y', w.date_worked) AS INTEGER)               AS anio,
    CAST(strftime('%m', w.date_worked) AS INTEGER)               AS mes,
    CAST(strftime('%W', w.date_worked) AS INTEGER)               AS semana,
    strftime('%Y', w.date_worked) || '-W' ||
        printf('%02d', CAST(strftime('%W', w.date_worked) AS INTEGER)) AS anio_semana,
    -- Tipo del issue asociado
    i.issue_type,
    i.status_category,
    i.sprint_id,
    i.epic_key
FROM rpt_worklogs w
LEFT JOIN rpt_issues i ON i.issue_key = w.issue_key;


-- ── FACT_CAPACIDAD ───────────────────────────────────────────
-- Granularidad: un registro por persona por dia
-- La tabla mas importante para metricas de equipo:
-- Cruza planificado (AT workload) + disponible (AT availability)
-- + teorico (AT capacity) + real ejecutado (Jira worklogs)
DROP VIEW IF EXISTS FACT_CAPACIDAD;
CREATE VIEW FACT_CAPACIDAD AS
SELECT
    COALESCE(cap.username, avail.username, wl.username, wlog.user_id) AS username,
    COALESCE(cap.full_name, avail.full_name, wl.full_name, wlog.user_name) AS nombre_persona,
    COALESCE(cap.dia, avail.dia, wl.dia, wlog.date_worked)         AS fecha,
    COALESCE(cap.team_id, avail.team_id, wl.team_id)               AS team_id,
    -- Horas teoricas (capacidad maxima sin considerar asignaciones)
    COALESCE(cap.horas_cap, 0)                                      AS horas_capacidad,
    -- Horas disponibles (capacidad menos lo ya asignado en AT)
    COALESCE(avail.horas_disp, 0)                                   AS horas_disponibles,
    -- Horas planificadas (lo que AT tiene asignado)
    COALESCE(wl.horas_plan, 0)                                      AS horas_planificadas,
    -- Horas reales registradas en Jira
    COALESCE(wlog.horas_reales, 0)                                  AS horas_reales,
    -- Metricas derivadas
    COALESCE(cap.horas_cap, 0) - COALESCE(avail.horas_disp, 0)    AS horas_asignadas,
    COALESCE(wl.horas_plan, 0) - COALESCE(wlog.horas_reales, 0)   AS variacion_plan_real,
    CASE
        WHEN COALESCE(cap.horas_cap, 0) = 0 THEN NULL
        ELSE ROUND(100.0 * COALESCE(wlog.horas_reales, 0) /
                   COALESCE(cap.horas_cap, 0), 1)
    END                                                             AS pct_utilizacion,
    CASE
        WHEN COALESCE(wl.horas_plan, 0) = 0 THEN NULL
        ELSE ROUND(100.0 * COALESCE(wlog.horas_reales, 0) /
                   COALESCE(wl.horas_plan, 0), 1)
    END                                                             AS pct_ejecucion_vs_plan,
    -- Dimension tiempo
    CAST(strftime('%Y', COALESCE(cap.dia, avail.dia, wl.dia, wlog.date_worked)) AS INTEGER) AS anio,
    CAST(strftime('%m', COALESCE(cap.dia, avail.dia, wl.dia, wlog.date_worked)) AS INTEGER) AS mes,
    strftime('%Y', COALESCE(cap.dia, avail.dia, wl.dia, wlog.date_worked)) || '-W' ||
        printf('%02d', CAST(strftime('%W', COALESCE(cap.dia, avail.dia, wl.dia, wlog.date_worked)) AS INTEGER)) AS anio_semana,
    wl.project_key
FROM at_capacity cap
FULL OUTER JOIN at_availability avail
    ON avail.username = cap.username AND avail.dia = cap.dia
FULL OUTER JOIN at_workload wl
    ON wl.username = COALESCE(cap.username, avail.username)
    AND wl.dia = COALESCE(cap.dia, avail.dia)
FULL OUTER JOIN (
    SELECT user_id AS username, date_worked, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs GROUP BY user_id, date_worked
) wlog
    ON wlog.username = COALESCE(cap.username, avail.username, wl.username)
    AND wlog.date_worked = COALESCE(cap.dia, avail.dia, wl.dia);


-- ── FACT_SPRINT_METRICAS ─────────────────────────────────────
-- Granularidad: un registro por sprint
-- Agrega todas las metricas del sprint para reportes ejecutivos
DROP VIEW IF EXISTS FACT_SPRINT_METRICAS;
CREATE VIEW FACT_SPRINT_METRICAS AS
SELECT
    s.sprint_id,
    s.sprint_name                                                AS nombre_sprint,
    s.project_key,
    s.state                                                      AS estado_sprint,
    s.start_date                                                 AS fecha_inicio,
    s.end_date                                                   AS fecha_fin,
    s.goal                                                       AS objetivo,
    -- Conteo de issues
    COUNT(i.issue_key)                                           AS total_issues,
    SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END) AS issues_done,
    SUM(CASE WHEN i.status_category = 'In Progress' THEN 1 ELSE 0 END) AS issues_en_progreso,
    SUM(CASE WHEN i.status_category = 'To Do' THEN 1 ELSE 0 END) AS issues_pendientes,
    SUM(CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END)       AS bugs_totales,
    SUM(CASE WHEN i.issue_type = 'Bug'
             AND i.status_category = 'Done' THEN 1 ELSE 0 END)  AS bugs_resueltos,
    -- Completitud
    ROUND(100.0 * SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(i.issue_key), 0), 1)                   AS pct_completitud,
    ROUND(100.0 * SUM(CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(i.issue_key), 0), 1)                   AS pct_bugs,
    -- Horas
    ROUND(SUM(COALESCE(i.estimado_hs, 0)), 1)                   AS hs_estimadas_total,
    ROUND(SUM(COALESCE(w.horas_reales, 0)), 1)                  AS hs_reales_total,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)) -
          SUM(COALESCE(w.horas_reales, 0)), 1)                   AS variacion_hs,
    ROUND(100.0 * SUM(COALESCE(w.horas_reales, 0)) /
          NULLIF(SUM(COALESCE(i.estimado_hs, 0)), 0), 1)        AS pct_ejecucion_hs,
    -- Desarrolladores activos en el sprint
    COUNT(DISTINCT i.assignee_id)                                AS devs_activos,
    -- Lead time promedio
    ROUND(AVG(CASE WHEN i.resolved_date IS NOT NULL
        THEN julianday(date(i.resolved_date)) - julianday(date(i.created_date))
        END), 1)                                                 AS lead_time_promedio_dias
FROM rpt_sprints s
LEFT JOIN rpt_issues i ON i.sprint_id = s.sprint_id
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
GROUP BY s.sprint_id, s.sprint_name, s.project_key, s.state,
         s.start_date, s.end_date, s.goal;


-- ── FACT_CHANGELOG_ESTADOS ───────────────────────────────────
-- Granularidad: un registro por transicion de estado
-- Permite calcular tiempo en cada estado (cycle time por etapa)
DROP VIEW IF EXISTS FACT_CHANGELOG_ESTADOS;
CREATE VIEW FACT_CHANGELOG_ESTADOS AS
SELECT
    c.issue_key,
    i.project_key,
    i.issue_type,
    i.assignee_id                                                AS username,
    c.autor_id,
    c.fecha_cambio,
    date(c.fecha_cambio)                                         AS fecha,
    c.valor_desde                                                AS estado_anterior,
    c.valor_hasta                                                AS estado_nuevo,
    -- Tiempo en el estado anterior (hasta este cambio)
    ROUND(
        julianday(c.fecha_cambio) -
        julianday(LAG(c.fecha_cambio, 1, i.created_date)
            OVER (PARTITION BY c.issue_key ORDER BY c.fecha_cambio))
    , 2)                                                         AS dias_en_estado_anterior,
    i.sprint_id
FROM rpt_changelog c
JOIN rpt_issues i ON i.issue_key = c.issue_key
WHERE c.campo = 'status';


-- ── FACT_EPICAS_AVANCE ───────────────────────────────────────
-- Granularidad: un registro por epica
-- Avance de cada epica en issues y horas
DROP VIEW IF EXISTS FACT_EPICAS_AVANCE;
CREATE VIEW FACT_EPICAS_AVANCE AS
SELECT
    e.epic_key,
    e.project_key,
    e.nombre                                                     AS nombre_epic,
    e.status                                                     AS estado_epic,
    e.done                                                       AS epic_completada,
    COUNT(i.issue_key)                                           AS total_issues,
    SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END) AS issues_done,
    ROUND(100.0 * SUM(CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(i.issue_key), 0), 1)                   AS pct_avance,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)), 1)                   AS hs_estimadas,
    ROUND(SUM(COALESCE(w.horas_reales, 0)), 1)                  AS hs_reales,
    COUNT(DISTINCT i.assignee_id)                                AS devs_involucrados,
    SUM(CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END)       AS bugs
FROM rpt_epicas e
LEFT JOIN rpt_issues i ON i.epic_key = e.epic_key
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
GROUP BY e.epic_key, e.project_key, e.nombre, e.status, e.done;


-- ============================================================
-- VISTAS DE REPORTE — Listas para usar directamente
-- ============================================================

-- ── RPT_SEMANA_ACTUAL ────────────────────────────────────────
-- Vista rapida del estado de la semana en curso
DROP VIEW IF EXISTS RPT_SEMANA_ACTUAL;
CREATE VIEW RPT_SEMANA_ACTUAL AS
SELECT
    i.project_key,
    i.assignee_name,
    i.issue_type,
    i.status,
    i.status_category,
    COUNT(*)                                                     AS issues,
    ROUND(SUM(COALESCE(i.estimado_hs, 0)), 1)                   AS hs_estimadas,
    ROUND(SUM(COALESCE(w.horas_reales, 0)), 1)                  AS hs_reales
FROM rpt_issues i
LEFT JOIN (
    SELECT issue_key, SUM(hours_logged) AS horas_reales
    FROM rpt_worklogs
    WHERE date_worked >= date('now', 'weekday 0', '-7 days')
    GROUP BY issue_key
) w ON w.issue_key = i.issue_key
JOIN rpt_sprints s ON s.sprint_id = i.sprint_id AND s.state = 'active'
GROUP BY i.project_key, i.assignee_name, i.issue_type, i.status, i.status_category;


-- ── RPT_CAPACIDAD_SEMANA ─────────────────────────────────────
-- Capacidad del equipo esta semana: planificado vs disponible vs real
DROP VIEW IF EXISTS RPT_CAPACIDAD_SEMANA;
CREATE VIEW RPT_CAPACIDAD_SEMANA AS
SELECT
    fc.username,
    fc.nombre_persona,
    fc.team_id,
    ROUND(SUM(fc.horas_capacidad), 1)                           AS capacidad_total_hs,
    ROUND(SUM(fc.horas_planificadas), 1)                        AS planificado_hs,
    ROUND(SUM(fc.horas_disponibles), 1)                         AS disponible_hs,
    ROUND(SUM(fc.horas_reales), 1)                              AS real_hs,
    ROUND(SUM(fc.horas_capacidad) - SUM(fc.horas_planificadas), 1) AS sin_asignar_hs,
    ROUND(100.0 * SUM(fc.horas_reales) /
          NULLIF(SUM(fc.horas_capacidad), 0), 1)                AS pct_utilizacion
FROM FACT_CAPACIDAD fc
WHERE fc.fecha >= date('now', 'weekday 0', '-7 days')
  AND fc.fecha <= date('now', 'weekday 0', '+5 days')
GROUP BY fc.username, fc.nombre_persona, fc.team_id
ORDER BY real_hs DESC;


-- ── RPT_BUGS_ABIERTOS ────────────────────────────────────────
-- Bugs activos ordenados por antiguedad
DROP VIEW IF EXISTS RPT_BUGS_ABIERTOS;
CREATE VIEW RPT_BUGS_ABIERTOS AS
SELECT
    i.issue_key,
    i.project_key,
    i.summary                                                    AS resumen,
    i.status,
    i.priority,
    i.assignee_name,
    i.created_date,
    CAST(julianday('now') - julianday(i.created_date) AS INTEGER) AS dias_abierto,
    COALESCE(i.estimado_hs, 0)                                   AS estimado_hs,
    COALESCE(w.horas_reales, 0)                                  AS hs_trabajadas
FROM rpt_issues i
LEFT JOIN (
    SELECT issue_key, SUM(hours_logged) AS horas_reales
    FROM rpt_worklogs GROUP BY issue_key
) w ON w.issue_key = i.issue_key
WHERE i.issue_type = 'Bug'
  AND i.status_category != 'Done'
ORDER BY dias_abierto DESC;


-- ── RPT_VELOCITY_HISTORICA ───────────────────────────────────
-- Velocidad historica por sprint para ver tendencia
DROP VIEW IF EXISTS RPT_VELOCITY_HISTORICA;
CREATE VIEW RPT_VELOCITY_HISTORICA AS
SELECT
    sm.proyecto                                                  AS project_key,
    sm.sprint_id,
    sm.nombre_sprint,
    sm.fecha_inicio,
    sm.fecha_fin,
    sm.total_issues,
    sm.issues_done,
    sm.pct_completitud,
    sm.hs_estimadas_total,
    sm.hs_reales_total,
    sm.variacion_hs,
    sm.pct_ejecucion_hs,
    sm.bugs_totales,
    sm.pct_bugs,
    sm.lead_time_promedio_dias,
    -- Tendencia vs sprint anterior
    sm.hs_reales_total - LAG(sm.hs_reales_total)
        OVER (PARTITION BY sm.proyecto ORDER BY sm.fecha_inicio) AS variacion_hs_vs_anterior
FROM (
    SELECT
        project_key                                              AS proyecto,
        sprint_id, nombre_sprint, fecha_inicio, fecha_fin,
        total_issues, issues_done, pct_completitud,
        hs_estimadas_total, hs_reales_total, variacion_hs, pct_ejecucion_hs,
        bugs_totales, pct_bugs, lead_time_promedio_dias
    FROM FACT_SPRINT_METRICAS
    WHERE estado_sprint IN ('active','closed')
) sm
ORDER BY sm.proyecto, sm.fecha_inicio;
