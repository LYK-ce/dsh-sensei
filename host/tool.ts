/**
 * 六条工具：整份 deck、单页 upsert、翻页、批注、读状态（可带图）、导出 pptx。
 *
 * 工具跑在 host 平面，所有 preset 都能看到；结果里恒带 `panelOpen`，模型据此决定要不要
 * 提醒人去右侧栏打开面板。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describePages } from '../core/deck.ts'
import type { Deck, DeckOp, Slide } from '../core/deck.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import { createScene } from '../vendor/dsh-blackboard/core/scene.ts'
import { exportTarget, writePptx } from './export.ts'
import type { PanelPresence } from './presence.ts'
import type { DeckStore } from './store.ts'
import type { ExportLedger, SnapshotLedger } from './snapshots.ts'

/**
 * 工具执行上下文里本插件真正用到的那一部分：当前 agent 的会话与它的工作目录。
 *
 * 比 `ToolRunContext` 宽（参数逆变），所以测试可以直接传
 * `{ agent: { session: { id: SessionId('s'), header: {} } } }`，不必用 DESIGN §14 禁止的 `as unknown`。
 */
export interface ToolSessionContext {
  readonly agent?: {
    readonly session: {
      readonly id: SessionId
      /** 会话头；导出落点的相对路径按它的 `cwd` 解析。 */
      readonly header: { readonly cwd?: string }
    }
  }
  /** 调用方的取消信号；面板产出请求会跟着它一起作废。 */
  readonly signal?: AbortSignal
}

/** 三条内容工具共用的结果：模型只需要这三个数。 */
export interface SenseiToolResult {
  /** 总页数。 */
  readonly pages: number
  /** 当前页，1-based；空 deck 为 0。 */
  readonly current: number
  /** 面板最近 3 秒内有过心跳。 */
  readonly panelOpen: boolean
}

/** `sensei_draw` 的结果：这次新增的元素 id、本页元素数、面板是否打开。 */
export interface SenseiDrawResult {
  /** 本次新增元素的 id，按绘制顺序。 */
  readonly added: readonly string[]
  /** 本页未删除的元素数；软删除的不算。 */
  readonly elements: number
  /** 面板最近 3 秒内有过心跳。 */
  readonly panelOpen: boolean
}

/** `sensei_read` 的结果：状态自查所需的一切，外加可选的 PNG 落点。 */
export interface SenseiReadResult {
  /** 总页数。 */
  readonly pages: number
  /** 当前页，1-based；空 deck 为 0。 */
  readonly current: number
  /** 这条结果描述的页，1-based。 */
  readonly slide: number
  /** 该页未删除元素的 id，按绘制顺序。 */
  readonly elements: readonly string[]
  /** 面板对目标页的溢出测量；面板没测过、已过期，或量的是别的页时为 null。 */
  readonly overflow: boolean | null
  /** 面板最近 3 秒内有过心跳。 */
  readonly panelOpen: boolean
  /** `image: true` 时落盘的 PNG。 */
  readonly image?: {
    /** 绝对路径。 */
    readonly path: string
    /** 文件字节数。 */
    readonly bytes: number
  }
}

/** `sensei_export` 的结果：模型需要完整路径才能继续引用这份文件。 */
export interface SenseiExportResult {
  /** pptx 的绝对路径。 */
  readonly path: string
  /** 总页数。 */
  readonly pages: number
  /** 文件字节数。 */
  readonly bytes: number
  /** 补成空白页的页码，1-based。 */
  readonly blank: readonly number[]
  /** 面板最近 3 秒内有过心跳。 */
  readonly panelOpen: boolean
}

/** `defineTool` 的定义，但 execute 的第二个参数收窄成 {@link ToolSessionContext}。 */
export interface SenseiTool<Result = SenseiToolResult> extends Omit<ToolDefinition, 'execute'> {
  /**
   * 执行一次工具调用。
   * @param args - 已通过 schema 校验的参数。
   * @param exec - 执行上下文；只用到当前 agent 的会话。
   * @returns 该工具的结果，类型见 {@link SenseiToolResult} 与 {@link SenseiDrawResult}。
   */
  execute(args: unknown, exec: ToolSessionContext): Promise<Result>
}

/** 页数上限。 */
const MAX_SLIDES = 60
/** 单页 HTML 的字节上限（UTF-8）。 */
const MAX_SLIDE_BYTES = 64 * 1024
/** deck 级 css 的字节上限（UTF-8）。 */
const MAX_CSS_BYTES = 32 * 1024

