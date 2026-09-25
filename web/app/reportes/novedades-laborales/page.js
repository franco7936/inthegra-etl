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
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0))} hs`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function fileDate(value) {
  return String(value || '').replace(/[^0-9-]/g, '');
}

function tableHtml(headers, rows, numericFrom = 0) {
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell, index) => `<td${index >= numericFrom ? ' class="number"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
  `;
}

function downloadExcel({ data, filters, viewMode, rows, filterLabels }) {
  const filterRows = [
    ['Desde', filters.from || ''],
    ['Hasta', filters.to || ''],
    ['Equipo', filterLabels.project || 'Todos'],
    ['Tipo', filterLabels.eventType || 'Todos'],
    ['Vista agrupada', viewMode === 'personas' ? 'Personas' : 'Equipos'],
  ];

  const summaryRows = [
    ['Horas registradas', Number(data?.summary?.horas || 0).toFixed(2)],
    ['Novedades', data?.summary?.registros || 0],
    ['Personas', data?.summary?.personas || 0],
    ['Equipos', data?.summary?.equipos || 0],
  ];

  const typeRows = (data?.byType || []).map((item) => [
    item.event_label || item.event_type,
    Number(item.horas || 0).toFixed(2),
    item.registros || 0,
  ]);

  const groupedRows = rows.map((item) => viewMode === 'personas'
    ? [item.persona, item.equipo, Number(item.day_off || 0).toFixed(2), Number(item.holiday || 0).toFixed(2), Number(item.overtime || 0).toFixed(2), Number(item.horas || 0).toFixed(2), item.registros || 0]
    : [item.equipo, Number(item.day_off || 0).toFixed(2), Number(item.holiday || 0).toFixed(2), Number(item.overtime || 0).toFixed(2), Number(item.horas || 0).toFixed(2), item.registros || 0]
  );

  const detailRows = (data?.detail || []).map((row) => [
    row.fecha,
    row.persona,
    row.equipo,
    row.event_label || row.event_type,
    Number(row.horas || 0).toFixed(2),
    row.registros || 0,
  ]);

  const groupedHeaders = viewMode === 'personas'
    ? ['Persona', 'Equipo', 'Day off', 'Holiday', 'Horas extras', 'Total horas', 'Novedades']
    : ['Equipo', 'Day off', 'Holiday', 'Horas extras', 'Total horas', 'Novedades'];

  const html = `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          table { border-collapse: collapse; margin-bottom: 18px; }
          th { background: #ff6a00; color: #ffffff; font-weight: bold; }
          th, td { border: 1px solid #d9e2ef; padding: 8px; }
          td.number { mso-number-format: "0.00"; text-align: right; }
          h1, h2 { color: #0f2043; }
        </style>
      </head>
      <body>
        <h1>Reporte de novedades laborales</h1>
        <h2>Filtros</h2>
        ${tableHtml(['Filtro', 'Valor'], filterRows, 2)}
        <h2>Resumen</h2>
        ${tableHtml(['Indicador', 'Valor'], summaryRows, 1)}
        <h2>Distribucion por tipo</h2>
        ${tableHtml(['Tipo', 'Horas', 'Novedades'], typeRows, 1)}
        <h2>${viewMode === 'personas' ? 'Agrupado por persona' : 'Agrupado por equipo'}</h2>
        ${tableHtml(groupedHeaders, groupedRows, viewMode === 'personas' ? 2 : 1)}
        <h2>Detalle</h2>
        ${tableHtml(['Fecha', 'Persona', 'Equipo', 'Tipo', 'Horas', 'Novedades'], detailRows, 4)}
      </body>
    </html>
  `;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `novedades-laborales-${fileDate(filters.from)}-${fileDate(filters.to)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function TypeBadge({ type, label }) {
  return <span className={`laborBadge type-${type}`}>{label || type}</span>;
}

function MiniBar({ value, max }) {
  const width = max > 0 ? Math.max(6, Math.min(100, (Number(value || 0) / max) * 100)) : 0;
  return <span className="laborBar"><span style={{ width: `${width}%` }} /></span>;
}

export default function NovedadesLaboralesPage() {
  const initial = todayRange();
  const [filters, setFilters] = useState({ from: initial.from, to: initial.to, projectId: '', eventType: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('personas');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(nextFilters);
    try {
      const response = await fetch(`/api/reportes/novedades-laborales?${params.toString()}`, { cache: 'no-store' });
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
  const maxTypeHours = useMemo(() => Math.max(...(data?.byType || []).map((item) => Number(item.horas || 0)), 0), [data]);
  const rows = viewMode === 'personas' ? data?.byPerson || [] : data?.byTeam || [];
  const maxRowHours = useMemo(() => Math.max(...rows.map((item) => Number(item.horas || 0)), 0), [rows]);
  const selectedProject = (data?.filtersData?.projects || []).find((project) => String(project.project_id) === String(filters.projectId));
  const selectedEventType = (data?.filtersData?.eventTypes || []).find((type) => String(type.event_type) === String(filters.eventType));
  const canExport = !loading && !error && Boolean(data) && ((data?.detail || []).length > 0 || rows.length > 0);

  function handleExport() {
    downloadExcel({
      data,
      filters,
      viewMode,
      rows,
      filterLabels: {
        project: selectedProject?.equipo || '',
        eventType: selectedEventType?.label || '',
      },
    });
  }

  return (
    <main className="shell laborShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>Novedades laborales</small>
          </span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="qualityHeader laborHeader">
        <div>
          <p className="eyebrow">ActivityTimeline</p>
          <h1>Reporte de novedades laborales</h1>
          <p>Seguimiento de day off, feriados y horas extras por persona y por equipo dentro del periodo seleccionado.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </section>

      <section className="qualityFilters laborFilters laborFiltersExport">
        <label>
          Desde
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </label>
        <label>
          Equipo
          <select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}>
            <option value="">Todos</option>
            {(data?.filtersData?.projects || []).map((project) => (
              <option key={project.project_id} value={project.project_id}>{project.equipo}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}>
            <option value="">Todos</option>
            {(data?.filtersData?.eventTypes || []).map((type) => (
              <option key={type.event_type} value={type.event_type}>{type.label}</option>
            ))}
          </select>
        </label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
        <button className="secondaryButton" disabled={!canExport} onClick={handleExport}>Exportar Excel</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}
      {data?.demo && <div className="warningBox">Vista previa con datos de referencia. Los valores reales se activan cuando exista la vista SQL.</div>}

      <section className="laborOverview">
        <article>
          <span>Horas registradas</span>
          <strong>{formatHours(data?.summary?.horas)}</strong>
        </article>
        <article>
          <span>Novedades</span>
          <strong>{data?.summary?.registros || 0}</strong>
        </article>
        <article>
          <span>Personas</span>
          <strong>{data?.summary?.personas || 0}</strong>
        </article>
        <article>
          <span>Equipos</span>
          <strong>{data?.summary?.equipos || 0}</strong>
        </article>
      </section>

      <section className="laborCharts">
        <article className="laborPanel">
          <div className="panelHeader">
            <div>
              <h2>Distribucion por tipo</h2>
              <p>{filters.from} a {filters.to}</p>
            </div>
          </div>
          <div className="laborTypeList">
            {(data?.byType || []).map((item) => (
              <div className="laborTypeRow" key={item.event_type}>
                <TypeBadge type={item.event_type} label={item.event_label} />
                <MiniBar value={item.horas} max={maxTypeHours} />
                <strong>{formatHours(item.horas)}</strong>
              </div>
            ))}
            {!loading && !(data?.byType || []).length && <div className="emptyState">Sin novedades para el periodo.</div>}
          </div>
        </article>

        <article className="laborPanel">
          <div className="panelHeader">
            <div>
              <h2>{viewMode === 'personas' ? 'Por persona' : 'Por equipo'}</h2>
              <p>Agrupado por horas registradas</p>
            </div>
            <div className="segmented">
              <button className={viewMode === 'personas' ? 'active' : ''} onClick={() => setViewMode('personas')}>Personas</button>
              <button className={viewMode === 'equipos' ? 'active' : ''} onClick={() => setViewMode('equipos')}>Equipos</button>
            </div>
          </div>
          <div className="laborRankList">
            {rows.map((item) => (
              <div className="laborRankRow" key={`${viewMode}-${item.person_id || item.project_id}-${item.equipo}`}>
                <div>
                  <strong>{viewMode === 'personas' ? item.persona : item.equipo}</strong>
                  <small>{viewMode === 'personas' ? item.equipo : `${item.registros} novedades`}</small>
                </div>
                <MiniBar value={item.horas} max={maxRowHours} />
                <span>{formatHours(item.horas)}</span>
              </div>
            ))}
            {!loading && !rows.length && <div className="emptyState">Sin datos agrupados para mostrar.</div>}
          </div>
        </article>
      </section>

      <section className="laborPanel laborDetailPanel">
        <div className="panelHeader">
          <div>
            <h2>Detalle de novedades</h2>
            <p>Ultimos registros del periodo</p>
          </div>
        </div>
        {loading ? (
          <div className="emptyState">Cargando novedades laborales...</div>
        ) : (
          <div className="tableWrap">
            <table className="laborTable">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Persona</th>
                  <th>Equipo</th>
                  <th>Tipo</th>
                  <th className="number">Horas</th>
                </tr>
              </thead>
              <tbody>
                {(data?.detail || []).map((row, index) => (
                  <tr key={`${row.fecha}-${row.person_id}-${row.project_id}-${row.event_type}-${index}`}>
                    <td>{row.fecha}</td>
                    <td>{row.persona}</td>
                    <td>{row.equipo}</td>
                    <td><TypeBadge type={row.event_type} label={row.event_label} /></td>
                    <td className="number"><strong>{formatHours(row.horas)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !(data?.detail || []).length && <div className="emptyState">Sin detalle para el periodo seleccionado.</div>}
          </div>
        )}
      </section>
    </main>
  );
}
