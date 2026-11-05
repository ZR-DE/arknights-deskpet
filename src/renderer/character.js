'use strict';

/**
 * 角色配置——换人只改这一个文件。
 *
 * 之前角色路径在 pet.js 和 spine-test.js 里各写了一份，换素材时容易只改一处，
 * 调试页和桌面看到的不是同一个角色。现在两份都读这里。
 */
window.PET_CHARACTER = {
  // 骨架文件；同名的 .atlas / .png 会被自动一起加载
  skeleton: 'pet://character/build_char_002_amiya.skel',

  // 骨架里的动画名。填错不会崩，会自动退回 idle。
  anim: {
    idle: 'Default',
    interact: 'Interact',
    move: 'Move',
    relax: 'Relax',
    sit: 'Sit',
    sleep: 'Sleep',
  },
  /**
   * 语音不走这里：音频文件名统一在主进程的 VOICE 常量里定义
   * （src/main/main.js），启动时通过 IPC 取。
   * 少一处重复，就少一次换素材改漏的机会。
   */
};
