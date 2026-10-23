import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampToStage, commandOf, insideStage, textCommand } from '../core/annotate.ts'
import { STAGE_HEIGHT, STAGE_WIDTH, fitStage, pointerToStage, stageViewport } from '../core/stage.ts'
import type { StagePoint } from '../core/stage.ts'

/** 浮点比较的容差：这些尺寸都能用二进制精确表示，留一点余量只为不把顺序误差写成失败。 */
const EPSILON = 1e-9

/** 验收要求的两种容器：16:9 的 1200×675 与 800×450。 */
const CONTAINERS: readonly { readonly width: number; readonly height: number }[] = [
  { width: 1200, height: 675 },
  { width: 800, height: 450 },
]

/** 验收要求的两种像素比。 */
const DPRS: readonly number[] = [1, 2]

/**
 * 断言两个数在容差内相等。
 * @param actual - 实算值。
 * @param expected - 期望值。
 * @param message - 断言失败时的说明。
 * @returns 无。
 */
function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: ${actual} !== ${expected}`)
}

/** 舞台中心与四个角；每个容器的验收点。 */
const POINTS: readonly StagePoint[] = [
  { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 },
  { x: 0, y: 0 },
  { x: STAGE_WIDTH, y: 0 },
  { x: 0, y: STAGE_HEIGHT },
  { x: STAGE_WIDTH, y: STAGE_HEIGHT },
]

test('pointerToStage：两种容器 × dpr=1/2 下中心与四角都落回舞台坐标', () => {
  for (const { width, height } of CONTAINERS) {
    const fit = fitStage(width, height)
    for (const dpr of DPRS) {
      const viewport = stageViewport(width, height, dpr)
      const label = `${width}×${height} dpr=${dpr}`
      for (const point of POINTS) {
        // 舞台坐标 → 容器 CSS 坐标（浏览器里指针事件给的就是这个坐标系）。
        const cssX = fit.offsetX + point.x * fit.scale
        const cssY = fit.offsetY + point.y * fit.scale
        const got = pointerToStage(cssX, cssY, dpr, viewport)
        assertClose(got.x, point.x, `${label} (${point.x},${point.y}) x`)
        assertClose(got.y, point.y, `${label} (${point.x},${point.y}) y`)
        assert.ok(insideStage(got), `${label} (${point.x},${point.y}) 应当落在舞台内`)
      }
    }
  }
})

test('pointerToStage：舞台中心在容器中心的映射与留白无关', () => {
  // 1600×1000 比 16:9 高，上下各留 50px；中心仍是舞台中心。
  const viewport = stageViewport(1600, 1000, 1)
  assert.deepEqual(pointerToStage(800, 500, 1, viewport), { x: 640, y: 360 })
  // 留白里的点落在舞台外。
  assert.equal(insideStage(pointerToStage(800, 10, 1, viewport)), false)
  assert.deepEqual(clampToStage({ x: -20, y: 900 }), { x: 0, y: 720 })
})

test('commandOf：直线与箭头保留起终点', () => {
  const style = { color: '#e03131', width: 4 } as const
  const line = commandOf({
    tool: 'line',
    ...style,
    origin: { x: 10, y: 20 },
    current: { x: 30, y: 40 },
    samples: [],
  })
  assert.deepEqual(line, { op: 'line', from: { x: 10, y: 20 }, to: { x: 30, y: 40 }, color: '#e03131', width: 4 })

  const arrow = commandOf({
    tool: 'arrow',
    ...style,
    origin: { x: 0, y: 0 },
    current: { x: 5, y: 5 },
    samples: [],
  })
  assert.deepEqual(arrow, { op: 'arrow', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#e03131', width: 4 })
})

test('commandOf：反向拖矩形也归一化成左上角加尺寸', () => {
  const rect = commandOf({
    tool: 'rect',
    color: '#1971c2',
    width: 2,
    origin: { x: 100, y: 90 },
    current: { x: 40, y: 30 },
    samples: [],
  })
  assert.deepEqual(rect, {
    op: 'rect',
    at: { x: 40, y: 30 },
    size: { x: 60, y: 60 },
    color: '#1971c2',
    width: 2,
  })
})

test('commandOf：圆以按下点为圆心、拖动距离为半径', () => {
  const circle = commandOf({
    tool: 'circle',
    color: '#2f9e44',
    width: 8,
    origin: { x: 100, y: 100 },
    current: { x: 103, y: 104 },
    samples: [],
  })
  assert.deepEqual(circle, { op: 'circle', center: { x: 100, y: 100 }, radius: 5, color: '#2f9e44', width: 8 })
})

test('commandOf：手绘抽稀后保留首尾，且点列落在舞台内', () => {
  const samples: StagePoint[] = [
    { x: 10, y: 10 },
    { x: 12, y: 12 },
    { x: 200, y: 200 },
    { x: 400, y: 400 },
  ]
  const stroke = commandOf({ tool: 'pen', color: '#1e1e1e', width: 4, origin: samples[0] ?? { x: 0, y: 0 }, current: { x: 400, y: 400 }, samples })
  assert.equal(stroke.op, 'stroke')
  if (stroke.op !== 'stroke') return
  assert.deepEqual(stroke.points[0], { x: 10, y: 10 })
  assert.deepEqual(stroke.points[stroke.points.length - 1], { x: 400, y: 400 })
})

test('textCommand：字号用批注默认值，锚点是按下点', () => {
  assert.deepEqual(textCommand({ x: 640, y: 360 }, '你好', '#f08c00'), {
    op: 'text',
    at: { x: 640, y: 360 },
    text: '你好',
    size: 32,
    color: '#f08c00',
  })
})
