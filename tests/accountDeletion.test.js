import { describe, expect, it, vi } from 'vitest';
import { accountHash, deleteAccountFirestore, deleteAccountBigQuery } from '../app/lib/server/accountDeletion';

function deletionStore(initial) {
  const records = new Map(Object.entries(initial));
  const deleted = [];
  const ref = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`) });
  const collection = (path, filters = [], range = {}, maximum = Infinity) => ({
    doc: id => ref(`${path}/${id}`),
    where: (field, op, value) => collection(path, [...filters, [field, value]], range, maximum),
    orderBy: () => collection(path, filters, range, maximum),
    startAt: start => collection(path, filters, { ...range, start }, maximum),
    endBefore: end => collection(path, filters, { ...range, end }, maximum),
    limit: count => collection(path, filters, range, count),
    get: async () => {
      const docs = [...records].filter(([key, value]) => {
        if (!key.startsWith(`${path}/`) || key.split('/').length !== path.split('/').length + 1) return false;
        const id = key.split('/').at(-1);
        return filters.every(([field, target]) => value[field] === target) && (!range.start || id >= range.start) && (!range.end || id < range.end);
      }).slice(0, maximum).map(([key, value]) => ({ ref: ref(key), data: () => value }));
      return { docs, empty: docs.length === 0 };
    },
  });
  const db = { collection, recursiveDelete: vi.fn(async target => {
    deleted.push(target.path);
    for (const key of records.keys()) if (key === target.path || key.startsWith(`${target.path}/`)) records.delete(key);
  }) };
  return { db, records, deleted };
}

describe('account data deletion', () => {
  it('removes owned trees, hashed records, orphaned subcollections and legacy prefixes without another account', async () => {
    const hash = accountHash('alice');
    const otherHash = accountHash('bob');
    const store = deletionStore({
      'users/alice': { gscRefreshToken: 'private' },
      'users/alice/feedbackPrompt/timing': {},
      'users/alice/revampHistory/run/records/item': {},
      'users/bob': { keep: true },
      'onboarding/alice': {},
      'gscTokens/alice': {},
      'focusKeywords/alice': {},
      'siteCrawls/alice': {},
      'contentKeywordEdits/alice/edits/one': {},
      'skippedKeywords/alice/keywords/one': {},
      'createdContentOpportunities/alice/created/one': {},
      'progressJobs/alice': {},
      'progressJobs/user-alice': {},
      'progressJobs/daily-progress': { keep: true },
      'requestLimits/hashed-user-limit': { userId: 'alice' },
      'requestLimits/hashed-ip-limit': { keep: true },
      [`trainingEvents/${hash}/events/one`]: {},
      [`playbookStrategies/${hash}/strategies/one`]: {},
      [`conversationSummaries/${hash}/summaries/one`]: {},
      [`trainingEvents/${otherHash}/events/one`]: { keep: true },
      'implementedSeoTips/alice_legacy': {},
      'implementedSeoTips/random': { userId: 'alice' },
      'implementedSeoTips/alice_conflicting': { userId: 'bob', keep: true },
      'pageContentCache/alice/pages/one': {},
      'pageContentCache/alice_old': {},
      'seoMetaTitles/alice/titles/one': {},
      'seoMetaDescriptions/alice/descriptions/one': {},
      'seoMetaTitles/unknown-owner-url': { keep: true },
      'seoMetaTitles/owned-flat': { userId: 'alice' },
      'genericKeywordsCache/one': { userId: 'alice' },
      'conversations/one/messages/nested': {},
      'conversations/one': { userId: 'alice' },
      'contactMessages/one': { userId: 'alice' },
      'gscOAuthStates/one': { uid: 'alice' },
      'gscOAuthStates/two': { uid: 'bob', keep: true },
      'deletedUsers/alice': { email: 'old retained data' },
      'approvedUsers/alice@example.test': {},
      'accessRequests/one': { email: 'alice@example.test' },
      'invitationCodes/one': { email: 'alice@example.test' },
      'invitationCodes/two': { email: 'bob@example.test', keep: true },
    });
    const result = await deleteAccountFirestore(store.db, 'alice', 'Alice@Example.test');
    expect(result.deletedRoots).toBeGreaterThan(20);
    expect([...store.records.values()]).toEqual(expect.arrayContaining([{ keep: true }]));
    expect([...store.records.values()].every(value => value.keep === true)).toBe(true);
    expect(store.deleted.at(-1)).toBe('onboarding/alice');
    // Missing parents are still recursively deleted; retrying has no effect on other users.
    const remaining = [...store.records.keys()];
    await deleteAccountFirestore(store.db, 'alice', 'alice@example.test');
    expect([...store.records.keys()]).toEqual(remaining);
  });

  it('deletes more than one Firestore query batch', async () => {
    const store = deletionStore(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`conversations/${i}`, { userId: 'alice' }])));
    await deleteAccountFirestore(store.db, 'alice');
    expect(store.records.size).toBe(0);
  });

  it('propagates failures and keeps account context available for retry', async () => {
    const store = deletionStore({ 'users/alice': {}, 'onboarding/alice': {} });
    store.db.recursiveDelete.mockRejectedValueOnce(new Error('provider details containing credential'));
    await expect(deleteAccountFirestore(store.db, 'alice')).rejects.toThrow();
    expect(store.records.has('users/alice')).toBe(true);
    expect(store.records.has('onboarding/alice')).toBe(true);
  });

  it('rejects path injection before touching storage', async () => {
    const store = deletionStore({});
    await expect(deleteAccountFirestore(store.db, 'alice/other')).rejects.toThrow();
    expect(store.db.recursiveDelete).not.toHaveBeenCalled();
  });

  it('uses a parameterized hash for optional BigQuery deletion and rejects table injection', async () => {
    const client = { query: vi.fn() };
    await deleteAccountBigQuery(client, 'alice', { projectId: 'seo-project', dataset: 'training', table: 'events' });
    expect(client.query).toHaveBeenCalledWith({ query: 'DELETE FROM `seo-project.training.events` WHERE hashed_user_id = @hashedUserId', params: { hashedUserId: accountHash('alice') } });
    await expect(deleteAccountBigQuery(client, 'alice', { projectId: 'seo-project', dataset: 'training`; SELECT', table: 'events' })).rejects.toThrow();
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
