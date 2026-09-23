import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_INDICADORES_ENTREGA_CALIDAD';

const DEMO_SECTIONS = [
  {
    id: 'generales',
    title: 'Generales',
    cards: [
      { id: 'hs_totales', title: 'Hs Totales', value: '3840 hrs', detail: '', trend: 'neutral', tone: 'default' },
      { id: 'horas_productivas', title: 'Horas productivas', value: '3180 hrs', detail: '-25 hs licencias', trend: 'down', tone: 'default' },
      { id: 'horas_gestion', title: 'Horas Gestion', value: '619 hrs', detail: '+16hs demos comerciales', trend: 'down', tone: 'default' },
      { id: 'proyectos_tiempo', title: 'Proyectos Entregados a Tiempo', value: '-%', detail: '', trend: 'neutral', tone: 'success' },
      { id: 'sla', title: 'Cumplimiento SLA', value: '98.0%', detail: '', trend: 'neutral', tone: 'success' },
    ],
  },
  {
    id: 'saas',
    title: 'SaaS',
    cards: [
      { id: 'hs_totales_saas', title: 'Hs Totales SaaS', value: '1182 hrs', detail: '', trend: 'down', tone: 'default' },
      { id: 'roadmap_saas', title: 'Hs Roadmap SaaS', value: '1010 hrs', detail: '', trend: 'down', tone: 'default' },
      { id: 'soporte_saas', title: 'Horas Soporte', value: '0 hs', detail: '', trend: 'neutral', tone: 'soft' },
      { id: 'implementaciones', title: 'Implementaciones', value: '117.25 hs', detail: '', trend: 'up', tone: 'default' },
      { id: 'retrabajo_saas', title: 'Horas Retrabajo/Garantia', value: '55 hs', detail: '', trend: 'up', tone: 'danger' },
    ],
  },
  {
    id: 'custom',
    title: 'Desarrollo a medida',
    cards: [
      { id: 'facturables_disponibles', title: 'Hs Facturables / Disponibles', value: '62.8%', detail: '', trend: 'up', tone: 'danger' },
      { id: 'hs_totales_custom', title: 'Hs Totales Custom', value: '1998 hrs', detail: '', trend: 'up', tone: 'default' },
      { id: 'soporte_custom', title: 'Horas Soporte', value: '480 hs', detail: '', trend: 'up', tone: 'soft' },
      { id: 'retrabajo_custom', title: 'Horas Retrabajo/Garantia', value: '585 hs', detail: '', trend: 'up', tone: 'danger' },
      { id: 'roadmap_custom', title: 'Roadmap Cliente / Custom', value: '376 hs / 557 hs', detail: '', trend: 'up', tone: 'default' },
    ],
  },
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

function groupRows(rows) {
  const sections = new Map();
  rows.forEach((row) => {
    const sectionId = row.seccion_id || row.seccion || 'general';
    const section = sections.get(sectionId) || {
      id: sectionId,
      title: row.seccion_titulo || row.seccion || 'General',
      cards: [],
    };
    section.cards.push({
      id: row.indicador_id || row.titulo,
      title: row.titulo,
      value: row.valor_formateado || `${row.valor ?? '-'}${row.unidad ? ` ${row.unidad}` : ''}`,
      detail: row.detalle || '',
      trend: row.tendencia || 'neutral',
      tone: row.estado || 'default',
    });
    sections.set(sectionId, section);
  });
  return [...sections.values()];
}

export async function GET(request) {
  try {
    const filters = readFilters(request);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      return NextResponse.json({
        ok: true,
        modelReady: false,
        demo: true,
        setupMessage: `Falta la vista ${REQUIRED_VIEW}. La pantalla usa datos de referencia hasta definir y crear la vista SQL.`,
        filters,
        collaborators: 25,
        sections: DEMO_SECTIONS,
      });
    }

    const rows = await queryRows(db, `
      SELECT *
      FROM VW_INDICADORES_ENTREGA_CALIDAD
      WHERE fecha_desde >= ? AND fecha_hasta <= ?
      ORDER BY orden_seccion, orden_indicador
    `, [filters.from, filters.to]);

    return NextResponse.json({
      ok: true,
      modelReady: true,
      demo: false,
      filters,
      collaborators: rows[0]?.colaboradores || null,
      sections: groupRows(rows),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
