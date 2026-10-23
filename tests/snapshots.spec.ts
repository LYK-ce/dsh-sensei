import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ExportLedger, SnapshotLedger } from '../host/snapshots.ts'

/** 一张最小的"PNG"。 */
const PNG = new Uint8Array([137, 80, 78, 71])

test('outstanding：没有等待中的请求时是 null，发起后给出 id 与参数', async () => {
  const ledger = new SnapshotLedger()
  try {
    assert.equal(ledger.outstanding('s'), null)
    const pending = ledger.request('s', { slide: 3 }, 5_000)
    const outstanding = ledger.outstanding('s')
    assert.equal(typeof outstanding?.id, 'string')
    assert.equal(outstanding?.slide, 3)

    assert.equal(ledger.deliver('s', outstanding?.id ?? '', PNG), true)
    assert.equal(ledger.outstanding('s'), null)
    assert.deepEqual(await pending, PNG)
  } finally {
    ledger.dispose()
  }
})

test('deliver：id 对不上（过期或伪造）返回 false，且不影响等待中的请求', async () => {
  const ledger = new ExportLedger()
  try {
    const pending = ledger.request('s', { pages: 2, scale: 1 }, 5_000)
    assert.equal(ledger.deliver('s', 'not-the-id', []), false)
    // 会话也要对上：同一个 id 打错会话不该被收下。
    assert.equal(ledger.deliver('other', ledger.outstanding('s')?.id ?? '', []), false)

    const pages = [{ index: 0, png: 'AAAA' }]
    assert.equal(ledger.deliver('s', ledger.outstanding('s')?.id ?? '', pages), true)
    assert.deepEqual(await pending, pages)
  } finally {
    ledger.dispose()
  }
})

test('同一会话的新请求挤掉旧请求，两个会话互不影响', async () => {
  const ledger = new ExportLedger()
  try {
    const first = ledger.request('s', { pages: 1, scale: 1 }, 5_000)
    const firstId = ledger.outstanding('s')?.id ?? ''
    const second = ledger.request('s', { pages: 2, scale: 2 }, 5_000)

    await assert.rejects(first, /a newer export request replaced this one/)
    assert.equal(ledger.outstanding('s')?.id === firstId, false)
    assert.equal(ledger.outstanding('s')?.pages, 2)

    const other = ledger.request('other', { pages: 1, scale: 1 }, 5_000)
    assert.equal(ledger.deliver('s', ledger.outstanding('s')?.id ?? '', []), true)
    assert.equal(ledger.outstanding('other')?.pages, 1)

    assert.deepEqual(await second, [])
    ledger.deliver('other', ledger.outstanding('other')?.id ?? '', [])
    assert.deepEqual(await other, [])
  } finally {
    ledger.dispose()
  }
})

test('超时：没有面板应答时按超时时间失败，文案指向右侧栏', async () => {
  const ledger = new SnapshotLedger()
  try {
    const pending = ledger.request('s', { slide: 0 }, 10)
    await assert.rejects(pending, /no panel answered the snapshot request within 10ms; open the Sensei tab in the right sidebar/)
    assert.equal(ledger.outstanding('s'), null)
  } finally {
    ledger.dispose()
  }
})

test('超时：导出超时把面板最后一次报来的进度写进文案', async () => {
  const ledger = new ExportLedger()
  try {
    const pending = ledger.request('s', { pages: 5, scale: 2 }, 10)
    const requestId = ledger.outstanding('s')?.id ?? ''
    assert.equal(ledger.noteProgress('s', 'not-the-id', 1, 5), false)
    assert.equal(ledger.noteProgress('s', requestId, 3, 5), true)

    await assert.rejects(
      pending,
      /no panel answered the export request within 10ms \(the panel had rendered 3 of 5 slide\(s\)\); open the Sensei tab/,
    )
  } finally {
    ledger.dispose()
  }
})

test('进度：新请求会清掉上一轮的进度，不会算到下一轮头上', async () => {
  const ledger = new ExportLedger()
  try {
    const first = ledger.request('s', { pages: 5, scale: 1 }, 60_000)
    const firstId = ledger.outstanding('s')?.id ?? ''
    assert.equal(ledger.noteProgress('s', firstId, 4, 5), true)

    const second = ledger.request('s', { pages: 5, scale: 1 }, 10)
    await assert.rejects(first, /replaced this one/)
    await assert.rejects(second, /within 10ms; open the Sensei tab/)
  } finally {
    ledger.dispose()
  }
})

test('取消：abort 之后立刻失败，之后迟到的交付被拒', async () => {
  const ledger = new SnapshotLedger()
  const controller = new AbortController()
  try {
    const pending = ledger.request('s', { slide: 0 }, 5_000, controller.signal)
    const requestId = ledger.outstanding('s')?.id ?? ''
    controller.abort()

    await assert.rejects(pending, /the snapshot request was cancelled/)
    assert.equal(ledger.deliver('s', requestId, PNG), false)
  } finally {
    ledger.dispose()
  }
})

test('取消：已经 abort 的信号不会挂起请求', async () => {
  const ledger = new SnapshotLedger()
  const controller = new AbortController()
  controller.abort()
  try {
    await assert.rejects(ledger.request('s', { slide: 0 }, 5_000, controller.signal), /cancelled/)
    assert.equal(ledger.outstanding('s'), null)
  } finally {
    ledger.dispose()
  }
})

test('dispose：结束所有等待中的请求', async () => {
  const ledger = new SnapshotLedger()
  const one = ledger.request('a', { slide: 0 }, 5_000)
  const two = ledger.request('b', { slide: 1 }, 5_000)
  ledger.dispose()

  await assert.rejects(one, /the sensei plugin is unloading/)
  await assert.rejects(two, /the sensei plugin is unloading/)
  assert.equal(ledger.outstanding('a'), null)
  assert.equal(ledger.outstanding('b'), null)
})
