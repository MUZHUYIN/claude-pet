/**
 * 把宠物 hook 安装进 ~/.claude/settings.json。
 * 安全约束：
 *   - 只动 data.hooks 键，env/theme/model（含敏感 token）原样保留
 *   - 首次安装备份 settings.json.bak（已存在则跳过）
 *   - 按 command 判重，幂等：重复运行不叠加
 *   - settings.json 解析失败拒绝写入；任何输出都不打印配置全文
 * hook 脚本复制到 %USERPROFILE%\.claude\desktop-pet\（ASCII 路径）：
 *   项目路径含中文，经 cmd 执行 hook 有 GBK 编码风险；该路径与 app 安装位置无关。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SRC = join(here, '..', 'src', 'hooks', 'pet-hook.js')
const PET_DIR = join(homedir(), '.claude', 'desktop-pet')
const HOOK_DEST = join(PET_DIR, 'pet-hook.js')
const SETTINGS = join(homedir(), '.claude', 'settings.json')
const EVENTS = ['PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop']
const COMMAND = `node "${HOOK_DEST}"`

// 1. 复制 hook 脚本到 ASCII 稳定路径
mkdirSync(PET_DIR, { recursive: true })
cpSync(HOOK_SRC, HOOK_DEST)

// 2. 首次安装前备份
if (existsSync(SETTINGS) && !existsSync(SETTINGS + '.bak')) {
  cpSync(SETTINGS, SETTINGS + '.bak')
  console.log(`已备份原配置 → ${SETTINGS}.bak`)
}

// 3. 读取配置（解析失败拒绝写入）
let data
if (!existsSync(SETTINGS)) {
  data = {}
} else {
  const raw = readFileSync(SETTINGS, 'utf8')
  try {
    data = JSON.parse(raw)
  } catch (e) {
    console.error(`✗ 无法解析 ${SETTINGS}（JSON 语法错误），已中止，未做任何修改。`)
    console.error(`  ${e.message}`)
    process.exit(1)
  }
}

// 4. 只动 hooks 键，按 command 判重追加
if (typeof data !== 'object' || data === null) {
  console.error('✗ settings.json 根节点不是对象，已中止。')
  process.exit(1)
}
data.hooks = data.hooks ?? {}
let added = 0
for (const ev of EVENTS) {
  const arr = Array.isArray(data.hooks[ev]) ? data.hooks[ev] : []
  const exists = arr.some((entry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => h?.type === 'command' && h.command === COMMAND)
  )
  if (!exists) {
    arr.push({ hooks: [{ type: 'command', command: COMMAND }] })
    added++
  }
  data.hooks[ev] = arr
}

// 5. 写回
writeFileSync(SETTINGS, JSON.stringify(data, null, 2) + '\n')
console.log(`✓ hook 已安装: ${HOOK_DEST}`)
console.log(`✓ settings.json 已更新: ${EVENTS.join('/')} 共新增 ${added} 条（重复运行幂等，不会叠加）`)
console.log('  下次启动 claude 会话时生效（已运行的会话需重启）。')
