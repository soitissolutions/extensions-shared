import { expect, test, vi } from 'vitest'

import { arrayOf, boolean, string } from '../settings-schema.js'
import { createSettingsTransfer } from '../settings-transfer.js'

const schema = { feature: boolean(), entries: arrayOf(string()) }
const transfer = createSettingsTransfer({ extensionId: 'example', schemaVersion: 1, schema })
const validate = (input) => transfer.validateSettingsJson(JSON.stringify(input))

test('unknown keys can be skipped explicitly without relaxing known-field validation', () => {
  const tolerant = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema,
    ignoreUnknown: true,
  })
  const input = {
    extensionId: 'example',
    schemaVersion: 1,
    settings: { feature: false, future: true },
  }
  expect(tolerant.validateSettingsJson(JSON.stringify(input))).toEqual({
    settings: { feature: false },
    issues: [{ code: 'unknownSettings', detail: 'future' }],
  })
  expect(
    tolerant.validateSettingsJson(
      JSON.stringify({ ...input, settings: { feature: 'no', future: true } }),
    ).settings,
  ).toBeNull()
})

test('legacy identity support is limited to explicitly listed schema-1 versions', () => {
  const compatible = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema,
    legacyExportVersions: ['1.2.3'],
  })
  const old = { schemaVersion: 1, version: '1.2.3', settings: { feature: false } }
  expect(compatible.validateSettingsJson(JSON.stringify(old))).toEqual({
    settings: { feature: false },
    issues: [],
  })
  expect(old).not.toHaveProperty('extensionId')
  for (const backup of [
    { ...old, version: '1.2.4' },
    { ...old, schemaVersion: 2 },
    { ...old, extensionId: 'different' },
    { ...old, extensionId: null },
    { ...old, extensionId: '' },
  ]) {
    expect(compatible.validateSettingsExport(backup).error).toBe('settingsExtensionMismatch')
  }
})

test('prototype property names are unknown settings rather than schema fields', () => {
  const tolerant = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema,
    ignoreUnknown: true,
  })
  const settings = JSON.parse('{"feature":true,"__proto__":{},"constructor":true,"toString":true}')
  expect(tolerant.validateSettingsExport(tolerant.createSettingsExport(settings, '1'))).toEqual({
    settings: { feature: true },
    invalid: [],
    unknown: ['__proto__', 'constructor', 'toString'],
  })
})

test.each([undefined, null, 42, '', 'another-extension'])(
  'rejects a missing or different extension identifier %j even for empty settings',
  (extensionId) => {
    expect(validate({ extensionId, schemaVersion: 1, settings: {} })).toEqual({
      settings: null,
      issues: [{ code: 'settingsExtensionMismatch' }],
    })
  },
)

test.each([
  [{ feature: 'true' }, 'invalidSettings'],
  [{ feature: true, futureFeature: false }, 'unknownSettings'],
  [{ entries: ['valid', false] }, 'invalidSettings'],
])('rejects the whole restore for invalid or unknown values %j', (settings, code) => {
  const result = validate(transfer.createSettingsExport(settings, '99.0.0'))
  expect(result.settings).toBeNull()
  expect(result.issues[0].code).toBe(code)
})

test('an empty settings document restores defaults and extension version is diagnostic', () => {
  expect(validate(transfer.createSettingsExport({}, '99.0.0'))).toEqual({
    settings: {},
    issues: [],
  })
})

test('rejects future formats without running migration code', () => {
  const migrate = vi.fn()
  const current = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema,
    migrate,
  })
  expect(
    current.validateSettingsJson(
      JSON.stringify({ extensionId: 'example', schemaVersion: 2, settings: {} }),
    ),
  ).toEqual({ settings: null, issues: [{ code: 'unsupportedSettingsSchemaVersion' }] })
  expect(migrate).not.toHaveBeenCalled()
})

test('requires an explicit migration for an older incompatible schema', () => {
  const current = createSettingsTransfer({ extensionId: 'example', schemaVersion: 2, schema })
  expect(current.validateSettingsExport(transfer.createSettingsExport({}, '1.0.0')).error).toBe(
    'unsupportedSettingsSchemaVersion',
  )
})

test('runs a product migration before validation without mutating the backup', () => {
  const input = { extensionId: 'example', schemaVersion: 1, settings: { oldFeature: false } }
  const current = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 2,
    schema,
    migrate(backup) {
      backup.settings.feature = backup.settings.oldFeature
      delete backup.settings.oldFeature
      backup.schemaVersion = 2
      return backup
    },
  })
  expect(current.validateSettingsJson(JSON.stringify(input))).toEqual({
    settings: { feature: false },
    issues: [],
  })
  expect(input.settings).toEqual({ oldFeature: false })
})

test('does not migrate a different extension and revalidates migration results', () => {
  const migrate = vi.fn((backup) => ({ ...backup, extensionId: 'wrong' }))
  const current = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema,
    migrate,
  })
  expect(
    current.validateSettingsExport({ extensionId: 'other', schemaVersion: 1, settings: {} }).error,
  ).toBe('settingsExtensionMismatch')
  expect(migrate).not.toHaveBeenCalled()
  expect(current.validateSettingsExport(transfer.createSettingsExport({}, '1')).error).toBe(
    'settingsExtensionMismatch',
  )
})

test('reports migration failure and invalid JSON without producing a restore document', () => {
  const current = createSettingsTransfer({
    extensionId: 'example',
    schemaVersion: 1,
    schema,
    migrate() {
      throw new Error('unsupported old format')
    },
  })
  expect(
    current.validateSettingsJson(JSON.stringify(transfer.createSettingsExport({}, '1'))).issues,
  ).toEqual([{ code: 'settingsMigrationFailed' }])
  expect(transfer.validateSettingsJson('{').settings).toBeNull()
  expect(transfer.validateSettingsJson('{').issues[0].code).toBe('invalidJsonFile')
})
