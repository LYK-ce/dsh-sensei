import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  EXPORT_PATH,
  OPS_PATH,
  PROGRESS_PATH,
  SNAPSHOT_PATH,
  STATE_PATH,
  estimateExportBytes,
  parseDeckDelta,
} from '../shared/protocol.ts'
import type { CommandsBody, DeckDelta, ExportPage, ExportRequest, ShowBody, SnapshotRequest } from '../shared/protocol.ts'
// 类型专用：把 locale 服务的 Context 合并拉进程序。
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 类型专用：`ctx.slots` 与槽位注册由 ui-renderer 声明。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 类型专用：'sidebar.right.pane.tab' 的 SlotMap 行与 sidebarRightTabs 服务由 ui-sidebar-right 声明。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// 类型专用：session 作用域的标准位（useSession 等）由 ui-session 声明。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { NS, en, zh } from './locale.ts'
import type { SenseiKey } from './locale.ts'
import { SenseiPanel } from './panel.tsx'
import type { SenseiInjected } from './panel.tsx'
import { rasterizePage } from './rasterize.ts'
import { createDeckSource } from './source.ts'
import type { DeckSource, DeckView, OverflowProbe } from './source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 讲演面板的文案。 */
    sensei: SenseiKey
  }
}

/** 轮询间隔，毫秒：agent 翻页到人看见最多迟这么久，也是面板心跳的周期。 */
const POLL_MS = 1000

/** 读快照的栅格化倍率：1280×720，模型看图不需要更大的分辨率。 */
const SNAPSHOT_SCALE = 1

/**
 * 一次导出回传的体积上限，字节。
 *
 * 60 页 × scale 2 的 base64 能到上百 MB；这已经不是为了省流量，而是"这个请求会不会把
 * 页面卡死"的问题。超限时在 `JSON.stringify` 之前就失败，别让浏览器先拼出一个巨型字符串。
 */
const MAX_EXPORT_BYTES = 64 * 1024 * 1024

/** 右侧栏 tab 类型与它 body 座位的注册 id；与 package.json 的 name 一致。 */
const TAB_ID = 'dsh-sensei'

/** 需要的服务：槽位、文案与右侧栏的 tab 类型登记处。 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * 把讲演注册成右侧栏的一个 page type：类型登记在 `sidebarRightTabs`，面板挂在
 * `sidebar.right.pane.tab` 这个 keyed 座位上（两段式注册，模板是 ui-sidebar-terminal）。
 *
 * 数据走四条 exact Fetch route：state 增量轮询（兼心跳）、人工翻页/批注、交回快照、交回导出页面。
 * @param ctx - 客户端根上下文。
 * @returns 无。
 */
