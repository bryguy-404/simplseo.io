const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './tests/browser', timeout: 90000, workers: 1, use: { baseURL: 'http://127.0.0.1:3100', headless: true, screenshot: 'only-on-failure' }, reporter: 'list' });
