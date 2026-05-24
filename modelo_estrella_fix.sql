-- ============================================================
-- FIXES — Vistas compatibles con SQLite
-- Ejecutar este archivo COMPLETO en DBeaver para reemplazar
-- las 4 vistas que fallaron
-- ============================================================


-- ── DIM_TIEMPO ───────────────────────────────────────────────
-- SQLite soporta CTE recursiva pero no dentro de una vista
-- en todas las versiones. Solución: usar una tabla de fechas
-- generada desde los datos reales que ya tenemos.

DROP VIEW IF EXISTS DIM_TIEMPO;
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
    -- Todas las fechas que aparecen en los datos reales
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
    UNION SELECT planned_start        FROM at_eventos WHERE planned_start IS NOT NULL
    UNION SELECT planned_end          FROM at_eventos WHERE planned_end IS NOT NULL
)
WHERE fecha IS NOT NULL
ORDER BY fecha;


-- ── FACT_ISSUES ──────────────────────────────────────────────
-- Removido LEAD() que puede fallar en SQLite antiguo
-- Cycle time simplificado usando conteo de dias en changelog

DROP VIEW IF EXISTS FACT_ISSUES;
CREATE VIEW FACT_ISSUES AS
SELECT
    i.issue_key,
    i.project_key,
    i.sprint_id,
    i.epic_key,
    i.assignee_id                                                AS username,
    i.assignee_name,
    i.issue_type,
    i.status,
    i.status_category,
    i.priority,
    date(i.created_date)                                         AS fecha_creacion,
    date(i.updated_date)                                         AS fecha_actualizacion,
    date(i.resolved_date)                                        AS fecha_resolucion,
    COALESCE(i.estimado_hs, 0)                                   AS estimado_hs,
    COALESCE(i.restante_hs, 0)                                   AS restante_hs,
    COALESCE(i.estimado_total_hs, 0)                             AS estimado_total_hs,
    COALESCE(i.restante_total_hs, 0)                             AS restante_total_hs,
    COALESCE(w.horas_reales, 0)                                  AS horas_reales,
    ROUND(COALESCE(i.estimado_hs, 0) - COALESCE(w.horas_reales, 0), 2) AS variacion_hs,
    CASE
        WHEN COALESCE(i.estimado_hs, 0) = 0 THEN NULL
        ELSE ROUND(100.0 * COALESCE(w.horas_reales, 0) /
                   COALESCE(i.estimado_hs, 0), 1)
    END                                                          AS pct_ejecutado,
    -- Lead time en dias
    CASE
        WHEN i.resolved_date IS NOT NULL
        THEN CAST(julianday(date(i.resolved_date)) -
                  julianday(date(i.created_date)) AS INTEGER)
        ELSE CAST(julianday(date('now')) -
                  julianday(date(i.created_date)) AS INTEGER)
    END                                                          AS lead_time_dias,
    -- Cycle time: dias entre primer movimiento a In Progress y resolucion
    CASE
        WHEN ip.fecha_inicio_progress IS NOT NULL AND i.resolved_date IS NOT NULL
        THEN CAST(julianday(date(i.resolved_date)) -
                  julianday(date(ip.fecha_inicio_progress)) AS INTEGER)
        WHEN ip.fecha_inicio_progress IS NOT NULL
        THEN CAST(julianday(date('now')) -
                  julianday(date(ip.fecha_inicio_progress)) AS INTEGER)
        ELSE NULL
    END                                                          AS cycle_time_dias,
    COALESCE(i.cant_comentarios, 0)                              AS cant_comentarios,
    COALESCE(i.cant_subtareas, 0)                                AS cant_subtareas,
    COALESCE(i.cant_links, 0)                                    AS cant_links,
    COALESCE(i.cant_watchers, 0)                                 AS cant_watchers,
    CASE WHEN i.issue_type = 'Bug' THEN 1 ELSE 0 END            AS es_bug,
    CASE WHEN i.status_category = 'Done' THEN 1 ELSE 0 END      AS esta_done,
    CASE WHEN i.resolved_date IS NOT NULL THEN 1 ELSE 0 END      AS fue_resuelto,
    i.version_fix,
    i.componentes,
    i.summary                                                    AS resumen
FROM rpt_issues i
LEFT JOIN (
    SELECT issue_key, ROUND(SUM(hours_logged), 2) AS horas_reales
    FROM rpt_worklogs
    GROUP BY issue_key
) w ON w.issue_key = i.issue_key
-- Fecha en que el issue entro por primera vez a In Progress
LEFT JOIN (
    SELECT issue_key,
           MIN(fecha_cambio) AS fecha_inicio_progress
    FROM rpt_changelog
    WHERE campo = 'status'
      AND (valor_hasta LIKE '%Progress%'
           OR valor_hasta LIKE '%curso%'
           OR valor_hasta LIKE '%Progreso%')
    GROUP BY issue_key
) ip ON ip.issue_key = i.issue_key;


-- ── FACT_CAPACIDAD ───────────────────────────────────────────
-- SQLite no soporta FULL OUTER JOIN
-- Solucion: UNION de LEFT JOINs para simular el mismo resultado