export function apply(ctx: Context): void {
  /** 每个会话一份源；同一个 sessionId 重复注入时复用，避免挂出第二个轮询。 */
  const sources = new Map<string, DeckSource>()

  /**
   * 读 `since` 之后的 op 流与两条产出请求。
   * @param sessionId - 面板所属会话。
   * @param since - 本地已有的 op 数。
   * @param measurement - 面板对当前页的溢出测量，随心跳一起报给 host。
   * @returns 校验过的 delta。
   */
  const loadDeck = async (
    sessionId: SessionId,
    since: number,
    measurement: OverflowProbe | undefined,
  ): Promise<DeckDelta> => {
    const query = new URLSearchParams({ sessionId, since: String(since) })
    if (measurement !== undefined) {
      query.set('slide', String(measurement.slide))
      query.set('overflow', measurement.overflow ? '1' : '0')
    }
    const response = await fetch(`${STATE_PATH}?${query.toString()}`)
    if (!response.ok) throw new Error(`sensei: state read failed with ${response.status}`)
    // 响应是网络边界：结构不对就抛，面板显示错误、下一拍重试，绝不折进本地 deck。
    return parseDeckDelta(await response.json())
  }

  /**
   * 提交一次人工翻页。
   * @param sessionId - 面板所属会话。
   * @param index - 0-based 目标页。
   * @returns 校验过的 delta。
   */
  const showSlide = async (sessionId: SessionId, index: number): Promise<DeckDelta> => {
    const body: ShowBody = { show: index }
    const response = await fetch(`${OPS_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`sensei: show failed with ${response.status}`)
    return parseDeckDelta(await response.json())
  }

  /**
   * 在面板自己显示的那一页提交一批批注命令。
   *
   * 页号随请求一起走：只靠 host 的 `current` 时，agent 同一拍翻页会让这一笔落到新页。
   * @param sessionId - 面板所属会话。
   * @param commands - 面板手势折成的命令。
   * @param slide - 面板显示的那一页，0-based。
   * @returns 校验过的 delta。
   */
  const drawOnSlide = async (sessionId: SessionId, commands: CommandsBody['commands'], slide: number): Promise<DeckDelta> => {
    const body: CommandsBody = { commands, slide }
    const response = await fetch(`${OPS_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`sensei: draw failed with ${response.status}`)
    return parseDeckDelta(await response.json())
  }

  /**
   * 把一页的进度报给 host。
   *
   * 只服务"导出超时"那句错误；上报失败不影响正在栅格化的导出，所以这里吞掉异常并写下一句为什么。
   * @param sessionId - 面板所属会话。
   * @param requestId - host 的导出请求 id。
   * @param rendered - 已经处理完的页数，从 1 开始。
   * @param total - 本次导出的总页数。
   * @returns 上报完成；失败时不抛。
   */
  const reportProgress = async (
    sessionId: SessionId,
    requestId: string,
    rendered: number,
    total: number,
  ): Promise<void> => {
    const query = new URLSearchParams({
      sessionId,
      requestId,
      rendered: String(rendered),
      total: String(total),
    })
    try {
      await fetch(`${PROGRESS_PATH}?${query.toString()}`, { method: 'POST' })
    } catch {
      // 进度是旁支信息：网络抖动或页面正在卸载都不该让这次导出失败。
    }
  }

  /**
   * 把一次出图请求做成 PNG 并交回 host。
   *
   * 图包含批注层：`sensei_read { image: true }` 问的是"人现在看到什么"。
   * @param sessionId - 面板所属会话。
   * @param request - host 的请求。
   * @param view - 本地已折叠的 deck。
   * @returns 交回完成。
   */
  const deliverSnapshot = async (sessionId: SessionId, request: SnapshotRequest, view: DeckView): Promise<void> => {
    const slide = view.deck.slides[request.slide]
    if (slide === undefined) {
      throw new Error(`sensei: slide ${request.slide + 1} is no longer in the deck`)
    }
    const scene = view.deck.annotations[request.slide]
    const png = await rasterizePage(slide.html, view.deck.css, SNAPSHOT_SCALE, scene)
    const bytes = new Uint8Array(await png.arrayBuffer())
    const response = await fetch(
      `${SNAPSHOT_PATH}?sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(request.id)}`,
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes },
    )
    if (!response.ok) throw new Error(`sensei: snapshot upload failed with ${response.status}`)
  }

  /**
   * 把整份 deck 逐页栅格化并交回 host。
   *
   * 页数先与请求比对：host 等的是它发起那一刻的 deck，页数已经变了就该让 agent 重来，
   * 而不是白栅格化几十页。单页失败按缺页处理——host 会补空白并在结果里报页码。
   * 每页顺手报一次进度（只服务超时文案），整份体积超 64 MiB 则在发出去之前失败。
   * @param sessionId - 面板所属会话。
   * @param request - host 的导出请求。
   * @param view - 本地已折叠的 deck。
   * @returns 交回完成。
   */
  const deliverExport = async (sessionId: SessionId, request: ExportRequest, view: DeckView): Promise<void> => {
    const deck = view.deck
    if (deck.slides.length !== request.pages) {
      throw new Error(
        `sensei: the deck changed during the export (${deck.slides.length} slide(s) now, ${request.pages} expected)`,
      )
    }

    const pages: ExportPage[] = []
    for (const [index, slide] of deck.slides.entries()) {
      try {
        const png = await rasterizePage(slide.html, deck.css, request.scale)
        pages.push({ index, png: await base64Of(png) })
      } catch {
        // 单页栅格化失败只让这一页缺省：host 会补空白页并在结果里报页码，整份导出不失败。
        continue
      } finally {
        // 失败页也算"处理过"：超时文案要回答的是面板走到第几页，不是成功了几页。
        void reportProgress(sessionId, request.id, index + 1, deck.slides.length)
      }
    }

    const bytes = estimateExportBytes(pages)
    if (bytes > MAX_EXPORT_BYTES) throw new Error(t('status.exportTooLarge'))

    const response = await fetch(
      `${EXPORT_PATH}?sessionId=${encodeURIComponent(sessionId)}&requestId=${encodeURIComponent(request.id)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pages } satisfies { pages: readonly ExportPage[] }),
      },
    )
    if (!response.ok) throw new Error(`sensei: export upload failed with ${response.status}`)
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sensei: dictionaries')
  // tab 标题与 guide 文案都是注册期文本，走 thunk 才能跟随语言切换而不重新注册。
  const t = ctx.locale.bind(NS)

  /**
   * 一个会话的讲演注入面：面板私有的 deck 源，加翻页、批注与两条面板产出动作。
   * @param sessionId - 面板所属会话。
   * @returns 注入面。
   */
  const injected = (sessionId: SessionId): SenseiInjected => {
    const existing = sources.get(sessionId)
    const source = existing ?? createDeckSource({
      load: (since, measurement) => loadDeck(sessionId, since, measurement),
      show: (index) => showSlide(sessionId, index),
      draw: (commands, slide) => drawOnSlide(sessionId, commands, slide),
      pollMs: POLL_MS,
    })
    if (existing === undefined) sources.set(sessionId, source)
    return {
      hooks: { deck: source },
      show: source.show,
      draw: source.draw,
      setOverflowProbe: source.setOverflowProbe,
      snapshot: (request) => deliverSnapshot(sessionId, request, source.getSnapshot()),
      exportDeck: (request) => deliverExport(sessionId, request, source.getSnapshot()),
    }
  }

  // 不写 patterns：这是个 page type，按 kind 打开、不认资源地址（ui-sidebar-right/src/client/tab-registry.ts）。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: 'sensei',
    title: () => t('view.sensei'),
    guide: [{ id: 'open', order: 20, title: () => t('view.sensei'), description: () => t('guide.description') }],
  }), 'sensei: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: injected,
  }, SenseiPanel)), 'sensei: pane body')
}

/**
 * PNG 转 base64。
 *
 * 分块拼接：一次性 `String.fromCharCode(...bytes)` 在 1920×1080 的图上会爆调用栈上限。
 * @param blob - rasterize 产出的 PNG。
 * @returns 不带 `data:` 前缀的 base64。
 */
async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunk = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}
