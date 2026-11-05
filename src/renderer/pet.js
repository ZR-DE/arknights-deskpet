'use strict';

/**
 * 主渲染层：pixi + pixi-spine。
 *
 * 想换角色只改下面这块配置——加载逻辑跟具体是谁无关。
 * 动画名按素材实际内容填，缺失的会退回 idle，不会崩。
 */

const CHARACTER = {
  skeleton: 'pet://character/build_char_4228_closur.skel',
  anim: {
    idle: 'Default',
    interact: 'Interact',
    move: 'Move',
    relax: 'Relax',
    sit: 'Sit',
    sleep: 'Sleep',
  },
};

const WIDTH = window.innerWidth;
const HEIGHT = window.innerHeight;

const bubbleEl = document.getElementById('bubble');
const bubbleText = document.getElementById('bubble-text');
const L = window.PET_LINES;

/* ------------------------------------------------------------------ *
 * pixi
 * ------------------------------------------------------------------ */
const app = new PIXI.Application({
  width: WIDTH,
  height: HEIGHT,
  backgroundAlpha: 0,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  preserveDrawingBuffer: true,
});

app.ticker.maxFPS = 30;
app.view.id = 'pet-canvas';
document.body.appendChild(app.view);

let spine = null;
let animationNames = [];
let hitRect = null;
let currentAnim = null;

/* ------------------------------------------------------------------ *
 * 动画
 * ------------------------------------------------------------------ */
function play(name, loop = true) {
  if (!spine) return;
  const wanted = CHARACTER.anim[name] || name;
  const actual = animationNames.includes(wanted) ? wanted : CHARACTER.anim.idle;

  if (currentAnim === actual && loop) return;
  currentAnim = actual;
  spine.state.setAnimation(0, actual, loop);
}

function toIdle() {
  currentAnim = null;
  play('idle', true);
}

function playOnce(name) {
  if (!spine) return;
  const wanted = CHARACTER.anim[name] || name;
  if (!animationNames.includes(wanted)) return;
  currentAnim = wanted;
  spine.state.setAnimation(0, wanted, false);
  spine.state.addAnimation(0, CHARACTER.anim.idle, true, 0);
}

/* ------------------------------------------------------------------ *
 * 加载与定位
 * ------------------------------------------------------------------ */
function layout() {
  spine.scale.set(1);
  spine.update(0.016);

  const base = spine.getLocalBounds();
  if (!base.width || !base.height) return null;

  const scale = Math.min((WIDTH * 0.96) / base.width, (HEIGHT * 0.96) / base.height);
  spine.scale.set(scale);

  // 水平居中、脚底贴住窗口下沿
  spine.x = WIDTH / 2 - (base.x + base.width / 2) * scale;
  spine.y = HEIGHT - 2 - (base.y + base.height) * scale;

  return {
    x: spine.x + base.x * scale,
    y: spine.y + base.y * scale,
    w: base.width * scale,
    h: base.height * scale,
  };
}

(async () => {
  try {
    const resource = await PIXI.Assets.load(CHARACTER.skeleton);
    const spineData = resource && resource.spineData ? resource.spineData : resource;

    if (!spineData || !spineData.animations) {
      throw new Error('资源不是 Spine 数据');
    }

    animationNames = spineData.animations.map((a) => a.name);
    spine = new PIXI.spine.Spine(spineData);
    app.stage.addChild(spine);

    // 必须先播上动画再量尺寸：初始姿态和待机姿态的包围盒差很多
    currentAnim = null;
    play('idle', true);
    hitRect = layout();

    window.__diag = {
      stage: 'ready',
      animations: animationNames,
      hitRect: hitRect
        ? {
            x: Math.round(hitRect.x),
            y: Math.round(hitRect.y),
            w: Math.round(hitRect.w),
            h: Math.round(hitRect.h),
          }
        : null,
    };

    spine.state.addListener({
      complete: (entry) => {
        if (!entry || !entry.animation) return;
        if (entry.animation.name !== CHARACTER.anim.idle) toIdle();
      },
    });

    startGreeting();
    scheduleIdle();
  } catch (err) {
    console.error('[spine] 加载失败', err);
    setTimeout(() => say('……我好像，站不起来了。', 9000), 600);
  }
})();

