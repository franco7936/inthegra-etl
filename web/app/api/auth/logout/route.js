import { NextResponse } from 'next/server';

export async function POST(request) {
  const url = new URL('/login', request.url);
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set('inthegra_session', '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
  return response;
}
