import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { BASE_CSS, SLIDE_CSP } from '../core/document.ts'
import { buildExportSvg } from '../core/export-svg.ts'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../core/stage.ts'

/**
 * 造一个 jsdom 窗口：单测要的是浏览器那套 `XMLSerializer`/`DOMParser`，而不是手写字符串。
 * @returns jsdom 的 window。
 */
function browser(): JSDOM['window'] {
  return new JSDOM('<!doctype html><html><body><div id="holder"></div></body></html>').window
}

/**
 * 按 DESIGN §10 的做法序列化一段内容层 HTML。
 * @param window - jsdom 窗口。
 * @param html - `.sensei-slide` 包着的内容。
 * @returns XMLSerializer 的产物。
 */
function serialize(window: JSDOM['window'], html: string): string {
  const holder = window.document.getElementById('holder')
  if (holder === null) throw new Error('test fixture is missing its holder')
  holder.innerHTML = html
  return new window.XMLSerializer().serializeToString(holder)
}

test('buildExportSvg：以 svg 根开头，可被严格 XML 解析，尺寸随倍率而 viewBox 固定', () => {
  const window = browser()
  const svg = buildExportSvg({ body: serialize(window, '<p>hello<br>world</p>'), css: '', scale: 1.5 })

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), svg.slice(0, 60))
  assert.match(svg, new RegExp(` width="${String(STAGE_WIDTH * 1.5)}" height="${String(STAGE_HEIGHT * 1.5)}"`))
  assert.match(svg, /viewBox="0 0 1280 720"/)

  // 严格 XML 解析：畸形 XML 会产出 parsererror，正常 SVG 一条都没有。
  const doc = new window.DOMParser().parseFromString(svg, 'image/svg+xml')
  assert.equal(doc.getElementsByTagName('parsererror').length, 0)
  assert.equal(doc.documentElement.localName, 'svg')
  assert.equal(doc.documentElement.getAttribute('width'), '1920')
  assert.equal(doc.documentElement.getAttribute('height'), '1080')
})

test('buildExportSvg：<br> 经 XMLSerializer 变成自闭合标签', () => {
  const window = browser()
  const body = serialize(window, '<p>a<br>b</p>')
  assert.match(body, /<br \/>/)

  const svg = buildExportSvg({ body, css: '', scale: 1 })
  assert.match(svg, /<br \/>/)
  assert.doesNotMatch(svg, /<br>/)
})

test('buildExportSvg：样式里带 BASE_CSS、deck css 与同一条 CSP', () => {
  const window = browser()
  const svg = buildExportSvg({
    body: serialize(window, '<p>a</p>'),
    css: '.title { color: #123456 }',
    scale: 1,
  })

  assert.match(svg, /<style>/)
  assert.ok(svg.includes('.sensei-slide'))
  assert.ok(svg.includes(BASE_CSS))
  assert.ok(svg.includes('.title { color: #123456 }'))
  assert.ok(svg.includes(SLIDE_CSP))
  assert.equal(new window.DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length, 0)
})

test('buildExportSvg：css 里的 & 与 < 被转义后仍然解析通过', () => {
  const window = browser()
  const css = '.a::after { content: "a<b&c" } .b > .c { margin: 0 }'
  const svg = buildExportSvg({ body: serialize(window, '<p>a</p>'), css, scale: 2 })

  assert.ok(svg.includes('a&lt;b&amp;c'))
  assert.equal(new window.DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length, 0)
})
