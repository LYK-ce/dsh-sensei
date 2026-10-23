import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DeckOp } from '../core/deck.ts'
import { PanelPresence } from '../host/presence.ts'
import { handleExport, handleOps, handleProgress, handleSnapshot, handleState } from '../host/routes.ts'
import { ExportLedger, SnapshotLedger } from '../host/snapshots.ts'
import { DeckStore } from '../host/store.ts'

/** 两页 deck。 */
const TWO: DeckOp = { op: 'deck', slides: [{ html: '<p>a</p>' }, { html: '<p>b</p>' }] }

/** 一条会分配 id 的矩形命令。 */
const BOX = { op: 'rect', at: { x: 0, y: 0 }, size: { x: 10, y: 10 }, color: '#000000', width: 2 }

/** 一段形态合法的 base64（PNG 前 8 字节），路由只校验形态，不解码。 */
const PNG_BASE64 = 'iVBORw0KGgo='

/**
 * 造一份状态路由要的账本；每个测试各用一份，避免等待中的请求互相干扰。
 * @returns 两条产出请求账本。
 */
function ledgers(): { readonly snapshots: SnapshotLedger; readonly exports: ExportLedger } {
  return { snapshots: new SnapshotLedger(), exports: new ExportLedger() }
}

/**
 * 造一个只有本次测试用的存储与心跳表。
 * @param run - 收到存储、心跳表与两条账本的测试体。
 * @returns 测试体跑完后清理磁盘。
 */
async function withStore(
  run: (store: DeckStore, presence: PanelPresence, requests: ReturnType<typeof ledgers>) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'sensei-routes-'))
  const store = new DeckStore(dir)
  try {
    await run(store, new PanelPresence(() => 0), ledgers())
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 造一个指向讲演路由的请求。
 * @param path - 含查询串的绝对路径。
 * @param body - POST 的请求体，未传时不带体。
 * @param method - HTTP 方法。
 * @returns 该请求。
 */
function request(path: string, body?: string, method = 'GET'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    ...(body === undefined ? {} : { body }),
  })
}

test('GET state：空会话返回空 ops 与两个 null 请求位', async () => {
  await withStore(async (store, presence, requests) => {
    const response = await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s1&since=0'))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { revision: 0, ops: [], snapshotRequest: null, exportRequest: null })
  })
})

test('GET state：成功即心跳，缺参或 since 非法时 400 且不计心跳', async () => {
  await withStore(async (store, presence, requests) => {
    const sessionId = 's2' as SessionId
    assert.equal(presence.isOpen(sessionId), false)

    await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s2&since=0'))
    assert.equal(presence.isOpen(sessionId), true)
  })

  await withStore(async (store, presence, requests) => {
    for (const path of [
      '/api/sensei.state',
      '/api/sensei.state?sessionId=',
      '/api/sensei.state?sessionId=s&since=-1',
      '/api/sensei.state?sessionId=s&since=abc',
      '/api/sensei.state?sessionId=s&since=1.5',
    ]) {
      const response = await handleState(store, presence, requests, request(path))
      assert.equal(response.status, 400, path)
    }
    // 被拒的请求不是心跳。
    assert.equal(presence.isOpen('s' as SessionId), false)
  })
})