/** 面板没开时，结果文案里要给模型一句可执行的提示。 */
const PANEL_CLOSED = 'The Sensei panel is closed; open its tab in the right sidebar to show the deck.'

/** 要图时面板没开：不能等成超时，得让模型立刻知道该请人开面板。 */
const PANEL_CLOSED_IMAGE = 'The Sensei panel is closed; open its tab in the right sidebar so it can render the page.'

/** 导出时面板没开：同上，只是它要栅格化的是整份 deck。 */
const PANEL_CLOSED_EXPORT = 'The Sensei panel is closed; open its tab in the right sidebar so it can rasterize the slides.'

/** 等面板出图的上限，毫秒：面板每秒轮询一次，留两拍余量（与 blackboard 相同）。 */
const SNAPSHOT_TIMEOUT_MS = 2_500

/** 等面板逐页栅格化的上限，毫秒：60 页 × scale 2 在慢机器上也要几十秒。 */
const EXPORT_TIMEOUT_MS = 60_000

/** 一页内容的参数节点。数组元素与顶层参数共用同一份声明。 */
const SLIDE_FIELDS = {
  html: {
    type: 'string',
    required: true,
    description: 'Slide body fragment. Styles go in the deck css or an inline <style> element; scripts and external '
      + 'resources are stripped. Must be at most 64 KB.',
  },
  title: { type: 'string', description: 'Short title for the status line and export file names.' },
  notes: { type: 'string', description: 'Speaker notes for this slide, used to resume after an interruption.' },
} as const

/** 数组元素的页节点。`required` 只能写在属性位置，所以这里不带它。 */
const SLIDE_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: SLIDE_FIELDS,
} as const

/** 三条工具共用的输出声明。 */
const RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pages: { type: 'integer', required: true, description: 'Total number of slides in the deck.' },
    current: { type: 'integer', required: true, description: 'Current slide number, 1-based; 0 when the deck is empty.' },
    panelOpen: { type: 'boolean', required: true, description: 'Whether the Sensei panel polled the host within the last 3 seconds.' },
  },
} as const

/** 单个 `commands` 条目上限。 */
const MAX_COMMANDS = 200

/** 舞台坐标系，写在描述里当模型的约定；与 `core/stage.ts` 的 1280×720 一致。 */
const COORDINATES = 'Stage coordinates run 0..1280 horizontally and 0..720 vertically, y downward.'

/** 一个点的参数节点。 */
const POINT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    x: { type: 'number', required: true },
    y: { type: 'number', required: true },
  },
} as const

/**
 * 作为属性使用时的点节点。`required: true` 是"父对象必须带这个字段"的标记，
 * 所以只能在使用点加——放进 `items` 会让数组元素也背上这个标记，那是噪音。
 */
const POINT_PROP = { ...POINT, required: true } as const

/** 描边形状共用的两个参数。 */
const PAINT = {
  color: { type: 'string', required: true, description: "Stroke color as '#rrggbb'." },
  width: { type: 'number', required: true, description: 'Stroke width in stage units; 4 is the default.' },
} as const

/** 可填充形状共用的一个可选参数：不给就是不填。 */
const FILL = {
  fill: { type: 'string', description: "Fill color as '#rrggbb'; omit it to leave the shape unfilled." },
} as const

/**
 * 七支绘图命令。`clear` 不开放给模型：它能一次抹掉人与 agent 的全部笔迹。
 * 每支靠 `op` 的 `const` 区分，校验是 exactly-one。
 */
const COMMAND = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: { op: { type: 'string', const: 'line', required: true }, from: POINT_PROP, to: POINT_PROP, ...PAINT },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: { op: { type: 'string', const: 'arrow', required: true }, from: POINT_PROP, to: POINT_PROP, ...PAINT },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', const: 'rect', required: true },
        at: { ...POINT_PROP, description: 'Top-left corner.' },
        size: { ...POINT_PROP, description: 'Width and height in x and y.' },
        ...PAINT,
        ...FILL,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', const: 'circle', required: true },
        center: POINT_PROP,
        radius: { type: 'number', required: true },
        ...PAINT,
        ...FILL,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', const: 'text', required: true },
        at: { ...POINT_PROP, description: 'Text anchor: x is the aligned edge (left edge, centre, or right edge per align) and y is its vertical centre.' },
        text: { type: 'string', required: true },
        size: { type: 'number', required: true, description: 'Font size in stage units.' },
        color: PAINT.color,
        align: { type: 'string', enum: ['start', 'middle', 'end'], description: 'Horizontal text alignment; start is the default.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', const: 'stroke', required: true },
        points: { type: 'array', items: POINT, required: true, description: 'Freehand samples, in order.' },
        ...PAINT,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', const: 'erase', required: true },
        ids: { type: 'array', items: { type: 'string' }, required: true, description: 'Ids of shapes to remove.' },
      },
    },
  ],
} as const

