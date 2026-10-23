/**
 * host 与面板之间的 wire 类型，以及响应校验。
 *
 * 面板拿到的每一份 `DeckDelta` 都来自网络，所以 `parseDeckDelta` 是这份数据唯一的把关点：
 * 结构不对就抛错（面板显示、下一拍重试），绝不折叠进本地 deck。
 */
import type { DeckOp, Slide } from '../core/deck.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import type { Element } from '../vendor/dsh-blackboard/core/elements.ts'
import type { Point } from '../vendor/dsh-blackboard/core/types.ts'
import type { SceneOp } from '../vendor/dsh-blackboard/shared/ops.ts'

/**
 * 读状态的 exact Fetch route。
 *
 * 查询参数：`sessionId`、`since`，以及可选的 `slide`（0-based）与 `overflow`（`0`/`1`）。
 * 后两个是面板顺手带上的溢出测量：为它另开一条路由不值当，而挂在心跳上恰好和心率同周期。
 */
export const STATE_PATH = '/api/sensei.state'

/** 提交人工操作的 exact Fetch route；查询参数 `sessionId`。 */
export const OPS_PATH = '/api/sensei.ops'

/** 交回一张内容层 + 批注层 PNG 的 exact Fetch route；查询参数 `sessionId` 与 `requestId`。 */
export const SNAPSHOT_PATH = '/api/sensei.snapshot'

/** 交回整份导出页面 PNG 的 exact Fetch route；查询参数 `sessionId` 与 `requestId`。 */
export const EXPORT_PATH = '/api/sensei.export'

/**
 * 面板上报导出进度的 exact Fetch route；查询参数 `sessionId`、`requestId`、`rendered`、`total`。
 *
 * 进度只有一个消费方：导出超时的那条错误。没有它，60 页 scale 2 的超时只能报一句"没等到"，
 * 人和模型都不知道面板已经走到哪一页。
 */
export const PROGRESS_PATH = '/api/sensei.progress'

/** host 侧等待中的一次出图请求；面板拿它去栅格化指定页。 */
export interface SnapshotRequest {
  /** 本次请求的 id，回传时原样带回。 */
  readonly id: string
  /** 目标页，0-based。 */
  readonly slide: number
}

/** host 侧等待中的一次导出请求。 */
export interface ExportRequest {
  /** 本次请求的 id，回传时原样带回。 */
  readonly id: string
  /** 导出时 deck 的页数；面板与本地折叠结果不一致就立刻报错，不白栅格化。 */
  readonly pages: number
  /** 栅格化倍率，只接受 1 / 1.5 / 2。 */
  readonly scale: number
}

/** 一次读取或写入的结果；`ops[i]` 的逻辑序号是 `revision - ops.length + i`。 */
export interface DeckDelta {
  /** 这条 ops 流当前的 op 总数，等于下一批 op 的起始序号。 */
  readonly revision: number
  readonly ops: readonly DeckOp[]
  /** host 侧有没有工具在等一张面板快照；没有等待中的请求时是 null。 */
  readonly snapshotRequest?: SnapshotRequest | null
  /** host 侧有没有工具在等一次导出；没有等待中的请求时是 null。 */
  readonly exportRequest?: ExportRequest | null
}

/** `/api/sensei.ops` 的翻页请求体；批注请求体见 {@link CommandsBody}。 */
export interface ShowBody {
  /** 目标页，0-based；越界不夹取。 */
  readonly show: number
}

/** `/api/sensei.ops` 的批注请求体。 */
export interface CommandsBody {
  readonly commands: readonly DrawCommand[]
  /**
   * 面板自己显示的那一页，0-based。
   *
   * 面板总是带上它：agent 在人和面板同一拍翻页时，靠 host 的 `current` 定位会把这一笔
   * 画到刚翻走的新页上。旧面板不带时 host 仍退回 `current`，所以这个字段是可选的新增。
   */
  readonly slide?: number
}

/** `/api/sensei.ops` 能接受的两件事：翻页，或一批批注命令。 */
export type OpsRequest =
  | { readonly kind: 'show'; readonly index: number }
  | { readonly kind: 'commands'; readonly commands: readonly DrawCommand[]; readonly slide?: number }

