'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, ChevronDown, Home, LogOut, Menu, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const topbarRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => { if (alive) setUser(payload.user || null); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    function closeMenus(event) {
      if (topbarRef.current && !topbarRef.current.contains(event.target)) {
        setActiveGroup('');
        setProfileOpen(false);
      }
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setActiveGroup('');
        setProfileOpen(false);
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
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
      <header className="appTopbar" ref={topbarRef}>
        <Link className="appBrand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span><strong>Inthegra Reports</strong><small>Panel ejecutivo</small></span>
        </Link>
        <button className="mobileNavToggle" type="button" onClick={() => { setMobileOpen(!mobileOpen); setProfileOpen(false); }} aria-label="Abrir navegacion">
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={`appNav ${mobileOpen ? 'open' : ''}`}>
          <Link className={`adminLink homeLink ${pathname === '/' ? 'active' : ''}`} href="/" onClick={() => setMobileOpen(false)}><Home size={15} />Inicio</Link>
          {groups.map((group) => (
            <div className="navGroup" key={group.label}>
              <button type="button" className={`navGroupButton ${activeGroup === group.label ? 'active' : ''}`} onClick={() => { setActiveGroup(activeGroup === group.label ? '' : group.label); setProfileOpen(false); }}>
                <BarChart3 size={15} />{group.label}<ChevronDown size={15} />
              </button>
              <div className={`navMenu ${activeGroup === group.label ? 'open' : ''}`}>
                {group.reports.map((report) => <Link className={pathname === report.href ? 'active' : ''} key={report.key} href={report.href} onClick={() => { setActiveGroup(''); setMobileOpen(false); }}>{report.label}</Link>)}
              </div>
            </div>
          ))}
          {user.role === 'admin' && <Link className={`adminLink ${pathname === '/usuarios' ? 'active' : ''}`} href="/usuarios" onClick={() => setMobileOpen(false)}><Settings size={15} />Usuarios</Link>}
        </nav>
        <div className="profileArea">
          <button className="profileButton" type="button" onClick={() => { setProfileOpen(!profileOpen); setActiveGroup(''); }} aria-label="Perfil de usuario">
            <span>{initials(user.username)}</span>
          </button>
          {profileOpen && (
            <div className="profileMenu">
              <div className="profileHeader">
                <span className="profileAvatar">{initials(user.username)}</span>
                <div><strong>{user.username}</strong><small>{roleLabel(user.role)}</small></div>
              </div>
              <form action="/api/auth/logout" method="post">
                <button type="submit"><LogOut size={16} />Cerrar sesion</button>
              </form>
            </div>
          )}
        </div>
      </header>
      <style jsx global>{`
        .shell > nav.topbar { display: none !important; }
        .appTopbar { position: sticky; top: 0; z-index: 30; display: grid; grid-template-columns: minmax(190px, auto) minmax(0, 1fr) auto; align-items: center; gap: 18px; min-height: 64px; padding: 0 22px; border-bottom: 1px solid rgba(226,231,239,.9); background: rgba(255,255,255,.92); backdrop-filter: blur(18px); box-shadow: 0 10px 30px rgba(15,32,67,.06); }
        .appBrand { display: inline-flex; align-items: center; gap: 10px; min-width: 0; text-decoration: none; }
        .appBrand img { width: 34px; height: 34px; object-fit: contain; }
        .appBrand strong { display: block; color: var(--navy); font-size: 14px; font-weight: 900; line-height: 1.1; }
        .appBrand small { display: block; color: var(--muted); font-size: 11px; line-height: 1.2; }
        .mobileNavToggle { display: none; width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--navy); cursor: pointer; }
        .appNav { display: flex; align-items: center; justify-content: center; gap: 8px; min-width: 0; }
        .navGroup { position: relative; }
        .navGroupButton, .adminLink { min-height: 38px; display: inline-flex; align-items: center; gap: 7px; padding: 0 12px; border: 1px solid transparent; border-radius: 999px; background: transparent; color: #344054; font-size: 13px; font-weight: 850; text-decoration: none; cursor: pointer; white-space: nowrap; transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease; }
        .navGroupButton svg:last-child { transition: transform .15s ease; }
        .navGroupButton.active svg:last-child { transform: rotate(180deg); }
        .navGroupButton:hover, .navGroupButton.active, .adminLink:hover, .adminLink.active { border-color: #ffd5b8; background: #fff4ec; color: var(--orange-dark); box-shadow: inset 0 0 0 1px rgba(255,106,0,.04); }
        .navMenu { position: absolute; top: calc(100% + 10px); left: 0; min-width: 260px; display: none; padding: 8px; border: 1px solid rgba(226,231,239,.95); border-radius: 14px; background: #fff; box-shadow: 0 22px 60px rgba(15,32,67,.18); }
        .navMenu.open { display: grid; gap: 4px; }
        .navMenu a { padding: 11px 12px; border-radius: 10px; color: var(--navy); font-size: 13px; font-weight: 800; text-decoration: none; }
        .navMenu a:hover, .navMenu a.active { background: #fff1e8; color: var(--orange-dark); }
        .profileArea { position: relative; display: flex; justify-content: flex-end; min-width: 48px; }
        .profileButton { width: 36px; height: 36px; border: 2px solid #ffd1ad; border-radius: 50%; background: var(--orange); color: #fff; font-weight: 900; cursor: pointer; box-shadow: 0 6px 18px rgba(255,106,0,.22); }
        .profileMenu { position: absolute; top: calc(100% + 10px); right: 0; width: 260px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: #111827; color: #fff; box-shadow: 0 22px 60px rgba(8,17,31,.28); }
        .profileHeader { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,.06); }
        .profileAvatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 50%; background: var(--orange); color: #fff; font-weight: 900; }
        .profileHeader strong { display: block; font-size: 14px; }
        .profileHeader small { display: block; margin-top: 2px; color: #cbd5e1; font-size: 12px; }
        .profileMenu form { margin-top: 10px; }
        .profileMenu button[type='submit'] { width: 100%; min-height: 42px; display:flex; align-items:center; gap:8px; border: 0; border-radius: 10px; background: rgba(255,255,255,.08); color: #fff; font-weight: 850; cursor: pointer; text-align: left; padding: 0 12px; }
        .profileMenu button[type='submit']:hover { background: rgba(255,255,255,.14); }
        .hoursMatrixTable .pgiColumn { background: transparent !important; }
        @media (max-width: 980px) {
          .appTopbar { grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; padding: 10px 14px; }
          .mobileNavToggle { display: inline-grid; place-items: center; }
          .appNav { grid-column: 1 / -1; display: none; justify-content: flex-start; flex-wrap: wrap; padding: 8px 0 4px; border-top: 1px solid var(--line); }
          .appNav.open { display: flex; }
          .navGroup { position: static; }
          .navMenu { position: static; width: 100%; min-width: 100%; margin-top: 6px; box-shadow: none; border-radius: 12px; }
          .profileArea { min-width: 38px; }
        }
      `}</style>
    </>
  );
}