/** `sensei_draw` 的输出声明。 */
const DRAW_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    added: { type: 'array', items: { type: 'string' }, required: true, description: 'Ids of the shapes this call added, in draw order.' },
    elements: { type: 'integer', required: true, description: 'Elements on the target slide that are still visible.' },
    panelOpen: { type: 'boolean', required: true, description: 'Whether the Sensei panel polled the host within the last 3 seconds.' },
  },
} as const

/** `sensei_read` 的输出声明。 */
const READ_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pages: { type: 'integer', required: true, description: 'Total number of slides in the deck.' },
    current: { type: 'integer', required: true, description: 'Slide the panel is showing, 1-based; 0 when the deck is empty.' },
    slide: { type: 'integer', required: true, description: 'The slide this result describes, 1-based.' },
    elements: {
      type: 'array',
      items: { type: 'string' },
      required: true,
      description: 'Ids of the elements still visible on that slide, in draw order.',
    },
    overflow: {
      oneOf: [{ type: 'boolean' }, { type: 'null' }],
      required: true,
      description: 'Whether the panel measured that slide as larger than the 1280x720 stage. Null when the panel has no '
        + 'fresh measurement for that slide, so treat null as unknown rather than as "fits".',
    },
    panelOpen: { type: 'boolean', required: true, description: 'Whether the Sensei panel polled the host within the last 3 seconds.' },
    image: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', required: true, description: 'Absolute path of the PNG.' },
        bytes: { type: 'integer', required: true, description: 'Size of the PNG in bytes.' },
      },
      description: 'Present when the call asked for an image: the PNG of the slide with its annotations.',
    },
  },
} as const

/** `sensei_export` 的输出声明。 */
const EXPORT_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true, description: 'Absolute path of the written .pptx file.' },
    pages: { type: 'integer', required: true, description: 'Number of slides in the deck that was exported.' },
    bytes: { type: 'integer', required: true, description: 'Size of the .pptx file in bytes.' },
    blank: {
      type: 'array',
      items: { type: 'integer' },
      required: true,
      description: '1-based slide numbers that failed to rasterize and were written as blank pages.',
    },
    panelOpen: { type: 'boolean', required: true, description: 'Whether the Sensei panel polled the host within the last 3 seconds.' },
  },
} as const

/**
 * 整份重建工具。重建会清空全部批注并把当前页重置到第 1 页。
 * @param store - deck 存储。
 * @param presence - 面板心跳表，用来回报 `panelOpen`。
 * @returns 可注册进 `ctx.tools` 的定义。
 */
export function createDeckTool(store: DeckStore, presence: PanelPresence): SenseiTool {
  return asSenseiTool(defineTool({
    name: 'sensei_deck',
    description: 'Replace the whole HTML slide deck shown in the right-sidebar Sensei stage. Pass at most 60 slides, each '
      + 'a body fragment. Rebuilding clears every annotation and turns to slide 1. The result reports the page count, '
      + 'the current slide, and whether the panel is open.',
    parameters: {
      css: {
        type: 'string',
        description: 'Deck-wide css injected after the base slide styles; at most 32 KB.',
      },
      slides: {
        type: 'array',
        items: SLIDE_ITEM,
        required: true,
        description: 'Slides in order; at most 60.',
      },
    },
    output: {
      schema: RESULT,
      render: (_args, value) => [{ type: 'text', text: deckText(value) }],
    },
    async execute(args, exec) {
      const sessionId = sessionOf('sensei_deck', exec)
      checkCount('sensei_deck', args.slides.length)
      checkCss('sensei_deck', args.css)
      const slides = args.slides.map((slide, index) => {
        // 报错用 1-based 页号，与模型传参的语义一致。
        checkSlide('sensei_deck', index + 1, slide.html)
        return slideOf(slide)
      })
      const op: DeckOp = { op: 'deck', slides, ...(args.css === undefined ? {} : { css: args.css }) }
      await store.append(sessionId, op)
      return await report(store, presence, sessionId)
    },
  }))
}

