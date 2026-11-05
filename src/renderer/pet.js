'use strict';

/** 主渲染层：pixi + pixi-spine。换角色只改 character.js。 */

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
let currentOutfitId = null;
/** 她现在是什么状态：idle / relax / sit / sleep，见下方「休息状态机」 */
let mood = 'idle';

/**
 * 微动容器：骨架的 Default 是静止的，呼吸和换重心都在外层做，不碰骨骼。
 * 原点钉在脚底，否则绕窗口左上角转。
 */
const sway = new PIXI.Container();
sway.pivot.set(WIDTH / 2, HEIGHT - 2);
sway.position.set(WIDTH / 2, HEIGHT - 2);
app.stage.addChild(sway);

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
/** 窗口顶部留给气泡的高度。改窗口尺寸时这个值要同比例改，否则角色不是预期大小 */
const BUBBLE_RESERVE = 66;

/** 这套衣服按待机姿态算出来的基准缩放；姿态变化时只在这里的基础上微调 */
let baseScale = 1;

/** 实际底边，不含微动的倾斜。用局部包围盒算，getBounds 会把微动算进去导致悬空 */
function petBottom() {
  if (!spine) return HEIGHT - 2;
  const lb = spine.getLocalBounds();
  return spine.y + (lb.y + lb.height) * spine.scale.y;
}

/** 缩放并摆好位置；返回角色在窗口里的矩形。传入实例，因为换装时新骨架还没上台 */
function layout(target) {
  target.scale.set(1);
  target.update(0.016);

  const base = target.getLocalBounds();
  if (!base.width || !base.height) return null;

  const availH = HEIGHT - BUBBLE_RESERVE;
  const scale = Math.min((WIDTH * 0.96) / base.width, (availH * 0.96) / base.height);
  target.scale.set(scale);
  baseScale = scale;

  // 水平居中、脚底贴住窗口下沿
  target.x = WIDTH / 2 - (base.x + base.width / 2) * scale;
  target.y = HEIGHT - 2 - (base.y + base.height) * scale;

  return {
    x: target.x + base.x * scale,
    y: target.y + base.y * scale,
    w: base.width * scale,
    h: base.height * scale,
  };
}

/* ------------------------------------------------------------------ *
 * 待机微动：呼吸 + 缓慢换重心
 * ------------------------------------------------------------------ */

/** 呼吸周期（秒） */
const BREATH_PERIOD = 4.2;

/** 呼吸时头顶起伏的幅度（px） */
const BREATH_LIFT = 2.6;

/** 常驻横摆：与呼吸周期不同，两个正弦合成极慢的 8 字形，才像重心在换。0.9° 约 8px */
const IDLE_ROCK_DEG = 0.9;
const IDLE_ROCK_PERIOD = 8.3;

let swayAngle = 0;
let swayLift = 0;
let swayTargetAngle = 0;
let swayTargetLift = 0;
let swayNextAt = 0;

/** 姿态切换时把微动归零，免得"坐下"和"歪着"叠在一起 */
function resetSway() {
  swayTargetAngle = 0;
  swayTargetLift = 0;
}

/** 还有多少帧要盯着「底边别出框」 */
let settleFrames = 0;

function beginSettle(frames = 46) {
  settleFrames = frames;
}

