import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { parseSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEWS = ['VW_REPORTE_HORAS_DETALLE', 'VW_REPORTE_HORAS_PERSONA_TIPO', 'VW_REPORTE_HORAS_EQUIPO_TIPO'];
const REQUIRED_DETAIL_COLUMNS = ['horas_at', 'horas_pgi', 'tiempo_empleado'];

function defaultDates() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

function readFilters(request) {
  const { searchParams } = new URL(request.url);
  const defaults = defaultDates();
  return { from: searchParams.get('from') || defaults.from, to: searchParams.get('to') || defaults.to, projectId: searchParams.get('projectId') || '', personId: searchParams.get('personId') || '', eventType: searchParams.get('eventType') || '' };
}

function applyAccessScope(filters, session) {
  if (!session || session.role === 'admin') return filters;
  return { ...filters, projectId: session.project_id ? String(session.project_id) : '__none__' };
}

function buildWhere(filters) {
  const clauses = ['fecha >= ?', 'fecha <= ?'];
  const args = [filters.from, filters.to];

  if (filters.projectId === '__none__') {
    clauses.push('1 = 0');
  } else if (filters.projectId) {
    clauses.push('project_id = ?');
    args.push(Number(filters.projectId));
  }

  if (filters.personId) {
    clauses.push('person_id = ?');
    args.push(Number(filters.personId));
  }

  if (filters.eventType) {
    clauses.push('event_type = ?');
    args.push(filters.eventType);
  }

  return { where: clauses.join(' AND '), args };
}

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function getMissingViews(db) {
  const placeholders = REQUIRED_VIEWS.map(() => '?').join(',');
  const existing = await queryRows(db, `SELECT name FROM sqlite_schema WHERE type = 'view' AND name IN (${placeholders})`, REQUIRED_VIEWS);
  const existingNames = new Set(existing.map((row) => row.name));
  return REQUIRED_VIEWS.filter((name) => !existingNames.has(name));
}

async function getMissingDetailColumns(db) {
  const columns = await queryRows(db, 'PRAGMA table_info(VW_REPORTE_HORAS_DETALLE)');
  const columnNames = new Set(columns.map((row) => String(row.name || '').toLowerCase()));
  return REQUIRED_DETAIL_COLUMNS.filter((name) => !columnNames.has(name));
}

function emptyPayload(filters, setupMessage) {
  return { ok: true, modelReady: false, setupMessage, filters, summary: { horas: 0, horas_at: 0, horas_pgi: 0, registros: 0, personas: 0, proyectos: 0 }, byPerson: [], byTeam: [], filtersData: { projects: [], people: [], eventTypes: [] } };
}

export async function GET(request) {
  try {
    const session = parseSession(request.cookies.get('inthegra_session')?.value);
    const requestedFilters = readFilters(request);
    const filters = applyAccessScope(requestedFilters, session);
    const db = getTursoClient();
    const missingViews = await getMissingViews(db);

    if (missingViews.length) return NextResponse.json(emptyPayload(filters, `Faltan vistas en Turso: ${missingViews.join(', ')}. Ejecutar el ETL principal.`));

    const missingColumns = await getMissingDetailColumns(db);
    if (missingColumns.length) return NextResponse.json(emptyPayload(filters, `La vista de horas todavia no tiene PGI (${missingColumns.join(', ')}). Ejecutar el ETL principal con etl_runner_v4.`));

    const { where, args } = buildWhere(filters);
    const filterBase = buildWhere({ from: filters.from, to: filters.to, projectId: filters.projectId, personId: '', eventType: '' });

    const [summaryRows, byPerson, byTeam, projects, people, eventTypes] = await Promise.all([
      queryRows(db, `SELECT ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas, ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at, ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi, COUNT(*) AS registros, COUNT(DISTINCT person_id) AS personas, COUNT(DISTINCT project_id) AS proyectos FROM VW_REPORTE_HORAS_DETALLE WHERE ${where}`, args),
      queryRows(db, `SELECT person_id, persona, project_id, proyecto, project_key_rpt, event_type, ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas, ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at, ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi, COUNT(*) AS registros, MAX(fecha) AS ultima_fecha FROM VW_REPORTE_HORAS_DETALLE WHERE ${where} GROUP BY person_id, persona, project_id, proyecto, project_key_rpt, event_type ORDER BY horas DESC LIMIT 500`, args),
      queryRows(db, `SELECT project_id, proyecto, project_key_rpt, event_type, ROUND(SUM(COALESCE(tiempo_empleado, 0)), 2) AS horas, ROUND(SUM(COALESCE(horas_at, 0)), 2) AS horas_at, ROUND(SUM(COALESCE(horas_pgi, 0)), 2) AS horas_pgi, COUNT(DISTINCT person_id) AS personas, COUNT(*) AS registros FROM VW_REPORTE_HORAS_DETALLE WHERE ${where} GROUP BY project_id, proyecto, project_key_rpt, event_type ORDER BY horas DESC LIMIT 300`, args),
      queryRows(db, `SELECT DISTINCT project_id, proyecto, project_key_rpt FROM VW_REPORTE_HORAS_DETALLE WHERE ${filterBase.where} AND project_id IS NOT NULL ORDER BY proyecto`, filterBase.args),
      queryRows(db, `SELECT DISTINCT person_id, persona FROM VW_REPORTE_HORAS_DETALLE WHERE ${filterBase.where} AND person_id IS NOT NULL ORDER BY persona`, filterBase.args),
      queryRows(db, `SELECT DISTINCT event_type FROM VW_REPORTE_HORAS_DETALLE WHERE ${filterBase.where} AND event_type IS NOT NULL ORDER BY event_type`, filterBase.args),
    ]);

    return NextResponse.json({ ok: true, modelReady: true, filters, summary: summaryRows[0] || { horas: 0, horas_at: 0, horas_pgi: 0, registros: 0, personas: 0, proyectos: 0 }, byPerson, byTeam, filtersData: { projects, people, eventTypes } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
