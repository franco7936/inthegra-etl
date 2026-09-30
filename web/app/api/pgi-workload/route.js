import { NextResponse } from 'next/server';
import { getTursoClient, rowsFrom } from '@/lib/turso';
import { parseSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const INCIDENCE_TYPES = [
  { key: 'booking', label: 'Booking' },
  { key: 'day_off', label: 'Day off' },
  { key: 'holiday', label: 'Holiday' },
  { key: 'jira_issue', label: 'Jira issue' },
  { key: 'placeholder', label: 'Placeholder' },
  { key: 'sick_leave', label: 'Sick leave' },
  { key: 'vacation', label: 'Vacation' },
  { key: 'worklog', label: 'Worklog' },
];
const VALID_INCIDENCE_TYPES = new Set(INCIDENCE_TYPES.map((item) => item.key));

async function queryRows(db, sql, args = []) {
  const result = await db.execute({ sql, args });
  return rowsFrom(result);
}

async function columnExists(db, table, column) {
  const columns = await queryRows(db, `PRAGMA table_info(${table})`);
  return columns.some((row) => String(row.name || '').toLowerCase() === column.toLowerCase());
}

async function ensurePgiTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pgi_workload (
      pgi_id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      horas REAL NOT NULL,
      incidence_type TEXT DEFAULT 'worklog',
      comentario TEXT,
      creado_por TEXT,
      activo INTEGER DEFAULT 1,
      fecha_carga TEXT
    )
  `);
  if (!(await columnExists(db, 'pgi_workload', 'incidence_type'))) {
    await db.execute(`ALTER TABLE pgi_workload ADD COLUMN incidence_type TEXT DEFAULT 'worklog'`);
  }
}

function normalizeIncidenceType(value) {
  const normalized = String(value || 'worklog').trim().toLowerCase();
  return VALID_INCIDENCE_TYPES.has(normalized) ? normalized : 'worklog';
}

function validatePayload(payload) {
  const personId = Number(payload.personId);
  const projectId = Number(payload.projectId);
  const horas = Number(payload.horas);
  const fecha = String(payload.fecha || '').slice(0, 10);
  const incidenceType = normalizeIncidenceType(payload.incidenceType);

  if (!personId) return 'Selecciona una persona.';
  if (!projectId) return 'Selecciona un proyecto.';
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Selecciona una fecha valida.';
  if (!VALID_INCIDENCE_TYPES.has(incidenceType)) return 'Selecciona un tipo de incidencia valido.';
  if (!Number.isFinite(horas) || horas <= 0) return 'Ingresa horas mayores a 0.';
  if (horas > 24) return 'La carga no puede superar 24 horas para una fecha.';
  return '';
}

export async function GET(request) {
  try {
    const session = parseSession(request.cookies.get('inthegra_session')?.value);
    const db = getTursoClient();
    await ensurePgiTable(db);
    const isAdmin = session?.role === 'admin';
    const projectWhere = isAdmin ? '' : 'AND project_id = ?';
    const projectArgs = isAdmin ? [] : [Number(session?.project_id || 0)];
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
    return NextResponse.json({ ok: true, projects, people, incidenceTypes: INCIDENCE_TYPES, canChooseProject: isAdmin, scopedProjectId: isAdmin ? null : Number(session?.project_id || 0) });
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
    const incidenceType = normalizeIncidenceType(payload.incidenceType);
    const comentario = String(payload.comentario || '').slice(0, 300);
    const creadoPor = String(payload.creadoPor || session?.username || 'web').slice(0, 80);

    await db.execute({
      sql: `
        INSERT INTO pgi_workload (person_id, project_id, fecha, horas, incidence_type, comentario, creado_por, activo, fecha_carga)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      `,
      args: [personId, projectId, fecha, horas, incidenceType, comentario, creadoPor],
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

