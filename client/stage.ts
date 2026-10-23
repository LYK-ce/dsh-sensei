/**
 * iframe 舞台：固定 1280×720，等比放进面板容器，外加一层同尺寸的透明 canvas。
 *
 * canvas 是批注层的画布：它铺满容器（含 16:9 之外的留白），指针与绘制都按
 * {@link stageViewport} 换算到舞台坐标，所以批注层不随 iframe 的生命周期重建。
 */
import type { Slide } from '../core/deck.ts'
import { renderDocument } from '../core/document.ts'
import { STAGE_HEIGHT, STAGE_WIDTH, fitStage, stageViewport } from '../core/stage.ts'
import type { StageViewport } from '../core/stage.ts'
import { sanitizeSlideHtml } from './sanitize.ts'

/** 已经挂上的舞台；面板只在有页时持有它。 */
export interface StageHandle {
  /**
   * 换一页内容；每次都会重设 `srcdoc`（一页一个文档）。
   * @param slide - 页内容，进文档前先净化。
   * @param css - deck 级样式。
   * @returns 无。
   */
  update(slide: Slide, css: string): void
  /**
   * 舞台坐标 → canvas 像素的映射，含 devicePixelRatio。
   * @returns 当前容器的映射；容器尺寸为 0 时是占位值。
   */
  getViewport(): StageViewport
  /**
   * 订阅布局变化。canvas 的 `width/height` 每次重设都会清屏，所以重画必须在回调里做。
   * @param listener - 布局完成（canvas 已按新尺寸分配）后调用。
   * @returns 退订。
   */
  readonly onLayout: (listener: () => void) => () => void
  /**
   * 量当前页是否超出 1280×720 舞台。
   *
   * `.sensei-slide` 固定尺寸且 `overflow: hidden`，所以溢出只能从 `scrollWidth/scrollHeight`
   * 看出来：内容比舞台大时它们会超过 `clientWidth/clientHeight`，被裁掉的那部分人眼看不到。
   * @returns 已经加载好文档时是布尔值；换页中、文档还没就绪时是 undefined。
   */
  readonly overflow: () => boolean | undefined
  /** 批注层画布。 */
  readonly canvas: HTMLCanvasElement
  /** 摘掉 DOM 并停止观察容器。 */
  dispose(): void
}

/**
 * 在容器里挂一个舞台。
 *
 * 容器必须是定位元素（面板给它 `position: relative`）：舞台根节点绝对铺满，
 * 因此面板尺寸变化只会触发 `ResizeObserver`，不会改动文档流。
 * @param host - 面板给的容器。
 * @returns 舞台句柄。
 */
export function mountStage(host: HTMLElement): StageHandle {
  const root = document.createElement('div')
  root.style.cssText = 'position: absolute; inset: 0; overflow: hidden;'

  // 内层固定 1280×720，只靠 transform 缩放；这样页面里的像素值与导出尺寸全都以舞台为准。
  const frame = document.createElement('div')
  frame.style.cssText = 'position: absolute; top: 0; left: 0;'
    + ` width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px; transform-origin: 0 0;`

  const iframe = document.createElement('iframe')
  // 不开 allow-scripts：幻灯片是内容，不是应用。allow-same-origin 留给将来导出时读 contentDocument。
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.style.cssText = 'display: block; width: 100%; height: 100%; border: 0; background: #fff;'
  frame.append(iframe)

  const canvas = document.createElement('canvas')
  // 批注层吃指针：幻灯片本身是内容，不需要交互；touch-action 关掉滚动才能连续画。
  canvas.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair;'
  root.append(frame, canvas)
  host.append(root)

  /** 最近一次布局的 CSS 像素映射，iframe 的 transform 用它。 */
  let fit = fitStage(1, 1)
  /** 最近一次布局的设备像素映射；canvas backing store 与批注坐标都用它。 */
  let viewport = stageViewport(1, 1, 1)
  /** 布局完成后要重画批注层的订阅者。 */
  const layoutListeners = new Set<() => void>()

  const layout = (): void => {
    const rect = root.getBoundingClientRect()
    // 面板收起时容器会是 0×0：保留上一次的映射，别把 canvas 分配成 0。
    if (rect.width <= 0 || rect.height <= 0) return
    fit = fitStage(rect.width, rect.height)
    frame.style.transform = `translate(${fit.offsetX}px, ${fit.offsetY}px) scale(${fit.scale})`
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    viewport = stageViewport(rect.width, rect.height, dpr)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    // 重设 width/height 等于清屏：批注层必须在分配之后重画，否则会在旧内容上继续叠加，
    // 或者干脆被清成空白。
    for (const listener of layoutListeners) listener()
  }

  const observer = new ResizeObserver(layout)
  observer.observe(root)
  layout()

  return {
    update: (slide, css) => {
      // 每次换页都重设 srcDoc：一页一个文档，旧页的脚注、字体与滚动位置一律不继承。
      iframe.srcdoc = renderDocument({ html: sanitizeSlideHtml(slide.html) }, css)
    },
    getViewport: () => viewport,
    onLayout: (listener) => {
      layoutListeners.add(listener)
      return () => {
        layoutListeners.delete(listener)
      }
    },
    overflow: () => {
      const doc = iframe.contentDocument
      // 换页那一刻 srcdoc 还没落地，量出来的是上一页或空文档，宁可报"不知道"。
      if (doc === null || doc.readyState !== 'complete') return undefined
      const root = doc.querySelector('.sensei-slide')
      if (root === null) return undefined
      return root.scrollHeight > root.clientHeight || root.scrollWidth > root.clientWidth
    },
    canvas,
    dispose: () => {
      observer.disconnect()
      layoutListeners.clear()
      root.remove()
    },
  }
}
