-- Vistas para el reporte mensual de horas de ActivityTimeline por tipo de evento.
-- Mantienen granularidad diaria para permitir filtros por periodo en el front.

DROP VIEW IF EXISTS RPT_AT_EVENTOS_DETALLE_HORAS;
CREATE VIEW RPT_AT_EVENTOS_DETALLE_HORAS AS
SELECT
    e.evento_id,
    date(COALESCE(NULLIF(e.planned_start, ''), NULLIF(e.planned_end, ''))) AS fecha,
    e.username,
    COALESCE(u.full_name, e.username) AS persona,
    e.team_id,
    COALESCE(eq.nombre, e.team_id, 'Sin equipo') AS equipo,
    e.project_key,
    COALESCE(NULLIF(e.event_type, ''), 'Sin tipo') AS event_type,
    e.issue_key,
    e.issue_id,
    e.issue_type,
    e.summary,
    e.planned_start,
    e.planned_end,
    ROUND(COALESCE(e.daily_time_estimate, e.orig_estimate, 0), 2) AS horas_at,
    ROUND(COALESCE(e.orig_estimate, 0), 2) AS horas_estimadas_originales,
    ROUND(COALESCE(e.rem_estimate, 0), 2) AS horas_restantes,
    1 AS eventos
FROM at_eventos e
LEFT JOIN at_usuarios u ON u.username = e.username
LEFT JOIN at_equipos eq ON eq.team_id = e.team_id;

DROP VIEW IF EXISTS RPT_AT_HORAS_PERSONA_TIPO_PERIODO;
CREATE VIEW RPT_AT_HORAS_PERSONA_TIPO_PERIODO AS
SELECT
    fecha,
    username,
    persona,
    team_id,
    equipo,
    project_key,
    event_type,
    ROUND(SUM(horas_at), 2) AS horas_at,
    COUNT(*) AS eventos
FROM RPT_AT_EVENTOS_DETALLE_HORAS
GROUP BY fecha, username, persona, team_id, equipo, project_key, event_type;

DROP VIEW IF EXISTS RPT_AT_HORAS_EQUIPO_TIPO_PERIODO;
CREATE VIEW RPT_AT_HORAS_EQUIPO_TIPO_PERIODO AS
SELECT
    fecha,
    team_id,
    equipo,
    project_key,
    event_type,
    ROUND(SUM(horas_at), 2) AS horas_at,
    COUNT(*) AS eventos,
    COUNT(DISTINCT username) AS personas
FROM RPT_AT_EVENTOS_DETALLE_HORAS
GROUP BY fecha, team_id, equipo, project_key, event_type;
