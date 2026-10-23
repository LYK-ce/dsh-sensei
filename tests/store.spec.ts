import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Deck, DeckOp } from '../core/deck.ts'
import { DeckStore } from '../host/store.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import type { Element } from '../vendor/dsh-blackboard/core/elements.ts'

/** 一份两页的 deck。 */
const TWO: DeckOp = { op: 'deck', slides: [{ html: '<p>a</p>' }, { html: '<p>b</p>' }] }

/**
 * 造一个只有本次测试用的磁盘目录。
 * @param run - 收到存储与目录的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withStore(run: (store: DeckStore, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sensei-store-'))
  const store = new DeckStore(dir)
  try {
    await run(store, dir)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

test('append：落盘一条 op 并返回本次 ops 与 revision', async () => {
  await withStore(async (store, dir) => {
    const sessionId = 'session-a' as SessionId
    const delta = await store.append(sessionId, TWO)

    assert.equal(delta.revision, 1)
    assert.deepEqual(delta.ops, [TWO])
    assert.equal(readFileSync(join(dir, 'session-a.jsonl'), 'utf8').trim().split('\n').length, 1)
    assert.deepEqual(await store.read(sessionId, 0), delta)
    assert.deepEqual(await store.read(sessionId, 1), { revision: 1, ops: [] })
  })
})

test('append：折叠结果与 read 的增量一致', async () => {
  await withStore(async (store) => {
    const sessionId = 'session-b' as SessionId
    await store.append(sessionId, TWO)
    await store.append(sessionId, { op: 'show', index: 1 })
    await store.append(sessionId, { op: 'slide', index: 2, slide: { html: 'c' } })

    const deck = await store.deck(sessionId)
    assert.deepEqual(deck.slides.map((slide) => slide.html), ['<p>a</p>', '<p>b</p>', 'c'])
    assert.equal(deck.current, 1)
    assert.deepEqual(await store.read(sessionId, 1), {
      revision: 3,
      ops: [{ op: 'show', index: 1 }, { op: 'slide', index: 2, slide: { html: 'c' } }],
    })
  })
})

test('并发 append 串行落盘，revision 不互相覆盖', async () => {
  await withStore(async (store, dir) => {
    const sessionId = 'session-race' as SessionId
    await Promise.all([
      store.append(sessionId, TWO),
      store.append(sessionId, { op: 'show', index: 0 }),
      store.append(sessionId, { op: 'exported', path: '/tmp/a.pptx' }),
    ])

    assert.equal((await store.read(sessionId, 0)).revision, 3)
    assert.equal(readFileSync(join(dir, 'session-race.jsonl'), 'utf8').trim().split('\n').length, 3)
  })
})

test('冷会话从磁盘重放：批注与当前页都还原', async () => {
  await withStore(async (store, dir) => {
    const sessionId = 'session-cold' as SessionId
    await store.append(sessionId, TWO)
    await store.append(sessionId, { op: 'show', index: 1 })
    await store.append(sessionId, { op: 'annotate', slide: 1, ops: [{ op: 'add', element: element() }] })
    await store.dispose()

    const reopened = new DeckStore(dir)
    try {
      const deck = await reopened.deck(sessionId)
      assert.equal(deck.current, 1)
      assert.deepEqual(deck.annotations.map((scene) => scene.elements.length), [0, 1])
      assert.deepEqual(await reopened.read(sessionId, 3), { revision: 3, ops: [] })
    } finally {
      await reopened.dispose()
    }
  })
})

test('损坏的 JSONL：中间坏行冒出来，最后一行写一半则丢弃', async () => {
  await withStore(async (store, dir) => {
    const sessionId = 'session-broken' as SessionId
    const good = `${JSON.stringify({ op: 'show', index: 0 })}\n`
    // 坏行后面还有内容，说明它不是"写到一半"，必须冒出来。
    await writeFile(join(dir, 'session-broken.jsonl'), `${good}{"op":"nope"}\n${good}`, 'utf8')
    await assert.rejects(store.read(sessionId, 0), /malformed deck data/)

    const other = 'session-tail' as SessionId
    await writeFile(join(dir, 'session-tail.jsonl'), `${good}{"op":"show"`, 'utf8')
    assert.deepEqual(await store.read(other, 0), { revision: 1, ops: [{ op: 'show', index: 0 }] })
  })
})

/** 一个最小批注元素。 */
function element(): Element {
  return { type: 'rect', id: 'e0', x: 0, y: 0, width: 1, height: 1, strokeColor: '#000000', strokeWidth: 1, isDeleted: false }
}

/** 一条矩形命令：每次 annotate 都由 host 分配新 id。 */
function box(): DrawCommand {
  return { op: 'rect', at: { x: 0, y: 0 }, size: { x: 10, y: 10 }, color: '#000000', width: 2 }
}

/**
 * 某页批注里的元素 id。
 * @param deck - 折叠后的 deck。
 * @param page - 0-based 页号。
 * @returns 该页全部元素（含已删除）的 id。
 */
function idsOn(deck: Deck, page: number): string[] {
  return (deck.annotations[page]?.elements ?? []).map((entry) => entry.id)
}

