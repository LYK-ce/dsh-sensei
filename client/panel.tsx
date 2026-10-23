import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 类型专用：'sidebar.right.pane.tab' 的 SlotMap 行与会话作用域标准位必须在程序里。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { DEFAULT_ANNOTATE_STYLE } from '../core/annotate.ts'
import type { AnnotateStyle, AnnotateTool } from '../core/annotate.ts'
import type { ExportRequest, SnapshotRequest } from '../shared/protocol.ts'
import { PALETTE } from '../vendor/dsh-blackboard/core/commands.ts'
import type { DrawCommand } from '../vendor/dsh-blackboard/core/commands.ts'
import { createScene } from '../vendor/dsh-blackboard/core/scene.ts'
import type { Scene } from '../vendor/dsh-blackboard/core/scene.ts'
import { mountAnnotator } from './annotator.ts'
import type { AnnotateHandle } from './annotator.ts'
import type { SenseiKey } from './locale.ts'
import { mountStage } from './stage.ts'
import type { StageHandle } from './stage.ts'
import type { DeckSource, OverflowProbe } from './source.ts'

/** 讲演视图的注入面：面板私有的 deck 源，加翻页、批注与两条面板产出动作。 */
export interface SenseiInjected {
  /** 面板私有的可观察源；框架把它绑成 `useDeck`。 */
  hooks: { deck: DeckSource }
  /**
   * 翻到某一页。
   * @param index - 0-based 页号。
   * @returns 提交完成；失败时面板把原因写进状态行。
   */
  show: (index: number) => Promise<void>
  /**
   * 在面板当前显示的那一页画一批命令。
   * @param commands - 绘图命令。
   * @param slide - 面板显示的那一页，0-based；随命令一起提交，避免同一拍翻页把笔迹带到新页。
   * @returns 提交完成；失败时面板把原因写进状态行。
   */
  draw: (commands: readonly DrawCommand[], slide: number) => Promise<void>
  /**
   * 为 host 的一次出图请求产出 PNG 并交回。
   * @param request - 目标页与请求 id。
   * @returns 交回完成；失败时 host 的工具会超时，面板同时把原因写进状态行。
   */
  snapshot: (request: SnapshotRequest) => Promise<void>
  /**
   * 为 host 的一次导出请求逐页栅格化并交回。
   * @param request - 页数、倍率与请求 id。
   * @returns 交回完成；失败时面板把原因写进状态行。
   */
  exportDeck: (request: ExportRequest) => Promise<void>
  /**
   * 注册当前页溢出测量的取数函数；deck 源每次轮询前调用它。
   *
   * 舞台与它的 iframe 都在面板手里，源量不到版面，所以测量必须由面板交出去。
   * @param probe - 返回当前页的测量；舞台没挂载或文档没就绪时返回 undefined。
   * @returns 无。
   */
  setOverflowProbe: (probe: (() => OverflowProbe | undefined) | undefined) => void
}

/** 讲演视图的完整 props：运行时份额 + 注入面 + 文案位。 */
export type SenseiPanelProps = PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<SenseiInjected>
  & PropsLocale<'sensei'>

/**
 * 面板的内联样式。
 *
 * 这个自建打包不含 dsh 仓库的样式注入（没有 CSS Modules），所以样式只走内联 style
 * 与 `--dsw-*` 变量。
 */
const ROOT: CSSProperties = {
  display: 'flex',
  // 侧栏的 panelBody 是 row 方向的 flex 容器，根节点得自己撑开宽高（终端同理）。
  flex: '1 1 auto',
  flexDirection: 'column',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  background: 'var(--dsw-alias-bg-base, #ffffff)',
  color: 'var(--dsw-alias-label-primary, #1e1e1e)',
  font: 'inherit',
}

/** 导航条：翻页按钮与页号，翻页期间禁用防连点。 */
const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e5e5)',
}

