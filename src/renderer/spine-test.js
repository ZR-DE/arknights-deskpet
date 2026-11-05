'use strict';

/**
 * Spine 加载验证页：确认 pixi-spine 能解析这份 .skel，并列出全部动画名。
 * 用 PIXI.Assets（pixi 7.4 的 UMD 里没有 Loader），pixi-spine 会自动找同名 .atlas。
 */

const WIDTH = window.innerWidth || 380;
const HEIGHT = window.innerHeight || 520;

// 现在有多套时装，路径由主进程给；这里验的是"当前穿的那件"
let SKELETON = null;

window.__diag = {
  stage: 'boot',
  version: PIXI.VERSION,
  spineLoaded: false,
  animations: [],
  skins: [],
  bounds: null,
  error: null,
};

const app = new PIXI.Application({
  width: WIDTH,
  height: HEIGHT,
  backgroundAlpha: 0,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  preserveDrawingBuffer: true,
});

document.body.appendChild(app.view);
window.__diag.stage = 'app-created';

(async () => {
  try {
    const info = await window.pet.outfits();
    if (!info || !info.current) throw new Error('没有可用时装（assets/character/ 缺三件套）');
    SKELETON = info.current.url;
    window.__diag.outfit = info.current.id;
    window.__diag.outfits = (info.list || []).map((o) => `${o.id}:${o.name}`);

    const resource = await PIXI.Assets.load(SKELETON);
    window.__diag.stage = 'loaded';

    const spineData = resource && resource.spineData ? resource.spineData : resource;

    if (!spineData || !spineData.animations) {
      throw new Error(`不是 Spine 数据，返回的是: ${Object.keys(resource || {}).join(',')}`);
    }

    window.__diag.spineLoaded = true;
    window.__diag.animations = spineData.animations.map((a) => a.name);
    window.__diag.skins = (spineData.skins || []).map((s) => s.name);

    const spine = new PIXI.spine.Spine(spineData);
    app.stage.addChild(spine);

    const names = window.__diag.animations;
    if (names.length) {
      const preferred = names.find((n) => /idle|stand|default/i.test(n)) || names[0];
      spine.state.addAnimation(0, preferred, true, 0);
      window.__diag.playing = preferred;
    }

    // 先让姿态生效，否则算出来的是 setup pose 的包围盒
    spine.update(0.016);

    const bounds = spine.getLocalBounds();
    window.__diag.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };

    const allBones = spine.skeleton.bones || [];
    window.__diag.bones = allBones
      .map((b) => ({ n: b.data.name, x: Math.round(b.worldX), y: Math.round(b.worldY) }))
      .slice(0, 60);
    window.__diag.bonesTotal = allBones.length;
    window.__diag.boneNames = allBones.map((b) => b.data.name);

    window.__diag.slots = (spine.skeleton.slots || [])
      .map((s) => `${s.data.name}${s.getAttachment() ? '' : '(空)'}`)
      .slice(0, 80);

    const scale = Math.min(
      (WIDTH * 0.94) / bounds.width,
      (HEIGHT * 0.94) / bounds.height
    );
    spine.scale.set(scale);
    spine.x = WIDTH / 2 - (bounds.x + bounds.width / 2) * scale;
    spine.y = HEIGHT / 2 - (bounds.y + bounds.height / 2) * scale;
    window.__diag.scale = Number(scale.toFixed(3));

    window.__diag.stage = 'playing';
  } catch (err) {
    window.__diag.error = String((err && err.message) || err);
    window.__diag.stage = 'error';
  }
})();
