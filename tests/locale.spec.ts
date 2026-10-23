// 中英两本字典的键集由类型保证，但占位符是字符串内容，类型看不见：少一个 `{path}` 的英文
// 文案会在运行时把路径整个吞掉，界面上看不出错，只是信息没了。本 spec 只做这一件事。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en, zh } from '../client/locale.ts'
import type { SenseiKey } from '../client/locale.ts'

/**
 * 抽出一段文案里的占位符名。
 * @param text - 文案。
 * @returns 排序后的占位符名，重复项保留。
 */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()
}

test('locale：中英键集一致，且没有空文案', () => {
  assert.deepEqual(Object.keys(zh).toSorted(), Object.keys(en).toSorted())
  for (const [key, value] of Object.entries(zh)) {
    assert.notEqual(value.trim(), '', `zh.${key} 是空文案`)
    assert.notEqual(en[key as SenseiKey].trim(), '', `en.${key} 是空文案`)
  }
})

test('locale：同一键在两本字典里的占位符完全一致', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.deepEqual(
      placeholders(en[key as SenseiKey]),
      placeholders(value),
      `${key} 的中英占位符不一致`,
    )
  }
})

test('locale：本里程碑新增的两个无障碍名称与导出体积文案都在', () => {
  for (const key of ['tool.color', 'tool.width', 'status.exportTooLarge'] as const) {
    assert.ok(Object.hasOwn(zh, key), `zh 缺 ${key}`)
    assert.ok(Object.hasOwn(en, key), `en 缺 ${key}`)
  }
  assert.deepEqual(placeholders(zh['tool.color']), ['color'])
  assert.deepEqual(placeholders(zh['tool.width']), ['width'])
})
