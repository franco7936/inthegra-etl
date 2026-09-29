DROP VIEW IF EXISTS VW_REPORTE_HORAS_DETALLE;
DROP VIEW IF EXISTS VW_REPORTE_HORAS_PERSONA_TIPO;
DROP VIEW IF EXISTS VW_REPORTE_HORAS_EQUIPO_TIPO;

CREATE VIEW VW_REPORTE_HORAS_DETALLE AS
WITH RECURSIVE at_base AS (
    SELECT
        w.workload_id,
        w.person_id,
        COALESCE(mp.full_name_at, mp.user_name_rpt, 'Sin persona') AS persona,
        w.project_id,
        COALESCE(me.nombre_rpt, me.nombre_at, 'Sin proyecto') AS proyecto,
        me.project_key_rpt,
        me.team_id_at,
        w.issue_key,
        CASE LOWER(TRIM(COALESCE(w.event_type, '')))
            WHEN 'booking' THEN 'booking'
            WHEN 'day_off' THEN 'day_off'
            WHEN 'day off' THEN 'day_off'
            WHEN 'holiday' THEN 'holiday'
            WHEN 'jira_issue' THEN 'jira_issue'
            WHEN 'jira issue' THEN 'jira_issue'
            WHEN 'placeholder' THEN 'placeholder'
            WHEN 'sick_leave' THEN 'sick_leave'
            WHEN 'sick leave' THEN 'sick_leave'
            WHEN 'vacation' THEN 'vacation'
            WHEN 'worklog' THEN 'worklog'
            ELSE LOWER(TRIM(COALESCE(w.event_type, 'sin_tipo')))
        END AS event_type,
        w.activity_detail_at,
        w.summary,
        date(w.planned_start) AS fecha,
        CASE
            WHEN date(w.planned_end) IS NOT NULL AND date(w.planned_end) > date(w.planned_start) THEN date(w.planned_end, '-1 day')
            ELSE date(w.planned_start)
        END AS fecha_fin,
        w.planned_start,
        w.planned_end,
        w.orig_estimate,
        w.rem_estimate,
        COALESCE(w.tiempo_empleado, 0) AS horas_base,
        w.fecha_carga
    FROM at_workload w
    LEFT JOIN map_personas mp ON mp.person_id = w.person_id
    LEFT JOIN map_equipo_proyecto me ON me.project_id = w.project_id
    WHERE w.person_id IS NOT NULL AND w.project_id IS NOT NULL
), dias_at(workload_id, dia) AS (
    SELECT workload_id, fecha
    FROM at_base
    WHERE event_type IN ('day_off', 'holiday', 'sick_leave', 'vacation')
      AND fecha IS NOT NULL
    UNION ALL
    SELECT d.workload_id, date(d.dia, '+1 day')
    FROM dias_at d
    JOIN at_base b ON b.workload_id = d.workload_id
    WHERE d.dia < b.fecha_fin
), dias_laborables_at AS (
    SELECT
        workload_id,
        SUM(CASE WHEN CAST(strftime('%w', dia) AS INTEGER) BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS dias
    FROM dias_at
    GROUP BY workload_id
), at_calculado AS (
    SELECT
        b.*,
        CASE
            WHEN b.event_type IN ('day_off', 'holiday', 'sick_leave', 'vacation') AND COALESCE(b.horas_base, 0) <= 0
                THEN COALESCE(dl.dias, 0) * 8.0
            ELSE COALESCE(b.horas_base, 0)
        END AS horas_at_calculadas
    FROM at_base b
    LEFT JOIN dias_laborables_at dl ON dl.workload_id = b.workload_id
)
SELECT
    'AT-' || workload_id AS registro_id,
    'AT' AS fuente,
    workload_id,
    NULL AS pgi_id,
    person_id,
    persona,
    project_id,
    proyecto,
    project_key_rpt,
    team_id_at,
    issue_key,
    event_type,
    activity_detail_at,
    summary,
    fecha,
    planned_start,
    planned_end,
    orig_estimate,
    rem_estimate,
    ROUND(COALESCE(horas_at_calculadas, 0), 2) AS horas_at,
    0.0 AS horas_pgi,
    ROUND(COALESCE(horas_at_calculadas, 0), 2) AS tiempo_empleado,
    fecha_carga
FROM at_calculado

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
    p.incidence_type AS activity_detail_at,
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
WHERE COALESCE(p.activo, 1) = 1;

CREATE VIEW VW_REPORTE_HORAS_PERSONA_TIPO AS
SELECT
    fecha,
    person_id,
    persona,
    project_id,
    proyecto,
    project_key_rpt,
    event_type,
    activity_detail_at,
    ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at,
    ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi,
    ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas,
    COUNT(*) AS registros
FROM VW_REPORTE_HORAS_DETALLE
GROUP BY fecha, person_id, persona, project_id, proyecto, project_key_rpt, event_type, activity_detail_at;

CREATE VIEW VW_REPORTE_HORAS_EQUIPO_TIPO AS
SELECT
    fecha,
    project_id,
    proyecto,
    project_key_rpt,
    event_type,
    activity_detail_at,
    ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at,
    ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi,
    ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas,
    COUNT(DISTINCT person_id) AS personas,
    COUNT(*) AS registros
FROM VW_REPORTE_HORAS_DETALLE
GROUP BY fecha, project_id, proyecto, project_key_rpt, event_type, activity_detail_at;