/**
 * 单页 upsert 工具。`index` 为 1-based，等于页数 + 1 时追加新的一页。
 * @param store - deck 存储。
 * @param presence - 面板心跳表，用来回报 `panelOpen`。
 * @returns 可注册进 `ctx.tools` 的定义。
 */
export function createSlideTool(store: DeckStore, presence: PanelPresence): SenseiTool {
  return asSenseiTool(defineTool({
    name: 'sensei_slide',
    description: 'Insert or replace one slide of the Sensei deck. index is 1-based; index equal to the page count + 1 '
      + 'appends a new last slide. Replacing an existing slide keeps that page\'s annotations. The result reports the '
      + 'page count, the current slide, and whether the panel is open.',
    parameters: {
      index: {
        type: 'integer',
        required: true,
        description: 'Target slide, 1-based; page count + 1 appends a new last slide.',
      },
      ...SLIDE_FIELDS,
    },
    output: {
      schema: RESULT,
      render: (_args, value) => [{ type: 'text', text: deckText(value) }],
    },
    async execute(args, exec) {
      const sessionId = sessionOf('sensei_slide', exec)
      // 先取 deck 再校验页号：越界报错要带上页数与当前页。
      const deck = await store.deck(sessionId)
      const index = slideTarget(deck, args.index)
      // 追加也走同一个上限：否则可以靠一次追加把 deck 撑过 60 页。
      if (index >= MAX_SLIDES) {
        throw new Error(`sensei_slide: the deck would have ${index + 1} slides; the limit is ${MAX_SLIDES}`)
      }
      checkSlide('sensei_slide', args.index, args.html)
      await store.append(sessionId, { op: 'slide', index, slide: slideOf(args) })
      return await report(store, presence, sessionId)
    },
  }))
}

/**
 * 翻页工具。只接受已存在的页，越界不夹取。
 * @param store - deck 存储。
 * @param presence - 面板心跳表，用来回报 `panelOpen`。
 * @returns 可注册进 `ctx.tools` 的定义。
 */
export function createShowTool(store: DeckStore, presence: PanelPresence): SenseiTool {
  return asSenseiTool(defineTool({
    name: 'sensei_show',
    description: 'Turn the Sensei stage to one slide. index is 1-based and must be an existing slide; an out-of-range '
      + 'value is rejected with the page count and the current slide. The result reports the page count, the current '
      + 'slide, and whether the panel is open.',
    parameters: {
      index: {
        type: 'integer',
        required: true,
        description: 'Target slide, 1-based; must be within the existing page count.',
      },
    },
    output: {
      schema: RESULT,
      render: (_args, value) => [{ type: 'text', text: deckText(value) }],
    },
    async execute(args, exec) {
      const sessionId = sessionOf('sensei_show', exec)
      const deck = await store.deck(sessionId)
      const index = showTarget(deck, args.index)
      await store.append(sessionId, { op: 'show', index })
      return await report(store, presence, sessionId)
    },
  }))
}

/**
 * 批注工具：一批命令画到指定页（默认当前页）。
 *
 * 命令词汇与 blackboard 一致，但 `clear` 不开放：一次抹掉整页对模型来说太危险，
 * 清空页只留给人手里的按钮。
 * @param store - deck 存储。
 * @param presence - 面板心跳表，用来回报 `panelOpen`。
 * @returns 可注册进 `ctx.tools` 的定义。
 */
export function createDrawTool(store: DeckStore, presence: PanelPresence): SenseiTool<SenseiDrawResult> {
  return asSenseiTool<SenseiDrawResult>(defineTool({
    name: 'sensei_draw',
    description: `Draw or erase shapes on one slide of the Sensei deck. ${COORDINATES} slide is 1-based and defaults to `
      + 'the current slide. The result reports the new element ids, how many elements the target slide has, and whether '
      + 'the panel is open.',
    parameters: {
      slide: {
        type: 'integer',
        description: 'Target slide, 1-based; omit it to draw on the current slide.',
      },
      commands: {
        type: 'array',
        items: COMMAND,
        required: true,
        description: 'Shapes to draw, in order; at most 200.',
      },
    },
    output: {
      schema: DRAW_RESULT,
      render: (_args, value) => [{ type: 'text', text: drawText(value) }],
    },
    async execute(args, exec) {
      const sessionId = sessionOf('sensei_draw', exec)
      if (args.commands.length > MAX_COMMANDS) {
        throw new Error(`sensei_draw: ${args.commands.length} commands exceed the limit of ${MAX_COMMANDS}`)
      }
      // 先取 deck 再校验页号：越界报错要带上页数与当前页。
      const deck = await store.deck(sessionId)
      const slide = drawTarget(deck, args.slide)
      const outcome = await store.annotate(sessionId, slide, args.commands as readonly DrawCommand[])
      if (!outcome.ok) throw new Error(`sensei_draw: ${outcome.reason}`)
      const after = await store.deck(sessionId)
      const scene = after.annotations[slide]
      return {
        added: addedIds(outcome.delta.ops),
        elements: scene === undefined ? 0 : scene.elements.filter((element) => !element.isDeleted).length,
        panelOpen: presence.isOpen(sessionId),
      }
    },
  }))
}

