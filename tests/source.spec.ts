import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDeckSource } from '../client/source.ts'
import type { DeckSource, OverflowProbe } from '../client/source.ts'
import type { DeckDelta } from '../shared/protocol.ts'
import type { Element } from '../vendor/dsh-blackboard/core/elements.ts'

/** 等已经 resolve 的 Promise 链跑完。setImmediate 不是定时器，只是让出事件循环。 */
function settle(): Promise<void> {
  return new Promise((resolve) => { setImmediate(resolve) })
}

/** 一份两页的 deck op。 */
const DECK: DeckDelta['ops'] = [{ op: 'deck', slides: [{ html: 'a' }, { html: 'b' }] }]

/** 一个最小批注元素。 */
const RECT: Element = {
  id: 'e0',
  type: 'rect',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  strokeColor: '#000000',
  strokeWidth: 2,
  isDeleted: false,
}

/** 一次提交请求的两种结局。 */
interface Pending {
  readonly resolve: (delta: DeckDelta) => void
  readonly reject: (error: Error) => void
}

/** 手动完成的 load / show / draw 队列，用来精确控制两份响应的到达顺序。 */
interface Harness {
  readonly source: DeckSource
  readonly loads: ((delta: DeckDelta) => void)[]
  /** 每一拍轮询带上的溢出测量，与 `loads` 一一对应。 */
  readonly measurements: (OverflowProbe | undefined)[]
  readonly shows: Pending[]
  readonly draws: Pending[]
  /** 每次 draw 提交时带上的页号，按提交顺序。 */
  readonly drawnOn: number[]
}

/**
 * 建一个 load / show / draw 都由测试手动完成的源。默认轮询间隔取到测试跑不完，
 * 只有订阅时那一拍（以及缺口触发的重拉）会被用到；要验证连续轮询的测试传一个很短的间隔。
 * @param pollMs - 轮询间隔，毫秒。
 * @returns 源与三个待完成队列。
 */
function createHarness(pollMs = 60_000): Harness {
  const loads: ((delta: DeckDelta) => void)[] = []
  const measurements: (OverflowProbe | undefined)[] = []
  const shows: Pending[] = []
  const draws: Pending[] = []
  const drawnOn: number[] = []
  const source = createDeckSource({
    load: (_since, measurement) => new Promise<DeckDelta>((resolve) => {
      measurements.push(measurement)
      loads.push(resolve)
    }),
    show: () => new Promise<DeckDelta>((resolve, reject) => { shows.push({ resolve, reject }) }),
    draw: (_commands, slide) => new Promise<DeckDelta>((resolve, reject) => {
      drawnOn.push(slide)
      draws.push({ resolve, reject })
    }),
    pollMs,
  })
  return { source, loads, measurements, shows, draws, drawnOn }
}

/**
 * 等下一拍轮询被挂起。
 * @param harness - 测试夹具。
 * @returns 这一拍的 resolve 函数。
 */
async function nextLoad(harness: Harness): Promise<(delta: DeckDelta) => void> {
  const before = harness.loads.length
  for (let attempt = 0; attempt < 200 && harness.loads.length === before; attempt++) {
    await new Promise((resolve) => { setTimeout(resolve, 5) })
  }
  const load = harness.loads[before]
  if (load === undefined) throw new Error('no poll was scheduled')
  return load
}

test('首订阅立刻拉一次，两拍增量按 revision 折叠', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    harness.loads[0]?.({ revision: 2, ops: [...DECK, { op: 'show', index: 1 }] })
    await settle()

    const { deck } = harness.source.getSnapshot()
    assert.deepEqual(deck.slides.map((slide) => slide.html), ['a', 'b'])
    assert.equal(deck.current, 1)
    assert.equal(deck.annotations.length, 2)
  } finally {
    stop()
  }
})

test('落后或重复的 delta 被丢弃，deck 引用不变', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    harness.loads[0]?.({ revision: 1, ops: DECK })
    await settle()
    const before = harness.source.getSnapshot()

    // 翻页响应带回同一 revision：本地已经折过，整份丢掉。
    const sent = harness.source.show(0)
    await settle()
    harness.shows[0]?.resolve({ revision: 1, ops: [] })
    await sent

    assert.equal(harness.source.getSnapshot(), before)
  } finally {
    stop()
  }
})

