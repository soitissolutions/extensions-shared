import { expect, test, vi } from 'vitest'

import { createChromeMock } from './helpers/chrome.js'

test.each(['1.0.0', '5.0.0'])(
  'local-only configuration ignores stored credentials and version %s',
  async (version) => {
    const browser = createChromeMock({ storage: { settings: { feature: true }, token: 'token' } })
    browser.chrome.runtime.getManifest = () => ({ version, manifest_version: 3 })
    vi.stubGlobal('chrome', browser.chrome)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.resetModules()
    const { initSettingsSync, startSync } = await import('../settings-background.js')
    const { setSettings, ACCOUNT_LINKED_MESSAGE } = await import('../settings.js')
    initSettingsSync({ proEnabled: false })
    await startSync()
    await setSettings({ feature: false })
    await setSettings({ another: true }, { replace: true })
    await browser.sendMessage({ type: ACCOUNT_LINKED_MESSAGE, token: 'new-token' })
    expect(browser.storage).toEqual({ settings: { another: true }, token: 'token' })
    expect(browser.alarms.size).toBe(0)
    expect(browser.session).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  },
)

test.each(['chrome-extension:', 'safari-web-extension:'])(
  'opening Pro preserves Safari entry context for %s',
  async (protocol) => {
    const browser = createChromeMock()
    vi.stubGlobal('chrome', browser.chrome)
    vi.stubGlobal('location', { protocol })
    vi.resetModules()
    const { initSettingsSync } = await import('../settings-background.js')
    const { OPEN_APP_MESSAGE } = await import('../settings.js')
    initSettingsSync({ proEnabled: true, apiBase: 'https://example.test' })
    await browser.sendMessage({ type: OPEN_APP_MESSAGE, path: '/account' })
    expect(browser.chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({
      url: `https://example.test/account${protocol.startsWith('safari') ? '?source=safari-extension' : ''}`,
    })
  },
)
