DROP VIEW IF EXISTS VW_REPORTE_HORAS_DETALLE;
DROP VIEW IF EXISTS VW_REPORTE_HORAS_PERSONA_TIPO;
DROP VIEW IF EXISTS VW_REPORTE_HORAS_EQUIPO_TIPO;

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
    CASE LOWER(TRIM(COALESCE(w.event_type, '')))
        WHEN 'booking' THEN 'booking'
        WHEN 'day_off' THEN 'day_off'
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
