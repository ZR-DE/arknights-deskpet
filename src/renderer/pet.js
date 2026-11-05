'use strict';

/**
 * 主渲染层：pixi + pixi-spine。
 *
 * 想换角色只改 character.js——加载逻辑跟具体是谁无关。
 */

const CHARACTER = window.PET_CHARACTER;

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
/** 窗口顶部留给气泡的高度，角色只在下面这段里排 */
const BUBBLE_RESERVE = 110;

function layout() {
  spine.scale.set(1);
  spine.update(0.016);

  const base = spine.getLocalBounds();
  if (!base.width || !base.height) return null;

  const availH = HEIGHT - BUBBLE_RESERVE;
  const scale = Math.min((WIDTH * 0.96) / base.width, (availH * 0.96) / base.height);
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
      hitRect: hitRect
        ? {
            x: Math.round(hitRect.x),
            y: Math.round(hitRect.y),
            w: Math.round(hitRect.w),
            h: Math.round(hitRect.h),
          }
        : null,
    };

    // 等 pixi 真正画出一帧再量，否则画布还是空的
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        measureTopProfile();
        const a = bubbleAnchor();
        window.__diag.headAnchor = { x: Math.round(a.x), y: Math.round(a.y) };
        window.__diag.topProfile = topProfile ? topProfile.topY.length : 0;
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
    startVoice();
  } catch (err) {
    console.error('[spine] 加载失败', err);
    setTimeout(() => say('……我好像，站不起来了。', 9000), 600);
    startVoice();
  }
})();

/**
 * 语音不阻塞启动：角色先站上去，几十兆的解码丢到后台慢慢做。
 * 解不出来也不影响任何功能，只是点她不出声。
 */
async function startVoice() {
  try {
    const state = await window.PET_VOICE.init();
    if (window.__diag) {
      window.__diag.voice = state.ready
        ? { lines: window.PET_VOICE.count }
        : { off: window.PET_VOICE.reason };
    }
  } catch (err) {
    console.error('[voice] init failed', err);
    return;
  }

  const muted = await window.pet.isMuted().catch(() => false);
  window.PET_VOICE.setMuted(muted);
  window.pet.onMuteChanged((value) => window.PET_VOICE.setMuted(value));
}

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
 * 每列的最高不透明像素（舞台坐标）。
 *
 * 为什么不能直接用一个比例，也不能只扫头骨左右一条窄带：
 * - 头骨落在眼睛高度，离可见头顶差 150px，换角色就完全不准
 * - 只扫窄带会漏掉宽的东西——阿米娅的兔耳在头骨两侧很远，
 *   窄带里只有头发，气泡就压到耳朵上了
 *
 * 所以扫出整张图的「每列最高点」剖面，再按气泡实际覆盖的宽度取最小值：
 * 气泡有多宽，就查它自己会盖住的那一段，永远压不到人。
 */
let topProfile = null;

function measureTopProfile() {
  if (!spine) return;

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

  const topY = new Float32Array(tw).fill(Infinity);
  for (let x = 0; x < tw; x++) {
    for (let y = 0; y < th; y++) {
      if (px[(y * tw + x) * 4 + 3] > 40) {
        topY[x] = bounds.y + y * ky;
        break;
      }
    }
  }

  topProfile = { topY, kx, originX: bounds.x, fallbackY: bounds.y };
}

/** 舞台横坐标区间 [x0, x1] 内最高的不透明像素；没有内容返回 null */
function topOfRange(x0, x1) {
  if (!topProfile) return null;
  const { topY, kx, originX } = topProfile;
  const c0 = Math.max(0, Math.floor((x0 - originX) / kx));
  const c1 = Math.min(topY.length - 1, Math.ceil((x1 - originX) / kx));
  let best = Infinity;
  for (let c = c0; c <= c1; c++) if (topY[c] < best) best = topY[c];
  // 这一段全是空的（比如气泡比人还宽），退回整张图的最高点
  if (best === Infinity) best = topProfile.fallbackY;
  return best;
}

