import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { ADMIN_PASSWORD, REPORTS, hashPassword, sessionValue } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function columnExists(db, table, column) {
  const columns = await queryRows(db, `PRAGMA table_info(${table})`);
  return columns.some((row) => String(row.name || '').toLowerCase() === column.toLowerCase());
}

async function ensureAuthTables(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS app_roles (role_key TEXT PRIMARY KEY, label TEXT NOT NULL, is_admin INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, fecha_carga TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_role_permissions (permission_id INTEGER PRIMARY KEY AUTOINCREMENT, role_key TEXT NOT NULL, report_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, fecha_carga TEXT, UNIQUE(role_key, report_key))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_users (user_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', project_id INTEGER, enabled INTEGER DEFAULT 1, fecha_carga TEXT)`);
  if (!(await columnExists(db, 'app_users', 'project_id'))) {
    await db.execute(`ALTER TABLE app_users ADD COLUMN project_id INTEGER`);
  }
  await db.execute(`CREATE TABLE IF NOT EXISTS app_report_permissions (permission_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, report_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, fecha_carga TEXT, UNIQUE(username, report_key))`);
  await db.execute({ sql: `INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga) VALUES ('admin', 'Administrador', 1, 1, datetime('now'))` });
  await db.execute({ sql: `INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga) VALUES ('viewer', 'Usuario operativo', 0, 1, datetime('now'))` });
  for (const report of REPORTS) {
    await db.execute({ sql: `INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES ('admin', ?, 1, datetime('now'))`, args: [report.key] });
    await db.execute({ sql: `INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES ('viewer', ?, ?, datetime('now'))`, args: [report.key, report.key === 'horas' ? 1 : 0] });
  }
  await db.execute({ sql: `INSERT OR IGNORE INTO app_users (username, password_hash, role, enabled, fecha_carga) VALUES (?, ?, 'admin', 1, datetime('now'))`, args: ['admin', hashPassword(ADMIN_PASSWORD)] });
}

async function getAllowedReports(db, user) {
  const roleRows = await queryRows(db, `SELECT is_admin FROM app_roles WHERE role_key = ? AND enabled = 1`, [user.role]);
  if (Number(roleRows[0]?.is_admin || 0) === 1 || user.role === 'admin') return REPORTS.map((report) => report.key);
  const rows = await queryRows(db, `
    SELECT report_key
    FROM app_role_permissions
    WHERE role_key = ? AND can_view = 1
    ORDER BY report_key
  `, [user.role]);
  return rows.map((row) => row.report_key);
}

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    const db = getTursoClient();
    await ensureAuthTables(db);
    const users = await queryRows(db, `
      SELECT
        u.username,
        u.password_hash,
        u.role,
        u.project_id,
        COALESCE(me.nombre_rpt, me.nombre_at, me.project_key_rpt) AS project_name,
        u.enabled
      FROM app_users u
      LEFT JOIN map_equipo_proyecto me ON me.project_id = u.project_id
      WHERE u.username = ?
    `, [String(username || '').trim().toLowerCase()]);
    const user = users[0];
    if (!user || Number(user.enabled) !== 1 || user.password_hash !== hashPassword(password)) {
      return NextResponse.json({ ok: false, error: 'Usuario o contrasena incorrectos.' }, { status: 401 });
    }
    const userSession = { ...user, reports: await getAllowedReports(db, user) };
    const response = NextResponse.json({ ok: true, user: { username: user.username, role: user.role, project_id: user.project_id, project_name: user.project_name, reports: userSession.reports } });
    response.cookies.set('inthegra_session', sessionValue(userSession), { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 12 });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
