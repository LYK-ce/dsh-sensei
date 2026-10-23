import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BASE_CSS, SLIDE_CSP, renderDocument } from '../core/document.ts'

test('骨架：doctype、utf-8、CSP meta 与 .sensei-slide 根元素', () => {
  const doc = renderDocument({ html: '<p>hello</p>' }, '')

  assert.match(doc, /^<!doctype html>/)
  assert.match(doc, /<meta charset="utf-8">/)
  assert.match(doc, /<meta http-equiv="Content-Security-Policy" content="[^"]+">/)
  assert.match(doc, /<body><div class="sensei-slide"><p>hello<\/p><\/div><\/body>/)
})

test('CSP：禁用脚本与外部资源，只放行内联样式与 data: 资源', () => {
  assert.equal(SLIDE_CSP, [
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
  ].join('; '))
  // 文档里必须真的带上它，不能只是导出常量。
  assert.ok(renderDocument({ html: '' }, '').includes(`content="${SLIDE_CSP}"`))
})

test('基样式：固定 1280×720、border-box、裁切与默认字体栈', () => {
  assert.match(BASE_CSS, /\.sensei-slide\s*\{/)
  assert.match(BASE_CSS, /width:\s*1280px/)
  assert.match(BASE_CSS, /height:\s*720px/)
  assert.match(BASE_CSS, /box-sizing:\s*border-box/)
  assert.match(BASE_CSS, /overflow:\s*hidden/)
  assert.match(BASE_CSS, /font-family:/)
  // 版面不能挂在 body 上：导出的 foreignObject 里 html/body 规则不生效。
  assert.doesNotMatch(BASE_CSS, /body\s*\{[^}]*width:/)
})

test('deck css 拼在基样式之后，页内容落在根元素里', () => {
  const css = '.sensei-slide { background: #0b0b0b }'
  const doc = renderDocument({ html: '<h1>标题</h1>' }, css)

  const style = doc.slice(doc.indexOf('<style>'), doc.indexOf('</style>'))
  assert.ok(style.startsWith(`<style>${BASE_CSS}`), '基样式必须在最前')
  assert.ok(style.endsWith(css), 'deck css 必须拼在基样式之后')
  assert.ok(doc.includes('<div class="sensei-slide"><h1>标题</h1></div>'))
})

test('渲染是纯拼接：空 css 与空 html 也给出完整文档', () => {
  const doc = renderDocument({ html: '' }, '')
  assert.ok(doc.includes(`<style>${BASE_CSS}</style>`), '空 deck css 时 style 里只剩基样式')
  assert.ok(doc.endsWith('</html>\n'))
  assert.equal(doc, renderDocument({ html: '' }, ''))
})