DROP VIEW IF EXISTS FACT_CAPACIDAD;
CREATE VIEW FACT_CAPACIDAD AS
SELECT
    username,
    nombre_persona,
    fecha,
    team_id,
    SUM(horas_capacidad)    AS horas_capacidad,
    SUM(horas_disponibles)  AS horas_disponibles,
    SUM(horas_planificadas) AS horas_planificadas,
    SUM(horas_reales)       AS horas_reales,
    ROUND(SUM(horas_capacidad) - SUM(horas_planificadas), 2)     AS horas_asignadas,
    ROUND(SUM(horas_planificadas) - SUM(horas_reales), 2)        AS variacion_plan_real,
    CASE
        WHEN SUM(horas_capacidad) = 0 THEN NULL
        ELSE ROUND(100.0 * SUM(horas_reales) / SUM(horas_capacidad), 1)
    END                                                           AS pct_utilizacion,
    CASE
        WHEN SUM(horas_planificadas) = 0 THEN NULL
        ELSE ROUND(100.0 * SUM(horas_reales) / SUM(horas_planificadas), 1)
    END                                                           AS pct_ejecucion_vs_plan,
    CAST(strftime('%Y', fecha) AS INTEGER)                        AS anio,
    CAST(strftime('%m', fecha) AS INTEGER)                        AS mes,
    strftime('%Y', fecha) || '-W' ||
        printf('%02d', CAST(strftime('%W', fecha) AS INTEGER))    AS anio_semana,
    project_key
FROM (
    -- Rama 1: capacity como base
    SELECT
        cap.username, cap.full_name AS nombre_persona, cap.dia AS fecha,
        cap.team_id,
        cap.horas_cap      AS horas_capacidad,
        COALESCE(av.horas_disp, 0) AS horas_disponibles,
        COALESCE(wl.horas_plan, 0) AS horas_planificadas,
        COALESCE(wr.horas_reales, 0) AS horas_reales,
        wl.project_key
    FROM at_capacity cap
    LEFT JOIN at_availability av
        ON av.username = cap.username AND av.dia = cap.dia
    LEFT JOIN at_workload wl
        ON wl.username = cap.username AND wl.dia = cap.dia
    LEFT JOIN (
        SELECT user_id AS username, date_worked, ROUND(SUM(hours_logged),2) AS horas_reales
        FROM rpt_worklogs GROUP BY user_id, date_worked
    ) wr ON wr.username = cap.username AND wr.date_worked = cap.dia

    UNION ALL

    -- Rama 2: worklogs sin capacity (dias con horas registradas fuera del rango AT)
    SELECT
        wr.user_id AS username, wr.user_name AS nombre_persona,
        wr.date_worked AS fecha, NULL AS team_id,
        0 AS horas_capacidad, 0 AS horas_disponibles,
        0 AS horas_planificadas, wr.horas_reales,
        i.project_key
    FROM (
        SELECT user_id, user_name, date_worked, ROUND(SUM(hours_logged),2) AS horas_reales
        FROM rpt_worklogs GROUP BY user_id, user_name, date_worked
    ) wr
    LEFT JOIN rpt_issues i ON i.issue_key = (
        SELECT issue_key FROM rpt_worklogs
        WHERE user_id = wr.user_id AND date_worked = wr.date_worked
        LIMIT 1
    )
    WHERE NOT EXISTS (
        SELECT 1 FROM at_capacity cap
        WHERE cap.username = wr.user_id AND cap.dia = wr.date_worked
    )
)
GROUP BY username, nombre_persona, fecha, team_id, project_key;


-- ── RPT_CAPACIDAD_SEMANA ─────────────────────────────────────
-- Depende de FACT_CAPACIDAD — se recrea para asegurar consistencia

DROP VIEW IF EXISTS RPT_CAPACIDAD_SEMANA;
CREATE VIEW RPT_CAPACIDAD_SEMANA AS
SELECT
    fc.username,
    fc.nombre_persona,
    fc.team_id,
    ROUND(SUM(fc.horas_capacidad), 1)                            AS capacidad_total_hs,
    ROUND(SUM(fc.horas_planificadas), 1)                         AS planificado_hs,
    ROUND(SUM(fc.horas_disponibles), 1)                          AS disponible_hs,
    ROUND(SUM(fc.horas_reales), 1)                               AS real_hs,
    ROUND(SUM(fc.horas_capacidad) -
          SUM(fc.horas_planificadas), 1)                         AS sin_asignar_hs,
    CASE
        WHEN SUM(fc.horas_capacidad) = 0 THEN NULL
        ELSE ROUND(100.0 * SUM(fc.horas_reales) /
                   SUM(fc.horas_capacidad), 1)
    END                                                          AS pct_utilizacion
FROM FACT_CAPACIDAD fc
WHERE fc.fecha >= date('now', '-7 days')
  AND fc.fecha <= date('now')
GROUP BY fc.username, fc.nombre_persona, fc.team_id
ORDER BY real_hs DESC;
