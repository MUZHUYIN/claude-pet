# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Claude Code CLI 桌面宠物：透明置顶悬浮像素宠物，实时反映终端里 Claude Code 会话的工作状态（工作中/等待/完成/失败），带气泡消息。复刻 OpenAI Codex 桌面宠物体验。

## 常用命令

```bash
npm run dev                 # 开发模式（electron-vite，main 改动需重启）
npm run typecheck           # 类型检查（main/preload + renderer 两侧）
npm run gen:sprites -- <名字>  # 生成像素形象到 resources/pet-assets/characters/<名字>/
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

- 逻辑状态 `hidden | idle | working | waiting | celebrate | sad`，**无限保持直到切换**（无超时定时器）：
  - PostToolUse/UserPromptSubmit → working（并清掉旧结果气泡）
  - Notification → waiting + 气泡 8s；Stop 成功 → celebrate + **永久气泡**；Stop 失败 → sad + **永久气泡**（ttl≤0 = 永久，新任务开始时清除，点击可关闭）
  - 进程消失（连续 3 轮 ≈9s）→ hidden；进程活跃 → idle
- 精灵动画经 `logicalMap` 映射（celebrate→wave、sad→fail）；逻辑状态实际只用到 6 个动画（idle/working/wait/wave/fail/jump），left-run/right-run/pending 暂为占位
- 精灵表格式对齐 codexpet 社区规范：每行一个动画状态、多列帧、32×32、RGBA

## 多形象机制

- 形象目录 `resources/pet-assets/characters/<名字>/`（pet.png + sprites.json），extraResources 打包
- 切换：右键宠物 → 切换形象（写入 `%APPDATA%\claude-pet\state.json` 的 `character` 字段 + reload）
- 代码绘制形象：`scripts/generate-placeholder-sprites.mjs` 用 `LAYOUTS` 参数表（身体椭圆/五官位置/嘴型）参数化绘制，加新形象只需加一组布局参数 + 零依赖 PNG 编码器
- 用 Aseprite 管线制作的素材也可放入新目录（格式兼容即零改动）

## Windows 特有坑（已踩过，勿重犯）

- **DPI 坐标偏差**：渲染层 pointer 事件 `screenX` 可能与主进程 DIP 不一致 → 拖拽位置一律用主进程 `screen.getCursorScreenPoint()` 计算，不要用渲染层坐标
- **canvas transform 丢失**：窗口被系统改动时 `ctx.scale(dpr)` 可能失效 → 每帧强制 `ctx.setTransform(dpr,0,0,dpr,0,0)`；hit-test 用 `getBoundingClientRect()` + dpr 换算（不要用 `getTransform()` 的 e/f——会被每帧重置）
- **setPosition 被 Windows 丢弃**：高频拖动时窗口实际位置与 `getPosition()` 不一致 → 穿透判定用期望位置 `trackedPos`（drag-move 时更新），周期用 getPosition 校准
- **窗口尺寸被系统改**（透明窗+边缘吸附）：`getSize()` 可能返回缓存值 → resize 事件 20ms 后无条件 `setBounds({width,height})` 回正
- **浮点坐标丢失**：`grid[y][12.5]` 写入非整数下标，整数读取时消失 → `px()` 必须 `Math.round`
- **state.json 被覆盖**：保存位置必须合并写入（`{...prev, x, y}`），否则 `character` 字段丢失
- **中文路径**：hook 脚本复制到 `%USERPROFILE%\.claude\desktop-pet\`（ASCII），不引用含中文的项目路径

## hooks 集成安全约束

- `install-hooks.mjs` 只动 `~/.claude/settings.json` 的 `hooks` 键：首次备份 `.bak`、按 command 判重幂等、JSON 解析失败拒绝写入、**任何输出不打印配置全文**（文件含 API token）
- `pet-hook.js` 整体 try/catch，**任何异常不得中断 claude 主流程**；事件文件 >5MB 轮转（rename .1）
- hooks 对已运行的 claude 会话不生效（需新会话）

## 调试手段

- `diag.log`（`~/.claude/desktop-pet/`）：穿透状态/拖拽/异常记录；主进程全局 uncaughtException 也写这里（不弹窗）
- 渲染进程崩溃自动 reload（`render-process-gone`）
- `npm run sim` 是主力测试手段（不跑真实 claude）
