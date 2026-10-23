import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PanelPresence } from '../host/presence.ts'
import { ExportLedger } from '../host/snapshots.ts'
import { DeckStore } from '../host/store.ts'
import { createExportTool } from '../host/tool.ts'
import type { SenseiExportResult, SenseiTool, ToolSessionContext } from '../host/tool.ts'

/** 本文件测试用的会话。 */
const SESSION = 'session-export'

/** 一段形态合法的 base64（PNG 前 8 字节）。 */
const PNG_BASE64 = 'iVBORw0KGgo='

/** 两页 deck。 */
const TWO = { op: 'deck', slides: [{ html: '<h1>a</h1>' }, { html: '<p>b</p>' }] } as const

/** 等已经 resolve 的 Promise 链跑完。 */
function settle(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/**
 * 一个指向固定会话、工作目录为 `cwd` 的执行上下文。
 * @param cwd - 会话工作目录。
 * @returns 执行上下文。
 */
function execFor(cwd: string): ToolSessionContext {
  return { agent: { session: { id: SESSION as SessionId, header: { cwd } } } }
}

/** 没有 agent 的执行上下文。 */
const NO_AGENT: ToolSessionContext = {}

/**
 * 造一套导出工具与它的依赖。
 * @param run - 收到工具、存储、心跳表、账本与两个临时目录的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withExportTool(
  run: (context: {
    readonly exportDeck: SenseiTool<SenseiExportResult>
    readonly store: DeckStore
    readonly presence: PanelPresence
    readonly exports: ExportLedger
    readonly dataDir: string
    readonly workspace: string
  }) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'sensei-export-data-'))
  const workspace = await mkdtemp(join(tmpdir(), 'sensei-export-work-'))
  const store = new DeckStore(dataDir)
  const presence = new PanelPresence(() => 0)
  const exports = new ExportLedger()
  try {
    await run({
      exportDeck: createExportTool(store, presence, exports),
      store,
      presence,
      exports,
      dataDir,
      workspace,
    })
  } finally {
    exports.dispose()
    await store.dispose()
    await rm(dataDir, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  }
}

/**
 * 让面板交回指定的页面，并等工具跑完。
 * @param exports - 导出账本。
 * @param running - 正在等待面板的 execute 调用。
 * @param pages - 面板交回的页面。
 * @returns 工具结果。
 */
async function deliver(
  exports: ExportLedger,
  running: Promise<SenseiExportResult>,
  pages: readonly { readonly index: number; readonly png: string }[],
): Promise<SenseiExportResult> {
  await settle()
  const request = exports.outstanding(SESSION)
  assert.notEqual(request, null, '工具应当在等面板交页面')
  assert.equal(exports.deliver(SESSION, request?.id ?? '', pages), true)
  return await running
}

test('sensei_export：默认落到会话工作区，落盘 PK、回报字节数与 exported op', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)

    const running = exportDeck.execute({}, execFor(workspace))
    await settle()
    assert.deepEqual(exports.outstanding(SESSION)?.pages, 2)
    assert.equal(exports.outstanding(SESSION)?.scale, 1.5, '默认倍率是 1.5')
    const result = await deliver(exports, running, [{ index: 0, png: PNG_BASE64 }, { index: 1, png: PNG_BASE64 }])

    const expected = join(workspace, 'sensei-deck.pptx')
    assert.equal(result.path, expected)
    assert.equal(result.pages, 2)
    assert.deepEqual(result.blank, [])
    assert.equal(result.panelOpen, true)
    assert.ok(result.bytes > 0)
    assert.equal((await readFile(expected)).subarray(0, 2).toString('latin1'), 'PK')
    // 落点写进 op 流：刷新页面后模型与人都还能看到上一次导出的位置。
    assert.equal((await store.deck(sessionId)).lastExport, expected)
  })
})

test('sensei_export：相对 dir 按会话工作区解析，name 补 .pptx，scale 原样交给面板', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)

    const running = exportDeck.execute({ dir: 'out', name: 'talk', scale: 2 }, execFor(workspace))
    await settle()
    assert.equal(exports.outstanding(SESSION)?.scale, 2)
    const result = await deliver(exports, running, [{ index: 0, png: PNG_BASE64 }, { index: 1, png: PNG_BASE64 }])

    assert.equal(result.path, join(workspace, 'out', 'talk.pptx'))
    assert.equal((await readFile(result.path)).subarray(0, 2).toString('latin1'), 'PK')
  })
})

