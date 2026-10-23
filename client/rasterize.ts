/**
 * 把一页幻灯片栅格化成 PNG：内容层走 SVG foreignObject，批注层走 canvas。
 *
 * 这段只能在浏览器里跑（`Image` 解码 data URI、canvas 出图），所以 core 里只留
 * {@link buildExportSvg} 那半段纯字符串拼接。
 *
 * 三个实测坑（DESIGN §10）都在这里落地：
 * 1. `innerHTML` 不是合法 XML，必须经 `XMLSerializer`；出图之前先用 `DOMParser` 校验。
 * 2. `blob:` URL 会让 canvas 变 tainted，只能用 `data:`。
 * 3. 导出前等 `fonts.ready`，否则版面按回退字体量，整页错位。
 */
import { STAGE_HEIGHT, STAGE_WIDTH } from '../core/stage.ts'
import { buildExportSvg } from '../core/export-svg.ts'
import { renderDocument } from '../core/document.ts'
import { render } from '../vendor/dsh-blackboard/core/render.ts'
import type { Scene } from '../vendor/dsh-blackboard/core/scene.ts'
import { sanitizeSlideHtml } from './sanitize.ts'

/** 离屏 iframe 的样式：留在文档流之外，但仍然完成布局（`display: none` 不会排版）。 */
const OFFSCREEN = `position: fixed; left: -10000px; top: 0; width: ${STAGE_WIDTH}px; height: ${STAGE_HEIGHT}px;`
  + ' border: 0; visibility: hidden;'

/** 一页已加载好的离屏内容层。 */
export interface SlideDocument {
  /** 同源文档；读它的 `body` 即可拿到净化后的页内容。 */
  readonly doc: Document
  /** 摘掉离屏 iframe。 */
  dispose(): void
}

/**
 * 在离屏 iframe 里加载一页，等它 load 完、字体就绪。
 *
 * 用独立 iframe 而不是面板里那个可见舞台：导出要逐页换文档，借用可见舞台会让用户看着
 * 面板闪 60 次；离屏 iframe 之间互不影响，也不会打断正在进行的批注手势。
 * @param html - 模型给的页内容，进文档前先净化。
 * @param css - deck 级样式。
 * @returns 已就绪的文档与清理函数。
 */
export async function openSlideDocument(html: string, css: string): Promise<SlideDocument> {
  const frame = document.createElement('iframe')
  // 与可见舞台同一个 sandbox：即便净化漏了什么，也执行不了脚本。
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.style.cssText = OFFSCREEN
  const loaded = new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => { resolve() }, { once: true })
    frame.addEventListener('error', () => {
      reject(new Error('sensei: the offscreen slide document failed to load'))
    }, { once: true })
  })
  frame.srcdoc = renderDocument({ html: sanitizeSlideHtml(html) }, css)
  document.body.append(frame)
  await loaded
  const doc = frame.contentDocument
  if (doc === null) throw new Error('sensei: the offscreen slide document is not same-origin')
  // 字体没就绪就出图会用回退字体量版面，整页文字错位（DESIGN §10 第 3 条）。
  await doc.fonts.ready
  return { doc, dispose: () => { frame.remove() } }
}

/** 一次栅格化的输入。 */
export interface RasterizeOptions {
  /** 内容层文档，通常来自 {@link openSlideDocument}。 */
  readonly doc: Document
  /** deck 级样式；文档里有，SVG 里要再写一遍。 */
  readonly css: string
  /** 缩放倍数。 */
  readonly scale: number
  /** 批注层；传了才叠（快照要叠，导出不叠）。 */
  readonly scene?: Scene
}

/**
 * 把一页栅格化成 PNG。
 * @param options - 内容层文档、样式、倍率与可选批注层。
 * @returns PNG。
 * @throws Error SVG 不是合法 XML、浏览器解码失败，或 canvas 交不出 PNG 时抛出。
 */
