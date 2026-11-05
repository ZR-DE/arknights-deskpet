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
let currentOutfitId = null;
/** 她现在是什么状态：idle / relax / sit / sleep，见下方「休息状态机」 */
let mood = 'idle';

/**
 * 微动容器。
 *
 * 这批骨架的 Default 是完全静止的——实测三秒内包围盒一个小数位都不变，
 * 坐着站着就那么定着，看起来像张立绘。所以"她还活着"这件事只能自己做。
 *
 * 做法是在外层容器上做整体变换，一根骨骼都不碰：
 * 动画系统不知道有这回事，换动作、换时装都不会打起来，也不用为每套骨架重调。
 *
 * 变换原点钉在脚底：要么不转，要转就绕地面转，否则她会绕着窗口左上角画圈。
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
/** 窗口顶部留给气泡的高度，角色只在下面这段里排 */
/**
 * 窗口顶部留给气泡的高度，角色只在下面这段里排。
 *
 * 这个值要和窗口高度同比例缩：角色实际大小是按 (高度 - 预留) 算出来的，
 * 只改窗口不改预留，预留占比变大，体型就不是预期的倍数了
 * （380×620 / 110 缩成六成时，预留必须一起降到 66，否则她只有 0.57 倍）。
 */
const BUBBLE_RESERVE = 66;

/** 这套衣服按待机姿态算出来的基准缩放；姿态变化时只在这里的基础上微调 */
let baseScale = 1;

/**
 * 她在窗口里的实际底边——不含微动的倾斜和浮动。
 *
 * 贴底要是拿 getBounds() 来算，微动一歪，包围盒下沿就跟着动，
 * 贴底会把她整个抬起来几个像素；等微动回正，她就悬在半空了。
 * 所以用局部包围盒自己换算，把微动摘干净。
 */
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
 * 待机微动：呼吸 + 偶尔换个重心
 *
 * 目标是"像在旁边站着"，不是"在表演动作"。
 * 幅度小到不抢注意力，节奏比真人慢半拍——快了像喘，大了像站不稳。
 * ------------------------------------------------------------------ */

/** 呼吸周期（秒） */
const BREATH_PERIOD = 4.2;

/** 呼吸时头顶起伏的幅度（px） */
const BREATH_LIFT = 2.6;

/**
 * 常驻的左右轻摆（度 / 秒）。
 *
 * 只有上下浮动的话，看久了还是像一张会呼吸的立绘——因为那是"一维"的。
 * 叠一层周期不同的横摆，两个正弦合起来就是很缓慢的 8 字形，
 * 跟呼吸不共振，看起来才像重心在换。
 *
 * 0.9° 换算到头顶差不多 8px：站着的人本来就会这样轻微晃，
 * 再小就看不见，再大就像站不稳了。
 */
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
   * 姿态刚切过去的那一秒多，每帧检查底边有没有跑出窗口。
   *
   * 之前是干等 560ms 再一次性修正，结果坐下的头半秒里腿在框外——
   * 看到的就是"刚坐下腿没了，过一会儿又出现"。现在每帧把溢出的部分削掉一半，
   * 她像是被轻轻按回地面，而不是先掉出去再弹回来。
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
 * 加载并换上某一套时装。
 *
 * 顺序很关键：先把新骨架（不挂舞台）加载、布好位，全都成功了才替换旧的。
 * 反过来先销毁旧的再加载，一旦新素材有问题，屏幕上就什么都不剩——
 * 换装失败应该是"没换成"，不是"人没了"。
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
         * 一次性动作播完，回到"她本来该有的样子"。
         *
         * playOnce 已经排了一个 idle，站着的时候不用再切，让排队的那个接管；
         * 但姿势回到站位后，命中框和头顶剖面还停在动作中的样子，得重测一次。
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
 * 她头顶正中的横坐标。
 *
 * 优先用头骨——她歪头、侧身的时候气泡会跟着走，这是想要的。
 * 但不是所有骨架的头骨坐标都可比：近卫那套（sale）的头骨 H_Head
 * 换算出的世界坐标在 -717，直接拿来定位气泡就飞出窗口了。
 * 所以加一道合理性校验：头骨必须落在角色包围盒范围内，否则用包围盒中点。
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
  /**
   * 脸和表情当前挂的是哪张贴图。
   *
   * 眨眼、换表情都不改包围盒，光看包围盒会误判成"她一动不动"。
   * 这里直接读 slot 的 attachment，能看出动画到底有没有在做表情。
   */
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
 * 休息状态机
 *
 * 她不是一直站着等你的。待久了会松下来（relax），再久一点会坐下（sit），
 * 深夜坐到后面就睡着了（sleep）。任何一次点击、拖动都会把她叫回 idle。
 *
 * 为什么用「距上次互动多久」而不是随机：
 * 随机切姿态一眼就能看出是程序在动，时间驱动的过渡才像"她自己待累了"。
 * 阈值也别太密——刚放下手她就坐下，会显得很急。
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
 * 姿态变了就重测一次「她现在多高、占多大地方」。
 *
 * 坐着比站着矮一大截。不重测的话：气泡会飘在原来头顶的高度，
 * 而她腿原来所在的位置还会继续吃掉鼠标，点旁边的桌面点不动。
 * 延迟是因为混合过渡要几百毫秒才到位，早测了量到的是半蹲的中间态。
 */
function resettle(delay = 560) {
  clearTimeout(poseTimer);
  poseTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      if (!spine) return;

      /**
       * 先回到这套衣服本来的大小，再按当前姿态决定要不要缩。
       * Sleep 是躺着的，比站着宽一倍，窗口装不下——不缩的话头尾都在框外。
       * 只缩不放：坐下比站着矮是正常的，不该因为她矮就放大。
       */
      spine.scale.set(baseScale);

      const raw = spine.getBounds();
      if (!raw.width || !raw.height) return;

      const fit = Math.min(
        (WIDTH * 0.98) / raw.width,
        ((HEIGHT - BUBBLE_RESERVE) * 0.98) / raw.height,
        1
      );
      if (fit < 0.999) spine.scale.set(baseScale * fit);

      /**
       * 坐下、躺下这些动作在骨架里自带整体位移，包围盒会整个往下掉，
       * 照原样待着腿就出框了（实测掉出去一百多像素，只剩上半身）。
       * 所以按当前姿态把底边重新压回窗口下沿。
       *
       * 注意是双向修正：只往上推的话，站起来时她还悬在半空回不去。
       */
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

/**
 * 偶尔说一句话。
 *
 * 只说话，不碰动画——姿态归状态机管。
 * 睡着了就别吵她；气泡还开着的时候也别叠话。
 */
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
 * 启动
 *
 * 放在文件最后：这里会用到 bubbleVisible 等 let 声明，
 * 上面任何一处提前执行都会撞上暂时性死区。
 * ------------------------------------------------------------------ */
(async () => {
  let info = null;
  try {
    info = await window.pet.outfits();
  } catch (err) {
    console.error('[outfit] 取不到时装清单', err);
  }

  /**
   * 兜底：主进程还停在旧版本的时候会走到这里。
   *
   * 触发场景很具体——又点了一次启动器，旧进程收到通知后 reload 了渲染层，
   * 但主进程代码不会跟着更新（Electron 不热重载主进程）。
   * 这时 pet:outfits 没有对应的 handler，invoke 会 reject。
   * 不兜底的话，用户看到的是"点了一下启动器，人没了"。
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
