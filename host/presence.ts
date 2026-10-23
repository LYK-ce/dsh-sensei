/**
 * 面板是否开着：靠面板每秒轮询 state 本身当心跳。
 *
 * 没有独立的心跳路由——每次成功的 `GET /api/sensei.state` 就是一次心跳。
 * 超过 {@link PANEL_TIMEOUT_MS} 没见到心跳即为关闭：面板被后台节流或标签页被冻结时，
 * 工具回报的 `panelOpen: false` 是准确描述，不是误报。
 *
 * 同一个窗口里还存着面板顺手报来的溢出测量：测量只对"它量的那一页"有效，翻页即作废。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** 心跳有效期，毫秒：面板每 1000ms 轮询一次，留三拍余量。 */
export const PANEL_TIMEOUT_MS = 3_000

/** 面板报来的一次溢出测量。 */
interface OverflowSample {
  /** 被测量的页，0-based。 */
  readonly slide: number
  readonly overflow: boolean
  /** 测得时刻。 */
  readonly at: number
}

/** 每会话最后一次看到面板心跳的时刻。 */
export class PanelPresence {
  private readonly seen = new Map<string, number>()
  private readonly overflows = new Map<string, OverflowSample>()
  private readonly now: () => number

  /**
   * @param now - 取当前时刻，测试用它注入假时钟。
   */
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /**
   * 记一次心跳。
   * @param sessionId - 面板所属会话。
   * @returns 无。
   */
  touch(sessionId: SessionId): void {
    this.seen.set(sessionId, this.now())
  }

  /**
   * 该会话的面板现在算不算开着。
   * @param sessionId - 面板所属会话。
   * @returns 最近 {@link PANEL_TIMEOUT_MS} 内有过心跳即 true。
   */
  isOpen(sessionId: SessionId): boolean {
    const at = this.seen.get(sessionId)
    return at !== undefined && this.now() - at < PANEL_TIMEOUT_MS
  }

  /**
   * 记一次溢出测量。面板每次轮询都带当前页的结果，所以这里只留最新一条。
   * @param sessionId - 面板所属会话。
   * @param slide - 被测量的页，0-based。
   * @param overflow - 内容是否超出 1280×720。
   * @returns 无。
   */
  noteOverflow(sessionId: SessionId, slide: number, overflow: boolean): void {
    this.overflows.set(sessionId, { slide, overflow, at: this.now() })
  }

  /**
   * 取该会话某一页的溢出测量。
   * @param sessionId - 面板所属会话。
   * @param slide - 要问的页，0-based。
   * @returns 测量仍然新鲜且页号对得上时是布尔值，否则 undefined（面板没测过、已过期，或量的是别的页）。
   */
  overflowOf(sessionId: SessionId, slide: number): boolean | undefined {
    const sample = this.overflows.get(sessionId)
    if (sample === undefined || sample.slide !== slide) return undefined
    // 与心跳同一个窗口：更老的样本描述的已经是过去那一页的版面。
    return this.now() - sample.at < PANEL_TIMEOUT_MS ? sample.overflow : undefined
  }
}
