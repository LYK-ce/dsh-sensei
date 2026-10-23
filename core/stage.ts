/**
 * 舞台的几何：固定 1280×720（16:9），容器里等比 fit 居中。
 *
 * 这里只有纯算术，不碰 DOM 也不 import `node:`：host 与浏览器两个 program 都会编译这个文件。
 * 字段名与 vendor/dsh-blackboard/core/render.ts 的 `Viewport` 同构，所以它的结果可以直接
 * 交给 `render(ctx, scene, viewport)`。
 */

/** 舞台宽度，CSS 像素。 */
export const STAGE_WIDTH = 1280

/** 舞台高度，CSS 像素。 */
export const STAGE_HEIGHT = 720

/** 一个矩形的像素尺寸。 */
export interface StageSize {
  readonly width: number
  readonly height: number
}

/** 舞台的固定尺寸。 */
export const STAGE: StageSize = { width: STAGE_WIDTH, height: STAGE_HEIGHT }

/** 舞台坐标到容器像素的映射：先乘 `scale`，再加偏移。 */
export interface StageViewport {
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

/** 舞台坐标下的一点。 */
export interface StagePoint {
  readonly x: number
  readonly y: number
}

/**
 * 把 1280×720 的舞台等比放进容器并居中。
 *
 * `scale` 取两个方向里小的那个（所以放大与缩小都只是等比缩放），余下的空白平均分到两边，
 * 于是结果永远不裁切、也不会偏向一角。前置条件 `width`、`height` 都大于 0；同进程类型边界，
 * 不做运行时校验。
 * @param width - 容器宽度，CSS 像素。
 * @param height - 容器高度，CSS 像素。
 * @returns 该容器的舞台映射。
 */
export function fitStage(width: number, height: number): StageViewport {
  const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT)
  return {
    scale,
    offsetX: (width - STAGE_WIDTH * scale) / 2,
    offsetY: (height - STAGE_HEIGHT * scale) / 2,
  }
}

/**
 * 容器坐标 → 舞台坐标，`fitStage` 的逆运算：批注层的指针位置靠它落到幻灯片本地坐标。
 * @param x - 容器内横坐标，CSS 像素。
 * @param y - 容器内纵坐标，CSS 像素。
 * @param viewport - 当前容器的舞台映射。
 * @returns 舞台坐标下的一点。
 */
export function screenToStage(x: number, y: number, viewport: StageViewport): StagePoint {
  return {
    x: (x - viewport.offsetX) / viewport.scale,
    y: (y - viewport.offsetY) / viewport.scale,
  }
}

/**
 * 容器的 CSS 尺寸与 devicePixelRatio → canvas backing store 坐标系的舞台映射。
 *
 * canvas 的 `width/height` 按 CSS 尺寸 × dpr 分配，而 `fitStage` 算的是 CSS 像素；
 * 把 dpr 一并乘进来，指针位置与绘制就落在同一个设备像素坐标系里。
 * @param width - 容器宽度，CSS 像素。
 * @param height - 容器高度，CSS 像素。
 * @param dpr - 设备像素比，必须为正。
 * @returns 设备像素坐标系的舞台映射。
 */
export function stageViewport(width: number, height: number, dpr: number): StageViewport {
  const fit = fitStage(width, height)
  return { scale: fit.scale * dpr, offsetX: fit.offsetX * dpr, offsetY: fit.offsetY * dpr }
}

/**
 * 指针在容器内的位置（CSS 像素）→ 舞台坐标。
 *
 * 指针事件给的是 CSS 像素，先乘 dpr 变成 canvas 设备像素，再走 {@link screenToStage}。
 * @param x - 容器内横坐标，CSS 像素。
 * @param y - 容器内纵坐标，CSS 像素。
 * @param dpr - 设备像素比，必须为正。
 * @param viewport - 当前容器的舞台映射（设备像素坐标系）。
 * @returns 舞台坐标下的一点。
 */
export function pointerToStage(x: number, y: number, dpr: number, viewport: StageViewport): StagePoint {
  return screenToStage(x * dpr, y * dpr, viewport)
}
