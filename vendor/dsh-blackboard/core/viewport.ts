import type { Point } from './types.ts'

/** 虚拟坐标系的边长。 */
const VIRTUAL_SIZE = 1000

/** 放大上限，按 fit 视口的倍数计；下限就是 fit 视口本身（整块板刚好铺满画布）。 */
export const MAX_SCALE_FACTOR = 8

/** 虚拟坐标系到画布设备像素的映射。 */
export interface Viewport {
  /** 虚拟坐标系(0..1000)到画布像素的缩放。 */
  readonly scale: number
  /** 虚拟原点的 x 像素偏移。 */
  readonly offsetX: number
  /** 虚拟原点的 y 像素偏移。 */
  readonly offsetY: number
}

/**
 * 按画布设备像素尺寸构造视口。
 * @param canvasWidthPx - 画布宽度，设备像素。
 * @param canvasHeightPx - 画布高度，设备像素。
 * @returns 正方形画布铺满；非正方形等比铺满并居中留边。
 */
export function fitViewport(canvasWidthPx: number, canvasHeightPx: number): Viewport {
  const scale = Math.min(canvasWidthPx, canvasHeightPx) / VIRTUAL_SIZE
  return {
    scale,
    offsetX: (canvasWidthPx - VIRTUAL_SIZE * scale) / 2,
    offsetY: (canvasHeightPx - VIRTUAL_SIZE * scale) / 2,
  }
}

/**
 * 画布设备像素坐标 → 虚拟坐标。
 * @param x - 画布 x，设备像素；传入前必须已乘过 devicePixelRatio。
 * @param y - 画布 y，设备像素；传入前必须已乘过 devicePixelRatio。
 * @param viewport - 当前视口。
 * @returns 对应的虚拟坐标。
 */
export function screenToVirtual(x: number, y: number, viewport: Viewport): Point {
  return {
    x: (x - viewport.offsetX) / viewport.scale,
    y: (y - viewport.offsetY) / viewport.scale,
  }
}

/**
 * 平移视口。
 * @param viewport - 当前视口。
 * @param dx - 水平位移，画布设备像素；正数把板面往右推。
 * @param dy - 垂直位移，画布设备像素；正数把板面往下推。
 * @returns 平移后的视口，缩放不变。
 */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { scale: viewport.scale, offsetX: viewport.offsetX + dx, offsetY: viewport.offsetY + dy }
}

/**
 * 以画布上的一个点为锚缩放：该点下的虚拟坐标在缩放前后落在同一处。
 * @param viewport - 当前视口。
 * @param factor - 缩放倍数，大于 1 放大。
 * @param at - 锚点，画布设备像素。
 * @param fitScale - 同一画布尺寸下 fit 视口的缩放，用作下限。
 * @returns 缩放后的视口，缩放夹在 `fitScale` 与 `fitScale * MAX_SCALE_FACTOR` 之间。
 */
export function zoomAt(viewport: Viewport, factor: number, at: Point, fitScale: number): Viewport {
  const scale = Math.min(Math.max(viewport.scale * factor, fitScale), fitScale * MAX_SCALE_FACTOR)
  const ratio = scale / viewport.scale
  return {
    scale,
    offsetX: at.x - (at.x - viewport.offsetX) * ratio,
    offsetY: at.y - (at.y - viewport.offsetY) * ratio,
  }
}

/**
 * 把视口拉回可视范围：缩放到 fit 时回到居中，否则板面在横竖两个方向上都至少要盖住画布中线，
 * 于是怎么拖都不会把整块板推出视野。
 * @param viewport - 当前视口。
 * @param fit - 同一画布尺寸下的 fit 视口。
 * @param canvasWidthPx - 画布宽度，设备像素。
 * @param canvasHeightPx - 画布高度，设备像素。
 * @returns 夹好的视口。
 */
export function clampViewport(
  viewport: Viewport,
  fit: Viewport,
  canvasWidthPx: number,
  canvasHeightPx: number,
): Viewport {
  // 缩到底就是"看整块板"，此时平移没有意义，直接回到居中。
  if (viewport.scale <= fit.scale) return fit
  const board = VIRTUAL_SIZE * viewport.scale
  const clampAxis = (offset: number, canvasPx: number): number =>
    Math.min(Math.max(offset, canvasPx / 2 - board), canvasPx / 2)
  return {
    scale: viewport.scale,
    offsetX: clampAxis(viewport.offsetX, canvasWidthPx),
    offsetY: clampAxis(viewport.offsetY, canvasHeightPx),
  }
}
