# arknights-deskpet

一个安静的桌面伴侣。透明悬浮、贴边常驻、不抢焦点，会记住今天是陪你的第几天。

> **本项目只包含代码，不包含、也不分发任何游戏素材。**
> 立绘与语音需要你自己准备，详见 [assets/README.md](assets/README.md)。

## 现在能做什么

- 无边框透明窗口，角色站在桌面上，不占任务栏
- 呼吸起伏 + 轻微摇摆 + 眨眼（需要 `eyes.png`）
- 鼠标只在角色轮廓内生效，其余区域直接穿透到桌面
- 拖拽移动，松手即定位
- 点她会说话，带气泡
- 久不操作会主动搭话；深夜会催你去睡
- 每天第一次见面，她会报出这是第几天、连着几天
- 托盘常驻：显示/隐藏、总在最前、回到右下角、退出

## 快速开始

```bash
npm install
npm start
```

第一次运行时 `assets/character/` 是空的，会自动退回内置的占位小人——
先确认窗口、穿透、拖拽都正常，再放真素材。

放好素材后重启即可：

```
assets/character/body.png   # 全身立绘，透明背景，脚踩下边缘
assets/character/eyes.png   # 可选，只留眼睛，用来眨眼
```

## 托盘

程序没有任务栏图标，**退出只能从托盘菜单**。托盘图标由 `npm run icon` 生成。

## 目录

```
src/main/main.js        窗口、穿透、拖拽、托盘、IPC
src/main/memory.js      陪伴记录（天数 / 连续天数 / 点击次数）
src/preload/preload.js  受控的 IPC 桥
src/renderer/           页面、样式、动画、台词
assets/                 素材（character 与 audio 永不入库）
scripts/make-tray-icon.js  零依赖生成托盘 PNG
```

陪伴数据存在 Electron 的 `userData` 目录下（托盘菜单「数据文件夹」可直接打开），
删掉 `companion.json` 就等于让她重新认识你。

## 路线图

- [x] 透明窗口 / 穿透 / 拖拽 / 托盘
- [x] 呼吸、摇摆、点击反应、气泡
- [x] 陪伴天数记录
- [ ] 语音播放（依赖 `assets/audio/`）
- [ ] Spine 骨骼动画，取代静态立绘
- [ ] 多角色切换
- [ ] 开机自启

## 关于素材与授权

代码以 MIT 发布。**MIT 只覆盖代码，不覆盖任何游戏素材。**

明日方舟的立绘、Spine 动画、语音均为鹰角网络资产。如果你 fork 这个项目，
请保持 `assets/character/` 与 `assets/audio/` 不进入版本库，也不要在发行包里附带它们。

`src/renderer/lines.js` 中的台词全部为本项目原创示例，不含游戏内原文。
