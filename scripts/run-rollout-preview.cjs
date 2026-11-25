// Run a compiled local preview against demo Firebase and controlled providers.
const { spawn } = require('node:child_process');
const path = require('node:path');
const command = process.argv[2];
if (!['build', 'start'].includes(command)) throw Error('Use build or start.');
const env = { ...process.env, ...require('./emulator-env.cjs'), ...require('../config/early-access-rollout.json'),
  EARLY_ACCESS_EXISTING_BEFORE: '2026-10-13T17:32:00.000Z',
  NOTIFICATION_UNSUBSCRIBE_SECRET: 'isolated-rollout-signing-secret-123456789',
  INVITATION_SIGNING_SECRET: 'isolated-rollout-signing-secret-123456789',
  EARLY_ACCESS_EMAILS_ENABLED: 'false', NOTIFICATION_EMAILS_ENABLED: 'false',
  GOOGLE_REDIRECT_URI: 'http://127.0.0.1:3100/gsc-callback', NEXT_PUBLIC_GA_MEASUREMENT_ID: '',
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: command === 'start' ? `--require=${path.resolve(__dirname, '../tests/fixtures/rollout-providers.cjs')}` : '',
};
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), command,
  ...(command === 'start' ? ['--hostname', '127.0.0.1', '--port', '3100'] : [])], { env, stdio: 'inherit' });
console.log(`ROLLOUT_${command.toUpperCase()}_PID=${child.pid}`);
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
child.on('exit', code => { process.exitCode = code ?? 0; });
