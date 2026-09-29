import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { parseSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_NOVEDADES_LABORALES';
const EVENT_LABELS = { day_off: 'Day off', holiday: 'Holiday', sick_leave: 'Sick leave', vacation: 'Vacation' };

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(date) {
  return date ? date.toISOString().slice(0, 10) : '';
}

function businessDaysBetween(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end || start > end) return 0;
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getUTCDay();
    if (day >= 1 && day <= 5) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

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
  return { from: searchParams.get('from') || defaults.from, to: searchParams.get('to') || defaults.to, projectId: searchParams.get('projectId') || '', eventType: searchParams.get('eventType') || '' };
}

function applyAccessScope(filters, session) {
  if (!session || session.role === 'admin') return filters;
  return { ...filters, projectId: session.project_id ? String(session.project_id) : '__none__' };
}

function buildWhere(filters) {
  const clauses = ['fecha <= ?', 'COALESCE(fecha_fin, fecha) >= ?'];
  const args = [filters.to, filters.from];
  if (filters.projectId === '__none__') clauses.push('1 = 0');
  else if (filters.projectId) { clauses.push('project_id = ?'); args.push(Number(filters.projectId)); }
  if (filters.eventType) { clauses.push('event_type = ?'); args.push(filters.eventType); }
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

function normalizeRow(row, filters) {
  const eventType = row.event_type;
  const rowStart = parseDate(row.fecha);
  const rowEnd = parseDate(row.fecha_fin || row.fecha);
  const filterStart = parseDate(filters.from);
  const filterEnd = parseDate(filters.to);
  const clippedStart = rowStart && filterStart && rowStart < filterStart ? filterStart : rowStart;
  const clippedEnd = rowEnd && filterEnd && rowEnd > filterEnd ? filterEnd : rowEnd;
  const clippedDays = businessDaysBetween(dateKey(clippedStart), dateKey(clippedEnd));
  const originalDays = Number(row.dias || 0);
  const originalHours = Number(row.horas || 0);
  const clippedHours = clippedDays > 0
    ? (originalDays > 0 && originalHours > 0 ? (originalHours / originalDays) * clippedDays : clippedDays * 8)
    : 0;
  return {
    fecha: dateKey(clippedStart) || row.fecha,
    fecha_fin: dateKey(clippedEnd) || row.fecha_fin || row.fecha,
    person_id: row.person_id,
    persona: row.persona || 'Sin persona',
    project_id: row.project_id,
    equipo: row.equipo || row.proyecto || 'Sin equipo',
    event_type: eventType,
    event_label: row.event_label || EVENT_LABELS[eventType] || eventType,
    dias: clippedDays,
    horas: clippedHours,
    registros: Number(row.registros || 0),
    fuentes: row.fuentes || '',
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key) || { dias: 0, horas: 0, registros: 0, day_off: 0, holiday: 0, sick_leave: 0, vacation: 0, day_off_dias: 0, holiday_dias: 0, sick_leave_dias: 0, vacation_dias: 0 };
    current.dias += row.dias;
    current.horas += row.horas;
    current.registros += row.registros;
    current[row.event_type] = (current[row.event_type] || 0) + row.horas;
    current[`${row.event_type}_dias`] = (current[`${row.event_type}_dias`] || 0) + row.dias;
    map.set(key, current);
  }
  return map;
}

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildPayload(filters, rows, modelReady, setupMessage = '') {
  const normalized = rows.map((row) => normalizeRow(row, filters)).filter((row) => row.dias > 0 || row.horas > 0);
  const totalHoras = normalized.reduce((sum, row) => sum + row.horas, 0);
  const totalDias = normalized.reduce((sum, row) => sum + row.dias, 0);
  const diasHabilesPeriodo = businessDaysBetween(filters.from, filters.to);
  const uniquePeople = new Set(normalized.map((row) => row.person_id).filter(Boolean));
  const uniqueTeams = new Set(normalized.map((row) => row.project_id).filter(Boolean));
  const byPersonMap = groupBy(normalized, (row) => `${row.person_id}|${row.persona}|${row.equipo}`);
  const byTeamMap = groupBy(normalized, (row) => `${row.project_id}|${row.equipo}`);
  const byTypeMap = groupBy(normalized, (row) => row.event_type);
  const enrich = (value) => ({ ...value, dias: round2(value.dias), horas: round2(value.horas), day_off: round2(value.day_off), holiday: round2(value.holiday), sick_leave: round2(value.sick_leave), vacation: round2(value.vacation), day_off_dias: round2(value.day_off_dias), holiday_dias: round2(value.holiday_dias), sick_leave_dias: round2(value.sick_leave_dias), vacation_dias: round2(value.vacation_dias) });
  const byPerson = Array.from(byPersonMap.entries()).map(([key, value]) => { const [person_id, persona, equipo] = key.split('|'); return { person_id, persona, equipo, ...enrich(value) }; }).sort((a, b) => b.dias - a.dias);
  const byTeam = Array.from(byTeamMap.entries()).map(([key, value]) => { const [project_id, equipo] = key.split('|'); return { project_id, equipo, ...enrich(value) }; }).sort((a, b) => b.dias - a.dias);
  const byType = Object.entries(EVENT_LABELS)
    .map(([event_type, event_label]) => ({ event_type, event_label, ...enrich(byTypeMap.get(event_type) || {}) }))
    .sort((a, b) => b.dias - a.dias || String(a.event_label).localeCompare(String(b.event_label), 'es'));
  return {
    ok: true,
    modelReady,
    demo: false,
    setupMessage,
    filters,
    summary: { dias: round2(totalDias), dias_habiles_periodo: diasHabilesPeriodo, horas: round2(totalHoras), registros: normalized.reduce((sum, row) => sum + row.registros, 0), personas: uniquePeople.size, equipos: uniqueTeams.size },
    byType,
    byPerson,
    byTeam,
    detail: normalized.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 500),
    filtersData: { projects: Array.from(new Map(normalized.map((row) => [row.project_id, { project_id: row.project_id, equipo: row.equipo }])).values()).filter((row) => row.project_id), eventTypes: Object.entries(EVENT_LABELS).map(([event_type, label]) => ({ event_type, label })) },
  };
}

export async function GET(request) {
  try {
    const session = parseSession(request.cookies.get('inthegra_session')?.value);
    const filters = applyAccessScope(readFilters(request), session);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      return NextResponse.json(buildPayload(filters, [], false, `Falta la vista ${REQUIRED_VIEW}. Ejecutar el ETL principal para crear la vista con datos reales.`));
    }

    const { where, args } = buildWhere(filters);
    const rows = await queryRows(db, `SELECT fecha, fecha_fin, person_id, persona, project_id, equipo, event_type, event_label, fuentes, SUM(COALESCE(dias, 0)) AS dias, ROUND(SUM(COALESCE(horas, 0)), 2) AS horas, SUM(COALESCE(registros, 1)) AS registros FROM VW_NOVEDADES_LABORALES WHERE ${where} GROUP BY fecha, fecha_fin, person_id, persona, project_id, equipo, event_type, event_label, fuentes ORDER BY fecha DESC, persona LIMIT 1000`, args);
    return NextResponse.json(buildPayload(filters, rows, true));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
