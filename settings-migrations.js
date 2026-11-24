import { get, remove, set } from './settings.js'
import { trace } from './trace-background.js'
import { crossesVersionThreshold, isVersionLessThan } from './version.js'

/**
 * @param {string} previous
 * @param {string} current
 * @param {import('./types').SettingsMigrations} migrations
 */
export function getSettingsMigrationVersions(previous, current, migrations) {
  return migrations
    .filter(([version]) => crossesVersionThreshold(previous, current, version))
    .map(([version]) => version)
}

/**
 * Queue the first crossed release threshold, preserving any earlier pending work.
 * @param {string} previous
 * @param {string} current
 * @param {import('./types').SettingsMigrations} migrations
 */
export async function scheduleSettingsMigrations(previous, current, migrations) {
  const { pendingStorageMigration } = await get('pendingStorageMigration')
  const next = getSettingsMigrationVersions(previous, current, migrations)[0]
  if (next && (!pendingStorageMigration || isVersionLessThan(next, pendingStorageMigration))) {
    await set({ pendingStorageMigration: next })
  }
}

/**
 * Run pending migrations in release order up to the installed version.
 * Returns true after completing the pending migration sequence.
 * @param {string} current
 * @param {import('./types').SettingsMigrations} migrations
 */
export async function runSettingsMigrations(current, migrations) {
  const { pendingStorageMigration } = await get('pendingStorageMigration')
  if (!pendingStorageMigration) return false
  const start = migrations.findIndex(([version]) => version == pendingStorageMigration)
  if (start == -1) throw new Error(`Unknown storage migration: ${pendingStorageMigration}`)

  for (let i = start; i < migrations.length; i++) {
    const [version, migration] = migrations[i]
    if (isVersionLessThan(current, version)) return false
    await trace('migration.started', { version })
    try {
      await migration()
      const next = migrations[i + 1]?.[0]
      if (next && !isVersionLessThan(current, next)) {
        await set({ pendingStorageMigration: next })
      } else {
        await remove('pendingStorageMigration')
      }
    } catch (error) {
      await trace('migration.failed', { error: error?.message ?? String(error), version })
      throw error
    }
    await trace('migration.completed', { version })
    if (!migrations[i + 1] || isVersionLessThan(current, migrations[i + 1][0])) return true
  }
  return false
}
