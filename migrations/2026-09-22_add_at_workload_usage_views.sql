-- Vistas base para consumir planificado y usado desde at_workload.

DROP VIEW IF EXISTS AT_WORKLOAD_RESUMEN_DIARIO;
CREATE VIEW AT_WORKLOAD_RESUMEN_DIARIO AS
SELECT
    username,
    team_id,
    project_key,
    issue_key,
    dia AS fecha,
    ROUND(SUM(CASE WHEN COALESCE(tipo_registro, 'PLANIFICADO') = 'PLANIFICADO' THEN COALESCE(horas_plan, 0) ELSE 0 END), 2) AS horas_planificadas,
    ROUND(SUM(CASE WHEN tipo_registro = 'WORKLOG' THEN COALESCE(horas_usadas, 0) ELSE 0 END), 2) AS horas_usadas,
    SUM(CASE WHEN tipo_registro = 'WORKLOG' THEN COALESCE(time_spent_seconds, 0) ELSE 0 END) AS time_spent_seconds,
    SUM(CASE WHEN tipo_registro = 'WORKLOG' THEN COALESCE(worklog_count, 0) ELSE 0 END) AS worklog_count
FROM at_workload
GROUP BY username, team_id, project_key, issue_key, dia;


DROP VIEW IF EXISTS RPT_AT_HORAS_USADAS_EVENTO;
CREATE VIEW RPT_AT_HORAS_USADAS_EVENTO AS
SELECT
    e.evento_id,
    e.username,
    e.team_id,
    e.issue_key,
    e.event_type,
    e.summary,
    e.planned_start,
    e.planned_end,
    e.orig_estimate AS horas_estimadas_at,
    e.rem_estimate  AS horas_restantes_at,
    ROUND(COALESCE(SUM(w.horas_usadas), 0), 2) AS horas_usadas_at
FROM at_eventos e
LEFT JOIN AT_WORKLOAD_RESUMEN_DIARIO w
    ON w.username = e.username
   AND w.issue_key = e.issue_key
   AND w.fecha >= NULLIF(e.planned_start, '')
   AND w.fecha <= NULLIF(e.planned_end, '')
GROUP BY
    e.evento_id,
    e.username,
    e.team_id,
    e.issue_key,
    e.event_type,
    e.summary,
    e.planned_start,
    e.planned_end,
    e.orig_estimate,
    e.rem_estimate;


DROP VIEW IF EXISTS RPT_AT_HORAS_PERSONA_TIPO;
CREATE VIEW RPT_AT_HORAS_PERSONA_TIPO AS
SELECT
    v.username,
    COALESCE(u.full_name, v.username) AS nombre_persona,
    v.team_id,
    eq.nombre AS equipo,
    v.event_type,
    ROUND(SUM(v.horas_estimadas_at), 2) AS horas_estimadas_at,
    ROUND(SUM(v.horas_usadas_at), 2)    AS horas_usadas_at,
    COUNT(*) AS eventos
FROM RPT_AT_HORAS_USADAS_EVENTO v
LEFT JOIN at_usuarios u ON u.username = v.username
LEFT JOIN at_equipos eq ON eq.team_id = v.team_id
GROUP BY v.username, COALESCE(u.full_name, v.username), v.team_id, eq.nombre, v.event_type;
