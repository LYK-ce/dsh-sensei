/**
 * 批注层的纯函数部分：工具与样式、舞台边界、手势 → 绘图命令。
 *
 * 指针事件与 canvas 留在 `client/annotator.ts`；这里不碰 DOM，所以 host 与浏览器两个
 * program 都编译它，坐标换算也能在 Node 里直接测（验收要求 1200×675 与 800×450）。
 */
import { assertNever } from '../vendor/dsh-blackboard/core/assert.ts'
import { DEFAULT_COLOR, DEFAULT_FONT_SIZE, DEFAULT_WIDTH } from '../vendor/dsh-blackboard/core/commands.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import { MIN_POINT_DISTANCE, RDP_EPSILON, filterByMinDistance, simplifyRdp } from '../vendor/dsh-blackboard/core/simplify.ts'
import type { Color, Point } from '../vendor/dsh-blackboard/core/types.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from './stage.ts'
import type { StagePoint } from './stage.ts'

/** 批注工具；`text` 在按下时直接提交，没有拖拽手势。 */
export type AnnotateTool = 'pen' | 'line' | 'arrow' | 'rect' | 'circle' | 'text'

/** 当前工具与样式。 */
export interface AnnotateStyle {
  readonly tool: AnnotateTool
  readonly color: Color
  readonly width: number
}

/** 面板的初始工具与样式。 */
export const DEFAULT_ANNOTATE_STYLE: AnnotateStyle = { tool: 'pen', color: DEFAULT_COLOR, width: DEFAULT_WIDTH }

/** 拖拽手势的进行中状态；工具与样式在按下时定死，手势期间改工具不影响这一笔。 */
export interface AnnotateGesture {
  readonly tool: Exclude<AnnotateTool, 'text'>
  readonly color: Color
  readonly width: number
  /** 按下点。圆以它为圆心，矩形与直线以它为起点。 */
  readonly origin: StagePoint
  /** 当前指针位置，拖动中的图形终点。 */
  readonly current: StagePoint
  /** 手绘的原始采样点，含随后会被抽稀掉的；其他工具不用。 */
  readonly samples: readonly StagePoint[]
}

/**
 * 点是否落在舞台矩形内（含边界）。
 *
 * canvas 铺满整个容器（含 16:9 之外的留白），留白里的按下不能落成一笔，
 * 否则批注会出现在幻灯片之外的位置。
 * @param point - 舞台坐标点。
 * @returns 落在 0..1280 × 0..720 内即 true。
 */
export function insideStage(point: StagePoint): boolean {
  return point.x >= 0 && point.x <= STAGE_WIDTH && point.y >= 0 && point.y <= STAGE_HEIGHT
}

/**
 * 把点夹进舞台矩形。
 *
 * 指针捕获后拖动会跑出 canvas：夹取让元素留在舞台内，导出与画面才不会被裁掉一半。
 * @param point - 舞台坐标点。
 * @returns 夹到 0..1280 × 0..720 的点。
 */
export function clampToStage(point: StagePoint): StagePoint {
  return {
    x: Math.min(Math.max(point.x, 0), STAGE_WIDTH),
    y: Math.min(Math.max(point.y, 0), STAGE_HEIGHT),
  }
}

/**
 * 手绘点的管线：最小间距过滤 → RDP 抽稀。
 *
 * 与 blackboard 同一组参数；批注也按舞台单位计，采样密度直接决定日志体积。
 * @param samples - 原始采样点，按时间顺序。
 * @returns 抽稀后的点列。
 */
function penPoints(samples: readonly StagePoint[]): Point[] {
  return simplifyRdp(filterByMinDistance(samples, MIN_POINT_DISTANCE), RDP_EPSILON)
}

/**
 * 一个拖拽手势折成一条绘图命令。
 * @param gesture - 进行中或刚结束的手势。
 * @returns 对应的命令；文字不走这里。
 */
export function commandOf(gesture: AnnotateGesture): DrawCommand {
  switch (gesture.tool) {
    case 'pen':
      return { op: 'stroke', points: penPoints(gesture.samples), color: gesture.color, width: gesture.width }
    case 'line':
      return { op: 'line', from: gesture.origin, to: gesture.current, color: gesture.color, width: gesture.width }
    case 'arrow':
      return { op: 'arrow', from: gesture.origin, to: gesture.current, color: gesture.color, width: gesture.width }
    case 'rect':
      return {
        op: 'rect',
        at: {
          x: Math.min(gesture.origin.x, gesture.current.x),
          y: Math.min(gesture.origin.y, gesture.current.y),
        },
        size: {
          x: Math.abs(gesture.current.x - gesture.origin.x),
          y: Math.abs(gesture.current.y - gesture.origin.y),
        },
        color: gesture.color,
        width: gesture.width,
      }
    case 'circle':
      return {
        op: 'circle',
        center: gesture.origin,
        radius: Math.hypot(gesture.current.x - gesture.origin.x, gesture.current.y - gesture.origin.y),
        color: gesture.color,
        width: gesture.width,
      }
    default:
      return assertNever(gesture.tool)
  }
}

/**
 * 一条文字命令。`at` 是文字的左边缘与垂直中心，与 vendor 的 `render.ts` 一致。
 * @param at - 舞台坐标下的锚点。
 * @param text - 文字内容，调用方保证非空。
 * @param color - 填充色。
 * @returns 文字命令。
 */
export function textCommand(at: StagePoint, text: string, color: Color): DrawCommand {
  return { op: 'text', at, text, size: DEFAULT_FONT_SIZE, color }
}
