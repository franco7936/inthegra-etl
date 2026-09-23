'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

function defaultWeek() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

function HealthPill({ value }) {
  const label = { verde: 'OK', amarillo: 'Atencion', rojo: 'Riesgo', gris: 'Sin dato' }[value] || value;
  return <span className={`statusHealth health-${value}`}>{label}</span>;
}

function ProgressBar({ value }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <span className="statusProgress">
      <span style={{ width: `${safe}%` }} />
      <strong>{safe}%</strong>
    </span>
  );
}

export default function StatusSemanalPage() {
  const [filters, setFilters] = useState({ week: defaultWeek(), equipo: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(nextFilters);
    try {
      const response = await fetch(`/api/reportes/status-semanal?${params.toString()}`, { cache: 'no-store' });
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
  const healthChart = useMemo(() => {
    const total = data?.summary?.total || 0;
    if (!total) return [];
    return [
      { key: 'verde', label: 'OK', value: data.summary.verdes || 0 },
      { key: 'amarillo', label: 'Atencion', value: data.summary.amarillos || 0 },
      { key: 'rojo', label: 'Riesgo', value: data.summary.rojos || 0 },
    ].map((item) => ({ ...item, pct: Math.round((item.value / total) * 100) }));
  }, [data]);

  return (
    <main className="shell weeklyShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>Status semanal</small>
          </span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="qualityHeader weeklyHeader">
        <div>
          <p className="eyebrow">Reporte semanal</p>
          <h1>Status semanal de lideres</h1>
          <p>Vista ejecutiva para consolidar el reporte semanal del equipo: estado general, avance, riesgos, bloqueos y proximos pasos.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando datos' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </section>

      <section className="qualityFilters weeklyFilters">
        <label>
          Semana
          <input type="date" value={filters.week} onChange={(event) => setFilters({ ...filters, week: event.target.value })} />
        </label>
        <label>
          Equipo
          <select value={filters.equipo} onChange={(event) => setFilters({ ...filters, equipo: event.target.value })}>
            <option value="">Todos</option>
            {(data?.filtersData?.equipos || []).map((equipo) => (
              <option key={equipo} value={equipo}>{equipo}</option>
            ))}
          </select>
        </label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}
      {data?.demo && <div className="warningBox">Vista previa con datos de referencia. La estructura final se ajusta cuando terminemos de mapear el Excel.</div>}

      <section className="weeklySummary">
        <article>
          <span>Items reportados</span>
          <strong>{data?.summary?.total || 0}</strong>
        </article>
        <article>
          <span>Avance promedio</span>
          <strong>{data?.summary?.avancePromedio || 0}%</strong>
        </article>
        <article>
          <span>En atencion</span>
          <strong>{data?.summary?.amarillos || 0}</strong>
        </article>
        <article>
          <span>En riesgo</span>
          <strong>{data?.summary?.rojos || 0}</strong>
        </article>
      </section>

      <section className="weeklyGrid">
        <article className="weeklyPanel">
          <div className="panelHeader">
            <div>
              <h2>Semaforo semanal</h2>
              <p>Distribucion por estado de salud</p>
            </div>
          </div>
          <div className="weeklyHealthList">
            {healthChart.map((item) => (
              <div className="weeklyHealthRow" key={item.key}>
                <HealthPill value={item.key} />
                <span className="weeklyHealthBar"><span className={`health-${item.key}`} style={{ width: `${item.pct}%` }} /></span>
                <strong>{item.value}</strong>
              </div>
            ))}
            {!loading && !healthChart.length && <div className="emptyState">Sin items para la semana seleccionada.</div>}
          </div>
        </article>

        <article className="weeklyPanel weeklyNarrative">
          <div className="panelHeader">
            <div>
              <h2>Lectura ejecutiva</h2>
              <p>Resumen para reunion semanal</p>
            </div>
          </div>
          <div className="weeklyNarrativeBody">
            <p>El reporte consolida lo informado por lideres y permite revisar rapidamente avance, estado, riesgos y proximos pasos por equipo o iniciativa.</p>
            <p>La primera version queda preparada para reemplazar estos datos por una vista SQL o por una carga estructurada desde el Excel semanal.</p>
          </div>
        </article>
      </section>

      <section className="weeklyItems">
        {(data?.items || []).map((item, index) => (
          <article className="weeklyItem" key={`${item.equipo}-${item.proyecto}-${index}`}>
            <header>
              <div>
                <span className="weeklyTeam">{item.equipo}</span>
                <h2>{item.proyecto}</h2>
                <p>{item.lider} · Actualizado {item.fecha_actualizacion}</p>
              </div>
              <div className="weeklyItemStatus">
                <HealthPill value={item.salud} />
                <ProgressBar value={item.avance_pct} />
              </div>
            </header>
            <div className="weeklyItemGrid">
              <section>
                <h3>Resumen</h3>
                <p>{item.resumen}</p>
              </section>
              <section>
                <h3>Avances</h3>
                <p>{item.avances}</p>
              </section>
              <section>
                <h3>Riesgos</h3>
                <p>{item.riesgos}</p>
              </section>
              <section>
                <h3>Bloqueos</h3>
                <p>{item.bloqueos}</p>
              </section>
              <section>
                <h3>Proximos pasos</h3>
                <p>{item.proximos_pasos}</p>
              </section>
            </div>
          </article>
        ))}
        {loading && <div className="emptyState">Cargando status semanal...</div>}
        {!loading && !(data?.items || []).length && <div className="emptyState">Sin status semanal para mostrar.</div>}
      </section>
    </main>
  );
}
