DROP VIEW IF EXISTS VW_NOVEDADES_LABORALES;

CREATE VIEW VW_NOVEDADES_LABORALES AS
WITH eventos AS (
    SELECT
        date(COALESCE(w.planned_start, w.planned_end)) AS fecha,
        w.person_id,
        COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
        w.project_id,
        COALESCE(me.nombre_rpt, me.nombre_at, 'Sin equipo') AS equipo,
        LOWER(TRIM(COALESCE(w.event_type, ''))) AS event_type_raw,
        LOWER(TRIM(COALESCE(w.summary, ''))) AS summary_raw,
        COALESCE(w.tiempo_empleado, w.orig_estimate, 0) AS horas_base
    FROM at_workload w
    LEFT JOIN map_personas mp ON mp.person_id = w.person_id
    LEFT JOIN map_equipo_proyecto me ON me.project_id = w.project_id
), normalizados AS (
    SELECT
        fecha,
        person_id,
        persona,
        project_id,
        equipo,
        CASE
            WHEN event_type_raw IN ('day_off', 'day off', 'day-off', 'dayoff')
                OR summary_raw LIKE '%day off%'
                THEN 'day_off'
            WHEN event_type_raw IN ('holiday', 'feriado', 'festivo')
                OR summary_raw LIKE '%holiday%'
                OR summary_raw LIKE '%feriado%'
                THEN 'holiday'
            WHEN event_type_raw IN ('overtime', 'extra_hours', 'extra hours', 'horas_extra', 'horas extras')
                OR summary_raw LIKE '%overtime%'
                OR summary_raw LIKE '%hora extra%'
                OR summary_raw LIKE '%horas extras%'
                THEN 'overtime'
            ELSE NULL
        END AS event_type,
        horas_base
    FROM eventos
    WHERE fecha IS NOT NULL
)
SELECT
    fecha,
    person_id,
    persona,
    project_id,
    equipo,
    event_type,
    CASE event_type
        WHEN 'day_off' THEN 'Day off'
        WHEN 'holiday' THEN 'Holiday'
        WHEN 'overtime' THEN 'Horas extras'
        ELSE event_type
    END AS event_label,
    ROUND(SUM(COALESCE(horas_base, 0)), 2) AS horas,
    COUNT(*) AS registros
FROM normalizados
WHERE event_type IS NOT NULL
GROUP BY fecha, person_id, persona, project_id, equipo, event_type;
