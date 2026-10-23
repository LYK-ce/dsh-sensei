/**
 * 透明批注层：把画布上的指针手势折成 `DrawCommand`，并负责已提交场景与进行中手势的绘制。
 *
 * 这里没有平移缩放：舞台固定 1280×720，指针位置经 `pointerToStage` 落到舞台坐标后原样提交，
 * 所以同一份批注在任何容器尺寸下都落在幻灯片的同一处。
 */
import { clampToStage, commandOf, insideStage, textCommand } from '../core/annotate.ts'
import type { AnnotateStyle } from '../core/annotate.ts'
import { STAGE_HEIGHT, STAGE_WIDTH, pointerToStage } from '../core/stage.ts'
import type { StagePoint, StageViewport } from '../core/stage.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import { render } from '../vendor/dsh-blackboard/core/render.ts'
import { applyCommands, createScene } from '../vendor/dsh-blackboard/core/scene.ts'
import type { Scene } from '../vendor/dsh-blackboard/core/scene.ts'

/** 批注层需要的舞台侧接口；都用 getter，免得改一次工具就重挂。 */
export interface AnnotatorHost {
  /** 舞台的批注画布；尺寸与坐标系由舞台维护。 */
  readonly canvas: HTMLCanvasElement
  /** 当前的舞台映射（canvas 设备像素坐标系）。 */
  readonly viewport: () => StageViewport
  /**
   * 布局变化订阅。canvas 重设 `width/height` 等于清屏，重画必须挂在这里。
   * @param listener - 布局完成后调用。
   * @returns 退订。
   */
  readonly onLayout: (listener: () => void) => () => void
  /** 当前工具与样式。 */
  readonly style: () => AnnotateStyle
  /** 文字工具要一段文字；返回 null 表示取消。 */
  readonly askText: () => string | null
  /** 一次手势结束（或一次文字提交）交回一条命令。 */
  readonly onCommand: (command: DrawCommand) => void
}

/** 批注层句柄；面板只在舞台存在时持有它。 */
export interface AnnotateHandle {
  /**
   * 换页或收到新 op 后重画；进行中的手势会叠在它上面。
   * @param scene - 该页已提交的批注场景。
   * @returns 无。
   */
  update(scene: Scene): void
  /** 摘掉监听与布局订阅。 */
  dispose(): void
}

/** 进行中的手势；`samples` 只在手绘时增长。 */
interface LiveGesture {
  readonly pointerId: number
  readonly tool: 'pen' | 'line' | 'arrow' | 'rect' | 'circle'
  readonly color: string
  readonly width: number
  readonly origin: StagePoint
  current: StagePoint
  readonly samples: StagePoint[]
}

/**
 * 取 canvas 的 2D 上下文。
 * @param canvas - 目标 canvas。
 * @returns 它的 2D 上下文。
 * @throws Error 浏览器给不出 2D 上下文时抛出。
 */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('sensei: the browser returned no 2D context')
  return ctx
}

/**
 * 在舞台的批注画布上挂指针处理。
 * @param host - 舞台侧接口。
 * @returns 更新与销毁的句柄。
 */
export function mountAnnotator(host: AnnotatorHost): AnnotateHandle {
  const canvas = host.canvas
  const ctx = context2d(canvas)
  let scene: Scene = createScene()
  let gesture: LiveGesture | undefined

  /**
   * 画已提交场景（有手势时加上预览）。
   *
   * 指针停在 16:9 之外的留白里也允许继续拖，所以绘制要裁到舞台矩形：否则笔迹会跑到
   * 幻灯片外面，导出时又被裁掉，看起来像丢了一截。
   * @returns 无。
   */
  const redraw = (): void => {
    const viewport = host.viewport()
    const shown = gesture === undefined ? scene : applyCommands(scene, [commandOf(gesture)])
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    ctx.rect(viewport.offsetX, viewport.offsetY, STAGE_WIDTH * viewport.scale, STAGE_HEIGHT * viewport.scale)
    ctx.clip()
    render(ctx, shown, viewport)
    ctx.restore()
  }

  /**
   * 指针事件 → 舞台坐标。
   * @param event - 画布上的指针事件。
   * @returns 舞台坐标点；可能落在舞台外。
   */
  const toStage = (event: PointerEvent): StagePoint => {
    const rect = canvas.getBoundingClientRect()
    // 与舞台布局用同一个 dpr：canvas 的 backing store 就是按它分配的。
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    return pointerToStage(event.clientX - rect.left, event.clientY - rect.top, dpr, host.viewport())
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    const point = toStage(event)
    // canvas 铺满容器，16:9 之外的留白不该成为落笔点。
    if (!insideStage(point)) return
    const style = host.style()
    event.preventDefault()
    if (style.tool === 'text') {
      const text = host.askText()
      if (text === null || text === '') return
      host.onCommand(textCommand(point, text, style.color))
      return
    }
    canvas.setPointerCapture(event.pointerId)
    gesture = {
      pointerId: event.pointerId,
      tool: style.tool,
      color: style.color,
      width: style.width,
      origin: point,
      current: point,
      samples: [point],
    }
    redraw()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return
    const point = clampToStage(toStage(event))
    gesture.current = point
    // 手绘要保留每一次采样；其他工具只关心起点与当前点。
    if (gesture.tool === 'pen') gesture.samples.push(point)
    redraw()
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (gesture === undefined || event.pointerId !== gesture.pointerId) return
    gesture.current = clampToStage(toStage(event))
    if (gesture.tool === 'pen') gesture.samples.push(gesture.current)
    const command = commandOf(gesture)
    gesture = undefined
    redraw()
    host.onCommand(command)
  }

  const onPointerCancel = (): void => {
    if (gesture === undefined) return
    gesture = undefined
    redraw()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  const stopLayout = host.onLayout(redraw)
  // 挂载时先画一次：舞台可能已经完成布局，之后才轮到批注层订阅。
  redraw()

  return {
    update: (next) => {
      scene = next
      redraw()
    },
    dispose: () => {
      stopLayout()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      gesture = undefined
    },
  }
}
