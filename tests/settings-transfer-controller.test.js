import { beforeEach, expect, test, vi } from 'vitest'

import { boolean } from '../settings-schema.js'
import { createSettingsTransfer } from '../settings-transfer.js'
import { createSettingsTransferController } from '../settings-transfer-controller.js'

const transfer = createSettingsTransfer({
  extensionId: 'example',
  schemaVersion: 1,
  schema: { feature: boolean() },
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '1.2.3' }), openOptionsPage: vi.fn() },
  })
  vi.stubGlobal('window', { close: vi.fn(), open: vi.fn() })
  vi.stubGlobal('navigator', { canShare: vi.fn(() => true), share: vi.fn(async () => {}) })
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:backup'), revokeObjectURL: vi.fn() })
  vi.stubGlobal('requestIdleCallback', (callback) => callback())
})

function element() {
  const listeners = new Map()
  return {
    listeners,
    click: vi.fn(),
    value: '',
    disabled: false,
    files: [],
    addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name) => listeners.delete(name)),
  }
}

function load(options = {}) {
  const fileInput = element()
  const anchor = element()
  fileInput.ownerDocument = { createElement: () => anchor }
  const importButton = element(),
    exportButton = element()
  const readSettings = vi.fn(async () => ({ feature: false }))
  const writeSettings = vi.fn(async () => {})
  const onImportResult = vi.fn(),
    onExportError = vi.fn()
  const controller = createSettingsTransferController({
    transfer,
    filenamePrefix: 'example',
    browser: 'chrome',
    fileInput,
    importButton,
    exportButton,
    readSettings,
    writeSettings,
    onImportResult,
    onExportError,
    ...options,
  })
  return {
    controller,
    fileInput,
    anchor,
    importButton,
    exportButton,
    readSettings,
    writeSettings,
    onImportResult,
    onExportError,
    async import(input) {
      fileInput.files = [{ text: async () => JSON.stringify(input) }]
      return controller.importSettings()
    },
  }
}

test('exports only the supplied stored settings with the product id, filename and version', async () => {
  const page = load()
  await page.controller.exportSettings()
  const blob = URL.createObjectURL.mock.calls[0][0]
  expect(JSON.parse(await blob.text())).toEqual({
    extensionId: 'example',
    schemaVersion: 1,
    version: '1.2.3',
    settings: { feature: false },
  })
  expect(page.anchor.download).toBe('example-v1.2.3-settings.json')
  expect(page.anchor.click).toHaveBeenCalledOnce()
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:backup')
})

test('successful import preserves non-blocking validation diagnostics', async () => {
  const tolerant = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema: { feature: boolean() },
    ignoreUnknown: true,
  })
  const page = load({ transfer: tolerant })
  const result = await page.import(
    tolerant.createSettingsExport({ feature: false, old: true }, '1.2.3'),
  )
  expect(result).toEqual({ success: true, issues: [{ code: 'unknownSettings', detail: 'old' }] })
  expect(page.writeSettings).toHaveBeenCalledWith({ feature: false }, { replace: true })
  expect(page.onImportResult).toHaveBeenLastCalledWith(result)
})

test.each([{}, { feature: false }])(
  'restores %j with replacement semantics and clears success messages later',
  async (settings) => {
    const page = load()
    expect(await page.import(transfer.createSettingsExport(settings, '99.0.0'))).toEqual({
      success: true,
      issues: [],
    })
    expect(page.writeSettings).toHaveBeenCalledExactlyOnceWith(settings, { replace: true })
    expect(page.fileInput.value).toBe('')
    expect(page.onImportResult).toHaveBeenLastCalledWith({ success: true, issues: [] })
    vi.advanceTimersByTime(3000)
    expect(page.onImportResult).toHaveBeenLastCalledWith(null)
  },
)

test.each([
  { extensionId: 'wrong', schemaVersion: 1, settings: {} },
  { extensionId: 'example', schemaVersion: 1, settings: { feature: 'yes' } },
  { extensionId: 'example', schemaVersion: 1, settings: { unknown: true } },
  { extensionId: 'example', schemaVersion: 2, settings: {} },
])('invalid restore %j never reaches the writer', async (input) => {
  const page = load()
  expect((await page.import(input)).success).toBe(false)
  expect(page.writeSettings).not.toHaveBeenCalled()
  const result = page.onImportResult.mock.lastCall[0]
  vi.advanceTimersByTime(3000)
  expect(page.onImportResult).toHaveBeenLastCalledWith(result)
})

