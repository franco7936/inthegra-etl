'use client';

import Link from 'next/link';
import { Eye, EyeOff, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageSection } from '@/components/ui';
import { ModernSelect } from '@/components/AppTopbar';

const EMPTY_FORM = { username: '', password: '', role: 'viewer', projectId: '', enabled: true };

export default function UsuariosPage() {
  const [data, setData] = useState({ users: [], roles: [], reports: [], permissions: [], projects: [] });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingUser, setEditingUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/usuarios', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar usuarios');
      setData({ users: payload.users || [], roles: payload.roles || [], reports: payload.reports || [], permissions: payload.permissions || [], projects: payload.projects || [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar usuario');
      setForm(EMPTY_FORM);
      setEditingUser(null);
      setShowPassword(false);
      setMessage('Usuario guardado correctamente.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(user) {
    if (user.username === 'admin') return;
    const ok = window.confirm(`Eliminar el usuario ${user.username}?`);
    if (!ok) return;
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/usuarios?username=${encodeURIComponent(user.username)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo eliminar usuario');
      if (editingUser === user.username) cancelEdit();
      setMessage('Usuario eliminado correctamente.');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function editUser(user) {
    setEditingUser(user.username);
    setForm({ username: user.username, password: '', role: user.role || 'viewer', projectId: user.project_id ? String(user.project_id) : '', enabled: Number(user.enabled) === 1 });
    setShowPassword(false);
    setMessage('');
    setError('');
  }

  function cancelEdit() {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setShowPassword(false);
  }

  const roleLabelMap = useMemo(() => {
    const map = new Map();
    data.roles.forEach((role) => map.set(role.role_key, role.label));
    return map;
  }, [data.roles]);

  const roleReportsMap = useMemo(() => {
    const reportMap = new Map(data.reports.map((report) => [report.key, report.label]));
    const map = new Map();
    data.permissions.forEach((permission) => {
      if (Number(permission.can_view) !== 1) return;
      if (!map.has(permission.role_key)) map.set(permission.role_key, []);
      map.get(permission.role_key).push(reportMap.get(permission.report_key) || permission.report_key);
    });
    return map;
  }, [data.permissions, data.reports]);

  const selectedRole = data.roles.find((role) => role.role_key === form.role);
  const isAdminForm = form.role === 'admin' || Number(selectedRole?.is_admin || 0) === 1;
  const adminCount = data.users.filter((user) => user.role === 'admin' && Number(user.enabled) === 1).length;

  return (
    <main className="shell reportShell usersPageShell modernReportPage adminModernPage">
      <PageSection className="modernReportHero usersHeader">
        <div className="modernReportHeroText">
          <span className="modernHeroIcon"><Users size={20} /></span>
          <div><p className="eyebrow">Administracion</p><h1>Usuarios</h1><p>Gestion de accesos por rol y equipo para los reportes de Inthegra.</p></div>
        </div>
        <div className="headerActions"><Link className="secondaryButton" href="/usuarios/roles"><ShieldCheck size={16} />Administrar roles</Link></div>
      </PageSection>

      {error && <div className="errorBox usersNotice">{error}</div>}
      {message && <div className="successBox usersNotice">{message}</div>}

      <PageSection className="adminOverviewGrid">
        <article><span><Users size={16} />Usuarios</span><strong>{data.users.length}</strong><small>Configurados en el portal</small></article>
        <article><span><ShieldCheck size={16} />Roles</span><strong>{data.roles.length}</strong><small>Perfiles disponibles</small></article>
        <article><span><UserPlus size={16} />Administradores</span><strong>{adminCount}</strong><small>Activos actualmente</small></article>
      </PageSection>

      <PageSection className="userEditorBand">
        <form className="userForm modernAdminForm" onSubmit={save}>
          <div className="formTitleBlock"><span className="modernHeroIcon compactIcon"><UserPlus size={18} /></span><div><h2>{editingUser ? 'Editar usuario' : 'Nuevo usuario'}</h2><p>{editingUser ? 'Actualiza rol, equipo o estado del usuario.' : 'Crea un acceso y asignalo a un rol y equipo.'}</p></div></div>
          <label className="userNameField">Usuario<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} disabled={Boolean(editingUser)} required /></label>
          <label className="passwordLabel">Contraseña<span className="passwordField"><input type={showPassword ? 'text' : 'password'} placeholder={editingUser ? 'Dejar vacio para mantener la actual' : 'Contraseña temporal'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button className="iconButton" type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          <label className="roleField">Rol<ModernSelect value={form.role} onChange={(value) => setForm({ ...form, role: value, projectId: value === 'admin' ? '' : form.projectId })} options={data.roles.map((role) => ({ value: role.role_key, label: role.label }))} /></label>
          <label className="teamField">Equipo<ModernSelect value={form.projectId} disabled={isAdminForm} onChange={(value) => setForm({ ...form, projectId: value })} placeholder={isAdminForm ? 'Todos los equipos' : 'Seleccionar equipo'} options={[{ value: '', label: isAdminForm ? 'Todos los equipos' : 'Seleccionar equipo' }, ...data.projects.map((project) => ({ value: String(project.project_id), label: project.proyecto }))]} /></label>
          <label className="checkRow userActiveToggle"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Activo</label>
          <div className="formActions">{editingUser && <button className="secondaryButton" type="button" onClick={cancelEdit}>Cancelar</button>}<button className="primaryButton" disabled={saving}>{saving ? 'Guardando...' : 'Guardar usuario'}</button></div>
        </form>
      </PageSection>

      <PageSection className="usersFullPanel modernDataPanel">
        <div className="panelHeaderLine"><div><h2><Users size={18} />Usuarios actuales</h2><p>{data.users.length} usuarios configurados</p></div><button className="secondaryButton" type="button" onClick={load}><RefreshCw size={16} />Actualizar</button></div>
        {loading ? <div className="emptyState">Cargando usuarios...</div> : <div className="usersTableWrap"><table className="usersTable"><thead><tr><th>Usuario</th><th>Rol</th><th>Equipo</th><th>Estado</th><th>Reportes habilitados</th><th>Acciones</th></tr></thead><tbody>{data.users.map((user) => { const isInitialAdmin = user.username === 'admin'; const isLastAdmin = user.role === 'admin' && Number(user.enabled) === 1 && adminCount <= 1; return <tr key={user.username}><td><strong>{user.username}</strong></td><td>{roleLabelMap.get(user.role) || user.role}</td><td>{user.role === 'admin' ? 'Todos' : user.project_name || 'Sin equipo'}</td><td><span className={Number(user.enabled) === 1 ? 'statusPill ok' : 'statusPill off'}>{Number(user.enabled) === 1 ? 'Activo' : 'Inactivo'}</span></td><td>{user.role === 'admin' ? 'Todos los reportes' : (roleReportsMap.get(user.role) || []).join(', ') || 'Sin reportes'}</td><td className="rowActions"><button className="secondaryButton compact" type="button" onClick={() => editUser(user)}>Editar</button><button className="dangerButton compact" type="button" disabled={isInitialAdmin || isLastAdmin} onClick={() => removeUser(user)}>Eliminar</button></td></tr>; })}</tbody></table></div>}
      </PageSection>

      <style jsx global>{`
        .usersPageShell{min-height:100vh;padding-bottom:34px}.usersHeader{align-items:flex-end}.headerActions{display:flex;gap:10px;align-items:center}.headerActions .secondaryButton,.panelHeaderLine .secondaryButton{gap:8px}.usersNotice{width:min(1240px,calc(100% - 48px));margin:0 auto 14px}.successBox{border:1px solid #9bd6a4;background:#f0fff3;color:#146a25;border-radius:12px;padding:12px 14px;font-weight:800}.adminOverviewGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:18px}.adminOverviewGrid article{border:1px solid var(--line);border-radius:14px;background:#fff;padding:18px;box-shadow:0 16px 36px rgba(15,32,67,.07)}.adminOverviewGrid span{display:flex;align-items:center;gap:7px;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase}.adminOverviewGrid span svg{color:var(--orange)}.adminOverviewGrid strong{display:block;margin-top:8px;color:var(--navy);font-size:30px}.adminOverviewGrid small{color:var(--muted)}.userEditorBand{margin-bottom:18px}.userForm{display:grid;grid-template-columns:minmax(160px,.75fr) minmax(340px,1.6fr) minmax(170px,.8fr) minmax(230px,1.05fr) auto;gap:14px;align-items:end;border:1px solid var(--line);border-radius:14px;background:#fff;padding:18px;box-shadow:0 16px 36px rgba(15,32,67,.07)}.formTitleBlock{grid-column:1/-1;display:flex;gap:12px;align-items:center}.compactIcon{width:38px;height:38px;border-radius:10px}.formTitleBlock h2,.usersFullPanel h2{margin:0;color:var(--ink)}.formTitleBlock p{margin:4px 0 0;color:var(--muted);font-weight:700}.userForm label{display:grid;gap:7px;color:var(--muted);font-size:13px;font-weight:900}.userForm input,.userForm select{width:100%;min-height:42px;border:1px solid #dce4ef;border-radius:10px;background:#fff;color:var(--ink);padding:0 10px;font-weight:750}.passwordField{display:grid;grid-template-columns:minmax(0,1fr) 46px;gap:8px}.iconButton{min-height:42px;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:#f8fafc;color:var(--ink);font-weight:900;cursor:pointer}.iconButton:hover{background:#fff1e8;color:var(--orange-dark)}.checkRow{display:flex!important;grid-template-columns:none!important;align-items:center;gap:8px}.checkRow input{width:auto;min-height:auto}.userActiveToggle{height:42px;align-items:center!important}.formActions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;align-items:center;padding-top:4px;background:transparent;border:0;box-shadow:none}.formActions .primaryButton,.formActions .secondaryButton{min-width:150px}.usersFullPanel{padding:18px}.panelHeaderLine{display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:14px}.panelHeaderLine h2{display:flex;align-items:center;gap:8px}.panelHeaderLine h2 svg{color:var(--orange)}.panelHeaderLine p{margin:4px 0 0;color:var(--muted);font-weight:700}.usersTableWrap{width:100%;overflow-x:auto}.usersTable{width:100%;border-collapse:collapse;table-layout:fixed}.usersTable th,.usersTable td{border-bottom:1px solid var(--line);padding:12px 10px;text-align:left;vertical-align:middle}.usersTable th{background:#f8fafc;font-size:12px;text-transform:uppercase;color:var(--muted);letter-spacing:0}.usersTable tbody tr:hover td{background:#fff8f1}.usersTable th:nth-child(1){width:15%}.usersTable th:nth-child(2){width:15%}.usersTable th:nth-child(3){width:16%}.usersTable th:nth-child(4){width:10%}.usersTable th:nth-child(6){width:190px}.statusPill{display:inline-flex;align-items:center;justify-content:center;min-width:74px;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:900}.statusPill.ok{background:#edf9f0;color:#16833a}.statusPill.off{background:#f1f5f9;color:#64748b}.rowActions{display:flex;gap:8px;align-items:center}.compact{min-height:34px;padding:0 10px}.dangerButton{min-height:38px;border:1px solid #f1b8b8;border-radius:8px;background:#fff5f5;color:#bb1c1c;font-weight:900;cursor:pointer}.dangerButton:disabled{opacity:.45;cursor:not-allowed}.secondaryButton{display:inline-flex;align-items:center;justify-content:center;min-height:38px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);padding:0 14px;font-weight:900;text-decoration:none;cursor:pointer}.primaryButton{min-height:42px;border:0;border-radius:10px;background:var(--orange);color:#fff;padding:0 16px;font-weight:900;cursor:pointer}.primaryButton:disabled{opacity:.65;cursor:wait}@media (max-width:1180px){.userForm{grid-template-columns:1fr 1fr}.formTitleBlock,.passwordLabel,.formActions{grid-column:1/-1}.formActions{justify-content:flex-end}}@media (max-width:760px){.adminOverviewGrid{grid-template-columns:1fr}.usersNotice{width:calc(100% - 32px)}.userForm{grid-template-columns:1fr;padding:16px}.usersFullPanel{padding:14px}.panelHeaderLine{align-items:flex-start;flex-direction:column}.usersTable{min-width:960px}.usersHeader{align-items:flex-start}.headerActions{width:100%}.headerActions .secondaryButton{width:100%}.formActions{flex-direction:column-reverse;align-items:stretch}.formActions .primaryButton,.formActions .secondaryButton{width:100%}}
      `}</style>
    </main>
  );
}
