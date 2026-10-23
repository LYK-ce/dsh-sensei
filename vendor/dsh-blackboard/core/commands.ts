import type { Color, Point } from './types.ts'

/** 人和 agent 共用的绘图指令。 */
export type DrawCommand =
  | { op: 'line'; from: Point; to: Point; color: Color; width: number }
  | { op: 'arrow'; from: Point; to: Point; color: Color; width: number }
  | { op: 'rect'; at: Point; size: Point; color: Color; width: number; fill?: Color }
  | { op: 'circle'; center: Point; radius: number; color: Color; width: number; fill?: Color }
  /** `align` 省略时折成 `start`：`at` 是左边缘与垂直中心（`render.ts` 用 `textBaseline: middle` 绘制）。 */
  | { op: 'text'; at: Point; text: string; size: number; color: Color; align?: 'start' | 'middle' | 'end' }
  | { op: 'stroke'; points: readonly Point[]; color: Color; width: number }
  | { op: 'erase'; ids: readonly string[] }
  | { op: 'clear' }

/** 人和模型共用的颜色集合。取值少，模型才画得稳。 */
export const PALETTE: readonly Color[] = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']

/** 默认颜色。 */
export const DEFAULT_COLOR: Color = '#1e1e1e'

/** 默认线宽，虚拟单位。 */
export const DEFAULT_WIDTH = 4

/** 默认字号，虚拟单位。 */
export const DEFAULT_FONT_SIZE = 32
