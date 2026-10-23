import type { Color, Point } from './types.ts'

/** 所有元素共有的字段。 */
export interface ElementBase {
  /** 场景内唯一，形如 `e0`。 */
  readonly id: string
  x: number
  y: number
  /**
   * 外接框尺寸，不是渲染参数。
   * 文字元素的这两个字段不具权威性，见 {@link TextElement}。
   */
  width: number
  height: number
  strokeColor: Color
  strokeWidth: number
  /** 软删除。日志是 append-only 的，删除只能是标记。 */
  isDeleted: boolean
}

/** 直线与箭头。 */
export interface LinearElement extends ElementBase {
  type: 'line' | 'arrow'
  /** 相对 (x, y) 的点列。 */
  points: readonly Point[]
}

/** 矩形。 */
export interface RectElement extends ElementBase {
  type: 'rect'
  fill?: Color
}

/** 椭圆。`circle` 命令产出它。 */
export interface EllipseElement extends ElementBase {
  type: 'ellipse'
  fill?: Color
}

/** 文字。宽高由渲染器在现场测量，命令层不写。 */
export interface TextElement extends ElementBase {
  type: 'text'
  text: string
  fontSize: number
  align: 'start' | 'middle' | 'end'
}

/** 自由手绘的一笔。 */
export interface StrokeElement extends ElementBase {
  type: 'stroke'
  /** 相对 (x, y) 的点列。 */
  points: readonly Point[]
}

/** 画板上的一个图形。 */
export type Element = LinearElement | RectElement | EllipseElement | TextElement | StrokeElement
