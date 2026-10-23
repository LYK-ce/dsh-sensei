/** 讲演面板的文案字典。 */

/** 命名空间。 */
export const NS = 'sensei'

/** 简体中文字典，键集的事实来源。 */
export const zh = {
  'view.sensei': '讲演',
  'guide.description': '在这一栏里让 agent 讲一份现场生成的幻灯片',
  'panel.empty': '还没有幻灯片',
  'panel.emptyHint': 'agent 生成幻灯片后，它会出现在这一栏里。',
  'nav.prev': '上一页',
  'nav.next': '下一页',
  'nav.position': '第 {current} / {pages} 页',
  'tool.pen': '手绘',
  'tool.line': '直线',
  'tool.arrow': '箭头',
  'tool.rect': '矩形',
  'tool.circle': '圆',
  'tool.text': '文字',
  'tool.textPrompt': '文字内容',
  'tool.color': '颜色 {color}',
  'tool.width': '线宽 {width}',
  'action.undo': '撤销上一笔',
  'action.clearPage': '清空本页',
  'status.failed': '操作失败：{reason}',
  'status.elements': '本页有 {count} 个元素',
  'status.exporting': '正在导出…',
  'status.exportTooLarge': '这一份导出的体积超过 64 MiB，请降低 scale 后重试。',
  'status.lastExport': '最近一次导出：{path}',
} satisfies Record<string, string>

/** 讲演命名空间的键集。 */
export type SenseiKey = keyof typeof zh

/** 英文字典，按 zh 的键集校验完整性。 */
export const en = {
  'view.sensei': 'Sensei',
  'guide.description': 'Let the agent present a slide deck generated on the spot',
  'panel.empty': 'No slides yet',
  'panel.emptyHint': 'A deck appears here once the agent creates one.',
  'nav.prev': 'Previous slide',
  'nav.next': 'Next slide',
  'nav.position': 'Slide {current} of {pages}',
  'tool.pen': 'Freehand',
  'tool.line': 'Line',
  'tool.arrow': 'Arrow',
  'tool.rect': 'Rectangle',
  'tool.circle': 'Circle',
  'tool.text': 'Text',
  'tool.textPrompt': 'Text to place',
  'tool.color': 'Colour {color}',
  'tool.width': 'Stroke width {width}',
  'action.undo': 'Undo last stroke',
  'action.clearPage': 'Clear this slide',
  'status.failed': 'Failed: {reason}',
  'status.elements': 'This slide has {count} element(s)',
  'status.exporting': 'Exporting…',
  'status.exportTooLarge': 'This export would exceed 64 MiB; lower the scale and retry.',
  'status.lastExport': 'Last export: {path}',
} satisfies Record<SenseiKey, string>
