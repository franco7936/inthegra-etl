import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_INVERSION_ESTRATEGICA';

const DEMO_ROWS = [
  { project_id: 1, proyecto: 'Migracion Clientes al SaaS', project_key_rpt: 'MIG', epic_key: 'MIG-100', epica: 'Indom CRM', horas: 30, estado: 'Pendiente', color: 'orange' },
  { project_id: 1, proyecto: 'Migracion Clientes al SaaS', project_key_rpt: 'MIG', epic_key: 'MIG-101', epica: 'Inthegra ERP', horas: 50, estado: 'Pendiente', color: 'orange' },
  { project_id: 1, proyecto: 'Migracion Clientes al SaaS', project_key_rpt: 'MIG', epic_key: 'MIG-102', epica: 'Asesores Laboral', horas: 50, estado: 'Pendiente', color: 'orange' },
  { project_id: 1, proyecto: 'Migracion Clientes al SaaS', project_key_rpt: 'MIG', epic_key: 'MIG-103', epica: 'Alta Salud Emergency', horas: 30, estado: 'Pendiente', color: 'orange' },
  { project_id: 2, proyecto: 'Creacion y Desarrollo del SaaS', project_key_rpt: 'SAS', epic_key: 'SAS-200', epica: 'Receta electronica', horas: 200, estado: 'En desarrollo', color: 'blue' },
  { project_id: 2, proyecto: 'Creacion y Desarrollo del SaaS', project_key_rpt: 'SAS', epic_key: 'SAS-201', epica: 'Solutions CRM', horas: 200, estado: 'En pruebas', color: 'orange' },
  { project_id: 2, proyecto: 'Creacion y Desarrollo del SaaS', project_key_rpt: 'SAS', epic_key: 'SAS-202', epica: 'Health Laboral', horas: 200, estado: 'En pruebas', color: 'orange' },
  { project_id: 2, proyecto: 'Creacion y Desarrollo del SaaS', project_key_rpt: 'SAS', epic_key: 'SAS-203', epica: 'Health Emergency', horas: 200, estado: 'Bloqueado', color: 'red' },
  { project_id: 2, proyecto: 'Creacion y Desarrollo del SaaS', project_key_rpt: 'SAS', epic_key: 'SAS-204', epica: 'Solutions Totem', horas: 200, estado: 'Finalizado', color: 'green' },
];

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
  };
}

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function viewExists(db) {
  const rows = await queryRows(db, "SELECT name FROM sqlite_schema WHERE type = 'view' AND name = ?", [REQUIRED_VIEW]);
  return rows.length > 0;
}

function groupProjects(rows) {
  const projects = new Map();
  rows.forEach((row) => {
    const id = row.project_id || row.proyecto || 'sin-proyecto';
    const current = projects.get(id) || {
      project_id: row.project_id,
      proyecto: row.proyecto || 'Sin proyecto',
      project_key_rpt: row.project_key_rpt || '',
      horas: 0,
      epicas: [],
    };
    const horas = Number(row.horas || row.horas_totales || 0);
    current.horas += horas;
    current.epicas.push({
      epic_key: row.epic_key || '',
      epica: row.epica || row.epic_name || 'Sin epica',
      horas,
      estado: row.estado || '',
      color: row.color || 'blue',
    });
    projects.set(id, current);
  });
  return [...projects.values()].sort((a, b) => b.horas - a.horas);
}

export async function GET(request) {
  try {
    const filters = readFilters(request);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      const filtered = filters.projectId ? DEMO_ROWS.filter((row) => String(row.project_id) === String(filters.projectId)) : DEMO_ROWS;
      return NextResponse.json({
        ok: true,
        modelReady: false,
        demo: true,
        setupMessage: `Falta la vista ${REQUIRED_VIEW}. La pantalla usa datos de referencia hasta definir y crear la vista SQL.`,
        filters,
        projects: groupProjects(filtered),
        filtersData: { projects: groupProjects(DEMO_ROWS).map(({ project_id, proyecto, project_key_rpt }) => ({ project_id, proyecto, project_key_rpt })) },
      });
    }

    const clauses = ['fecha >= ?', 'fecha <= ?'];
    const args = [filters.from, filters.to];
    if (filters.projectId) {
      clauses.push('project_id = ?');
      args.push(Number(filters.projectId));
    }
    const where = clauses.join(' AND ');

    const [rows, projects] = await Promise.all([
      queryRows(db, `
        SELECT *
        FROM VW_INVERSION_ESTRATEGICA
        WHERE ${where}
        ORDER BY proyecto, horas DESC
      `, args),
      queryRows(db, `
        SELECT DISTINCT project_id, proyecto, project_key_rpt
        FROM VW_INVERSION_ESTRATEGICA
        WHERE fecha >= ? AND fecha <= ?
        ORDER BY proyecto
      `, [filters.from, filters.to]),
    ]);

    return NextResponse.json({
      ok: true,
      modelReady: true,
      demo: false,
      filters,
      projects: groupProjects(rows),
      filtersData: { projects },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
