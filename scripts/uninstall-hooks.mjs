/**
 * 从 ~/.claude/settings.json 对称移除宠物 hook（与 install-hooks.mjs 配套）。
 * 只动 hooks 键：按 command 判重删除我们的条目，事件数组空则删 key，hooks 空则删 hooks。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PET_DIR = join(homedir(), '.claude', 'desktop-pet')
const HOOK_DEST = join(PET_DIR, 'pet-hook.js')
const SETTINGS = join(homedir(), '.claude', 'settings.json')
const EVENTS = ['PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop']
const COMMAND = `node "${HOOK_DEST}"`

if (!existsSync(SETTINGS)) {
  console.log('settings.json 不存在，无需卸载。')
  process.exit(0)
}

let data
try {
  data = JSON.parse(readFileSync(SETTINGS, 'utf8'))
} catch (e) {
  console.error(`✗ 无法解析 ${SETTINGS}（JSON 语法错误），已中止。`)
  console.error(`  ${e.message}`)
  process.exit(1)
}

let removed = 0
if (data.hooks && typeof data.hooks === 'object') {
  for (const ev of EVENTS) {
    const arr = Array.isArray(data.hooks[ev]) ? data.hooks[ev] : []
    const kept = arr.filter((entry) => {
      const hs = Array.isArray(entry?.hooks) ? entry.hooks : []
      const isOurs = hs.some((h) => h?.type === 'command' && h.command === COMMAND)
      if (isOurs) removed++
      return !isOurs
    })
    if (kept.length > 0) data.hooks[ev] = kept
    else delete data.hooks[ev]
  }
  if (Object.keys(data.hooks).length === 0) delete data.hooks
}

writeFileSync(SETTINGS, JSON.stringify(data, null, 2) + '\n')
console.log(`✓ 已从 settings.json 移除 ${removed} 条宠物 hook`)

// 清理复制过去的脚本与事件文件
if (existsSync(HOOK_DEST)) {
  rmSync(HOOK_DEST)
  console.log(`✓ 已删除 ${HOOK_DEST}`)
}
console.log('提示：事件文件 events.jsonl 保留在 ~/.claude/desktop-pet/，如需清理可手动删除该目录。')