test('GET state：按 since 增量返回，越界 since 按流长处理', async () => {
  await withStore(async (store, presence, requests) => {
    await store.append('s3' as SessionId, TWO)
    await store.append('s3' as SessionId, { op: 'show', index: 1 })

    const all = await (await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s3&since=0'))).json()
    assert.deepEqual(all, {
      revision: 2,
      ops: [TWO, { op: 'show', index: 1 }],
      snapshotRequest: null,
      exportRequest: null,
    })
    const tail = await (await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s3&since=1'))).json()
    assert.deepEqual(tail, { revision: 2, ops: [{ op: 'show', index: 1 }], snapshotRequest: null, exportRequest: null })
    const none = await (await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s3&since=99'))).json()
    assert.deepEqual(none, { revision: 2, ops: [], snapshotRequest: null, exportRequest: null })
  })
})

test('GET state：顺手报来的溢出测量挂到指定页，过期后不再回值', async () => {
  let now = 0
  const dir = await mkdtemp(join(tmpdir(), 'sensei-routes-'))
  const store = new DeckStore(dir)
  const presence = new PanelPresence(() => now)
  const requests = ledgers()
  const sessionId = 's10' as SessionId
  try {
    const response = await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s10&since=0&slide=1&overflow=1'))
    assert.equal(response.status, 200)
    assert.equal(presence.overflowOf(sessionId, 1), true)
    // 量的是第 1 页，问第 0 页没有答案。
    assert.equal(presence.overflowOf(sessionId, 0), undefined)

    now = 3_001
    assert.equal(presence.overflowOf(sessionId, 1), undefined)
  } finally {
    await store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('GET state：slide/overflow 只给一个或取值不合法时 400 且不计测量', async () => {
  await withStore(async (store, presence, requests) => {
    for (const path of [
      '/api/sensei.state?sessionId=s&since=0&slide=1',
      '/api/sensei.state?sessionId=s&since=0&overflow=1',
      '/api/sensei.state?sessionId=s&since=0&slide=-1&overflow=1',
      '/api/sensei.state?sessionId=s&since=0&slide=1.5&overflow=1',
      '/api/sensei.state?sessionId=s&since=0&slide=1&overflow=2',
    ]) {
      const response = await handleState(store, presence, requests, request(path))
      assert.equal(response.status, 400, path)
    }
    assert.equal(presence.overflowOf('s' as SessionId, 1), undefined)
  })
})

test('GET state：等待中的请求 id 与参数随响应下发', async () => {
  await withStore(async (store, presence, requests) => {
    const pending = requests.snapshots.request('s11', { slide: 1 }, 5_000)
    const snapshotId = requests.snapshots.outstanding('s11')?.id
    const exportPending = requests.exports.request('s11', { pages: 2, scale: 1.5 }, 5_000)
    const exportId = requests.exports.outstanding('s11')?.id

    const delta = await (await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s11&since=0'))).json()
    assert.deepEqual(delta.snapshotRequest, { id: snapshotId, slide: 1 })
    assert.deepEqual(delta.exportRequest, { id: exportId, pages: 2, scale: 1.5 })

    // 别让等待中的请求在测试结束后继续计时。
    const png = new Uint8Array([1, 2, 3])
    requests.snapshots.deliver('s11', snapshotId ?? '', png)
    requests.exports.deliver('s11', exportId ?? '', [])
    assert.deepEqual(await pending, png)
    assert.deepEqual(await exportPending, [])
  })
})

test('POST ops：翻页成功，随后的 state 增量读到它', async () => {
  await withStore(async (store, presence, requests) => {
    await store.append('s4' as SessionId, TWO)
    const response = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s4',
      JSON.stringify({ show: 1 }),
      'POST',
    ))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { revision: 2, ops: [{ op: 'show', index: 1 }] })
    const delta = await (await handleState(store, presence, requests, request('/api/sensei.state?sessionId=s4&since=1'))).json()
    assert.deepEqual(delta, { revision: 2, ops: [{ op: 'show', index: 1 }], snapshotRequest: null, exportRequest: null })
  })
})

test('POST ops：参数或 body 不合法时 400，一条都不写', async () => {
  await withStore(async (store) => {
    await store.append('s5' as SessionId, TWO)
    const cases: readonly (readonly [string, string | undefined])[] = [
      ['/api/sensei.ops', JSON.stringify({ show: 0 })],
      ['/api/sensei.ops?sessionId=', JSON.stringify({ show: 0 })],
      ['/api/sensei.ops?sessionId=s5', 'not json'],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({})],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ show: '1' })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ show: 1.5 })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ show: -1 })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ show: 2 })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ show: 0, commands: [] })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ show: 0, slide: 1 })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ commands: [], slide: -1 })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ commands: [], slide: 1.5 })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ commands: [], slide: '1' })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ commands: [{ op: 'nope' }] })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify({ commands: [{ op: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] })],
      ['/api/sensei.ops?sessionId=s5', JSON.stringify([{ show: 0 }])],
    ]
    for (const [path, body] of cases) {
      const response = await handleOps(store, request(path, body, 'POST'))
      assert.equal(response.status, 400, `${path} ${String(body)}`)
    }
    // 被拒的请求没有推进 revision。
    assert.equal((await store.read('s5' as SessionId, 0)).revision, 1)
  })
})

test('POST ops：越界提示带上页数与当前页，不夹取', async () => {
  await withStore(async (store) => {
    await store.append('s6' as SessionId, TWO)
    await store.append('s6' as SessionId, { op: 'show', index: 1 })

    const response = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s6',
      JSON.stringify({ show: 5 }),
      'POST',
    ))
    assert.equal(response.status, 400)
    const message = await response.text()
    assert.match(message, /slide index 5 is out of range/)
    assert.match(message, /the deck has 2 slide\(s\)/)
    assert.match(message, /showing slide 2/)
  })
})

