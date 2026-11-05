'use strict';

/**
 * 启动器。
 *
 * 为什么不直接写 "start": "electron ."：
 * 有些 IDE 的集成终端会注入 ELECTRON_RUN_AS_NODE=1，
 * 这会让 Electron 退化成纯 Node 运行，主进程里 require('electron')
 * 拿不到 app，报 "Cannot read properties of undefined"。
 * 这里显式清掉它，保证任何终端里 npm start 都能正常起。
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
