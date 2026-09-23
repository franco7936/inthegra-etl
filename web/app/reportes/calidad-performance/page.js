'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function todayRange() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to };
}

function formatValue(value, unit) {
  const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0));
  return unit ? `${formatted} ${unit}` : formatted;
}

function Trend({ value }) {
  if (value === 'up') return <span className="qualityTrend up">▲</span>;
  if (value === 'down') return <span className="qualityTrend down">▼</span>;
  return <span className="qualityTrend neutral">•</span>;
}

function HighlightCard({ item }) {
  return (
    <article className={`qualityHighlight state-${item.estado || 'default'}`}>
      <span>{item.indicador}</span>
      <strong>{formatValue(item.valor, item.unidad)}</strong>
    </article>
  );
}

function ProjectQualityCard({ project }) {
  return (
    <article className="qualityProjectCard">
      <header>
        <div>
          <h2>{project.proyecto}</h2>
          <p>{project.project_key_rpt || 'Proyecto'}</p>
        </div>
      </header>
      <div className="qualityMetricList">
        {project.indicadores.map((item) => (
          <div className={`qualityMetric state-${item.estado || 'default'}`} key={item.indicador}>
            <span>{item.indicador}</span>
            <strong>{formatValue(item.valor, item.unidad)}</strong>
            <Trend value={item.tendencia} />
          </div>
        ))}
      </div>
    </article>
  );
}

export default function CalidadPerformancePage() {
  const initial = todayRange();
  const [filters, setFilters] = useState({ from: initial.from, to: initial.to, projectId: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value));
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

  return (
    <main className="shell qualityShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>Calidad y performance</small>
          </span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="qualityHeader">
        <div>
          <p className="eyebrow">Operacion</p>
          <h1>Calidad y performance operativa</h1>
          <p>Seguimiento de estabilidad, retrabajo, bugs, throughput y cumplimiento operativo por proyecto.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </section>

      <section className="qualityFilters">
        <label>
          Desde
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </label>
        <label>
          Proyecto
          <select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
            <option value="">Todos</option>
            {(data?.filtersData?.projects || []).map((project) => (
              <option key={project.project_id} value={project.project_id}>{project.proyecto || project.project_key_rpt}</option>
            ))}
          </select>
        </label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}
      {data?.demo && <div className="warningBox">Vista previa con datos de referencia. Los valores reales se activan cuando exista la vista SQL.</div>}

      <section className="qualityHighlights">
        {(data?.highlights || []).map((item) => <HighlightCard key={item.indicador} item={item} />)}
      </section>

      {loading ? (
        <section className="qualityGrid"><div className="emptyState">Cargando indicadores...</div></section>
      ) : (
        <section className="qualityGrid">
          {(data?.projects || []).map((project) => <ProjectQualityCard key={project.project_id || project.proyecto} project={project} />)}
        </section>
      )}
    </main>
  );
}