export async function rasterizeSlide(options: RasterizeOptions): Promise<Blob> {
  const svg = buildExportSvg({ body: serializeBody(options.doc), css: options.css, scale: options.scale })
  // 坏 XML 交给 Image 只会得到一句 "cannot be decoded"，读不出坏在哪；先自己校验一次。
  if (new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length > 0) {
    throw new Error('sensei: the export SVG is not well-formed XML')
  }

  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const width = Math.round(STAGE_WIDTH * options.scale)
  const height = Math.round(STAGE_HEIGHT * options.scale)
  const canvas = options.doc.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = context2d(canvas)
  // 可见舞台的 iframe 是白底；透明幻灯片导出后不该取决于读图软件的默认背景。
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  if (options.scene !== undefined) drawAnnotations(ctx, options.doc, options.scene, width, height, options.scale)
  return await toPng(canvas)
}

/**
 * 打开一页、栅格化、再关掉离屏 iframe。
 *
 * 调用方（面板）只关心"给我这张图"，离屏文档的生命周期留在这里，异常路径也不会漏掉清理。
 * @param html - 模型给的页内容。
 * @param css - deck 级样式。
 * @param scale - 缩放倍数。
 * @param scene - 批注层；传了才叠。
 * @returns PNG。
 */
export async function rasterizePage(html: string, css: string, scale: number, scene?: Scene): Promise<Blob> {
  const opened = await openSlideDocument(html, css)
  try {
    return await rasterizeSlide({
      doc: opened.doc,
      css,
      scale,
      ...(scene === undefined ? {} : { scene }),
    })
  } finally {
    opened.dispose()
  }
}

/**
 * 把内容层 DOM 序列化成合法 XML。
 *
 * `innerHTML` 会保留 `<br>` 这种 HTML 写法，塞进 SVG 就解析失败了；`XMLSerializer` 输出 `<br />`。
 * 外层 div 是 DESIGN §10 的写法：让 `.sensei-slide` 保持为最外层带版面的元素。
 * @param doc - 内容层文档。
 * @returns 可嵌入 foreignObject 的 XML 片段。
 */
function serializeBody(doc: Document): string {
  const holder = doc.createElement('div')
  holder.innerHTML = doc.body.innerHTML
  return new XMLSerializer().serializeToString(holder)
}

/**
 * 叠批注层。
 *
 * `render` 会先清空整块画布，所以不能直接画在内容图上；先画到同尺寸的透明 canvas，再整张盖上去。
 * @param target - 已画出内容层的上下文。
 * @param doc - 用来建 canvas 的文档。
 * @param scene - 批注场景。
 * @param width - 目标宽度，设备像素。
 * @param height - 目标高度，设备像素。
 * @param scale - 舞台坐标到设备像素的倍率。
 * @returns 无。
 */
function drawAnnotations(
  target: CanvasRenderingContext2D,
  doc: Document,
  scene: Scene,
  width: number,
  height: number,
  scale: number,
): void {
  const overlay = doc.createElement('canvas')
  overlay.width = width
  overlay.height = height
  render(context2d(overlay), scene, { scale, offsetX: 0, offsetY: 0 })
  target.drawImage(overlay, 0, 0)
}

/**
 * 取 canvas 的 2D 上下文。
 * @param canvas - 目标 canvas。
 * @returns 它的 2D 上下文。
 * @throws Error 浏览器给不出 2D 上下文时抛出。
 */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('sensei: the browser returned no 2D context')
  return ctx
}

/**
 * 把 SVG 的 data URI 解码成图片。
 *
 * 只能是 `data:`：`blob:` 会让随后画上去的 canvas 变 tainted，`toBlob` 直接抛 SecurityError。
 * @param url - data URI。
 * @returns 已解码的图片。
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => { resolve(image) }, { once: true })
    image.addEventListener('error', () => {
      reject(new Error('sensei: the browser could not decode the slide image'))
    }, { once: true })
    image.src = url
  })
}

/**
 * 把 canvas 导出成 PNG。
 * @param canvas - 已画好的画布。
 * @returns PNG。
 */
function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('sensei: the canvas produced no PNG'))
      else resolve(blob)
    }, 'image/png')
  })
}
