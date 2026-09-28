import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { parseSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function ensurePgiTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pgi_workload (
      pgi_id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      horas REAL NOT NULL,
      comentario TEXT,
      creado_por TEXT,
      activo INTEGER DEFAULT 1,
      fecha_carga TEXT
    )
  `);
}

function validatePayload(payload) {
  const personId = Number(payload.personId);
  const projectId = Number(payload.projectId);
  const horas = Number(payload.horas);
  const fecha = String(payload.fecha || '').slice(0, 10);

  if (!personId) return 'Selecciona una persona.';
  if (!projectId) return 'Selecciona un proyecto.';
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Selecciona una fecha valida.';
  if (!Number.isFinite(horas) || horas <= 0) return 'Ingresa horas mayores a 0.';
  if (horas > 24) return 'La carga no puede superar 24 horas para una fecha.';
  return '';
}

export async function GET(request) {
  try {
    const session = parseSession(request.cookies.get('inthegra_session')?.value);
    const db = getTursoClient();
    const projectWhere = session?.role === 'admin' ? '' : 'AND project_id = ?';
    const projectArgs = session?.role === 'admin' ? [] : [Number(session?.project_id || 0)];
    const [projects, people] = await Promise.all([
      queryRows(db, `
        SELECT project_id, COALESCE(nombre_rpt, nombre_at, project_key_rpt) AS proyecto, project_key_rpt
        FROM map_equipo_proyecto
        WHERE COALESCE(activo, 1) = 1 AND project_id IS NOT NULL ${projectWhere}
        ORDER BY proyecto
      `, projectArgs),
      queryRows(db, `
        SELECT person_id, COALESCE(full_name_at, user_name_rpt, username_at) AS persona
        FROM map_personas
        WHERE COALESCE(activo, 1) = 1 AND person_id IS NOT NULL
        ORDER BY persona
      `),
    ]);
    return NextResponse.json({ ok: true, projects, people });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const session = parseSession(request.cookies.get('inthegra_session')?.value);
    const payload = await request.json();
    const error = validatePayload(payload);
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 });

    const db = getTursoClient();
    await ensurePgiTable(db);

    const personId = Number(payload.personId);
    const projectId = Number(payload.projectId);
    if (session?.role !== 'admin' && Number(session?.project_id || 0) !== projectId) {
      return NextResponse.json({ ok: false, error: 'No tenes permiso para cargar horas en ese equipo.' }, { status: 403 });
    }
    const horas = Number(payload.horas);
    const fecha = String(payload.fecha).slice(0, 10);
    const comentario = String(payload.comentario || '').slice(0, 300);
    const creadoPor = String(payload.creadoPor || session?.username || 'web').slice(0, 80);

    await db.execute({
      sql: `
        INSERT INTO pgi_workload (person_id, project_id, fecha, horas, comentario, creado_por, activo, fecha_carga)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `,
      args: [personId, projectId, fecha, horas, comentario, creadoPor],
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
