'use client';

import Link from 'next/link';
import { CalendarDays, Download, Filter, HeartPulse, Plane, Rows3, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageSection, ModernMonthPicker, ModernSelect } from '@/components/ui';

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
  return { from: filters.from, to: filters.to, projectId: filters.projectId, eventType: filters.eventType };
}

function formatHours(value) {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0))} hs`;
}

function formatDays(value) {
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value || 0))} dias`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function fileDate(value) {
  return String(value || '').replace(/[^0-9-]/g, '');
}

function tableHtml(headers, rows, numericFrom = 0) {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td${index >= numericFrom ? ' class="number"' : ''}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function downloadExcel({ data, filters, viewMode, rows, filterLabels }) {
  const period = monthTitle(filters.month);
  const filterRows = [
    ['Mes', period],
    ['Desde', filters.from || ''],
    ['Hasta', filters.to || ''],
    ['Equipo', filterLabels.project || 'Todos'],
    ['Tipo', filterLabels.eventType || 'Todos'],
    ['Vista agrupada', viewMode === 'personas' ? 'Personas' : 'Equipos'],
  ];

  const summaryRows = [
    ['Dias de novedades', Number(data?.summary?.dias || 0).toFixed(2)],
    ['Dias habiles del periodo', Number(data?.summary?.dias_habiles_periodo || 0).toFixed(2)],
    ['Horas registradas', Number(data?.summary?.horas || 0).toFixed(2)],
    ['Novedades', data?.summary?.registros || 0],
    ['Personas', data?.summary?.personas || 0],
    ['Equipos', data?.summary?.equipos || 0],
  ];

  const typeRows = (data?.byType || []).map((item) => [item.event_label || item.event_type, Number(item.dias || 0).toFixed(2), Number(item.horas || 0).toFixed(2), item.registros || 0]);
  const groupedRows = rows.map((item) => viewMode === 'personas'
    ? [item.persona, item.equipo, Number(item.day_off_dias || 0).toFixed(2), Number(item.holiday_dias || 0).toFixed(2), Number(item.sick_leave_dias || 0).toFixed(2), Number(item.vacation_dias || 0).toFixed(2), Number(item.dias || 0).toFixed(2), Number(item.horas || 0).toFixed(2), item.registros || 0]
    : [item.equipo, Number(item.day_off_dias || 0).toFixed(2), Number(item.holiday_dias || 0).toFixed(2), Number(item.sick_leave_dias || 0).toFixed(2), Number(item.vacation_dias || 0).toFixed(2), Number(item.dias || 0).toFixed(2), Number(item.horas || 0).toFixed(2), item.registros || 0]
  );
  const detailRows = (data?.detail || []).map((row) => [row.fecha, row.fecha_fin || row.fecha, row.persona, row.equipo, row.event_label || row.event_type, Number(row.dias || 0).toFixed(2), Number(row.horas || 0).toFixed(2), row.registros || 0]);
  const groupedHeaders = viewMode === 'personas' ? ['Persona', 'Equipo', 'Day off dias', 'Holiday dias', 'Sick leave dias', 'Vacation dias', 'Total dias', 'Total horas', 'Novedades'] : ['Equipo', 'Day off dias', 'Holiday dias', 'Sick leave dias', 'Vacation dias', 'Total dias', 'Total horas', 'Novedades'];

  const html = `<html><head><meta charset="UTF-8" /><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;margin-bottom:18px}th{background:#ff6a00;color:#fff;font-weight:bold}th,td{border:1px solid #d9e2ef;padding:8px}td.number{mso-number-format:"0.00";text-align:right}h1,h2{color:#0f2043}</style></head><body><h1>Reporte de novedades laborales</h1><h2>Filtros</h2>${tableHtml(['Filtro','Valor'], filterRows, 2)}<h2>Resumen</h2>${tableHtml(['Indicador','Valor'], summaryRows, 1)}<h2>Distribucion por tipo</h2>${tableHtml(['Tipo','Dias','Horas','Novedades'], typeRows, 1)}<h2>${viewMode === 'personas' ? 'Agrupado por persona' : 'Agrupado por equipo'}</h2>${tableHtml(groupedHeaders, groupedRows, viewMode === 'personas' ? 2 : 1)}<h2>Detalle</h2>${tableHtml(['Desde','Hasta','Persona','Equipo','Tipo','Dias','Horas','Novedades'], detailRows, 5)}</body></html>`;

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
  const initial = currentMonthRange();
  const [filters, setFilters] = useState({ month: initial.month, from: initial.from, to: initial.to, projectId: '', eventType: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('personas');

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams(Object.entries(reportFilters(nextFilters)).filter(([, value]) => value));
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

  useEffect(() => { loadData(); }, []);

  const modelPending = data && data.modelReady === false;
  const maxTypeHours = useMemo(() => Math.max(...(data?.byType || []).map((item) => Number(item.dias || 0)), 0), [data]);
  const rows = viewMode === 'personas' ? data?.byPerson || [] : data?.byTeam || [];
  const maxRowHours = useMemo(() => Math.max(...rows.map((item) => Number(item.dias || 0)), 0), [rows]);
  const selectedProject = (data?.filtersData?.projects || []).find((project) => String(project.project_id) === String(filters.projectId));
  const selectedEventType = (data?.filtersData?.eventTypes || []).find((type) => String(type.event_type) === String(filters.eventType));
  const canExport = !loading && !error && Boolean(data) && ((data?.detail || []).length > 0 || rows.length > 0);
  const hasReportRows = Boolean(data) && ((data?.detail || []).length > 0 || (data?.byType || []).length > 0 || rows.length > 0);

  function handleMonthChange(value) {
    setFilters({ ...filters, ...monthRange(value) });
  }

  function handleExport() {
    downloadExcel({ data, filters, viewMode, rows, filterLabels: { project: selectedProject?.equipo || '', eventType: selectedEventType?.label || '' } });
  }

  return (
    <main className="shell laborShell modernReportPage modernLaborPage">
      <nav className="topbar"><Link className="brand" href="/"><img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" /><span><strong>Inthegra Reports</strong><small>Novedades laborales</small></span></Link><Link className="navLink" href="/">Inicio</Link></nav>
      <PageSection className="modernReportHero laborHeader">
        <div className="modernReportHeroText">
          <span className="modernHeroIcon"><Plane size={20} /></span>
          <div><p className="eyebrow">ActivityTimeline</p><h1>Reporte de novedades laborales</h1><p>Seguimiento de day off, holiday, sick leave y vacation por persona y por equipo dentro del mes seleccionado.</p></div>
        </div>
        <span className={error || modelPending ? 'status error' : 'status'}>{loading ? 'Consultando Turso' : error ? 'Error de datos' : modelPending ? 'Modelo pendiente' : 'Datos actualizados'}</span>
      </PageSection>
      <PageSection className="filtersPanel modernFilterPanel laborFilterPanel">
        <label>Mes<ModernMonthPicker value={filters.month} onChange={handleMonthChange} /></label>
        <label>Equipo<ModernSelect value={filters.projectId} onChange={(value) => setFilters({ ...filters, projectId: value })} placeholder="Todos los equipos" options={[{ value: '', label: 'Todos los equipos' }, ...(data?.filtersData?.projects || []).map((project) => ({ value: String(project.project_id), label: project.equipo }))]} /></label>
        <label>Tipo<ModernSelect value={filters.eventType} onChange={(value) => setFilters({ ...filters, eventType: value })} placeholder="Todos los tipos" options={[{ value: '', label: 'Todos los tipos' }, ...(data?.filtersData?.eventTypes || []).map((type) => ({ value: type.event_type, label: type.label }))]} /></label>
        <button className="primaryButton compact reportIconButton" onClick={() => loadData(filters)}><Filter size={16} />Aplicar</button>
        <button className="secondaryButton reportIconButton" disabled={!canExport} onClick={handleExport}><Download size={16} />Exportar Excel</button>
      </PageSection>
      {error && <div className="errorBox">{error}</div>}{modelPending && <div className="errorBox">{data.setupMessage}</div>}{data?.demo && <div className="warningBox">Vista previa con datos de referencia. Los valores reales se activan cuando exista la vista SQL.</div>}
      {!loading && !error && !modelPending && !hasReportRows && <section className="laborPlaceholder"><strong>Sin novedades para mostrar</strong><span>No encontramos day off, holiday, sick leave o vacation para {monthTitle(filters.month)} con los filtros aplicados.</span></section>}
      <PageSection className="laborOverview modernKpiGrid"><article><span><CalendarDays size={16} />Dias de novedades</span><strong>{formatDays(data?.summary?.dias)}</strong></article><article><span><CalendarDays size={16} />Dias habiles periodo</span><strong>{formatDays(data?.summary?.dias_habiles_periodo)}</strong></article><article><span><HeartPulse size={16} />Horas equivalentes</span><strong>{formatHours(data?.summary?.horas)}</strong></article><article><span><Users size={16} />Personas</span><strong>{data?.summary?.personas || 0}</strong></article><article><span><Rows3 size={16} />Equipos</span><strong>{data?.summary?.equipos || 0}</strong></article></PageSection>
      <PageSection className="laborCharts modernChartGrid">
        <article className="laborPanel modernDataPanel"><div className="panelHeader"><div><h2><Plane size={18} />Distribucion por tipo</h2><p>{monthTitle(filters.month)}</p></div></div><div className="laborTypeList">{(data?.byType || []).map((item) => <div className="laborTypeRow" key={item.event_type}><TypeBadge type={item.event_type} label={item.event_label} /><MiniBar value={item.dias} max={maxTypeHours} /><strong>{formatDays(item.dias)} · {formatHours(item.horas)}</strong></div>)}{!loading && !(data?.byType || []).length && <div className="emptyState">Sin novedades para el mes.</div>}</div></article>
        <article className="laborPanel modernDataPanel"><div className="panelHeader"><div><h2><Users size={18} />{viewMode === 'personas' ? 'Por persona' : 'Por equipo'}</h2><p>Agrupado por dias laborales</p></div><div className="segmented"><button className={viewMode === 'personas' ? 'active' : ''} onClick={() => setViewMode('personas')}>Personas</button><button className={viewMode === 'equipos' ? 'active' : ''} onClick={() => setViewMode('equipos')}>Equipos</button></div></div><div className="laborRankList">{rows.map((item) => <div className="laborRankRow" key={`${viewMode}-${item.person_id || item.project_id}-${item.equipo}`}><div><strong>{viewMode === 'personas' ? item.persona : item.equipo}</strong><small>{viewMode === 'personas' ? item.equipo : `${item.registros} novedades`}</small></div><MiniBar value={item.dias} max={maxRowHours} /><span>{formatDays(item.dias)} · {formatHours(item.horas)}</span></div>)}{!loading && !rows.length && <div className="emptyState">Sin datos agrupados para mostrar.</div>}</div></article>
      </PageSection>
      <PageSection className="laborPanel laborDetailPanel modernDataPanel"><div className="panelHeader"><div><h2><Rows3 size={18} />Detalle de novedades</h2><p>Registros de {monthTitle(filters.month)}</p></div></div>{loading ? <div className="emptyState">Cargando novedades laborales...</div> : <div className="tableWrap modernTableWrap"><table className="laborTable"><thead><tr><th>Desde</th><th>Hasta</th><th>Persona</th><th>Equipo</th><th>Tipo</th><th className="number">Dias</th><th className="number">Horas</th></tr></thead><tbody>{(data?.detail || []).map((row, index) => <tr key={`${row.fecha}-${row.person_id}-${row.project_id}-${row.event_type}-${index}`}><td>{row.fecha}</td><td>{row.fecha_fin || row.fecha}</td><td>{row.persona}</td><td>{row.equipo}</td><td><TypeBadge type={row.event_type} label={row.event_label} /></td><td className="number"><strong>{formatDays(row.dias)}</strong></td><td className="number"><strong>{formatHours(row.horas)}</strong></td></tr>)}</tbody></table>{!loading && !(data?.detail || []).length && <div className="emptyState">Sin detalle para el mes seleccionado.</div>}</div>}</PageSection>
    </main>
  );
}
