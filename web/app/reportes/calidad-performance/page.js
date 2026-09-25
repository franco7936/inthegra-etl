'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

function monthRange(monthValue) {
  const [year, month] = String(monthValue || '').split('-').map(Number);
  const safeDate = year && month ? new Date(Date.UTC(year, month - 1, 1)) : new Date();
  const safeYear = safeDate.getUTCFullYear();
  const safeMonth = safeDate.getUTCMonth() + 1;
  const monthKey = `${safeYear}-${String(safeMonth).padStart(2, '0')}`;
  const from = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(safeYear, safeMonth, 0)).getUTCDate();
  const to = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  return { month: monthKey, from, to };
}

function currentMonthRange() {
  const now = new Date();
  return monthRange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
}

function monthTitle(monthValue) {
  const { from } = monthRange(monthValue);
  const date = new Date(`${from}T00:00:00Z`);
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function reportFilters(filters) {
  return { from: filters.from, to: filters.to };
}

function formatNumber(value) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function Gauge({ value, label, tone = 'orange' }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="qaGauge" style={{ '--value': `${safeValue}%` }}>
      <div className={`qaGaugeCircle tone-${tone}`}><span>{formatNumber(safeValue)}%</span></div>
      <strong>{label}</strong>
    </div>
  );
}

function MetricProgress({ metric }) {
  const raw = Number(metric.valor_actual || 0);
  const target = Number(metric.objetivo_valor || 0);
  let percent = 0;
  if (target > 0) {
    percent = metric.sentido === 'menor_mejor' ? Math.max(0, Math.min(100, 100 - (raw / target) * 100)) : Math.max(0, Math.min(100, (raw / target) * 100));
  }
  return <div className="qaProgress" aria-label={`Cumplimiento ${metric.metrica}`}><span style={{ width: `${percent}%` }} /></div>;
}

function StatePill({ state }) {
  return <span className={`qaState state-${state === 'OK' ? 'ok' : 'review'}`}>{state}</span>;
}

export default function CalidadPerformancePage() {
  const initial = currentMonthRange();
  const [filters, setFilters] = useState({ month: initial.month, from: initial.from, to: initial.to });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(reportFilters(nextFilters));
    try {
      const response = await fetch(`/api/reportes/calidad-performance?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar el reporte');
      setData(payload);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const modelPending = data && data.modelReady === false;
  const statusChart = useMemo(() => {
    const summary = data?.summary || { total: 0, ok: 0, revisar: 0 };
    const okPct = summary.total ? Math.round((summary.ok / summary.total) * 100) : 0;
    return { okPct, reviewPct: 100 - okPct };
  }, [data]);

  function handleMonthChange(value) {
    setFilters({ ...filters, ...monthRange(value) });
  }

  return (
    <main className="shell qualityShell qaShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span><strong>Inthegra Reports</strong><small>Metricas QA</small></span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="qualityHeader qaHeader">
        <div>
          <p className="eyebrow">QA</p>
          <h1>Tablero minimo de metricas QA - Inthegra</h1>
          <p>Medir pocas metricas, pero utiles para decidir, priorizar mejoras y reducir riesgo en releases.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </section>

      <section className="qualityFilters qaFilters">
        <label>Mes<input type="month" value={filters.month} onChange={(event) => handleMonthChange(event.target.value)} /></label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}
      {data?.demo && <div className="warningBox">Vista previa con datos de referencia. Los valores reales se activan cuando exista la vista SQL.</div>}

      <section className="qaOverview">
        <article className="qaSummaryCard"><span>Metricas OK</span><strong>{data?.summary?.ok || 0}/{data?.summary?.total || 0}</strong><p>Indicadores dentro del objetivo sugerido.</p></article>
        <article className="qaSummaryCard review"><span>Metricas a revisar</span><strong>{data?.summary?.revisar || 0}</strong><p>Puntos con riesgo o falta de evidencia.</p></article>
        <Gauge value={statusChart.okPct} label="Estado general" tone="green" />
        <Gauge value={data?.summary?.coberturaPromedio || 0} label="Cobertura promedio" tone="orange" />
      </section>

      <section className="qaTablePanel">
        <div className="panelHeader"><div><h2>Metricas minimas</h2><p>{monthTitle(filters.month)}</p></div></div>
        {loading ? <div className="emptyState">Cargando metricas QA...</div> : (
          <div className="tableWrap">
            <table className="qaTable">
              <thead><tr><th>Metrica minima</th><th>Valor actual</th><th>Objetivo sugerido</th><th>Estado</th><th>Lectura rapida</th><th>Fuente</th><th>Cumplimiento</th></tr></thead>
              <tbody>{(data?.metrics || []).map((metric) => <tr key={metric.metric_id}><td><strong>{metric.metrica}</strong></td><td>{metric.valor_formateado}</td><td>{metric.objetivo}</td><td><StatePill state={metric.estado} /></td><td>{metric.lectura}</td><td>{metric.fuente}</td><td><MetricProgress metric={metric} /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="qaAdditionalPanel">
        <h2>Metricas adicionales sugeridas para sumar al modelo</h2>
        <div className="qaAdditionalGrid">{(data?.additionalMetrics || []).map((item) => <article key={item.metrica}><h3>{item.metrica}</h3><p>{item.motivo}</p></article>)}</div>
      </section>
    </main>
  );
}
