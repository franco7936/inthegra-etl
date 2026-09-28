'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export default function UsuariosPage() {
  const [data, setData] = useState({ users: [], permissions: [], reports: [] });
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer', enabled: true, permissions: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/usuarios', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo cargar usuarios');
      setData(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo guardar usuario');
      setForm({ username: '', password: '', role: 'viewer', enabled: true, permissions: [] });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  function togglePermission(key) {
    const exists = form.permissions.includes(key);
    setForm({ ...form, permissions: exists ? form.permissions.filter((item) => item !== key) : [...form.permissions, key] });
  }

  const permissionMap = useMemo(() => {
    const map = new Map();
    data.permissions.forEach((permission) => {
      if (!map.has(permission.username)) map.set(permission.username, []);
      if (Number(permission.can_view) === 1) map.get(permission.username).push(permission.report_key);
    });
    return map;
  }, [data.permissions]);

  return <main className="shell reportShell"><nav className="topbar"><Link className="brand" href="/"><img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" /><span><strong>Inthegra Reports</strong><small>Usuarios y permisos</small></span></Link><Link className="navLink" href="/">Inicio</Link></nav><section className="pageHeader"><div><p className="eyebrow">Administracion</p><h1>Usuarios</h1><p>Alta de usuarios, roles y reportes visibles por usuario.</p></div></section>{error && <div className="errorBox">{error}</div>}<section className="usersGrid"><form className="usersPanel" onSubmit={save}><h2>Nuevo / editar usuario</h2><label>Usuario<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label><label>Contrasena<input type="password" placeholder="Dejar vacio mantiene o usa temporal" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label>Rol<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><label className="checkRow"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Activo</label><div className="permissionList"><strong>Reportes visibles</strong>{data.reports.map((report) => <label className="checkRow" key={report.key}><input type="checkbox" checked={form.role === 'admin' || form.permissions.includes(report.key)} disabled={form.role === 'admin'} onChange={() => togglePermission(report.key)} /> {report.label}</label>)}</div><button className="primaryButton">Guardar usuario</button></form><section className="usersPanel"><h2>Usuarios actuales</h2>{loading ? <div className="emptyState">Cargando usuarios...</div> : <div className="tableWrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Reportes</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.username}><td>{user.username}</td><td>{user.role}</td><td>{Number(user.enabled) === 1 ? 'Activo' : 'Inactivo'}</td><td>{user.role === 'admin' ? 'Todos' : (permissionMap.get(user.username) || []).join(', ')}</td></tr>)}</tbody></table></div>}</section></section><style jsx global>{`.usersGrid{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(0,1.2fr);gap:18px;padding:0 32px 40px}.usersPanel{border:1px solid var(--line);border-radius:8px;background:#fff;padding:22px;box-shadow:0 14px 34px rgba(15,32,67,.07)}.usersPanel form,.usersPanel{display:grid;gap:14px}.usersPanel label{display:grid;gap:7px;color:var(--muted);font-size:13px;font-weight:800}.usersPanel input,.usersPanel select{width:100%;min-height:42px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 10px}.checkRow{display:flex!important;grid-template-columns:none!important;align-items:center;gap:8px}.checkRow input{width:auto;min-height:auto}.permissionList{display:grid;gap:10px;padding:12px;border:1px solid var(--line);border-radius:8px;background:#f9fbfe}@media (max-width:900px){.usersGrid{grid-template-columns:1fr;padding-left:18px;padding-right:18px}}`}</style></main>;
}
