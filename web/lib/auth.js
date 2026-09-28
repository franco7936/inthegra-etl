import crypto from 'crypto';

export const ADMIN_PASSWORD = 'admin123';
export const REPORTS = [
  { key: 'horas', label: 'Reporte de horas' },
  { key: 'entrega-calidad', label: 'Entrega y calidad' },
  { key: 'inversion-estrategica', label: 'Inversion estrategica' },
  { key: 'calidad-performance', label: 'Calidad y performance' },
  { key: 'novedades-laborales', label: 'Novedades laborales' },
  { key: 'status-semanal', label: 'Status semanal' },
];

export function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

export function sessionValue(user) {
  const payload = Buffer.from(JSON.stringify({ username: user.username, role: user.role })).toString('base64url');
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
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
