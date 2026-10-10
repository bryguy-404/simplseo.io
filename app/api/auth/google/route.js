// Legacy unauthenticated token exchange is retired.
export async function GET() { return Response.json({ error: 'Reconnect Google from your signed-in account.' }, { status: 410 }); }