test('waits for replacement success before announcing success and reports a failed write', async () => {
  let reject
  const pending = new Promise((_resolve, fail) => {
    reject = fail
  })
  const page = load({ writeSettings: () => pending })
  const operation = page.import(transfer.createSettingsExport({}, '1'))
  await Promise.resolve()
  await Promise.resolve()
  expect(page.onImportResult).toHaveBeenLastCalledWith(null)
  reject(new Error('offline'))
  expect(await operation).toEqual({ success: false, issues: [{ code: 'settingsImportFailed' }] })
})

test('file-read failures and cancelled selection cannot write settings', async () => {
  const page = load()
  expect(await page.controller.importSettings()).toEqual({
    success: false,
    issues: [{ code: 'noFileSelected' }],
  })
  page.fileInput.files = [
    {
      text: async () => {
        throw new Error('read failed')
      },
    },
  ]
  expect(await page.controller.importSettings()).toEqual({
    success: false,
    issues: [{ code: 'settingsImportFailed' }],
  })
  expect(page.writeSettings).not.toHaveBeenCalled()
})

test('disables import controls until completion and ignores duplicate events', async () => {
  let finishRead
  const page = load()
  page.fileInput.files = [
    {
      text: () =>
        new Promise((resolve) => {
          finishRead = resolve
        }),
    },
  ]
  const first = page.controller.importSettings()
  expect(page.fileInput.disabled).toBe(true)
  expect(page.importButton.disabled).toBe(true)
  expect(page.controller.importSettings()).toBe(first)
  page.controller.chooseImportFile()
  expect(page.fileInput.click).not.toHaveBeenCalled()
  await Promise.resolve()
  finishRead(JSON.stringify(transfer.createSettingsExport({ feature: true }, '1')))
  await first
  expect(page.writeSettings).toHaveBeenCalledOnce()
  expect(page.fileInput.disabled).toBe(false)
  expect(page.importButton.disabled).toBe(false)
  await page.import(transfer.createSettingsExport({ feature: false }, '1'))
  expect(page.writeSettings).toHaveBeenCalledTimes(2)
})

test('preserves existing disabled state when an import fails', async () => {
  const page = load()
  page.fileInput.disabled = true
  page.importButton.disabled = true
  await page.import({})
  expect(page.fileInput.disabled).toBe(true)
  expect(page.importButton.disabled).toBe(true)
})

test.each(['firefox', 'mac'])(
  '%s popup redirects the unsupported operation to the options page',
  async (browser) => {
    const page = load({ browser, isBrowserAction: true })
    if (browser === 'firefox') page.controller.chooseImportFile()
    else await page.controller.exportSettings()
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledOnce()
    expect(page.readSettings).not.toHaveBeenCalled()
    expect(page.fileInput.click).not.toHaveBeenCalled()
  },
)

test('iOS shares a JSON file and falls back to an encoded document when files cannot be shared', async () => {
  const page = load({ browser: 'ios' })
  await page.controller.exportSettings()
  const shared = navigator.share.mock.calls[0][0]
  expect(shared.title).toBe('example-v1.2.3-settings.json')
  expect(JSON.parse(await shared.files[0].text()).extensionId).toBe('example')
  navigator.canShare.mockReturnValue(false)
  await page.controller.exportSettings()
  expect(window.open.mock.calls[0][0]).toMatch(/^data:application\/json;charset=utf-8,/)
})

test('connect/destroy manage listeners and pending message clearing', async () => {
  const page = load()
  page.controller.connect()
  page.controller.connect()
  expect(page.importButton.addEventListener).toHaveBeenCalledOnce()
  await page.import(transfer.createSettingsExport({}, '1'))
  page.controller.destroy()
  expect(page.fileInput.listeners.size).toBe(0)
  const count = page.onImportResult.mock.calls.length
  vi.advanceTimersByTime(3000)
  expect(page.onImportResult).toHaveBeenCalledTimes(count)
})

test('event handlers report export failure while leaving cancelled shares alone', async () => {
  const page = load({ browser: 'ios' })
  page.controller.connect()
  navigator.share.mockRejectedValueOnce(new Error('share failed'))
  page.exportButton.listeners.get('click')()
  await vi.waitFor(() => expect(page.onExportError).toHaveBeenCalledOnce())
  navigator.share.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
  page.exportButton.listeners.get('click')()
  await vi.waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(2))
  expect(page.onExportError).toHaveBeenCalledOnce()
})
