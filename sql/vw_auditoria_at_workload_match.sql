DROP VIEW IF EXISTS VW_AUDITORIA_AT_WORKLOAD_MATCH;

CREATE VIEW VW_AUDITORIA_AT_WORKLOAD_MATCH AS
WITH esperado AS (
    SELECT
        w.workload_id,
        date(COALESCE(w.planned_start, w.planned_end)) AS fecha,
        w.issue_key,
        w.event_type,
        w.tiempo_empleado,
        w.username_at,
        w.team_id_at,
        w.project_key_at,
        w.person_id AS person_id_actual,
        w.project_id AS project_id_actual,
        (
            SELECT mp.person_id
            FROM map_personas mp
            WHERE lower(trim(mp.username_at)) = lower(trim(w.username_at))
              AND COALESCE(mp.activo, 1) = 1
            ORDER BY mp.person_id
            LIMIT 1
        ) AS person_id_esperado,
        COALESCE(
            (
                SELECT me.project_id
                FROM map_equipo_proyecto me
                WHERE upper(trim(me.project_key_rpt)) = upper(trim(w.project_key_at))
                  AND COALESCE(me.activo, 1) = 1
                ORDER BY me.project_id
                LIMIT 1
            ),
            (
                SELECT me.project_id
                FROM map_equipo_proyecto me
                WHERE trim(me.team_id_at) = trim(w.team_id_at)
                  AND COALESCE(me.activo, 1) = 1
                ORDER BY me.project_id
                LIMIT 1
            )
        ) AS project_id_esperado
    FROM at_workload w
)
SELECT
    e.workload_id,
    e.fecha,
    e.issue_key,
    e.event_type,
    e.tiempo_empleado,
    e.username_at,
    e.team_id_at,
    e.project_key_at,
    e.person_id_actual,
    e.person_id_esperado,
    COALESCE(mp_actual.full_name_at, mp_actual.user_name_rpt) AS persona_actual,
    COALESCE(mp_esperado.full_name_at, mp_esperado.user_name_rpt) AS persona_esperada,
    CASE
        WHEN e.username_at IS NULL OR trim(e.username_at) = '' THEN 'SIN_FUENTE'
        WHEN e.person_id_esperado IS NULL THEN 'SIN_MATCH'
        WHEN e.person_id_actual = e.person_id_esperado THEN 'OK'
        ELSE 'DISTINTO'
    END AS estado_persona,
    e.project_id_actual,
    e.project_id_esperado,
    COALESCE(me_actual.nombre_rpt, me_actual.nombre_at) AS proyecto_actual,
    COALESCE(me_esperado.nombre_rpt, me_esperado.nombre_at) AS proyecto_esperado,
    CASE
        WHEN (e.project_key_at IS NULL OR trim(e.project_key_at) = '')
         AND (e.team_id_at IS NULL OR trim(e.team_id_at) = '') THEN 'SIN_FUENTE'
        WHEN e.project_id_esperado IS NULL THEN 'SIN_MATCH'
        WHEN e.project_id_actual = e.project_id_esperado THEN 'OK'
        ELSE 'DISTINTO'
    END AS estado_proyecto
FROM esperado e
LEFT JOIN map_personas mp_actual ON mp_actual.person_id = e.person_id_actual
LEFT JOIN map_personas mp_esperado ON mp_esperado.person_id = e.person_id_esperado
LEFT JOIN map_equipo_proyecto me_actual ON me_actual.project_id = e.project_id_actual
LEFT JOIN map_equipo_proyecto me_esperado ON me_esperado.project_id = e.project_id_esperado;

DROP VIEW IF EXISTS VW_AUDITORIA_MAP_DUPLICADOS;

CREATE VIEW VW_AUDITORIA_MAP_DUPLICADOS AS
SELECT
    'map_personas.username_at' AS origen,
    lower(trim(username_at)) AS clave,
    COUNT(*) AS cantidad,
    GROUP_CONCAT(person_id) AS ids
FROM map_personas
WHERE username_at IS NOT NULL AND trim(username_at) <> '' AND COALESCE(activo, 1) = 1
GROUP BY lower(trim(username_at))
HAVING COUNT(*) > 1
UNION ALL
SELECT
    'map_equipo_proyecto.team_id_at' AS origen,
    trim(team_id_at) AS clave,
    COUNT(*) AS cantidad,
    GROUP_CONCAT(project_id) AS ids
FROM map_equipo_proyecto
WHERE team_id_at IS NOT NULL AND trim(team_id_at) <> '' AND COALESCE(activo, 1) = 1
GROUP BY trim(team_id_at)
HAVING COUNT(*) > 1
UNION ALL
SELECT
    'map_equipo_proyecto.project_key_rpt' AS origen,
    upper(trim(project_key_rpt)) AS clave,
    COUNT(*) AS cantidad,
    GROUP_CONCAT(project_id) AS ids
FROM map_equipo_proyecto
WHERE project_key_rpt IS NOT NULL AND trim(project_key_rpt) <> '' AND COALESCE(activo, 1) = 1
GROUP BY upper(trim(project_key_rpt))
HAVING COUNT(*) > 1;
