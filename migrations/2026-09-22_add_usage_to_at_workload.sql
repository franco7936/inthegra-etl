-- Agrega tiempo usado real de ActivityTimeline dentro de at_workload.
-- Fuente de uso real: /rest/api/1/timeline/{username}?eventType=WORKLOG
-- Nota: SQLite/Turso no soporta ADD COLUMN IF NOT EXISTS en todas las versiones.
-- Ejecutar una sola vez; el extractor tambien valida/agrega estas columnas si faltan.

ALTER TABLE at_workload ADD COLUMN issue_key TEXT;
ALTER TABLE at_workload ADD COLUMN tipo_registro TEXT DEFAULT 'PLANIFICADO';
ALTER TABLE at_workload ADD COLUMN time_spent_seconds INTEGER DEFAULT 0;
ALTER TABLE at_workload ADD COLUMN horas_usadas REAL DEFAULT 0;
ALTER TABLE at_workload ADD COLUMN worklog_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_at_workload_tipo_fecha
    ON at_workload (tipo_registro, dia);

CREATE INDEX IF NOT EXISTS idx_at_workload_usuario_fecha
    ON at_workload (username, dia);

CREATE INDEX IF NOT EXISTS idx_at_workload_issue
    ON at_workload (issue_key);
