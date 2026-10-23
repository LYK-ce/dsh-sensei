/**
 * 面板侧的可观察 deck 源：按 `revision` 增量拉取，本地逐条折叠。
 *
 * 这里不做乐观更新：翻页的真相在 host，本地先翻再回滚只会引入第二条真相。
 * 本机回环的往返延迟远小于人的手感阈值。
 *
 * 轮询响应里还带着 host 的产出请求（出图、导出）。它们与 deck 走**同一次通知**：
 * 请求是针对某个 revision 的 deck 发的，分两次通知会让面板拿着新请求去栅格化旧 deck。
 */
import { emptyDeck, foldDeck } from '../core/deck.ts'
import type { Deck } from '../core/deck.ts'
import type { DeckDelta, ExportRequest, SnapshotRequest } from '../shared/protocol.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'

/** 一个可观察值；框架把它绑成 `use<Name>`。 */
export interface ObservableValue<T> {
  /**
   * 当前值。
   * @returns 值没变时返回同一个引用。
   */
  getSnapshot(): T
  /**
   * 订阅变化。
   * @param listener - 值变化时调用。
   * @returns 退订。
   */
  subscribe(listener: () => void): () => void
}

/** 面板一次轮询看到的东西。 */
export interface DeckView {
  /** 折叠后的 deck。 */
  readonly deck: Deck
  /** host 正在等的一张快照；没有就是 null。 */
  readonly snapshotRequest: SnapshotRequest | null
  /** host 正在等的一次导出；没有就是 null。 */
  readonly exportRequest: ExportRequest | null
}

/** 面板对当前页的溢出测量；每次轮询顺手带给 host。 */
export interface OverflowProbe {
  /** 被测量的页，0-based。 */
  readonly slide: number
  /** 内容是否超出 1280×720。 */
  readonly overflow: boolean
}

/** 面板用的可观察 deck 源。 */
export interface DeckSource extends ObservableValue<DeckView> {
  /**
   * 翻到某一页。
   * @param index - 0-based 页号，必须落在现有页内。
   * @returns 提交完成；失败只 reject 本次调用。
   */
  show(index: number): Promise<void>
  /**
   * 在面板当前显示的那一页画一批命令。
   * @param commands - 绘图命令；id 由 host 分配，本地不做乐观追加。
   * @param slide - 面板显示的那一页，0-based；host 用它定位，避免同一拍翻页把笔迹带到新页。
   * @returns 提交完成；失败只 reject 本次调用。
   */
  draw(commands: readonly DrawCommand[], slide: number): Promise<void>
  /**
   * 注册当前页溢出测量的取数函数，每次轮询前调用一次。
   *
   * 舞台由面板挂载，源本身量不到版面，所以只能反过来从面板取；不注册时轮询就不带测量。
   * @param probe - 返回测量结果；舞台没挂载或文档还没加载完时返回 undefined。
   * @returns 无。
   */
  setOverflowProbe(probe: (() => OverflowProbe | undefined) | undefined): void
}

/** {@link createDeckSource} 的入参。 */
export interface DeckSourceOptions {
  /**
   * 读 `since` 之后的 ops 与两条产出请求。
   * @param since - 本地已有的 op 数。
   * @param measurement - 这一拍顺手要报给 host 的溢出测量，没有就是 undefined。
   */
  readonly load: (since: number, measurement: OverflowProbe | undefined) => Promise<DeckDelta>
  /** 提交翻页，返回 host 折好的 delta。 */
  readonly show: (index: number) => Promise<DeckDelta>
  /** 提交批注命令到指定页，返回 host 分配好 id 的 delta。 */
  readonly draw: (commands: readonly DrawCommand[], slide: number) => Promise<DeckDelta>
  /** 轮询间隔，毫秒。 */
  readonly pollMs: number
}

/**
 * 建一个按 revision 增量拉取的 deck 源。
 *
 * 首订阅立刻拉一次（同时充当面板心跳），此后每 `pollMs` 一次；最后一个监听退订即停表。
 * @param options - 读写实现与轮询间隔。
 * @returns 可观察源。
 */
