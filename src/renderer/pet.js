'use strict';

const petEl = document.getElementById('pet');
const bodyLayer = document.getElementById('layer-body');
const eyesLayer = document.getElementById('layer-eyes');
const bubbleEl = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');

const PLACEHOLDER = '../../assets/placeholder-character.svg';
const L = window.PET_LINES;

/* ------------------------------------------------------------------ *
 * 素材：找不到真素材就退回占位图，保证任何时候都能启动
 *
 * 注意：本地 file:// 加载失败往往在脚本执行之前就完成了，
 * 只挂 error 监听会漏掉，所以加载完后还要主动查一次 naturalWidth。
 * ------------------------------------------------------------------ */
function usePlaceholder() {
  if (bodyLayer.dataset.fallback === '1') return;
  bodyLayer.dataset.fallback = '1';
  bodyLayer.src = PLACEHOLDER;
}

bodyLayer.addEventListener('error', usePlaceholder);

window.addEventListener('load', () => {
  if (!bodyLayer.complete || bodyLayer.naturalWidth === 0) usePlaceholder();
  if (!eyesLayer.complete || eyesLayer.naturalWidth === 0) eyesLayer.classList.add('missing');
});

/* ------------------------------------------------------------------ *
 * 命中检测：只让角色轮廓内的区域吃掉鼠标，其余交还桌面
 * ------------------------------------------------------------------ */
let cursorInside = null;

function pointInPet(x, y) {
  const r = petEl.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;

  const nx = (x - r.left) / r.width;
  const ny = (y - r.top) / r.height;

  // 顶部收窄（头/肩），底部略微收窄，中间最宽。
  // 这是个粗糙的轮廓近似，比纯矩形少抓很多空白区。
  const offCenter = Math.abs(nx - 0.5) * 2;
  const topTaper = ny < 0.16 ? ((0.16 - ny) / 0.16) * 0.55 : 0;
  const bottomTaper = ny > 0.94 ? ((ny - 0.94) / 0.06) * 0.15 : 0;
  return offCenter <= 1 - Math.max(topTaper, bottomTaper) - 0.02;
}

function updateHit(x, y) {
  const inside = pointInPet(x, y);
  if (inside === cursorInside) return;
  cursorInside = inside;
  window.pet.hit(inside);
}

document.addEventListener('mousemove', (e) => updateHit(e.clientX, e.clientY));
document.addEventListener('mouseleave', () => {
  if (cursorInside === false) return;
  cursorInside = false;
  window.pet.hit(false);
});
window.addEventListener('blur', () => {
  if (cursorInside === false) return;
  cursorInside = false;
  window.pet.hit(false);
});

/* ------------------------------------------------------------------ *
 * 气泡
 * ------------------------------------------------------------------ */
let bubbleTimer = null;

function say(text, duration = 6000) {
  if (!text) return;
  bubbleText.textContent = text;
  bubbleEl.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), duration);
}

/* ------------------------------------------------------------------ *
 * 互动：拖拽 vs 点击
 * ------------------------------------------------------------------ */
let lastInteract = Date.now();
let pointerActive = false;
let dragStarted = false;
let downX = 0;
let downY = 0;

function onTap() {
  lastInteract = Date.now();
  window.pet.click();

  petEl.classList.remove('tap');
  void petEl.offsetWidth;
  petEl.classList.add('tap');

  say(window.PET_PICK(L.click), 3800);
}

petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerActive = true;
  dragStarted = false;
  downX = e.screenX;
  downY = e.screenY;
  try {
    petEl.setPointerCapture(e.pointerId);
  } catch {
    /* 忽略 */
  }
  window.pet.dragBegin(e.screenX, e.screenY);
  e.preventDefault();
});

window.addEventListener('pointermove', (e) => {
  if (!pointerActive) return;
  const dx = e.screenX - downX;
  const dy = e.screenY - downY;

  if (!dragStarted && Math.hypot(dx, dy) > 5) {
    dragStarted = true;
    petEl.classList.add('dragging');
    bubbleEl.classList.remove('show');
    clearTimeout(bubbleTimer);
  }
  if (dragStarted) window.pet.dragMove(e.screenX, e.screenY);
});

window.addEventListener('pointerup', (e) => {
  if (!pointerActive) return;
  pointerActive = false;
  try {
    petEl.releasePointerCapture(e.pointerId);
  } catch {
    /* 忽略 */
  }

  if (dragStarted) {
    dragStarted = false;
    petEl.classList.remove('dragging');
    window.pet.dragEnd();
    lastInteract = Date.now();
  } else {
    onTap();
  }
});

/* ------------------------------------------------------------------ *
 * 开场问候：今天第一次见面，她要知道这是第几天
 * ------------------------------------------------------------------ */
function greetLater(state) {
  if (!state || !state.isFirstToday) {
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 5) say(window.PET_PICK(L.lateNight), 6000);
    return;
  }

  if (state.days <= 1) {
    say(window.PET_PICK(L.firstMeet), 7000);
  } else if (state.streak >= 2) {
    say(window.PET_PICK(L.daily, [state.days, state.streak]), 7000);
  } else {
    say(window.PET_PICK(L.backAfterAway), 7000);
  }
}

setTimeout(async () => {
  let state = null;
  try {
    state = await window.pet.companion();
  } catch {
    /* 主进程没给，就不说话 */
  }
  greetLater(state);
}, 900);

/* ------------------------------------------------------------------ *
 * 闲置：她试探你还在不在
 * ------------------------------------------------------------------ */
function scheduleIdle() {
  const wait = 45000 + Math.random() * 70000;
  setTimeout(() => {
    const quiet = Date.now() - lastInteract;
    const visible = !document.hidden;
    if (visible && quiet > 40000 && !bubbleEl.classList.contains('show')) {
      const hour = new Date().getHours();
      const late = hour >= 23 || hour < 5;
      say(window.PET_PICK(late ? L.lateNight : L.idle), 6000);
    }
    scheduleIdle();
  }, wait);
}

scheduleIdle();
