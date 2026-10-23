import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyDeck, foldDeck } from '../core/deck.ts'
import type { Deck, Slide } from '../core/deck.ts'
import type { Element } from '../vendor/dsh-blackboard/core/elements.ts'

/** 造一页；只关心 html 的用例不必写标题。 */
function slide(html: string, title?: string): Slide {
  return title === undefined ? { html } : { html, title }
}

/** 一份有 `count` 页的 deck。 */
function deckOf(...htmls: readonly string[]): Deck {
  return foldDeck(emptyDeck(), { op: 'deck', slides: htmls.map((html) => slide(html)) })
}

/** 一个最小矩形元素，只用来观察批注落到了哪一页。 */
function rect(id: string): Element {
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

/** 某页批注里的元素 id。 */
function idsOn(deck: Deck, page: number): string[] {
  return (deck.annotations[page]?.elements ?? []).map((element) => element.id)
}

test('deck：整份重建写出页、css 与逐页空批注，并清掉旧批注与 lastExport', () => {
  const before = foldDeck(deckOf('a', 'b'), { op: 'exported', path: '/tmp/deck.pptx' })
  const annotated = foldDeck(before, { op: 'annotate', slide: 0, ops: [{ op: 'add', element: rect('e0') }] })

  const rebuilt = foldDeck(annotated, { op: 'deck', css: '.title { color: red }', slides: [slide('x', 'T'), slide('y')] })

  assert.deepEqual(rebuilt.slides, [{ html: 'x', title: 'T' }, { html: 'y' }])
  assert.equal(rebuilt.css, '.title { color: red }')
  assert.equal(rebuilt.current, 0)
  assert.equal(rebuilt.annotations.length, 2)
  assert.deepEqual(idsOn(rebuilt, 0), [])
  assert.equal(Object.hasOwn(rebuilt, 'lastExport'), false)
})

test('deck：不给 css 时是空串', () => {
  assert.equal(deckOf('a').css, '')
  assert.deepEqual(deckOf().slides, [])
})

test('slide：index 等于页数时追加，并补一页空批注', () => {
  const appended = foldDeck(deckOf('a'), { op: 'slide', index: 1, slide: slide('b', 'B') })

  assert.deepEqual(appended.slides, [{ html: 'a' }, { html: 'b', title: 'B' }])
  assert.equal(appended.annotations.length, 2)
  assert.deepEqual(idsOn(appended, 1), [])
})

test('slide：改已有页时保留该页与其他页的批注', () => {
  const annotated = foldDeck(deckOf('a', 'b'), { op: 'annotate', slide: 0, ops: [{ op: 'add', element: rect('e0') }] })
  const replaced = foldDeck(annotated, { op: 'slide', index: 0, slide: slide('a2') })

  assert.deepEqual(replaced.slides, [{ html: 'a2' }, { html: 'b' }])
  assert.deepEqual(idsOn(replaced, 0), ['e0'])
  assert.equal(replaced.annotations.length, 2)
})

test('slide：越界索引（负数、跳过页数、小数、NaN）静默忽略并返回原对象', () => {
  const deck = deckOf('a')
  for (const index of [-1, 2, 0.5, Number.NaN]) {
    assert.equal(foldDeck(deck, { op: 'slide', index, slide: slide('x') }), deck, `index=${index}`)
  }
})

test('show：合法页号写进 current，越界与空 deck 都静默忽略', () => {
  const deck = deckOf('a', 'b', 'c')
  assert.equal(foldDeck(deck, { op: 'show', index: 2 }).current, 2)
  assert.equal(foldDeck(deck, { op: 'show', index: -1 }).current, 0)
  assert.equal(foldDeck(deck, { op: 'show', index: 3 }).current, 0)
  assert.equal(foldDeck(deck, { op: 'show', index: 1.5 }).current, 0)
  const empty = emptyDeck()
  assert.equal(foldDeck(empty, { op: 'show', index: 0 }), empty)
})

test('annotate：只落到目标页，其他页不受影响', () => {
  const deck = deckOf('a', 'b')
  const once = foldDeck(deck, { op: 'annotate', slide: 1, ops: [{ op: 'add', element: rect('e0') }] })
  const twice = foldDeck(once, { op: 'annotate', slide: 1, ops: [{ op: 'add', element: rect('e1') }] })

  assert.deepEqual(idsOn(twice, 0), [])
  assert.deepEqual(idsOn(twice, 1), ['e0', 'e1'])
  // 每一次 annotate 都返回新 deck，旧对象保持不变。
  assert.equal(deck.annotations[1]?.elements.length, 0)
})

test('annotate：越界页号与空 ops 静默忽略', () => {
  const deck = deckOf('a')
  assert.equal(foldDeck(deck, { op: 'annotate', slide: 3, ops: [{ op: 'add', element: rect('e0') }] }), deck)
  assert.equal(foldDeck(deck, { op: 'annotate', slide: -1, ops: [] }), deck)
})

test('annotate：patch 与 clear 走 vendor 的 SceneOp 语义', () => {
  const added = foldDeck(deckOf('a'), { op: 'annotate', slide: 0, ops: [{ op: 'add', element: rect('e0') }] })
  const patched = foldDeck(added, { op: 'annotate', slide: 0, ops: [{ op: 'patch', id: 'e0', isDeleted: true }] })

  assert.deepEqual(patched.annotations[0]?.elements.map((element) => element.isDeleted), [true])
  const cleared = foldDeck(patched, { op: 'annotate', slide: 0, ops: [{ op: 'clear' }] })
  assert.deepEqual(idsOn(cleared, 0), [])
})

test('clear：清空目标页，越界页号静默忽略', () => {
  const annotated = foldDeck(deckOf('a', 'b'), { op: 'annotate', slide: 0, ops: [{ op: 'add', element: rect('e0') }] })
  const cleared = foldDeck(annotated, { op: 'clear', slide: 0 })

  assert.deepEqual(idsOn(cleared, 0), [])
  assert.equal(foldDeck(annotated, { op: 'clear', slide: 9 }), annotated)
})

test('clear：只清目标页，别的页批注不受影响', () => {
  const annotated = foldDeck(deckOf('a', 'b'), {
    op: 'annotate',
    slide: 0,
    ops: [{ op: 'add', element: rect('e0') }, { op: 'add', element: rect('e1') }],
  })
  const second = foldDeck(annotated, { op: 'annotate', slide: 1, ops: [{ op: 'add', element: rect('e2') }] })
  const cleared = foldDeck(second, { op: 'clear', slide: 0 })

  assert.deepEqual(idsOn(cleared, 0), [])
  assert.deepEqual(idsOn(cleared, 1), ['e2'])
})

test('clear：元素清空但 nextId 保留，之后的 id 继续单调递增', () => {
  const annotated = foldDeck(deckOf('a'), {
    op: 'annotate',
    slide: 0,
    ops: [{ op: 'add', element: rect('e0') }, { op: 'add', element: rect('e1') }],
  })
  const cleared = foldDeck(annotated, { op: 'clear', slide: 0 })
  assert.equal(cleared.annotations[0]?.nextId, 2)

  const again = foldDeck(cleared, { op: 'annotate', slide: 0, ops: [{ op: 'add', element: rect('e2') }] })
  assert.deepEqual(idsOn(again, 0), ['e2'])
  assert.equal(again.annotations[0]?.nextId, 3)
})

test('exported：记录落点，其余字段不变', () => {
  const deck = deckOf('a')
  const exported = foldDeck(deck, { op: 'exported', path: 'C:/tmp/deck.pptx' })

  assert.equal(exported.lastExport, 'C:/tmp/deck.pptx')
  assert.equal(exported.slides, deck.slides)
})
