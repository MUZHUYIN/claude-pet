# Claude Pet — Claude Code CLI 桌面宠物

复刻 OpenAI Codex 桌面宠物体验：一个**透明置顶悬浮的像素宠物**，实时反映你终端里 Claude Code 会话的工作状态（工作中 / 等待输入 / 任务完成 / 失败），并弹出气泡消息。

对齐 Codex 的设计：宠物不参与编码，纯粹是 agent 状态的**跨应用可视化层**——即使 Claude Code 窗口被最小化或切到别的应用，也能从桌面角落看到任务进度。

## 功能

- **状态动画**：agent 工具调用 → 打字（typing）；等待分析 → 托腮思考（thinking）；任务完成 → 开心（happy）；失败 → 哭泣（cry）；待机 → 呼吸 + 随机眨眼
- **动画增强**：待机 5 分钟入睡（Zzz）、拖拽中行走（walk）、释放奔跑（run）、戳一下跳跃（jump）
- **气泡消息**：任务完成摘要、失败原因、需要你注意的提醒（完成/失败气泡永久显示，点击关闭，新任务清除）
- **显示时机**：检测到 claude 进程活跃时出现，会话结束后约 9 秒自动隐藏（应用常驻后台等待）
- **交互**：拖拽移动（位置记忆）、戳一下会跳、右键菜单（切换形象/开机自启/退出）、托盘退出
- **点击穿透**：宠物透明区域不挡桌面，桌面图标仍可正常点击
- **开机自启**：右键菜单开关（Windows 登录自动后台运行）
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
主进程状态机 (working/waiting/celebrate/sad/idle；Stop 展示保持 happy/cry 60s → thinking 60s → idle，普通等待 60s 回 idle，权限等待无限保持)
   │ 进程检测 tasklist/PowerShell（只决定显示/隐藏）
   ▼
IPC push ──► 渲染进程 (Canvas 帧动画 + DOM 气泡 + 拖拽 + 行为层)
   │              └ behaviors.ts：blink/sleep/walk/run/jump 动画增强
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

**当前形象**：`bear-original`（自嘲熊原版插画风，10 动画完整素材，定稿版）。备选 `bear-v3`（程序化像素风）。

**多形象机制**：
- 形象目录：`resources/pet-assets/characters/<名字>/`（每形象含 `pet.png` + `sprites.json`）
- 切换：右键宠物 → **切换形象**（即时生效，选择持久化到 `%APPDATA%\claude-pet\state.json`）
- 默认形象：state.json 的 `character` 字段（缺省 `bear-original`）
- **窗口尺寸由形象驱动**：sprites.json 的 `window` 字段（缺省 `h = tile.h×scale + 124`），切换时底部锚定

**bear-original 素材处理**（`scripts/merge-original-sheets.ps1`，PowerShell 零依赖）：
```bash
npm run merge:original   # 直读素材 zip（D:\周靖\下载\自嘲熊\…）→ 合并 10 动画精灵表
```
- 关键处理：**逐帧四周裁剪 12px**（去除素材自带白色框线与贴边内容 — 否则渲染显示白框线条）、动画节奏 ×2.5 调慢、happy/cry 播完停末帧

**代码绘制形象**（`scripts/generate-placeholder-sprites.mjs`）：
```bash
npm run gen:sprites -- <形象名>   # 按 LAYOUTS 布局参数绘制并输出到 characters/<名字>/
```
- 绘制是参数化的（`LAYOUTS` 表控制身体椭圆/五官位置/嘴型），加新形象只需加一组布局参数

**精灵表规范**：每行一个动画状态、多列帧、RGBA（帧尺寸任意，tile 参数化）；逻辑状态经 `logicalMap` 映射（如 bear-original：`working→typing`、`waiting→thinking`、`celebrate→happy`、`sad→cry`）。

**视觉回归**：`PET_SHOT=1 npm run dev` 自动截图各状态到 `dev-shots/`。

## 已知限制

- 全屏游戏/演示等最高层窗口可能压住宠物（每 30s 自动重设置顶层级）
- Windows 透明窗内容更新时可能有极淡边缘线（平台伪影，素材裁剪后已基本消除）
- **身体内部"水渍"灰**：插画风素材的阴影/渐变区域是半透明像素，在 layered window 上与桌面直接混合，身体内部会出现不规则、略微透明的灰色，从阴影处隐约看到桌面
- **背后大型方块"阴影"**：宠物背后有大而浅的方块状阴影（可能是整窗半透明合成层的残留），黑色背景下几乎不可见，白色背景下隐约可见
- hooks 只对安装后的新会话生效
- 事件文件 >5MB 自动轮转（保留最近一份）