/**
 * 校验 `/api/sensei.ops` 的请求体。
 *
 * 两个字段同时出现一律拒绝：那不是一个原子操作，"先翻页再画"与"用哪一页的 nextId"
 * 会各自成立、合起来不成立。
 * @param value - `request.json()` 解出的值，可能是任何东西。
 * @returns 翻页目标或批注命令。
 * @throws Error 消息里指出第一处不合法的字段位置。
 */
export function parseOpsBody(value: unknown): OpsRequest {
  const body = wire.record(value, 'body')
  const show = body['show']
  const commands = body['commands']
  const slide = body['slide']
  // `slide` 只修饰命令，和 `show` 同时出现就没有唯一解释："先翻页再画"与"画在指定页"不能一起成立。
  if (show !== undefined && (commands !== undefined || slide !== undefined)) return wire.fail('body')
  if (show !== undefined) {
    const index = wire.integer(show, 'show')
    // 负数页号会被折叠静默忽略：请求看起来成功了，画面却停在原页。
    if (index < 0) return wire.fail('show')
    return { kind: 'show', index }
  }
  if (commands !== undefined) {
    if (slide === undefined) {
      return { kind: 'commands', commands: wire.list(commands, 'commands').map((entry) => parseDrawCommand(entry)) }
    }
    const target = wire.integer(slide, 'slide')
    // 与 `show` 同理：负页号在折叠里会被静默忽略，面板会以为这一笔画上了。
    if (target < 0) return wire.fail('slide')
    return { kind: 'commands', slide: target, commands: wire.list(commands, 'commands').map((entry) => parseDrawCommand(entry)) }
  }
  return wire.fail('body')
}

/**
 * 校验一条绘图命令。命令来自面板的指针手势，是 wire 边界，所以逐 tag 收窄。
 * `clear` 在这里放行：它是面板「清空页」按钮，只对模型隐藏（`sensei_draw` 的 schema 里没有它）。
 * @param value - 候选值。
 * @returns 通过校验的命令。
 * @throws Error 消息里指出第一处不合法的字段位置。
 */
export function parseDrawCommand(value: unknown): DrawCommand {
  const command = wire.record(value, 'command')
  switch (command['op']) {
    case 'line':
      return {
        op: 'line',
        from: point(command['from'], 'command from'),
        to: point(command['to'], 'command to'),
        color: wire.text(command['color'], 'command color'),
        width: wire.number(command['width'], 'command width'),
      }
    case 'arrow':
      return {
        op: 'arrow',
        from: point(command['from'], 'command from'),
        to: point(command['to'], 'command to'),
        color: wire.text(command['color'], 'command color'),
        width: wire.number(command['width'], 'command width'),
      }
    case 'rect':
      return {
        op: 'rect',
        at: point(command['at'], 'command at'),
        size: point(command['size'], 'command size'),
        color: wire.text(command['color'], 'command color'),
        width: wire.number(command['width'], 'command width'),
        ...fillOf(command['fill']),
      }
    case 'circle':
      return {
        op: 'circle',
        center: point(command['center'], 'command center'),
        radius: wire.number(command['radius'], 'command radius'),
        color: wire.text(command['color'], 'command color'),
        width: wire.number(command['width'], 'command width'),
        ...fillOf(command['fill']),
      }
    case 'text': {
      const align = command['align']
      if (align !== undefined && align !== 'start' && align !== 'middle' && align !== 'end') {
        return wire.fail('command align')
      }
      return {
        op: 'text',
        at: point(command['at'], 'command at'),
        text: wire.text(command['text'], 'command text'),
        size: wire.number(command['size'], 'command size'),
        color: wire.text(command['color'], 'command color'),
        ...(align === undefined ? {} : { align }),
      }
    }
    case 'stroke':
      return {
        op: 'stroke',
        points: wire.list(command['points'], 'command points').map((entry, index) => point(entry, `command points ${index}`)),
        color: wire.text(command['color'], 'command color'),
        width: wire.number(command['width'], 'command width'),
      }
    case 'erase':
      return {
        op: 'erase',
        ids: wire.list(command['ids'], 'command ids').map((entry, index) => wire.text(entry, `command ids ${index}`)),
      }
    case 'clear':
      return { op: 'clear' }
    default:
      return wire.fail('command op')
  }
}

