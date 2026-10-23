/**
 * 讲演 deck 的数据模型与折叠规则。
 *
 * host 与浏览器两边都按同一份 `DeckOp` 流折叠，所以这里必须是纯函数：同一串 op 在任何一侧
 * 都得到同一个 deck。`revision = 流长度` 也由这里决定（见 `host/store.ts` 的前提说明）。
 */
import { assertNever } from '../vendor/dsh-blackboard/core/assert.ts'
import { createScene } from '../vendor/dsh-blackboard/core/scene.ts'
import type { Scene } from '../vendor/dsh-blackboard/core/scene.ts'
import { applyOps } from '../vendor/dsh-blackboard/shared/ops.ts'
import type { SceneOp } from '../vendor/dsh-blackboard/shared/ops.ts'

/** 一页幻灯片：只有 body 片段，样式走 deck.css 或页内行内 `<style>`。 */
export interface Slide {
  /** 放进 `.sensei-slide` 里的 HTML 片段，由渲染侧净化。 */
  readonly html: string
  /** 状态行、导出文件名、模型自查用。 */
  readonly title?: string
  /** 模型自己的讲稿，被打断后靠它接上。 */
  readonly notes?: string
}

/** 一份 deck 的完整状态。 */
export interface Deck {
  /** 整份共享的样式，只写一次。 */
  readonly css: string
  readonly slides: readonly Slide[]
  /** 0-based；`slides` 为空时无意义（按 0 存）。 */
  readonly current: number
  /** 与 `slides` 等长，逐页场景。 */
  readonly annotations: readonly Scene[]
  /** 最近一次导出的绝对路径，没有则 undefined。 */
  readonly lastExport?: string
}

/** deck 的一次变更，append-only 日志与面板增量都走它。 */
export type DeckOp =
  /** 整份重建：清空全部批注（页号语义已变）。 */
  | { readonly op: 'deck'; readonly css?: string; readonly slides: readonly Slide[] }
  /** 单页 upsert；`index === slides.length` 表示追加。 */
  | { readonly op: 'slide'; readonly index: number; readonly slide: Slide }
  /** 翻页，人与 agent 共用；0-based。 */
  | { readonly op: 'show'; readonly index: number }
  /** host 已分配好 id 的批注增量。 */
  | { readonly op: 'annotate'; readonly slide: number; readonly ops: readonly SceneOp[] }
  /** 清空某页批注。 */
  | { readonly op: 'clear'; readonly slide: number }
  /** 记录最近落点。 */
  | { readonly op: 'exported'; readonly path: string }

/** 空 deck：还没有任何幻灯片。 */
export function emptyDeck(): Deck {
  return { css: '', slides: [], current: 0, annotations: [] }
}

/**
 * 越界说明：页数与当前页（1-based）都带上，调用方才有一次改对的机会。
 *
 * 工具与 route 共用这一句，避免两处文案各自漂移；索引合法性本身由 {@link foldDeck} 静默忽略，
 * 需要报错的地方（工具、route）在这里取文案。
 * @param deck - 当前 deck。
 * @returns 一句英文说明，空 deck 明确说"还没有幻灯片"。
 */
export function describePages(deck: Deck): string {
  const pages = deck.slides.length
  if (pages === 0) return 'the deck has no slides yet'
  return `the deck has ${pages} slide(s) and is showing slide ${deck.current + 1}`
}

/**
 * 把一个 op 折进 deck。
 *
 * 非法索引**静默忽略**并返回原对象：重放（磁盘日志、面板增量）必须能吞掉别人已经越过的 op，
 * 否则一次历史异常会让整条流折叠不下去。需要向模型报错的是工具与 route，不是这里。
 * @param deck - 起始 deck，不被修改。
 * @param op - 按顺序应用的变更。
 * @returns 新 deck；没有实际变化时返回同一个引用。
 */
export function foldDeck(deck: Deck, op: DeckOp): Deck {
  switch (op.op) {
    case 'deck':
      return rebuild(op)
    case 'slide':
      return upsert(deck, op.index, op.slide)
    case 'show': {
      const target = pageIndex(deck, op.index)
      return target === undefined ? deck : { ...deck, current: target }
    }
    case 'annotate': {
      const target = pageIndex(deck, op.slide)
      if (target === undefined) return deck
      const annotations = [...deck.annotations]
      annotations[target] = applyOps(deck.annotations[target] ?? createScene(), op.ops)
      return { ...deck, annotations }
    }
    case 'clear': {
      const target = pageIndex(deck, op.slide)
      if (target === undefined) return deck
      const annotations = [...deck.annotations]
      // 只清元素、保留 nextId：清空后新画的元素必须拿到比历史更大的 id，否则面板按 id
      // 挑"最后一个元素"撤销时会挑到旧 id，而新元素恰好复用了它。
      annotations[target] = { elements: [], nextId: deck.annotations[target]?.nextId ?? 0 }
      return { ...deck, annotations }
    }
    case 'exported':
      return { ...deck, lastExport: op.path }
    default:
      return assertNever(op)
  }
}

/**
 * 整份重建。
 *
 * `lastExport` 一起丢掉：它记的是旧 deck 的落点，页数都换过了再留着只会误导模型。
 * @param op - 重建 op。
 * @returns 全新的 deck，批注逐页清空。
 */
function rebuild(op: Extract<DeckOp, { op: 'deck' }>): Deck {
  return {
    css: op.css ?? '',
    slides: [...op.slides],
    current: 0,
    annotations: op.slides.map(() => createScene()),
  }
}

/**
 * 单页 upsert。
 *
 * 改已有的页时保留该页批注：页号没变，批注仍然"在这一页上"；要清就单独发 clear。
 * @param deck - 起始 deck。
 * @param index - 0-based；等于页数时追加。
 * @param slide - 新的页内容。
 * @returns 新 deck；索引非法时返回原对象。
 */
function upsert(deck: Deck, index: number, slide: Slide): Deck {
  if (!Number.isInteger(index) || index < 0 || index > deck.slides.length) return deck
  const slides = [...deck.slides]
  const annotations = [...deck.annotations]
  if (index === slides.length) {
    slides.push(slide)
    annotations.push(createScene())
  } else {
    slides[index] = slide
  }
  return { ...deck, slides, annotations }
}

/**
 * 0-based 页号收窄到现有页；越界返回 undefined。
 * @param deck - 当前 deck。
 * @param index - 待检查的 0-based 页号。
 * @returns 合法页号，或 undefined。
 */
function pageIndex(deck: Deck, index: number): number | undefined {
  return Number.isInteger(index) && index >= 0 && index < deck.slides.length ? index : undefined
}