test('缺口：清空本地并立刻整份重拉，而不是把缺口留在身后', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    // 首拍还在路上（host 上已经有 5 条 op）时收到了一条 revision 6 的响应。
    const sent = harness.source.show(0)
    await settle()
    harness.shows[0]?.resolve({ revision: 6, ops: [{ op: 'show', index: 0 }] })
    await settle()

    assert.equal(harness.loads.length, 2, '缺口要触发一次整份重拉')
    assert.deepEqual(harness.source.getSnapshot().deck.slides, [])

    harness.loads[1]?.({
      revision: 4,
      ops: [...DECK, { op: 'show', index: 1 }, { op: 'slide', index: 2, slide: { html: 'c' } }, { op: 'exported', path: '/tmp/a.pptx' }],
    })
    await settle()
    assert.deepEqual(harness.source.getSnapshot().deck.slides.map((slide) => slide.html), ['a', 'b', 'c'])
    await sent
  } finally {
    stop()
  }
})

test('show 串行：前一拍没回来就不会发第二拍，失败也不毒化后续', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    const first = harness.source.show(0)
    await settle()
    const second = harness.source.show(1)
    await settle()
    assert.equal(harness.shows.length, 1, '第二拍必须等第一拍结束')

    harness.shows[0]?.reject(new Error('boom'))
    await assert.rejects(first, /boom/)

    await settle()
    assert.equal(harness.shows.length, 2)
    harness.shows[1]?.resolve({ revision: 1, ops: DECK })
    await second

    assert.deepEqual(harness.source.getSnapshot().deck.slides.map((slide) => slide.html), ['a', 'b'])
  } finally {
    stop()
  }
})

test('draw：与翻页共用一条队列，回包折进本地批注场景', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    harness.loads[0]?.({ revision: 1, ops: DECK })
    await settle()

    const drawn = harness.source.draw([
      { op: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, color: '#000000', width: 2 },
    ], 0)
    await settle()
    // 第一拍没回来之前不发第二拍，哪怕它是另一种提交。
    const shown = harness.source.show(1)
    await settle()
    assert.equal(harness.draws.length, 1)
    assert.deepEqual(harness.drawnOn, [0])
    assert.equal(harness.shows.length, 0, '翻页必须排在批注之后')

    harness.draws[0]?.resolve({ revision: 2, ops: [{ op: 'annotate', slide: 0, ops: [{ op: 'add', element: RECT }] }] })
    await drawn

    const { deck } = harness.source.getSnapshot()
    assert.deepEqual(deck.annotations[0]?.elements.map((element) => element.id), ['e0'])
    assert.equal(deck.annotations[1]?.elements.length, 0)
    await settle()
    assert.equal(harness.shows.length, 1)
    harness.shows[0]?.resolve({ revision: 3, ops: [{ op: 'show', index: 1 }] })
    await shown
    assert.equal(harness.source.getSnapshot().deck.current, 1)
  } finally {
    stop()
  }
})

test('draw：面板显示的页号随命令一起交给 host，而不是让它猜 current', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    harness.loads[0]?.({ revision: 1, ops: DECK })
    await settle()

    const drawn = harness.source.draw([
      { op: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, color: '#000000', width: 2 },
    ], 1)
    await settle()
    assert.deepEqual(harness.drawnOn, [1], '源必须原样转发面板的页号')

    harness.draws[0]?.resolve({ revision: 2, ops: [{ op: 'annotate', slide: 1, ops: [{ op: 'add', element: RECT }] }] })
    await drawn
    assert.deepEqual(harness.source.getSnapshot().deck.annotations[1]?.elements.map((element) => element.id), ['e0'])
  } finally {
    stop()
  }
})

test('轮询带来的请求与 deck 在同一次通知里发布', async () => {
  const harness = createHarness()
  let notified = 0
  const stop = harness.source.subscribe(() => { notified += 1 })
  try {
    harness.loads[0]?.({
      revision: 1,
      ops: DECK,
      snapshotRequest: { id: 'snap-1', slide: 1 },
      exportRequest: { id: 'export-1', pages: 2, scale: 1.5 },
    })
    await settle()

    // deck 与两条请求在同一拍到达：只通知一次，面板不会拿着新请求去栅格化旧 deck。
    assert.equal(notified, 1)
    const view = harness.source.getSnapshot()
    assert.deepEqual(view.snapshotRequest, { id: 'snap-1', slide: 1 })
    assert.deepEqual(view.exportRequest, { id: 'export-1', pages: 2, scale: 1.5 })
  } finally {
    stop()
  }
})

