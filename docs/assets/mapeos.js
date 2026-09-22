const STORAGE_KEY = 'inthegra-reportes-mapeos';

const state = {
  data: null,
  projectMappings: [],
  personMappings: [],
};

const nodes = {
  jiraProject: document.querySelector('#jiraProject'),
  atTeam: document.querySelector('#atTeam'),
  projectCriterion: document.querySelector('#projectCriterion'),
  projectMappings: document.querySelector('[data-project-mappings]'),
  jiraPerson: document.querySelector('#jiraPerson'),
  atPerson: document.querySelector('#atPerson'),
  personCriterion: document.querySelector('#personCriterion'),
  personMappings: document.querySelector('[data-person-mappings]'),
  exportButton: document.querySelector('[data-export-mappings]'),
  status: document.querySelector('[data-mapping-status]'),
};

function optionLabel(item, keyField) {
  const key = item[keyField];
  const name = item.nombre || item.nombre_completo || item.full_name || item.email || key;
  return `${key} - ${name}`;
}

function fillSelect(select, items, valueField, labelField) {
  if (!select) return;
  select.innerHTML = '<option value="">Seleccionar</option>';
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item[valueField];
    option.textContent = labelField ? item[labelField] : optionLabel(item, valueField);
    select.appendChild(option);
  });
}

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.projectMappings = Array.isArray(saved.project_team_mappings) ? saved.project_team_mappings : [];
    state.personMappings = Array.isArray(saved.person_mappings) ? saved.person_mappings : [];
  } catch {
    state.projectMappings = [];
    state.personMappings = [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPayload(), null, 2));
  if (nodes.status) nodes.status.textContent = 'Cambios guardados en este navegador';
}

function buildPayload() {
  return {
    generated_at: new Date().toISOString(),
    project_team_mappings: state.projectMappings,
    person_mappings: state.personMappings,
  };
}

function findProject(key) {
  return state.data.jira_projects.find((item) => item.project_key === key);
}

function findTeam(id) {
  return state.data.at_teams.find((item) => item.team_id === id);
}

function findJiraPerson(id) {
  return state.data.jira_people.find((item) => item.account_id === id || item.username === id) || { nombre: id };
}

function findAtPerson(username) {
  return state.data.at_people.find((item) => item.username === username) || { full_name: username };
}

function renderProjectMappings() {
  if (!nodes.projectMappings) return;
  if (!state.projectMappings.length) {
    nodes.projectMappings.innerHTML = '<tr><td colspan="4" class="text-center text-secondary py-4">Todavia no hay relaciones cargadas.</td></tr>';
    return;
  }
  nodes.projectMappings.innerHTML = state.projectMappings.map((mapping, index) => {
    const project = findProject(mapping.project_key);
    const team = findTeam(mapping.team_id);
    return `
      <tr>
        <td><strong>${mapping.project_key}</strong><span class="d-block text-secondary small">${project?.nombre || ''}</span></td>
        <td><strong>${mapping.team_id}</strong><span class="d-block text-secondary small">${team?.nombre || ''}</span></td>
        <td>${mapping.criterio_match}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-danger" type="button" data-remove-project="${index}">Quitar</button></td>
      </tr>
    `;
  }).join('');
}

function renderPersonMappings() {
  if (!nodes.personMappings) return;
  if (!state.personMappings.length) {
    nodes.personMappings.innerHTML = '<tr><td colspan="4" class="text-center text-secondary py-4">Todavia no hay relaciones cargadas.</td></tr>';
    return;
  }
  nodes.personMappings.innerHTML = state.personMappings.map((mapping, index) => {
    const jira = findJiraPerson(mapping.jira_account_id);
    const at = findAtPerson(mapping.at_username);
    return `
      <tr>
        <td><strong>${mapping.jira_account_id}</strong><span class="d-block text-secondary small">${jira.nombre || jira.nombre_completo || ''}</span></td>
        <td><strong>${mapping.at_username}</strong><span class="d-block text-secondary small">${at.full_name || at.nombre || ''}</span></td>
        <td>${mapping.criterio_match}</td>
        <td class="text-end"><button class="btn btn-sm btn-outline-danger" type="button" data-remove-person="${index}">Quitar</button></td>
      </tr>
    `;
  }).join('');
}

function addProjectMapping() {
  const projectKey = nodes.jiraProject?.value;
  const teamId = nodes.atTeam?.value;
  if (!projectKey || !teamId) return;
  state.projectMappings = state.projectMappings.filter((item) => item.project_key !== projectKey && item.team_id !== teamId);
  state.projectMappings.push({
    project_key: projectKey,
    team_id: teamId,
    criterio_match: nodes.projectCriterion?.value || 'manual',
    activo: true,
  });
  persist();
  renderProjectMappings();
}

function addPersonMapping() {
  const jiraAccountId = nodes.jiraPerson?.value;
  const atUsername = nodes.atPerson?.value;
  if (!jiraAccountId || !atUsername) return;
  state.personMappings = state.personMappings.filter((item) => item.jira_account_id !== jiraAccountId && item.at_username !== atUsername);
  state.personMappings.push({
    jira_account_id: jiraAccountId,
    at_username: atUsername,
    criterio_match: nodes.personCriterion?.value || 'manual',
    activo: true,
  });
  persist();
  renderPersonMappings();
}

function exportMappings() {
  const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mapeos-inthegra.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const response = await fetch('data/mapeos-base.json', { cache: 'no-store' });
  state.data = await response.json();
  loadSaved();

  fillSelect(nodes.jiraProject, state.data.jira_projects, 'project_key');
  fillSelect(nodes.atTeam, state.data.at_teams, 'team_id');
  fillSelect(nodes.jiraPerson, state.data.jira_people, 'account_id');
  fillSelect(nodes.atPerson, state.data.at_people, 'username');

  renderProjectMappings();
  renderPersonMappings();

  document.querySelector('[data-add-project]')?.addEventListener('click', addProjectMapping);
  document.querySelector('[data-add-person]')?.addEventListener('click', addPersonMapping);
  nodes.exportButton?.addEventListener('click', exportMappings);

  document.addEventListener('click', (event) => {
    const projectIndex = event.target.dataset.removeProject;
    const personIndex = event.target.dataset.removePerson;
    if (projectIndex !== undefined) {
      state.projectMappings.splice(Number(projectIndex), 1);
      persist();
      renderProjectMappings();
    }
    if (personIndex !== undefined) {
      state.personMappings.splice(Number(personIndex), 1);
      persist();
      renderPersonMappings();
    }
  });
}

init().catch(() => {
  if (nodes.status) nodes.status.textContent = 'No se pudieron cargar los datos base';
});