test('POST ops：命令折成 annotate 落在当前页，翻页后的第 2 页批注与第 1 页互不影响', async () => {
  await withStore(async (store) => {
    await store.append('s7' as SessionId, TWO)
    const first = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s7',
      JSON.stringify({ commands: [BOX] }),
      'POST',
    ))
    assert.equal(first.status, 200)
    const firstDelta = await first.json()
    assert.equal(firstDelta.revision, 2)
    assert.deepEqual(firstDelta.ops, [{
      op: 'annotate',
      slide: 0,
      ops: [{
        op: 'add',
        element: {
          id: 'e0',
          type: 'rect',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          strokeColor: '#000000',
          strokeWidth: 2,
          isDeleted: false,
        },
      }],
    }])

    await store.append('s7' as SessionId, { op: 'show', index: 1 })
    const second = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s7',
      JSON.stringify({ commands: [BOX] }),
      'POST',
    ))
    assert.equal(second.status, 200)

    const deck = await store.deck('s7' as SessionId)
    assert.deepEqual(deck.annotations.map((scene) => scene.elements.map((element) => element.id)), [['e0'], ['e0']])
  })
})

test('POST ops：面板带的页号优先于 host 的 current', async () => {
  await withStore(async (store) => {
    const sessionId = 's12' as SessionId
    await store.append(sessionId, TWO)
    // host 的 current 还是第 1 页，但人在第 2 页画：命令必须落到面板显示的那一页。
    assert.equal((await store.deck(sessionId)).current, 0)
    const response = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s12',
      JSON.stringify({ commands: [BOX], slide: 1 }),
      'POST',
    ))
    assert.equal(response.status, 200)

    const deck = await store.deck(sessionId)
    assert.deepEqual(deck.annotations.map((scene) => scene.elements.length), [0, 1])
  })
})

test('POST ops：clear 命令只清当前页，另一页批注保留', async () => {
  await withStore(async (store) => {
    const sessionId = 's8' as SessionId
    await store.append(sessionId, TWO)
    await handleOps(store, request('/api/sensei.ops?sessionId=s8', JSON.stringify({ commands: [BOX] }), 'POST'))
    await store.append(sessionId, { op: 'show', index: 1 })
    await handleOps(store, request('/api/sensei.ops?sessionId=s8', JSON.stringify({ commands: [BOX] }), 'POST'))
    await store.append(sessionId, { op: 'show', index: 0 })

    const cleared = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s8',
      JSON.stringify({ commands: [{ op: 'clear' }] }),
      'POST',
    ))
    assert.equal(cleared.status, 200)

    const deck = await store.deck(sessionId)
    assert.deepEqual(deck.annotations.map((scene) => scene.elements.length), [0, 1])
  })
})

test('POST ops：空 deck 上画批注报"还没有幻灯片"', async () => {
  await withStore(async (store) => {
    const response = await handleOps(store, request(
      '/api/sensei.ops?sessionId=empty-draw',
      JSON.stringify({ commands: [BOX] }),
      'POST',
    ))
    assert.equal(response.status, 400)
    const message = await response.text()
    assert.match(message, /slide 1 is out of range/)
    assert.match(message, /the deck has no slides yet/)
  })
})

test('POST ops：空命令批次是合法的空操作', async () => {
  await withStore(async (store) => {
    await store.append('s9' as SessionId, TWO)
    const response = await handleOps(store, request(
      '/api/sensei.ops?sessionId=s9',
      JSON.stringify({ commands: [] }),
      'POST',
    ))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { revision: 1, ops: [] })
  })
})

test('POST ops：空 deck 翻页报"还没有幻灯片"', async () => {
  await withStore(async (store) => {
    const response = await handleOps(store, request(
      '/api/sensei.ops?sessionId=empty',
      JSON.stringify({ show: 0 }),
      'POST',
    ))
    assert.equal(response.status, 400)
    assert.match(await response.text(), /the deck has no slides yet/)
  })
})