app.ticker.add(() => {
  const now = performance.now();
  const dt = Math.min(app.ticker.deltaMS, 80) / 1000;

  // 每隔几秒挑一个"重心"：歪一下、或者只是起伏，然后再自己回正
  if (now > swayNextAt) {
    const roll = Math.random();
    if (roll < 0.5) {
      // 歪一点。人待着无聊时就是这个样子
      swayTargetAngle = (Math.random() - 0.5) * 3.6;
      swayTargetLift = Math.random() * 2.6;
    } else if (roll < 0.82) {
      swayTargetAngle = 0;
      swayTargetLift = Math.random() * 3;
    } else {
      swayTargetAngle = 0;
      swayTargetLift = 0;
    }
    swayNextAt = now + 5000 + Math.random() * 6000;
  }

  // 指数逼近，跟帧率无关：30fps 和 60fps 下走过去的速度一样
  const k = 1 - Math.pow(0.1, dt);
  swayAngle += (swayTargetAngle - swayAngle) * k;
  swayLift += (swayTargetLift - swayLift) * k;

  const t = now / 1000;
  const breath = Math.sin((t / BREATH_PERIOD) * Math.PI * 2) * 0.5 + 0.5;
  const rock = Math.sin((t / IDLE_ROCK_PERIOD) * Math.PI * 2) * IDLE_ROCK_DEG;

  // 睡着时呼吸更沉一点，幅度也更大——躺着的人起伏本来就明显
  const lift = mood === 'sleep' ? BREATH_LIFT * 1.4 : BREATH_LIFT;

  sway.rotation = ((swayAngle + rock) * Math.PI) / 180;
  // 只往上浮，最低点就是贴地那一刻，不会陷进桌面里
  sway.y = HEIGHT - 2 - swayLift - breath * lift;

  /**
   * 换姿态后那半秒里逐帧托底，每帧削掉八成溢出。
   * 干等一次修正的话，坐下的头半秒腿会在框外，看着像被削掉了。
   */
  if (settleFrames && spine) {
    settleFrames--;
    const over = petBottom() - (HEIGHT - 2);
    if (over > 0.5) spine.y -= over * 0.8;
    // 稳定下来再测剖面、更新命中框（这两个贵，不能每帧做）
    if (!settleFrames) resettle(0);
  }
});

/* ------------------------------------------------------------------ *
 * 装卸时装
 * ------------------------------------------------------------------ */

/** 这套骨架里第一个能当待机用的动画名 */
function pickIdle(names) {
  if (names.includes(CHARACTER.anim.idle)) return CHARACTER.anim.idle;
  return names.find((n) => /idle|stand|default/i.test(n)) || names[0];
}

let mounting = false;

/**
 * 加载并换上时装。先加载并布好新骨架，成功了才销毁旧的，
 * 否则素材有问题会什么都不剩。
 */
async function mountOutfit(url, { silent = false } = {}) {
  if (mounting) return false;
  mounting = true;

  try {
    const resource = await PIXI.Assets.load(url);
    const spineData = resource && resource.spineData ? resource.spineData : resource;
    if (!spineData || !spineData.animations) throw new Error('资源不是 Spine 数据');

    const names = spineData.animations.map((a) => a.name);
    if (!names.length) throw new Error('骨架里没有动画');

    const next = new PIXI.spine.Spine(spineData);

    // 姿态之间给一点混合。不设的话 站->坐 是一帧硬跳，看着像卡了一下；
    // 但点击反应要快，单独压短，不然拍上去她半天才动。
    try {
      const fast = CHARACTER.anim.interact;
      next.stateData.defaultMix = 0.2;
      for (const name of names) {
        if (name !== fast) next.stateData.setMix(name, fast, 0.06);
      }
    } catch {
      /* 没有 stateData 就没有过渡，不影响能不能用 */
    }

    // 必须先播上动画再量尺寸：初始姿态和待机姿态的包围盒差很多
    next.state.setAnimation(0, pickIdle(names), true);
    next.update(0.016);

    const rect = layout(next);
    if (!rect) throw new Error('包围盒为空');

    // ===== 到这里才算加载成功，开始替换 =====
    const old = spine;

    spine = next;
    animationNames = names;
    headBone = findHeadBone(next);
    currentAnim = CHARACTER.anim.idle;
    hitRect = rect;
    topProfile = null; // 换人了，头顶剖面作废，下一步重测

    sway.addChild(next);

    if (old) {
      sway.removeChild(old);
      // texture/baseTexture 传 false：图集由 PIXI.Assets 缓存持有，
      // 在这里销毁会让"切回来"加载到一张已死的纹理
      old.destroy({ children: true, texture: false, baseTexture: false });
    }

    next.state.addListener({
      complete: (entry) => {
        if (!entry || !entry.animation) return;
        if (entry.animation.name === CHARACTER.anim.idle) return;
        /**
         * 一次性动作播完回到原本的姿态。playOnce 已排了一个 idle，
         * 但命中框和头顶剖面还停在动作中途，得重测一次。
         */
        if (mood !== 'idle') {
          currentAnim = null;
          play(mood, true);
          resettle();
        } else {
          resettle(620);
        }
      },
    });

    // 等 pixi 真正画出一帧再量，否则画布还是空的
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        measureTopProfile(next);
        // 换装时气泡常常是开着的，位置必须立刻跟着新身高走
        if (bubbleVisible) placeBubble(true);
        refreshDiag();
      })
    );

    if (!silent) {
      // 视觉反馈：播一次互动动画，不用说话
      playOnce('interact');
    }

    // 换了身衣服，但她还在刚才那个状态里——坐着换完还是坐着
    if (mood !== 'idle') {
      currentAnim = null;
      play(mood, true);
      beginSettle();
      resetSway();
    }
    return true;
  } catch (err) {
    console.error('[spine] 加载失败 ' + url, err);
    return false;
  } finally {
    mounting = false;
  }
}

