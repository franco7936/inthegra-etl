import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { ADMIN_PASSWORD, REPORTS, hashPassword, parseSession } from '@/lib/auth';

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
  await db.execute({ sql: `INSERT OR IGNORE INTO app_users (username, password_hash, role, enabled, fecha_carga) VALUES (?, ?, 'admin', 1, datetime('now'))`, args: ['admin', hashPassword(ADMIN_PASSWORD)] });
}

function requireAdmin(request) {
  const session = parseSession(request.cookies.get('inthegra_session')?.value);
  if (!session || session.role !== 'admin') return null;
  return session;
}

export async function GET(request) {
  try {
    if (!requireAdmin(request)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    const db = getTursoClient();
    await ensureAuthTables(db);
    const [users, permissions] = await Promise.all([
      queryRows(db, `SELECT username, role, enabled, fecha_carga FROM app_users ORDER BY username`),
      queryRows(db, `SELECT username, report_key, can_view FROM app_report_permissions ORDER BY username, report_key`),
    ]);
    return NextResponse.json({ ok: true, users, permissions, reports: REPORTS });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!requireAdmin(request)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    const payload = await request.json();
    const username = String(payload.username || '').trim().toLowerCase();
    const password = String(payload.password || '').trim();
    const role = payload.role === 'admin' ? 'admin' : 'viewer';
    const enabled = payload.enabled === false ? 0 : 1;
    const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
    if (!username) return NextResponse.json({ ok: false, error: 'Ingresa un usuario.' }, { status: 400 });
    const db = getTursoClient();
    await ensureAuthTables(db);
    if (password) {
      await db.execute({ sql: `INSERT INTO app_users (username, password_hash, role, enabled, fecha_carga) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, enabled=excluded.enabled, fecha_carga=datetime('now')`, args: [username, hashPassword(password), role, enabled] });
    } else {
      await db.execute({ sql: `INSERT INTO app_users (username, password_hash, role, enabled, fecha_carga) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(username) DO UPDATE SET role=excluded.role, enabled=excluded.enabled, fecha_carga=datetime('now')`, args: [username, hashPassword('inthegra123'), role, enabled] });
    }
    for (const report of REPORTS) {
      const canView = role === 'admin' || permissions.includes(report.key) ? 1 : 0;
      await db.execute({ sql: `INSERT INTO app_report_permissions (username, report_key, can_view, fecha_carga) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(username, report_key) DO UPDATE SET can_view=excluded.can_view, fecha_carga=datetime('now')`, args: [username, report.key, canView] });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