test('revision 没变也要发布新请求，重复的请求不换引用', async () => {
  const harness = createHarness(5)
  let notified = 0
  const stop = harness.source.subscribe(() => { notified += 1 })
  try {
    harness.loads[0]?.({ revision: 1, ops: DECK, snapshotRequest: null, exportRequest: null })
    await settle()
    assert.equal(notified, 1)
    const before = harness.source.getSnapshot()

    // 没有新 op 的轮询照样能带出新请求。
    const second = await nextLoad(harness)
    second({ revision: 1, ops: [], snapshotRequest: { id: 'snap-2', slide: 0 }, exportRequest: null })
    await settle()
    assert.equal(notified, 2)
    assert.deepEqual(harness.source.getSnapshot().snapshotRequest, { id: 'snap-2', slide: 0 })
    assert.notEqual(harness.source.getSnapshot(), before)

    // 同一个请求再报一次（缺口重拉会这样）：引用不变，不重复通知。
    const settled = harness.source.getSnapshot()
    const third = await nextLoad(harness)
    third({ revision: 1, ops: [], snapshotRequest: settled.snapshotRequest, exportRequest: null })
    await settle()
    assert.equal(notified, 2)
    assert.equal(harness.source.getSnapshot(), settled)
  } finally {
    stop()
  }
})

test('提交响应里没有请求字段，不会清空正在等待的请求', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    harness.loads[0]?.({ revision: 1, ops: DECK, snapshotRequest: { id: 'snap-3', slide: 0 }, exportRequest: null })
    await settle()

    const shown = harness.source.show(1)
    await settle()
    harness.shows[0]?.resolve({ revision: 2, ops: [{ op: 'show', index: 1 }] })
    await shown

    assert.deepEqual(harness.source.getSnapshot().snapshotRequest, { id: 'snap-3', slide: 0 })
  } finally {
    stop()
  }
})

test('缺口那拍不发布请求，重拉之后才发布', async () => {
  const harness = createHarness()
  const stop = harness.source.subscribe(() => undefined)
  try {
    // 先折出一份非空 deck，缺口才有东西可清。
    harness.loads[0]?.({ revision: 1, ops: DECK, snapshotRequest: null, exportRequest: null })
    await settle()
    assert.equal(harness.source.getSnapshot().deck.slides.length, 2)

    const shown = harness.source.show(0)
    await settle()
    harness.shows[0]?.resolve({
      revision: 5,
      ops: [{ op: 'show', index: 0 }],
      snapshotRequest: { id: 'snap-gap', slide: 0 },
      exportRequest: null,
    })
    await settle()

    assert.equal(harness.loads.length, 2, '缺口要触发一次整份重拉')
    // 清空后的 deck 要立刻发布，否则订阅者看到的还是那份已经不成立的旧引用。
    assert.deepEqual(harness.source.getSnapshot().deck.slides, [])
    // 缺口这一拍的请求不能发布：它描述的是一份本地还没对上的 deck。
    assert.equal(harness.source.getSnapshot().snapshotRequest, null)

    harness.loads[1]?.({
      revision: 2,
      ops: [...DECK, { op: 'show', index: 1 }],
      snapshotRequest: { id: 'snap-gap', slide: 0 },
      exportRequest: null,
    })
    await settle()
    assert.deepEqual(harness.source.getSnapshot().snapshotRequest, { id: 'snap-gap', slide: 0 })
    await shown
  } finally {
    stop()
  }
})

test('溢出测量：每次轮询前现取一次，注册与注销都随下一拍生效', async () => {
  const harness = createHarness(5)
  const stop = harness.source.subscribe(() => undefined)
  try {
    // 首拍在注册之前，没有测量。
    assert.equal(harness.measurements[0], undefined)

    harness.source.setOverflowProbe(() => ({ slide: 1, overflow: true }))
    const withProbe = await nextLoad(harness)
    assert.deepEqual(harness.measurements[1], { slide: 1, overflow: true })

    // 取数函数自己返回 undefined（舞台还没就绪）时，轮询就不带测量。
    harness.source.setOverflowProbe(() => undefined)
    await nextLoad(harness)
    assert.equal(harness.measurements[2], undefined)

    withProbe({ revision: 1, ops: DECK })
    await settle()
    assert.deepEqual(harness.source.getSnapshot().deck.slides.map((slide) => slide.html), ['a', 'b'])
  } finally {
    stop()
  }
})

test('最后一个监听退订即停表，重复退订无副作用', async () => {
  const harness = createHarness()
  const stopFirst = harness.source.subscribe(() => undefined)
  const stopSecond = harness.source.subscribe(() => undefined)
  await settle()
  assert.equal(harness.loads.length, 1, '同一时刻只该有一条轮询链')

  stopFirst()
  stopSecond()
  stopSecond()
  await settle()
  // 停表之后不会再有新的 load 被挂起。
  assert.equal(harness.loads.length, 1)
  assert.deepEqual(harness.source.getSnapshot().deck.slides, [])
})
