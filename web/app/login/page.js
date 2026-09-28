'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'No se pudo iniciar sesion');
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return <main className="shell reportShell"><section className="pageHeader"><div><p className="eyebrow">Inthegra Reports</p><h1>Ingreso</h1><p>Acceso al portal de reportes y administracion de permisos.</p></div></section><section className="reportPanel loginPanel"><form onSubmit={submit}><label>Usuario<input value={form.username} placeholder="admin" onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label><label>Contraseña<input type="password" value={form.password} placeholder="Contraseña" onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>{error && <div className="errorBox compactError">{error}</div>}<button className="primaryButton" disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button></form></section><style jsx global>{`.loginPanel{width:min(460px,calc(100% - 64px));padding:24px}.loginPanel form{display:grid;gap:16px}.loginPanel label{display:grid;gap:7px;color:var(--muted);font-size:13px;font-weight:800}.loginPanel input{width:100%;min-height:42px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);padding:0 10px}.loginPanel input::placeholder{color:#9aa5b1}.compactError{width:100%;margin:0;padding:12px}`}</style></main>;
}