/**
 * 可选的填充色：缺省表示不填，不能把 `undefined` 写进命令。
 * @param value - 候选值。
 * @returns 空对象或一个 `fill` 字段。
 */
function fillOf(value: unknown): { readonly fill?: string } {
  return value === undefined ? {} : { fill: wire.text(value, 'command fill') }
}

/**
 * 校验舞台坐标点。
 * @param value - 候选值。
 * @param what - 出错时的字段说明。
 * @returns 通过校验的点。
 */
function point(value: unknown, what: string): Point {
  const entry = wire.record(value, what)
  return { x: wire.number(entry['x'], `${what} x`), y: wire.number(entry['y'], `${what} y`) }
}

/** 面板回传的一页 PNG。 */
export interface ExportPage {
  /** 0-based 页号，必须落在本次导出的页数内，且不许重复。 */
  readonly index: number
  /** PNG 字节的 base64，不带 `data:` 前缀，也不带换行。 */
  readonly png: string
}

/** `/api/sensei.export` 的请求体。 */
export interface ExportBody {
  readonly pages: readonly ExportPage[]
}

/** 导出倍率的合法值；面板与工具共用这一份，避免两处各自漂移。 */
export const EXPORT_SCALES: readonly number[] = [1, 1.5, 2]

/**
 * 估算一次导出回传的 PNG 原始字节数。
 *
 * base64 的每个字符承载 6 bit，解码后是 `chars × 3 / 4` 字节。面板在 `JSON.stringify` 之前
 * 用它挡掉上百 MB 的请求：60 页 × scale 2 的整份回传没有上限检查就是一次 OOM 风险。
 * @param pages - 已经栅格化好的页面。
 * @returns 解码后的字节数（向上取整）。
 */
export function estimateExportBytes(pages: readonly ExportPage[]): number {
  let chars = 0
  for (const page of pages) chars += page.png.length
  return Math.ceil((chars * 3) / 4)
}

/**
 * 校验 `/api/sensei.export` 的请求体。
 *
 * 页号相对本次请求的 `expectedPages` 校验：缺页是允许的（host 补空白页并回报页码），
 * 越界和重复则说明面板折的是另一份 deck，收下只会产出一份错位的 pptx。
 * @param value - `request.json()` 解出的值，可能是任何东西。
 * @param expectedPages - 本次导出请求的页数，来自等待中的 {@link ExportRequest}。
 * @returns 按原顺序的页面。
 * @throws Error 消息里指出第一处不合法的字段位置。
 */
export function parseExportBody(value: unknown, expectedPages: number): readonly ExportPage[] {
  const body = EXPORT.record(value, 'body')
  const pages = EXPORT.list(body['pages'], 'pages').map((entry, position) => parseExportPage(entry, expectedPages, position))
  const seen = new Set<number>()
  for (const page of pages) {
    if (seen.has(page.index)) return EXPORT.fail('pages index')
    seen.add(page.index)
  }
  return pages
}

/**
 * 校验一页导出结果。
 * @param value - 候选值。
 * @param expectedPages - 本次导出请求的页数。
 * @param position - 在数组里的位置，用于错误文案。
 * @returns 通过校验的一页。
 */
function parseExportPage(value: unknown, expectedPages: number, position: number): ExportPage {
  const page = EXPORT.record(value, `pages ${position}`)
  const index = EXPORT.integer(page['index'], `pages ${position} index`)
  // 负页号不会命中任何一页，只会让 host 误以为"这一页交过了"，结果多出一张空白。
  if (index < 0 || index >= expectedPages) return EXPORT.fail(`pages ${position} index`)
  const png = EXPORT.text(page['png'], `pages ${position} png`)
  // 长度不是 4 的倍数说明末尾被截断或混进了换行；`Buffer.from(..., 'base64')` 会静默丢掉残渣。
  if (png.length % 4 !== 0 || !BASE64.test(png)) return EXPORT.fail(`pages ${position} png`)
  return { index, png }
}

/**
 * 校验一次状态/操作响应。
 * @param value - `Response.json()` 解出的值，可能是任何东西。
 * @returns 通过校验的 delta。
 * @throws Error 消息里指出第一处不合法的字段位置。
 */
