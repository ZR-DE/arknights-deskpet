'use strict';

/**
 * 动画配置——换角色/换时装只改这里。
 *
 * 骨架路径不在这里了：现在有多套时装，路径由主进程按
 * src/shared/outfits.json + 素材是否齐全算出来，通过 IPC 交给渲染层。
 * 名字只在一处定义，就少一次换素材改漏的机会。
 */
window.PET_CHARACTER = {
  // 骨架里的动画名。填错不会崩，会自动退回 idle。
  anim: {
    idle: 'Default',
    interact: 'Interact',
    move: 'Move',
    relax: 'Relax',
    sit: 'Sit',
    sleep: 'Sleep',
  },
};
