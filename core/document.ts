/**
 * 幻灯片文档骨架：把一页 `Slide` 包成完整的 HTML 文档。
 *
 * iframe 的 `srcDoc` 与将来导出时的 foreignObject 都用这一个函数，两边版面才会一致。
 * 根元素必须是 `.sensei-slide`：导出时内容是包进 `<div>` 再塞 foreignObject 的，
 * `html, body` 上的版面规则不会生效。
 */
import type { Slide } from './deck.ts'

/** 内容安全策略：无脚本、无外链，样式与内联数据图放行。 */
export const SLIDE_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * 固定基样式：1280×720 舞台、默认字体栈、无边距。
 *
 * deck 级 css 拼在它后面，所以 agent 给的样式可以覆盖这里的任何声明。
 */
export const BASE_CSS = `.sensei-slide {
  width: 1280px;
  height: 720px;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
html, body {
  margin: 0;
  padding: 0;
  background: transparent;
}
`

/**
 * 把一页幻灯片包成完整文档。
 *
 * 只接收已经净化过的 HTML：净化需要 DOM，属于浏览器半边（`client/sanitize.ts`），
 * 这里保持纯字符串拼接，host 侧也能拿去算字节数。
 * @param slide - 页内容；只用到 `html`。
 * @param css - deck 级样式，直接拼在基样式之后。
 * @returns 可直接作为 `srcdoc` 的文档。
 */
export function renderDocument(slide: Pick<Slide, 'html'>, css: string): string {
  return '<!doctype html>\n'
    + '<html><head><meta charset="utf-8">\n'
    + `<meta http-equiv="Content-Security-Policy" content="${SLIDE_CSP}">\n`
    + `<style>${BASE_CSS}${css}</style>\n`
    + `</head><body><div class="sensei-slide">${slide.html}</div></body></html>\n`
}
