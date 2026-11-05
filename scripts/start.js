'use strict';

/**
 * 启动器。不用 "electron ." 是因为有些终端会注入 ELECTRON_RUN_AS_NODE=1，
 * 这会让 Electron 退化成纯 Node，主进程拿不到 app。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const passthrough = process.argv.slice(2);

if (passthrough.includes('--spine-test')) {
  env.PET_SPINE_TEST = '1';
}

if (passthrough.includes('--voice-label')) {
  env.PET_VOICE_LABEL = '1';
}

const child = spawn(electronBinary, [path.join(__dirname, '..'), ...passthrough], {
  stdio: 'inherit',
  env,
});

child.on('close', (code) => process.exit(code ?? 0));