function refreshDiag() {
  window.__diag = {
    stage: spine ? 'ready' : 'empty',
    animations: animationNames,
    headBone: headBone ? headBone.data.name : null,
    outfit: currentOutfitId,
    mood,
    hitRect: hitRect
      ? {
          x: Math.round(hitRect.x),
          y: Math.round(hitRect.y),
          w: Math.round(hitRect.w),
          h: Math.round(hitRect.h),
        }
      : null,
    headAnchor: (() => {
      const a = bubbleAnchor();
      return { x: Math.round(a.x), y: Math.round(a.y) };
    })(),
    topProfile: topProfile ? topProfile.topY.length : 0,
  };
}

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
 * 头骨落在眼睛高度、离头顶差 150px，只扫头骨附近又会漏掉兔耳，所以整张图都扫，
 * 再按气泡覆盖的宽度取最小值。
 */
let topProfile = null;

function measureTopProfile(target) {
  if (!target) return;

  // 不能直接从 app.view 读像素：WebGL 绘图缓冲在合成后就被清了，
  // drawImage 拿到的是全透明。extract 会把目标单独渲染进一张纹理，绕开这个问题。
  let shot;
  try {
    shot = app.renderer.extract.canvas(target);
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

  const bounds = target.getBounds();
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

/**
 * 头顶横坐标。优先用头骨，歪头时气泡能跟着走；
 * 但骨架间的根变换不可比（sale 套的 H_Head 算出来是 -717），
 * 所以必须落在包围盒内才采信，否则退回中点。
 */
function headAnchorX() {
  const center = hitRect ? hitRect.x + hitRect.w / 2 : WIDTH / 2;

  if (headBone && spine && hitRect) {
    const x = spine.toGlobal(new PIXI.Point(headBone.worldX, headBone.worldY)).x;
    const slack = 4;
    if (x >= hitRect.x - slack && x <= hitRect.x + hitRect.w + slack) return x;
    return center;
  }

  if (headBone && spine) {
    const x = spine.toGlobal(new PIXI.Point(headBone.worldX, headBone.worldY)).x;
    if (x >= 0 && x <= WIDTH) return x;
  }

  return center;
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
  requestAnimationFrame(() => requestAnimationFrame(() => measureTopProfile(spine)));
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

/** 有语音就播语音、字幕跟语音原文，否则退回原创台词 */
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
  // 走完整链路：主进程落设置 -> 推事件 -> 渲染层换骨架。和点托盘菜单是同一条路
  outfit: () => currentOutfitId,
  setOutfit: (id) => window.pet.setOutfit(id),
  // 状态机：不传参就返回当前状态，传了就强制切（验收用，不等那几分钟）
  mood: (name) => {
    if (!name) return mood;
    enterMood(name);
    return mood;
  },
  /**
   * 假装她已经被晾了 N 秒，然后重新排程。
   * 用来验证「闲置多久会自己坐下」这条链路，不用真等一分半。
   */
  ago: (seconds) => {
    lastInteract = Date.now() - seconds * 1000;
    scheduleMood();
    return { mood, waited: seconds };
  },
  // 未取整的包围盒：量"她到底动没动"需要小数位
  rawBounds: () => {
    if (!spine) return null;
    const b = spine.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  },
  // 微动当前姿态：实际倾角（含常驻轻摆）和上浮量
  sway: () => ({
    deg: Number(((sway.rotation * 180) / Math.PI).toFixed(2)),
    lift: Number(swayLift.toFixed(2)),
  }),
  /** 表情挂的贴图。眨眼不改包围盒，只能看 slot 才能判断她在不在动 */
  faces: () =>
    spine
      ? spine.skeleton.slots
          .filter((s) => /eye|mouth|emoticon|brow|face/i.test(s.data.name))
          .map((s) => `${s.data.name}=${s.getAttachment() ? s.getAttachment().name : '-'}`)
      : [],
  /** 换表情：直接挂某个 slot 的贴图，用来试哪张是闭眼 */
  attach: (slot, name) => {
    if (!spine) return false;
    try {
      spine.skeleton.setAttachment(slot, name);
      return true;
    } catch (err) {
      console.error('[attach]', err);
      return false;
    }
  },
  state: () => ({
    mood,
    anim: currentAnim,
    anchor: bubbleAnchor(),
    head: headBone ? { x: Math.round(headBone.worldX), y: Math.round(headBone.worldY) } : null,
    // 包围盒随手带上：量「她到底有没有在动」靠这个
    bounds: (() => {
      if (!spine) return null;
      const b = spine.getBounds();
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    })(),
    rect: (() => {
      const r = bubbleEl.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    })(),
  }),
};

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

  // 先叫醒再播反应：顺序反了的话，她会在坐着的姿态上做站立动作
  wake();
  playOnce('interact');
  speakWithVoice(L.click);
}

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !pointInPet(e.clientX, e.clientY)) return;

  lastInteract = Date.now();
  pointerActive = true;
  dragStarted = false;
  downX = e.screenX;
  downY = e.screenY;
  wake();
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
    // 走路的时候别让她一边走一边晃，看着会晕
    resetSway();
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
 * 休息状态机：idle → relax(90s) → sit(4min) → sleep(深夜 10min)
 * 按「距上次互动多久」触发，交互即醒。不用随机，随机一眼就看得出是程序在动。
 * ------------------------------------------------------------------ */

