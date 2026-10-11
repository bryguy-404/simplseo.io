import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { RequestError } from '../../../lib/server/requestAuth';
import { mutateMentorConversation, readMentorConversation } from '../../../lib/server/mentorConversations';

const headers = { 'Cache-Control': 'private, no-store' };
export const GET = authenticatedRoute(async (request, context) => {
  const { id } = await context.params, params = new URL(request.url).searchParams;
  return Response.json({ success: true, ...await readMentorConversation(params.get('userId'), id, { cursor: params.get('cursor') }) }, { headers });
});
export const PUT = authenticatedRoute(async (request, context) => {
  const { id } = await context.params, input = await request.json();
  if ('messages' in input || input.action === 'addMessage' || input.action === 'cornerEnd') throw new RequestError('Chat has been upgraded. Reload to continue; saved conversations are preserved.', 410);
  return Response.json({ success: true, ...await mutateMentorConversation(input.userId, { ...input, conversationId: id }) }, { headers });
});
export const DELETE = authenticatedRoute(async (request, context) => {
  const { id } = await context.params, input = await request.json();
  return Response.json({ success: true, ...await mutateMentorConversation(input.userId, { ...input, action: 'delete', conversationId: id }) }, { headers });
});
