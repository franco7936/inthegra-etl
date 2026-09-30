import Link from 'next/link';
import { cookies } from 'next/headers';
import { BarChart3, BriefcaseBusiness, ClipboardList, Gauge, LineChart, ShieldCheck, Users } from 'lucide-react';
import { REPORTS, parseSession } from '@/lib/auth';
import { PageSection, ReportCard, Surface } from '@/components/ui';

const REPORT_GROUPS = [
  {
    label: 'Operativos',
    description: 'Seguimiento del trabajo diario, horas y novedades de equipos.',
    keys: ['horas', 'novedades-laborales', 'status-semanal'],
    icon: BriefcaseBusiness,
  },
  {
    label: 'Estrategicos',
    description: 'Indicadores ejecutivos para entrega, servicio e inversion.',
    keys: ['inversion-estrategica', 'entrega-calidad'],
    icon: LineChart,
  },
  {
    label: 'Calidad',
    description: 'Performance operativa y metricas QA para reducir riesgo.',
    keys: ['calidad-performance'],
    icon: ShieldCheck,
  },
];

const REPORT_ICONS = {
  horas: BarChart3,
  'novedades-laborales': Users,
  'status-semanal': ClipboardList,
  'inversion-estrategica': LineChart,
  'entrega-calidad': Gauge,
  'calidad-performance': ShieldCheck,
};

export default async function HomePage() {
  const cookieStore = await cookies();
  const session = parseSession(cookieStore.get('inthegra_session')?.value);
  const visibleReports = session?.role === 'admin'
    ? REPORTS
    : REPORTS.filter((report) => session?.reports?.includes(report.key));
  const visibleByKey = new Map(visibleReports.map((report) => [report.key, report]));
  const visibleGroups = REPORT_GROUPS
    .map((group) => ({ ...group, reports: group.keys.map((key) => visibleByKey.get(key)).filter(Boolean) }))
    .filter((group) => group.reports.length > 0);

  return (
    <main className="shell modernHome">
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

      <PageSection className="homeIntro">
        <div className="homeIntroText">
          <p className="eyebrow">Centro de informacion interna</p>
          <h1>Portal de reportes Inthegra</h1>
          <p>Indicadores operativos, calidad, entregas e inversion alimentados por el ETL y consultables por permisos de usuario.</p>
        </div>
        <Surface className="homeProfileSummary">
          <span>Sesion activa</span>
          <strong>{session?.username || 'Usuario'}</strong>
          <small>{session?.role === 'admin' ? 'Administrador con acceso completo' : `${visibleReports.length} reportes habilitados`}</small>
        </Surface>
      </PageSection>

      <PageSection className="homeOverview">
        <Surface>
          <span>Reportes disponibles</span>
          <strong>{visibleReports.length}</strong>
          <small>Segun permisos del usuario</small>
        </Surface>
        <Surface>
          <span>Categorias activas</span>
          <strong>{visibleGroups.length}</strong>
          <small>Operativos, estrategicos y calidad</small>
        </Surface>
        <Surface>
          <span>Origen de datos</span>
          <strong>ETL</strong>
          <small>Jira, ActivityTimeline y PGI</small>
        </Surface>
      </PageSection>

      <PageSection className="homeReportGroups">
        {visibleGroups.map((group) => {
          const Icon = group.icon;
          return (
            <div className="reportGroupBand" key={group.label}>
              <header>
                <span><Icon size={18} /></span>
                <div>
                  <h2>{group.label}</h2>
                  <p>{group.description}</p>
                </div>
              </header>
              <div className="modernReportGrid">
                {group.reports.map((report) => (
                  <ReportCard key={report.key} report={report} meta={group.label} icon={REPORT_ICONS[report.key]} />
                ))}
              </div>
            </div>
          );
        })}

        {session?.role === 'admin' && (
          <div className="reportGroupBand adminBand">
            <header>
              <span><Users size={18} /></span>
              <div>
                <h2>Administracion</h2>
                <p>Gestion de usuarios, roles y permisos por reporte y equipo.</p>
              </div>
            </header>
            <div className="modernReportGrid">
              <Link className="modernReportCard" href="/usuarios">
                <span className="modernReportIcon"><Users size={19} /></span>
                <span className="modernReportContent">
                  <small>Administracion</small>
                  <strong>Usuarios y permisos</strong>
                  <em>Configurar accesos, roles y alcance por equipo.</em>
                </span>
              </Link>
            </div>
          </div>
        )}

        {!visibleReports.length && (
          <Surface className="emptyHomeState">
            <strong>Sin reportes asignados</strong>
            <small>Solicita a un administrador que habilite reportes para tu usuario.</small>
          </Surface>
        )}
      </PageSection>
    </main>
  );
}