/**
 * 读状态工具：页数、当前页、某一页的元素 id、溢出测量，可选再要一张图。
 *
 * 图只能由浏览器里的面板产出，所以面板没开时立刻报错：等成超时只会让模型以为"再试一次就好"。
 * @param store - deck 存储。
 * @param presence - 面板心跳表，兼溢出测量入口。
 * @param snapshots - 出图请求账本。
 * @param dataDir - PNG 落盘目录（与 ops 文件同一个目录）。
 * @returns 可注册进 `ctx.tools` 的定义。
 */
export function createReadTool(
  store: DeckStore,
  presence: PanelPresence,
  snapshots: SnapshotLedger,
  dataDir: string,
): SenseiTool<SenseiReadResult> {
  return asSenseiTool<SenseiReadResult>(defineTool({
    name: 'sensei_read',
    description: 'Read the Sensei deck: page count, current slide, the ids of the shapes visible on one slide, and '
      + 'whether that slide overflows the 1280x720 stage. Set image to true to also write a PNG of the slide (content plus '
      + 'annotations) and get its path; that needs the panel open. slide is 1-based and defaults to the current slide.',
    parameters: {
      image: { type: 'boolean', description: 'Write a PNG of the target slide and return its path.' },
      slide: { type: 'integer', description: 'Target slide, 1-based; omit it to read the current slide.' },
    },
    output: {
      schema: READ_RESULT,
      render: (_args, value) => [{ type: 'text', text: readText(value) }],
    },
    async execute(args, exec) {
      const sessionId = sessionOf('sensei_read', exec)
      const deck = await store.deck(sessionId)
      const index = readTarget(deck, args.slide)
      const scene = deck.annotations[index] ?? createScene()
      const panelOpen = presence.isOpen(sessionId)
      const overflow = presence.overflowOf(sessionId, index)

      let image: SenseiReadResult['image']
      if (args.image === true) {
        if (!panelOpen) throw new Error(`sensei_read: ${PANEL_CLOSED_IMAGE}`)
        const png = await snapshots.request(sessionId, { slide: index }, SNAPSHOT_TIMEOUT_MS, exec.signal)
        const path = join(dataDir, `${safeSessionId(sessionId)}-p${index + 1}.png`)
        // 目录是插件的私有数据目录，第一次出图时它可能还不存在。
        await mkdir(dataDir, { recursive: true })
        await writeFile(path, png)
        image = { path, bytes: png.byteLength }
      }

      return {
        pages: deck.slides.length,
        current: deck.slides.length === 0 ? 0 : deck.current + 1,
        slide: index + 1,
        elements: scene.elements.filter((element) => !element.isDeleted).map((element) => element.id),
        overflow: overflow ?? null,
        panelOpen,
        ...(image === undefined ? {} : { image }),
      }
    },
  }))
}

/** 导出工具的可选依赖。 */
export interface ExportToolOptions {
  /** 落点基准目录；默认取会话头里的 `cwd`，没有就回进程 cwd。 */
  readonly baseDir?: (exec: ToolSessionContext) => string
}

/** 默认导出倍率：1920×1080。60 页一次回传的 base64 会到上百 MB，2 倍留给显式要求。 */
const DEFAULT_EXPORT_SCALE = 1.5

/**
 * 导出工具：让面板逐页栅格化，再由 host 组装成图片版 pptx。
 *
 * 落点与覆盖保护都在发起栅格化**之前**：面板要花十几秒出图，先失败省下的就是这十几秒。
 * @param store - deck 存储。
 * @param presence - 面板心跳表，用来回报 `panelOpen`。
 * @param exports - 导出请求账本。
 * @param options - 落点基准目录的覆盖。
 * @returns 可注册进 `ctx.tools` 的定义。
 */
