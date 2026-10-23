/**
 * 导出栅格化用的 SVG：把一页内容层包进 foreignObject，交给浏览器的 `Image` 解码。
 *
 * 这里只做字符串拼接，不碰 DOM：DOM 那一半（`<br>` → `<br />` 的 XMLSerializer、字体就绪）
 * 只在浏览器里做得到，见 `client/rasterize.ts`。拆开的好处是产物能被严格 XML 解析器单测。
 */
import { BASE_CSS, SLIDE_CSP } from './document.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from './stage.ts'

/** 一次栅格化的输入。 */
export interface ExportSvgOptions {
  /** 已由 XMLSerializer 序列化的内容层（含 `.sensei-slide` 根节点）。 */
  readonly body: string
  /** deck 级 css，拼在 {@link BASE_CSS} 之后。 */
  readonly css: string
  /** 缩放倍数；1 即 1280×720。 */
  readonly scale: number
}

/**
 * 生成一张可被 `<img src="data:image/svg+xml,...">` 解码的 SVG。
 *
 * 三条硬约束，对应 DESIGN §10 的实测结论：
 * 1. 尺寸写在 `width/height`，`viewBox` 固定 1280×720 —— 于是缩放交给位图，版面像素值不变。
 * 2. 根 div 必须带 XHTML 命名空间，否则 foreignObject 里的内容不按 HTML 排版。
 * 3. CSS 与 CSP 是文本节点：`&`、`<` 必须转义，不然整份 SVG 直接解析失败。
 * @param options - 内容、样式与倍率。
 * @returns 单行 SVG 文本。
 */
export function buildExportSvg(options: ExportSvgOptions): string {
  const width = STAGE_WIDTH * options.scale
  const height = STAGE_HEIGHT * options.scale
  return '<svg xmlns="http://www.w3.org/2000/svg"'
    + ` width="${String(width)}" height="${String(height)}"`
    + ` viewBox="0 0 ${String(STAGE_WIDTH)} ${String(STAGE_HEIGHT)}">`
    + `<foreignObject x="0" y="0" width="${String(STAGE_WIDTH)}" height="${String(STAGE_HEIGHT)}">`
    + '<div xmlns="http://www.w3.org/1999/xhtml"'
    + ` style="width:${String(STAGE_WIDTH)}px;height:${String(STAGE_HEIGHT)}px;overflow:hidden">`
    // 与 iframe 文档同一条 CSP：能加载的资源集合必须一致，否则同一页在舞台与导出里会显示不同内容。
    + `<meta http-equiv="Content-Security-Policy" content="${escapeXml(SLIDE_CSP)}"/>`
    + `<style>${escapeXml(`${BASE_CSS}${options.css}`)}</style>`
    + options.body
    + '</div></foreignObject></svg>'
}

/**
 * 转义 XML 文本节点里的三个字符。
 *
 * 只转义这三个：`"` 与 `'` 在文本节点里合法，转义反而会把 CSS 里的引号变成实体字面量。
 * @param text - 待转义文本。
 * @returns 可安全放进元素内容的文本。
 */
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
