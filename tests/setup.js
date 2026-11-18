import { afterEach, vi } from 'vitest'

vi.stubGlobal('chrome', {
  runtime: {
    getManifest: () => ({ manifest_version: 3, host_permissions: ['https://pro.soitis.dev/*'] }),
  },
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