export function parseDeckDelta(value: unknown): DeckDelta {
  const delta = record(value, 'delta')
  const revision = integer(delta['revision'], 'revision')
  // revision 是流长度：负数或小数会让 `since` 缺口检测失去意义。
  if (revision < 0) return invalid('revision')
  const ops = list(delta['ops'], 'ops').map((op) => parseDeckOp(op))
  // 面板按 `revision - ops.length` 定位起始序号；ops 比 revision 多说明这份响应自相矛盾。
  if (ops.length > revision) return invalid('ops')
  const snapshotRequest = parseSnapshotRequest(delta['snapshotRequest'])
  const exportRequest = parseExportRequest(delta['exportRequest'])
  return {
    revision,
    ops,
    ...(snapshotRequest === undefined ? {} : { snapshotRequest }),
    ...(exportRequest === undefined ? {} : { exportRequest }),
  }
}

/**
 * 校验状态响应里的出图请求位。
 * @param value - 候选值：缺省、null，或一个 {@link SnapshotRequest}。
 * @returns undefined（字段缺省）、null 或请求对象。
 * @throws Error 字段结构不对时抛出。
 */
export function parseSnapshotRequest(value: unknown): SnapshotRequest | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const request = record(value, 'snapshotRequest')
  const id = text(request['id'], 'snapshotRequest id')
  const slide = integer(request['slide'], 'snapshotRequest slide')
  // 页号是 0-based：负数会让面板去栅格化一个不存在的页。
  if (slide < 0) return invalid('snapshotRequest slide')
  return { id, slide }
}

/**
 * 校验状态响应里的导出请求位。
 * @param value - 候选值：缺省、null，或一个 {@link ExportRequest}。
 * @returns undefined（字段缺省）、null 或请求对象。
 * @throws Error 字段结构不对时抛出。
 */
export function parseExportRequest(value: unknown): ExportRequest | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const request = record(value, 'exportRequest')
  const id = text(request['id'], 'exportRequest id')
  const pages = integer(request['pages'], 'exportRequest pages')
  const scale = number(request['scale'], 'exportRequest scale')
  if (pages < 1) return invalid('exportRequest pages')
  if (!EXPORT_SCALES.includes(scale)) return invalid('exportRequest scale')
  return { id, pages, scale }
}

/**
 * 校验一个 deck op。wire 与磁盘 JSONL 共用这一份校验。
 * @param value - 候选值。
 * @returns 通过校验的 op。
 */
export function parseDeckOp(value: unknown): DeckOp {
  const op = record(value, 'op')
  switch (op['op']) {
    case 'deck': {
      const css = op['css']
      return {
        op: 'deck',
        slides: list(op['slides'], 'deck slides').map((slide) => parseSlide(slide)),
        ...(css === undefined ? {} : { css: text(css, 'deck css') }),
      }
    }
    case 'slide':
      return { op: 'slide', index: integer(op['index'], 'slide index'), slide: parseSlide(op['slide']) }
    case 'show':
      return { op: 'show', index: integer(op['index'], 'show index') }
    case 'annotate':
      return {
        op: 'annotate',
        slide: integer(op['slide'], 'annotate slide'),
        ops: list(op['ops'], 'annotate ops').map((entry) => parseSceneOp(entry)),
      }
    case 'clear':
      return { op: 'clear', slide: integer(op['slide'], 'clear slide') }
    case 'exported':
      return { op: 'exported', path: text(op['path'], 'exported path') }
    default:
      return invalid('op tag')
  }
}

/**
 * 校验一页。
 * @param value - 候选值。
 * @returns 通过校验的页。
 */
function parseSlide(value: unknown): Slide {
  const slide = record(value, 'slide')
  const title = slide['title']
  const notes = slide['notes']
  return {
    html: text(slide['html'], 'slide html'),
    ...(title === undefined ? {} : { title: text(title, 'slide title') }),
    ...(notes === undefined ? {} : { notes: text(notes, 'slide notes') }),
  }
}

/**
 * 校验一条批注 op。
 * @param value - 候选值。
 * @returns 通过校验的 op。
 */
