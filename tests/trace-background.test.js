import { beforeEach, expect, test, vi } from 'vitest'

import { createChromeMock } from './helpers/chrome.js'

let browser
let tracing

beforeEach(async () => {
  browser = createChromeMock()
  vi.stubGlobal('chrome', browser.chrome)
  vi.resetModules()
  tracing = await import('../trace-background.js')
})

test('serialises concurrent trace writes and retains only the latest 200 events', async () => {
  await Promise.all(Array.from({ length: 205 }, (_, n) => tracing.trace(`event.${n}`, { n })))
  const entries = await tracing.getTrace()
  expect(entries).toHaveLength(200)
  expect(entries[0]).toMatchObject({ event: 'event.5', details: { n: 5 } })
  expect(entries.at(-1)).toMatchObject({ event: 'event.204', details: { n: 204 } })
  expect(new Set(entries.map((entry) => entry.workerId)).size).toBe(1)
  expect(browser.storage).toEqual({})
})

test('clears queued writes before recording subsequent events', async () => {
  const first = tracing.trace('before')
  const clear = tracing.clearTrace()
  const next = tracing.trace('after')
  await Promise.all([first, clear, next])
  expect((await tracing.getTrace()).map((entry) => entry.event)).toEqual(['after'])
})

test('a failed session write does not break later tracing', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  browser.chrome.storage.session.set.mockImplementationOnce((_values, callback) => {
    browser.chrome.runtime.lastError = new Error('session write failed')
    callback()
    browser.chrome.runtime.lastError = undefined
  })
  await tracing.trace('failed')
  await tracing.trace('recovered')
  expect((await tracing.getTrace()).map((entry) => entry.event)).toEqual(['recovered'])
  expect(warn).toHaveBeenCalledOnce()
})

test('a worker restart assigns a new worker id without clearing session history', async () => {
  await tracing.trace('first.worker')
  vi.resetModules()
  const restarted = await import('../trace-background.js')
  await restarted.trace('next.worker')
  const entries = await restarted.getTrace()
  expect(entries.map((entry) => entry.event)).toEqual(['first.worker', 'next.worker'])
  expect(entries[0].workerId).not.toBe(entries[1].workerId)
})
