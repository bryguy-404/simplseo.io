import { NextResponse } from 'next/server';
// Compatibility redirect for previously registered Google callback URLs. The
// signed-in popup owner verifies and consumes the state through exchange-code.
// This endpoint never exchanges codes or puts Google access tokens in a URL.
export async function GET(request) {
  const source = new URL(request.url);
  const destination = new URL('/gsc-callback', source.origin);
  for (const name of ['code', 'state', 'error']) {
    const value = source.searchParams.get(name);
    if (value) destination.searchParams.set(name, value);
  }
  return NextResponse.redirect(destination);
}