/** 导航按钮与工具按钮共用。 */
const BUTTON: CSSProperties = {
  minWidth: 28,
  height: 26,
  padding: '0 8px',
  cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-2, #f7f7f7)',
  color: 'inherit',
  font: 'inherit',
}

/** 页号：等宽，翻页时不抖动。 */
const POSITION: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

/** 舞台容器：留给绝对定位的 iframe 与批注层。 */
const STAGE: CSSProperties = {
  position: 'relative',
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--dsw-alias-bg-layer-2, #f2f2f2)',
}

/** 工具条：示例见 DESIGN §9，挨着舞台下沿。 */
const TOOLBAR: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  borderTop: '1px solid var(--dsw-alias-border-l1, #e5e5e5)',
}

/** 幻灯片标题：模型给的正文，只能是数据，不参与排版决策。 */
const TITLE: CSSProperties = {
  marginLeft: 'auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  opacity: 0.75,
}

/** 空状态。 */
const EMPTY: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: '100%',
  padding: 24,
  boxSizing: 'border-box',
  textAlign: 'center',
  color: 'var(--dsw-alias-text-secondary, #666)',
  font: 'inherit',
}

/** 空状态标题：比提示语重一档，仍沿用面板自带的字号。 */
const EMPTY_TITLE: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--dsw-alias-text-primary, inherit)',
}

/** 状态行：只在失败时出现。 */
const STATUS: CSSProperties = {
  padding: '4px 8px',
  borderTop: '1px solid var(--dsw-alias-border-l1, #e5e5e5)',
  opacity: 0.8,
}

/** 元素计数：贴工具条右侧，不抢按钮。 */
const ELEMENTS: CSSProperties = {
  marginLeft: 'auto',
  opacity: 0.7,
  whiteSpace: 'nowrap',
}

/** 六支工具；字形是通用绘图符号，不是文案。 */
const TOOLS: readonly { readonly tool: AnnotateTool; readonly glyph: string; readonly key: SenseiKey }[] = [
  { tool: 'pen', glyph: '✎', key: 'tool.pen' },
  { tool: 'line', glyph: '╱', key: 'tool.line' },
  { tool: 'arrow', glyph: '↗', key: 'tool.arrow' },
  { tool: 'rect', glyph: '▭', key: 'tool.rect' },
  { tool: 'circle', glyph: '◯', key: 'tool.circle' },
  { tool: 'text', glyph: 'T', key: 'tool.text' },
]

/** 线宽预设，舞台单位。 */
const WIDTHS: readonly number[] = [2, 4, 8]

/**
 * 把任意抛出物折成一行文字。
 * @param error - 捕获到的值，可能是任何东西。
 * @returns `Error` 取它的 message，其余走 `String()`。
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 会话作用域的讲演面板：导航条 + 固定舞台 + 批注工具条。
 *
 * 舞台只在有页时挂载，卸载即 dispose；换页只重设 `srcdoc`，不重建 iframe 容器。
 * 批注层跟着舞台挂载，页数据变了只重画它，不重建 canvas。
 * @param props - 框架给的运行时份额、注入面与 `t`。
 * @returns 面板元素。
 */
