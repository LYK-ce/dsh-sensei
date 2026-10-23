import type { Point } from './types.ts'

/** 捕获阶段的最小点间距，虚拟单位。 */
export const MIN_POINT_DISTANCE = 2

/** RDP 的 ε，虚拟单位。 */
export const RDP_EPSILON = 2

/**
 * 捕获阶段：丢弃与上一个保留点距离小于 minDistance 的采样点。
 * @param points - 原始采样点，按时间顺序。
 * @param minDistance - 最小间距，虚拟单位。
 * @returns 保留下来的点，首点一定保留，顺序不变。
 */
export function filterByMinDistance(points: readonly Point[], minDistance: number): Point[] {
  const kept: Point[] = []
  for (const point of points) {
    const previous = kept[kept.length - 1]
    if (previous === undefined || Math.hypot(point.x - previous.x, point.y - previous.y) >= minDistance) kept.push(point)
  }
  return kept
}

/**
 * Ramer–Douglas–Peucker 递归体。
 * @param points - 至少包含首尾的折线，可为空。
 * @param epsilon - 允许的最大偏差，虚拟单位。
 * @returns 抽稀后的折线。
 */
function reduce(points: Point[], epsilon: number): Point[] {
  const first = points[0]
  const last = points[points.length - 1]
  if (first === undefined || last === undefined || points.length <= 2) return points

  const dx = last.x - first.x
  const dy = last.y - first.y
  const chord = Math.hypot(dx, dy)
  // 弦长为 0 时点到弦的距离无定义，这是 RDP 产出 NaN 的经典来源。
  if (chord === 0) return points

  let farthest = -1
  let index = 0
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const point = points[cursor]
    if (point === undefined) continue
    const distance = Math.abs(dy * (point.x - first.x) - dx * (point.y - first.y)) / chord
    if (distance > farthest) {
      farthest = distance
      index = cursor
    }
  }
  if (farthest <= epsilon) return [first, last]

  const head = reduce(points.slice(0, index + 1), epsilon)
  const tail = reduce(points.slice(index), epsilon)
  return [...head.slice(0, -1), ...tail]
}

/**
 * 笔画结束阶段：Ramer–Douglas–Peucker 折线抽稀。
 * @param points - 已过滤的采样点，按时间顺序。
 * @param epsilon - 允许的最大偏差，虚拟单位。
 * @returns 抽稀后的折线；点数 ≤ 2 或首尾重合时原样返回。
 */
export function simplifyRdp(points: readonly Point[], epsilon: number): Point[] {
  return reduce([...points], epsilon)
}
