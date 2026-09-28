import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];
const REPORT_PATHS = {
  '/reportes/horas': 'horas',
  '/reportes/entrega-calidad': 'entrega-calidad',
  '/reportes/inversion-estrategica': 'inversion-estrategica',
  '/reportes/calidad-performance': 'calidad-performance',
  '/reportes/novedades-laborales': 'novedades-laborales',
  '/reportes/status-semanal': 'status-semanal',
};

function decodeSession(value) {
  if (!value || !value.includes('.')) return null;
  try {
    const [payload] = value.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isPublic(pathname) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function requiredReport(pathname) {
  const entry = Object.entries(REPORT_PATHS).find(([path]) => pathname === path || pathname.startsWith(`${path}/`));
  return entry ? entry[1] : '';
}

export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/_next') || pathname.includes('.') || isPublic(pathname)) return NextResponse.next();

  const session = decodeSession(request.cookies.get('inthegra_session')?.value);
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith('/usuarios') && session.role !== 'admin') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  const reportKey = requiredReport(pathname);
  if (reportKey && session.role !== 'admin' && !Array.isArray(session.reports)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }
  if (reportKey && session.role !== 'admin' && !session.reports.includes(reportKey)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  if (pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
