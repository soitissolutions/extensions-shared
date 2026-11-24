import { beforeEach, expect, test, vi } from 'vitest'

import {
  getSettingsMigrationVersions,
  runSettingsMigrations,
  scheduleSettingsMigrations,
} from '../settings-migrations.js'
import { createChromeMock } from './helpers/chrome.js'

let browser
beforeEach(() => {
  browser = createChromeMock()
  vi.stubGlobal('chrome', browser.chrome)
})

test('runs only scheduled migrations and resumes at a failed step across later upgrades', async () => {
  const first = vi.fn(async () => {})
  const second = vi.fn(async () => {})
  const third = vi.fn(async () => {})
  second.mockRejectedValueOnce(new Error('failed conversion'))
  const steps = [
    ['2', first],
    ['3', second],
    ['4', third],
  ]
  expect(getSettingsMigrationVersions('1', '3', steps)).toEqual(['2', '3'])
  await expect(runSettingsMigrations('3', steps)).resolves.toBe(false)
  expect(first).not.toHaveBeenCalled()
  await scheduleSettingsMigrations('1', '3', steps)
  await expect(runSettingsMigrations('3', steps)).rejects.toThrow('failed conversion')
  expect(browser.storage.pendingStorageMigration).toBe('3')
  expect(first).toHaveBeenCalledOnce()
  expect(third).not.toHaveBeenCalled()
  await scheduleSettingsMigrations('3', '4', steps)
  expect(browser.storage.pendingStorageMigration).toBe('3')
  await expect(runSettingsMigrations('4', steps)).resolves.toBe(true)
  expect(first).toHaveBeenCalledOnce()
  expect(second).toHaveBeenCalledTimes(2)
  expect(third).toHaveBeenCalledOnce()
  expect(browser.storage.pendingStorageMigration).toBeUndefined()
})

test('retains unknown and future migration checkpoints', async () => {
  browser.storage.pendingStorageMigration = '3'
  await expect(runSettingsMigrations('2', [])).rejects.toThrow('Unknown storage migration: 3')
  const migrate = vi.fn(async () => {})
  await expect(runSettingsMigrations('2', [['3', migrate]])).resolves.toBe(false)
  expect(browser.storage.pendingStorageMigration).toBe('3')
  expect(migrate).not.toHaveBeenCalled()
})
