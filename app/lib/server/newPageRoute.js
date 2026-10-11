import { authenticatedRoute } from './authenticatedRoute';

export function newPageRoute(handler) {
  const authenticated = authenticatedRoute(async request => {
    try {
      const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json();
      const result = await handler(body.userId, body, request);
      return Response.json(result);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      return Response.json({ error: status === 500 ? 'Unable to complete this check. Your saved work is unchanged. Try again.' : error.message,
        ...(error.code === 'confirm_redirect' ? { code: error.code, destination: error.destination } : {}) }, { status });
    }
  });
  return async request => {
    const response = await authenticated(request);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
}
