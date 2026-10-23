import { getStroke } from 'perfect-freehand'
import { assertNever } from './assert.ts'
import type { EllipseElement, LinearElement, RectElement, StrokeElement, TextElement } from './elements.ts'
import type { Scene } from './scene.ts'
import type { Viewport } from './viewport.ts'

/** 自由手绘轮廓参数。集中一处，方便在开发页上肉眼调参。 */
export const STROKE_STYLE: {
  /** perfect-freehand 的 size = strokeWidth * sizeFactor。 */
  readonly sizeFactor: number
  readonly thinning: number
  readonly smoothing: number
  readonly streamline: number
} = {
  sizeFactor: 2,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: 0.5,
}

/** 箭头头部的最短长度，虚拟单位。 */
const ARROW_MIN_LENGTH = 8

/** 箭头头部长度随线宽放大的倍率。 */
const ARROW_LENGTH_PER_WIDTH = 4

/** 箭头头部的半角，弧度。 */
const ARROW_HALF_ANGLE = Math.PI / 7

/**
 * 把场景画到 ctx 上。
 *
 * 先清空整个画布，再按 z 序绘制；不画背景色；不读写调用方在此之前设置的任何 ctx 状态。
 * @param ctx - 目标 2D 上下文。
 * @param scene - 场景；`isDeleted` 的元素跳过。
 * @param viewport - 虚拟坐标到设备像素的映射。
 * @returns 无；相同的 (scene, viewport, ctx.canvas 尺寸) 必然产生相同的像素。
 */
export function render(ctx: CanvasRenderingContext2D, scene: Scene, viewport: Viewport): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const element of scene.elements) {
    if (element.isDeleted) continue
    switch (element.type) {
      case 'line':
      case 'arrow':
        drawLinear(ctx, element)
        break
      case 'rect':
        drawRect(ctx, element)
        break
      case 'ellipse':
        drawEllipse(ctx, element)
        break
      case 'text':
        drawText(ctx, element)
        break
      case 'stroke':
        drawStroke(ctx, element)
        break
      default:
        assertNever(element)
    }
  }
}

/**
 * 画折线；箭头再补一个填充的头部。
 * @param ctx - 目标 2D 上下文。
 * @param element - 直线或箭头元素。
 * @returns 无。
 */
function drawLinear(ctx: CanvasRenderingContext2D, element: LinearElement): void {
  const points = element.points
  const start = points[0]
  if (start === undefined) return

  ctx.strokeStyle = element.strokeColor
  ctx.lineWidth = element.strokeWidth
  ctx.beginPath()
  ctx.moveTo(element.x + start.x, element.y + start.y)
  for (const point of points) ctx.lineTo(element.x + point.x, element.y + point.y)
  ctx.stroke()

  if (element.type === 'arrow') drawArrowHead(ctx, element)
}

/**
 * 在折线末端填充一个三角形箭头。
 * @param ctx - 目标 2D 上下文。
 * @param element - 至少有两个点的箭头元素。
 * @returns 无。
 */
function drawArrowHead(ctx: CanvasRenderingContext2D, element: LinearElement): void {
  const tip = element.points[element.points.length - 1]
  const before = element.points[element.points.length - 2]
  if (tip === undefined || before === undefined) return

  const tipX = element.x + tip.x
  const tipY = element.y + tip.y
  const angle = Math.atan2(tip.y - before.y, tip.x - before.x)
  const length = Math.max(ARROW_MIN_LENGTH, element.strokeWidth * ARROW_LENGTH_PER_WIDTH)

  ctx.fillStyle = element.strokeColor
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - length * Math.cos(angle - ARROW_HALF_ANGLE), tipY - length * Math.sin(angle - ARROW_HALF_ANGLE))
  ctx.lineTo(tipX - length * Math.cos(angle + ARROW_HALF_ANGLE), tipY - length * Math.sin(angle + ARROW_HALF_ANGLE))
  ctx.closePath()
  ctx.fill()
}

/**
 * 画矩形：先填充后描边。
 * @param ctx - 目标 2D 上下文。
 * @param element - 矩形元素。
 * @returns 无。
 */
function drawRect(ctx: CanvasRenderingContext2D, element: RectElement): void {
  if (element.fill !== undefined) {
    ctx.fillStyle = element.fill
    ctx.fillRect(element.x, element.y, element.width, element.height)
  }
  ctx.strokeStyle = element.strokeColor
  ctx.lineWidth = element.strokeWidth
  ctx.strokeRect(element.x, element.y, element.width, element.height)
}

/**
 * 画椭圆：先填充后描边。
 * @param ctx - 目标 2D 上下文。
 * @param element - 椭圆元素。
 * @returns 无。
 */
function drawEllipse(ctx: CanvasRenderingContext2D, element: EllipseElement): void {
  ctx.beginPath()
  ctx.ellipse(element.x + element.width / 2, element.y + element.height / 2, element.width / 2, element.height / 2, 0, 0, 2 * Math.PI)
  if (element.fill !== undefined) {
    ctx.fillStyle = element.fill
    ctx.fill()
  }
  ctx.strokeStyle = element.strokeColor
  ctx.lineWidth = element.strokeWidth
  ctx.stroke()
}

/**
 * 画文字，`at` 是文字的视觉中心。
 * @param ctx - 目标 2D 上下文。
 * @param element - 文字元素。
 * @returns 无。
 */
function drawText(ctx: CanvasRenderingContext2D, element: TextElement): void {
  ctx.font = `${element.fontSize}px sans-serif`
  // SVG 的 text-anchor 用 middle，Canvas 用 center。
  ctx.textAlign = element.align === 'middle' ? 'center' : element.align
  ctx.textBaseline = 'middle'
  ctx.fillStyle = element.strokeColor
  ctx.fillText(element.text, element.x, element.y)
}

/**
 * 画自由手绘的一笔：perfect-freehand 生成轮廓，再填充。
 * @param ctx - 目标 2D 上下文。
 * @param element - 手绘元素。
 * @returns 无。
 */
function drawStroke(ctx: CanvasRenderingContext2D, element: StrokeElement): void {
  const outline = getStroke(
    element.points.map((point) => [element.x + point.x, element.y + point.y]),
    {
      size: element.strokeWidth * STROKE_STYLE.sizeFactor,
      thinning: STROKE_STYLE.thinning,
      smoothing: STROKE_STYLE.smoothing,
      streamline: STROKE_STYLE.streamline,
      simulatePressure: true,
      last: true,
    },
  )
  const start = outline[0]
  if (start === undefined) return

  ctx.beginPath()
  ctx.moveTo(start[0], start[1])
  for (const point of outline) ctx.lineTo(point[0], point[1])
  ctx.closePath()
  ctx.fillStyle = element.strokeColor
  ctx.fill()
}
