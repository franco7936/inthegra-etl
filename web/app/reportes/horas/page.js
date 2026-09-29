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

function formatHours(value) { return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0)); }
function formatPercent(value) { if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'; return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(value))}%`; }
function formatDateDisplay(value) { const date = parseDate(String(value || '').slice(0, 10)); if (!date) return 'Sin carga'; return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date); }
const FIXED_EVENT_TYPES = ['booking', 'day_off', 'holiday', 'jira_issue', 'placeholder', 'sick_leave', 'vacation', 'worklog'];
function normalizeEventType(value) {
  const normalized = String(value || 'sin_tipo').trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'jira_issue') return 'jira_issue';
  if (normalized === 'sick_leave') return 'sick_leave';
  return normalized;
}
function labelType(value) { return String(value || 'Sin tipo').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()); }

function buildMatrix(rows, keyFields) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFields.map((field) => row[field] || '').join('||');
    const current = map.get(key) || { total: 0, atTotal: 0, pgiTotal: 0, registros: 0, byType: {}, latestDate: '' };
    keyFields.forEach((field) => { current[field] = row[field] || 'Sin dato'; });
    const type = normalizeEventType(row.event_type);
    const hours = Number(row.horas || 0);
    const pgiHours = Number(row.horas_pgi || 0);
    const atHours = Number(row.horas_at || 0);
    const latestDate = String(row.ultima_fecha || row.fecha || '').slice(0, 10);
    if (type !== 'PGI') current.byType[type] = (current.byType[type] || 0) + hours;
    current.total += hours;
    current.atTotal += atHours;
    current.pgiTotal += pgiHours;
    current.registros += Number(row.registros || 0);
    if (latestDate && latestDate > current.latestDate) current.latestDate = latestDate;
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function getMatrixData(rows, mode) {
  const eventTypesMap = new Map();
  rows.forEach((row) => { const type = normalizeEventType(row.event_type); if (type === 'pgi') return; eventTypesMap.set(type, (eventTypesMap.get(type) || 0) + Number(row.horas || 0)); });
  const dynamicTypes = [...eventTypesMap.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type).filter((type) => !FIXED_EVENT_TYPES.includes(type));
  const eventTypes = [...FIXED_EVENT_TYPES, ...dynamicTypes];
  const matrix = buildMatrix(rows, mode === 'persona' ? ['persona', 'proyecto'] : ['proyecto']);
  return { eventTypes, matrix };
}
function getPersonTotals(matrix) { const totals = new Map(); matrix.forEach((row) => { if (row.persona) totals.set(row.persona, (totals.get(row.persona) || 0) + Number(row.total || 0)); }); return totals; }
function getPersonLatestDates(matrix) { const latest = new Map(); matrix.forEach((row) => { if (!row.persona || !row.latestDate) return; if (!latest.get(row.persona) || row.latestDate > latest.get(row.persona)) latest.set(row.persona, row.latestDate); }); return latest; }
function getPersonRowSpans(matrix) { const spans = new Map(); matrix.forEach((row) => { if (row.persona) spans.set(row.persona, (spans.get(row.persona) || 0) + 1); }); return spans; }
function complianceClass(percent) { if (percent >= 100) return 'ok'; if (percent >= 80) return 'warning'; return 'danger'; }
function complianceText(percent) { if (percent >= 100) return 'OK'; if (percent >= 80) return 'Revisar'; return 'Alerta'; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }
function fileDate(value) { return String(value || '').replace(/[^0-9-]/g, ''); }
function reportFilters(filters) { return { from: filters.from, to: filters.to, projectId: filters.projectId, personId: filters.personId, eventType: filters.eventType, activityDetail: filters.activityDetail }; }

