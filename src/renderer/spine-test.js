'use strict';

/**
 * Spine 加载验证页。
 *
 * 只做一件事：确认 pixi-spine 能不能正确解析这份 3.8.99 的 .skel，
 * 顺便把所有动画名列出来——后面做状态机要靠这张名字表。
 *
 * 用 PIXI.Assets 而不是老的 PIXI.Loader：pixi 7.4 的 UMD 里已经没有 Loader，
 * 而 pixi-spine 4.0.6 注册了 Assets 的 LoadParser，并会自动去找同名 .atlas。
 */

const WIDTH = window.innerWidth || 380;
const HEIGHT = window.innerHeight || 520;

const SKELETON = window.PET_CHARACTER.skeleton;

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
