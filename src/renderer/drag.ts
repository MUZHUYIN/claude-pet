/**
 * pointer capture 拖拽：不用 -webkit-app-region（它会吞掉 contextmenu，右键菜单会失效）。
 * 按住移动 → 主进程 setPosition（位置由主进程 getCursorScreenPoint 计算，
 * 不依赖 pointer 事件的 screenX —— Windows 高 DPI 下该坐标可能未按 DIP 缩放，
 * 会导致窗口位置错乱、看起来被拉伸）；位移 < 5px 视为"戳一下"。
 * 动画回调：onDragStart（walk）/ onDragEnd（run）/ onPoke（jump，先于 onDragEnd 之后触发）。
 */
export function setupDrag(
  canvas: HTMLCanvasElement,
  onDragStart: () => void,
  onDragEnd: () => void,
  onPoke: () => void
): void {
  let dragging = false
  let startX = 0
  let startY = 0

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    dragging = true
    startX = e.screenX
    startY = e.screenY
    canvas.setPointerCapture(e.pointerId)
    window.pet.dragStart()
    onDragStart()
  })

  canvas.addEventListener('pointermove', () => {
    if (!dragging) return
    // 只发"移动了"信号，坐标由主进程自己查，规避 DPI 坐标偏差
    window.pet.dragMove()
  })

  const end = (e: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    window.pet.dragEnd()
    // 先播 run（拖拽释放），再判"戳一下"（jump 覆盖 run）
    onDragEnd()
    const dist = Math.hypot(e.screenX - startX, e.screenY - startY)
    if (dist < 5) onPoke()
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.pet.openContextMenu()
  })
}
