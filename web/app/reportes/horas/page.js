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

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function businessDaysBetween(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end || start > end) return 0;

  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const day = current.getUTCDay();
    if (day >= 1 && day <= 5) count += 1;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}

function periodLabel(from, to) {
  const start = parseDate(from);
  const end = parseDate(to);
  if (!start || !end) return 'periodo';

  const formatter = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
}

function formatHours(value) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(value))}%`;
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

function getPersonTotals(matrix) {
  const totals = new Map();
  matrix.forEach((row) => {
    if (!row.persona) return;
    totals.set(row.persona, (totals.get(row.persona) || 0) + Number(row.total || 0));
  });
  return totals;
}

function getPersonRowSpans(matrix) {
  const spans = new Map();
  matrix.forEach((row) => {
    if (!row.persona) return;
    spans.set(row.persona, (spans.get(row.persona) || 0) + 1);
  });
  return spans;
}

function complianceClass(percent) {
  if (percent >= 98) return 'ok';
  if (percent >= 85) return 'warning';
  return 'danger';
}

function complianceText(percent) {
  if (percent >= 98) return 'Cumple';
  if (percent >= 85) return 'Cerca';
  return 'Revisar';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function fileDate(value) {
  return String(value || '').replace(/[^0-9-]/g, '');
}

function downloadExcel({ rows, mode, filters, filterLabels, expectedPerPerson, expectedTotal, businessDays, period }) {
  const { eventTypes, matrix } = getMatrixData(rows, mode);
  const personTotals = getPersonTotals(matrix);
  const headers = mode === 'persona'
    ? ['Persona', 'Proyecto', ...eventTypes.map(labelType), 'Total fila', 'Total persona', 'Estimado persona', 'Cumplimiento %', 'Estado', 'Registros']
    : ['Proyecto', ...eventTypes.map(labelType), 'Total horas', 'Registros'];
  const bodyRows = matrix.map((row) => {
    if (mode === 'persona') {
      const personTotal = Number(personTotals.get(row.persona) || 0);
      const percent = expectedPerPerson > 0 ? (personTotal / expectedPerPerson) * 100 : 0;
      return [
        row.persona,
        row.proyecto,
        ...eventTypes.map((type) => Number(row.byType[type] || 0).toFixed(2)),
        Number(row.total || 0).toFixed(2),
        personTotal.toFixed(2),
        Number(expectedPerPerson || 0).toFixed(2),
        percent.toFixed(0),
        complianceText(percent),
        Number(row.registros || 0).toFixed(0),
      ];
    }

    return [
      row.proyecto,
      ...eventTypes.map((type) => Number(row.byType[type] || 0).toFixed(2)),
      Number(row.total || 0).toFixed(2),
      Number(row.registros || 0).toFixed(0),
    ];
  });

  const filterRows = [
    ['Desde', filters.from || ''],
    ['Hasta', filters.to || ''],
    ['Proyecto', filterLabels.project || 'Todos'],
    ['Persona', filterLabels.person || 'Todas'],
    ['Actividad', filterLabels.eventType || 'Todas'],
    ['Vista', mode === 'persona' ? 'Personas' : 'Proyectos'],
    ['Periodo estimado', period],
    ['Dias habiles', businessDays],
    ['Total estimado horas', Number(expectedTotal || 0).toFixed(2)],
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

function MatrixTable({ rows, mode, expectedPerPerson }) {
  const { eventTypes, matrix } = useMemo(() => getMatrixData(rows, mode), [rows, mode]);
  const personTotals = useMemo(() => getPersonTotals(matrix), [matrix]);
  const personRowSpans = useMemo(() => getPersonRowSpans(matrix), [matrix]);
  const visibleMatrix = useMemo(() => {
    if (mode !== 'persona') return matrix;
    return [...matrix].sort((a, b) => {
      const byPerson = String(a.persona || '').localeCompare(String(b.persona || ''), 'es');
      if (byPerson !== 0) return byPerson;
      return String(a.proyecto || '').localeCompare(String(b.proyecto || ''), 'es');
    });
  }, [matrix, mode]);

  if (!matrix.length) {
    return <div className="emptyState">No hay datos para los filtros seleccionados.</div>;
  }

  const renderedPeople = new Set();

  return (
    <div className="tableWrap hoursTableWrap">
      <table className="hoursMatrixTable">
        <thead>
          <tr>
            {mode === 'persona' && <th>Persona</th>}
            <th>Proyecto</th>
            {eventTypes.map((type) => <th className="number" key={type}>{labelType(type)}</th>)}
            <th className="number">Total fila</th>
            {mode === 'persona' && <th>Cumplimiento</th>}
            <th className="number">Registros</th>
          </tr>
        </thead>
        <tbody>
          {visibleMatrix.map((row) => {
            const isFirstPersonRow = mode === 'persona' && !renderedPeople.has(row.persona);
            if (isFirstPersonRow) renderedPeople.add(row.persona);
            const personTotal = Number(personTotals.get(row.persona) || 0);
            const percent = expectedPerPerson > 0 ? (personTotal / expectedPerPerson) * 100 : 0;
            const status = complianceClass(percent);
            const rowKey = `${row.persona || ''}-${row.proyecto}`;

            return (
              <tr key={rowKey} className={mode === 'persona' ? `personStatus-${status}` : ''}>
                {mode === 'persona' && isFirstPersonRow && (
                  <td className="personGroupCell" rowSpan={personRowSpans.get(row.persona)}>
                    <strong>{row.persona}</strong>
                    <small>{formatHours(personTotal)} hs cargadas</small>
                  </td>
                )}
                <td>{row.proyecto}</td>
                {eventTypes.map((type) => <td className="number" key={type}>{formatHours(row.byType[type])}</td>)}
                <td className="number"><strong>{formatHours(row.total)}</strong></td>
                {mode === 'persona' && isFirstPersonRow && (
                  <td className="complianceCell" rowSpan={personRowSpans.get(row.persona)}>
                    <span className={`hoursCompliance ${status}`}>{complianceText(percent)} · {formatPercent(percent)}</span>
                    <small>Meta {formatHours(expectedPerPerson)} hs</small>
                  </td>
                )}
                <td className="number">{formatHours(row.registros)}</td>
              </tr>
            );
          })}
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
  const businessDays = businessDaysBetween(filters.from, filters.to);
  const expectedPerPerson = businessDays * 8;
  const estimatedTotal = Number(data?.summary?.personas || 0) * expectedPerPerson;
  const loadedHours = Number(data?.summary?.horas || 0);
  const coveragePercent = estimatedTotal > 0 ? (loadedHours / estimatedTotal) * 100 : 0;
  const selectedPeriod = periodLabel(filters.from, filters.to);
  const modelPending = data && data.modelReady === false;
  const selectedProject = (data?.filtersData?.projects || []).find((project) => String(project.project_id) === String(filters.projectId));
  const selectedPerson = (data?.filtersData?.people || []).find((person) => String(person.person_id) === String(filters.personId));
  const canExport = !loading && !error && rows.length > 0;

  function handleExport() {
    downloadExcel({
      rows,
      mode: view,
      filters,
      expectedPerPerson,
      expectedTotal: estimatedTotal,
      businessDays,
      period: selectedPeriod,
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

      <section className="kpiGrid hoursKpiGrid">
        <article className="estimatedHoursCard">
          <span>Total estimado horas del mes</span>
          <strong>{formatHours(estimatedTotal)}</strong>
          <small>{selectedPeriod} · {formatHours(data?.summary?.personas)} personas · {businessDays} dias habiles</small>
        </article>
        <article>
          <span>Horas</span>
          <strong>{formatHours(data?.summary?.horas)}</strong>
          <small>{formatPercent(coveragePercent)} del estimado</small>
        </article>
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
        {loading ? <div className="emptyState">Cargando datos...</div> : <MatrixTable rows={rows} mode={view} expectedPerPerson={expectedPerPerson} />}
      </section>
    </main>
  );
}
