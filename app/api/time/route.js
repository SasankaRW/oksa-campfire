export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';
export function GET() {
  return Response.json({ now: Date.now() }, { headers: { 'cache-control': 'no-store' } });
}
