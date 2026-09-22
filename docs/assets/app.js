const periodLabels = document.querySelectorAll('[data-period-label]');
const fromInput = document.querySelector('#fechaDesde');
const toInput = document.querySelector('#fechaHasta');
const applyButton = document.querySelector('[data-apply-period]');

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
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

setDefaultPeriod();
updatePeriodLabels();

if (applyButton) {
  applyButton.addEventListener('click', updatePeriodLabels);
}
