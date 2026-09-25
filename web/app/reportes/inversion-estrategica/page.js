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
  return { from: filters.from, to: filters.to, projectId: filters.projectId };
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
  const initial = currentMonthRange();
  const [filters, setFilters] = useState({ month: initial.month, from: initial.from, to: initial.to, projectId: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(Object.entries(reportFilters(nextFilters)).filter(([, value]) => value));
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

  function handleMonthChange(value) {
    setFilters({ ...filters, ...monthRange(value) });
  }

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
          <h1>Inversiones Estratégicas · {monthTitle(filters.month)}</h1>
          <p>Horas destinadas agrupadas por proyecto y por épica.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </section>

      <section className="investmentFilters">
        <label>
          Mes
          <input type="month" value={filters.month} onChange={(event) => handleMonthChange(event.target.value)} />
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
        <article><span>Proyectos</span><strong>{data?.projects?.length || 0}</strong></article>
        <article><span>Horas totales</span><strong>{formatHours(totalHours)} hrs</strong></article>
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
