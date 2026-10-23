/**
 * 幻灯片 HTML 的白名单净化。
 *
 * iframe 已经开了 `sandbox`（没有 `allow-scripts`）且文档带 CSP，但 DOM 结构本身仍可能被用来
 * 破坏版面或塞入外链资源，所以内容在进 `srcdoc` 之前一律过 DOMPurify。
 */
import DOMPurify from 'dompurify'

/** 整类标签直接剥掉：脚本、嵌套文档、外链与表单。 */
export const FORBID_TAGS: readonly string[] = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'noscript',
]

/** 导航类属性：点击即离开文档，deck 里没有"链接"这回事。 */
export const FORBID_ATTR: readonly string[] = ['href', 'xlink:href']

/** 只放行内联 `data:` URI；外链图片与字体在 CSP 下也取不到，这里提前剥掉。 */
export const ALLOWED_URI_REGEXP = /^data:/i

/**
 * 净化一页的 body 片段。
 *
 * `on*` 事件属性与 `javascript:` 由 DOMPurify 的默认策略剥掉，不需要重复列出。
 * @param html - 模型给的页内容。
 * @returns 可安全放进 `srcdoc` 的片段。
 */
export function sanitizeSlideHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [...FORBID_TAGS],
    FORBID_ATTR: [...FORBID_ATTR],
    ALLOWED_URI_REGEXP,
  })
}