export function createExportTool(
  store: DeckStore,
  presence: PanelPresence,
  exports: ExportLedger,
  options: ExportToolOptions = {},
): SenseiTool<SenseiExportResult> {
  return asSenseiTool<SenseiExportResult>(defineTool({
    name: 'sensei_export',
    description: 'Export the Sensei deck as an image-based pptx (slides only, no annotations) and report the absolute '
      + 'path. The panel must be open. dir is resolved against the session working directory and defaults to it; name is '
      + 'a single file name, with or without the .pptx extension, and defaults to sensei-deck.pptx; scale is 1, 1.5 '
      + '(default, 1920x1080), or 2. An existing file is only replaced when overwrite is true.',
    parameters: {
      dir: {
        type: 'string',
        description: 'Target directory; relative paths resolve against the session working directory, and omitting it '
          + 'uses that directory.',
      },
      name: {
        type: 'string',
        description: 'Single file name, with or without the .pptx extension; must not contain a path separator. Defaults '
          + 'to sensei-deck.pptx.',
      },
      scale: { type: 'number', enum: [1, 1.5, 2], description: 'Rasterization scale: 1, 1.5 (default), or 2.' },
      overwrite: { type: 'boolean', description: 'Replace an existing file instead of failing.' },
    },
    output: {
      schema: EXPORT_RESULT,
      render: (_args, value) => [{ type: 'text', text: exportText(value) }],
    },
    async execute(args, exec) {
      const sessionId = sessionOf('sensei_export', exec)
      const deck = await store.deck(sessionId)
      // 空 deck 没有可导出的东西；报错带上页数和当前页，与其余工具同一套文案。
      if (deck.slides.length === 0) {
        throw new Error(`sensei_export: slide 1 is out of range (${describePages(deck)})`)
      }
      const scale = exportScale(args.scale)
      if (!presence.isOpen(sessionId)) throw new Error(`sensei_export: ${PANEL_CLOSED_EXPORT}`)

      const pages = deck.slides.length
      const baseDir = options.baseDir?.(exec) ?? workspaceOf(exec)
      const target = exportTarget({ dir: args.dir, name: args.name, overwrite: args.overwrite, baseDir })
      const delivered = await exports.request(sessionId, { pages, scale }, EXPORT_TIMEOUT_MS, exec.signal)
      const written = await writePptx({ target, pages: delivered, slideCount: pages })
      await store.append(sessionId, { op: 'exported', path: written.path })
      return {
        path: written.path,
        pages,
        bytes: written.bytes,
        blank: [...written.blank],
        panelOpen: presence.isOpen(sessionId),
      }
    },
  }))
}

/**
 * 把 `defineTool` 的返回值收窄成 {@link SenseiTool}。
 *
 * `defineTool` 的 execute 第二个参数是完整的 `ToolRunContext`；收窄只影响类型，运行时是同一个函数。
 * 收窄后测试不必伪造整个执行上下文，也就不会写出 `as unknown`。
 * @param tool - `defineTool` 产出的定义。
 * @returns 同一份定义，execute 的上下文参数更宽。
 */
function asSenseiTool<Result>(tool: ToolDefinition): SenseiTool<Result> {
  return tool as SenseiTool<Result>
}

/**
 * 取本次调用所属会话。
 * @param tool - 工具名，用于错误文案。
 * @param exec - 执行上下文。
 * @returns 会话 id。
 * @throws Error 没有 agent 会话时抛出，绝不静默写到别处。
 */
function sessionOf(tool: string, exec: ToolSessionContext): SessionId {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) throw new Error(`${tool}: the tool ran without an agent session`)
  return sessionId
}

/**
 * `sensei_slide` 的 1-based 页号 → 0-based 下标；页数 + 1 表示追加。
 * @param deck - 当前 deck。
 * @param index - 模型给的 1-based 页号。
 * @returns 0-based 下标。
 * @throws Error 越界时抛出，消息带页数与当前页。
 */
function slideTarget(deck: Deck, index: number): number {
  if (!Number.isSafeInteger(index) || index < 1 || index > deck.slides.length + 1) {
    throw new Error(`sensei_slide: slide ${index} is out of range (${describePages(deck)})`)
  }
  return index - 1
}

