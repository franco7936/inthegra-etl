-- Tiempo usado real informado por ActivityTimeline.
-- Fuente: /rest/api/1/timeline/{username}?eventType=WORKLOG

CREATE TABLE IF NOT EXISTS at_worklogs (
    worklog_id          TEXT PRIMARY KEY,
    username            TEXT,
    issue_key           TEXT,
    project_key         TEXT,
    fecha               TEXT,
    fecha_hora          TEXT,
    comentario          TEXT,
    categoria           TEXT,
    time_spent_seconds  INTEGER,
    horas_usadas        REAL,
    fecha_carga         TEXT
);

CREATE INDEX IF NOT EXISTS idx_at_worklogs_fecha
    ON at_worklogs (fecha);

CREATE INDEX IF NOT EXISTS idx_at_worklogs_usuario_fecha
    ON at_worklogs (username, fecha);

CREATE INDEX IF NOT EXISTS idx_at_worklogs_issue
    ON at_worklogs (issue_key);