function bubbleAnchor() {
  // 只给调试钩子和无头骨兜底用，正式定位走 placeBubble
  const ax = headAnchorX();
  const top = topOfRange(ax - 60, ax + 60);
  if (top !== null) return { x: ax, y: top - HEAD_MARGIN };
  if (hitRect) return { x: ax, y: hitRect.y };
  return { x: ax, y: 70 };
}

let bubbleVisible = false;
let smoothX = null;
let smoothY = null;

/** 她头顶正中的横坐标；没有头骨就退回角色包围盒中点 */
function headAnchorX() {
  if (headBone && spine) {
    return spine.toGlobal(new PIXI.Point(headBone.worldX, headBone.worldY)).x;
  }
  if (hitRect) return hitRect.x + hitRect.w / 2;
  return WIDTH / 2;
}

function placeBubble(snap = false) {
  const ax = headAnchorX();

  const w = bubbleEl.offsetWidth;
  const h = bubbleEl.offsetHeight;
  const half = w / 2;

  // 水平方向别让气泡跑出窗口
  const x = Math.min(Math.max(ax, half + 6), Math.max(WIDTH - half - 6, half + 6));

  // 气泡会盖住的那一段里最高的是什么，就贴在它上面
  const top = topOfRange(x - half, x + half);
  let targetY;
  if (top !== null) {
    targetY = top - HEAD_MARGIN;
  } else if (headBone && spine) {
    const p = spine.toGlobal(new PIXI.Point(headBone.worldX, headBone.worldY));
    targetY = p.y - 34;
  } else {
    targetY = 70;
  }

  if (snap || smoothX === null) {
    smoothX = x;
    smoothY = targetY;
  } else {
    // 平滑跟随：点头、换动作时头部位置会突变，直接贴过去会让气泡跳
    smoothX += (x - smoothX) * 0.3;
    smoothY += (targetY - smoothY) * 0.3;
  }

  // 顶部空间不够就往下压，宁可压到她也不要出框
  const y = Math.max(smoothY, h + 4);

  bubbleEl.style.left = `${Math.round(smoothX)}px`;
  bubbleEl.style.top = `${Math.round(y)}px`;

  // 气泡被窗口挤开多少，尾巴就补回多少，始终指着她
  const tail = Math.min(Math.max(ax - smoothX + half, 12), Math.max(w - 12, 12));
  bubbleEl.style.setProperty('--tail-x', `${Math.round(tail)}px`);
}

// 30fps 下每 3 帧算一次（10Hz）：头部浮动很慢，每帧写样式纯属浪费
let bubbleTick = 0;
app.ticker.add(() => {
  if (!bubbleVisible) return;
  if (++bubbleTick % 3) return;
  placeBubble();
});

// 换显示器 / 改缩放时角色位置会变，重新量一次剖面
window.addEventListener('resize', () => {
  topProfile = null;
  requestAnimationFrame(() => requestAnimationFrame(measureTopProfile));
});

/* ------------------------------------------------------------------ *
 * 气泡文本
 * ------------------------------------------------------------------ */
let bubbleTimer = null;

function hideBubble() {
  bubbleVisible = false;
  bubbleEl.classList.remove('show');
  window.PET_VOICE.stop();
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

/**
 * 有语音就用语音，没语音就退回原始台词。
 *
 * 字幕跟语音原文走：气泡里显示的就是这句语音本身在说的话，
 * 不然会出现"她在说一句、屏幕上是另一句"的错位。
 * lines.js 里的原创台词保留，作为没有语音时的兜底。
 */
function speakWithVoice(list, fallbackMs = 6000) {
  const line = window.PET_VOICE.pick();
  if (!line) {
    say(window.PET_PICK(list), fallbackMs);
    return;
  }
  say(line.text, Math.round(line.dur * 1000) + 900);
  line.play();
}

// 调试钩子：自动化验证用，也可以从 DevTools 手动触发动画
window.__petDebug = {
  play,
  playOnce,
  say,
  speak: () => speakWithVoice(L.click),
  voice: () => window.PET_VOICE.status(),
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
  speakWithVoice(L.click);
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
