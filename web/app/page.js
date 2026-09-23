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
        <div className="navActions">
          <Link className="navLink" href="/reportes/horas">Reporte de horas</Link>
          <Link className="navLink" href="/reportes/entrega-calidad">Entrega y calidad</Link>
          <Link className="navLink" href="/reportes/inversion-estrategica">Inversion estrategica</Link>
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

      <section className="contentGrid reportsGridThree">
        <Link className="reportTile" href="/reportes/horas">
          <span>H</span>
          <h2>Reporte de horas</h2>
          <p>Horas por persona, proyecto y tipo de actividad con filtros dinamicos.</p>
        </Link>
        <Link className="reportTile" href="/reportes/entrega-calidad">
          <span>I</span>
          <h2>Entrega y calidad de servicio</h2>
          <p>Indicadores generales, SaaS y desarrollo a medida para seguimiento ejecutivo.</p>
        </Link>
        <Link className="reportTile" href="/reportes/inversion-estrategica">
          <span>E</span>
          <h2>Inversion estrategica</h2>
          <p>Horas destinadas agrupadas por proyecto y por epica.</p>
        </Link>
      </section>
    </main>
  );
}
