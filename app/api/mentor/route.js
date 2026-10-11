import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { RequestError } from '../../lib/server/requestAuth';
import { mentorFeatures } from '../../lib/server/mentorFeature';
import { createMentorConversation, mutateMentorConversation, readMentorConversation, readMentorTurn, readMentorWorkspace, sendMentorTurn } from '../../lib/server/mentorConversations';
import { readMentorAccountScope, readMentorWorkspaceContext, runMentorCheck } from '../../lib/server/mentorEvidence';
import { generateMentorAnswer } from '../../lib/server/mentorGeneration';

export const maxDuration = 150;
const headers = { 'Cache-Control': 'private, no-store' };
const reply = result => Response.json({ success: true, ...result }, { headers });

export const GET = authenticatedRoute(async request => {
  const params = new URL(request.url).searchParams, uid = params.get('userId'), action = params.get('action') || 'workspace';
  if (action === 'workspace') {
    const result = await readMentorWorkspace(uid, { cursor: params.get('cursor'), search: params.get('search') || '' });
    return reply({ ...result, ...await readMentorWorkspaceContext(uid, result.scope) });
  }
  if (action === 'conversation') return reply(await readMentorConversation(uid, params.get('conversationId'), { cursor: params.get('cursor') }));
  if (action === 'turn') return reply(await readMentorTurn(uid, params.get('conversationId'), params.get('turnId')));
  throw new RequestError('Unknown mentor read.');
});

export const POST = authenticatedRoute(async request => {
  const input = await request.json(), uid = input.userId;
  if (input.action === 'create') return reply(await createMentorConversation(uid, input));
  if (['rename', 'delete', 'activate'].includes(input.action)) return reply(await mutateMentorConversation(uid, input));
  if (input.action === 'send') {
    const result = await sendMentorTurn(uid, { ...input, signal: request.signal }, generateMentorAnswer);
    return Response.json({ success: true, ...result }, { headers, status: result.turn?.status === 'pending' ? 202 : 200 });
  }
  if (input.action === 'check') {
    if (!mentorFeatures(uid).enabled) throw new RequestError('Mentor checks are paused. Your saved information is unchanged.', 409);
    const scope = await readMentorAccountScope(uid);
    const check = await runMentorCheck(uid, scope, { kind: input.kind, pageUrl: input.selection?.pageUrl, cycleId: input.selection?.cycleId },
      { deadline: Date.now() + 60000, signal: request.signal, requestId: input.requestId });
    return reply({ check });
  }
  throw new RequestError('Unknown mentor action.');
});
