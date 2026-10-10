export async function GET() { return Response.json({ error: 'Legacy maintenance endpoint disabled.' }, { status: 410 }); }
export const POST = GET;
