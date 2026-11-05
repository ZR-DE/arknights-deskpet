# assets —— 需要你自己准备

这个目录默认是空的，并且被 `.gitignore` 保护。**本仓库不分发任何游戏素材。**

## 为什么是空的

明日方舟的立绘、Spine 骨骼动画、语音，著作权属于鹰角网络。把它们打进仓库或安装包再分发，
性质是传播他人的美术与音频作品——这不是"同人是否被容忍"的问题，而是会真实存在的法律风险。

所以这里的做法是：**只提供代码，素材由使用者自行准备**。这也是同人桌宠圈一直在用的方式。

## character/ 放什么

Spine 三件套，三个文件**必须同名**：

```
assets/character/
├── xxx.skel    # 二进制骨骼
├── xxx.atlas   # 图集描述
└── xxx.png     # 图集合图
```

- `.atlas` 和 `.skel` 同名是硬性要求，加载器会自动按这个规则去找图集
- `.atlas` 第一行引用的 png 文件名，必须和实际文件名一字不差
- 图集可以有多页（`xxx.png`、`xxx2.png`），atlas 里会分别声明

## 换成你的角色

只改 `src/renderer/pet.js` 顶部这一段，其他代码不用动：

```js
const CHARACTER = {
  skeleton: 'pet://character/你的文件.skel',
  anim: {
    idle: 'Default',
    interact: 'Interact',
    move: 'Move',
    relax: 'Relax',
    sit: 'Sit',
    sleep: 'Sleep',
  },
};
```

右边的动画名按素材实际情况填。**填错不会崩**——找不到就自动退回 `idle`。

## 怎么知道有哪些动画

```bash
npm run spine:test
```

会单独打开一个验证窗口，把骨架里的动画名、蒙皮（skin）、包围盒全部打印出来，
同时播放第一个动画。换新素材时先用它看清楚再改配置。

## 关于 Spine 版本

目前验证通过的是 **Spine 3.8.x**（pixi-spine 4.0.6 的 3.8 运行时）。
如果素材是 4.x 导出的，`.skel` 的二进制格式已经变了，需要换运行时，改配置是解决不了的。

## audio/

语音放这里，命名随意。当前版本还没接播放逻辑，先把文件准备好即可。
