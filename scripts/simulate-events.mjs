/**
 * 开发调试：直接往事件文件写测试事件，驱动状态机动画，无需跑真 claude。
 * 用法:
 *   npm run sim -- working            # 工具调用（工作中动画）
 *   npm run sim -- waiting            # 需要用户注意（等待动画 + 气泡）
 *   npm run sim -- celebrate          # 任务完成（欢快动画 + 气泡）
 *   npm run sim -- sad                # 任务失败（难过动画 + 气泡）
 *   npm run sim -- prompt             # 用户提交消息
 *   npm run sim -- stop-error         # Stop + error=true
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const kind = process.argv[2] || 'working'
const DIR = join(homedir(), '.claude', 'desktop-pet')
const FILE = join(DIR, 'events.jsonl')
mkdirSync(DIR, { recursive: true })

const base = { ts: Date.now(), session_id: 'sim-session', cwd: process.cwd() }

const SAMPLES = {
  working: { ...base, event: 'PostToolUse', tool_name: 'Read', summary: '读取了 src/main/index.ts' },
  waiting: { ...base, event: 'Notification', summary: '任务完成，需要你回来查看' },
  celebrate: { ...base, event: 'Stop', error: false, summary: '已完成 3 个文件的格式化与测试用例编写' },
  sad: { ...base, event: 'Stop', error: true, summary: '工具执行失败：命令不存在' },
  prompt: { ...base, event: 'UserPromptSubmit', summary: '' },
  'stop-error': { ...base, event: 'Stop', error: true, summary: '' }
}

const line = SAMPLES[kind]
if (!line) {
  console.error(`未知事件类型: ${kind}`)
  console.error('可用: working | waiting | celebrate | sad | prompt | stop-error')
  process.exit(1)
}

appendFileSync(FILE, JSON.stringify(line) + '\n')
console.log(`✓ 已写入模拟事件 [${kind}] → ${FILE}`)
