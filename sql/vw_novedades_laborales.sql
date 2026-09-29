DROP VIEW IF EXISTS VW_NOVEDADES_LABORALES;

CREATE VIEW VW_NOVEDADES_LABORALES AS
WITH RECURSIVE eventos_at AS (
    SELECT
        'AT-' || w.workload_id AS registro_id,
        date(COALESCE(w.planned_start, w.planned_end)) AS fecha,
        date(COALESCE(w.planned_end, w.planned_start)) AS fecha_fin_raw,
        w.person_id,
        COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
        w.project_id,
        COALESCE(me.nombre_rpt, me.nombre_at, 'Sin equipo') AS equipo,
        LOWER(REPLACE(TRIM(COALESCE(w.event_type, '')), ' ', '_')) AS event_type_raw,
        LOWER(TRIM(COALESCE(w.summary, ''))) AS summary_raw,
        COALESCE(w.tiempo_empleado, w.orig_estimate, 0) AS horas_base,
        'AT' AS fuente
    FROM at_workload w
    LEFT JOIN map_personas mp ON mp.person_id = w.person_id
    LEFT JOIN map_equipo_proyecto me ON me.project_id = w.project_id
    WHERE w.person_id IS NOT NULL
), eventos_pgi AS (
    SELECT
        'PGI-' || p.pgi_id AS registro_id,
        date(p.fecha) AS fecha,
        date(p.fecha) AS fecha_fin_raw,
        p.person_id,
        COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
        p.project_id,
        COALESCE(me.nombre_rpt, me.nombre_at, 'Sin equipo') AS equipo,
        LOWER(REPLACE(TRIM(COALESCE(p.incidence_type, 'pgi')), ' ', '_')) AS event_type_raw,
        LOWER(TRIM(COALESCE(p.comentario, ''))) AS summary_raw,
        COALESCE(p.horas, 0) AS horas_base,
        'PGI' AS fuente
    FROM pgi_workload p
    LEFT JOIN map_personas mp ON mp.person_id = p.person_id
    LEFT JOIN map_equipo_proyecto me ON me.project_id = p.project_id
    WHERE COALESCE(p.activo, 1) = 1
      AND LOWER(REPLACE(TRIM(COALESCE(p.incidence_type, 'pgi')), ' ', '_')) IN ('day_off', 'holiday', 'sick_leave', 'vacation')
), eventos AS (
    SELECT * FROM eventos_at
    UNION ALL
    SELECT * FROM eventos_pgi
), normalizados AS (
    SELECT
        registro_id,
        fecha,
        CASE
            WHEN fecha_fin_raw IS NOT NULL AND fecha_fin_raw > fecha THEN date(fecha_fin_raw, '-1 day')
            ELSE fecha
        END AS fecha_fin,
        person_id,
        persona,
        project_id,
        equipo,
        fuente,
        CASE
            WHEN event_type_raw IN ('day_off', 'day-off', 'dayoff', 'time_off')
                OR summary_raw LIKE '%day off%'
                OR summary_raw LIKE '%day-off%'
                THEN 'day_off'
            WHEN event_type_raw IN ('holiday', 'feriado', 'festivo')
                OR summary_raw LIKE '%holiday%'
                OR summary_raw LIKE '%feriado%'
                OR summary_raw LIKE '%festivo%'
                THEN 'holiday'
            WHEN event_type_raw IN ('sick_leave', 'sickleave', 'sick', 'medical_leave', 'licencia_medica')
                OR summary_raw LIKE '%sick leave%'
                OR summary_raw LIKE '%licencia medica%'
                OR summary_raw LIKE '%licencia médica%'
                THEN 'sick_leave'
            WHEN event_type_raw IN ('vacation', 'vacations', 'vacacion', 'vacación', 'vacaciones', 'vacation_day', 'pto', 'paid_time_off')
                OR summary_raw LIKE '%vacation%'
                OR summary_raw LIKE '%vacacion%'
                OR summary_raw LIKE '%vacación%'
                OR summary_raw LIKE '%vacaciones%'
                OR summary_raw LIKE '%pto%'
                THEN 'vacation'
            ELSE NULL
        END AS event_type,
        horas_base
    FROM eventos
    WHERE fecha IS NOT NULL
), dias(registro_id, dia) AS (
    SELECT registro_id, fecha
    FROM normalizados
    WHERE event_type IN ('day_off', 'holiday', 'sick_leave', 'vacation')
    UNION ALL
    SELECT d.registro_id, date(d.dia, '+1 day')
    FROM dias d
    JOIN normalizados n ON n.registro_id = d.registro_id
    WHERE d.dia < n.fecha_fin
), dias_laborables AS (
    SELECT
        registro_id,
        SUM(CASE WHEN CAST(strftime('%w', dia) AS INTEGER) BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS dias
    FROM dias
    GROUP BY registro_id
), calculados AS (
    SELECT
        n.registro_id,
        n.fecha,
        n.fecha_fin,
        n.person_id,
        n.persona,
        n.project_id,
        n.equipo,
        n.event_type,
        n.fuente,
        COALESCE(dl.dias, 0) AS dias,
        CASE
            WHEN COALESCE(n.horas_base, 0) > 0 THEN ROUND(COALESCE(n.horas_base, 0), 2)
            ELSE COALESCE(dl.dias, 0) * 8.0
        END AS horas
    FROM normalizados n
    LEFT JOIN dias_laborables dl ON dl.registro_id = n.registro_id
    WHERE n.event_type IS NOT NULL
)
SELECT
    fecha,
    fecha_fin,
    person_id,
    persona,
    project_id,
    equipo,
    event_type,
    CASE event_type
        WHEN 'day_off' THEN 'Day off'
        WHEN 'holiday' THEN 'Holiday'
        WHEN 'sick_leave' THEN 'Sick leave'
        WHEN 'vacation' THEN 'Vacation'
        ELSE event_type
    END AS event_label,
    SUM(COALESCE(dias, 0)) AS dias,
    ROUND(SUM(COALESCE(horas, 0)), 2) AS horas,
    COUNT(*) AS registros,
    GROUP_CONCAT(DISTINCT fuente) AS fuentes
FROM calculados
GROUP BY fecha, fecha_fin, person_id, persona, project_id, equipo, event_type;
