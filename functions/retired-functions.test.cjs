const assert = require('node:assert/strict');
const { test } = require('node:test');

// These handlers must remain safe to load and call without Firebase credentials.
// A demo ID also lets the real SDK build its scheduled-trigger manifest locally.
process.env.GCLOUD_PROJECT = 'demo-simpleseo';
const { getApps } = require('firebase-admin/app');
const handlers = require('./index.js');
const retiredHttpNames = [
  'updateAllMissingPostStats',
  'updateDocumentWithGscData',
  'listImplementedSeoTips',
  'testPostStatsUpdate',
];

test('the runtime update preserves all five first-generation deployment identities', () => {
  assert.equal(require('./package.json').engines.node, '22');
  assert.deepEqual(Object.keys(handlers).sort(), [...retiredHttpNames, 'checkSeoTipProgress'].sort());
  for (const name of retiredHttpNames) {
    assert.equal(handlers[name].__endpoint.platform, 'gcfv1');
    assert.deepEqual(handlers[name].__endpoint.httpsTrigger, {});
  }
  const endpoint = handlers.checkSeoTipProgress.__endpoint;
  assert.equal(endpoint.platform, 'gcfv1');
  assert.equal(endpoint.scheduleTrigger.schedule, 'every day 01:00');
  assert.equal(endpoint.scheduleTrigger.timeZone, 'America/New_York');
});

test('the updated SDK still serves explicit retirement responses for GET and POST', async () => {
  for (const name of retiredHttpNames) {
    for (const method of ['GET', 'POST']) {
      let status;
      let body;
      const response = {
        status(value) { status = value; return this; },
        json(value) { body = value; return this; },
      };
      await handlers[name]({ method }, response);
      assert.equal(status, 410, `${name} ${method}`);
      assert.deepEqual(body, { error: 'Legacy maintenance endpoint disabled.' });
    }
  }
  assert.equal(getApps().length, 0, 'retired handlers must not initialize a data client');
});

test('the updated scheduled wrapper remains inert', async () => {
  assert.equal(await handlers.checkSeoTipProgress.run({}), null);
  assert.equal(getApps().length, 0, 'the retired scheduler must not initialize a data client');
});
