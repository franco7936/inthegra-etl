import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="shell">
      <nav className="topbar">
        <a className="brand" href="/">
          <img src="https://www.inthegrasoftware.com/Inthegra.svg" alt="Inthegra" />
          <span>
            <strong>Inthegra Reports</strong>
            <small>Portal operativo</small>
          </span>
        </a>
        <Link className="navLink" href="/reportes/horas">Reporte de horas</Link>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Centro de informacion interna</p>
          <h1>Reportes dinamicos para gestion operativa</h1>
          <p>
            Portal conectado a Turso para consultar informacion generada por el ETL de Jira y ActivityTimeline.
          </p>
          <Link className="primaryButton" href="/reportes/horas">Abrir reporte de horas</Link>
        </div>
      </section>

      <section className="contentGrid">
        <Link className="reportTile" href="/reportes/horas">
          <span>H</span>
          <h2>Reporte de horas</h2>
          <p>Horas por persona, proyecto y tipo de actividad con filtros dinamicos.</p>
        </Link>
        <article className="reportTile muted">
          <span>+</span>
          <h2>Proximos reportes</h2>
          <p>La estructura queda lista para sumar nuevos tableros conectados a vistas SQL.</p>
        </article>
      </section>
    </main>
  );
}
