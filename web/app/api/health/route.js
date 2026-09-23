import { NextResponse } from 'next/server';
import { getTursoClient } from '@/lib/turso';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getTursoClient();
    const result = await db.execute('SELECT 1 AS ok');
    return NextResponse.json({ ok: true, db: result.rows[0]?.ok === 1 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
