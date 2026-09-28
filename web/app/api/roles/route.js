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

function normalizeRoleKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function GET(request) {
  try {
    if (!requireAdmin(request)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    const db = getTursoClient();
    await ensureAuthTables(db);
    const [roles, permissions] = await Promise.all([
      queryRows(db, `SELECT role_key, label, is_admin, enabled FROM app_roles ORDER BY is_admin DESC, label`),
      queryRows(db, `SELECT role_key, report_key, can_view FROM app_role_permissions ORDER BY role_key, report_key`),
    ]);
    return NextResponse.json({ ok: true, roles, permissions, reports: REPORTS });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!requireAdmin(request)) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
    const payload = await request.json();
    const roleKey = normalizeRoleKey(payload.roleKey || payload.label);
    const label = String(payload.label || '').trim();
    const enabled = payload.enabled === false ? 0 : 1;
    const permissions = Array.isArray(payload.permissions) ? payload.permissions : [];
    if (!roleKey || !label) return NextResponse.json({ ok: false, error: 'Completa nombre del rol.' }, { status: 400 });

    const db = getTursoClient();
    await ensureAuthTables(db);
    const existing = await queryRows(db, `SELECT is_admin FROM app_roles WHERE role_key = ?`, [roleKey]);
    const isAdmin = Number(existing[0]?.is_admin || 0) === 1 ? 1 : 0;
    await db.execute({ sql: `INSERT INTO app_roles (role_key, label, is_admin, enabled, fecha_carga) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(role_key) DO UPDATE SET label=excluded.label, enabled=excluded.enabled, fecha_carga=datetime('now')`, args: [roleKey, label, isAdmin, enabled] });

    for (const report of REPORTS) {
      const canView = isAdmin || permissions.includes(report.key) ? 1 : 0;
      await db.execute({ sql: `INSERT INTO app_role_permissions (role_key, report_key, can_view, fecha_carga) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(role_key, report_key) DO UPDATE SET can_view=excluded.can_view, fecha_carga=datetime('now')`, args: [roleKey, report.key, canView] });
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
    const roleKey = normalizeRoleKey(searchParams.get('roleKey'));
    if (!roleKey) return NextResponse.json({ ok: false, error: 'Falta rol.' }, { status: 400 });
    if (roleKey === 'admin') return NextResponse.json({ ok: false, error: 'El rol administrador no se puede eliminar.' }, { status: 400 });

    const db = getTursoClient();
    await ensureAuthTables(db);
    const users = await queryRows(db, `SELECT COUNT(*) AS total FROM app_users WHERE role = ?`, [roleKey]);
    if (Number(users[0]?.total || 0) > 0) return NextResponse.json({ ok: false, error: 'No se puede eliminar un rol asignado a usuarios.' }, { status: 400 });
    await db.execute({ sql: `DELETE FROM app_role_permissions WHERE role_key = ?`, args: [roleKey] });
    await db.execute({ sql: `DELETE FROM app_roles WHERE role_key = ?`, args: [roleKey] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
