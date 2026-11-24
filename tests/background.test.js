import { beforeEach, expect, test, vi } from 'vitest'

import { createChromeMock } from './helpers/chrome.js'

const sync = vi.hoisted(() => ({ initSettingsSync: vi.fn(), startSync: vi.fn() }))
vi.mock('../settings-background.js', () => sync)

beforeEach(() => {
  vi.resetModules()
  sync.initSettingsSync.mockReset()
  sync.startSync.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function load({ storage = {}, manifestVersion = 3, safari = false, ...options } = {}) {
  const browser = createChromeMock({ storage })
  const installed = []
  const startup = []
  const changed = []
  Object.assign(browser.chrome, {
    action: { setTitle: vi.fn(), setIcon: vi.fn(), setBadgeText: vi.fn() },
    browserAction: { setTitle: vi.fn(), setIcon: vi.fn() },
    i18n: { getMessage: (key) => key },
  })
  Object.assign(browser.chrome.runtime, {
    getManifest: () => ({ version: '3.0.0', manifest_version: manifestVersion }),
    onInstalled: { addListener: (listener) => installed.push(listener) },
    onStartup: { addListener: (listener) => startup.push(listener) },
  })
  Object.assign(browser.chrome.storage.local, {
    onChanged: { addListener: (listener) => changed.push(listener) },
  })
  vi.stubGlobal('chrome', browser.chrome)
  vi.stubGlobal('location', { protocol: safari ? 'safari-web-extension:' : 'chrome-extension:' })
  const { initBackground } = await import('../background.js')
  initBackground({ productPath: 'example', ...options })
  expect(installed).toHaveLength(1)
  expect(startup).toHaveLength(1)
  expect(changed).toHaveLength(1)
  expect(sync.initSettingsSync).toHaveBeenCalledOnce()
  return {
    ...browser,
    installed: (details) => installed[0](details),
    startup: () => startup[0](),
    change: (changes) => changed[0](changes),
  }
}

test.each([2, 3])('MV%s updates translated toolbar titles and extension-root icons', async (mv) => {
  const browser = await load({ manifestVersion: mv })
  await browser.startup()
  const action = mv == 2 ? browser.chrome.browserAction : browser.chrome.action
  expect(action.setTitle).toHaveBeenLastCalledWith({ title: 'extensionName' })
  expect(action.setIcon.mock.lastCall[0].path[16]).toBe('icons/icon16.png')
  browser.change({ enabled: { oldValue: true, newValue: false } })
  expect(action.setTitle).toHaveBeenLastCalledWith({ title: 'extensionNameDisabled' })
  expect(action.setIcon.mock.lastCall[0].path[128]).toBe('icons/icon128-disabled.png')
  browser.change({ settings: { newValue: {} } })
  expect(action.setIcon).toHaveBeenCalledTimes(2)
})

test('Safari uses its disabled badge and clears it when enabled again', async () => {
  const browser = await load({ safari: true, storage: { enabled: false } })
  await browser.startup()
  expect(browser.chrome.action.setTitle).toHaveBeenLastCalledWith({
    title: 'extensionNameDisabled',
  })
  expect(browser.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '⏻' })
  browser.change({ enabled: { oldValue: false, newValue: true } })
  expect(browser.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
  expect(browser.chrome.action.setIcon).not.toHaveBeenCalled()
})

test('local-only startup registers the writer without starting sync', async () => {
  const browser = await load()
  const startup = browser.startup()
  expect(browser.startup()).toBe(startup)
  await startup
  await browser.installed({ reason: 'install' })
  expect(browser.storage).toEqual({ settings: {} })
  expect(sync.initSettingsSync).toHaveBeenCalledWith({
    apiBase: 'https://pro.soitis.dev',
    proEnabled: false,
  })
  expect(sync.startSync).not.toHaveBeenCalled()
  expect(browser.chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({
    url: 'https://soitis.dev/example/welcome',
  })
})

test('opens only the first configured crossed update threshold in an inactive tab', async () => {
  const browser = await load({ significantVersions: ['3', '2'] })
  await browser.installed({ reason: 'update', previousVersion: '1.0.0' })
  expect(browser.chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({
    url: 'https://soitis.dev/example/updated?version=3',
    active: false,
  })
})

test('does not open an update page without a crossed configured threshold', async () => {
  const browser = await load({ significantVersions: ['2'] })
  await browser.installed({ reason: 'update', previousVersion: '2.9.0' })
  await browser.installed({ reason: 'chrome_update' })
  expect(browser.chrome.tabs.create).not.toHaveBeenCalled()
})

test('runs pending migrations before starting Pro sync', async () => {
  const migrate = vi.fn(async () => {
    expect(sync.startSync).not.toHaveBeenCalled()
  })
  const browser = await load({
    proEnabled: true,
    storage: { pendingStorageMigration: '2' },
    migrations: [['2', migrate]],
  })
  await browser.startup()
  expect(migrate).toHaveBeenCalledOnce()
  expect(sync.startSync).toHaveBeenCalledOnce()
})

test('blocks sync for future migrations', async () => {
  const migrate = vi.fn(async () => {})
  const future = await load({
    proEnabled: true,
    storage: { pendingStorageMigration: '4' },
    migrations: [['4', migrate]],
  })
  await future.startup()
  expect(future.storage.pendingStorageMigration).toBe('4')
  expect(sync.startSync).not.toHaveBeenCalled()
})
