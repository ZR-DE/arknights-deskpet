'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'companion.json';
const DAY_MS = 24 * 60 * 60 * 1000;

function storePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(fromKey, toKey) {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return null;
  }
}

function write(data) {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 每次启动调一次：更新累计天数、连续天数，并告诉调用方今天是不是第一次见面 */
function touch() {
  const now = new Date();
  const today = dayKey(now);
  let data = read();
  let isFirstToday = false;

  if (!data || !data.lastDay) {
    data = {
      firstMetAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      lastDay: today,
      days: 1,
      streak: 1,
      clicks: 0,
      minutesTogether: 0,
    };
    isFirstToday = true;
  } else if (data.lastDay !== today) {
    const gap = daysBetween(data.lastDay, today);
    data.days = (data.days || 1) + 1;
    data.streak = gap === 1 ? (data.streak || 1) + 1 : 1;
    data.lastDay = today;
    data.lastSeenAt = now.toISOString();
    isFirstToday = true;
  } else {
    data.lastSeenAt = now.toISOString();
  }

  write(data);
  return { ...data, today, isFirstToday };
}

function addClick() {
  const data = read();
  if (!data) return null;
  data.clicks = (data.clicks || 0) + 1;
  data.lastClickAt = new Date().toISOString();
  write(data);
  return data.clicks;
}

function addTogetherMinutes(minutes) {
  const data = read();
  if (!data || !Number.isFinite(minutes) || minutes <= 0) return;
  data.minutesTogether = Math.round((data.minutesTogether || 0) + minutes);
  write(data);
}

module.exports = { touch, addClick, addTogetherMinutes, read, storePath };
