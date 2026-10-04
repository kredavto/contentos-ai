export function GET() {
  return Response.json({ status: 'ok', service: 'web', kind: 'liveness' }, { headers: { 'Cache-Control': 'no-store' } });
}
