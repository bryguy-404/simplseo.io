// Preserve the existing first-generation endpoints and scheduled trigger.
const functions = require('firebase-functions/v1');
const pubsub = require('firebase-functions/v1/pubsub');

// Leave deployed URLs explicitly retired until callers have been removed.
for (const name of ['updateAllMissingPostStats', 'updateDocumentWithGscData', 'listImplementedSeoTips', 'testPostStatsUpdate']) {
  exports[name] = functions.https.onRequest((req, res) => res.status(410).json({ error: 'Legacy maintenance endpoint disabled.' }));
}

// The old scheduler mixed rolling windows and issued unsupported success/pivot
// labels. The authenticated Vercel collector now owns dated observations. Keep
// this scheduled export inert so a deployment cannot leave its old writer alive.
exports.checkSeoTipProgress = pubsub
  .schedule('every day 01:00')
  .timeZone('America/New_York')
  .onRun(async () => null);
