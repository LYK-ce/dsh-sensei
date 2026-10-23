import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STAGE_HEIGHT, STAGE_WIDTH, fitStage, screenToStage } from '../core/stage.ts'

/** 浮点比较的容差：这些尺寸都是二进制的精确值，留一点余量只为不把顺序误差写成失败。 */
const EPSILON = 1e-9

/** 三组验收容器，外加几个极端比例（容器比舞台更高、更宽、正方形）来跑属性检查。 */
const CONTAINERS: readonly { readonly width: number; readonly height: number }[] = [
  { width: 1200, height: 675 },
  { width: 800, height: 450 },
  { width: 1600, height: 1000 },
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
  { width: 1000, height: 1000 },
  { width: 2000, height: 500 },
  { width: 320, height: 240 },
]

/**
 * 断言两个数在容差内相等，失败时把两个值都带进消息。
 * @param actual - 实算值。
 * @param expected - 期望值。
 * @param message - 断言失败时的说明。
 * @returns 无。
 */
function assertClose(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: ${actual} !== ${expected}`)
}

test('fitStage：三种验收容器把 1280×720 居中且不裁切', () => {
  const exact = fitStage(1200, 675)
  assert.equal(exact.scale, 0.9375)
  assert.equal(exact.offsetX, 0)
  assert.equal(exact.offsetY, 0)

  const half = fitStage(800, 450)
  assert.equal(half.scale, 0.625)
  assert.equal(half.offsetX, 0)
  assert.equal(half.offsetY, 0)

  // 1600×1000 比 16:9 高，纵向要留下 100px 的边：上下各 50。
  const tall = fitStage(1600, 1000)
  assert.equal(tall.scale, 1.25)
  assert.equal(tall.offsetX, 0)
  assert.equal(tall.offsetY, 50)
})

test('fitStage：任意容器下舞台都完整落在框内并居中', () => {
  for (const { width, height } of CONTAINERS) {
    const { scale, offsetX, offsetY } = fitStage(width, height)
    const label = `${width}×${height}`
    // 不裁切：缩放后的舞台必须整个落在容器里。
    assert.ok(offsetX + STAGE_WIDTH * scale <= width + EPSILON, `${label} 横向溢出`)
    assert.ok(offsetY + STAGE_HEIGHT * scale <= height + EPSILON, `${label} 纵向溢出`)
    assert.ok(offsetX >= -EPSILON, `${label} 左边距为负`)
    assert.ok(offsetY >= -EPSILON, `${label} 上边距为负`)
    // 居中：两边余量相等，也就是舞台中心与容器中心重合。
    assertClose(offsetX, (width - STAGE_WIDTH * scale) / 2, `${label} 横向未居中`)
    assertClose(offsetY, (height - STAGE_HEIGHT * scale) / 2, `${label} 纵向未居中`)
    // 等比 fit 至少一边贴边，否则说明 scale 取小了。
    const touches = offsetX <= EPSILON || offsetY <= EPSILON
    assert.ok(touches, `${label} 没有贴住任何一条边`)
  }
})

test('screenToStage：与 fitStage 互逆', () => {
  const viewport = fitStage(1600, 1000)
  // 容器上沿的留白中心是舞台原点；右下角落在 1280×720。
  assert.deepEqual(screenToStage(0, 50, viewport), { x: 0, y: 0 })
  assert.deepEqual(screenToStage(1600, 950, viewport), { x: 1280, y: 720 })
})

test('screenToStage：舞台四角在任意容器里都落回容器内的舞台矩形', () => {
  for (const { width, height } of CONTAINERS) {
    const viewport = fitStage(width, height)
    const label = `${width}×${height}`
    const topLeft = screenToStage(viewport.offsetX, viewport.offsetY, viewport)
    assertClose(topLeft.x, 0, `${label} 左上 x`)
    assertClose(topLeft.y, 0, `${label} 左上 y`)
    const bottomRight = screenToStage(
      viewport.offsetX + STAGE_WIDTH * viewport.scale,
      viewport.offsetY + STAGE_HEIGHT * viewport.scale,
      viewport,
    )
    assertClose(bottomRight.x, STAGE_WIDTH, `${label} 右下 x`)
    assertClose(bottomRight.y, STAGE_HEIGHT, `${label} 右下 y`)
    // 容器可能比舞台大，但落点永远不该跑出容器。
    assert.ok(viewport.offsetX + STAGE_WIDTH * viewport.scale <= width + EPSILON, `${label} 横向越界`)
    assert.ok(viewport.offsetY + STAGE_HEIGHT * viewport.scale <= height + EPSILON, `${label} 纵向越界`)
  }
})
