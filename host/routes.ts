/**
 * 四条 exact Fetch route：读状态（也就是面板心跳）、人翻页 / 画批注、交回快照、交回导出页面。
 *
 * 这里的校验是 wire 边界唯一的 400 机会：工具跑的模型参数由 schema 把关，面板发来的请求没有。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describePages } from '../core/deck.ts'
import { parseExportBody, parseOpsBody } from '../shared/protocol.ts'
import type { ExportPage, OpsRequest } from '../shared/protocol.ts'
import { assertNever } from '../vendor/dsh-blackboard/core/assert.ts'
import type { PanelPresence } from './presence.ts'
import type { DeckStore } from './store.ts'
import type { ExportLedger, SnapshotLedger } from './snapshots.ts'

/**
 * 所有导出/出图请求账本的读取面；routes 只要这么多。
 */
interface Ledgers {
  readonly snapshots: SnapshotLedger
  readonly exports: ExportLedger
}

/**
 * `GET /api/sensei.state?sessionId=<id>&since=<rev>[&slide=<i>&overflow=<0|1>]`。
 *
 * 成功即一次心跳：面板每秒调一次，所以 `presence.touch` 放在这里而不是另开路由。
 * `slide`/`overflow` 是面板顺手带上的当前页测量：同一个窗口内有效，翻页即作废。
 * @param store - deck 存储。
 * @param presence - 面板心跳表。
 * @param ledgers - 两条产出请求账本，把等待中的请求 id 与参数带给面板。
 * @param request - 已通过 Connection 信任检查的请求。
 * @returns `{ revision, ops, snapshotRequest, exportRequest }`；查询参数不合法时 400。
 */
export async function handleState(
  store: DeckStore,
  presence: PanelPresence,
  ledgers: Ledgers,
  request: Request,
): Promise<Response> {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const since = Number(query.get('since') ?? '0')
  if (sessionId === null || sessionId === '' || !Number.isSafeInteger(since) || since < 0) {
    return new Response('Invalid sensei state query.', { status: 400 })
  }
  const measurement = overflowQuery(query)
  if (measurement === null) return new Response('Invalid sensei overflow query.', { status: 400 })

  const delta = await store.read(sessionId as SessionId, since)
  // 只有成功的一拍才算心跳；被拒的请求描述不了"面板还开着"。
  presence.touch(sessionId as SessionId)
  if (measurement !== undefined) presence.noteOverflow(sessionId as SessionId, measurement.slide, measurement.overflow)
  return Response.json({
    ...delta,
    snapshotRequest: ledgers.snapshots.outstanding(sessionId),
    exportRequest: ledgers.exports.outstanding(sessionId),
  })
}

/** 面板顺手报来的一次溢出测量。 */
interface OverflowQuery {
  /** 被测量的页，0-based。 */
  readonly slide: number
  /** 内容是否超出 1280×720。 */
  readonly overflow: boolean
}

/**
 * 读可选的 `slide`/`overflow` 查询参数。
 *
 * 两个必须一起出现：单独一个 `overflow` 没有页号，落到哪一页都是猜的；单独一个 `slide`
 * 没有测量值，写进去只会把上一次的结果当成这一页的。
 * @param query - 请求的查询串。
 * @returns undefined（两个都没给）、null（不合法），或这次测量。
 */
function overflowQuery(query: URLSearchParams): OverflowQuery | null | undefined {
  const slide = query.get('slide')
  const overflow = query.get('overflow')
  if (slide === null && overflow === null) return undefined
  if (slide === null || overflow === null) return null
  const index = Number(slide)
  if (!Number.isSafeInteger(index) || index < 0) return null
  if (overflow !== '0' && overflow !== '1') return null
  return { slide: index, overflow: overflow === '1' }
}

/**
 * `POST /api/sensei.ops?sessionId=<id>`，body 是 `{ show }`（0-based）或 `{ commands, slide? }`。
 *
 * 越界不夹取：报错并带页数与当前页，人才知道该按哪边。
 * @param store - deck 存储。
 * @param request - 已通过 Connection 信任检查的请求。
 * @returns 本次追加的 op 与追加后的 revision；sessionId、body 或页号不合法时 400。
 */
export async function handleOps(store: DeckStore, request: Request): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') return new Response('Invalid sensei session id.', { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    // 只有"请求体不是 JSON"能走到这里；request.json() 不读磁盘也不碰外部状态。
    return new Response('Invalid sensei request body.', { status: 400 })
  }

  let parsed: OpsRequest
  try {
    parsed = parseOpsBody(body)
  } catch (error) {
    // 只有请求体的字段位置信息能走到这里；parseOpsBody 不读磁盘也不碰外部状态。
    return new Response(`Invalid sensei request body: ${messageOf(error)}.`, { status: 400 })
  }

  const key = sessionId as SessionId
  switch (parsed.kind) {
    case 'show': {
      const deck = await store.deck(key)
      if (parsed.index >= deck.slides.length) {
        return new Response(
          `Invalid sensei show: slide index ${parsed.index} is out of range (${describePages(deck)}).`,
          { status: 400 },
        )
      }
      return Response.json(await store.append(key, { op: 'show', index: parsed.index }))
    }
    case 'commands': {
      // 面板报的页号优先：agent 同一拍翻页时，用 host 的 current 会把这一笔画到新页上。
      // 旧面板不带 `slide` 时退回 current，行为与修复前一致。
      const deck = await store.deck(key)
      const slide = parsed.slide ?? deck.current
      const outcome = await store.annotate(key, slide, parsed.commands)
      if (!outcome.ok) return new Response(`Invalid sensei annotation: ${outcome.reason}.`, { status: 400 })
      return Response.json(outcome.delta)
    }
    default:
      return assertNever(parsed)
  }
}

