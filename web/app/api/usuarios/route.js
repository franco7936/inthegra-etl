import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { ADMIN_PASSWORD, REPORTS, hashPassword, parseSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function ensureAuthTables(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS app_roles (role_key TEXT PRIMARY KEY, label TEXT NOT NULL, is_admin INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, fecha_carga TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_role_permissions (permission_id INTEGER PRIMARY KEY AUTOINCREMENT, role_key TEXT NOT NULL, report_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, fecha_carga TEXT, UNIQUE(role_key, report_key))`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_users (user_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', enabled INTEGER DEFAULT 1, fecha_carga TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS app_report_permissions (permission_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, report_key TEXT NOT NULL, can_view INTEGER DEFAULT 1, fecha_carga TEXT, UNIQUE(username, report_key))`);
  await db.execute({ sql: `INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga) VALUES ('admin', 'Administrador', 1, 1, datetime('now'))` });
  await db.execute({ sql: `INSERT OR IGNORE INTO app_roles (role_key, label, is_admin, enabled, fecha_carga) VALUES ('viewer', 'Usuario operativo', 0, 1, datetime('now'))` });
  for (const report of REPORTS) {
    await db.execute({ sql: `INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES ('admin', ?, 1, datetime('now'))`, args: [report.key] });
    await db.execute({ sql: `INSERT OR IGNORE INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES ('viewer', ?, ?, datetime('now'))`, args: [report.key, report.key === 'horas' ? 1 : 0] });
  }
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
    const [users, roles, permissions] = await Promise.all([
      queryRows(db, `SELECT username, role, enabled, fecha_carga FROM app_users ORDER BY username`),
      queryRows(db, `SELECT role_key, label, is_admin, enabled FROM app_roles WHERE enabled = 1 ORDER BY is_admin DESC, label`),
      queryRows(db, `SELECT role_key, report_key, can_view FROM app_role_permissions ORDER BY role_key, report_key`),
    ]);
    return NextResponse.json({ ok: true, users, roles, permissions, reports: REPORTS });
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
    const role = String(payload.role || 'viewer').trim();
    const enabled = payload.enabled === false ? 0 : 1;
    if (!username) return NextResponse.json({ ok: false, error: 'Ingresa un usuario.' }, { status: 400 });

    const db = getTursoClient();
    await ensureAuthTables(db);
    const roleRows = await queryRows(db, `SELECT role_key FROM app_roles WHERE role_key = ? AND enabled = 1`, [role]);
    if (!roleRows.length) return NextResponse.json({ ok: false, error: 'Selecciona un rol valido.' }, { status: 400 });

    const existing = await queryRows(db, `SELECT username FROM app_users WHERE username = ?`, [username]);
    if (existing.length && password) {
      await db.execute({ sql: `UPDATE app_users SET password_hash=?, role=?, enabled=?, fecha_carga=datetime('now') WHERE username=?`, args: [hashPassword(password), role, enabled, username] });
    } else if (existing.length) {
      await db.execute({ sql: `UPDATE app_users SET role=?, enabled=?, fecha_carga=datetime('now') WHERE username=?`, args: [role, enabled, username] });
    } else {
      await db.execute({ sql: `INSERT INTO app_users (username, password_hash, role, enabled, fecha_carga) VALUES (?, ?, ?, ?, datetime('now'))`, args: [username, hashPassword(password || 'inthegra123'), role, enabled] });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    if (!requireAdmin(request)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const username = String(searchParams.get('username') || '').trim().toLowerCase();
    if (!username) return NextResponse.json({ ok: false, error: 'Falta usuario.' }, { status: 400 });
    if (username === 'admin') return NextResponse.json({ ok: false, error: 'El administrador inicial no se puede eliminar.' }, { status: 400 });

    const db = getTursoClient();
    await ensureAuthTables(db);
    const targetRows = await queryRows(db, `SELECT role FROM app_users WHERE username = ?`, [username]);
    if (!targetRows.length) return NextResponse.json({ ok: false, error: 'Usuario inexistente.' }, { status: 404 });

    if (targetRows[0].role === 'admin') {
      const admins = await queryRows(db, `SELECT COUNT(*) AS total FROM app_users WHERE role = 'admin' AND enabled = 1 AND username <> ?`, [username]);
      if (Number(admins[0]?.total || 0) < 1) return NextResponse.json({ ok: false, error: 'Siempre debe quedar al menos un administrador activo.' }, { status: 400 });
    }

    await db.execute({ sql: `DELETE FROM app_report_permissions WHERE username = ?`, args: [username] });
    await db.execute({ sql: `DELETE FROM app_users WHERE username = ?`, args: [username] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
