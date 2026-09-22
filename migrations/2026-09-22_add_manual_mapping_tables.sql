-- Tablas manuales para relacionar ActivityTimeline con Jira/reporting.
-- Se cargan manualmente en la base para evitar matches automaticos incorrectos.

CREATE TABLE IF NOT EXISTS map_at_equipo_proyecto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at_team_id TEXT NOT NULL,
    at_equipo_nombre TEXT,
    jira_project_key TEXT NOT NULL,
    jira_project_name TEXT,
    criterio_match TEXT DEFAULT 'manual',
    activo INTEGER DEFAULT 1,
    notas TEXT,
    fecha_carga TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(at_team_id, jira_project_key)
);

CREATE INDEX IF NOT EXISTS idx_map_at_equipo_proyecto_team
    ON map_at_equipo_proyecto (at_team_id);

CREATE INDEX IF NOT EXISTS idx_map_at_equipo_proyecto_project
    ON map_at_equipo_proyecto (jira_project_key);

CREATE TABLE IF NOT EXISTS map_persona_fuentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_nombre TEXT,
    at_username TEXT,
    jira_account_id TEXT,
    email TEXT,
    criterio_match TEXT DEFAULT 'manual',
    activo INTEGER DEFAULT 1,
    notas TEXT,
    fecha_carga TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(at_username, jira_account_id)
);

CREATE INDEX IF NOT EXISTS idx_map_persona_fuentes_at
    ON map_persona_fuentes (at_username);

CREATE INDEX IF NOT EXISTS idx_map_persona_fuentes_jira
    ON map_persona_fuentes (jira_account_id);
