import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_STATUS_SEMANAL_LIDERES';

const DEMO_ITEMS = [
  {
    semana: '2026-09-22',
    equipo: 'BNS',
    lider: 'Lider equipo',
    proyecto: 'Operacion semanal',
    estado: 'En curso',
    salud: 'verde',
    avance_pct: 72,
    prioridad: 'Alta',
    resumen: 'Semana enfocada en seguimiento de entregables, control de bloqueos y coordinacion de proximos pasos.',
    avances: 'Se consolidaron avances del equipo y se mantuvo el foco en los compromisos priorizados.',
    riesgos: 'Dependencias externas y definiciones funcionales pendientes pueden afectar fechas comprometidas.',
    bloqueos: 'Sin bloqueos criticos registrados para la vista inicial.',
    proximos_pasos: 'Validar pendientes con lideres, actualizar compromisos y cerrar riesgos abiertos.',
    fecha_actualizacion: '2026-09-22',
  },
  {
    semana: '2026-09-22',
    equipo: 'BNS',
    lider: 'Lider tecnico',
    proyecto: 'Backlog y soporte',
    estado: 'Atencion',
    salud: 'amarillo',
    avance_pct: 48,
    prioridad: 'Media',
    resumen: 'Seguimiento de issues activos, soporte operativo y revision de items con impacto semanal.',
    avances: 'Se atendieron consultas operativas y se ordenaron tickets para priorizacion.',
    riesgos: 'Acumulacion de tareas menores puede generar retrabajo si no se ordena el alcance.',
    bloqueos: 'Pendiente confirmacion de criterios para algunos items.',
    proximos_pasos: 'Definir responsables y fechas para items que siguen abiertos.',
    fecha_actualizacion: '2026-09-22',
  },
];

function defaultWeek() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function readFilters(request) {
  const { searchParams } = new URL(request.url);
  return {
    week: searchParams.get('week') || defaultWeek(),
    equipo: searchParams.get('equipo') || '',
  };
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
    semana: row.semana,
    equipo: row.equipo || 'Sin equipo',
    lider: row.lider || 'Sin lider',
    proyecto: row.proyecto || 'Sin proyecto',
    estado: row.estado || 'Sin estado',
    salud: row.salud || 'gris',
    avance_pct: Number(row.avance_pct || 0),
    prioridad: row.prioridad || 'Media',
    resumen: row.resumen || '',
    avances: row.avances || '',
    riesgos: row.riesgos || '',
    bloqueos: row.bloqueos || '',
    proximos_pasos: row.proximos_pasos || '',
    fecha_actualizacion: row.fecha_actualizacion || row.semana,
  };
}

function buildSummary(items) {
  const total = items.length;
  const verdes = items.filter((item) => item.salud === 'verde').length;
  const amarillos = items.filter((item) => item.salud === 'amarillo').length;
  const rojos = items.filter((item) => item.salud === 'rojo').length;
  const avancePromedio = total ? items.reduce((sum, item) => sum + item.avance_pct, 0) / total : 0;
  return {
    total,
    verdes,
    amarillos,
    rojos,
    avancePromedio: Number(avancePromedio.toFixed(1)),
  };
}

function filterDemo(filters) {
  return DEMO_ITEMS.filter((item) => !filters.equipo || item.equipo === filters.equipo);
}

export async function GET(request) {
  try {
    const filters = readFilters(request);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      const items = filterDemo(filters).map(normalizeRow);
      return NextResponse.json({
        ok: true,
        modelReady: false,
        demo: true,
        setupMessage: `Falta la vista ${REQUIRED_VIEW}. La pantalla usa datos de referencia hasta definir la carga del Excel o la vista SQL.`,
        filters,
        summary: buildSummary(items),
        items,
        filtersData: {
          equipos: Array.from(new Set(DEMO_ITEMS.map((item) => item.equipo))).sort(),
        },
      });
    }

    const clauses = ['semana = ?'];
    const args = [filters.week];
    if (filters.equipo) {
      clauses.push('equipo = ?');
      args.push(filters.equipo);
    }

    const items = (await queryRows(db, `
      SELECT *
      FROM VW_STATUS_SEMANAL_LIDERES
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE salud WHEN 'rojo' THEN 1 WHEN 'amarillo' THEN 2 WHEN 'verde' THEN 3 ELSE 4 END,
        prioridad,
        equipo,
        proyecto
    `, args)).map(normalizeRow);

    const equipos = await queryRows(db, `
      SELECT DISTINCT equipo
      FROM VW_STATUS_SEMANAL_LIDERES
      WHERE semana = ? AND equipo IS NOT NULL
      ORDER BY equipo
    `, [filters.week]);

    return NextResponse.json({
      ok: true,
      modelReady: true,
      demo: false,
      filters,
      summary: buildSummary(items),
      items,
      filtersData: { equipos: equipos.map((row) => row.equipo) },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
