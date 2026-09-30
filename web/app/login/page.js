'use client';

import { Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export default function LoginPage() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  return (
    <main className="loginShell">
      <section className="loginBrandPanel">
        <div className="loginBrandTop">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>Inthegra Reports</span>
        </div>
        <div className="loginBrandContent">
          <span className="loginIconMark"><ShieldCheck size={34} /></span>
          <p className="eyebrow">Portal ejecutivo</p>
          <h1>Reportes claros para decidir mejor.</h1>
          <p>Indicadores operativos, calidad, horas, novedades y seguimiento de equipos integrados desde el ETL.</p>
        </div>
        <div className="loginBrandFooter">
          <span>Jira</span>
          <span>ActivityTimeline</span>
          <span>PGI</span>
          <span>Turso</span>
        </div>
      </section>

      <section className="loginFormSide">
        <form className="loginCard" onSubmit={submit}>
          <div className="loginCardHeader">
            <span><LockKeyhole size={18} /></span>
            <div>
              <p className="eyebrow">Acceso seguro</p>
              <h2>Ingresar</h2>
              <p>Usa tu usuario asignado para consultar los reportes disponibles.</p>
            </div>
          </div>

          <label>
            Usuario
            <input value={form.username} placeholder="Ej: admin" onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </label>

          <label>
            Contraseña
            <span className="passwordField">
              <input type={showPassword ? 'text' : 'password'} value={form.password} placeholder="Ingresar contraseña" onChange={(event) => setForm({ ...form, password: event.target.value })} required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {error && <div className="errorBox compactError">{error}</div>}

          <button className="primaryButton loginSubmit" disabled={loading} type="submit">
            <LogIn size={18} />{loading ? 'Ingresando...' : 'Ingresar al portal'}
          </button>
        </form>
      </section>

      <style jsx global>{`
        body:has(.loginShell) .appTopbar{display:none!important}
        .loginShell{min-height:100vh;display:grid;grid-template-columns:minmax(420px,0.95fr) minmax(420px,1.05fr);background:#f7f8fb;color:var(--ink)}
        .loginBrandPanel{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:44px 52px;background:radial-gradient(circle at 20% 15%,rgba(255,255,255,.18),transparent 26%),linear-gradient(145deg,#ff6a00 0%,#e45f05 38%,#0f2043 100%);color:#fff}
        .loginBrandPanel:before{content:'';position:absolute;inset:-20%;background:repeating-linear-gradient(115deg,rgba(255,255,255,.12) 0 1px,transparent 1px 62px);opacity:.42;transform:rotate(-8deg)}
        .loginBrandPanel>*{position:relative;z-index:1}
        .loginBrandTop{display:flex;align-items:center;gap:12px;font-weight:900}
        .loginBrandTop img{width:42px;height:42px;object-fit:contain;filter:brightness(0) invert(1)}
        .loginBrandContent{max-width:620px}
        .loginIconMark{width:68px;height:68px;display:grid;place-items:center;margin-bottom:28px;border:1px solid rgba(255,255,255,.28);border-radius:18px;background:rgba(255,255,255,.14);box-shadow:0 20px 60px rgba(0,0,0,.16)}
        .loginBrandContent .eyebrow{color:#fff;opacity:.86}
        .loginBrandContent h1{margin:0 0 18px;font-size:clamp(42px,5vw,72px);line-height:.98;letter-spacing:0;color:#fff}
        .loginBrandContent p:not(.eyebrow){max-width:560px;margin:0;color:rgba(255,255,255,.86);font-size:20px;line-height:1.45}
        .loginBrandFooter{display:flex;gap:10px;flex-wrap:wrap}
        .loginBrandFooter span{min-height:32px;display:inline-flex;align-items:center;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.1);font-size:12px;font-weight:900}
        .loginFormSide{display:grid;place-items:center;padding:48px}
        .loginCard{width:min(460px,100%);display:grid;gap:18px;padding:34px;border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.96);box-shadow:0 24px 70px rgba(15,32,67,.12)}
        .loginCardHeader{display:flex;gap:14px;align-items:flex-start;margin-bottom:6px}
        .loginCardHeader>span{width:44px;height:44px;display:grid;place-items:center;border-radius:12px;background:#fff1e8;color:var(--orange)}
        .loginCardHeader h2{margin:0 0 6px;color:var(--navy);font-size:34px;line-height:1}
        .loginCardHeader p:last-child{margin:0;color:var(--muted);line-height:1.45}
        .loginCard label{display:grid;gap:8px;color:#5d6b82;font-size:13px;font-weight:900}
        .loginCard input{width:100%;min-height:48px;border:1px solid #dce4ef;border-radius:12px;background:#fff;color:var(--ink);padding:0 13px;font-weight:750;outline:none;transition:border-color .15s ease,box-shadow .15s ease}
        .loginCard input:focus{border-color:#ffb074;box-shadow:0 0 0 4px rgba(255,106,0,.1)}
        .loginCard input::placeholder{color:#a0a9b8;font-weight:650}
        .passwordField{position:relative;display:block}
        .passwordField input{padding-right:48px}
        .passwordField button{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:9px;background:#f6f8fb;color:#64748b;cursor:pointer}
        .passwordField button:hover{background:#fff1e8;color:var(--orange-dark)}
        .loginSubmit{min-height:50px;gap:9px;border-radius:12px;font-size:15px}
        .compactError{width:100%;margin:0;padding:12px;border-radius:12px}
        @media(max-width:900px){.loginShell{grid-template-columns:1fr}.loginBrandPanel{min-height:42vh;padding:34px 24px}.loginFormSide{padding:28px 18px}.loginBrandContent h1{font-size:42px}.loginBrandContent p:not(.eyebrow){font-size:17px}.loginCard{padding:24px}}
      `}</style>
    </main>
  );
}
