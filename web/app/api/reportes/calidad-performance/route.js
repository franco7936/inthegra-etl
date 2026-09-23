import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';

export const dynamic = 'force-dynamic';

const REQUIRED_VIEW = 'VW_QA_METRICAS_MINIMAS';

const DEMO_METRICS = [
  { metric_id: 'escape_rate', metrica: 'Bugs en produccion / Escape Rate', valor_actual: 0, valor_formateado: '0,0%', objetivo: '<= 5%', estado: 'OK', lectura: 'Contencion aceptable', fuente: '02_Metricas', tipo: 'porcentaje', objetivo_valor: 5, sentido: 'menor_mejor' },
  { metric_id: 'mttr_p0_p1', metrica: 'MTTR bugs criticos P0/P1', valor_actual: 0, valor_formateado: '0,0', objetivo: '<= 48 hs', estado: 'OK', lectura: 'Resolucion dentro del objetivo', fuente: '02_Metricas', tipo: 'horas', objetivo_valor: 48, sentido: 'menor_mejor' },
  { metric_id: 'regresion', metrica: 'Cobertura de regresion', valor_actual: 0, valor_formateado: '0,0%', objetivo: '>= 90%', estado: 'Revisar', lectura: 'Riesgo de romper flujos existentes', fuente: '02_Metricas / 04_Releases', tipo: 'porcentaje', objetivo_valor: 90, sentido: 'mayor_mejor' },
  { metric_id: 'smoke_deploy', metrica: 'Smoke test por deploy', valor_actual: 0, valor_formateado: '0,0%', objetivo: '>= 95%', estado: 'Revisar', lectura: 'Falta asegurar validacion minima post deploy', fuente: '02_Metricas / 04_Releases', tipo: 'porcentaje', objetivo_valor: 95, sentido: 'mayor_mejor' },
  { metric_id: 'criterios_aceptacion', metrica: 'Criterios de aceptacion definidos', valor_actual: 0, valor_formateado: '0,0%', objetivo: '>= 90%', estado: 'Revisar', lectura: 'Riesgo de ambiguedad funcional', fuente: '02_Metricas', tipo: 'porcentaje', objetivo_valor: 90, sentido: 'mayor_mejor' },
  { metric_id: 'test_cases_pre_sprint', metrica: 'US con Test Cases antes del Sprint', valor_actual: 0, valor_formateado: '0,0%', objetivo: '>= 80%', estado: 'Revisar', lectura: 'QA esta llegando tarde o sin preparacion', fuente: '02_Metricas', tipo: 'porcentaje', objetivo_valor: 80, sentido: 'mayor_mejor' },
  { metric_id: 'reapertura_bugs', metrica: 'Tasa de reapertura de bugs', valor_actual: 0, valor_formateado: '0,0%', objetivo: '<= 10%', estado: 'OK', lectura: 'Correcciones estables', fuente: '02_Metricas / 03_Detalle_Bugs', tipo: 'porcentaje', objetivo_valor: 10, sentido: 'menor_mejor' },
  { metric_id: 'ciclo_dev_qa_done', metrica: 'Tiempo ciclo Dev a QA a Done', valor_actual: 0, valor_formateado: '0,0', objetivo: '<= 5 dias', estado: 'OK', lectura: 'Flujo sin grandes cuellos', fuente: '02_Metricas', tipo: 'dias', objetivo_valor: 5, sentido: 'menor_mejor' },
];

const ADDITIONAL_METRICS = [
  { metrica: '% defectos asociados a ambiguedad funcional', motivo: 'Permite medir retrabajo nacido en analisis incompleto, reglas poco claras o criterios ambiguos.' },
  { metrica: '% historias rechazadas por QA por falta de informacion', motivo: 'Fortalece Definition of Ready y mejora la calidad del refinamiento antes del desarrollo.' },
  { metrica: 'Cobertura de flujos criticos de negocio', motivo: 'Prioriza flujos Oracle/APEX, reportes, pagos, permisos, integraciones y procesos operativos clave.' },
  { metrica: 'Defectos por modulo / producto / vertical', motivo: 'Detecta zonas calientes del sistema y ayuda a priorizar esfuerzo QA.' },
  { metrica: 'Defectos por origen', motivo: 'Distingue problemas de analisis, desarrollo, datos, ambiente, integracion o configuracion.' },
  { metrica: '% releases con Go / Go con observaciones / No Go', motivo: 'Formaliza la recomendacion QA previa al despliegue en base a evidencia objetiva.' },
  { metrica: 'Edad promedio de bugs abiertos', motivo: 'Visibiliza deuda operativa por defectos que quedan demasiado tiempo sin resolucion.' },
  { metrica: 'Bugs reabiertos por validacion insuficiente', motivo: 'Ayuda a mejorar el retest y la calidad de la correccion.' },
  { metrica: '% funcionalidades criticas con casos actualizados', motivo: 'Evita que la documentacion QA quede desactualizada frente a cambios funcionales.' },
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
  const rows = await queryRows(db, 'SELECT name FROM sqlite_schema WHERE type = ? AND name = ?', ['view', REQUIRED_VIEW]);
  return rows.length > 0;
}

function normalizeMetric(row) {
  return {
    metric_id: row.metric_id || row.metrica,
    metrica: row.metrica,
    valor_actual: Number(row.valor_actual || 0),
    valor_formateado: row.valor_formateado || String(row.valor_actual ?? '-'),
    objetivo: row.objetivo,
    estado: row.estado || 'Revisar',
    lectura: row.lectura,
    fuente: row.fuente,
    tipo: row.tipo || 'numero',
    objetivo_valor: Number(row.objetivo_valor || 0),
    sentido: row.sentido || 'mayor_mejor',
  };
}

function buildSummary(metrics) {
  const total = metrics.length;
  const ok = metrics.filter((metric) => metric.estado === 'OK').length;
  const revisar = metrics.filter((metric) => metric.estado !== 'OK').length;
  const riesgo = total ? Math.round((revisar / total) * 100) : 0;
  const coberturaPromedio = metrics
    .filter((metric) => metric.tipo === 'porcentaje' && metric.sentido === 'mayor_mejor')
    .reduce((sum, metric, index, arr) => sum + metric.valor_actual / arr.length, 0);

  return {
    total,
    ok,
    revisar,
    riesgo,
    coberturaPromedio: Number(coberturaPromedio.toFixed(1)),
  };
}

export async function GET(request) {
  try {
    const filters = readFilters(request);
    const db = getTursoClient();
    const ready = await viewExists(db);

    if (!ready) {
      const metrics = DEMO_METRICS.map(normalizeMetric);
      return NextResponse.json({
        ok: true,
        modelReady: false,
        demo: true,
        setupMessage: `Falta la vista ${REQUIRED_VIEW}. La pantalla usa datos de referencia hasta definir y crear la vista SQL.`,
        filters,
        summary: buildSummary(metrics),
        metrics,
        additionalMetrics: ADDITIONAL_METRICS,
      });
    }

    const rows = await queryRows(db, `
      SELECT *
      FROM VW_QA_METRICAS_MINIMAS
      WHERE fecha_desde >= ? AND fecha_hasta <= ?
      ORDER BY orden
    `, [filters.from, filters.to]);
    const metrics = rows.map(normalizeMetric);

    return NextResponse.json({
      ok: true,
      modelReady: true,
      demo: false,
      filters,
      summary: buildSummary(metrics),
      metrics,
      additionalMetrics: ADDITIONAL_METRICS,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