test('POST snapshot：参数或 body 不合法时 400，迟到交付 409，正常交付 200', async () => {
  const snapshots = new SnapshotLedger()
  const pending = snapshots.request('s', { slide: 0 }, 5_000)
  const requestId = snapshots.outstanding('s')?.id ?? ''
  const path = `/api/sensei.snapshot?sessionId=s&requestId=${encodeURIComponent(requestId)}`

  for (const target of [
    '/api/sensei.snapshot',
    '/api/sensei.snapshot?sessionId=s',
    '/api/sensei.snapshot?requestId=x',
  ]) {
    const response = await handleSnapshot(snapshots, request(target, undefined, 'POST'))
    assert.equal(response.status, 400, target)
  }
  assert.equal((await handleSnapshot(snapshots, request(path, undefined, 'POST'))).status, 400, '空 body')
  assert.equal((await handleSnapshot(snapshots, request(
    '/api/sensei.snapshot?sessionId=s&requestId=stale',
    'png',
    'POST',
  ))).status, 409, '迟到交付')

  const png = new Uint8Array([1, 2, 3])
  // 用真正的字节再交付一次：前面的 400/409 都没有把它消耗掉。
  const bytes = await handleSnapshot(snapshots, new Request(`http://127.0.0.1${path}`, { method: 'POST', body: png }))
  assert.equal(bytes.status, 200)
  assert.deepEqual(await bytes.json(), { delivered: true })
  assert.deepEqual(await pending, png)

  // 同一个请求已经结束，再交付一次就是迟到。
  const again = await handleSnapshot(snapshots, new Request(`http://127.0.0.1${path}`, { method: 'POST', body: png }))
  assert.equal(again.status, 409)
})

test('POST export：参数 400、迟到 409、正常 200，body 校验错误 400', async () => {
  const exports = new ExportLedger()
  const pending = exports.request('s', { pages: 2, scale: 1 }, 5_000)
  const requestId = exports.outstanding('s')?.id ?? ''
  const path = `/api/sensei.export?sessionId=s&requestId=${encodeURIComponent(requestId)}`

  for (const target of [
    '/api/sensei.export',
    '/api/sensei.export?sessionId=s',
    '/api/sensei.export?requestId=x',
  ]) {
    const response = await handleExport(exports, request(target, JSON.stringify({ pages: [] }), 'POST'))
    assert.equal(response.status, 400, target)
  }

  const late = await handleExport(exports, request(
    '/api/sensei.export?sessionId=s&requestId=stale',
    JSON.stringify({ pages: [] }),
    'POST',
  ))
  assert.equal(late.status, 409)

  for (const body of [
    'not json',
    JSON.stringify({}),
    JSON.stringify({ pages: [{ index: 0, png: 'data:image/png;base64,AAAA' }] }),
    JSON.stringify({ pages: [{ index: -1, png: PNG_BASE64 }] }),
    JSON.stringify({ pages: [{ index: 2, png: PNG_BASE64 }] }),
    JSON.stringify({ pages: [{ index: 0, png: PNG_BASE64 }, { index: 0, png: PNG_BASE64 }] }),
  ]) {
    const response = await handleExport(exports, request(path, body, 'POST'))
    assert.equal(response.status, 400, body)
  }

  const ok = await handleExport(exports, request(path, JSON.stringify({ pages: [{ index: 1, png: PNG_BASE64 }] }), 'POST'))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { delivered: true })
  assert.deepEqual(await pending, [{ index: 1, png: PNG_BASE64 }])
})

test('POST progress：合法进度记在等待中的导出上，参数非法 400，迟到或错 id 409', async () => {
  const exports = new ExportLedger()
  const pending = exports.request('s', { pages: 3, scale: 2 }, 5_000)
  const requestId = exports.outstanding('s')?.id ?? ''
  const path = (query: string): string => `/api/sensei.progress?sessionId=s&requestId=${encodeURIComponent(requestId)}&${query}`

  for (const target of [
    '/api/sensei.progress',
    '/api/sensei.progress?sessionId=s',
    '/api/sensei.progress?requestId=x',
    path('rendered=0&total=3'),
    path('rendered=4&total=3'),
    path('rendered=1.5&total=3'),
    path('rendered=1&total=0'),
    path('rendered=1'),
  ]) {
    const response = await handleProgress(exports, request(target, undefined, 'POST'))
    assert.equal(response.status, 400, target)
  }

  const late = await handleProgress(exports, request(
    '/api/sensei.progress?sessionId=s&requestId=stale&rendered=1&total=3',
    undefined,
    'POST',
  ))
  assert.equal(late.status, 409)

  const recorded = await handleProgress(exports, request(path('rendered=2&total=3'), undefined, 'POST'))
  assert.equal(recorded.status, 200)
  assert.deepEqual(await recorded.json(), { recorded: true })

  // 导出一旦交付，进度就跟着请求一起作废。
  assert.equal(exports.deliver('s', requestId, []), true)
  assert.deepEqual(await pending, [])
  const after = await handleProgress(exports, request(path('rendered=3&total=3'), undefined, 'POST'))
  assert.equal(after.status, 409)
})
