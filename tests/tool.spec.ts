import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PanelPresence } from '../host/presence.ts'
import { DeckStore } from '../host/store.ts'
import { createDeckTool, createDrawTool, createShowTool, createSlideTool } from '../host/tool.ts'
import type { SenseiDrawResult, SenseiTool, ToolSessionContext } from '../host/tool.ts'

/** 本页测试用的会话。 */
const SESSION = 'session-tool'

/** 一个指向固定会话的执行上下文。 */
function execFor(sessionId: string = SESSION): ToolSessionContext {
  return { agent: { session: { id: sessionId as SessionId, header: {} } } }
}

/** 没有 agent 的执行上下文。 */
const NO_AGENT: ToolSessionContext = {}

/** 一页最小内容。 */
const SLIDE = { html: '<h1>hi</h1>' }

/**
 * 在临时目录里跑一个测试体，并给出四条工具与心跳表。
 * @param run - 收到存储、心跳表与四条工具的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withTools(
  run: (context: { readonly store: DeckStore; readonly presence: PanelPresence; readonly deck: SenseiTool; readonly slide: SenseiTool; readonly show: SenseiTool; readonly draw: SenseiTool<SenseiDrawResult> }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sensei-tool-'))
  const store = new DeckStore(dir)
  const presence = new PanelPresence(() => 0)
  try {
    await run({
      store,
      presence,
      deck: createDeckTool(store, presence),
      slide: createSlideTool(store, presence),
      show: createShowTool(store, presence),
      draw: createDrawTool(store, presence),
    })
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

/** 一条矩形命令。 */
const BOX = { op: 'rect', at: { x: 0, y: 0 }, size: { x: 10, y: 10 }, color: '#000000', width: 2 }

test('sensei_deck：整份重建并回报页数、当前页与 panelOpen', async () => {
  await withTools(async ({ deck, presence }) => {
    presence.touch(SESSION as SessionId)
    const result = await deck.execute({
      css: '.t { color: red }',
      slides: [SLIDE, { html: '<p>b</p>', title: 'B', notes: '讲稿' }],
    }, execFor())

    assert.deepEqual(result, { pages: 2, current: 1, panelOpen: true })
  })
})

test('sensei_deck：可选字段缺省时不会在存储里留下 undefined 键', async () => {
  await withTools(async ({ deck, store }) => {
    await deck.execute({ slides: [SLIDE] }, execFor())
    const stored = await store.deck(SESSION as SessionId)

    assert.equal(Object.hasOwn(stored.slides[0] ?? {}, 'title'), false)
    assert.equal(Object.hasOwn(stored.slides[0] ?? {}, 'notes'), false)
    assert.equal(Object.hasOwn(stored, 'lastExport'), false)
    assert.equal(stored.css, '')
  })
})

test('sensei_deck：面板没开时 panelOpen 为 false，渲染文案给出提示', async () => {
  await withTools(async ({ deck }) => {
    const result = await deck.execute({ slides: [SLIDE] }, execFor())
    assert.equal(result.panelOpen, false)

    const [block] = deck.output.render({}, { pages: 1, current: 1, panelOpen: false })
    if (block === undefined || block.type !== 'text') assert.fail('结果应当是一段文本')
    assert.match(block.text, /1 slide\(s\)/)
    assert.match(block.text, /slide 1 is showing/)
    assert.match(block.text, /panel is closed/)
  })
})

test('sensei_deck：空 slides 允许，回报空 deck 且文案说明没有页', async () => {
  await withTools(async ({ deck }) => {
    assert.deepEqual(await deck.execute({ slides: [] }, execFor()), { pages: 0, current: 0, panelOpen: false })

    const [block] = deck.output.render({}, { pages: 0, current: 0, panelOpen: true })
    if (block === undefined || block.type !== 'text') assert.fail('结果应当是一段文本')
    assert.equal(block.text, 'The deck is empty.')
  })
})

