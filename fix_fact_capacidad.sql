DROP VIEW IF EXISTS FACT_CAPACIDAD;
CREATE VIEW FACT_CAPACIDAD AS
SELECT
    usr         AS username,
    nombre      AS nombre_persona,
    fecha,
    team_id,
    project_key,
    SUM(horas_capacidad)    AS horas_capacidad,
    SUM(horas_planificadas) AS horas_planificadas,
    SUM(horas_reales)       AS horas_reales,
    ROUND(SUM(horas_capacidad)   - SUM(horas_planificadas), 2) AS horas_sin_planificar,
    ROUND(SUM(horas_planificadas)- SUM(horas_reales), 2)       AS variacion_plan_real,
    CASE WHEN SUM(horas_capacidad)    = 0 THEN NULL
         ELSE ROUND(100.0 * SUM(horas_reales) / SUM(horas_capacidad), 1)
    END AS pct_utilizacion,
    CASE WHEN SUM(horas_planificadas) = 0 THEN NULL
         ELSE ROUND(100.0 * SUM(horas_reales) / SUM(horas_planificadas), 1)
    END AS pct_ejecucion_vs_plan,
    CAST(strftime('%Y', fecha) AS INTEGER)     AS anio,
    CAST(strftime('%m', fecha) AS INTEGER)     AS mes,
    strftime('%Y', fecha) || '-W' ||
        printf('%02d', CAST(strftime('%W', fecha) AS INTEGER)) AS anio_semana
FROM (
    -- RAMA 1: base desde at_capacity (tiene username)
    SELECT
        cap.username        AS usr,
        cap.full_name       AS nombre,
        cap.dia             AS fecha,
        cap.team_id,
        COALESCE(wl.project_key, '') AS project_key,
        cap.horas_cap                AS horas_capacidad,
        COALESCE(wl.horas_plan,  0)  AS horas_planificadas,
        COALESCE(wr.horas_reales,0)  AS horas_reales
    FROM at_capacity cap
    LEFT JOIN at_workload wl
        ON  wl.username = cap.username
        AND wl.dia      = cap.dia
        AND wl.team_id  = cap.team_id
    LEFT JOIN (
        -- worklogs agrupados: usa user_id de rpt_worklogs
        SELECT user_id, date_worked, ROUND(SUM(hours_logged), 2) AS horas_reales
        FROM rpt_worklogs
        GROUP BY user_id, date_worked
    ) wr
        ON  wr.user_id     = cap.username
        AND wr.date_worked = cap.dia

    UNION ALL

    -- RAMA 2: worklogs fuera del rango de at_capacity (usa user_id)
    SELECT
        w.user_id       AS usr,
        w.user_name     AS nombre,
        w.date_worked   AS fecha,
        NULL            AS team_id,
        w.project_key,
        0               AS horas_capacidad,
        0               AS horas_planificadas,
        ROUND(SUM(w.hours_logged), 2) AS horas_reales
    FROM rpt_worklogs w
    WHERE NOT EXISTS (
        SELECT 1 FROM at_capacity cap
        WHERE cap.username = w.user_id
          AND cap.dia      = w.date_worked
    )
    GROUP BY w.user_id, w.user_name, w.date_worked, w.project_key
)
GROUP BY usr, nombre, fecha, team_id, project_key;


DROP VIEW IF EXISTS RPT_CAPACIDAD_SEMANA;
CREATE VIEW RPT_CAPACIDAD_SEMANA AS
SELECT
    fc.username,
    fc.nombre_persona,
    fc.team_id,
    ROUND(SUM(fc.horas_capacidad),    1) AS capacidad_total_hs,
    ROUND(SUM(fc.horas_planificadas), 1) AS planificado_hs,
    ROUND(SUM(fc.horas_reales),       1) AS real_hs,
    ROUND(SUM(fc.horas_capacidad) - SUM(fc.horas_planificadas), 1) AS sin_planificar_hs,
    CASE WHEN SUM(fc.horas_capacidad) = 0 THEN NULL
         ELSE ROUND(100.0 * SUM(fc.horas_reales) / SUM(fc.horas_capacidad), 1)
    END AS pct_utilizacion
FROM FACT_CAPACIDAD fc
WHERE fc.fecha >= date('now', '-7 days')
  AND fc.fecha <= date('now')
GROUP BY fc.username, fc.nombre_persona, fc.team_id
ORDER BY real_hs DESC;