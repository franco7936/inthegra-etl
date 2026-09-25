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

function formatHours(value) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function labelType(value) {
  return String(value || 'Sin tipo').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function buildMatrix(rows, keyFields) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFields.map((field) => row[field] || '').join('||');
    const current = map.get(key) || { total: 0, registros: 0, byType: {} };
    keyFields.forEach((field) => {
      current[field] = row[field] || 'Sin dato';
    });
    const type = row.event_type || 'Sin tipo';
    const hours = Number(row.horas || 0);
    current.byType[type] = (current.byType[type] || 0) + hours;
    current.total += hours;
    current.registros += Number(row.registros || 0);
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function getMatrixData(rows, mode) {
  const eventTypesMap = new Map();
  rows.forEach((row) => {
    const type = row.event_type || 'Sin tipo';
    eventTypesMap.set(type, (eventTypesMap.get(type) || 0) + Number(row.horas || 0));
  });
  const eventTypes = [...eventTypesMap.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type);
  const matrix = buildMatrix(rows, mode === 'persona' ? ['persona', 'proyecto'] : ['proyecto']);
  return { eventTypes, matrix };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function fileDate(value) {
  return String(value || '').replace(/[^0-9-]/g, '');
}

function downloadExcel({ rows, mode, filters, filterLabels }) {
  const { eventTypes, matrix } = getMatrixData(rows, mode);
  const headers = [mode === 'persona' ? 'Persona' : null, 'Proyecto', ...eventTypes.map(labelType), 'Total horas', 'Registros'].filter(Boolean);
  const bodyRows = matrix.map((row) => [
    ...(mode === 'persona' ? [row.persona] : []),
    row.proyecto,
    ...eventTypes.map((type) => Number(row.byType[type] || 0).toFixed(2)),
    Number(row.total || 0).toFixed(2),
    Number(row.registros || 0).toFixed(0),
  ]);

  const filterRows = [
    ['Desde', filters.from || ''],
    ['Hasta', filters.to || ''],
    ['Proyecto', filterLabels.project || 'Todos'],
    ['Persona', filterLabels.person || 'Todas'],
    ['Actividad', filterLabels.eventType || 'Todas'],
    ['Vista', mode === 'persona' ? 'Personas' : 'Proyectos'],
  ];

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          table { border-collapse: collapse; font-family: Arial, sans-serif; }
          th { background: #ff6a00; color: #ffffff; font-weight: bold; }
          th, td { border: 1px solid #d9e2ef; padding: 8px; }
          td.number { mso-number-format: "0.00"; text-align: right; }
        </style>
      </head>
      <body>
        <h1>Reporte de horas</h1>
        <table>
          <tbody>
            ${filterRows.map((row) => `<tr><td><strong>${escapeHtml(row[0])}</strong></td><td>${escapeHtml(row[1])}</td></tr>`).join('')}
          </tbody>
        </table>
        <br />
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>
            ${bodyRows.map((row) => `<tr>${row.map((cell, index) => `<td${index >= (mode === 'persona' ? 2 : 1) ? ' class="number"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `reporte-horas-${fileDate(filters.from)}-${fileDate(filters.to)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function MatrixTable({ rows, mode }) {
  const { eventTypes, matrix } = useMemo(() => getMatrixData(rows, mode), [rows, mode]);

  if (!matrix.length) {
    return <div className="emptyState">No hay datos para los filtros seleccionados.</div>;
  }

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {mode === 'persona' && <th>Persona</th>}
            <th>Proyecto</th>
            {eventTypes.map((type) => <th className="number" key={type}>{labelType(type)}</th>)}
            <th className="number">Total</th>
            <th className="number">Registros</th>
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={`${row.persona || ''}-${row.proyecto}`}>
              {mode === 'persona' && <td><strong>{row.persona}</strong></td>}
              <td>{row.proyecto}</td>
              {eventTypes.map((type) => <td className="number" key={type}>{formatHours(row.byType[type])}</td>)}
              <td className="number"><strong>{formatHours(row.total)}</strong></td>
              <td className="number">{formatHours(row.registros)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReporteHorasPage() {
  const initial = todayRange();
  const [filters, setFilters] = useState({ from: initial.from, to: initial.to, projectId: '', personId: '', eventType: '' });
  const [data, setData] = useState(null);
  const [view, setView] = useState('persona');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value));
    try {
      const response = await fetch(`/api/reportes/horas?${params.toString()}`, { cache: 'no-store' });
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

  const rows = view === 'persona' ? data?.byPerson || [] : data?.byTeam || [];
  const modelPending = data && data.modelReady === false;
  const selectedProject = (data?.filtersData?.projects || []).find((project) => String(project.project_id) === String(filters.projectId));
  const selectedPerson = (data?.filtersData?.people || []).find((person) => String(person.person_id) === String(filters.personId));
  const canExport = !loading && !error && rows.length > 0;

  function handleExport() {
    downloadExcel({
      rows,
      mode: view,
      filters,
      filterLabels: {
        project: selectedProject?.proyecto || selectedProject?.project_key_rpt || '',
        person: selectedPerson?.persona || '',
        eventType: filters.eventType ? labelType(filters.eventType) : '',
      },
    });
  }

  return (
    <main className="shell reportShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>Reporte dinamico</small>
          </span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="pageHeader">
        <div>
          <p className="eyebrow">ActivityTimeline</p>
          <h1>Reporte de horas</h1>
          <p>Horas por persona y por proyecto, agrupadas por tipo de actividad.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>
          {loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}
        </span>
      </section>

      <section className="filtersPanel hoursFiltersPanel">
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
        <label>
          Persona
          <select value={filters.personId} onChange={(event) => setFilters({ ...filters, personId: event.target.value })}>
            <option value="">Todas</option>
            {(data?.filtersData?.people || []).map((person) => (
              <option key={person.person_id} value={person.person_id}>{person.persona}</option>
            ))}
          </select>
        </label>
        <label>
          Actividad
          <select value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}>
            <option value="">Todas</option>
            {(data?.filtersData?.eventTypes || []).map((item) => (
              <option key={item.event_type} value={item.event_type}>{labelType(item.event_type)}</option>
            ))}
          </select>
        </label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}

      <section className="kpiGrid">
        <article><span>Horas</span><strong>{formatHours(data?.summary?.horas)}</strong></article>
        <article><span>Personas</span><strong>{formatHours(data?.summary?.personas)}</strong></article>
        <article><span>Proyectos</span><strong>{formatHours(data?.summary?.proyectos)}</strong></article>
        <article><span>Registros</span><strong>{formatHours(data?.summary?.registros)}</strong></article>
      </section>

      <section className="reportPanel">
        <div className="panelHeader">
          <div>
            <h2>Distribucion por tipo de actividad</h2>
            <p>{filters.from} a {filters.to}</p>
          </div>
          <div className="panelActions">
            <div className="segmented">
              <button className={view === 'persona' ? 'active' : ''} onClick={() => setView('persona')}>Personas</button>
              <button className={view === 'equipo' ? 'active' : ''} onClick={() => setView('equipo')}>Proyectos</button>
            </div>
            <button className="secondaryButton" disabled={!canExport} onClick={handleExport}>Exportar Excel</button>
          </div>
        </div>
        {loading ? <div className="emptyState">Cargando datos...</div> : <MatrixTable rows={rows} mode={view} />}
      </section>
    </main>
  );
}
