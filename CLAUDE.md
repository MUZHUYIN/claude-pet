# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Claude Code CLI 桌面宠物：透明置顶悬浮像素宠物，实时反映终端里 Claude Code 会话的工作状态（工作中/等待/完成/失败），带气泡消息。复刻 OpenAI Codex 桌面宠物体验。

## 常用命令

```bash
npm run dev                 # 开发模式（electron-vite，main 改动需重启）
npm run typecheck           # 类型检查（main/preload + renderer 两侧）
npm run gen:sprites -- <名字>  # 生成像素形象到 resources/pet-assets/characters/<名字>/
npm run merge:original      # 合并自嘲熊素材包 zip → bear-original 精灵表（PowerShell，零依赖）
node scripts/fill-holes.mjs # 合并后必跑：填充硬化产生的内部透明洞（跳过会复发"水渍灰"）
npm run sim -- working|waiting|celebrate|sad|prompt|stop-error  # 注入模拟事件（不跑真实 claude）
npm run hooks:install       # 安装 hooks 到 ~/.claude/settings.json（幂等，自动备份 .bak）
npm run hooks:uninstall     # 对称移除
npx electron-vite build && npx electron-builder --win   # 打包 portable+nsis 到 build/
PET_SHOT=1 npm run dev      # 自动注入事件序列并截图各状态到 dev-shots/（形象改动的视觉回归）
```

## 架构（数据流）

```
claude CLI（任意终端）
  │ hooks: PostToolUse / UserPromptSubmit / Notification / Stop
  ▼
pet-hook.js（复制到 ~/.claude/desktop-pet/，零依赖 CommonJS，不依赖项目 node_modules）
  │ append JSONL
  ▼
%USERPROFILE%\.claude\desktop-pet\events.jsonl  ← 唯一事实源
  │ fs.watch + 1s 轮询（Windows 单文件 watch 偶发丢事件，双保险）
  ▼
主进程状态机（事件驱动，无定时器）＋ 进程检测（仅决定显示/隐藏，两者解耦）
  ▼
IPC 'pet:event' 推送 ──► 渲染进程（Canvas 帧动画 + DOM 气泡 + pointer capture 拖拽）
```

**进程分层**：
- `src/main/`：窗口/点击穿透/拖拽/状态机/进程检测/托盘。零运行时依赖（只用 Electron 内置 API）
- `src/preload/`：contextBridge 暴露 `window.pet`；资产经 `ipcRenderer.invoke('pet:get-asset-root')` 动态查询（形象切换后 reload 生效）
- `src/renderer/`：Canvas 动画循环、气泡 DOM、拖拽。**渲染层不感知形象内容**，只按 sprites.json 渲染

## 状态机与动画

- 逻辑状态 `hidden | idle | working | waiting | celebrate | sad`；**两条时间链自动流转**（其余无限保持直到切换）：
  - **展示保持时间链**（成功/失败对称）：Stop → celebrate（happy 循环）或 sad（cry 循环）+ **永久气泡** → 60s 后自动转 waiting（thinking）→ 再 60s 无输入回 idle。celebrate/sad 期间收到普通等待通知不打断 happy/cry（展示保持保护：按剩余时间重建时间链，保证展示满 60s）
  - **等待时间链**：Notification 区分类型——summary 含 `waiting for your input`（普通等待输入）→ thinking 60s 后回 idle；权限/决策等待（`needs your permission` 等）→ 一直保持 thinking 等用户选择（并清掉时间链残留定时器）
  - PostToolUse/UserPromptSubmit → working（并清掉旧结果气泡）（ttl≤0 = 永久，新任务开始时清除，点击可关闭）
  - 进程消失（连续 3 轮 ≈9s）→ hidden；进程活跃 → idle
  - **窗口显示只由进程检测驱动**：启动时 watcher 重放 events.jsonl 历史事件属"过去的状态"。两层防护缺一不可：①booting 抑制期（首次回调前）onState 不触发显示、事件新鲜度兜底返回 null；②**历史重放不武装时间链定时器**（`handleEvent(ev, replay)` 跳过 Stop/Notification 的 60s 定时器）——否则重放武装的定时器在 booting 结束后触发状态切换，绕过抑制把宠物拉出来（已踩坑：开机 60s 后 `[show] onState:waiting`，直到打开 claude 都不隐藏）
  - **diag.log 时间戳是 UTC**（`toISOString()`），比本地时间慢 8 小时——排查开机时序时先换算，否则跨天条目无法对齐
  - 定时器：`state-machine.ts` 的 `idleTimer`（waiting 回 idle + celebrate 转 waiting 共用），任何新事件/`sessionGone` 都会 clearTimeout
- **行为层 `src/renderer/behaviors.ts`**：逻辑状态之外的动画增强——idle 随机 blink（5-15s）、idle 5 分钟 sleep、拖拽中 walk、拖拽释放 run 1.5s、戳一下 jump。全部经 `pet.hasAnimation()` 守卫（形象缺动画时自动降级）
- 精灵动画经 `logicalMap` 映射（如 bear-original：working→typing、waiting→thinking、celebrate→happy、sad→cry）；**happy/cry 循环播放**（完成态持续开心/哭泣），仅 blink/jump 是 `loop=false` + `followUp=idle`（播完回 idle）
- **帧对齐**：渲染层预计算每帧内容 bbox（`computeFrameOffsets`），绘制时水平居中 + 脚底对齐（消除素材帧间大小跳变）
- 精灵表格式对齐 codexpet 社区规范：每行一个动画状态、多列帧、RGBA（帧尺寸任意，tile 参数化）

