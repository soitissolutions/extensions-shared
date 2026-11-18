import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { expect, test, vi } from 'vitest'

const source = readFileSync(new URL('../trace.js', import.meta.url), 'utf8').replace(
  /^import .* from '\.\/settings.js'\n/,
  '',
)
const event = { event: 'sync.completed', details: { reason: 'test' }, time: 1, workerId: 'abc' }

async function load(initialEntries = [event]) {
  const nodes = new Map()
  for (const id of ['h1', '#clear', '#copy', '#pause', '#refresh', '#status', '#trace']) {
    nodes.set(id, {
      textContent: '',
      scrollTop: 0,
      clientHeight: 100,
      scrollHeight: 100,
      listeners: new Map(),
      attributes: {},
      addEventListener(name, listener) {
        this.listeners.set(name, listener)
      },
      setAttribute(name, value) {
        this.attributes[name] = value
      },
    })
  }
  let entries = initialEntries
  const document = { title: '', querySelector: (selector) => nodes.get(selector) }
  const sendMessage = vi.fn((message, callback) => {
    if (message.type === 'CLEAR_DEBUG_TRACE') entries = []
    callback(message.type === 'GET_DEBUG_TRACE' ? entries : undefined)
  })
  const writeText = vi.fn(async () => {})
  let poll
  await vm.runInNewContext(`(async () => {${source}})()`, {
    document,
    chrome: {
      runtime: { sendMessage, lastError: undefined },
      i18n: { getMessage: () => 'Example extension' },
    },
    navigator: { clipboard: { writeText } },
    GET_DEBUG_TRACE_MESSAGE: 'GET_DEBUG_TRACE',
    CLEAR_DEBUG_TRACE_MESSAGE: 'CLEAR_DEBUG_TRACE',
    setInterval(callback, period) {
      expect(period).toBe(3000)
      poll = callback
    },
  })
  return {
    nodes,
    document,
    sendMessage,
    writeText,
    poll: () => poll(),
    click: (id) => nodes.get(`#${id}`).listeners.get('click')(),
  }
}

test('renders the consuming extension name, UTC events and worker details', async () => {
  const page = await load()
  expect(page.document.title).toBe('Example extension - Extensions Pro sync trace')
  expect(page.nodes.get('h1').textContent).toBe(page.document.title)
  expect(page.nodes.get('#trace').textContent).toBe(
    '1970-01-01 00:00:00.001 abc sync.completed {"reason":"test"}',
  )
  expect(page.nodes.get('#status').textContent).toContain('1 events · times UTC')
  await page.click('copy')
  expect(page.writeText).toHaveBeenCalledExactlyOnceWith(page.nodes.get('#trace').textContent)
})

test('pausing stops polling while manual refresh remains available', async () => {
  const page = await load()
  page.sendMessage.mockClear()
  await page.click('pause')
  await page.poll()
  expect(page.sendMessage).not.toHaveBeenCalled()
  expect(page.nodes.get('#pause').attributes['aria-pressed']).toBe('true')
  expect(page.nodes.get('#status').textContent).toContain('updates paused')
  await page.click('refresh')
  expect(page.sendMessage).toHaveBeenCalledExactlyOnceWith(
    { type: 'GET_DEBUG_TRACE' },
    expect.any(Function),
  )
})

test('clearing refreshes the displayed trace, including while paused', async () => {
  const page = await load()
  await page.click('pause')
  await page.click('clear')
  expect(page.nodes.get('#trace').textContent).toBe('')
  expect(page.nodes.get('#status').textContent).toContain('0 events · times UTC')
  expect(page.nodes.get('#status').textContent).toContain('updates paused')
})

test('reports unexpected background responses without displaying an invalid trace', async () => {
  const page = await load(undefined)
  page.sendMessage.mockImplementationOnce((_message, callback) =>
    callback({ error: 'unavailable' }),
  )
  const previous = page.nodes.get('#trace').textContent
  await page.click('refresh')
  expect(page.nodes.get('#status').textContent).toContain('unexpected response')
  expect(page.nodes.get('#trace').textContent).toBe(previous)
})
