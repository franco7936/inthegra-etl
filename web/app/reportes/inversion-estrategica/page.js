'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

function todayRange() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, to };
}

function monthTitle(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  return new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
}

function formatHours(value) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function EpicRow({ epic }) {
  return (
    <li className="investmentRow">
      <span>{epic.epica}</span>
      <strong>{formatHours(epic.horas)} hrs</strong>
      <em>{epic.estado || 'Sin estado'}</em>
      <i className={`investmentDot dot-${epic.color || 'blue'}`} />
    </li>
  );
}

function ProjectPanel({ project }) {
  return (
    <article className="investmentPanel">
      <header>
        <div>
          <h2>{project.proyecto}</h2>
          <p>{project.project_key_rpt || 'Proyecto'} · {formatHours(project.horas)} hrs totales</p>
        </div>
      </header>
      <ul>
        {project.epicas.map((epic, index) => <EpicRow key={`${epic.epic_key}-${index}`} epic={epic} />)}
      </ul>
    </article>
  );
}

export default function InversionEstrategicaPage() {
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
      const response = await fetch(`/api/reportes/inversion-estrategica?${params.toString()}`, { cache: 'no-store' });
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

  const totalHours = useMemo(() => (data?.projects || []).reduce((sum, project) => sum + Number(project.horas || 0), 0), [data]);
  const modelPending = data && data.modelReady === false;

  return (
    <main className="shell investmentShell">
      <nav className="topbar investmentTopbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>Inversion estrategica</small>
          </span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="investmentHero">
        <div>
          <h1>Inversiones Estratégicas · {monthTitle(filters.from)}</h1>
          <p>Horas destinadas agrupadas por proyecto y por épica.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </section>

      <section className="investmentFilters">
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
      {data?.demo && <div className="warningBox">Vista previa con datos de referencia del mockup. Los valores reales se activan cuando exista la vista SQL.</div>}

      <section className="investmentSummary">
        <article>
          <span>Proyectos</span>
          <strong>{data?.projects?.length || 0}</strong>
        </article>
        <article>
          <span>Horas totales</span>
          <strong>{formatHours(totalHours)} hrs</strong>
        </article>
      </section>

      {loading ? (
        <section className="investmentGrid"><div className="emptyState">Cargando inversiones...</div></section>
      ) : (
        <section className="investmentGrid">
          {(data?.projects || []).map((project) => <ProjectPanel key={project.project_id || project.proyecto} project={project} />)}
        </section>
      )}
    </main>
  );
}