function parseSceneOp(value: unknown): SceneOp {
  const op = record(value, 'scene op')
  switch (op['op']) {
    case 'add':
      return { op: 'add', element: parseElement(op['element']) }
    case 'patch':
      if (op['isDeleted'] !== true) return invalid('patch isDeleted')
      return { op: 'patch', id: text(op['id'], 'patch id'), isDeleted: true }
    case 'clear':
      return { op: 'clear' }
    default:
      return invalid('scene op tag')
  }
}

/**
 * 校验画板元素。批注元素由面板渲染，字段缺一个就会画成 NaN，所以逐字段收窄。
 * @param value - 候选值。
 * @returns 通过校验的元素。
 */
function parseElement(value: unknown): Element {
  const element = record(value, 'element')
  const base = {
    id: text(element['id'], 'element id'),
    x: number(element['x'], 'element x'),
    y: number(element['y'], 'element y'),
    width: number(element['width'], 'element width'),
    height: number(element['height'], 'element height'),
    strokeColor: text(element['strokeColor'], 'element strokeColor'),
    strokeWidth: number(element['strokeWidth'], 'element strokeWidth'),
    isDeleted: bool(element['isDeleted'], 'element isDeleted'),
  }
  const type = text(element['type'], 'element type')
  switch (type) {
    case 'line':
    case 'arrow':
    case 'stroke':
      return { ...base, type, points: points(element['points']) }
    case 'rect':
    case 'ellipse': {
      const fill = element['fill']
      return {
        ...base,
        type,
        ...(fill === undefined ? {} : { fill: text(fill, 'element fill') }),
      }
    }
    case 'text': {
      const align = element['align']
      if (align !== 'start' && align !== 'middle' && align !== 'end') return invalid('element align')
      return {
        ...base,
        type,
        text: text(element['text'], 'element text'),
        fontSize: number(element['fontSize'], 'element fontSize'),
        align,
      }
    }
    default:
      return invalid('element type')
  }
}

/**
 * 校验元素点列。
 * @param value - 候选值。
 * @returns 点列。
 */
function points(value: unknown): { x: number; y: number }[] {
  return list(value, 'element points').map((point) => {
    const entry = record(point, 'element point')
    return { x: number(entry['x'], 'point x'), y: number(entry['y'], 'point y') }
  })
}

/**
 * base64 的严格形态：非空、长度是 4 的倍数、只有标准表字符与末尾补零。
 *
 * 面板可能把 `data:` 前缀或换行一起发过来；那种串交给 `Buffer.from(..., 'base64')` 会**静默**
 * 跳过非法字符，于是 host 写进 pptx 的是一段谁也没校验过的字节。
 */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * 造一组按同一报错前缀收窄 wire 字段的校验器。
 *
 * 状态响应/磁盘与 ops 请求体是两条边界，前缀不同面板才好定位；收窄规则本身只有一份。
 * @param fail - 抛错函数，参数是第一处不合法字段的说明。
 * @returns 六个收窄函数与 `fail` 本身。
 */
function readers(fail: (what: string) => never) {
  const record = (value: unknown, what: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(what)
    return value as Record<string, unknown>
  }
  const list = (value: unknown, what: string): unknown[] => {
    if (!Array.isArray(value)) return fail(what)
    return value
  }
  const text = (value: unknown, what: string): string => {
    if (typeof value !== 'string') return fail(what)
    return value
  }
  const number = (value: unknown, what: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(what)
    return value
  }
  const integer = (value: unknown, what: string): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fail(what)
    return value
  }
  const bool = (value: unknown, what: string): boolean => {
    if (typeof value !== 'boolean') return fail(what)
    return value
  }
  return { fail, record, list, text, number, integer, bool }
}

/** deck 数据的校验器：状态响应与磁盘 JSONL 共用。 */
const DECK = readers((what) => {
  throw new Error(`sensei: malformed deck data at ${what}`)
})

// 拆成同名常量：既有解析函数不必改调用点。
const { record, list, text, number, integer, bool } = DECK
const invalid = DECK.fail

/** `/api/sensei.ops` 请求体的校验器；前缀区分出是哪条边界拒的。 */
const wire = readers((what) => {
  throw new Error(`sensei: malformed ops body at ${what}`)
})

/** `/api/sensei.export` 请求体的校验器。 */
const EXPORT = readers((what) => {
  throw new Error(`sensei: malformed export body at ${what}`)
})