export function SenseiPanel({ t, useDeck, show, draw, snapshot, exportDeck, setOverflowProbe }: SenseiPanelProps): JSX.Element {
  const view = useDeck((value) => value)
  const deck = view.deck
  const [style, setStyle] = useState<AnnotateStyle>(DEFAULT_ANNOTATE_STYLE)
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)
  const stage = useRef<StageHandle | null>(null)
  const annotator = useRef<AnnotateHandle | null>(null)
  const pages = deck.slides.length
  const slide = deck.slides[deck.current]
  const hasSlide = slide !== undefined
  const scene: Scene = deck.annotations[deck.current] ?? createScene()
  /** 已经处理过的请求 id：缺口重拉会把同一个请求再发一遍，重复栅格化没有意义。 */
  const handled = useRef({ snapshot: '', export: '' })
  /** 产出动作的最新引用：effect 只按请求 id 触发，不该因为注入面重建而重跑。 */
  const actions = useRef({ snapshot, exportDeck })
  /** 溢出测量读这两份最新值，避免为了翻页重挂取数函数。 */
  const live = useRef({ slide: deck.current, stage })

  useEffect(() => {
    actions.current = { snapshot, exportDeck }
    live.current = { slide: deck.current, stage }
  })

  // 取数函数只注册一次：它读 live.current，翻页与重挂舞台都不需要换一个函数。
  useEffect(() => {
    setOverflowProbe(() => {
      const mounted = live.current.stage.current
      if (mounted === null) return undefined
      const overflow = mounted.overflow()
      if (overflow === undefined) return undefined
      const measurement: OverflowProbe = { slide: live.current.slide, overflow }
      return measurement
    })
    return () => { setOverflowProbe(undefined) }
  }, [setOverflowProbe])

  /**
   * host 要一张快照就栅格化目标页。失败只写状态行：让这里抛出去会变成未捕获 rejection，
   * 而 host 侧看到的是超时，状态行是唯一能说清原因的地方。
   * @returns 无。
   */
  useEffect(() => {
    const request = view.snapshotRequest
    if (request === null || handled.current.snapshot === request.id) return
    handled.current.snapshot = request.id
    void actions.current.snapshot(request).then(
      () => undefined,
      (error: unknown) => { setStatus(t('status.failed', { reason: describe(error) })) },
    )
  }, [view.snapshotRequest, t])

  /**
   * host 要导出就逐页栅格化并交回；导出的结果路径由 `exported` op 回到本地 deck。
   * @returns 无。
   */
  useEffect(() => {
    const request = view.exportRequest
    if (request === null || handled.current.export === request.id) return
    handled.current.export = request.id
    setStatus(t('status.exporting'))
    void actions.current.exportDeck(request).then(
      () => { setStatus('') },
      (error: unknown) => { setStatus(t('status.failed', { reason: describe(error) })) },
    )
  }, [view.exportRequest, t])

  /**
   * 提交一批命令，带上这一笔落下时面板显示的页。
   *
   * 页号读的是这一帧的 `deck.current`：`submit` 每次渲染重建，手势用的就是最新的闭包。
   * 失败只写状态行：批注没有乐观更新可回滚，而漏掉这条会让"画一笔"变成控制台里的
   * 未捕获 rejection。
   * @param commands - 要提交的命令。
   * @returns 无。
   */
  const submit = (commands: readonly DrawCommand[]): void => {
    setStatus('')
    void draw(commands, deck.current).then(
      () => undefined,
      (error: unknown) => { setStatus(t('status.failed', { reason: describe(error) })) },
    )
  }

  /** 画布回调读这一份，避免每次改工具都重挂批注层。 */
  const latest = useRef({
    style,
    submit,
    prompt: t('tool.textPrompt'),
  })

  useEffect(() => {
    latest.current = { style, submit, prompt: t('tool.textPrompt') }
  })

  useEffect(() => {
    const container = host.current
    if (!hasSlide || container === null) return undefined
    const stageHandle = mountStage(container)
    stage.current = stageHandle
    const annotateHandle = mountAnnotator({
      canvas: stageHandle.canvas,
      viewport: stageHandle.getViewport,
      onLayout: stageHandle.onLayout,
      style: () => latest.current.style,
      askText: () => window.prompt(latest.current.prompt),
      onCommand: (command) => { latest.current.submit([command]) },
    })
    annotator.current = annotateHandle
    return () => {
      annotator.current = null
      annotateHandle.dispose()
      stage.current = null
      stageHandle.dispose()
    }
  }, [hasSlide])

  useEffect(() => {
    if (slide === undefined) return
    stage.current?.update(slide, deck.css)
  }, [slide, deck.css])

  // 批注层与 iframe 无关：换页只是换一个场景重画，canvas 不重建。
  useEffect(() => {
    annotator.current?.update(scene)
  }, [scene])

  /**
   * 请求翻页。失败只写状态行：面板没有乐观更新可回滚，而漏掉这条会让一次点击变成
   * 控制台里的未捕获 rejection。
   * @param index - 0-based 目标页。
   * @returns 无。
   */
  const go = (index: number): void => {
    if (pending) return
    setPending(true)
    setStatus('')
    void show(index).then(
      () => { setPending(false) },
      (error: unknown) => {
        setPending(false)
        setStatus(t('status.failed', { reason: describe(error) }))
      },
    )
  }

  /**
   * 撤销本页最后一个可见元素。
   *
   * id 从本地已折叠的 deck 里挑，与 host 有一拍竞态：要是别人刚删掉它，这条 patch 会在
   * `applyOps` 里找不到目标而被丢弃，不会画到别处。host 侧"撤销最后一个"会超出 DESIGN 的
   * 命令词汇，所以不采用。
   * @returns 无。
   */
  const undo = (): void => {
    const last = [...scene.elements].reverse().find((element) => !element.isDeleted)
    if (last === undefined) return
    submit([{ op: 'erase', ids: [last.id] }])
  }

  if (pages === 0) {
    return (
      <div style={ROOT} role="region" aria-label={t('view.sensei')}>
        <div style={EMPTY}>
          <div style={EMPTY_TITLE}>{t('panel.empty')}</div>
          <div>{t('panel.emptyHint')}</div>
        </div>
      </div>
    )
  }

  const elements = scene.elements.reduce((count, element) => (element.isDeleted ? count : count + 1), 0)
  // 状态行平时显示最近一次导出的落点：那是 agent 与人都需要的一个事实，而不是一次性的提示。
  const note = status !== ''
    ? status
    : deck.lastExport === undefined ? '' : t('status.lastExport', { path: deck.lastExport })

  return (
    <div style={ROOT} role="region" aria-label={t('view.sensei')}>
      <div style={BAR}>
        <button
          type="button"
          title={t('nav.prev')}
          aria-label={t('nav.prev')}
          disabled={pending || deck.current <= 0}
          onClick={() => { go(deck.current - 1) }}
          style={BUTTON}
        >
          ‹
        </button>
        <span style={POSITION}>{t('nav.position', { current: deck.current + 1, pages })}</span>
        <button
          type="button"
          title={t('nav.next')}
          aria-label={t('nav.next')}
          disabled={pending || deck.current >= pages - 1}
          onClick={() => { go(deck.current + 1) }}
          style={BUTTON}
        >
          ›
        </button>
        {slide?.title === undefined ? null : <span style={TITLE}>{slide.title}</span>}
      </div>
      <div ref={host} style={STAGE} />
      <div style={TOOLBAR}>
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            type="button"
            title={t(entry.key)}
            aria-pressed={style.tool === entry.tool}
            onClick={() => { setStyle({ ...style, tool: entry.tool }) }}
            style={BUTTON}
          >
            {entry.glyph}
          </button>
        ))}
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            title={t('tool.color', { color })}
            aria-label={t('tool.color', { color })}
            aria-pressed={style.color === color}
            onClick={() => { setStyle({ ...style, color }) }}
            style={{ ...BUTTON, background: color, padding: 0 }}
          />
        ))}
        {WIDTHS.map((width) => (
          <button
            key={width}
            type="button"
            title={t('tool.width', { width })}
            aria-label={t('tool.width', { width })}
            aria-pressed={style.width === width}
            onClick={() => { setStyle({ ...style, width }) }}
            style={BUTTON}
          >
            {String(width)}
          </button>
        ))}
        <button type="button" onClick={undo} style={BUTTON}>{t('action.undo')}</button>
        <button type="button" onClick={() => { submit([{ op: 'clear' }]) }} style={BUTTON}>
          {t('action.clearPage')}
        </button>
        <span style={ELEMENTS}>{t('status.elements', { count: elements })}</span>
      </div>
      {note === '' ? null : <div style={STATUS}>{note}</div>}
    </div>
  )
}
