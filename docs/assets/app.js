const periodLabels = document.querySelectorAll('[data-period-label]');
const fromInput = document.querySelector('#fechaDesde');
const toInput = document.querySelector('#fechaHasta');
const applyButton = document.querySelector('[data-apply-period]');
const tableBody = document.querySelector('[data-hours-table]');
const sourceStatus = document.querySelector('[data-source-status]');
const kpiNodes = {
  horasReales: document.querySelector('[data-kpi="horasReales"]'),
  capacidad: document.querySelector('[data-kpi="capacidad"]'),
  utilizacion: document.querySelector('[data-kpi="utilizacion"]'),
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

function formatPercent(value) {
  if (!Number.isFinite(value)) return '--';
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value)}%`;
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

function getFilteredRows() {
  if (!fromInput || !toInput) return hoursRows;
  const from = fromInput.value || '0000-01-01';
  const to = toInput.value || '9999-12-31';
  return hoursRows.filter((row) => row.fecha >= from && row.fecha <= to);
}

function summarizeRows(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const key = row.equipo || 'Sin equipo';
    const current = byTeam.get(key) || {
      equipo: key,
      personas: new Set(),
      horasReales: 0,
      capacidad: 0,
    };
    if (row.persona) current.personas.add(row.persona);
    current.horasReales += Number(row.horas_reales || 0);
    current.capacidad += Number(row.horas_capacidad || 0);
    byTeam.set(key, current);
  }
  return [...byTeam.values()].map((row) => ({
    ...row,
    personas: row.personas.size,
    utilizacion: row.capacidad > 0 ? (row.horasReales / row.capacidad) * 100 : null,
  })).sort((a, b) => b.horasReales - a.horasReales);
}

function renderKpis(teamRows) {
  const totals = teamRows.reduce((acc, row) => {
    acc.horasReales += row.horasReales;
    acc.capacidad += row.capacidad;
    return acc;
  }, { horasReales: 0, capacidad: 0 });
  const utilizacion = totals.capacidad > 0 ? (totals.horasReales / totals.capacidad) * 100 : NaN;
  if (kpiNodes.horasReales) kpiNodes.horasReales.textContent = formatHours(totals.horasReales);
  if (kpiNodes.capacidad) kpiNodes.capacidad.textContent = formatHours(totals.capacidad);
  if (kpiNodes.utilizacion) kpiNodes.utilizacion.textContent = formatPercent(utilizacion);
}

function renderTable(teamRows) {
  if (!tableBody) return;
  if (!teamRows.length) {
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-secondary py-5">No hay datos para el periodo seleccionado.</td></tr>';
    return;
  }
  tableBody.innerHTML = teamRows.map((row) => `
    <tr>
      <td class="fw-bold">${row.equipo}</td>
      <td>${row.personas}</td>
      <td>${formatHours(row.horasReales)}</td>
      <td>${formatHours(row.capacidad)}</td>
      <td>${formatPercent(row.utilizacion)}</td>
    </tr>
  `).join('');
}

function renderReport() {
  updatePeriodLabels();
  const teamRows = summarizeRows(getFilteredRows());
  renderKpis(teamRows);
  renderTable(teamRows);
}

async function loadHoursData() {
  if (!tableBody) return;
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
  renderReport();
}

setDefaultPeriod();
renderReport();

if (applyButton) {
  applyButton.addEventListener('click', renderReport);
}

loadHoursData();