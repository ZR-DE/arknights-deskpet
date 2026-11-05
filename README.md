# arknights-deskpet

一个安静的桌面伴侣。透明悬浮、贴边常驻、不抢焦点，会记住今天是陪你的第几天。

> **本项目只包含代码，不包含也不分发任何游戏素材。**
> 骨骼与语音需自行准备，见 [assets/README.md](assets/README.md)。

## 功能

- 无边框透明窗口，不占任务栏；鼠标只在角色轮廓内生效，其余区域穿透到桌面
- Spine 骨骼实时渲染，不是静态图也不是视频
- 待机时有呼吸起伏与缓慢换重心，不会杵着不动
- 待机 / 放松 / 坐下 / 睡着 四段状态按「安静了多久」自动演进，一碰就醒
- 点她、拖她都会说话，带气泡；有语音包时是真人语音，字幕与语音同一份文本
- 久不操作会主动搭话，深夜会催你睡；每天第一次见面报出陪伴天数
- 多套时装，托盘里直接换，选择会记住
- 托盘常驻：显示/隐藏、总在最前、换装、静音、回右下角、退出

## 快速开始

**方式一（推荐）**：双击 `启动桌宠.cmd`。会闪一下命令窗口，然后她出现在屏幕右下角。

装好依赖后 `node_modules/electron/dist/electron.exe` 就是完整的运行环境，
系统不需要安装 Node.js。脚本刻意写成纯 ASCII + CRLF 换行，否则中文系统的
cmd 按 GBK 解析会报错。

**方式二**：`npm install && npm start`（走 `scripts/start.js`，会清掉可能存在的
`ELECTRON_RUN_AS_NODE`，这个变量会让 Electron 退化成纯 Node）。

没有素材时窗口是空的，把素材放进 `assets/character/` 再启动。

## 换装

时装清单在 `src/shared/outfits.json`，托盘菜单和导入脚本都以它为准。加一套就加一行，然后：

```bash
node scripts/import-outfits.js
```

脚本会把 `素材/Amiya/<编号>/` 下的三件套复制到 `assets/character/` 并统一改名，
同时改写 atlas 里的页名——原始文件名带 `#`，在 URL 里会被当作 fragment 截断，图集 404。

## 语音

语音包是「一个角色一个长音频」，没有分隔标记，需要三步：

```bash
# 1. 按静音切分（只跑一次）
python scripts/segment-voice.py assets/audio/amiya.ogg -o assets/audio/amiya.segments.json

# 2. 双击 标注语音.cmd 逐句听写

# 3. 重开桌宠生效
```

切点靠猜不准，可以先跑一次 `--analyze` 看间隔分布，谷底就是合适的 `--gap`；切错了也能在标注时合并。

| 标注窗口操作 | 说明 |
|---|---|
| 空格 | 播放 / 停止当前段 |
| ↑ ↓ | 上下切换 |
| Enter | 存下这句并跳下一段 |
| 每行 `⇧` | 与上一段合并 |
| Ctrl+S | 保存 |
| 留空 | 这句不用 |

未标注的句子不会被选中；一句都没有时退回 `lines.js` 的原创台词。
托盘里的**静音**只显示文字，共享屏幕时用这个。

## 脚本

| 命令 | 用途 |
|---|---|
| `npm start` | 启动 |
| `npm run dev` | 启动并弹出 DevTools |
| `npm run spine:test` | 验证窗口：打印动画名、蒙皮、包围盒 |
| `npm run voice:label` | 语音标注窗口 |
| `npm run icon` | 生成托盘图标 |
| 双击 `调试启动.cmd` | 带日志窗口启动 |

程序没有任务栏图标，**退出只能从托盘菜单**。

## 目录

```
src/main/main.js            窗口、穿透、拖拽、托盘、自定义协议
src/main/memory.js          陪伴记录（天数 / 连续天数 / 点击次数）
src/main/settings.js        偏好设置（当前时装、是否静音）
src/shared/outfits.json     时装清单（唯一来源）
src/preload/preload.js      受控的 IPC 桥
src/renderer/character.js   动画名映射
src/renderer/pet.js         渲染、状态机、命中检测、气泡定位、装卸时装
src/renderer/voice.js       语音解码与分句播放
src/renderer/lines.js       原创台词（无语音时的兜底）
src/renderer/audio-label.*  语音标注工具
src/renderer/spine-test.js  素材验证页
src/renderer/vendor/        pixi 与 pixi-spine 预构建文件
assets/                     素材（character 与 audio 不入库）
scripts/                    启动器、时装导入、语音切分、图标生成
*.cmd                       双击入口（启动 / 调试 / 标注）
```

运行时数据在 Electron 的 `userData` 目录（托盘「数据文件夹」可打开）：
删 `companion.json` 是重新认识你，删 `settings.json` 只重置时装与音量。

## 开发备注

- **窗口尺寸就是角色尺寸**。渲染层按 `innerWidth/innerHeight` 自适应，改体型改 `main.js` 的
  `WIN_WIDTH/WIN_HEIGHT` 即可；但要和 `pet.js` 的 `BUBBLE_RESERVE` 同比例改，否则缩放不是预期倍数。
- **CSP 需要 `unsafe-eval`**：pixi 7 用 `new Function` 生成着色器。应用不加载任何远程内容。
- **头骨坐标要校验**：不同骨架的根变换不可比（某套时装的 `H_Head` 换算出来是 -717），
  必须落在包围盒内才采信。头顶高度靠 `renderer.extract` 扫每列最高像素得到，不写死。
- **姿态变化要走 `resettle`**：重算缩放、贴底、重扫剖面、更新命中框，缺一样就会出框、
  气泡飘错位置或点击判定错位。
- **语音整包解码**：切成一堆小文件每次起播有 20~50ms 延迟，会有杂音。整包进内存按时间戳截取。

## 路线图

- [x] 透明窗口 / 穿透 / 拖拽 / 托盘
- [x] Spine 渲染与多动画切换
- [x] 点击反应、气泡、陪伴天数
- [x] 语音播放、分句标注、静音
- [x] 多套时装热切换
- [x] 动画状态机：放松 / 坐下 / 深夜入睡
- [ ] 久别重逢的过渡
- [ ] 语音按场景分类
- [ ] 多角色切换
- [ ] 开机自启、全屏自动隐藏

## 授权

代码以 MIT 发布，**MIT 只覆盖代码，不覆盖任何游戏素材**。

立绘、Spine 动画、语音均为鹰角网络资产。fork 时请保持 `assets/character/` 与
`assets/audio/` 不进入版本库，也不要随发行包分发。标注出的字幕
（`assets/audio/amiya.lines.json`）是游戏台词原文，同样留在这两个目录里。
`src/renderer/lines.js` 的台词为本项目原创。
