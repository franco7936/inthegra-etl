import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_NOVEDADES_LABORALES';

const DEMO_ROWS = [
  { fecha: '2026-09-02', person_id: 1, persona: 'Luna Borsotti', project_id: 1, equipo: 'Business', event_type: 'day_off', horas: 8, registros: 1 },
  { fecha: '2026-09-05', person_id: 2, persona: 'Nicolas Gomez', project_id: 2, equipo: 'SaaS', event_type: 'holiday', horas: 8, registros: 1 },
  { fecha: '2026-09-09', person_id: 3, persona: 'Camila Perez', project_id: 2, equipo: 'SaaS', event_type: 'overtime', horas: 3.5, registros: 1 },
  { fecha: '2026-09-12', person_id: 1, persona: 'Luna Borsotti', project_id: 1, equipo: 'Business', event_type: 'overtime', horas: 2, registros: 1 },
  { fecha: '2026-09-18', person_id: 4, persona: 'Martin Lopez', project_id: 3, equipo: 'Custom', event_type: 'day_off', horas: 8, registros: 1 },
];

const EVENT_LABELS = {
  day_off: 'Day off',
  holiday: 'Holiday',
  overtime: 'Horas extras',
};

function defaultDates() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to };
}

function readFilters(request) {
  const { searchParams } = new URL(request.url);
  const defaults = defaultDates();
  return {
    from: searchParams.get('from') || defaults.from,
    to: searchParams.get('to') || defaults.to,
    projectId: searchParams.get('projectId') || '',
    eventType: searchParams.get('eventType') || '',
  };
}

function buildWhere(filters) {
  const clauses = ['fecha >= ?', 'fecha <= ?'];
  const args = [filters.from, filters.to];

  if (filters.projectId) {
    clauses.push('project_id = ?');
    args.push(Number(filters.projectId));
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

async function viewExists(db) {
  const rows = await queryRows(db, 'SELECT name FROM sqlite_schema WHERE type = ? AND name = ?', ['view', REQUIRED_VIEW]);
  return rows.length > 0;
}

function normalizeRow(row) {
  return {
    fecha: row.fecha,
    person_id: row.person_id,
    persona: row.persona || 'Sin persona',
    project_id: row.project_id,
    equipo: row.equipo || row.proyecto || 'Sin equipo',
    event_type: row.event_type,
    event_label: row.event_label || EVENT_LABELS[row.event_type] || row.event_type,
    horas: Number(row.horas || 0),
    registros: Number(row.registros || 0),
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key) || { horas: 0, registros: 0, day_off: 0, holiday: 0, overtime: 0 };
    current.horas += row.horas;
    current.registros += row.registros;
    current[row.event_type] = (current[row.event_type] || 0) + row.horas;
    map.set(key, current);
  }
  return map;
}

function buildPayload(filters, rows, modelReady, setupMessage = '') {
  const normalized = rows.map(normalizeRow);
  const totalHoras = normalized.reduce((sum, row) => sum + row.horas, 0);
  const uniquePeople = new Set(normalized.map((row) => row.person_id).filter(Boolean));
  const uniqueTeams = new Set(normalized.map((row) => row.project_id).filter(Boolean));

  const byPersonMap = groupBy(normalized, (row) => `${row.person_id}|${row.persona}|${row.equipo}`);
  const byTeamMap = groupBy(normalized, (row) => `${row.project_id}|${row.equipo}`);
  const byTypeMap = groupBy(normalized, (row) => row.event_type);

  const byPerson = Array.from(byPersonMap.entries()).map(([key, value]) => {
    const [person_id, persona, equipo] = key.split('|');
    return { person_id, persona, equipo, ...value, horas: Number(value.horas.toFixed(2)) };
  }).sort((a, b) => b.horas - a.horas);

  const byTeam = Array.from(byTeamMap.entries()).map(([key, value]) => {
    const [project_id, equipo] = key.split('|');
    return { project_id, equipo, ...value, horas: Number(value.horas.toFixed(2)) };
  }).sort((a, b) => b.horas - a.horas);

  const byType = Array.from(byTypeMap.entries()).map(([event_type, value]) => ({
    event_type,
    event_label: EVENT_LABELS[event_type] || event_type,
    ...value,
    horas: Number(value.horas.toFixed(2)),
  })).sort((a, b) => b.horas - a.horas);

  return {
    ok: true,
    modelReady,
    demo: !modelReady,
    setupMessage,
    filters,
    summary: {
      horas: Number(totalHoras.toFixed(2)),
      registros: normalized.reduce((sum, row) => sum + row.registros, 0),
      personas: uniquePeople.size,
      equipos: uniqueTeams.size,
    },
    byType,
    byPerson,
    byTeam,
    detail: normalized.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 500),
    filtersData: {
      projects: Array.from(new Map(normalized.map((row) => [row.project_id, { project_id: row.project_id, equipo: row.equipo }])).values()).filter((row) => row.project_id),
      eventTypes: Object.entries(EVENT_LABELS).map(([event_type, label]) => ({ event_type, label })),
    },
  };
}

export async function GET(request) {
  try {
    const filters = readFilters(request);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      return NextResponse.json(buildPayload(
        filters,
        DEMO_ROWS,
        false,
        `Falta la vista ${REQUIRED_VIEW}. La pantalla usa datos de referencia hasta crear la vista SQL.`
      ));
    }

    const { where, args } = buildWhere(filters);
    const rows = await queryRows(db, `
      SELECT
        fecha,
        person_id,
        persona,
        project_id,
        equipo,
        event_type,
        event_label,
        ROUND(SUM(COALESCE(horas, 0)), 2) AS horas,
        SUM(COALESCE(registros, 1)) AS registros
      FROM VW_NOVEDADES_LABORALES
      WHERE ${where}
      GROUP BY fecha, person_id, persona, project_id, equipo, event_type, event_label
      ORDER BY fecha DESC, persona
      LIMIT 1000
    `, args);

    return NextResponse.json(buildPayload(filters, rows, true));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
