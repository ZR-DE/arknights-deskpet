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
let headBone = null;

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

    headBone = findHeadBone(spine);

    // 必须先播上动画再量尺寸：初始姿态和待机姿态的包围盒差很多
    currentAnim = null;
    play('idle', true);
    hitRect = layout();

    window.__diag = {
      stage: 'ready',
      animations: animationNames,
      headBone: headBone ? headBone.data.name : null,
      headTopOffset,
      hitRect: hitRect
        ? {
            x: Math.round(hitRect.x),
            y: Math.round(hitRect.y),
            w: Math.round(hitRect.w),
            h: Math.round(hitRect.h),
          }
        : null,
    };

    // 等 pixi 真正画出一帧再量头顶，否则画布还是空的
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        measureHeadTop();
        window.__diag.headTopOffset = headTopOffset;
        const a = bubbleAnchor();
        window.__diag.headAnchor = { x: Math.round(a.x), y: Math.round(a.y) };
      })
    );

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
 * 气泡：挂在她头上，而不是挂在窗口上
 * ------------------------------------------------------------------ */

/** 头骨查找：优先精确名，退而求其次找任意含 head 的骨骼 */
function findHeadBone(instance) {
  const sk = instance.skeleton;
  const exact = ['F_Head_I', 'Head', 'head', 'Bip01 Head'];
  for (const name of exact) {
    const bone = sk.findBone ? sk.findBone(name) : null;
    if (bone) return bone;
  }
  const bones = sk.bones || [];
  return bones.find((b) => /head/i.test(b.data.name)) || null;
}

/** 气泡底边离她头顶的留白 */
const HEAD_MARGIN = 7;

/**
 * 头骨锚点 -> 可见头顶的距离。
 *
 * 为什么不能直接用一个比例：这份骨架的头骨 F_Head_I 落在眼睛高度，
 * 离可见头顶差了 120px（角色越高差得越多），换角色就完全不准。
 * 所以启动后直接扫一遍渲染结果里最上面那个不透明像素，
 * 用「头顶 - 头骨」的实测差值当固定偏移。之后头怎么浮动，气泡都跟着。
 */
let headTopOffset = null;

function measureHeadTop() {
  if (!headBone || !spine) return;

  // 不能直接从 app.view 读像素：WebGL 绘图缓冲在合成后就被清了，
  // drawImage 拿到的是全透明。extract 会把目标单独渲染进一张纹理，绕开这个问题。
  let shot;
  try {
    shot = app.renderer.extract.canvas(spine);
  } catch (err) {
    console.log('[scan] extract failed: ' + ((err && err.message) || err));
    return;
  }
  if (!shot || typeof shot.getContext !== 'function') return;

  const tw = shot.width;
  const th = shot.height;
  if (!tw || !th) return;

  const ctx = shot.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const px = ctx.getImageData(0, 0, tw, th).data;

  const bounds = spine.getBounds();
  if (!bounds.width || !bounds.height) return;

  // 纹理像素坐标 -> 舞台坐标
  const kx = bounds.width / tw;
  const ky = bounds.height / th;

  const head = spine.toGlobal(new PIXI.Point(headBone.worldX, headBone.worldY));
  const cx = (head.x - bounds.x) / kx;

  // 只在头骨左右一条竖带里找，避开左边漂浮的笔记本
  const band = 38 / kx;
  const x0 = Math.max(0, Math.round(cx - band));
  const x1 = Math.min(tw, Math.round(cx + band));

  let firstRow = -1;
  for (let y = 0; y < th && firstRow < 0; y++) {
    for (let x = x0; x < x1; x++) {
      if (px[(y * tw + x) * 4 + 3] > 40) {
        firstRow = y;
        break;
      }
    }
  }

  if (firstRow >= 0) {
    const topY = bounds.y + firstRow * ky;
    headTopOffset = topY - head.y - HEAD_MARGIN;
  }
}

function bubbleAnchor() {
  if (headBone && spine) {
    const p = spine.toGlobal(new PIXI.Point(headBone.worldX, headBone.worldY));
    // 还没量到头顶就先用一个保守估算，量到后自动替换
    const lift = headTopOffset === null ? 34 : headTopOffset;
    return { x: p.x, y: p.y + lift };
  }
  // 没有头骨就退回角色包围盒顶部中点，总比锚在窗口上强
  if (hitRect) return { x: hitRect.x + hitRect.w / 2, y: hitRect.y };
  return { x: WIDTH / 2, y: 70 };
}

let bubbleVisible = false;
let smoothX = null;
let smoothY = null;

function placeBubble(snap = false) {
  const a = bubbleAnchor();
  if (snap || smoothX === null) {
    smoothX = a.x;
    smoothY = a.y;
  } else {
    // 平滑跟随：点头、换动作时头部位置会突变，直接贴过去会让气泡跳
    smoothX += (a.x - smoothX) * 0.3;
    smoothY += (a.y - smoothY) * 0.3;
  }

  const w = bubbleEl.offsetWidth;
  const h = bubbleEl.offsetHeight;
  const half = w / 2;

  // 水平方向别让气泡跑出窗口
  const x = Math.min(Math.max(smoothX, half + 6), WIDTH - half - 6);
  // 顶部空间不够就往下压，宁可压到她也不要出框
  const y = Math.max(smoothY, h + 4);

  bubbleEl.style.left = `${Math.round(x)}px`;
  bubbleEl.style.top = `${Math.round(y)}px`;

  // 气泡被窗口挤开多少，尾巴就补回多少，始终指着她
  const tail = Math.min(Math.max(smoothX - x + half, 12), Math.max(w - 12, 12));
  bubbleEl.style.setProperty('--tail-x', `${Math.round(tail)}px`);
}

// 30fps 下每 3 帧算一次（10Hz）：头部浮动很慢，每帧写样式纯属浪费
let bubbleTick = 0;
app.ticker.add(() => {
  if (!bubbleVisible) return;
  if (++bubbleTick % 3) return;
  placeBubble();
});

// 换显示器 / 改缩放时头顶位置会变，重新量一次
window.addEventListener('resize', () => {
  headTopOffset = null;
  requestAnimationFrame(() => requestAnimationFrame(measureHeadTop));
});

/* ------------------------------------------------------------------ *
 * 气泡文本
 * ------------------------------------------------------------------ */
let bubbleTimer = null;

function hideBubble() {
  bubbleVisible = false;
  bubbleEl.classList.remove('show');
}

function say(text, duration = 6000) {
  if (!text) return;
  bubbleText.textContent = text;
  bubbleVisible = true;
  // 先按新文本量一次宽度再定位（snap），避免气泡先出现在旧位置再滑过来
  placeBubble(true);
  bubbleEl.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, duration);
}

// 调试钩子：自动化验证用，也可以从 DevTools 手动触发动画
window.__petDebug = {
  play,
  playOnce,
  say,
  state: () => ({
    anchor: bubbleAnchor(),
    head: headBone ? { x: Math.round(headBone.worldX), y: Math.round(headBone.worldY) } : null,
    rect: (() => {
      const r = bubbleEl.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    })(),
  }),
};

/* ------------------------------------------------------------------ *
 * 互动
 * ------------------------------------------------------------------ */let lastInteract = Date.now();
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
    clearTimeout(bubbleTimer);
    hideBubble();
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
    if (!document.hidden && quiet > 40000 && !bubbleVisible) {
      say(window.PET_PICK(isLateNight() ? L.lateNight : L.idle), 6000);
      if (isLateNight()) play('sleep', true);
    }
    scheduleIdle();
  }, wait);
}
