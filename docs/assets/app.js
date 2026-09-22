const periodLabels = document.querySelectorAll('[data-period-label]');
const fromInput = document.querySelector('#fechaDesde');
const toInput = document.querySelector('#fechaHasta');
const applyButton = document.querySelector('[data-apply-period]');
const teamFilter = document.querySelector('[data-team-filter]');
const sourceStatus = document.querySelector('[data-source-status]');
const personHead = document.querySelector('[data-person-table-head]');
const personBody = document.querySelector('[data-person-table-body]');
const teamHead = document.querySelector('[data-team-table-head]');
const teamBody = document.querySelector('[data-team-table-body]');
const viewButtons = document.querySelectorAll('[data-view-button]');
const reportViews = document.querySelectorAll('[data-report-view]');
const kpiNodes = {
  horasAt: document.querySelector('[data-kpi="horasAt"]'),
  personas: document.querySelector('[data-kpi="personas"]'),
  equipos: document.querySelector('[data-kpi="equipos"]'),
  tipoPrincipal: document.querySelector('[data-kpi="tipoPrincipal"]'),
};

let hoursRows = [];

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function formatHours(value) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value || 0);
}

function normalizeEventType(value) {
  return String(value || 'Sin tipo').trim() || 'Sin tipo';
}

function eventTypeLabel(value) {
  return normalizeEventType(value).replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function updatePeriodLabels() {
  if (!fromInput || !toInput || !periodLabels.length) return;
  const from = formatDate(fromInput.value);
  const to = formatDate(toInput.value);
  const label = from && to ? `${from} - ${to}` : 'Periodo sin definir';
  periodLabels.forEach((node) => {
    node.textContent = label;
  });
}

function setDefaultPeriod() {
  if (!fromInput || !toInput) return;
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const pad = (n) => String(n).padStart(2, '0');
  fromInput.value = fromInput.value || `${firstDay.getFullYear()}-${pad(firstDay.getMonth() + 1)}-${pad(firstDay.getDate())}`;
  toInput.value = toInput.value || `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function getRowDate(row) {
  return row.fecha || row.date || row.planned_start || '';
}

function getRowHours(row) {
  return Number(row.horas_at ?? row.horas_evento ?? row.horas_estimadas_at ?? row.horas_usadas_at ?? row.horas ?? 0);
}

function getFilteredRows() {
  if (!fromInput || !toInput) return hoursRows;
  const from = fromInput.value || '0000-01-01';
  const to = toInput.value || '9999-12-31';
  const selectedTeam = teamFilter ? teamFilter.value : '';
  return hoursRows.filter((row) => {
    const date = getRowDate(row);
    const team = row.equipo || row.team_name || 'Sin equipo';
    return date >= from && date <= to && (!selectedTeam || team === selectedTeam);
  });
}

function getEventTypes(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    const type = normalizeEventType(row.event_type);
    totals.set(type, (totals.get(type) || 0) + getRowHours(row));
  });
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type]) => type);
}

function buildMatrix(rows, keyFields) {
  const matrix = new Map();
  rows.forEach((row) => {
    const key = keyFields.map((field) => row[field] || '').join('||');
    const current = matrix.get(key) || {
      key,
      total: 0,
      eventos: 0,
      byType: {},
    };
    keyFields.forEach((field) => {
      current[field] = row[field] || (field === 'equipo' ? 'Sin equipo' : 'Sin dato');
    });
    const type = normalizeEventType(row.event_type);
    const hours = getRowHours(row);
    current.byType[type] = (current.byType[type] || 0) + hours;
    current.total += hours;
    current.eventos += Number(row.eventos || 1);
    matrix.set(key, current);
  });
  return [...matrix.values()].sort((a, b) => b.total - a.total);
}

function renderHead(headNode, fixedColumns, eventTypes) {
  if (!headNode) return;
  const eventHeaders = eventTypes.map((type) => `<th class="text-end">${eventTypeLabel(type)}</th>`).join('');
  headNode.innerHTML = `
    <tr>
      ${fixedColumns.map((column) => `<th>${column}</th>`).join('')}
      ${eventHeaders}
      <th class="text-end">Total</th>
      <th class="text-end">Eventos</th>
    </tr>
  `;
}

function renderBody(bodyNode, rows, eventTypes, fixedCells, emptyMessage) {
  if (!bodyNode) return;
  const colspan = fixedCells.length + eventTypes.length + 2;
  if (!rows.length) {
    bodyNode.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-secondary py-5">${emptyMessage}</td></tr>`;
    return;
  }
  bodyNode.innerHTML = rows.map((row) => {
    const eventCells = eventTypes.map((type) => `<td class="text-end">${formatHours(row.byType[type] || 0)}</td>`).join('');
    return `
      <tr>
        ${fixedCells.map((cell) => cell(row)).join('')}
        ${eventCells}
        <td class="text-end fw-bold">${formatHours(row.total)}</td>
        <td class="text-end">${formatHours(row.eventos)}</td>
      </tr>
    `;
  }).join('');
}