/* ------------------------------------------------------------------ *
 * 命中检测：只在角色矩形内吃掉鼠标
 * ------------------------------------------------------------------ */
let cursorInside = null;

function pointInPet(x, y) {
  if (!hitRect) return false;
  const { x: rx, y: ry, w, h } = hitRect;
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;

  const nx = (x - rx) / w;
  const ny = (y - ry) / h;

  // 顶部（头和肩）比底部窄，四角让给桌面
  const offCenter = Math.abs(nx - 0.5) * 2;
  const topTaper = ny < 0.2 ? ((0.2 - ny) / 0.2) * 0.5 : 0;
  const bottomTaper = ny > 0.95 ? ((ny - 0.95) / 0.05) * 0.12 : 0;
  return offCenter <= 0.99 - Math.max(topTaper, bottomTaper);
}

function updateHit(x, y) {
  const inside = pointInPet(x, y);
  if (inside === cursorInside) return;
  cursorInside = inside;
  window.pet.hit(inside);
}

function releaseMouse() {
  if (cursorInside === false) return;
  cursorInside = false;
  window.pet.hit(false);
}

document.addEventListener('mousemove', (e) => updateHit(e.clientX, e.clientY));
document.addEventListener('mouseleave', releaseMouse);
window.addEventListener('blur', releaseMouse);

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
 * 互动
 * ------------------------------------------------------------------ */
let lastInteract = Date.now();
let pointerActive = false;
let dragStarted = false;
let downX = 0;
let downY = 0;

function onTap() {
  lastInteract = Date.now();
  window.pet.click();

  playOnce('interact');
  say(window.PET_PICK(L.click), 3800);
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !pointInPet(e.clientX, e.clientY)) return;

  pointerActive = true;
  dragStarted = false;
  downX = e.screenX;
  downY = e.screenY;
  window.pet.dragBegin(e.screenX, e.screenY);
  e.preventDefault();
});

window.addEventListener('pointermove', (e) => {
  if (!pointerActive) return;
  const dx = e.screenX - downX;
  const dy = e.screenY - downY;

  if (!dragStarted && Math.hypot(dx, dy) > 5) {
    dragStarted = true;
    bubbleEl.classList.remove('show');
    clearTimeout(bubbleTimer);
    play('move', true);
  }
  if (dragStarted) window.pet.dragMove(e.screenX, e.screenY);
});

window.addEventListener('pointerup', () => {
  if (!pointerActive) return;
  pointerActive = false;

  if (dragStarted) {
    dragStarted = false;
    window.pet.dragEnd();
    lastInteract = Date.now();
    toIdle();
  } else {
    onTap();
  }
});

/* ------------------------------------------------------------------ *
 * 开场问候
 * ------------------------------------------------------------------ */
function greetLater(state) {
  if (!state || !state.isFirstToday) {
    if (isLateNight()) say(window.PET_PICK(L.lateNight), 6000);
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

async function startGreeting() {
  let state = null;
  try {
    state = await window.pet.companion();
  } catch {
    /* 主进程没给，就不说话 */
  }
  setTimeout(() => greetLater(state), 900);
}

/* ------------------------------------------------------------------ *
 * 闲置
 * ------------------------------------------------------------------ */
function isLateNight() {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

function scheduleIdle() {
  const wait = 45000 + Math.random() * 70000;
  setTimeout(() => {
    const quiet = Date.now() - lastInteract;
    if (!document.hidden && quiet > 40000 && !bubbleEl.classList.contains('show')) {
      say(window.PET_PICK(isLateNight() ? L.lateNight : L.idle), 6000);
      if (isLateNight()) play('sleep', true);
    }
    scheduleIdle();
  }, wait);
}
