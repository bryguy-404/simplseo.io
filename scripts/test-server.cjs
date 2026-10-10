const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env, ...require('./emulator-env.cjs') };
const child = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'dev', '-p', '3100', '-H', '127.0.0.1'], { env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));
