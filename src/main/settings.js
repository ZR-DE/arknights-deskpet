'use strict';

/**
 * 偏好设置（不是"记忆"）。
 *
 * 和 memory.js 分开的理由：memory.js 记的是"我们认识多久了"，
 * 删掉它等于重新认识一个人；这里是"我上次穿了哪件衣服、有没有静音"，
 * 删掉只是回到默认值。两件事混在一个文件里，将来想只重置其中一个就做不到。
 *
 * 注意：不使用 electron 的 electron-store 之类的依赖，就一个 JSON。
 */

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'settings.json';

const DEFAULTS = {
  /** 当前时装 id，对应 src/shared/outfits.json */
  outfit: null,
  /** 静音：只显示文字，不出声 */
  muted: false,
};

function storePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

let cache = null;

function load() {
  if (cache) return cache;
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    data = null;
  }
  cache = { ...DEFAULTS, ...(data && typeof data === 'object' ? data : {}) };
  return cache;
}

function flush() {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(cache, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function get(key) {
  const data = load();
  return key in data ? data[key] : DEFAULTS[key];
}

function set(key, value) {
  load();
  if (cache[key] === value) return true;
  cache[key] = value;
  return flush();
}

module.exports = { get, set, storePath, DEFAULTS };
