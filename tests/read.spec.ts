import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PanelPresence } from '../host/presence.ts'
import { SnapshotLedger } from '../host/snapshots.ts'
import { DeckStore } from '../host/store.ts'
import { createReadTool } from '../host/tool.ts'
import type { SenseiReadResult, SenseiTool, ToolSessionContext } from '../host/tool.ts'

/** 本文件测试用的会话。 */
const SESSION = 'session-read'

/** 一段"PNG"：出图路径只负责落盘，不解码。 */
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/** 一条会分配 id 的矩形命令。 */
const BOX = { op: 'rect', at: { x: 0, y: 0 }, size: { x: 10, y: 10 }, color: '#000000', width: 2 } as const

/** 两页 deck。 */
const TWO = { op: 'deck', slides: [{ html: '<h1>a</h1>' }, { html: '<p>b</p>' }] } as const

/** 等已经 resolve 的 Promise 链跑完。 */
function settle(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/**
 * 一个指向固定会话的执行上下文。
 * @param sessionId - 会话 id。
 * @returns 执行上下文。
 */
function execFor(sessionId: string = SESSION): ToolSessionContext {
  return { agent: { session: { id: sessionId as SessionId, header: {} } } }
}

/** 没有 agent 的执行上下文。 */
const NO_AGENT: ToolSessionContext = {}

/**
 * 造一套读工具与它的依赖。
 * @param run - 收到工具、存储、心跳表、账本与数据目录的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withReadTool(
  run: (context: {
    readonly read: SenseiTool<SenseiReadResult>
    readonly store: DeckStore
    readonly presence: PanelPresence
    readonly snapshots: SnapshotLedger
    readonly dataDir: string
  }) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'sensei-read-'))
  const store = new DeckStore(dataDir)
  const presence = new PanelPresence(() => 0)
  const snapshots = new SnapshotLedger()
  try {
    await run({ read: createReadTool(store, presence, snapshots, dataDir), store, presence, snapshots, dataDir })
  } finally {
    snapshots.dispose()
    await store.dispose()
    await rm(dataDir, { recursive: true, force: true })
  }
}

test('sensei_read：默认读当前页，回报页数、当前页、元素 id 与未知的溢出', async () => {
  await withReadTool(async ({ read, store, presence }) => {
    await store.append(SESSION as SessionId, TWO)
    await store.annotate(SESSION as SessionId, 0, [BOX])
    presence.touch(SESSION as SessionId)

    assert.deepEqual(await read.execute({}, execFor()), {
      pages: 2,
      current: 1,
      slide: 1,
      elements: ['e0'],
      overflow: null,
      panelOpen: true,
    })
  })
})

test('sensei_read：slide 指定 1-based 页；溢出测量只对测得的那一页有效', async () => {
  await withReadTool(async ({ read, store, presence }) => {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    await store.append(sessionId, { op: 'show', index: 1 })
    presence.touch(sessionId)
    presence.noteOverflow(sessionId, 1, true)

    const second = await read.execute({ slide: 2 }, execFor())
    assert.equal(second.slide, 2)
    assert.equal(second.current, 2)
    assert.equal(second.overflow, true)

    // 面板量的是第 2 页；第 1 页没有测量，不能拿别人的结果顶替。
    const first = await read.execute({ slide: 1 }, execFor())
    assert.equal(first.overflow, null)
  })
})

test('sensei_read：溢出测量过期后回 null', async () => {
  let now = 0
  const dataDir = await mkdtemp(join(tmpdir(), 'sensei-read-'))
  const store = new DeckStore(dataDir)
  const presence = new PanelPresence(() => now)
  const snapshots = new SnapshotLedger()
  try {
    const sessionId = SESSION as SessionId
    await store.append(sessionId, TWO)
    presence.touch(sessionId)
    presence.noteOverflow(sessionId, 0, false)

    const read = createReadTool(store, presence, snapshots, dataDir)
    assert.equal((await read.execute({}, execFor())).overflow, false)

    now = 3_001
    assert.equal((await read.execute({}, execFor())).overflow, null)
  } finally {
    snapshots.dispose()
    await store.dispose()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('sensei_read：空 deck 报"还没有幻灯片"，越界带上页数与当前页', async () => {
  await withReadTool(async ({ read, store }) => {
    await assert.rejects(read.execute({}, execFor()), /sensei_read: slide 1 is out of range \(the deck has no slides yet\)/)

    await store.append(SESSION as SessionId, TWO)
    await assert.rejects(
      read.execute({ slide: 3 }, execFor()),
      /sensei_read: slide 3 is out of range \(the deck has 2 slide\(s\) and is showing slide 1\)/,
    )
    await assert.rejects(read.execute({ slide: 0 }, execFor()), /out of range/)
  })
})

test('sensei_read：要图但面板没开时立刻报错，不落盘也不等超时', async () => {
  await withReadTool(async ({ read, store }) => {
    await store.append(SESSION as SessionId, TWO)
    await assert.rejects(
      read.execute({ image: true }, execFor()),
      /The Sensei panel is closed; open its tab in the right sidebar/,
    )
  })
})

test('sensei_read：面板交回的 PNG 落到 `<dataDir>/<session>-p<index>.png`', async () => {
  await withReadTool(async ({ read, store, presence, snapshots, dataDir }) => {
    await store.append(SESSION as SessionId, TWO)
    presence.touch(SESSION as SessionId)

    const running = read.execute({ image: true, slide: 2 }, execFor())
    await settle()
    const request = snapshots.outstanding(SESSION)
    assert.notEqual(request, null)
    assert.equal(request?.slide, 1)
    assert.equal(snapshots.deliver(SESSION, request?.id ?? '', PNG), true)
    const result = await running

    assert.equal(result.image?.bytes, PNG.byteLength)
    assert.equal(result.image?.path, join(dataDir, `${SESSION}-p2.png`))
    assert.deepEqual(new Uint8Array(await readFile(result.image?.path ?? '')), PNG)
  })
})

test('sensei_read：没有 agent 会话时抛错', async () => {
  await withReadTool(async ({ read }) => {
    await assert.rejects(read.execute({}, NO_AGENT), /sensei_read: the tool ran without an agent session/)
  })
})
