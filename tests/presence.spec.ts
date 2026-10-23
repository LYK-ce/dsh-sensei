import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PANEL_TIMEOUT_MS, PanelPresence } from '../host/presence.ts'

/** 一个可推进的假时钟，毫秒。 */
function clock(): { now: () => number; advance: (ms: number) => void } {
  let value = 0
  return { now: () => value, advance: (ms) => { value += ms } }
}

test('presence：没心跳过就不算开着', () => {
  const presence = new PanelPresence(clock().now)
  assert.equal(presence.isOpen('s' as SessionId), false)
})

test('presence：心跳在 3 秒窗口内有效，到点即关闭', () => {
  const time = clock()
  const presence = new PanelPresence(time.now)
  const sessionId = 's' as SessionId

  presence.touch(sessionId)
  assert.equal(presence.isOpen(sessionId), true)
  time.advance(PANEL_TIMEOUT_MS - 1)
  assert.equal(presence.isOpen(sessionId), true)
  time.advance(1)
  assert.equal(presence.isOpen(sessionId), false)

  // 新的心跳会重新计时。
  presence.touch(sessionId)
  assert.equal(presence.isOpen(sessionId), true)
})

test('presence：会话之间互不影响', () => {
  const time = clock()
  const presence = new PanelPresence(time.now)
  presence.touch('a' as SessionId)
  assert.equal(presence.isOpen('a' as SessionId), true)
  assert.equal(presence.isOpen('b' as SessionId), false)
})

test('overflow：没测过就不回值，测过之后按页回答', () => {
  const presence = new PanelPresence(clock().now)
  const sessionId = 's' as SessionId
  assert.equal(presence.overflowOf(sessionId, 0), undefined)

  presence.noteOverflow(sessionId, 1, true)
  assert.equal(presence.overflowOf(sessionId, 1), true)
  // 页号对不上：面板量的是第 2 页，第 1 页没有答案。
  assert.equal(presence.overflowOf(sessionId, 0), undefined)
})

test('overflow：与心跳同一个 3 秒窗口，过期后不再回值', () => {
  const time = clock()
  const presence = new PanelPresence(time.now)
  const sessionId = 's' as SessionId
  presence.noteOverflow(sessionId, 0, false)

  time.advance(PANEL_TIMEOUT_MS - 1)
  assert.equal(presence.overflowOf(sessionId, 0), false)
  time.advance(1)
  assert.equal(presence.overflowOf(sessionId, 0), undefined)
})

test('overflow：同一页的重复测量只保留最新一条', () => {
  const time = clock()
  const presence = new PanelPresence(time.now)
  const sessionId = 's' as SessionId
  presence.noteOverflow(sessionId, 0, true)
  time.advance(1_000)
  presence.noteOverflow(sessionId, 0, false)

  assert.equal(presence.overflowOf(sessionId, 0), false)
  time.advance(2_000)
  // 最新一条仍然在窗口内：计时从最后一次测量算起。
  assert.equal(presence.overflowOf(sessionId, 0), false)
})

test('overflow：会话之间互不影响', () => {
  const presence = new PanelPresence(clock().now)
  presence.noteOverflow('a' as SessionId, 0, true)
  assert.equal(presence.overflowOf('a' as SessionId, 0), true)
  assert.equal(presence.overflowOf('b' as SessionId, 0), undefined)
})
