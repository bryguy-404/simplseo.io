// Explicitly opt-in, local-only provider responses for the rollout smoke test.
// Load with NODE_OPTIONS=--require=...; never include this in a deployment.
if (process.env.SIMPLESEO_TEST_MODE !== '1' || process.env.FIREBASE_PROJECT_ID !== 'demo-simpleseo'
  || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Rollout fixtures require isolated emulators.');
const original = global.fetch;
global.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['localhost', '127.0.0.1'].includes(url.hostname)) return original(input, options);
  const reply = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.href === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'isolated-google-access-token',
    refresh_token: 'isolated-google-refresh-token', scope: 'https://www.googleapis.com/auth/webmasters.readonly', expires_in: 3600 });
  if (url.href === 'https://searchconsole.googleapis.com/webmasters/v3/sites') return reply({
    siteEntry: Array.from({ length: 15 }, (_, index) => ({ siteUrl: `https://studio-${index + 1}.example.test/`, permissionLevel: 'siteOwner' })),
  });
  if (url.hostname === 'searchconsole.googleapis.com' && url.pathname.endsWith('/searchAnalytics/query')) return reply({ rows: [] });
  if (url.hostname === 'searchconsole.googleapis.com' && url.pathname.endsWith('/urlInspection/index:inspect')) return reply({
    inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'No data available' } },
  });
  throw Error(`Unconfigured external request in rollout fixture: ${url.origin}${url.pathname}`);
};
