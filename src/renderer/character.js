'use strict';

/**
 * 动画名映射。骨架路径不在这里——由主进程按 outfits.json 算出后经 IPC 传入。
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