/**
 * `sensei_show` 的 1-based 页号 → 0-based 下标；只能指向已有的页。
 * @param deck - 当前 deck。
 * @param index - 模型给的 1-based 页号。
 * @returns 0-based 下标。
 * @throws Error 越界时抛出，空 deck 明确说"还没有幻灯片"。
 */
function showTarget(deck: Deck, index: number): number {
  if (!Number.isSafeInteger(index) || index < 1 || index > deck.slides.length) {
    throw new Error(`sensei_show: slide ${index} is out of range (${describePages(deck)})`)
  }
  return index - 1
}

/**
 * `sensei_draw` 的目标页：省略时用当前页，给了就按 1-based 收窄。
 * @param deck - 当前 deck。
 * @param slide - 模型给的 1-based 页号，可省略。
 * @returns 0-based 下标。
 * @throws Error 空 deck 或越界时抛出，消息带页数与当前页。
 */
function drawTarget(deck: Deck, slide: number | undefined): number {
  if (slide === undefined) {
    if (deck.slides.length === 0) throw new Error(`sensei_draw: slide 1 is out of range (${describePages(deck)})`)
    return deck.current
  }
  if (!Number.isSafeInteger(slide) || slide < 1 || slide > deck.slides.length) {
    throw new Error(`sensei_draw: slide ${slide} is out of range (${describePages(deck)})`)
  }
  return slide - 1
}

/**
 * `sensei_read` 的目标页：省略时用当前页，给了就按 1-based 收窄。
 * @param deck - 当前 deck。
 * @param slide - 模型给的 1-based 页号，可省略。
 * @returns 0-based 下标。
 * @throws Error 空 deck 或越界时抛出，消息带页数与当前页。
 */
function readTarget(deck: Deck, slide: number | undefined): number {
  if (slide === undefined) {
    if (deck.slides.length === 0) throw new Error(`sensei_read: slide 1 is out of range (${describePages(deck)})`)
    return deck.current
  }
  if (!Number.isSafeInteger(slide) || slide < 1 || slide > deck.slides.length) {
    throw new Error(`sensei_read: slide ${slide} is out of range (${describePages(deck)})`)
  }
  return slide - 1
}

/**
 * 收窄导出倍率。
 *
 * schema 已经声明了 enum；这里再挡一次，因为测试与将来的调用方可能绕过 schema 直接 execute。
 * @param value - 模型给的倍率，可省略。
 * @returns 合法倍率。
 * @throws Error 不在 1 / 1.5 / 2 里时抛出。
 */
function exportScale(value: number | undefined): number {
  const scale = value ?? DEFAULT_EXPORT_SCALE
  if (scale !== 1 && scale !== 1.5 && scale !== 2) {
    throw new Error(`sensei_export: scale ${scale} is not one of 1, 1.5, 2`)
  }
  return scale
}

/**
 * 落点基准目录：会话工作区，没有就回进程 cwd。
 *
 * 不跟随会话内的 `cd`：那需要一个 host 侧的目录服务，而导出落点按"会话工作区"的字面语义
 * 已经够用；真要一致，只需替换 {@link ExportToolOptions.baseDir}。
 * @param exec - 执行上下文。
 * @returns 绝对或相对的基准目录。
 */
function workspaceOf(exec: ToolSessionContext): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

/**
 * 会话 id 折成安全的文件名字符。
 * @param sessionId - 会话 id。
 * @returns 只含 `[A-Za-z0-9._-]` 的片段。
 */
function safeSessionId(sessionId: SessionId): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
}

/**
 * 从本次 delta 里取出新增元素的 id。
 * @param ops - 本次追加的 deck op。
 * @returns 按绘制顺序的 id。
 */
function addedIds(ops: readonly DeckOp[]): string[] {
  return ops.flatMap((op) => (op.op === 'annotate' ? op.ops.flatMap((entry) => (entry.op === 'add' ? [entry.element.id] : [])) : []))
}

/**
 * `sensei_draw` 的模型可见文案。
 * @param value - 规范化输出。
 * @returns 一段文本。
 */
function drawText(value: SenseiDrawResult): string {
  const head = value.added.length === 0
    ? 'No shapes were added.'
    : `Added ${value.added.length} shape(s) with id(s): ${value.added.join(', ')}.`
  const tail = `The slide now has ${value.elements} element(s).`
  return value.panelOpen ? `${head} ${tail}` : `${head} ${tail} ${PANEL_CLOSED}`
}

