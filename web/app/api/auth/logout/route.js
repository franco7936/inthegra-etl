import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('inthegra_session', '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
  return response;
}
