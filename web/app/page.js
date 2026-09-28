import Link from 'next/link';
import { cookies } from 'next/headers';
import { REPORTS, parseSession } from '@/lib/auth';

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = parseSession(cookieStore.get('inthegra_session')?.value);
  const visibleReports = session?.role === 'admin'
    ? REPORTS
    : REPORTS.filter((report) => session?.reports?.includes(report.key));

  return (
    <main className="shell">
      <nav className="topbar">
        <a className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>{session?.username || 'Portal operativo'}</small>
          </span>
        </a>
        <div className="navActions">
          {visibleReports.map((report) => <Link key={report.key} className="navLink" href={report.href}>{report.label}</Link>)}
          {session?.role === 'admin' && <Link className="navLink" href="/usuarios">Usuarios</Link>}
          <form action="/api/auth/logout" method="post"><button className="navLink" style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }} type="submit">Salir</button></form>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Centro de informacion interna</p>
          <h1>Portal de reportes operativos Inthegra</h1>
          <p>
            Un espacio centralizado para consultar indicadores de gestion, seguimiento de equipos, entrega de valor e inversion operativa a partir de los datos integrados por el ETL.
          </p>
        </div>
      </section>

      <section className="contentGrid reportsGridFive">
        {visibleReports.map((report) => (
          <Link className="reportTile" href={report.href} key={report.key}>
            <span>{report.tile}</span>
            <h2>{report.label}</h2>
            <p>{report.description}</p>
          </Link>
        ))}
        {session?.role === 'admin' && <Link className="reportTile" href="/usuarios"><span>U</span><h2>Usuarios y permisos</h2><p>Configuracion de usuarios, roles y reportes visibles.</p></Link>}
        {!visibleReports.length && <div className="reportTile muted"><span>0</span><h2>Sin reportes asignados</h2><p>Solicita a un administrador que habilite reportes para tu usuario.</p></div>}
      </section>
    </main>
  );
}
