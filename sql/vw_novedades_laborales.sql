DROP VIEW IF EXISTS VW_NOVEDADES_LABORALES;

CREATE VIEW VW_NOVEDADES_LABORALES AS
WITH RECURSIVE eventos AS (
    SELECT
        w.workload_id,
        date(COALESCE(w.planned_start, w.planned_end)) AS fecha,
        date(COALESCE(w.planned_end, w.planned_start)) AS fecha_fin_raw,
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
        workload_id,
        fecha,
        CASE
            WHEN fecha_fin_raw IS NOT NULL AND fecha_fin_raw > fecha THEN date(fecha_fin_raw, '-1 day')
            ELSE fecha
        END AS fecha_fin_inclusiva,
        person_id,
        persona,
        project_id,
        equipo,
        CASE
            WHEN event_type_raw IN ('day_off', 'day off', 'day-off', 'dayoff', 'time off', 'time_off')
                OR summary_raw LIKE '%day off%'
                OR summary_raw LIKE '%day-off%'
                THEN 'day_off'
            WHEN event_type_raw IN ('holiday', 'feriado', 'festivo', 'vacation', 'vacations', 'vacacion', 'vacación', 'vacaciones', 'vacation day', 'vacation_day', 'pto', 'paid time off', 'paid_time_off')
                OR summary_raw LIKE '%holiday%'
                OR summary_raw LIKE '%feriado%'
                OR summary_raw LIKE '%festivo%'
                OR summary_raw LIKE '%vacation%'
                OR summary_raw LIKE '%vacacion%'
                OR summary_raw LIKE '%vacación%'
                OR summary_raw LIKE '%vacaciones%'
                OR summary_raw LIKE '%pto%'
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
), dias(workload_id, dia) AS (
    SELECT workload_id, fecha
    FROM normalizados
    WHERE event_type IN ('day_off', 'holiday')
    UNION ALL
    SELECT d.workload_id, date(d.dia, '+1 day')
    FROM dias d
    JOIN normalizados n ON n.workload_id = d.workload_id
    WHERE d.dia < n.fecha_fin_inclusiva
), dias_laborables AS (
    SELECT
        workload_id,
        SUM(CASE WHEN CAST(strftime('%w', dia) AS INTEGER) BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS dias_laborables
    FROM dias
    GROUP BY workload_id
), calculados AS (
    SELECT
        n.fecha,
        n.person_id,
        n.persona,
        n.project_id,
        n.equipo,
        n.event_type,
        CASE
            WHEN n.event_type IN ('day_off', 'holiday') AND COALESCE(n.horas_base, 0) <= 0
                THEN COALESCE(dl.dias_laborables, 0) * 8.0
            ELSE COALESCE(n.horas_base, 0)
        END AS horas_calculadas
    FROM normalizados n
    LEFT JOIN dias_laborables dl ON dl.workload_id = n.workload_id
    WHERE n.event_type IS NOT NULL
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
        WHEN 'holiday' THEN 'Vacaciones'
        WHEN 'overtime' THEN 'Horas extras'
        ELSE event_type
    END AS event_label,
    ROUND(SUM(COALESCE(horas_calculadas, 0)), 2) AS horas,
    COUNT(*) AS registros
FROM calculados
GROUP BY fecha, person_id, persona, project_id, equipo, event_type;