/**
 * `POST /api/sensei.snapshot?sessionId=<id>&requestId=<id>`，body 是 PNG 原始字节。
 * @param snapshots - 出图请求账本。
 * @param request - 已通过 Connection 信任检查的请求。
 * @returns `{ delivered: true }`；参数不合法或 body 为空时 400，没有对应等待请求时 409（多半是超时后的迟到交付）。
 */
export async function handleSnapshot(snapshots: SnapshotLedger, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const requestId = query.get('requestId')
  if (sessionId === null || sessionId === '' || requestId === null || requestId === '') {
    return new Response('Invalid sensei snapshot query.', { status: 400 })
  }
  const png = new Uint8Array(await request.arrayBuffer())
  if (png.byteLength === 0) return new Response('Empty sensei snapshot body.', { status: 400 })
  if (!snapshots.deliver(sessionId, requestId, png)) {
    return new Response('No matching sensei snapshot request.', { status: 409 })
  }
  return Response.json({ delivered: true })
}

/**
 * `POST /api/sensei.export?sessionId=<id>&requestId=<id>`，body 是 `{ pages: [{ index, png }] }`。
 *
 * 页号相对这次请求的页数校验：面板折的是另一份 deck 时页数对不上，收下只会产出错位的 pptx。
 * @param exports - 导出请求账本。
 * @param request - 已通过 Connection 信任检查的请求。
 * @returns `{ delivered: true }`；参数/body 不合法时 400，迟到交付时 409。
 */
export async function handleExport(exports: ExportLedger, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const requestId = query.get('requestId')
  if (sessionId === null || sessionId === '' || requestId === null || requestId === '') {
    return new Response('Invalid sensei export query.', { status: 400 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    // 只有"请求体不是 JSON"能走到这里；request.json() 不读磁盘也不碰外部状态。
    return new Response('Invalid sensei export body.', { status: 400 })
  }

  // 先对 id 再解析：页数的合法范围来自这次请求，id 对不上就没有范围可校验。
  const pending = exports.outstanding(sessionId)
  if (pending === null || pending.id !== requestId) {
    return new Response('No matching sensei export request.', { status: 409 })
  }

  let pages: readonly ExportPage[]
  try {
    pages = parseExportBody(body, pending.pages)
  } catch (error) {
    // 只有请求体的字段位置信息能走到这里；parseExportBody 不读磁盘也不碰外部状态。
    return new Response(`Invalid sensei export body: ${messageOf(error)}.`, { status: 400 })
  }

  if (!exports.deliver(sessionId, requestId, pages)) {
    return new Response('No matching sensei export request.', { status: 409 })
  }
  return Response.json({ delivered: true })
}

/**
 * `POST /api/sensei.progress?sessionId=<id>&requestId=<id>&rendered=<n>&total=<n>`：面板每处理完一页报一次。
 *
 * 只用于导出超时的错误文案；不是一次产出，迟到的进度直接拒掉即可。
 * @param exports - 导出请求账本。
 * @param request - 已通过 Connection 信任检查的请求。
 * @returns `{ recorded: true }`；参数不合法 400，没有对应等待请求 409。
 */
export async function handleProgress(exports: ExportLedger, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const requestId = query.get('requestId')
  const rendered = Number(query.get('rendered'))
  const total = Number(query.get('total'))
  if (sessionId === null || sessionId === '' || requestId === null || requestId === '') {
    return new Response('Invalid sensei progress query.', { status: 400 })
  }
  // 已处理的页数只能落在 1..total：0 表示还没开始，大于总数说明面板折的是另一份 deck。
  if (!Number.isSafeInteger(total) || total < 1) {
    return new Response('Invalid sensei progress total.', { status: 400 })
  }
  if (!Number.isSafeInteger(rendered) || rendered < 1 || rendered > total) {
    return new Response('Invalid sensei progress rendered count.', { status: 400 })
  }
  if (!exports.noteProgress(sessionId, requestId, rendered, total)) {
    return new Response('No matching sensei export request.', { status: 409 })
  }
  return Response.json({ recorded: true })
}

/**
 * 把任意抛出物折成一行文字。
 * @param error - 捕获到的值，可能是任何东西。
 * @returns `Error` 取它的 message，其余走 `String()`。
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
