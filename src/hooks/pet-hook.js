'use strict'
/**
 * Claude Code hook 脚本：读 stdin 的 hook payload，精简成一行 JSONL 追加到事件文件。
 * 设计约束：
 *   - 零依赖纯 Node CommonJS（被复制到 ~/.claude/desktop-pet/ 独立运行，不依赖项目 node_modules）
 *   - 整体 try/catch：任何异常都不得中断 claude 主流程
 *   - 事件文件 >5MB 轮转（rename 为 events.jsonl.1）
 */
const fs = require('fs')
const path = require('path')

const EVENTS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'desktop-pet')
const FILE = path.join(EVENTS_DIR, 'events.jsonl')
const MAX_BYTES = 5 * 1024 * 1024
const MAX_SUMMARY = 200

function truncate(s, n) {
  if (typeof s !== 'string') return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** 从 assistant message 里取第一个 text block */
function firstTextBlock(msg) {
  if (!msg) return ''
  const content = msg.content
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b.text === 'string' && b.text.trim()) return b.text.trim()
    }
  }
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text.trim()
  return ''
}

/** 按事件类型截取气泡摘要（结构随 CLI 版本可能有变，全部兜底） */
function extractSummary(p) {
  try {
    const ev = p.hook_event_name
    if (ev === 'Stop') return truncate(firstTextBlock(p.message), MAX_SUMMARY)
    if (ev === 'Notification') {
      const m = p.message
      if (typeof m === 'string') return truncate(m, MAX_SUMMARY)
      return truncate(firstTextBlock(m), MAX_SUMMARY)
    }
    if (ev === 'PostToolUse') {
      const r = p.tool_response
      const s = r && (typeof r === 'string' ? r : r.summary || r.output)
      return truncate(typeof s === 'string' ? s : '', 80)
    }
  } catch (_) {}
  return ''
}

function rotateIfNeeded() {
  try {
    if (fs.statSync(FILE).size > MAX_BYTES) fs.renameSync(FILE, FILE + '.1')
  } catch (_) {}
}

let buf = ''
process.stdin.on('data', (c) => {
  buf += c
})
process.stdin.on('end', () => {
  try {
    const p = JSON.parse(buf)
    const msg = p.message || {}
    const line = {
      ts: Date.now(),
      event: p.hook_event_name,
      session_id: p.session_id,
      cwd: p.cwd,
      tool_name: p.tool_name,
      error: p.hook_event_name === 'Stop' && msg.stop_reason === 'error',
      summary: extractSummary(p)
    }
    rotateIfNeeded()
    fs.mkdirSync(EVENTS_DIR, { recursive: true })
    fs.appendFileSync(FILE, JSON.stringify(line) + '\n')
  } catch (_) {
    // 静默失败：hook 绝不能影响 claude
  }
})
