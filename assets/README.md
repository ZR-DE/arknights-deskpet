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
- `.atlas` 里声明的 png 文件名，必须和实际文件名一字不差
- 图集可以有多页（`xxx.png`、`xxx2.png`），atlas 里会分别声明

**文件名里不能出现 `#`。** 素材原始名字长这样：`build_char_002_amiya_epoque#4.png`，
而 `#` 在 URL 里是 fragment 分隔符——`pet://character/xxx#4.png` 会被浏览器截成
`pet://character/xxx`，图集直接 404，角色一片空白。所以导入时统一改名成
`amiya-epoque` 这种 URL 安全的形式，并同步改掉 atlas 里的页名。

## 多套时装

想放几套就放几套，每套一组三件套。清单写在 `src/shared/outfits.json`：

```json
{ "id": "epoque", "name": "术师 · epoque #4", "file": "amiya-epoque" }
```

`file` 是 `assets/character/` 下的共同前缀，`name` 是托盘菜单里显示的字。
**素材不齐的那一套不会出现在菜单里**——比起点不动，不如看不见。

如果你手上是解包的原始目录（`素材/Amiya/1/`、`2/`…），别手动拷：
改完清单跑一次 `node scripts/import-outfits.js`，它会复制、改名、修 atlas 页名。

## 换成你的角色

动画名映射在 `src/renderer/character.js`：

```js
window.PET_CHARACTER = {
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

骨架路径不在这里——多套时装之后，它由主进程按清单和文件是否存在算出来。
右边动画名按素材实际情况填。**填错不会崩**——找不到就自动退回 `idle`。

## 怎么知道有哪些动画

```bash
npm run spine:test
```

会单独打开一个验证窗口，把骨架里的动画名、蒙皮（skin）、包围盒全部打印出来，
同时播放第一个动画。换新素材时先用它看清楚再改配置。

## 关于 Spine 版本

目前验证通过的是 **Spine 3.8.x**（pixi-spine 4.0.6 的 3.8 运行时）。
如果素材是 4.x 导出的，`.skel` 的二进制格式已经变了，需要换运行时，改配置是解决不了的。

实测的六套阿米娅时装（含近卫）全部是 3.8.99，动画名也基本一致
（`Default / Interact / Move / Relax / Sit / Sleep`，有的多一个 `Start`）。
但**骨骼结构并不通用**——近卫那套的头骨叫 `H_Head` 而不是 `F_Head`，
世界坐标也差得很远，所以代码里对这些都做了兜底而不是写死。

## audio/

三个文件，名字固定（要换名字就改 `src/main/main.js` 顶部的 `VOICE` 常量，只有那一处）：

```
assets/audio/
├── amiya.ogg               # 原始语音包，整包一个文件
├── amiya.segments.json     # 切好的分段表（脚本生成）
└── amiya.lines.json        # 标注好的字幕（标注工具生成）
```

### amiya.ogg

游戏解包出来的语音是**一个角色一个长音频**，几十分钟首尾相接。原样放进来就行，
不需要自己切——切分由脚本做。

### amiya.segments.json

```bash
python scripts/segment-voice.py assets/audio/amiya.ogg --analyze      # 先看间隔分布
python scripts/segment-voice.py assets/audio/amiya.ogg \
  -o assets/audio/amiya.segments.json --gap 0.22
```

`--analyze` 会打印静音间隔的直方图，**谷底就是最佳切点**。默认值是通用猜测，
不同的语音包差别很大（同样是阿米娅，术师包实测 0.22 切出 104 段，0.3 就只有 67 段）。
需要 `soundfile` 和 `numpy`：`pip install soundfile numpy`。

### amiya.lines.json

双击 `标注语音.cmd` 打开的窗口里，边听边把字幕打进去，Ctrl+S 保存。
格式就是运行时读的东西：

```json
{ "lines": [ { "start": 1.24, "dur": 1.59, "text": "……" } ] }
```

留空的句子不会被选中。**这个文件里是游戏台词原文，和语音同等性质，不要提交。**

