import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { RequestError } from '../../lib/server/requestAuth';
import { createMentorConversation, readMentorWorkspace } from '../../lib/server/mentorConversations';

const headers = { 'Cache-Control': 'private, no-store' };
export const GET = authenticatedRoute(async request => {
  const params = new URL(request.url).searchParams;
  return Response.json({ success: true, ...await readMentorWorkspace(params.get('userId'), { search: params.get('search'), cursor: params.get('cursor') }) }, { headers });
});
export const POST = authenticatedRoute(async request => {
  const input = await request.json();
  if ('messages' in input) throw new RequestError('Chat has been upgraded. Reload to continue; saved conversations are preserved.', 410);
  return Response.json({ success: true, ...await createMentorConversation(input.userId, input) }, { headers });
});
