# Claude Pet — Claude Code CLI 桌面宠物

复刻 OpenAI Codex 桌面宠物体验：一个**透明置顶悬浮的像素宠物**，实时反映你终端里 Claude Code 会话的工作状态（工作中 / 等待输入 / 任务完成 / 失败），并弹出气泡消息。

对齐 Codex 的设计：宠物不参与编码，纯粹是 agent 状态的**跨应用可视化层**——即使 Claude Code 窗口被最小化或切到别的应用，也能从桌面角落看到任务进度。

## 功能

- **状态动画**：agent 工具调用 → 奔跑/敲键盘；等待用户注意 → 停下盯着你；任务完成 → 挥手庆祝；失败 → 哭泣
- **气泡消息**：任务完成摘要、失败原因、需要你注意的提醒（自动消失，点击关闭）
- **显示时机**：检测到 claude 进程活跃时出现，会话结束后约 9 秒自动隐藏（应用常驻后台等待）
- **交互**：拖拽移动（位置记忆）、戳一下会跳、右键/托盘退出
- **点击穿透**：宠物透明区域不挡桌面，桌面图标仍可正常点击
- **单实例**：多个终端开多个 claude 会话也只有一个宠物

## 架构

```
claude CLI (任意终端)
   │ hooks: PostToolUse / UserPromptSubmit / Notification / Stop
   ▼
pet-hook.js (~/.claude/desktop-pet/，零依赖 Node，复制安装)
   │ append JSONL
   ▼
%USERPROFILE%\.claude\desktop-pet\events.jsonl   ← 唯一事实源
   │ fs.watch + 轮询 (watcher)
   ▼
主进程状态机 (working/waiting/celebrate/sad/idle + 超时降级)
   │ 进程检测 tasklist/PowerShell（只决定显示/隐藏）
   ▼
IPC push ──► 渲染进程 (Canvas 帧动画 + DOM 气泡 + 拖拽)
```

## 快速开始

```bash
npm install

# 开发模式（透明窗 + 热更新）
npm run dev

# 安装 hooks 到 ~/.claude/settings.json（自动备份为 settings.json.bak，只追加 hooks 键）
npm run hooks:install
# 卸载：npm run hooks:uninstall

# 打包（输出到 build/：ClaudePet-portable.exe + ClaudePet Setup.exe）
npm run build
```

安装 hooks 后，**下次启动的 claude 会话**即会开始向宠物推送事件（已运行的会话需重启）。

## 开发调试

```bash
# 不跑真实 claude，直接注入模拟事件验证动画/气泡
npm run sim -- working      # 工具调用中
npm run sim -- waiting      # 等待用户注意 + 气泡
npm run sim -- celebrate    # 任务完成 + 气泡
npm run sim -- sad          # 任务失败 + 气泡
npm run sim -- prompt       # 用户提交消息
npm run sim -- stop-error   # Stop + error

# 自动截图回归（注入事件序列并截图到 dev-shots/，用于资产替换后视觉验证）
PET_SHOT=1 npm run dev
```

## 更换美术资源（多形象机制）

**当前形象**：`bear-v3`（自嘲熊风像素熊，定稿版）。`bear-v2` 作为备选保留。

**多形象机制**：
- 形象目录：`resources/pet-assets/characters/<名字>/`（每形象含 `pet.png` + `sprites.json`）
- 切换：右键宠物 → **切换形象**（即时生效，选择持久化到 `%APPDATA%\claude-pet\state.json`）
- 默认形象：state.json 的 `character` 字段（缺省 `bear-v3`）

**生成/新增形象**（代码程序化绘制，`scripts/generate-placeholder-sprites.mjs`）：
```bash
npm run gen:sprites -- <形象名>   # 按 LAYOUTS 布局参数绘制并输出到 characters/<名字>/
```
- 绘制是参数化的（`LAYOUTS` 表控制身体椭圆/五官位置/嘴型），加新形象只需加一组布局参数
- 或按 codexpet 规范（9 行 × 6 列、32×32、RGBA）用 Aseprite 管线制作后放入新目录，更新 `sprites.json`

**精灵表规范**：每行一个动画状态（`idle / left-run / right-run / jump / wave / fail / wait / working / pending`，对应 codexpet 9 行）；逻辑状态经 `logicalMap` 映射（`celebrate→wave`、`sad→fail`）。

**视觉回归**：`PET_SHOT=1 npm run dev` 自动截图各状态到 `dev-shots/`。

渲染层通过 `logicalMap` 把逻辑状态映射到动画（`celebrate→wave`、`sad→fail`），换动画名只需改表。

## 已知限制

- 全屏游戏/演示等最高层窗口可能压住宠物（每 30s 自动重设置顶层级）
- Windows 透明窗偶发重绘闪烁（固定尺寸已缓解）
- hooks 只对安装后的新会话生效
- 事件文件 >5MB 自动轮转（保留最近一份）