test('sensei_slide：index 等于页数 + 1 时追加，改已有页则替换', async () => {
  await withTools(async ({ slide, store }) => {
    assert.deepEqual(await slide.execute({ index: 1, html: 'a' }, execFor()), { pages: 1, current: 1, panelOpen: false })
    assert.deepEqual(await slide.execute({ index: 2, html: 'b', title: 'B' }, execFor()), { pages: 2, current: 1, panelOpen: false })
    assert.deepEqual(await slide.execute({ index: 2, html: 'b2' }, execFor()), { pages: 2, current: 1, panelOpen: false })

    const stored = await store.deck(SESSION as SessionId)
    assert.deepEqual(stored.slides, [{ html: 'a' }, { html: 'b2' }])
  })
})

test('sensei_slide：越界报错并带页数与当前页', async () => {
  await withTools(async ({ slide }) => {
    await slide.execute({ index: 1, html: 'a' }, execFor())
    await assert.rejects(
      slide.execute({ index: 3, html: 'c' }, execFor()),
      /sensei_slide: slide 3 is out of range \(the deck has 1 slide\(s\) and is showing slide 1\)/,
    )
    await assert.rejects(slide.execute({ index: 0, html: 'c' }, execFor()), /out of range/)
  })
})

test('sensei_show：合法页号翻页，空 deck 与越界都报错', async () => {
  await withTools(async ({ deck, show, store }) => {
    await assert.rejects(show.execute({ index: 1 }, execFor()), /sensei_show: slide 1 is out of range \(the deck has no slides yet\)/)

    await deck.execute({ slides: [SLIDE, { html: 'b' }, { html: 'c' }] }, execFor())
    assert.deepEqual(await show.execute({ index: 3 }, execFor()), { pages: 3, current: 3, panelOpen: false })
    assert.equal((await store.deck(SESSION as SessionId)).current, 2)
    await assert.rejects(show.execute({ index: 4 }, execFor()), /out of range/)
  })
})

test('sensei_draw：默认画当前页，回报新增 id、元素数与 panelOpen', async () => {
  await withTools(async ({ deck, draw, presence, store }) => {
    await deck.execute({ slides: [SLIDE, { html: 'b' }] }, execFor())
    await store.append(SESSION as SessionId, { op: 'show', index: 1 })
    presence.touch(SESSION as SessionId)

    const result = await draw.execute({ commands: [BOX, BOX] }, execFor())
    assert.deepEqual(result, { added: ['e0', 'e1'], elements: 2, panelOpen: true })
    // 画在 host 的当前页（第 2 页），第 1 页不受影响。
    const stored = await store.deck(SESSION as SessionId)
    assert.deepEqual(stored.annotations.map((scene) => scene.elements.length), [0, 2])
  })
})

test('sensei_draw：显式 1-based 页号覆盖当前页，erase 减少元素数', async () => {
  await withTools(async ({ deck, draw, store }) => {
    await deck.execute({ slides: [SLIDE, { html: 'b' }] }, execFor())
    await store.append(SESSION as SessionId, { op: 'show', index: 1 })

    assert.deepEqual(await draw.execute({ slide: 1, commands: [BOX] }, execFor()), {
      added: ['e0'],
      elements: 1,
      panelOpen: false,
    })
    assert.deepEqual(await draw.execute({ commands: [{ op: 'erase', ids: ['e0'] }] }, execFor()), {
      added: [],
      elements: 0,
      panelOpen: false,
    })
  })
})

test('sensei_draw：页号越界、空 deck、命令超限都报错且不落盘', async () => {
  await withTools(async ({ deck, draw, store }) => {
    await assert.rejects(
      draw.execute({ commands: [BOX] }, execFor()),
      /sensei_draw: slide 1 is out of range \(the deck has no slides yet\)/,
    )

    await deck.execute({ slides: [SLIDE, { html: 'b' }] }, execFor())
    await assert.rejects(
      draw.execute({ slide: 3, commands: [BOX] }, execFor()),
      /sensei_draw: slide 3 is out of range \(the deck has 2 slide\(s\) and is showing slide 1\)/,
    )
    await assert.rejects(draw.execute({ slide: 0, commands: [BOX] }, execFor()), /out of range/)

    const tooMany = Array.from({ length: 201 }, () => BOX)
    await assert.rejects(draw.execute({ commands: tooMany }, execFor()), /201 commands exceed the limit of 200/)
    // 三次拒绝之后 revision 还是只有重建 deck 那一条。
    assert.equal((await store.read(SESSION as SessionId, 0)).revision, 1)
  })
})

