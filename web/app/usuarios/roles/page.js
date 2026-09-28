'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

const EMPTY_FORM = { roleKey: '', label: '', enabled: true, permissions: [] };

function normalizeRoleKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export default function RolesPage() {
  const [data, setData] = useState({ roles: [], reports: [], permissions: [] });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingRole, setEditingRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/roles', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar roles');
      setData({ roles: payload.roles || [], reports: payload.reports || [], permissions: payload.permissions || [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const permissionMap = useMemo(() => {
    const map = new Map();
    data.permissions.forEach((permission) => {
      if (Number(permission.can_view) !== 1) return;
      if (!map.has(permission.role_key)) map.set(permission.role_key, []);
      map.get(permission.role_key).push(permission.report_key);
    });
    return map;
  }, [data.permissions]);

  const reportLabelMap = useMemo(() => new Map(data.reports.map((report) => [report.key, report.label])), [data.reports]);
  const isAdminRole = form.roleKey === 'admin' || data.roles.some((role) => role.role_key === form.roleKey && Number(role.is_admin) === 1);

  function togglePermission(key) {
    const exists = form.permissions.includes(key);
    setForm({ ...form, permissions: exists ? form.permissions.filter((item) => item !== key) : [...form.permissions, key] });
  }

  function editRole(role) {
    setEditingRole(role.role_key);
    setForm({
      roleKey: role.role_key,
      label: role.label,
      enabled: Number(role.enabled) === 1,
      permissions: permissionMap.get(role.role_key) || [],
    });
    setMessage('');
    setError('');
  }

  function cancelEdit() {
    setEditingRole(null);
    setForm(EMPTY_FORM);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const roleKey = editingRole || normalizeRoleKey(form.roleKey || form.label);
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, roleKey, permissions: isAdminRole ? data.reports.map((report) => report.key) : form.permissions }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar rol');
      setForm(EMPTY_FORM);
      setEditingRole(null);
      setMessage('Rol guardado correctamente.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRole(role) {
    if (role.role_key === 'admin') return;
    const ok = window.confirm(`Eliminar el rol ${role.label}?`);
    if (!ok) return;
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/roles?roleKey=${encodeURIComponent(role.role_key)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo eliminar rol');
      if (editingRole === role.role_key) cancelEdit();
      setMessage('Rol eliminado correctamente.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="shell reportShell rolesPageShell">
      <section className="pageHeader rolesHeader">
        <div>
          <p className="eyebrow">Administracion</p>
          <h1>Roles</h1>
          <p>Cada rol define los reportes disponibles para los usuarios asignados.</p>
        </div>
        <div className="headerActions">
          <Link className="secondaryButton" href="/usuarios">Volver a usuarios</Link>
        </div>
      </section>

      {error && <div className="errorBox rolesNotice">{error}</div>}
      {message && <div className="successBox rolesNotice">{message}</div>}

      <section className="roleEditorBand">
        <form className="roleForm" onSubmit={save}>
          <div className="formTitleBlock">
            <h2>{editingRole ? 'Editar rol' : 'Nuevo rol'}</h2>
            {editingRole && <button className="ghostButton" type="button" onClick={cancelEdit}>Cancelar</button>}
          </div>
          <label>
            Codigo del rol
            <input
              value={form.roleKey}
              onChange={(event) => setForm({ ...form, roleKey: normalizeRoleKey(event.target.value) })}
              disabled={Boolean(editingRole)}
              placeholder="lider_operativo"
              required
            />
          </label>
          <label>
            Nombre visible
            <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Lider operativo" required />
          </label>
          <label className="checkRow roleActiveToggle">
            <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} disabled={form.roleKey === 'admin'} />
            Activo
          </label>
          <button className="primaryButton" disabled={saving}>{saving ? 'Guardando...' : 'Guardar rol'}</button>
          <div className="reportPermissionBox">
            <strong>Reportes habilitados</strong>
            <div className="reportChecks">
              {data.reports.map((report) => (
                <label className="checkRow" key={report.key}>
                  <input
                    type="checkbox"
                    checked={isAdminRole || form.permissions.includes(report.key)}
                    disabled={isAdminRole}
                    onChange={() => togglePermission(report.key)}
                  />
                  {report.label}
                </label>
              ))}
            </div>
            {isAdminRole && <p>El rol administrador siempre tiene acceso total.</p>}
          </div>
        </form>
      </section>

      <section className="rolesFullPanel">
        <div className="panelHeaderLine">
          <div>
            <h2>Roles configurados</h2>
            <p>{data.roles.length} roles disponibles</p>
          </div>
          <button className="secondaryButton" type="button" onClick={load}>Actualizar</button>
        </div>
        {loading ? (
          <div className="emptyState">Cargando roles...</div>
        ) : (
          <div className="rolesTableWrap">
            <table className="rolesTable">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Reportes</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.roles.map((role) => {
                  const reports = Number(role.is_admin) === 1
                    ? 'Todos los reportes'
                    : (permissionMap.get(role.role_key) || []).map((key) => reportLabelMap.get(key) || key).join(', ') || 'Sin reportes';
                  return (
                    <tr key={role.role_key}>
                      <td><strong>{role.role_key}</strong></td>
                      <td>{role.label}</td>
                      <td>{Number(role.is_admin) === 1 ? 'Administrador' : 'Operativo'}</td>
                      <td><span className={Number(role.enabled) === 1 ? 'statusPill ok' : 'statusPill off'}>{Number(role.enabled) === 1 ? 'Activo' : 'Inactivo'}</span></td>
                      <td>{reports}</td>
                      <td className="rowActions">
                        <button className="secondaryButton compact" type="button" onClick={() => editRole(role)}>Editar</button>
                        <button className="dangerButton compact" type="button" disabled={role.role_key === 'admin'} onClick={() => removeRole(role)}>Eliminar</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <style jsx global>{`
        .rolesPageShell{min-height:100vh;padding-bottom:34px}.rolesHeader{align-items:flex-end}.rolesNotice{margin:0 32px 14px}.successBox{border:1px solid #9bd6a4;background:#f0fff3;color:#146a25;border-radius:8px;padding:12px 14px;font-weight:800}.roleEditorBand{padding:0 32px 18px}.roleForm{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(180px,.8fr) minmax(220px,1fr) auto auto;gap:14px;align-items:end;border:1px solid var(--line);border-radius:8px;background:#fff;padding:18px;box-shadow:0 14px 34px rgba(15,32,67,.07)}.formTitleBlock{align-self:center}.formTitleBlock h2,.rolesFullPanel h2{margin:0;color:var(--ink)}.ghostButton{border:0;background:transparent;color:var(--orange);font-weight:900;cursor:pointer;padding:6px 0}.roleForm label{display:grid;gap:7px;color:var(--muted);font-size:13px;font-weight:900}.roleForm input{width:100%;min-height:42px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 10px}.checkRow{display:flex!important;grid-template-columns:none!important;align-items:center;gap:8px}.checkRow input{width:auto;min-height:auto}.roleActiveToggle{height:42px;align-items:center!important}.reportPermissionBox{grid-column:1/-1;display:grid;gap:12px;border:1px solid var(--line);border-radius:8px;background:#f8fafc;padding:14px}.reportPermissionBox strong{color:var(--ink)}.reportPermissionBox p{margin:0;color:var(--muted);font-weight:800}.reportChecks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px}.rolesFullPanel{margin:0 32px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:18px;box-shadow:0 14px 34px rgba(15,32,67,.07)}.panelHeaderLine{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:14px}.panelHeaderLine p{margin:4px 0 0;color:var(--muted);font-weight:700}.rolesTableWrap{width:100%;overflow-x:auto}.rolesTable{width:100%;border-collapse:collapse;table-layout:fixed}.rolesTable th,.rolesTable td{border-bottom:1px solid var(--line);padding:12px 10px;text-align:left;vertical-align:middle}.rolesTable th{font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:.02em}.rolesTable th:nth-child(1){width:16%}.rolesTable th:nth-child(2){width:18%}.rolesTable th:nth-child(3){width:14%}.rolesTable th:nth-child(4){width:12%}.rolesTable th:nth-child(6){width:190px}.statusPill{display:inline-flex;align-items:center;justify-content:center;min-width:74px;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900}.statusPill.ok{background:#edf9f0;color:#16833a}.statusPill.off{background:#f1f5f9;color:#64748b}.rowActions{display:flex;gap:8px;align-items:center}.compact{min-height:34px;padding:0 10px}.dangerButton{min-height:38px;border:1px solid #f1b8b8;border-radius:8px;background:#fff5f5;color:#bb1c1c;font-weight:900;cursor:pointer}.dangerButton:disabled{opacity:.45;cursor:not-allowed}.secondaryButton{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 14px;font-weight:900;text-decoration:none;cursor:pointer}.primaryButton{min-height:42px;border:0;border-radius:8px;background:var(--orange);color:#fff;padding:0 16px;font-weight:900;cursor:pointer}.primaryButton:disabled{opacity:.65;cursor:wait}@media (max-width:1120px){.roleForm{grid-template-columns:1fr 1fr}.formTitleBlock,.reportPermissionBox{grid-column:1/-1}.roleForm .primaryButton{grid-column:1/-1}.reportChecks{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:760px){.rolesNotice,.roleEditorBand,.rolesFullPanel{margin-left:18px;margin-right:18px;padding-left:0;padding-right:0}.roleEditorBand{padding-bottom:16px}.roleForm{grid-template-columns:1fr;padding:16px}.rolesFullPanel{padding:14px}.panelHeaderLine{align-items:flex-start;flex-direction:column}.rolesTable{min-width:900px}.reportChecks{grid-template-columns:1fr}.rolesHeader{align-items:flex-start}.headerActions{width:100%}.headerActions .secondaryButton{width:100%}}
      `}</style>
    </main>
  );
}