function isLateNight() {
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

/** 安静多久之后进入下一档。sleep 只在她本来就该睡的时候出现 */
const REST_STAGES = [
  { mood: 'relax', after: 90e3 },
  { mood: 'sit', after: 240e3 },
  { mood: 'sleep', after: 600e3, nightOnly: true },
];

let moodTimer = null;
let poseTimer = null;

function restStageAfter(current) {
  const idx = REST_STAGES.findIndex((s) => s.mood === current);
  const next = idx === -1 ? REST_STAGES[0] : REST_STAGES[idx + 1];
  if (!next) return null;
  // 白天的最后一档就是 sit：坐在那儿陪着你，不再往下掉
  if (next.nightOnly && !isLateNight()) return null;
  return next;
}

function scheduleMood() {
  clearTimeout(moodTimer);
  const stage = restStageAfter(mood);

  if (!stage) {
    // 白天坐到 sit 就到头了。但夜里还有 sleep 一档，过十分钟再看一眼，
    // 免得她从下午一直坐到半夜都不睡。
    moodTimer = setTimeout(scheduleMood, 10 * 60e3);
    return;
  }

  const quiet = Date.now() - lastInteract;
  moodTimer = setTimeout(
    () => {
      // 定时器到点不等于真的闲了：中途可能被点过，重新排
      if (Date.now() - lastInteract < stage.after) {
        scheduleMood();
        return;
      }
      enterMood(stage.mood);
    },
    Math.max(1500, stage.after - quiet)
  );
}

function enterMood(next) {
  if (mood === next) return;

  if (!spine) {
    // 骨架还没上台（或加载失败）。过一会儿再试，别让状态机就此停摆
    moodTimer = setTimeout(scheduleMood, 30e3);
    return;
  }

  mood = next;
  currentAnim = null;
  play(next, true);
  // 立刻开始逐帧托住底边；收尾那次测量由 settle 结束时统一做，不用再排一次
  beginSettle();
  resetSway();
  scheduleMood();
  refreshDiag();
}

/** 叫醒：任何互动都先走这里，把她叫回来并重新开始计时 */
function wake() {
  const wasResting = mood !== 'idle';
  mood = 'idle';
  if (wasResting && spine) {
    currentAnim = null;
    play('idle', true);
    beginSettle();
    resetSway();
    refreshDiag();
  }
  scheduleMood();
}

/**
 * 姿态变了就重测尺寸：缩放、贴底、气泡剖面、命中框。
 * 延迟是因为混合过渡要几百毫秒，早测量到的是中间态。
 */
function resettle(delay = 560) {
  clearTimeout(poseTimer);
  poseTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      if (!spine) return;

      /** 先回基准大小，装不下才缩。Sleep 躺着比站着宽一倍，只缩不放 */
      spine.scale.set(baseScale);

      const raw = spine.getBounds();
      if (!raw.width || !raw.height) return;

      const fit = Math.min(
        (WIDTH * 0.98) / raw.width,
        ((HEIGHT - BUBBLE_RESERVE) * 0.98) / raw.height,
        1
      );
      if (fit < 0.999) spine.scale.set(baseScale * fit);

      /** 坐姿/躺姿在骨架里自带位移，底边会掉到框外。双向修正，只往上推站起来会悬空 */
      const overflow = petBottom() - (HEIGHT - 2);
      if (Math.abs(overflow) > 0.5) spine.y -= overflow;

      topProfile = null;
      measureTopProfile(spine);

      const b = spine.getBounds();
      if (b.width > 1 && b.height > 1) {
        hitRect = { x: b.x, y: b.y, w: b.width, h: b.height };
      }

      if (bubbleVisible) placeBubble(true);
      refreshDiag();
    });
  }, delay);
}

