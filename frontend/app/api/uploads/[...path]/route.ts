import { NextRequest, NextResponse } from 'next/server';
type RouteContext = { params: Promise<{ path: string[] }> };

function backendRoot() {
  const apiBase = process.env.SERVER_API_BASE || process.env.OPERATIONS_API_BASE || 'http://127.0.0.1:8000/api';
  return apiBase.replace(/\/api\/?$/, '');
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { path: parts = [] } = await context.params;
  const path = parts.map(encodeURIComponent).join('/');
  const upstream = await fetch(`${backendRoot()}/uploads/${path}${request.nextUrl.search}`, { cache: 'no-store' });
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  return new NextResponse(await upstream.arrayBuffer(), { status: upstream.status, headers });
}
