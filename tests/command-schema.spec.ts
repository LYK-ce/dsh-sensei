// `DrawCommand` 是纯类型，运行时被擦除；`sensei_draw` 的参数 schema 是 `host/tool.ts` 里手写的
// 对象字面量。两者各写一遍，就只能靠本 spec 把它们钉在一起：schema 侧读工具真实编译出来的
// `parameters`，类型侧用两份样例表（完整 / 最小）覆盖每一支。
//
// 缺陷背景：schema 曾经漏了 `rect`/`circle` 的 `fill` 与 `text` 的 `align`，模型带上这些字段时
// `defineTool` 的 exactly-one `oneOf` 会直接抛 `INVALID_ARGS`，而消息只说"没匹配上任何一支"。
// 所以这里同时对**属性名集合**与**必填集合**做双向断言：完整样例必须覆盖每一支的全部属性，
// 最小样例必须恰好只带必填属性。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DeckOp } from '../core/deck.ts'
import { PanelPresence } from '../host/presence.ts'
import { DeckStore } from '../host/store.ts'
import { createDrawTool } from '../host/tool.ts'
import type { SenseiDrawResult, SenseiTool, ToolSessionContext } from '../host/tool.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'

/** 去掉模型不开放的 `clear` 之后，schema 必须逐支镜像的标签集。 */
type ModelTag = Exclude<DrawCommand['op'], 'clear'>

/** 完整样例：每一支都带上全部字段，包括可选的 `fill` / `align`。 */
const SPECIMENS: { readonly [K in ModelTag]: DrawCommand } = {
  line: { op: 'line', from: { x: 0, y: 0 }, to: { x: 1280, y: 720 }, color: '#1e1e1e', width: 4 },
  arrow: { op: 'arrow', from: { x: 10, y: 20 }, to: { x: 300, y: 400 }, color: '#e03131', width: 2 },
  rect: {
    op: 'rect',
    at: { x: 40, y: 60 },
    size: { x: 320, y: 180 },
    color: '#1971c2',
    width: 4,
    fill: '#ffffff',
  },
  circle: { op: 'circle', center: { x: 640, y: 360 }, radius: 80, color: '#2f9e44', width: 8, fill: '#f08c00' },
  text: { op: 'text', at: { x: 640, y: 360 }, text: '你好', size: 32, color: '#1e1e1e', align: 'middle' },
  stroke: {
    op: 'stroke',
    points: [{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 30, y: 40 }],
    color: '#1e1e1e',
    width: 4,
  },
  erase: { op: 'erase', ids: ['e0', 'e1'] },
}

/** 最小样例：只带必填字段，用来证明每个可选字段真的可省。 */
const MINIMAL: { readonly [K in ModelTag]: DrawCommand } = {
  line: { op: 'line', from: { x: 0, y: 0 }, to: { x: 1280, y: 720 }, color: '#1e1e1e', width: 4 },
  arrow: { op: 'arrow', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#1e1e1e', width: 4 },
  rect: { op: 'rect', at: { x: 0, y: 0 }, size: { x: 10, y: 10 }, color: '#1e1e1e', width: 4 },
  circle: { op: 'circle', center: { x: 0, y: 0 }, radius: 10, color: '#1e1e1e', width: 4 },
  text: { op: 'text', at: { x: 0, y: 0 }, text: 'a', size: 16, color: '#1e1e1e' },
  stroke: { op: 'stroke', points: [{ x: 0, y: 0 }], color: '#1e1e1e', width: 4 },
  erase: { op: 'erase', ids: ['e0'] },
}

/** 本文件测试用的会话。 */
const SESSION = 'session-command-schema'

/** schema 里的一支命令。 */
interface SchemaBranch {
  /** `op.const`，也是与样例表配对的键。 */
  readonly tag: string
  /** 该支声明的全部属性名。 */
  readonly properties: readonly string[]
  /** 该支的必填属性名。 */
  readonly required: readonly string[]
}

/** 一个指向固定会话的执行上下文。 */
function execFor(): ToolSessionContext {
  return { agent: { session: { id: SESSION as SessionId, header: {} } } }
}

/** 两页 deck；每支样例都在它的第 1 页上执行。 */
const TWO: DeckOp = { op: 'deck', slides: [{ html: '<p>a</p>' }, { html: '<p>b</p>' }] }

/**
 * 在临时目录里造一个 `sensei_draw`。
 * @param run - 收到工具与存储的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withDraw(run: (draw: SenseiTool<SenseiDrawResult>, store: DeckStore) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sensei-command-schema-'))
  const store = new DeckStore(dir)
  const presence = new PanelPresence(() => 0)
  try {
    await run(createDrawTool(store, presence), store)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 判断一个抛出物是不是 schema 拒参。
 *
 * `defineTool` 的 `ToolArgsError` 带 `code: 'INVALID_ARGS'`；不 import 这个类是为了让断言
 * 只依赖模型可见的错误码，而不是 dsh-tools 的内部类型名。
 * @param error - 捕获到的值。
 * @returns 是参数校验错误时为 true。
 */
function isInvalidArgs(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { readonly code?: unknown }).code
  return code === 'INVALID_ARGS'
}