/** 偶尔搭句话。只说话不动画，姿态归状态机；睡着了不吵 */
function scheduleIdle() {
  const wait = 45000 + Math.random() * 70000;
  setTimeout(() => {
    const quiet = Date.now() - lastInteract;
    if (!document.hidden && quiet > 40000 && !bubbleVisible && mood !== 'sleep') {
      const list = mood === 'sit' ? L.rest : isLateNight() ? L.lateNight : L.idle;
      say(window.PET_PICK(list), 6000);
    }
    scheduleIdle();
  }, wait);
}

/* ------------------------------------------------------------------ *
 * 启动。放在最后：这里用到上面的 let，提前执行会撞上暂时性死区。
 * ------------------------------------------------------------------ */
(async () => {
  let info = null;
  try {
    info = await window.pet.outfits();
  } catch (err) {
    console.error('[outfit] 取不到时装清单', err);
  }

  /**
   * 兜底：又点了一次启动器时，渲染层会 reload 但主进程还是旧的，
   * pet:outfits 没有 handler，invoke 会 reject。不兜底就是「点一下，人没了」。
   */
  if (!info || !info.current) {
    info = {
      current: { id: 'default', url: 'pet://character/amiya-default.skel' },
      list: [],
    };
    console.warn('[outfit] 取不到清单，回退到默认时装');
  }

  currentOutfitId = info.current.id;
  const ok = await mountOutfit(info.current.url, { silent: true });

  if (ok) {
    startGreeting();
    scheduleIdle();
    scheduleMood();
  } else {
    setTimeout(() => say('……我好像，站不起来了。', 9000), 600);
  }
  startVoice();

  // 托盘换装
  if (typeof window.pet.onOutfitChanged === 'function') {
    window.pet.onOutfitChanged(async (outfit) => {
      if (!outfit || !outfit.url) return;
      const previous = currentOutfitId;
      currentOutfitId = outfit.id;
      hideBubble();
      const swapped = await mountOutfit(outfit.url);
      if (!swapped) {
        // 没换成，把状态退回上一套，避免设置和画面对不上
        currentOutfitId = previous;
        say('这件……穿不上。', 4000);
      }
    });
  }
})();