test('sensei_draw：没有 agent 会话时抛错', async () => {
  await withTools(async ({ draw }) => {
    await assert.rejects(draw.execute({ commands: [BOX] }, NO_AGENT), /sensei_draw: the tool ran without an agent session/)
  })
})

test('sensei_draw：schema 不开放 clear 给模型', async () => {
  await withTools(async ({ draw }) => {
    await assert.rejects(draw.execute({ commands: [{ op: 'clear' }] }, execFor()), (error: unknown) => {
      return error instanceof Error && (error as Error & { readonly code?: unknown }).code === 'INVALID_ARGS'
    })
  })
})

test('sensei_draw：面板没开时文案给出提示', async () => {
  await withTools(async ({ draw }) => {
    const [block] = draw.output.render({ slide: 1, commands: [BOX] }, { added: ['e0'], elements: 1, panelOpen: false })
    if (block === undefined || block.type !== 'text') assert.fail('结果应当是一段文本')
    assert.match(block.text, /Added 1 shape\(s\) with id\(s\): e0/)
    assert.match(block.text, /The slide now has 1 element\(s\)/)
    assert.match(block.text, /panel is closed/)
  })
})

test('三条工具：没有 agent 会话时抛错，不静默写到别处', async () => {
  await withTools(async ({ deck, slide, show }) => {
    await assert.rejects(deck.execute({ slides: [SLIDE] }, NO_AGENT), /sensei_deck: the tool ran without an agent session/)
    await assert.rejects(slide.execute({ index: 1, html: 'a' }, NO_AGENT), /sensei_slide: the tool ran without an agent session/)
    await assert.rejects(show.execute({ index: 1 }, NO_AGENT), /sensei_show: the tool ran without an agent session/)
  })
})

test('sensei_deck：单页超 64 KB、页数超 60、css 超 32 KB 都报错且不落盘', async () => {
  await withTools(async ({ deck, store }) => {
    await assert.rejects(
      deck.execute({ slides: [{ html: 'x'.repeat(64 * 1024 + 1) }] }, execFor()),
      /slide 1 is 65537 bytes; the per-slide limit is 65536 bytes/,
    )
    await assert.rejects(
      deck.execute({ slides: Array.from({ length: 61 }, () => SLIDE) }, execFor()),
      /61 slides exceed the limit of 60/,
    )
    await assert.rejects(
      deck.execute({ css: 'a'.repeat(32 * 1024 + 1), slides: [SLIDE] }, execFor()),
      /the deck css is 32769 bytes; the limit is 32768 bytes/,
    )
    assert.equal((await store.read(SESSION as SessionId, 0)).revision, 0)
  })
})

test('sensei_slide：单页超限同样拒绝', async () => {
  await withTools(async ({ slide }) => {
    await assert.rejects(
      slide.execute({ index: 1, html: 'x'.repeat(64 * 1024 + 1) }, execFor()),
      /sensei_slide: slide 1 is 65537 bytes/,
    )
  })
})

test('sensei_slide：追加不能把 deck 撑过 60 页', async () => {
  await withTools(async ({ deck, slide, store }) => {
    await deck.execute({ slides: Array.from({ length: 60 }, () => SLIDE) }, execFor())
    await assert.rejects(
      slide.execute({ index: 61, html: 'x' }, execFor()),
      /sensei_slide: the deck would have 61 slides; the limit is 60/,
    )
    assert.equal((await store.deck(SESSION as SessionId)).slides.length, 60)
  })
})

test('schema：非整数页号在进入 execute 之前就被挡住', async () => {
  await withTools(async ({ show, slide }) => {
    for (const tool of [show, slide]) {
      await assert.rejects(tool.execute({ index: '1', html: 'a' }, execFor()), (error: unknown) => {
        return error instanceof Error && (error as Error & { readonly code?: unknown }).code === 'INVALID_ARGS'
      })
    }
  })
})