export function createDeckSource(options: DeckSourceOptions): DeckSource {
  let deck = emptyDeck()
  let revision = 0
  let snapshotRequest: SnapshotRequest | null = null
  let exportRequest: ExportRequest | null = null
  let view: DeckView = { deck, snapshotRequest, exportRequest }
  let timer: ReturnType<typeof setInterval> | undefined
  /** 面板注册的溢出测量取数函数；每次轮询现取一次。 */
  let probe: (() => OverflowProbe | undefined) | undefined
  /** 串行化提交：翻页与批注共用一条队列，两份响应乱序到达时 revision 才不会倒退。 */
  let sending: Promise<unknown> = Promise.resolve()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  /**
   * 把当前状态发布成新视图。
   *
   * 三个字段都没换就沿用旧对象：面板的订阅把它当"没变"判据，换引用会让每次轮询都重渲染。
   * @returns 无。
   */
  const publish = (): void => {
    if (view.deck === deck && view.snapshotRequest === snapshotRequest && view.exportRequest === exportRequest) return
    view = { deck, snapshotRequest, exportRequest }
    notify()
  }

  /**
   * 折入一份 delta。轮询与翻页的响应可能同时到，所以要分清三种情形：落后的丢掉、
   * 有重叠的只折没见过的部分、**有缺口的整份重来**。
   * @param delta - host 折好的一段 op 流。
   * @param from - 'poll' 时连带更新两条产出请求；'submit' 的响应里没有它们，不能拿来清空。
   * @returns 无。
   */
  const applyDelta = (delta: DeckDelta, from: 'poll' | 'submit'): void => {
    if (delta.revision < revision) return
    if (delta.revision === revision) {
      // 没有新 op 也可能有新请求：request 本身不推进 revision。
      if (from === 'poll') {
        snapshotRequest = delta.snapshotRequest ?? null
        exportRequest = delta.exportRequest ?? null
        publish()
      }
      return
    }
    const start = delta.revision - delta.ops.length
    if (start > revision) {
      // 缺口一旦出现，本地就没有增量拼接的前提了；直接跳到 delta.revision 会把缺口永久留在身后。
      revision = 0
      deck = emptyDeck()
      // 这一拍不发布 delta 里的请求：deck 还没对上，面板拿它栅格化只会产出错位的图。
      // 清空后的 deck 必须照常发布，否则订阅者会被通知去看一份已经不成立的旧引用。
      publish()
      void poll()
      return
    }
    let next = deck
    for (const op of delta.ops.slice(revision - start)) next = foldDeck(next, op)
    deck = next
    revision = delta.revision
    if (from === 'poll') {
      snapshotRequest = delta.snapshotRequest ?? null
      exportRequest = delta.exportRequest ?? null
    }
    publish()
  }

  const poll = async (): Promise<void> => {
    // 每次轮询现取一次测量：刚翻页时这里拿到的必须是对新页量的结果。
    const measurement = probe?.()
    // host 重启或会话消失都只该让这一拍失败：下一拍会重试，面板不该炸。
    await options.load(revision, measurement).then((delta) => applyDelta(delta, 'poll'), () => undefined)
  }

  /**
   * 串行提交一次会推进 revision 的请求（翻页或批注）。
   *
   * 两份响应乱序到达时后到的那份会让 revision 倒退，所以第一次没回来之前不发第二次。
   * @param request - 真正提交的那一步。
   * @returns 提交完成；失败只 reject 本次调用。
   */
  const send = (request: () => Promise<DeckDelta>): Promise<void> => {
    const run = sending.then(async (): Promise<void> => {
      applyDelta(await request(), 'submit')
    })
    // 队列本身不携带失败（否则一次失败会让后续提交一起 reject），当前调用方仍然拿到它。
    sending = run.then(() => undefined, () => undefined)
    return run
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    if (timer === undefined) {
      void poll()
      timer = setInterval(() => { void poll() }, options.pollMs)
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
  }

  return {
    getSnapshot: () => view,
    subscribe,
    show: (index) => send(() => options.show(index)),
    draw: (commands, slide) => send(() => options.draw(commands, slide)),
    setOverflowProbe: (next) => { probe = next },
  }
}
