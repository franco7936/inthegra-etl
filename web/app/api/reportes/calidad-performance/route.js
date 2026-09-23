import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_CALIDAD_PERFORMANCE_OPERATIVA';

const DEMO_ROWS = [
  { fecha: '2026-08-01', project_id: 1, proyecto: 'SaaS Core', project_key_rpt: 'SAS', indicador: 'Throughput', valor: 42, unidad: 'issues', estado: 'success', tendencia: 'up' },
  { fecha: '2026-08-01', project_id: 1, proyecto: 'SaaS Core', project_key_rpt: 'SAS', indicador: 'Bugs productivos', valor: 7, unidad: 'bugs', estado: 'warning', tendencia: 'down' },
  { fecha: '2026-08-01', project_id: 1, proyecto: 'SaaS Core', project_key_rpt: 'SAS', indicador: 'Retrabajo', valor: 11.8, unidad: '%', estado: 'warning', tendencia: 'down' },
  { fecha: '2026-08-01', project_id: 1, proyecto: 'SaaS Core', project_key_rpt: 'SAS', indicador: 'Lead time', valor: 5.4, unidad: 'dias', estado: 'success', tendencia: 'down' },
  { fecha: '2026-08-01', project_id: 2, proyecto: 'Custom Health', project_key_rpt: 'CUS', indicador: 'Throughput', valor: 31, unidad: 'issues', estado: 'success', tendencia: 'up' },
  { fecha: '2026-08-01', project_id: 2, proyecto: 'Custom Health', project_key_rpt: 'CUS', indicador: 'Bugs productivos', valor: 12, unidad: 'bugs', estado: 'danger', tendencia: 'up' },
  { fecha: '2026-08-01', project_id: 2, proyecto: 'Custom Health', project_key_rpt: 'CUS', indicador: 'Retrabajo', valor: 18.5, unidad: '%', estado: 'danger', tendencia: 'up' },
  { fecha: '2026-08-01', project_id: 2, proyecto: 'Custom Health', project_key_rpt: 'CUS', indicador: 'Lead time', valor: 8.1, unidad: 'dias', estado: 'warning', tendencia: 'up' },
  { fecha: '2026-08-01', project_id: 3, proyecto: 'Soporte Operativo', project_key_rpt: 'SOP', indicador: 'SLA cumplido', valor: 96.4, unidad: '%', estado: 'success', tendencia: 'up' },
  { fecha: '2026-08-01', project_id: 3, proyecto: 'Soporte Operativo', project_key_rpt: 'SOP', indicador: 'Incidentes reabiertos', valor: 4, unidad: 'casos', estado: 'success', tendencia: 'down' },
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

function filterDemo(filters) {
  if (!filters.projectId) return DEMO_ROWS;
  return DEMO_ROWS.filter((row) => String(row.project_id) === String(filters.projectId));
}

function buildPayload(rows) {
  const projects = new Map();
  rows.forEach((row) => {
    const key = row.project_id || row.proyecto;
    const current = projects.get(key) || {
      project_id: row.project_id,
      proyecto: row.proyecto || 'Sin proyecto',
      project_key_rpt: row.project_key_rpt || '',
      indicadores: [],
    };
    current.indicadores.push({
      indicador: row.indicador,
      valor: Number(row.valor || 0),
      unidad: row.unidad || '',
      estado: row.estado || 'default',
      tendencia: row.tendencia || 'neutral',
    });
    projects.set(key, current);
  });

  const allIndicators = rows.map((row) => row.indicador);
  const uniqueIndicators = [...new Set(allIndicators)];
  const highlights = uniqueIndicators.slice(0, 4).map((indicator) => {
    const matching = rows.filter((row) => row.indicador === indicator);
    const total = matching.reduce((sum, row) => sum + Number(row.valor || 0), 0);
    const avg = matching.length ? total / matching.length : 0;
    return {
      indicador: indicator,
      valor: Number(avg.toFixed(1)),
      unidad: matching[0]?.unidad || '',
      estado: matching.some((row) => row.estado === 'danger') ? 'danger' : matching.some((row) => row.estado === 'warning') ? 'warning' : 'success',
    };
  });

  return { projects: [...projects.values()], highlights };
}

export async function GET(request) {
  try {
    const filters = readFilters(request);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      const rows = filterDemo(filters);
      const payload = buildPayload(rows);
      return NextResponse.json({
        ok: true,
        modelReady: false,
        demo: true,
        setupMessage: `Falta la vista ${REQUIRED_VIEW}. La pantalla usa datos de referencia hasta definir y crear la vista SQL.`,
        filters,
        ...payload,
        filtersData: { projects: buildPayload(DEMO_ROWS).projects.map(({ project_id, proyecto, project_key_rpt }) => ({ project_id, proyecto, project_key_rpt })) },
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
        FROM VW_CALIDAD_PERFORMANCE_OPERATIVA
        WHERE ${where}
        ORDER BY proyecto, indicador
      `, args),
      queryRows(db, `
        SELECT DISTINCT project_id, proyecto, project_key_rpt
        FROM VW_CALIDAD_PERFORMANCE_OPERATIVA
        WHERE fecha >= ? AND fecha <= ?
        ORDER BY proyecto
      `, [filters.from, filters.to]),
    ]);

    return NextResponse.json({
      ok: true,
      modelReady: true,
      demo: false,
      filters,
      ...buildPayload(rows),
      filtersData: { projects },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
