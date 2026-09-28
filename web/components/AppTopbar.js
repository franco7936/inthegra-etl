'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

const GROUPS = [
  {
    label: 'Operativos',
    reports: [
      { key: 'horas', label: 'Reporte de horas', href: '/reportes/horas' },
      { key: 'novedades-laborales', label: 'Novedades laborales', href: '/reportes/novedades-laborales' },
      { key: 'status-semanal', label: 'Status semanal', href: '/reportes/status-semanal' },
    ],
  },
  {
    label: 'Estrategicos',
    reports: [
      { key: 'inversion-estrategica', label: 'Inversion estrategica', href: '/reportes/inversion-estrategica' },
      { key: 'entrega-calidad', label: 'Entrega y calidad de servicio', href: '/reportes/entrega-calidad' },
    ],
  },
  {
    label: 'Calidad',
    reports: [
      { key: 'calidad-performance', label: 'Calidad y performance operativa', href: '/reportes/calidad-performance' },
    ],
  },
];

function initials(name) {
  return String(name || 'U').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function roleLabel(role) {
  if (role === 'admin') return 'Administrador';
  if (!role) return 'Usuario';
  return String(role).replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AppTopbar() {
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => { if (alive) setUser(payload.user || null); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => {
    if (!user) return [];
    const allowed = user.role === 'admin' ? null : new Set(user.reports || []);
    return GROUPS.map((group) => ({
      ...group,
      reports: group.reports.filter((report) => !allowed || allowed.has(report.key)),
    })).filter((group) => group.reports.length > 0);
  }, [user]);

  if (!loaded || !user) return null;

  return (
    <>
      <header className="appTopbar">
        <Link className="appBrand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span><strong>Inthegra Reports</strong><small>{user.username}</small></span>
        </Link>
        <nav className="appNav">
          {groups.map((group) => (
            <div className="navGroup" key={group.label}>
              <button type="button" className="navGroupButton">{group.label}<span>⌄</span></button>
              <div className="navMenu">
                {group.reports.map((report) => <Link key={report.key} href={report.href}>{report.label}</Link>)}
              </div>
            </div>
          ))}
          {user.role === 'admin' && <Link className="adminLink" href="/usuarios">Usuarios</Link>}
        </nav>
        <div className="profileArea">
          <button className="profileButton" type="button" onClick={() => setProfileOpen(!profileOpen)} aria-label="Perfil de usuario">
            <span>{initials(user.username)}</span>
          </button>
          {profileOpen && (
            <div className="profileMenu">
              <div className="profileHeader">
                <span className="profileAvatar">{initials(user.username)}</span>
                <div><strong>{user.username}</strong><small>{roleLabel(user.role)}</small></div>
              </div>
              <form action="/api/auth/logout" method="post">
                <button type="submit">Cerrar sesion</button>
              </form>
            </div>
          )}
        </div>
      </header>
      <style jsx global>{`
        .shell > nav.topbar { display: none !important; }
        .appTopbar { position: sticky; top: 0; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 56px; padding: 0 22px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.96); backdrop-filter: blur(14px); }
        .appBrand { display: inline-flex; align-items: center; gap: 9px; min-width: 190px; text-decoration: none; }
        .appBrand img { width: 30px; height: 30px; object-fit: contain; }
        .appBrand strong { display: block; color: var(--navy); font-size: 13px; font-weight: 850; line-height: 1.1; }
        .appBrand small { display: block; color: var(--muted); font-size: 10px; line-height: 1.2; }
        .appNav { display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1; min-width: 0; }
        .navGroup { position: relative; }
        .navGroupButton, .adminLink { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--navy); font-size: 12px; font-weight: 850; text-decoration: none; cursor: pointer; white-space: nowrap; }
        .navGroupButton:hover, .adminLink:hover { border-color: var(--line); background: #fff7f0; color: var(--orange-dark); }
        .navMenu { position: absolute; top: calc(100% + 8px); left: 0; min-width: 230px; display: none; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: #fff; box-shadow: 0 18px 44px rgba(15,32,67,.15); }
        .navGroup:hover .navMenu, .navGroup:focus-within .navMenu { display: grid; gap: 4px; }
        .navMenu a { padding: 9px 10px; border-radius: 7px; color: var(--navy); font-size: 12px; font-weight: 750; text-decoration: none; }
        .navMenu a:hover { background: #fff1e8; color: var(--orange-dark); }
        .profileArea { position: relative; display: flex; justify-content: flex-end; min-width: 48px; }
        .profileButton { width: 36px; height: 36px; border: 2px solid #ffd1ad; border-radius: 50%; background: var(--orange); color: #fff; font-weight: 900; cursor: pointer; box-shadow: 0 6px 18px rgba(255,106,0,.22); }
        .profileMenu { position: absolute; top: calc(100% + 10px); right: 0; width: 260px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: #111827; color: #fff; box-shadow: 0 22px 60px rgba(8,17,31,.28); }
        .profileHeader { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,.06); }
        .profileAvatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--orange); color: #fff; font-weight: 900; }
        .profileHeader strong { display: block; font-size: 14px; }
        .profileHeader small { display: block; margin-top: 2px; color: #cbd5e1; font-size: 12px; }
        .profileMenu form { margin-top: 10px; }
        .profileMenu button[type='submit'] { width: 100%; min-height: 42px; border: 0; border-radius: 10px; background: rgba(255,255,255,.08); color: #fff; font-weight: 850; cursor: pointer; text-align: left; padding: 0 12px; }
        .profileMenu button[type='submit']:hover { background: rgba(255,255,255,.14); }
        .hoursMatrixTable .pgiColumn { background: transparent !important; }
        .hoursMatrixTable tbody tr:has(.complianceCell) td:nth-last-child(3), .hoursMatrixTable tbody tr:not(:has(.complianceCell)) td:nth-last-child(2) { background: #fff8f1 !important; }
        @media (max-width: 900px) { .appTopbar { align-items: flex-start; flex-direction: column; padding: 12px 18px; } .appNav { justify-content: flex-start; flex-wrap: wrap; } .profileArea { position: absolute; top: 10px; right: 18px; } }
      `}</style>
    </>
  );
}
