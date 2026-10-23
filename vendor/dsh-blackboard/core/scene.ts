import { assertNever } from './assert.ts'
import type { DrawCommand } from './commands.ts'
import type { Element, LinearElement, StrokeElement } from './elements.ts'
import type { Color, Point } from './types.ts'

/** 画板内容。`nextId` 让 applyCommands 在没有随机数和时钟的前提下仍能生成稳定 id。 */
export interface Scene {
  /** 有序：后面的元素画在上面。 */
  readonly elements: readonly Element[]
  /** 下一个元素的 id 序号，只增不减。 */
  readonly nextId: number
}

/** 外接框，加上相对该框左上角的点列。 */
interface RelativeBox {
  x: number
  y: number
  width: number
  height: number
  points: Point[]
}

/**
 * 把绝对点列归一化成外接框加相对点列。
 * @param points - 绝对坐标点列；空点列落到原点。
 * @returns 外接框与相对其左上角的点列。
 */
function relativeBox(points: readonly Point[]): RelativeBox {
  const first = points[0] ?? { x: 0, y: 0 }
  let minX = first.x
  let minY = first.y
  let maxX = first.x
  let maxY = first.y
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
  }
}

/**
 * 把外接框装成一个按点列绘制的元素。
 * @param id - 元素 id。
 * @param type - 线状元素的类型。
 * @param box - 外接框与相对它的点列。
 * @param color - 描边颜色。
 * @param width - 描边宽度。
 * @returns 对应类型的元素。
 */
function linearElement(
  id: string,
  type: 'line' | 'arrow' | 'stroke',
  box: RelativeBox,
  color: Color,
  width: number,
): LinearElement | StrokeElement {
  const common = {
    id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    points: box.points,
    strokeColor: color,
    strokeWidth: width,
    isDeleted: false,
  }
  return type === 'stroke' ? { ...common, type: 'stroke' } : { ...common, type }
}

/** 空场景。 */
export function createScene(): Scene {
  return { elements: [], nextId: 0 }
}

/**
 * 把命令折叠进场景。
 * @param scene - 起始场景，不被修改。
 * @param commands - 按顺序应用的命令。
 * @returns 新场景；相同入参必然得到相同出参。
 */
export function applyCommands(scene: Scene, commands: readonly DrawCommand[]): Scene {
  const elements = [...scene.elements]
  let nextId = scene.nextId

  /** 追加一个元素并占用下一个 id。 */
  const add = (create: (id: string) => Element): void => {
    elements.push(create(`e${nextId}`))
    nextId += 1
  }

  for (const command of commands) {
    switch (command.op) {
      case 'line':
      case 'arrow': {
        const box = relativeBox([command.from, command.to])
        add((id) => linearElement(id, command.op, box, command.color, command.width))
        break
      }
      case 'stroke': {
        const box = relativeBox(command.points)
        add((id) => linearElement(id, 'stroke', box, command.color, command.width))
        break
      }
      case 'rect': {
        const x = Math.min(command.at.x, command.at.x + command.size.x)
        const y = Math.min(command.at.y, command.at.y + command.size.y)
        add((id) => ({
          id,
          type: 'rect',
          x,
          y,
          width: Math.abs(command.size.x),
          height: Math.abs(command.size.y),
          strokeColor: command.color,
          strokeWidth: command.width,
          isDeleted: false,
          ...(command.fill === undefined ? {} : { fill: command.fill }),
        }))
        break
      }
      case 'circle': {
        const radius = Math.abs(command.radius)
        add((id) => ({
          id,
          type: 'ellipse',
          x: command.center.x - radius,
          y: command.center.y - radius,
          width: radius * 2,
          height: radius * 2,
          strokeColor: command.color,
          strokeWidth: command.width,
          isDeleted: false,
          ...(command.fill === undefined ? {} : { fill: command.fill }),
        }))
        break
      }
      case 'text':
        add((id) => ({
          id,
          type: 'text',
          x: command.at.x,
          y: command.at.y,
          // 文字外接框是渲染期派生数据：这里没有 canvas 可测，所以留 0，真实尺寸由渲染层按字体算。
          width: 0,
          height: 0,
          text: command.text,
          fontSize: command.size,
          align: command.align ?? 'start',
          strokeColor: command.color,
          // 文字用填充绘制，没有描边宽度可言。
          strokeWidth: 0,
          isDeleted: false,
        }))
        break
      case 'erase': {
        const erased = new Set(command.ids)
        for (let index = 0; index < elements.length; index += 1) {
          const element = elements[index]
          if (element === undefined || !erased.has(element.id)) continue
          elements[index] = { ...element, isDeleted: true }
        }
        break
      }
      case 'clear':
        elements.length = 0
        break
      default:
        assertNever(command)
    }
  }

  return { elements, nextId }
}
