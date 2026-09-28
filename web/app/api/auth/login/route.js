import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { ADMIN_PASSWORD, REPORTS, hashPassword, sessionValue } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function ensureAuthTables(db) {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS app_users (user_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', enabled INTEGER DEFAULT 1, fecha_carga TEXT)`,
    `CREATE TABLE IF NOT EXISTS app_report_permissions (permission_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, report_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, fecha_carga TEXT, UNIQUE(username, report_key))`,
  ]);
  await db.execute({
    sql: `INSERT OR IGNORE INTO app_users (username, password_hash, role, enabled, fecha_carga) VALUES (?, ?, 'admin', 1, datetime('now'))`,
    args: ['admin', hashPassword(ADMIN_PASSWORD)],
  });
  for (const report of REPORTS) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO app_report_permissions (username, report_key, can_view, fecha_carga) VALUES ('admin', ?, 1, datetime('now'))`,
      args: [report.key],
    });
  }
}

async function getAllowedReports(db, user) {
  if (user.role === 'admin') return REPORTS.map((report) => report.key);
  const rows = await queryRows(db, `
    SELECT report_key
    FROM app_report_permissions
    WHERE username = ? AND can_view = 1
    ORDER BY report_key
  `, [user.username]);
  return rows.map((row) => row.report_key);
}

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    const db = getTursoClient();
    await ensureAuthTables(db);
    const users = await queryRows(db, `SELECT username, password_hash, role, enabled FROM app_users WHERE username = ?`, [String(username || '').trim().toLowerCase()]);
    const user = users[0];
    if (!user || Number(user.enabled) !== 1 || user.password_hash !== hashPassword(password)) {
      return NextResponse.json({ ok: false, error: 'Usuario o contrasena incorrectos.' }, { status: 401 });
    }
    const userSession = { ...user, reports: await getAllowedReports(db, user) };
    const response = NextResponse.json({ ok: true, user: { username: user.username, role: user.role, reports: userSession.reports } });
    response.cookies.set('inthegra_session', sessionValue(userSession), { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 12 });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