test('sensei_export：缺页补空白并在结果里报 1-based 页码', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)

    const running = exportDeck.execute({}, execFor(workspace))
    const result = await deliver(exports, running, [{ index: 0, png: PNG_BASE64 }])
    assert.deepEqual(result.blank, [2])
    assert.equal(result.pages, 2)
  })
})

test('sensei_export：目标已存在且没有 overwrite 时在发起栅格化之前报错', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)
    const target = join(workspace, 'sensei-deck.pptx')
    await writeFile(target, 'keep me')

    await assert.rejects(
      exportDeck.execute({}, execFor(workspace)),
      /already exists; pass overwrite: true/,
    )
    assert.equal(exports.outstanding(SESSION), null, '不该向面板发起栅格化')
    assert.equal(await readFile(target, 'utf8'), 'keep me')
  })
})

test('sensei_export：overwrite 放行并覆盖旧文件', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)
    const target = join(workspace, 'sensei-deck.pptx')
    await writeFile(target, 'keep me')

    const running = exportDeck.execute({ overwrite: true }, execFor(workspace))
    const result = await deliver(exports, running, [{ index: 0, png: PNG_BASE64 }, { index: 1, png: PNG_BASE64 }])
    assert.equal(result.path, target)
    assert.equal((await readFile(target)).subarray(0, 2).toString('latin1'), 'PK')
  })
})

test('sensei_export：面板没开时立刻报错，不写文件也不发起请求', async () => {
  await withExportTool(async ({ exportDeck, store, exports, workspace }) => {
    await store.append(SESSION as SessionId, TWO)
    await assert.rejects(
      exportDeck.execute({}, execFor(workspace)),
      /The Sensei panel is closed; open its tab in the right sidebar/,
    )
    assert.equal(exports.outstanding(SESSION), null)
    await assert.rejects(readFile(join(workspace, 'sensei-deck.pptx')), /ENOENT/)
  })
})

test('sensei_export：空 deck 与非法倍率在发起栅格化之前报错', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    presence.touch(SESSION as SessionId)
    await assert.rejects(exportDeck.execute({}, execFor(workspace)), /sensei_export: slide 1 is out of range \(the deck has no slides yet\)/)

    await store.append(SESSION as SessionId, TWO)
    await assert.rejects(exportDeck.execute({ scale: 1.2 }, execFor(workspace)), (error: unknown) => {
      return error instanceof Error && (error as Error & { readonly code?: unknown }).code === 'INVALID_ARGS'
    })
    assert.equal(exports.outstanding(SESSION), null)
  })
})

test('sensei_export：非法文件名在发起栅格化之前被拒', async () => {
  await withExportTool(async ({ exportDeck, store, presence, exports, workspace }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)

    for (const name of ['../escape', 'sub/deck']) {
      await assert.rejects(exportDeck.execute({ name }, execFor(workspace)), /is not a valid file name/, name)
    }
    assert.equal(exports.outstanding(SESSION), null)
  })
})

test('sensei_export：没有 agent 会话时抛错', async () => {
  await withExportTool(async ({ exportDeck }) => {
    await assert.rejects(exportDeck.execute({}, NO_AGENT), /sensei_export: the tool ran without an agent session/)
  })
})

test('sensei_export：结果文案带上路径、页数与补白页码', async () => {
  await withExportTool(async ({ exportDeck }) => {
    const [block] = exportDeck.output.render({}, {
      path: 'C:/tmp/deck.pptx',
      pages: 2,
      bytes: 1234,
      blank: [2],
      panelOpen: true,
    })
    if (block === undefined || block.type !== 'text') assert.fail('结果应当是一段文本')
    assert.match(block.text, /Exported 2 slide\(s\) to C:\/tmp\/deck\.pptx \(1234 bytes\)/)
    assert.match(block.text, /Slide\(s\) 2 could not be rasterized/)
  })
})