test('annotate：第 2 页批注不污染第 1 页，两页各自独立分配 id', async () => {
  await withStore(async (store) => {
    const sessionId = 'session-annotate' as SessionId
    await store.append(sessionId, TWO)

    const first = await store.annotate(sessionId, 0, [box()])
    assert.equal(first.ok, true)
    if (!first.ok) return
    const second = await store.annotate(sessionId, 1, [box(), box()])
    assert.equal(second.ok, true)
    if (!second.ok) return

    const deck = await store.deck(sessionId)
    // id 按页各自由 scene.nextId 分配：两页都从 e0 起。
    assert.deepEqual(idsOn(deck, 0), ['e0'])
    assert.deepEqual(idsOn(deck, 1), ['e0', 'e1'])
    assert.equal(first.delta.revision, 2)
    assert.equal(second.delta.revision, 3)
  })
})

test('annotate：同页连续两次从 e0、e1 递增，清空之后继续 e2，日志里仍是 annotate op', async () => {
  await withStore(async (store, dir) => {
    const sessionId = 'session-next-id' as SessionId
    await store.append(sessionId, TWO)

    const one = await store.annotate(sessionId, 0, [box()])
    const two = await store.annotate(sessionId, 0, [box()])
    assert.equal(one.ok, true)
    assert.equal(two.ok, true)
    assert.deepEqual(idsOn(await store.deck(sessionId), 0), ['e0', 'e1'])

    // 清空页没有独立路由：面板发的是 `{ commands: [{ op: 'clear' }] }`，所以日志里必须是
    // annotate op 包着一条 scene clear，而不是 deck 级 clear。
    const cleared = await store.annotate(sessionId, 0, [{ op: 'clear' }])
    assert.equal(cleared.ok, true)
    assert.deepEqual(idsOn(await store.deck(sessionId), 0), [])
    assert.equal((await store.deck(sessionId)).annotations[0]?.nextId, 2)

    const lines = readFileSync(join(dir, 'session-next-id.jsonl'), 'utf8').trim().split('\n')
    const logged: unknown = JSON.parse(lines[lines.length - 1] ?? '')
    assert.deepEqual(logged, { op: 'annotate', slide: 0, ops: [{ op: 'clear' }] })

    const three = await store.annotate(sessionId, 0, [box()])
    assert.equal(three.ok, true)
    if (!three.ok) return
    assert.deepEqual(three.delta.ops, [
      { op: 'annotate', slide: 0, ops: [{ op: 'add', element: elementOf('e2') }] },
    ])
  })
})

test('annotate：页号越界给原因，一条 op 都不写', async () => {
  await withStore(async (store) => {
    const sessionId = 'session-range' as SessionId
    await store.append(sessionId, TWO)

    const outside = await store.annotate(sessionId, 2, [box()])
    assert.deepEqual(outside, { ok: false, reason: 'slide 3 is out of range (the deck has 2 slide(s) and is showing slide 1)' })
    const negative = await store.annotate(sessionId, -1, [box()])
    assert.equal(negative.ok, false)
    const cleared = await store.annotate(sessionId, 9, [{ op: 'clear' }])
    assert.equal(cleared.ok, false)
    assert.equal((await store.read(sessionId, 0)).revision, 1)
  })
})

test('清空页：只清目标页，另一页批注保留', async () => {
  await withStore(async (store) => {
    const sessionId = 'session-clear' as SessionId
    await store.append(sessionId, TWO)
    await store.annotate(sessionId, 0, [box()])
    await store.annotate(sessionId, 1, [box()])

    const outcome = await store.annotate(sessionId, 0, [{ op: 'clear' }])
    assert.equal(outcome.ok, true)
    const deck = await store.deck(sessionId)
    assert.deepEqual(idsOn(deck, 0), [])
    assert.deepEqual(idsOn(deck, 1), ['e0'])
  })
})

test('annotate：空命令批次不推进 revision', async () => {
  await withStore(async (store) => {
    const sessionId = 'session-empty-batch' as SessionId
    await store.append(sessionId, TWO)

    const outcome = await store.annotate(sessionId, 0, [])
    assert.deepEqual(outcome, { ok: true, delta: { revision: 1, ops: [] } })
    assert.equal((await store.read(sessionId, 0)).revision, 1)
  })
})

test('并发 annotate：id 在同一队列内分配，不会重复', async () => {
  await withStore(async (store) => {
    const sessionId = 'session-annotate-race' as SessionId
    await store.append(sessionId, TWO)

    await Promise.all([
      store.annotate(sessionId, 0, [box()]),
      store.annotate(sessionId, 0, [box()]),
      store.annotate(sessionId, 0, [box()]),
    ])

    assert.deepEqual(idsOn(await store.deck(sessionId), 0), ['e0', 'e1', 'e2'])
  })
})

/**
 * 一条 `rect` 命令折出来的元素，用于断言 annotate 的 op 内容。
 * @param id - host 分配的 id。
 * @returns 与 `box()` 对应的元素。
 */
function elementOf(id: string): Element {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    strokeColor: '#000000',
    strokeWidth: 2,
    isDeleted: false,
  }
}