function renderKpis(rows, eventTypes) {
  const totalHours = rows.reduce((sum, row) => sum + getRowHours(row), 0);
  const people = new Set(rows.map((row) => row.persona || row.nombre_persona || row.username).filter(Boolean));
  const teams = new Set(rows.map((row) => row.equipo || row.team_name).filter(Boolean));
  const typeTotals = eventTypes.map((type) => ({
    type,
    hours: rows.reduce((sum, row) => sum + (normalizeEventType(row.event_type) === type ? getRowHours(row) : 0), 0),
  }));
  const mainType = typeTotals.sort((a, b) => b.hours - a.hours)[0];

  if (kpiNodes.horasAt) kpiNodes.horasAt.textContent = formatHours(totalHours);
  if (kpiNodes.personas) kpiNodes.personas.textContent = formatHours(people.size);
  if (kpiNodes.equipos) kpiNodes.equipos.textContent = formatHours(teams.size);
  if (kpiNodes.tipoPrincipal) kpiNodes.tipoPrincipal.textContent = mainType ? eventTypeLabel(mainType.type) : '--';
}

function renderTeamFilter() {
  if (!teamFilter) return;
  const currentValue = teamFilter.value;
  const teams = [...new Set(hoursRows.map((row) => row.equipo || row.team_name || 'Sin equipo'))].sort((a, b) => a.localeCompare(b));
  teamFilter.innerHTML = '<option value="">Todos los equipos</option>' + teams.map((team) => `<option value="${team}">${team}</option>`).join('');
  teamFilter.value = teams.includes(currentValue) ? currentValue : '';
}

function renderReport() {
  updatePeriodLabels();
  const rows = getFilteredRows().map((row) => ({
    ...row,
    persona: row.persona || row.nombre_persona || row.username || 'Sin persona',
    equipo: row.equipo || row.team_name || 'Sin equipo',
  }));
  const eventTypes = getEventTypes(rows);
  const personRows = buildMatrix(rows, ['persona', 'equipo']);
  const teamRows = buildMatrix(rows, ['equipo']);

  renderKpis(rows, eventTypes);
  renderHead(personHead, ['Persona', 'Equipo'], eventTypes);
  renderBody(personBody, personRows, eventTypes, [
    (row) => `<td class="fw-bold">${row.persona}</td>`,
    (row) => `<td>${row.equipo}</td>`,
  ], 'No hay datos por persona para el periodo seleccionado.');

  renderHead(teamHead, ['Equipo'], eventTypes);
  renderBody(teamBody, teamRows, eventTypes, [
    (row) => `<td class="fw-bold">${row.equipo}</td>`,
  ], 'No hay datos por equipo para el periodo seleccionado.');
}

function setActiveView(viewName) {
  viewButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.viewButton === viewName);
  });
  reportViews.forEach((view) => {
    view.classList.toggle('active', view.dataset.reportView === viewName);
  });
}

async function loadHoursData() {
  if (!personBody && !teamBody) return;
  try {
    const response = await fetch('data/horas-equipos.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('No data file');
    const data = await response.json();
    hoursRows = Array.isArray(data.rows) ? data.rows : [];
    if (sourceStatus) sourceStatus.textContent = hoursRows.length ? 'Datos cargados' : 'Sin registros';
  } catch {
    hoursRows = [];
    if (sourceStatus) sourceStatus.textContent = 'Esperando datos';
  }
  renderTeamFilter();
  renderReport();
}

setDefaultPeriod();
renderReport();

if (applyButton) {
  applyButton.addEventListener('click', renderReport);
}

if (teamFilter) {
  teamFilter.addEventListener('change', renderReport);
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => setActiveView(button.dataset.viewButton));
});

loadHoursData();