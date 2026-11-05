# arknights-deskpet

一个安静的桌面伴侣。透明悬浮、贴边常驻、不抢焦点，会记住今天是陪你的第几天。

> **本项目只包含代码，不包含、也不分发任何游戏素材。**
> 骨骼与语音需要你自己准备，详见 [assets/README.md](assets/README.md)。

## 现在能做什么

- 无边框透明窗口，角色站在桌面上，不占任务栏
- 用 Spine 骨骼实时渲染，不是静态图也不是视频
- 待机 / 互动 / 拖拽 / 犯困 多组动画自动切换，播完回落到待机
- 鼠标只在角色轮廓内生效，其余区域直接穿透到桌面
- 拖拽移动，松手即定位
- 点她会说话，带气泡
- 久不操作会主动搭话；深夜会催你去睡
- 每天第一次见面，她会报出这是第几天、连着几天
- 托盘常驻：显示/隐藏、总在最前、回到右下角、退出

## 快速开始

### 方式一：双击（不用装 Node）

装好依赖之后，`node_modules/electron/dist/electron.exe` 本身就是完整的运行环境，
**不需要系统里安装 Node.js**。

双击项目里的 **`启动桌宠.cmd`** 即可，命令窗口会一闪而过，然后她出现在屏幕右下角。

> 为什么是 `.cmd` 而不是 `.vbs`：`.vbs` 依赖 Windows Script Host，
> 部分系统的安全策略或安全软件会直接禁用，双击没有任何反应。
> `.cmd` 是所有 Windows 都能执行的，代价是会闪一下黑窗。
>
> 这两个脚本刻意写成**纯 ASCII + CRLF 换行**：cmd 按系统码页（中文系统是 936）
> 逐字节解析批处理文件，一旦文件是 UTF-8 却带了 `chcp 65001`，
> 中文字符的第二个字节会被当成命令的一部分，整行拆散报错。

### 方式二：命令行

```bash
npm install
npm start
```

`npm start` 走的是 `scripts/start.js`，它会清掉环境里可能存在的
`ELECTRON_RUN_AS_NODE`——这个变量会让 Electron 退化成纯 Node 运行，
主进程直接崩溃。

### 没有素材时

窗口会是空的（Spine 无法解析就没有任何东西可画），
把素材放进 `assets/character/` 再启动即可，详见 [assets/README.md](assets/README.md)。

## 调试

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动并弹出独立的 DevTools 窗口 |
| `npm run spine:test` | 单独开验证窗口，打印动画名、蒙皮、包围盒 |
| 双击 `调试启动.cmd` | 不用 Node 的调试入口，日志直接显示在命令窗口里 |

## 托盘

程序没有任务栏图标，**退出只能从托盘菜单**。托盘图标由 `npm run icon` 生成。

## 目录

```
src/main/main.js           窗口、穿透、拖拽、托盘、自定义协议
src/main/memory.js         陪伴记录（天数 / 连续天数 / 点击次数）
src/preload/preload.js     受控的 IPC 桥
src/renderer/pet.js        渲染、动画状态、命中检测、台词调度
src/renderer/spine-test.js 素材验证页
src/renderer/vendor/       pixi 与 pixi-spine 的预构建文件
assets/                    素材（character 与 audio 永不入库）
scripts/start.js           命令行启动器
scripts/make-tray-icon.js  零依赖生成托盘 PNG
启动桌宠.cmd               双击启动（不依赖 Node）
调试启动.cmd               双击调试（带日志窗口）
```

## 两个实现上的必要选择

**为什么不用 `file://` 加载素材。** pixi 通过 XHR 读 `.skel` 和 `.atlas`，
而 `file://` 页面的 origin 是 `null`，请求会被 CORS 拦掉。所以主进程注册了一个
`pet://` 私有协议映射到 `assets/`，带 `corsEnabled`，同时保持 `webSecurity` 开启。

**为什么 CSP 里有 `unsafe-eval`。** pixi 7 的批渲染器用 `new Function` 生成着色器，
不放宽这一项就直接报错。这个应用不加载任何远程内容，风险面是封闭的。

**为什么气泡要挂到头骨上。** 气泡如果锚在窗口上（`left: 50%; top: 10px`），
角色一动、换动作、换表情，气泡和她的相对位置就变了。所以改成每帧取头骨
`F_Head_I` 的世界坐标来定位。头骨本身落在眼睛高度，离可见头顶还差 140px，
这个差值不能写死——启动后把角色单独渲染成一张纹理（`renderer.extract`），
扫一遍头顶那条竖带里最上面的不透明像素，实测出「头顶 − 头骨」的偏移。
换角色、换分辨率都不用重调。

顺带一个坑：绝对定位元素的可用宽度是「窗口宽 − left」，不写 `width: max-content`
的话气泡越靠右越窄，文字被迫折行、高度乱跳，看起来就像气泡自己在动。

陪伴数据存在 Electron 的 `userData` 目录（托盘菜单「数据文件夹」可直接打开），
删掉 `companion.json` 就等于让她重新认识你。

## 路线图

- [x] 透明窗口 / 穿透 / 拖拽 / 托盘
- [x] Spine 骨骼渲染与多动画切换
- [x] 点击反应、气泡、陪伴天数记录
- [ ] 语音播放（依赖 `assets/audio/`）
- [ ] 动画状态机打磨：犯困、坐下、久别重逢
- [ ] 多角色切换
- [ ] 开机自启、全屏自动隐藏

## 关于素材与授权

代码以 MIT 发布。**MIT 只覆盖代码，不覆盖任何游戏素材。**

明日方舟的立绘、Spine 动画、语音均为鹰角网络资产。如果你 fork 这个项目，
请保持 `assets/character/` 与 `assets/audio/` 不进入版本库，也不要在发行包里附带它们。

`src/renderer/lines.js` 中的台词全部为本项目原创示例，不含游戏内原文。
