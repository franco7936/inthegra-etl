import { NextResponse } from 'next/server';
import { parseSession } from '@/lib/auth';

export async function GET(request) {
  const session = parseSession(request.cookies.get('inthegra_session')?.value);
  return NextResponse.json({ ok: true, user: session });
}
