import { assertNever } from '../core/assert.ts'
import type { DrawCommand } from '../core/commands.ts'
import type { Element } from '../core/elements.ts'
import { applyCommands } from '../core/scene.ts'
import type { Scene } from '../core/scene.ts'

/**
 * 一次画板变更：`add` 追加元素，`patch` 改软删除位，`clear` 清空整块板。
 * `add` 自带完整元素（含 id），所以重放者不需要自己分配 id。
 */
export type SceneOp =
  | { op: 'add'; element: Element }
  | { op: 'patch'; id: string; isDeleted: true }
  | { op: 'clear' }

/** 元素 id 里的序号部分。 */
const ID_SUFFIX = /^e(\d+)$/

/**
 * 把 `nextId` 抬高到 `id` 之后；`id` 不符合 `e<N>` 时原样返回。
 * @param nextId - 当前的 `Scene.nextId`。
 * @param id - 刚加入场景的元素 id。
 * @returns 不小于 `nextId` 的下一个可用序号。
 */
export function nextIdAfter(nextId: number, id: string): number {
  const match = ID_SUFFIX.exec(id)
  const value = match === null ? Number.NaN : Number(match[1])
  return Number.isSafeInteger(value) && value + 1 > nextId ? value + 1 : nextId
}

/**
 * 把 ops 折叠进场景。
 * @param scene - 起始场景，不被修改。
 * @param ops - 按顺序应用的变更。
 * @returns 新场景；`add` 使用 op 自带的 id，`clear` 不回收 id。
 */
export function applyOps(scene: Scene, ops: readonly SceneOp[]): Scene {
  const elements = [...scene.elements]
  let nextId = scene.nextId

  for (const op of ops) {
    switch (op.op) {
      case 'add':
        elements.push(op.element)
        nextId = nextIdAfter(nextId, op.element.id)
        break
      case 'patch': {
        const index = elements.findIndex((element) => element.id === op.id)
        const element = elements[index]
        // 找不到就忽略：这条流可能记录的是别人已经擦过的元素。
        if (element === undefined) break
        elements[index] = { ...element, isDeleted: op.isDeleted }
        break
      }
      case 'clear':
        elements.length = 0
        break
      default:
        assertNever(op)
    }
  }

  return { elements, nextId }
}

/**
 * 一次命令折成的变更。命令语义由 {@link applyCommands} 单独实现，这里只做前后对比。
 * @param before - 应用前的场景。
 * @param after - 应用后的场景。
 * @returns 描述这次差异的 ops。
 */
function opsBetween(before: Scene, after: Scene): SceneOp[] {
  const ops: SceneOp[] = []
  if (before.elements.length > 0 && after.elements.length === 0) {
    ops.push({ op: 'clear' })
  }
  for (let index = before.elements.length; index < after.elements.length; index += 1) {
    const element = after.elements[index]
    if (element !== undefined) ops.push({ op: 'add', element })
  }
  for (let index = 0; index < before.elements.length; index += 1) {
    const element = before.elements[index]
    if (element !== undefined && !element.isDeleted && after.elements[index]?.isDeleted === true) {
      ops.push({ op: 'patch', id: element.id, isDeleted: true })
    }
  }
  return ops
}

/**
 * 把一批命令折成 ops。人和 agent 每次手势调用一次，id 由 `scene.nextId` 分配。
 * @param scene - 起始场景，不被修改。
 * @param commands - 按顺序应用的命令。
 * @returns 本批命令产生的 ops，以及应用后的场景。
 */
export function opsFromCommands(scene: Scene, commands: readonly DrawCommand[]): { ops: SceneOp[]; scene: Scene } {
  const ops: SceneOp[] = []
  let current = scene
  for (const command of commands) {
    const next = applyCommands(current, [command])
    ops.push(...opsBetween(current, next))
    current = next
  }
  return { ops, scene: current }
}
