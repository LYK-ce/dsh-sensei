/**
 * 面板产出请求的账本：host 没有 canvas，PNG 只能由浏览器里的面板产出。
 *
 * 模板是"拉"而不是"推"：工具发起请求 → 面板下一次轮询从 state 响应里看到它 → POST 回来。
 * 这里只管记账、超时与作废，不认识 deck 本身。
 *
 * 每个会话同时只保留一次等待中的请求：新的把旧的挤掉。两次请求叠在一起时面板会先做哪一个
 * 都说不准，而工具等的是"我这一次"的结果，不是任意一张图。
 */
import type { ExportPage } from '../shared/protocol.ts'

/** 一次等待中的请求：payload 是面板要读的参数，结果由面板回传。 */
interface Pending<Payload, Value> {
  readonly id: string
  readonly payload: Payload
  readonly resolve: (value: Value) => void
  readonly reject: (error: Error) => void
}

/** 面板对一次导出报来的进度；只服务超时文案。 */
interface Progress {
  /** 它属于哪一次请求；新请求开始后旧进度就作废。 */
  readonly id: string
  /** 已经处理完的页数。 */
  readonly rendered: number
  /** 本次导出的总页数。 */
  readonly total: number
}

/**
 * 按会话记账的通用请求账本。
 *
 * 超时、被替换、被取消、插件卸载都会 reject；只有 id 对得上的回传才会 resolve。
 */
class PanelLedger<Payload, Value> {
  private readonly pending = new Map<string, Pending<Payload, Value>>()
  /** 每会话最新的导出进度；快照请求没有页的概念，不会写它。 */
  private readonly progress = new Map<string, Progress>()
  /** 请求种类，只用于错误文案（面板看得到这句，得知道是谁在等）。 */
  private readonly what: string

  /**
   * @param what - 请求种类，写进超时/取消的报错里。
   */
  constructor(what: string) {
    this.what = what
  }

  /**
   * 发起一次请求并等待面板交回结果。
   * @param sessionId - 目标会话。
   * @param payload - 面板要读的参数（目标页、页数、倍率）。
   * @param timeoutMs - 等待上限，毫秒（面板没开或没响应时走这条）。
   * @param signal - 调用方的取消信号。
   * @returns 面板交回的结果。
   * @throws 超时、被取消，或被同一会话的后一次请求挤掉时抛错。
   */
  request(sessionId: string, payload: Payload, timeoutMs: number, signal?: AbortSignal): Promise<Value> {
    // 同一会话只保留最新一次：旧的立刻失败，免得它一直占着面板的注意力。
    this.pending.get(sessionId)?.reject(new Error(`sensei: a newer ${this.what} request replaced this one`))
    // 上一轮导出的进度不能算到这一轮头上。
    this.progress.delete(sessionId)

    return new Promise<Value>((resolve, reject) => {
      const id = crypto.randomUUID()
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (value: Value | undefined, error?: Error): void => {
        if (done) return
        done = true
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (this.pending.get(sessionId)?.id === id) this.pending.delete(sessionId)
        if (this.progress.get(sessionId)?.id === id) this.progress.delete(sessionId)
        if (value !== undefined) resolve(value)
        else reject(error ?? new Error(`sensei: the ${this.what} request was dropped`))
      }

      const onAbort = (): void => { finish(undefined, new Error(`sensei: the ${this.what} request was cancelled`)) }

      timer = setTimeout(() => {
        // 超时时把面板已经处理到第几页说出来：60 页 scale 2 没等到结果时，"一页都没画"和
        // "画到第 59 页"对下一步的判断完全不同。
        const progress = this.progress.get(sessionId)
        const detail = progress !== undefined && progress.id === id
          ? ` (the panel had rendered ${progress.rendered} of ${progress.total} slide(s))`
          : ''
        finish(undefined, new Error(
          `sensei: no panel answered the ${this.what} request within ${timeoutMs}ms${detail}; `
          + 'open the Sensei tab in the right sidebar and retry',
        ))
      }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(sessionId, {
        id,
        payload,
        resolve: (value) => { finish(value) },
        reject: (error) => { finish(undefined, error) },
      })
      if (signal?.aborted === true) onAbort()
    })
  }

  /**
   * 面板交回一次结果。
   * @param sessionId - 会话。
   * @param requestId - 面板在 state 响应里看到的请求 id。
   * @param value - 面板产出的东西。
   * @returns 是否被这次请求收下；id 对不上（过期或伪造）时为 false。
   */
  deliver(sessionId: string, requestId: string, value: Value): boolean {
    const pending = this.pending.get(sessionId)
    if (pending === undefined || pending.id !== requestId) return false
    pending.resolve(value)
    return true
  }

  /**
   * 记一次面板报来的导出进度。
   * @param sessionId - 会话。
   * @param requestId - 面板在 state 响应里看到的请求 id。
   * @param rendered - 已经处理完的页数，从 1 开始。
   * @param total - 本次导出的总页数。
   * @returns 是否记在这次等待中的请求上；id 对不上（过期或伪造）时为 false。
   */
  noteProgress(sessionId: string, requestId: string, rendered: number, total: number): boolean {
    const pending = this.pending.get(sessionId)
    if (pending === undefined || pending.id !== requestId) return false
    this.progress.set(sessionId, { id: requestId, rendered, total })
    return true
  }

  /**
   * 该会话当前在等哪一次请求；state 响应把它带给轮询的面板。
   * @param sessionId - 会话。
   * @returns 请求 id 与面板要读的参数，没有等待中的请求时 null。
   */
  outstanding(sessionId: string): (Payload & { readonly id: string }) | null {
    const pending = this.pending.get(sessionId)
    return pending === undefined ? null : Object.assign({ id: pending.id }, pending.payload)
  }

  /**
   * 结束所有等待中的请求（插件卸载时）。
   *
   * 不结束的话，工具会一直等到自己的超时，而那期间用户已经看不到面板了。
   * @returns 无。
   */
  dispose(): void {
    for (const pending of [...this.pending.values()]) {
      pending.reject(new Error('sensei: the sensei plugin is unloading'))
    }
    this.pending.clear()
    this.progress.clear()
  }
}

/** 出图请求账本；结果是内容层 + 批注层的 PNG 原始字节。 */
export class SnapshotLedger extends PanelLedger<{ readonly slide: number }, Uint8Array> {
  constructor() {
    super('snapshot')
  }
}

/** 导出请求账本；结果是一批带页号的 PNG。 */
export class ExportLedger extends PanelLedger<{ readonly pages: number; readonly scale: number }, readonly ExportPage[]> {
  constructor() {
    super('export')
  }
}