/**
 * 判断一个值是不是普通对象。
 * @param value - 候选值。
 * @returns 是普通对象时为 true。
 */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把未知值收窄成对象。
 * @param value - 候选值。
 * @param what - 出错时的字段说明。
 * @returns 该对象。
 */
function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (!isRecordValue(value)) assert.fail(`${what} is not an object`)
  return value
}

/**
 * 把未知值收窄成数组。
 * @param value - 候选值。
 * @param what - 出错时的字段说明。
 * @returns 该数组。
 */
function listOf(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) assert.fail(`${what} is not an array`)
  return value
}

/**
 * 读工具真实编译出来的 `commands.items.oneOf`。
 * @param tool - `sensei_draw` 的定义。
 * @returns 每一支的标签、属性名与必填属性名。
 */
function schemaBranches(tool: SenseiTool<SenseiDrawResult>): readonly SchemaBranch[] {
  const parameters = recordOf(tool.parameters, 'parameters')
  // `defineTool` 编译出来的是对象根 schema：属性表在 `properties` 下面，不在顶层。
  const properties = recordOf(parameters['properties'], 'parameters.properties')
  const commands = recordOf(properties['commands'], 'parameters.properties.commands')
  const items = recordOf(commands['items'], 'parameters.properties.commands.items')
  const branches = listOf(items['oneOf'], 'parameters.properties.commands.items.oneOf')
  return branches.map((value, index) => {
    const branch = recordOf(value, `oneOf[${index}]`)
    const properties = recordOf(branch['properties'], `oneOf[${index}].properties`)
    const op = recordOf(properties['op'], `oneOf[${index}].properties.op`)
    const tag = op['const']
    if (typeof tag !== 'string') assert.fail(`oneOf[${index}].properties.op.const is not a string`)
    const required = branch['required'] === undefined ? [] : listOf(branch['required'], `oneOf[${index}].required`)
    return {
      tag,
      properties: Object.keys(properties),
      required: required.map((entry, position) => {
        if (typeof entry !== 'string') assert.fail(`oneOf[${index}].required[${position}] is not a string`)
        return entry
      }),
    }
  })
}

/**
 * 去掉一个必填字段，模拟模型漏字段。
 * @param command - 完整命令。
 * @param field - 要删掉的字段。
 * @returns 删掉该字段的普通对象。
 */
function without(command: DrawCommand, field: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...command }
  delete copy[field]
  return copy
}

test('schema 漂移守卫：标签集与样例表完全一致，且不开放 clear', async () => {
  await withDraw(async (draw) => {
    const tags = schemaBranches(draw).map((branch) => branch.tag)
    assert.equal(new Set(tags).size, tags.length, 'schema 里出现了重复的 op')
    assert.deepEqual(tags.toSorted(), Object.keys(SPECIMENS).toSorted())
    assert.equal(tags.includes('clear'), false, 'clear 不能开放给模型')
  })
})

test('schema 漂移守卫：完整样例恰好覆盖每支的全部属性，最小样例恰好只带必填属性', async () => {
  await withDraw(async (draw) => {
    for (const branch of schemaBranches(draw)) {
      const full = SPECIMENS[branch.tag as ModelTag]
      const minimal = MINIMAL[branch.tag as ModelTag]
      assert.ok(full !== undefined, `完整样例缺少 ${branch.tag}`)
      assert.ok(minimal !== undefined, `最小样例缺少 ${branch.tag}`)
      assert.deepEqual(Object.keys(full).toSorted(), [...branch.properties].toSorted(), `${branch.tag} 完整样例的字段集`)
      assert.deepEqual(Object.keys(minimal).toSorted(), [...branch.required].toSorted(), `${branch.tag} 最小样例的字段集`)
    }
  })
})

test('每个完整样例与最小样例都能真正执行', async () => {
  await withDraw(async (draw, store) => {
    await store.append(SESSION as SessionId, TWO)
    for (const [tag, command] of Object.entries(SPECIMENS)) {
      await store.annotate(SESSION as SessionId, 0, [{ op: 'clear' }])
      const result = await draw.execute({ commands: [command] }, execFor())
      // erase 只断言成功：它删的是 id，不产生新元素。
      if (tag === 'erase') continue
      assert.equal(result.added.length, 1, `${tag} 应新增一个元素`)
      assert.equal(result.elements, 1, `${tag} 执行后应剩一个元素`)
    }

    for (const [tag, command] of Object.entries(MINIMAL)) {
      await store.annotate(SESSION as SessionId, 0, [{ op: 'clear' }])
      const result = await draw.execute({ commands: [command] }, execFor())
      if (tag === 'erase') continue
      assert.equal(result.added.length, 1, `${tag} 最小样例应新增一个元素`)
    }
  })
})

test('每个必填字段缺失时都被 schema 挡成 INVALID_ARGS', async () => {
  await withDraw(async (draw, store) => {
    await store.append(SESSION as SessionId, TWO)
    for (const branch of schemaBranches(draw)) {
      const command = SPECIMENS[branch.tag as ModelTag]
      for (const field of branch.required) {
        await assert.rejects(
          draw.execute({ commands: [without(command, field)] }, execFor()),
          isInvalidArgs,
          `${branch.tag} 缺 ${field} 应被拒`,
        )
      }
    }
    // 全部拒绝之后，日志里只有那次 deck 重建。
    assert.equal((await store.read(SESSION as SessionId, 0)).revision, 1)
  })
})
