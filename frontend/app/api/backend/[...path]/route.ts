import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'cc_session';
const SESSION_MAX_AGE = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 14);
type RouteContext = { params: Promise<{ path: string[] }> };

function backendApiBase() {
  return (process.env.SERVER_API_BASE || process.env.OPERATIONS_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

function upstreamUrl(path: string[], search: string) {
  const cleanPath = path.map(encodeURIComponent).join('/');
  return `${backendApiBase()}/${cleanPath}${search}`;
}

async function proxy(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path = [] } = await params;
  const joinedPath = path.join('/');

  if (joinedPath === 'auth/logout') {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, '', { ...cookieOptions(), maxAge: 0 });
    return response;
  }

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  const accept = request.headers.get('accept');
  if (contentType) headers.set('content-type', contentType);
  if (accept) headers.set('accept', accept);

  const session = request.cookies.get(COOKIE_NAME)?.value;
  if (session) {
    headers.set('authorization', `Bearer ${session}`);
  }

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  const upstream = await fetch(upstreamUrl(path, request.nextUrl.search), {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
  });

  if (joinedPath === 'auth/login' && upstream.ok) {
    const payload = await upstream.json();
    const token = payload.token;
    delete payload.token;
    const response = NextResponse.json(payload, { status: upstream.status });
    if (token) response.cookies.set(COOKIE_NAME, token, cookieOptions());
    return response;
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) responseHeaders.set('content-type', upstreamContentType);
  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context.params);
}