function downloadExcel({ rows, mode, filters, filterLabels, expectedPerPerson, expectedTotal, businessDays, period, summary }) {
  const { eventTypes, matrix } = getMatrixData(rows, mode);
  const personTotals = getPersonTotals(matrix);
  const personLatestDates = getPersonLatestDates(matrix);
  const headers = mode === 'persona' ? ['Persona', 'Ultima carga', 'Proyecto', ...eventTypes.map(labelType), 'Total AT', 'PGI', 'Total fila', 'Total persona', 'Estimado persona', 'Cumplimiento %', 'Estado', 'Registros'] : ['Proyecto', ...eventTypes.map(labelType), 'Total AT', 'PGI', 'Total horas', 'Registros'];
  const bodyRows = matrix.map((row) => {
    if (mode === 'persona') {
      const personTotal = Number(personTotals.get(row.persona) || 0);
      const percent = expectedPerPerson > 0 ? (personTotal / expectedPerPerson) * 100 : 0;
      return [row.persona, formatDateDisplay(personLatestDates.get(row.persona)), row.proyecto, ...eventTypes.map((type) => Number(row.byType[type] || 0).toFixed(2)), Number(row.atTotal || 0).toFixed(2), Number(row.pgiTotal || 0).toFixed(2), Number(row.total || 0).toFixed(2), personTotal.toFixed(2), Number(expectedPerPerson || 0).toFixed(2), percent.toFixed(0), complianceText(percent), Number(row.registros || 0).toFixed(0)];
    }
    return [row.proyecto, ...eventTypes.map((type) => Number(row.byType[type] || 0).toFixed(2)), Number(row.atTotal || 0).toFixed(2), Number(row.pgiTotal || 0).toFixed(2), Number(row.total || 0).toFixed(2), Number(row.registros || 0).toFixed(0)];
  });
  const filterRows = [['Mes', period], ['Desde', filters.from || ''], ['Hasta', filters.to || ''], ['Proyecto', filterLabels.project || 'Todos'], ['Persona', filterLabels.person || 'Todas'], ['Actividad', filterLabels.eventType || 'Todas'], ['Detalle booking', filterLabels.activityDetail || 'Todos'], ['Vista', mode === 'persona' ? 'Personas' : 'Proyectos'], ['Dias habiles', businessDays], ['Total estimado horas', Number(expectedTotal || 0).toFixed(2)], ['Horas AT', Number(summary?.horas_at || 0).toFixed(2)], ['Horas PGI', Number(summary?.horas_pgi || 0).toFixed(2)], ['Horas totales', Number(summary?.horas || 0).toFixed(2)]];
  const html = `<html><head><meta charset="UTF-8" /><style>table{border-collapse:collapse;font-family:Arial,sans-serif;margin-bottom:18px}th{background:#ff6a00;color:#fff;font-weight:bold}th,td{border:1px solid #d9e2ef;padding:8px}td.number{mso-number-format:"0.00";text-align:right}h1,h2{color:#0f2043}</style></head><body><h1>Reporte de horas</h1><h2>Filtros y resumen</h2><table><tbody>${filterRows.map((row) => `<tr><td><strong>${escapeHtml(row[0])}</strong></td><td>${escapeHtml(row[1])}</td></tr>`).join('')}</tbody></table><h2>Detalle agrupado</h2><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${bodyRows.map((row) => `<tr>${row.map((cell, index) => `<td${index >= (mode === 'persona' ? 3 : 1) ? ' class="number"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
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
  const personLatestDates = useMemo(() => getPersonLatestDates(matrix), [matrix]);
  const personRowSpans = useMemo(() => getPersonRowSpans(matrix), [matrix]);
  const visibleMatrix = useMemo(() => {
    if (mode !== 'persona') return matrix;
    return [...matrix].sort((a, b) => { const byPerson = String(a.persona || '').localeCompare(String(b.persona || ''), 'es'); if (byPerson !== 0) return byPerson; return String(a.proyecto || '').localeCompare(String(b.proyecto || ''), 'es'); });
  }, [matrix, mode]);
  if (!matrix.length) return <div className="emptyState">No hay datos para los filtros seleccionados.</div>;
  const renderedPeople = new Set();
  return <div className="tableWrap hoursTableWrap"><table className="hoursMatrixTable"><thead><tr>{mode === 'persona' && <th>Persona</th>}<th>Proyecto</th>{eventTypes.map((type) => <th className="number" key={type}>{labelType(type)}</th>)}<th className="number">Total AT</th><th className="number">PGI</th><th className="number">Total fila</th>{mode === 'persona' && <th>Cumplimiento</th>}<th className="number">Registros</th></tr></thead><tbody>{visibleMatrix.map((row) => { const isFirstPersonRow = mode === 'persona' && !renderedPeople.has(row.persona); if (isFirstPersonRow) renderedPeople.add(row.persona); const personTotal = Number(personTotals.get(row.persona) || 0); const latestDate = personLatestDates.get(row.persona); const percent = expectedPerPerson > 0 ? (personTotal / expectedPerPerson) * 100 : 0; const status = complianceClass(percent); return <tr key={`${row.persona || ''}-${row.proyecto}`} className={mode === 'persona' ? `personStatus-${status}` : ''}>{mode === 'persona' && isFirstPersonRow && <td className="personGroupCell" rowSpan={personRowSpans.get(row.persona)}><strong>{row.persona}</strong><small>Ultima carga: {formatDateDisplay(latestDate)}</small><small>{formatHours(personTotal)} hs cargadas</small></td>}<td>{row.proyecto}</td>{eventTypes.map((type) => <td className="number" key={type}>{formatHours(row.byType[type])}</td>)}<td className="number"><strong>{formatHours(row.atTotal)}</strong></td><td className="number pgiColumn"><strong>{formatHours(row.pgiTotal)}</strong></td><td className="number"><strong>{formatHours(row.total)}</strong></td>{mode === 'persona' && isFirstPersonRow && <td className="complianceCell" rowSpan={personRowSpans.get(row.persona)}><span className={`hoursCompliance ${status}`}>{complianceText(percent)} · {formatPercent(percent)}</span><small>Meta {formatHours(expectedPerPerson)} hs</small></td>}<td className="number">{formatHours(row.registros)}</td></tr>; })}</tbody></table></div>;
}

export default function ReporteHorasPage() {
  const initial = currentMonthRange();
  const [filters, setFilters] = useState({ month: initial.month, from: initial.from, to: initial.to, projectId: '', personId: '', eventType: '', activityDetail: '' });
  const [data, setData] = useState(null);
  const [view, setView] = useState('persona');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pgiOpen, setPgiOpen] = useState(false);
  const [pgiRefs, setPgiRefs] = useState({ projects: [], people: [], incidenceTypes: [] });
  const [pgiForm, setPgiForm] = useState({ projectId: '', personId: '', incidenceType: 'pgi', fecha: initial.from, horas: '', comentario: '' });
  const [pgiSaving, setPgiSaving] = useState(false);
  const [pgiError, setPgiError] = useState('');

  async function loadData(nextFilters = filters) {
    setLoading(true); setError('');
    const params = new URLSearchParams(Object.entries(reportFilters(nextFilters)).filter(([, value]) => value));
    try { const response = await fetch(`/api/reportes/horas?${params.toString()}`, { cache: 'no-store' }); const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar el reporte'); setData(payload); }
    catch (err) { setError(err.message); setData(null); }
    finally { setLoading(false); }
  }

  async function openPgiLog() {
    setPgiError(''); setPgiOpen(true);
    try {
      const response = await fetch('/api/pgi-workload', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudieron cargar proyectos/personas');
      const projects = payload.projects || [];
      setPgiRefs({ projects, people: payload.people || [], incidenceTypes: payload.incidenceTypes || [] });
      setPgiForm((current) => ({ ...current, projectId: current.projectId || (projects.length === 1 ? String(projects[0].project_id) : '') }));
    } catch (err) { setPgiError(err.message); }
  }

  async function savePgiLog(event) {
    event.preventDefault(); setPgiSaving(true); setPgiError('');
    try {
      const response = await fetch('/api/pgi-workload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pgiForm) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar PGI');
      setPgiOpen(false);
      setPgiForm({ projectId: '', personId: '', incidenceType: 'pgi', fecha: filters.from, horas: '', comentario: '' });
      loadData(filters);
    } catch (err) { setPgiError(err.message); }
    finally { setPgiSaving(false); }
  }

  useEffect(() => { loadData(); }, []);

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
  const selectedActivityDetail = (data?.filtersData?.activityDetails || []).find((item) => String(item.activity_detail_at) === String(filters.activityDetail));
  const canExport = !loading && !error && rows.length > 0;

  function handleMonthChange(value) { const nextRange = monthRange(value); setFilters({ ...filters, ...nextRange }); setPgiForm({ ...pgiForm, fecha: nextRange.from }); }
  function handleExport() { downloadExcel({ rows, mode: view, filters, expectedPerPerson, expectedTotal: estimatedTotal, businessDays, period: selectedPeriod, summary: data?.summary, filterLabels: { project: selectedProject?.proyecto || selectedProject?.project_key_rpt || '', person: selectedPerson?.persona || '', eventType: filters.eventType ? labelType(filters.eventType) : '', activityDetail: selectedActivityDetail?.activity_detail_at || filters.activityDetail || '' } }); }

  return (
    <main className="shell reportShell hoursReportShell">
      <nav className="topbar">
        <Link className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span><strong>Inthegra Reports</strong><small>Reporte dinamico</small></span>
        </Link>
        <Link className="navLink" href="/">Inicio</Link>
      </nav>

      <section className="pageHeader">
        <div>
          <p className="eyebrow">ActivityTimeline + PGI</p>
          <h1>Reporte de horas</h1>
          <p>Horas por persona y por proyecto, agrupadas por tipo de actividad e incluyendo cargas PGI manuales.</p>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>
          {loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}
        </span>
      </section>

      <section className="filtersPanel hoursFiltersPanel">
        <label>Mes<input type="month" value={filters.month} onChange={(event) => handleMonthChange(event.target.value)} /></label>
        <label>Proyecto<select value={filters.projectId} onChange={(event) => setFilters({ ...filters, projectId: event.target.value })}><option value="">Todos</option>{(data?.filtersData?.projects || []).map((project) => <option key={project.project_id} value={project.project_id}>{project.proyecto || project.project_key_rpt}</option>)}</select></label>
        <label>Persona<select value={filters.personId} onChange={(event) => setFilters({ ...filters, personId: event.target.value })}><option value="">Todas</option>{(data?.filtersData?.people || []).map((person) => <option key={person.person_id} value={person.person_id}>{person.persona}</option>)}</select></label>
        <label>Actividad<select value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })}><option value="">Todas</option>{(data?.filtersData?.eventTypes || []).map((item) => <option key={item.event_type} value={item.event_type}>{labelType(item.event_type)}</option>)}</select></label>
        <label>Detalle booking<select value={filters.activityDetail} onChange={(event) => setFilters({ ...filters, activityDetail: event.target.value })}><option value="">Todos</option>{(data?.filtersData?.activityDetails || []).map((item) => <option key={item.activity_detail_at} value={item.activity_detail_at}>{item.activity_detail_at}</option>)}</select></label>
        <button className="primaryButton compact" onClick={() => loadData(filters)}>Aplicar</button>
      </section>

      {error && <div className="errorBox">{error}</div>}
      {modelPending && <div className="errorBox">{data.setupMessage}</div>}

      <section className="kpiGrid hoursKpiGrid">
        <article className="estimatedHoursCard"><span>Total estimado horas del mes</span><strong>{formatHours(estimatedTotal)}</strong><small>{selectedPeriod} · {formatHours(data?.summary?.personas)} personas · {businessDays} dias habiles</small></article>
        <article><span>Horas total</span><strong>{formatHours(data?.summary?.horas)}</strong><small>{formatPercent(coveragePercent)} del estimado</small></article>
        <article><span>Horas AT</span><strong>{formatHours(data?.summary?.horas_at)}</strong></article>
        <article><span>PGI</span><strong>{formatHours(data?.summary?.horas_pgi)}</strong></article>
        <article><span>Registros</span><strong>{formatHours(data?.summary?.registros)}</strong></article>
      </section>

      <section className="reportPanel">
        <div className="panelHeader">
          <div><h2>Distribucion por tipo de actividad</h2><p>{selectedPeriod}</p></div>
          <div className="panelActions">
            <div className="segmented">
              <button className={view === 'persona' ? 'active' : ''} onClick={() => setView('persona')}>Personas</button>
              <button className={view === 'equipo' ? 'active' : ''} onClick={() => setView('equipo')}>Proyectos</button>
            </div>
            <button className="secondaryButton" disabled={!canExport} onClick={handleExport}>Exportar Excel</button>
            <button className="primaryButton pgiLogButton" onClick={openPgiLog}>PGI Log</button>
          </div>
        </div>
        {loading ? <div className="emptyState">Cargando datos...</div> : <MatrixTable rows={rows} mode={view} expectedPerPerson={expectedPerPerson} />}
      </section>

      {pgiOpen && (
        <div className="modalBackdrop">
          <form className="pgiModal" onSubmit={savePgiLog}>
            <header><div><p className="eyebrow">Carga manual</p><h2>PGI Log</h2></div><button type="button" className="secondaryButton" onClick={() => setPgiOpen(false)}>Cerrar</button></header>
            {pgiError && <div className="errorBox compactError">{pgiError}</div>}
            <label>Proyecto<select value={pgiForm.projectId} disabled={pgiRefs.projects.length === 1} onChange={(event) => setPgiForm({ ...pgiForm, projectId: event.target.value })} required><option value="">Seleccionar proyecto</option>{pgiRefs.projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.proyecto || project.project_key_rpt}</option>)}</select></label>
            <label>Persona<select value={pgiForm.personId} onChange={(event) => setPgiForm({ ...pgiForm, personId: event.target.value })} required><option value="">Seleccionar persona</option>{pgiRefs.people.map((person) => <option key={person.person_id} value={person.person_id}>{person.persona}</option>)}</select></label>
            <label>Tipo de incidencia<select value={pgiForm.incidenceType} onChange={(event) => setPgiForm({ ...pgiForm, incidenceType: event.target.value })} required>{(pgiRefs.incidenceTypes.length ? pgiRefs.incidenceTypes : [{ key: 'pgi', label: 'PGI general' }, { key: 'day_off', label: 'Day off' }, { key: 'holiday', label: 'Vacaciones' }, { key: 'overtime', label: 'Horas extras' }]).map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
            <label>Fecha<input type="date" value={pgiForm.fecha} onChange={(event) => setPgiForm({ ...pgiForm, fecha: event.target.value })} required /></label>
            <label>Horas<input type="number" min="0.25" max="24" step="0.25" value={pgiForm.horas} onChange={(event) => setPgiForm({ ...pgiForm, horas: event.target.value })} required /></label>
            <label>Comentario<input type="text" placeholder="Opcional" value={pgiForm.comentario} onChange={(event) => setPgiForm({ ...pgiForm, comentario: event.target.value })} /></label>
            <footer><button type="submit" className="primaryButton" disabled={pgiSaving}>{pgiSaving ? 'Guardando...' : 'Guardar PGI'}</button></footer>
          </form>
        </div>
      )}

      <style jsx global>{`
        .hoursReportShell{padding-bottom:32px}
        .hoursReportShell>section{width:min(1560px,calc(100% - 48px))!important;max-width:none;margin-left:auto!important;margin-right:auto!important}
        .hoursReportShell .pageHeader{padding:30px 0 18px!important}
        .hoursReportShell .pageHeader h1{font-size:clamp(32px,3.2vw,46px)!important}
        .hoursReportShell .pageHeader p{max-width:980px}
        .hoursReportShell .hoursFiltersPanel{display:grid!important;grid-template-columns:minmax(110px,.45fr) minmax(180px,1fr) minmax(180px,1fr) minmax(150px,.8fr) minmax(180px,1fr) 116px!important;gap:12px!important;align-items:end!important;padding:16px!important}
        .hoursReportShell .hoursFiltersPanel label{min-width:0}
        .hoursReportShell .hoursFiltersPanel select,.hoursReportShell .hoursFiltersPanel input{min-width:0}
        .hoursReportShell .hoursKpiGrid{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:12px!important;margin:16px auto!important}
        .hoursReportShell .hoursKpiGrid article{min-width:0;padding:16px!important}
        .hoursReportShell .hoursKpiGrid article small{display:block;margin-top:6px;color:var(--muted);line-height:1.35}
        .hoursReportShell .hoursKpiGrid strong{font-size:clamp(24px,2vw,31px)!important}
        .estimatedHoursCard{border-color:#ffb074;background:#fff7f0}
        .hoursReportShell .panelHeader{padding:16px!important}
        .hoursReportShell .hoursTableWrap{overflow-x:auto}
        .hoursReportShell .hoursMatrixTable{width:100%;min-width:1180px!important;table-layout:fixed!important}
        .hoursReportShell .hoursMatrixTable th,.hoursReportShell .hoursMatrixTable td{padding:10px 8px!important;font-size:12px!important;line-height:1.25!important}
        .hoursReportShell .hoursMatrixTable th{letter-spacing:0!important;white-space:normal!important}
        .hoursReportShell .hoursMatrixTable th.number,.hoursReportShell .hoursMatrixTable td.number{width:62px!important}
        .hoursReportShell .hoursMatrixTable th:first-child{width:172px!important}
        .hoursReportShell .hoursMatrixTable th:nth-child(2){width:160px!important}
        .hoursReportShell .personGroupCell{width:172px!important;min-width:0!important;border-right:1px solid var(--line);background:#f9fbfe;vertical-align:top}
        .personGroupCell strong,.personGroupCell small,.complianceCell small{display:block}
        .personGroupCell small,.complianceCell small{margin-top:5px;color:var(--muted);font-size:11px;font-weight:700}
        .hoursReportShell .complianceCell{width:120px!important;min-width:0!important;vertical-align:top}
        .hoursCompliance{display:inline-flex;min-height:24px;align-items:center;padding:0 8px;border-radius:999px;font-size:11px;font-weight:900;white-space:nowrap}
        .hoursCompliance.ok{background:#eef9f0;color:#237a35}
        .hoursCompliance.warning{background:#fff4e8;color:#b85c00}
        .hoursCompliance.danger{background:#fff0f0;color:#b42318}
        .personStatus-ok .personGroupCell{border-left:4px solid var(--green)}
        .personStatus-warning .personGroupCell{border-left:4px solid var(--orange)}
        .personStatus-danger .personGroupCell{border-left:4px solid var(--red)}
        .pgiColumn{background:#fff8f1}
        .pgiLogButton{min-height:38px;padding:0 18px;box-shadow:0 8px 20px rgba(255,106,0,.18)}
        .modalBackdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:24px;background:rgba(8,17,31,.42)}
        .pgiModal{width:min(560px,100%);display:grid;gap:14px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:22px;box-shadow:0 24px 70px rgba(15,32,67,.24)}
        .pgiModal header,.pgiModal footer{display:flex;align-items:center;justify-content:space-between;gap:12px}
        .pgiModal h2{margin:0}
        .pgiModal label{display:grid;gap:7px;color:var(--muted);font-size:13px;font-weight:800}
        .pgiModal input,.pgiModal select{width:100%;min-height:42px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 10px}
        .compactError{width:100%;margin:0;padding:12px}
        @media (max-width:1280px){.hoursReportShell .hoursFiltersPanel{grid-template-columns:repeat(2,minmax(0,1fr)) 116px!important}.hoursReportShell .hoursKpiGrid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
        @media (max-width:900px){.hoursReportShell>section{width:calc(100% - 24px)!important}.hoursReportShell .hoursFiltersPanel,.hoursReportShell .hoursKpiGrid{grid-template-columns:1fr!important}.hoursReportShell .hoursMatrixTable{min-width:1080px!important}.pgiModal header,.pgiModal footer{align-items:flex-start;flex-direction:column}}
      `}</style>
    </main>
  );
}
