/**
 * 每会话的 deck op 流与折叠后的 deck。
 *
 * 进程内缓存，磁盘 append-only JSONL 持久化：deck 数据不进 session log（事件类型不在
 * dsh 的已知事件表里），所以这份 JSONL 就是唯一真相。
 */
import { readFileSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describePages, emptyDeck, foldDeck } from '../core/deck.ts'
import type { Deck, DeckOp } from '../core/deck.ts'
import { parseDeckOp } from '../shared/protocol.ts'
import type { DeckDelta } from '../shared/protocol.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import { createScene } from '../vendor/dsh-blackboard/core/scene.ts'
import { opsFromCommands } from '../vendor/dsh-blackboard/shared/ops.ts'

/** 一个会话的 op 流与折叠结果。 */
interface DeckStream {
  readonly ops: DeckOp[]
  /** 每次 append 之后原地折叠；工具结果要用页数。 */
  deck: Deck
}

/** 批注写入的结果：成功给出本次 delta，失败给出人看得懂的原因（页号越界）。 */
export type AnnotateOutcome =
  | { readonly ok: true; readonly delta: DeckDelta }
  | { readonly ok: false; readonly reason: string }

/** 队列里的一步：给定当前流，产出要落盘的 op 与调用方要的返回值。 */
type Step<T> = (stream: DeckStream) => { readonly ops: readonly DeckOp[]; readonly value: T }

/**
 * 每会话的 deck 存储：`<dataDir>/<sessionId>.jsonl`，一行一个 op。
 *
 * 暂不做压缩或截断：面板的缺口检测依赖 `revision === 流长度`，一旦压缩历史，
 * 老面板的 `since` 会把"被压掉的 op"误判成缺口并整份重拉（能自愈，但会多一次全量）。
 * 真要做压缩时这里必须同时改缺口协议。
 */
export class DeckStore {
  private readonly dataDir: string
  private readonly streams = new Map<string, DeckStream>()
  /**
   * 串行队列：整条"落盘 → 改内存"在里面，人和 agent 同时翻页时 revision 才不会互相覆盖。
   */
  private queue: Promise<void> = Promise.resolve()

  /**
   * @param dataDir - ops 文件目录，不存在时在第一次写入前创建。
   */
  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  /**
   * 读 `since`（含）之后的 ops 与当前 revision；冷会话在这里从磁盘重放一次。
   * @param sessionId - 目标会话。
   * @param since - 已经拿到的 op 数，作为增量游标。
   * @returns 本次要补的 ops 与流的总长。
   */
  async read(sessionId: SessionId, since: number): Promise<DeckDelta> {
    return deltaOf(this.stream(sessionId), since)
  }

  /**
   * 追加一个 op 并折进内存态。
   * @param sessionId - 目标会话。
   * @param op - 已由调用方校验过的变更。
   * @returns 本次追加的 ops（恒为一条）与追加后的流长。
   */
  async append(sessionId: SessionId, op: DeckOp): Promise<DeckDelta> {
    return await this.enqueue(sessionId, (stream) => ({ ops: [op], value: deltaAfter(stream, [op]) }))
  }

  /**
   * 折入一批批注命令，id 由这里唯一分配。
   *
   * 整个"读场景 → 分配 id → 落盘 → 折叠"都在队列内完成：人和 agent 会同时画同一页，
   * 只在落盘处排队的话两次 append 会从同一个 `nextId` 分出同一个 id。
   * @param sessionId - 目标会话。
   * @param slide - 目标页，0-based。
   * @param commands - 面板或工具提交的绘图命令。
   * @returns 本次追加的 delta；页号越界时给出原因。
   */
  async annotate(sessionId: SessionId, slide: number, commands: readonly DrawCommand[]): Promise<AnnotateOutcome> {
    return await this.enqueue(sessionId, (stream): { readonly ops: readonly DeckOp[]; readonly value: AnnotateOutcome } => {
      const deck = stream.deck
      if (!Number.isInteger(slide) || slide < 0 || slide >= deck.slides.length) {
        return { ops: [], value: { ok: false, reason: `slide ${slide + 1} is out of range (${describePages(deck)})` } }
      }
      // 没有命令就不写 op：空批注只该让 revision 原地不动。
      if (commands.length === 0) {
        return { ops: [], value: { ok: true, delta: { revision: stream.ops.length, ops: [] } } }
      }
      const { ops } = opsFromCommands(deck.annotations[slide] ?? createScene(), commands)
      if (ops.length === 0) {
        return { ops: [], value: { ok: true, delta: { revision: stream.ops.length, ops: [] } } }
      }
      const op: DeckOp = { op: 'annotate', slide, ops }
      return { ops: [op], value: { ok: true, delta: deltaAfter(stream, [op]) } }
    })
  }

