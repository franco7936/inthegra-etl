import crypto from 'crypto';

export const ADMIN_PASSWORD = 'admin123';
export const REPORTS = [
  { key: 'horas', label: 'Reporte de horas', href: '/reportes/horas', tile: 'H', description: 'Horas por persona, proyecto y tipo de actividad con filtros dinamicos y cargas PGI.' },
  { key: 'entrega-calidad', label: 'Entrega y calidad de servicio', href: '/reportes/entrega-calidad', tile: 'I', description: 'Indicadores generales, SaaS y desarrollo a medida para seguimiento ejecutivo.' },
  { key: 'inversion-estrategica', label: 'Inversion estrategica', href: '/reportes/inversion-estrategica', tile: 'E', description: 'Horas destinadas agrupadas por proyecto y por epica.' },
  { key: 'calidad-performance', label: 'Calidad y performance operativa', href: '/reportes/calidad-performance', tile: 'Q', description: 'Metricas QA para priorizar mejoras y reducir riesgo en releases.' },
  { key: 'novedades-laborales', label: 'Novedades laborales', href: '/reportes/novedades-laborales', tile: 'N', description: 'Day off, vacaciones y horas extras por persona y por equipo.' },
  { key: 'status-semanal', label: 'Status semanal', href: '/reportes/status-semanal', tile: 'S', description: 'Reporte semanal de lideres con avances, riesgos, bloqueos y proximos pasos.' },
];

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

export function sessionValue(user) {
  const payload = Buffer.from(JSON.stringify({
    username: user.username,
    role: user.role,
    reports: user.role === 'admin' ? REPORTS.map((report) => report.key) : (user.reports || []),
  })).toString('base64url');
  const secret = process.env.AUTH_SECRET || 'inthegra-local-auth-secret';
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function parseSession(value) {
  if (!value || !value.includes('.')) return null;
  const [payload, signature] = value.split('.');
  const secret = process.env.AUTH_SECRET || 'inthegra-local-auth-secret';
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (signature !== expected) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return { ...session, reports: Array.isArray(session.reports) ? session.reports : [] };
  } catch {
    return null;
  }
}
