# assets —— 需要你自己准备

这个目录默认是空的，且被 `.gitignore` 保护。**本仓库不分发任何游戏素材。**

明日方舟的立绘、Spine 动画、语音著作权属于鹰角网络，请自行准备素材，
不要把它们提交进仓库或随安装包分发。

## character/ 放什么

Spine 三件套，三个文件**必须同名**：

```
assets/character/
├── xxx.skel    # 二进制骨骼
├── xxx.atlas   # 图集描述
└── xxx.png     # 图集合图
```

- `.atlas` 里声明的 png 名必须和实际文件名一致；图集可以有多页（`xxx.png`、`xxx2.png`）
- **文件名不能带 `#`**。原始名字形如 `build_char_002_amiya_epoque#4.png`，`#` 在 URL 里是
  fragment 分隔符，请求会被截断导致图集 404。导入脚本会自动改成 `amiya-epoque` 这类安全名，
  并同步改掉 atlas 里的页名

## 多套时装

每套一组三件套，清单写在 `src/shared/outfits.json`：

```json
{ "id": "epoque", "name": "术师 · epoque #4", "file": "amiya-epoque" }
```

`file` 是文件名前缀，`name` 是托盘里显示的字。素材不齐的套不会出现在菜单里。

如果手上是解包的原始目录（`素材/Amiya/1/`、`2/`…），别手动拷：

```bash
node scripts/import-outfits.js
```

它会复制、改名、修 atlas 页名。

## 换成你的角色

动画名映射在 `src/renderer/character.js`：

```js
window.PET_CHARACTER = {
  anim: { idle: 'Default', interact: 'Interact', move: 'Move',
          relax: 'Relax', sit: 'Sit', sleep: 'Sleep' },
};
```

骨架路径不在这里，由主进程按清单和文件是否存在算出。动画名填错不会崩，找不到会退回 `idle`。

### 查看素材里有哪些动画

```bash
npm run spine:test
```

打开验证窗口，打印动画名、蒙皮、包围盒并播放第一个动画。换新素材先用它看清楚。

### Spine 版本

目前验证的是 **3.8.x**（pixi-spine 4.0.6 的 3.8 运行时）。4.x 导出的 `.skel` 二进制格式已变，
需要换运行时，改配置解决不了。

骨骼结构并不通用：六套时装的动画名一致，但近卫那套头骨叫 `H_Head` 而不是 `F_Head`，
世界坐标也差很远，代码里对这些都做了兜底。

## audio/

三个文件，名字固定（要改就改 `src/main/main.js` 顶部的 `VOICE` 常量，只有那一处）：

```
assets/audio/
├── amiya.ogg               # 原始语音包，整包一个文件
├── amiya.segments.json     # 切好的分段表（脚本生成）
└── amiya.lines.json        # 标注好的字幕（标注工具生成）
```

`amiya.ogg` 原样放进来就行，不需要自己切：

```bash
python scripts/segment-voice.py assets/audio/amiya.ogg --analyze      # 先看间隔分布
python scripts/segment-voice.py assets/audio/amiya.ogg \
  -o assets/audio/amiya.segments.json --gap 0.22
```

`--analyze` 打印静音间隔直方图，谷底就是合适的切点。不同语音包差别很大
（术师包 0.22 切出 104 段，0.3 只有 67 段）。依赖：`pip install soundfile numpy`。

字幕用 `标注语音.cmd` 边听边打，Ctrl+S 保存，格式：

```json
{ "lines": [ { "start": 1.24, "dur": 1.59, "text": "……" } ] }
```

留空的句子不会被选中。**这个文件是游戏台词原文，和语音同等性质，不要提交。**