  /**
   * 取折叠后的 deck。
   * @param sessionId - 目标会话。
   * @returns 该会话当前的 deck。
   */
  async deck(sessionId: SessionId): Promise<Deck> {
    return this.stream(sessionId).deck
  }

  /**
   * 等在途的写入结束。
   * @returns 队列排空后 resolve。
   */
  async dispose(): Promise<void> {
    await this.queue
  }

  /**
   * 在串行队列里跑一步：先落盘，再改内存。
   *
   * 队列本身不携带失败（否则一次写失败会让后续写入一起 reject），当前调用方仍然拿到它。
   * @param sessionId - 目标会话。
   * @param step - 在队列内执行的一步；只能在里面读 `stream`。
   * @returns 这一步的返回值。
   */
  private async enqueue<T>(sessionId: SessionId, step: Step<T>): Promise<T> {
    const stream = this.stream(sessionId)
    const run = this.queue.then(async (): Promise<T> => {
      const { ops, value } = step(stream)
      // 只在真有 op 时碰磁盘：空批注不该在日志里留下空行，也不该让 mkdir 白跑。
      if (ops.length > 0) {
        await mkdir(this.dataDir, { recursive: true })
        await appendFile(this.file(sessionId), ops.map((op) => `${JSON.stringify(op)}\n`).join(''), 'utf8')
        for (const op of ops) {
          stream.deck = foldDeck(stream.deck, op)
          stream.ops.push(op)
        }
      }
      return value
    })
    this.queue = run.then(() => undefined, () => undefined)
    return await run
  }

  /**
   * 取会话的 op 流，第一次访问时同步读一遍磁盘。
   * @param sessionId - 目标会话。
   * @returns 该会话的流，之后一直复用同一个对象。
   */
  private stream(sessionId: SessionId): DeckStream {
    const cached = this.streams.get(sessionId)
    if (cached !== undefined) return cached
    const ops = readOps(this.file(sessionId))
    const created: DeckStream = { ops, deck: ops.reduce(foldDeck, emptyDeck()) }
    this.streams.set(sessionId, created)
    return created
  }

  /**
   * ops 文件名；sessionId 只可能来自会话 id，但仍然只保留文件名字符。
   * @param sessionId - 目标会话。
   * @returns 该会话的 JSONL 绝对路径。
   */
  private file(sessionId: SessionId): string {
    return join(this.dataDir, `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`)
  }
}

/**
 * 切出 `since` 之后的 ops。
 * @param stream - 目标流。
 * @param since - 已经拿到的 op 数；超出流长时按流长处理。
 * @returns 本次要补的 ops 与流的总长。
 */
function deltaOf(stream: DeckStream, since: number): DeckDelta {
  const start = Math.max(0, Math.min(since, stream.ops.length))
  return { revision: stream.ops.length, ops: stream.ops.slice(start) }
}

/**
 * 追加这批 op 之后调用方会拿到的 delta。
 *
 * 在队列内、落盘前算：此时 `stream.ops` 一定还是这次写入之前的状态。
 * @param stream - 追加前的流。
 * @param ops - 即将追加的 op。
 * @returns revision 与本次 op。
 */
function deltaAfter(stream: DeckStream, ops: readonly DeckOp[]): DeckDelta {
  return { revision: stream.ops.length + ops.length, ops: [...ops] }
}

/**
 * 读一个会话的 JSONL。
 *
 * 逐行过 `parseDeckOp`：磁盘是进程边界，坏行不能被当成类型正确的 op 折进 deck。
 * @param file - ops 文件路径。
 * @returns 按写入顺序的 ops；文件还不存在时是空流。
 */
function readOps(file: string): DeckOp[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    // 只有"这个会话还没有 deck"是可以接受的读失败，其余（权限、损坏的目录项）必须冒出来。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const lines = text.split('\n')
  // 最后一个换行会在末尾留一个空串。
  if (lines[lines.length - 1] === '') lines.pop()

  const ops: DeckOp[] = []
  for (const [index, line] of lines.entries()) {
    if (line === '') continue
    try {
      ops.push(parseDeckOp(JSON.parse(line)))
    } catch (error) {
      // append-only 只可能被"写到一半就死了"弄坏最后一行。丢掉它，前面的照常读；
      // 中间的行坏了说明文件不是我们写的，必须冒出来。
      if (index === lines.length - 1) break
      throw error
    }
  }
  return ops
}
