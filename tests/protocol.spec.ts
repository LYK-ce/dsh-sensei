import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  estimateExportBytes,
  parseDeckDelta,
  parseDeckOp,
  parseDrawCommand,
  parseExportBody,
  parseExportRequest,
  parseOpsBody,
  parseSnapshotRequest,
} from '../shared/protocol.ts'

/** 一个合法元素，用于 annotate 的 wire 数据。 */
const ELEMENT = {
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

/** 一条合法的直线命令。 */
const LINE = {
  op: 'line',
  from: { x: 0, y: 0 },
  to: { x: 1280, y: 720 },
  color: '#1e1e1e',
  width: 4,
}

/** 覆盖全部七种命令的合法请求体。 */
const COMMANDS = {
  commands: [
    LINE,
    { op: 'arrow', from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, color: '#e03131', width: 2 },
    { op: 'rect', at: { x: 10, y: 20 }, size: { x: 30, y: 40 }, color: '#1971c2', width: 4, fill: '#ffffff' },
    { op: 'circle', center: { x: 640, y: 360 }, radius: 50, color: '#2f9e44', width: 8 },
    { op: 'text', at: { x: 640, y: 360 }, text: '你好', size: 32, color: '#f08c00', align: 'middle' },
    { op: 'stroke', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#1e1e1e', width: 4 },
    { op: 'erase', ids: ['e0', 'e1'] },
    { op: 'clear' },
  ],
}

/** 一份覆盖全部 op 类型的合法响应。 */
const DELTA = {
  revision: 6,
  ops: [
    { op: 'deck', css: '.a{}', slides: [{ html: '<p>a</p>', title: 'A', notes: 'n' }] },
    { op: 'slide', index: 1, slide: { html: 'b' } },
    { op: 'show', index: 0 },
    { op: 'annotate', slide: 0, ops: [{ op: 'add', element: ELEMENT }, { op: 'patch', id: 'e0', isDeleted: true }, { op: 'clear' }] },
    { op: 'clear', slide: 0 },
    { op: 'exported', path: 'C:/tmp/deck.pptx' },
  ],
  snapshotRequest: null,
}

test('parseDeckDelta：六种 op 都能通过并原样返回', () => {
  assert.deepEqual(parseDeckDelta(DELTA), DELTA)
})

test('parseDeckDelta：缺省的请求字段不凭空补上', () => {
  assert.deepEqual(parseDeckDelta({ revision: 0, ops: [] }), { revision: 0, ops: [] })
  const exportRequest = { id: 'r1', pages: 2, scale: 1.5 }
  assert.deepEqual(
    parseDeckDelta({ revision: 1, ops: [], exportRequest }),
    { revision: 1, ops: [], exportRequest },
  )
})

test('parseDeckDelta：revision 与 ops 不合法时抛错', () => {
  assert.throws(() => parseDeckDelta(null), /malformed deck data at delta/)
  assert.throws(() => parseDeckDelta({ revision: 1.5, ops: [] }), /at revision/)
  assert.throws(() => parseDeckDelta({ revision: -1, ops: [] }), /at revision/)
  assert.throws(() => parseDeckDelta({ revision: 0, ops: 'nope' }), /at ops/)
  assert.throws(() => parseDeckDelta({ revision: 0, ops: [{ op: 'show', index: 0 }] }), /at ops/)
  assert.throws(() => parseDeckDelta({ revision: 0, ops: [], snapshotRequest: 7 }), /at snapshotRequest/)
})

test('parseDeckDelta：op 缺字段或标签未知时抛错', () => {
  const cases: readonly unknown[] = [
    { revision: 0, ops: [{ op: 'nope' }] },
    { revision: 0, ops: [{ op: 'deck' }] },
    { revision: 0, ops: [{ op: 'deck', slides: [{ title: 'x' }] }] },
    { revision: 0, ops: [{ op: 'slide', index: '0', slide: { html: 'a' } }] },
    { revision: 0, ops: [{ op: 'show' }] },
    { revision: 0, ops: [{ op: 'annotate', slide: 0, ops: [{ op: 'patch', id: 'e0' }] }] },
    { revision: 0, ops: [{ op: 'annotate', slide: 0, ops: [{ op: 'add', element: { ...ELEMENT, width: 'x' } }] }] },
    { revision: 0, ops: [{ op: 'annotate', slide: 0, ops: [{ op: 'add', element: { ...ELEMENT, type: 'blob' } }] }] },
    { revision: 0, ops: [{ op: 'annotate', slide: 0, ops: [{ op: 'add', element: { ...ELEMENT, type: 'text' } }] }] },
    { revision: 0, ops: [{ op: 'exported' }] },
  ]
  for (const value of cases) {
    assert.throws(() => parseDeckDelta(value), /malformed deck data/, JSON.stringify(value))
  }
})

test('parseDeckOp：磁盘 JSONL 与 wire 共用同一份校验', () => {
  for (const op of DELTA.ops) assert.deepEqual(parseDeckOp(op), op)
  assert.throws(() => parseDeckOp('nope'), /malformed deck data at op/)
})

test('parseOpsBody：翻页与批注命令都能原样通过', () => {
  assert.deepEqual(parseOpsBody({ show: 2 }), { kind: 'show', index: 2 })
  assert.deepEqual(parseOpsBody(COMMANDS), { kind: 'commands', commands: COMMANDS.commands })
  assert.deepEqual(parseOpsBody({ commands: [] }), { kind: 'commands', commands: [] })
  assert.deepEqual(parseOpsBody({ commands: [], slide: 1 }), { kind: 'commands', commands: [], slide: 1 })
})

test('parseOpsBody：两个字段同时出现、缺字段或字段不合法时抛错', () => {
  const cases: readonly unknown[] = [
    null,
    [],
    {},
    { show: 0, commands: [] },
    { show: 0, slide: 1 },
    { show: -1 },
    { show: 1.5 },
    { show: '0' },
    { commands: 'nope' },
    { commands: [null] },
    { commands: [], slide: -1 },
    { commands: [], slide: 1.5 },
    { commands: [], slide: '1' },
  ]
  for (const value of cases) {
    assert.throws(() => parseOpsBody(value), /malformed ops body/, JSON.stringify(value))
  }
})

test('parseDrawCommand：七种命令都通过并保留可选字段的缺省', () => {
  for (const command of COMMANDS.commands) assert.deepEqual(parseDrawCommand(command), command)
  const sized = { op: 'rect', at: { x: 0, y: 0 }, size: { x: 1, y: 1 }, color: '#000000', width: 2 }
  assert.deepEqual(parseDrawCommand(sized), sized)
})

test('parseDrawCommand：未知标签、缺点与坏字段都在这里被拒', () => {
  const cases: readonly unknown[] = [
    'nope',
    { op: 'nope' },
    { op: 'line', from: { x: 0 }, to: { x: 1, y: 1 }, color: '#000000', width: 2 },
    { op: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: 7, width: 2 },
    { op: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#000000', width: Number.NaN },
    { op: 'circle', center: { x: 0, y: 0 }, radius: '5', color: '#000000', width: 2 },
    { op: 'text', at: { x: 0, y: 0 }, text: 'a', size: 12, color: '#000000', align: 'center' },
    { op: 'stroke', points: [{ x: 0, y: 0 }, { x: true, y: 1 }], color: '#000000', width: 2 },
    { op: 'erase', ids: [1] },
  ]
  for (const value of cases) {
    assert.throws(() => parseDrawCommand(value), /malformed ops body/, JSON.stringify(value))
  }
})

test('parseSnapshotRequest：缺省、null 与合法对象原样返回', () => {
  assert.equal(parseSnapshotRequest(undefined), undefined)
  assert.equal(parseSnapshotRequest(null), null)
  assert.deepEqual(parseSnapshotRequest({ id: 'r1', slide: 0 }), { id: 'r1', slide: 0 })
})

test('parseSnapshotRequest：id 或页号不合法时抛错', () => {
  for (const value of [
    { id: 'r1' },
    { id: 7, slide: 0 },
    { id: 'r1', slide: -1 },
    { id: 'r1', slide: 1.5 },
    { id: 'r1', slide: '0' },
    'r1',
  ]) {
    assert.throws(() => parseSnapshotRequest(value), /malformed deck data at snapshotRequest/, JSON.stringify(value))
  }
})

test('parseExportRequest：缺省、null 与合法对象原样返回', () => {
  assert.equal(parseExportRequest(undefined), undefined)
  assert.equal(parseExportRequest(null), null)
  for (const scale of [1, 1.5, 2]) {
    assert.deepEqual(parseExportRequest({ id: 'r1', pages: 3, scale }), { id: 'r1', pages: 3, scale })
  }
})

test('parseExportRequest：页数与倍率不合法时抛错', () => {
  for (const value of [
    { id: 'r1', pages: 2 },
    { id: 'r1', pages: 0, scale: 1 },
    { id: 'r1', pages: 2.5, scale: 1 },
    { id: 'r1', pages: 2, scale: 3 },
    { id: 'r1', pages: 2, scale: '1' },
  ]) {
    assert.throws(() => parseExportRequest(value), /malformed deck data at exportRequest/, JSON.stringify(value))
  }
})

test('parseExportBody：合法页面按原顺序返回，缺页允许', () => {
  assert.deepEqual(
    parseExportBody({ pages: [{ index: 1, png: 'iVBORw0KGgo=' }, { index: 0, png: 'AAAA' }] }, 2),
    [{ index: 1, png: 'iVBORw0KGgo=' }, { index: 0, png: 'AAAA' }],
  )
  assert.deepEqual(parseExportBody({ pages: [] }, 3), [])
})

test('parseExportBody：非 base64、负页号、重复页号与超大页号都被拒', () => {
  const cases: readonly unknown[] = [
    null,
    {},
    { pages: 'nope' },
    { pages: [null] },
    { pages: [{ index: 0 }] },
    { pages: [{ index: 0, png: '' }] },
    { pages: [{ index: 0, png: 'data:image/png;base64,AAAA' }] },
    { pages: [{ index: 0, png: 'AA AA' }] },
    { pages: [{ index: 0, png: 'AAA' }] },
    { pages: [{ index: -1, png: 'AAAA' }] },
    { pages: [{ index: 2, png: 'AAAA' }] },
    { pages: [{ index: 0, png: 'AAAA' }, { index: 0, png: 'AAAA' }] },
  ]
  for (const value of cases) {
    assert.throws(() => parseExportBody(value, 2), /malformed export body/, JSON.stringify(value))
  }
})

test('estimateExportBytes：按 base64 的 3/4 估算解码后的字节数', () => {
  assert.equal(estimateExportBytes([]), 0)
  // 4 个 base64 字符 = 3 字节。
  assert.equal(estimateExportBytes([{ index: 0, png: 'AAAA' }]), 3)
  assert.equal(
    estimateExportBytes([{ index: 0, png: 'AAAA' }, { index: 1, png: 'iVBORw0KGgo=' }]),
    3 + 9,
  )
})