/**
 * 组装工具结果。`current` 转成 1-based：模型看到的是页号，不是数组下标。
 * @param store - deck 存储。
 * @param presence - 面板心跳表。
 * @param sessionId - 目标会话。
 * @returns 三项结果。
 */
async function report(store: DeckStore, presence: PanelPresence, sessionId: SessionId): Promise<SenseiToolResult> {
  const deck = await store.deck(sessionId)
  const pages = deck.slides.length
  return { pages, current: pages === 0 ? 0 : deck.current + 1, panelOpen: presence.isOpen(sessionId) }
}

/**
 * `sensei_read` 的模型可见文案。
 * @param value - 规范化输出。
 * @returns 一段文本。
 */
function readText(value: SenseiReadResult): string {
  const head = `Slide ${value.slide} of ${value.pages} (the panel is showing slide ${value.current}).`
  const elements = value.elements.length === 0
    ? 'No shapes are visible on it.'
    : `Visible shape ids: ${value.elements.join(', ')}.`
  const overflow = value.overflow === true
    ? ' Its content overflows the 1280x720 stage; shorten it or shrink the text.'
    : value.overflow === false ? ' Its content fits the 1280x720 stage.' : ''
  const image = value.image === undefined
    ? ''
    : ` A PNG of the slide is at ${value.image.path} (${value.image.bytes} bytes); read it with read_image.`
  return `${head} ${elements}${overflow}${image}${value.panelOpen ? '' : ` ${PANEL_CLOSED}`}`
}

/**
 * `sensei_export` 的模型可见文案。
 * @param value - 规范化输出。
 * @returns 一段文本。
 */
function exportText(value: SenseiExportResult): string {
  const blank = value.blank.length === 0
    ? ''
    : ` Slide(s) ${value.blank.join(', ')} could not be rasterized and were written blank.`
  return `Exported ${value.pages} slide(s) to ${value.path} (${value.bytes} bytes).${blank}`
    + (value.panelOpen ? '' : ` ${PANEL_CLOSED}`)
}

/**
 * 工具结果的模型可见文案。
 * @param value - 规范化输出。
 * @returns 一段文本。
 */
function deckText(value: SenseiToolResult): string {
  const head = value.pages === 0
    ? 'The deck is empty.'
    : `The deck has ${value.pages} slide(s); slide ${value.current} is showing.`
  return value.panelOpen ? head : `${head} ${PANEL_CLOSED}`
}

/**
 * 校验页数上限。
 * @param tool - 工具名。
 * @param count - 本次要写入的页数。
 * @returns 无。
 * @throws Error 超限时抛出，不静默截断。
 */
function checkCount(tool: string, count: number): void {
  if (count > MAX_SLIDES) throw new Error(`${tool}: ${count} slides exceed the limit of ${MAX_SLIDES}`)
}

/**
 * 校验 deck 级 css 的字节数。
 * @param tool - 工具名。
 * @param css - 模型给的 css，缺省表示不改。
 * @returns 无。
 * @throws Error 超限时抛出。
 */
function checkCss(tool: string, css: string | undefined): void {
  if (css === undefined) return
  const size = Buffer.byteLength(css, 'utf8')
  if (size > MAX_CSS_BYTES) throw new Error(`${tool}: the deck css is ${size} bytes; the limit is ${MAX_CSS_BYTES} bytes`)
}

/**
 * 校验单页 HTML 的字节数。
 * @param tool - 工具名。
 * @param index - 1-based 页号，用于错误文案。
 * @param html - 页内容。
 * @returns 无。
 * @throws Error 超限时抛出。
 */
function checkSlide(tool: string, index: number, html: string): void {
  const size = Buffer.byteLength(html, 'utf8')
  if (size > MAX_SLIDE_BYTES) {
    throw new Error(`${tool}: slide ${index} is ${size} bytes; the per-slide limit is ${MAX_SLIDE_BYTES} bytes`)
  }
}

/**
 * 把工具参数里的可选字段按需带上。
 *
 * `exactOptionalPropertyTypes` 下不能写 `title: undefined`：那会让"没有标题"和"标题是空串"变成两种状态。
 * @param slide - 工具参数里的页。
 * @returns 干净的 `Slide`。
 */
function slideOf(slide: { readonly html: string; readonly title?: string | undefined; readonly notes?: string | undefined }): Slide {
  return {
    html: slide.html,
    ...(slide.title === undefined ? {} : { title: slide.title }),
    ...(slide.notes === undefined ? {} : { notes: slide.notes }),
  }
}