## 多形象机制

- 形象目录 `resources/pet-assets/characters/<名字>/`（pet.png + sprites.json），extraResources 打包
- 切换：右键宠物 → 切换形象（写入 `%APPDATA%\claude-pet\state.json` 的 `character` 字段 + reload）
- **窗口尺寸由形象驱动**：sprites.json 的 `window` 字段（缺省 `h = tile.h×scale + 124`）；切换时底部锚定 setBounds（宠物脚底不跳动）
- **bear-original**（当前定稿形象）：`scripts/merge-original-sheets.ps1` 合并素材 zip（PowerShell 零依赖，zip 直读）；代码绘制形象用 `generate-placeholder-sprites.mjs` 的 `LAYOUTS` 参数表
- **开机自启**：右键宠物 → 开机自启（checkbox）。portable 版必须用 `PORTABLE_EXECUTABLE_FILE`（启动器真实路径，execPath 是临时解压路径重启失效），勾选状态检查也要传 path

## Windows 特有坑（已踩过，勿重犯）

- **DPI 坐标偏差**：渲染层 pointer 事件 `screenX` 可能与主进程 DIP 不一致 → 拖拽位置一律用主进程 `screen.getCursorScreenPoint()` 计算，不要用渲染层坐标
- **canvas transform 丢失**：窗口被系统改动时 `ctx.scale(dpr)` 可能失效 → 每帧强制 `ctx.setTransform(dpr,0,0,dpr,0,0)`；hit-test 用 `getBoundingClientRect()` + dpr 换算（不要用 `getTransform()` 的 e/f——会被每帧重置）
- **setPosition 被 Windows 丢弃**：高频拖动时窗口实际位置与 `getPosition()` 不一致 → 穿透判定用期望位置 `trackedPos`（drag-move 时更新），周期用 getPosition 校准
- **窗口尺寸被系统改**（透明窗+边缘吸附）：`getSize()` 可能返回缓存值 → resize 事件 20ms 后无条件 `setBounds({width,height})` 回正
- **浮点坐标丢失**：`grid[y][12.5]` 写入非整数下标，整数读取时消失 → `px()` 必须 `Math.round`
- **state.json 被覆盖**：保存位置必须合并写入（`{...prev, x, y}`），否则 `character` 字段丢失
- **中文路径**：hook 脚本复制到 `%USERPROFILE%\.claude\desktop-pet\`（ASCII），不引用含中文的项目路径
- **PowerShell 脚本 BOM**：PS 5.1 按 GBK 读无 BOM 脚本 → 中文乱码/解析错误 → `.ps1` 必须 UTF-8 BOM（Write 后检查文件头 ef bb bf）
- **PowerShell 变量名大小写不敏感**：`$frames` 赋值会覆盖 `$FRAMES`（hashtable）→ 变量名必须区分大小写不冲突
- **素材自带白色框线/贴边内容**：第三方素材帧可能有白色矩形框线（裁剪残留，与主体分离）和贴边元素（键盘/地面）——**必须逐帧裁剪**（bear-original 裁 12px）否则渲染后显示白框线条（与窗口伪影区分：素材白线是"部分帧、边数不定、硬化变粗"）
- **Electron 透明窗白框伪影**：WS_EX_LAYERED 窗口内容更新时的边缘伪影是平台级问题，setShape/thickFrame/GPU 开关均无效（GPU 开关还会导致完全不渲染）——先排查素材层（白线/贴边）再归因平台
- **透明窗半透明像素与桌面混合**（"水渍"灰，已缓解、残留轻微）：插画风素材的阴影/渐变是半透明像素，layered window 上直接与桌面混合 → 身体内部出现"水渍"灰。缓解组合拳：灰色半透明硬化（merge 脚本）→ 洞填充（fill-holes.mjs，必跑）→ **scale 1.0 无插值绘制**（改 scale 或跳过填洞会复发）。宠物背后大方块阴影已解决（canvas 无暗色残留填充）；alpha 硬化可进一步消除但会破坏插画风边缘（锯齿）

## hooks 集成安全约束

- `install-hooks.mjs` 只动 `~/.claude/settings.json` 的 `hooks` 键：首次备份 `.bak`、按 command 判重幂等、JSON 解析失败拒绝写入、**任何输出不打印配置全文**（文件含 API token）
- `pet-hook.js` 整体 try/catch，**任何异常不得中断 claude 主流程**；事件文件 >5MB 轮转（rename .1）
- hooks 对已运行的 claude 会话不生效（需新会话）

## 调试手段

- `diag.log`（`~/.claude/desktop-pet/`）：穿透状态/拖拽/异常记录；主进程全局 uncaughtException 也写这里（不弹窗）
- 渲染进程崩溃自动 reload（`render-process-gone`）
- `npm run sim` 是主力测试手段（不跑真实 claude）
