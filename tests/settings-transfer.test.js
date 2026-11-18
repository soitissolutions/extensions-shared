import { expect, test } from 'vitest'

import { arrayOf, boolean, object, oneOf, optional, string } from '../settings-schema.js'
import { createSettingsTransfer } from '../settings-transfer.js'

const schema = {
  enabled: boolean(),
  layout: oneOf(['compact', 'comfortable']),
  entries: arrayOf(object({ name: string({ maxLength: 10 }), note: optional(string()) }), {
    maxLength: 3,
  }),
  customCss: string({ maxLength: 50000 }),
  enableCustomCss: boolean(),
}
const { createSettingsExport, validateSettingsExport } = createSettingsTransfer({
  schema,
  extensionId: 'example',
  schemaVersion: 1,
})

test.each(['1.0.0', '5.0.0', '99.0.0', undefined])(
  'round-trips settings and Custom CSS independently of extension version %s',
  (version) => {
    const settings = {
      enabled: false,
      enableCustomCss: true,
      customCss: '@media (prefers-color-scheme: dark) { body::before { content: "<>&"; } }',
    }
    const exported = JSON.parse(JSON.stringify(createSettingsExport(settings, version)))
    expect(exported).toMatchObject({ extensionId: 'example', schemaVersion: 1, settings })
    expect(validateSettingsExport(exported)).toEqual({ settings, invalid: [], unknown: [] })
  },
)

test('extensions bind their own fields and schema version without affecting each other', () => {
  const other = createSettingsTransfer({
    extensionId: 'another',
    schema: { anotherFeature: boolean() },
    schemaVersion: 3,
  })
  const exported = other.createSettingsExport({ anotherFeature: true }, '1.0.0')
  expect(exported.schemaVersion).toBe(3)
  expect(other.validateSettingsExport(exported).settings).toEqual({ anotherFeature: true })
  expect(validateSettingsExport(exported)).toEqual({
    settings: {},
    invalid: [],
    unknown: [],
    error: 'settingsExtensionMismatch',
  })
})

test.each([undefined, null, '1', 0, -1, 1.5, true, {}, [], Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid schema version %j',
  (schemaVersion) => {
    expect(
      validateSettingsExport({ extensionId: 'example', schemaVersion, settings: {} }).error,
    ).toBe('invalidSettingsSchemaVersion')
    expect(() =>
      createSettingsTransfer({ extensionId: 'example', schema, schemaVersion }),
    ).toThrow()
  },
)

test.each([null, [], true, {}, { settings: [] }, { settings: null }])(
  'rejects invalid export envelope %j',
  (input) => expect(validateSettingsExport(input).error).toBe('noSettingsObject'),
)

test('imports recognised fields from newer schemas and reports invalid and unknown values', () => {
  expect(
    validateSettingsExport({
      extensionId: 'example',
      schemaVersion: 2,
      settings: {
        enabled: true,
        layout: 'unknown',
        customCss: 'x'.repeat(50001),
        futureFeature: true,
      },
    }),
  ).toEqual({
    settings: { enabled: true },
    invalid: ['layout', 'customCss'],
    unknown: ['futureFeature'],
    warning: 'newerSettingsSchemaVersion',
  })
})

test('filters invalid array entries and preserves empty replacement values', () => {
  expect(
    validateSettingsExport({
      extensionId: 'example',
      schemaVersion: 1,
      settings: {
        entries: [{ name: 'first' }, { name: 42 }, { name: 'second', note: 'ok' }],
        customCss: '',
        enableCustomCss: false,
      },
    }).settings,
  ).toEqual({
    entries: [{ name: 'first' }, { name: 'second', note: 'ok' }],
    customCss: '',
    enableCustomCss: false,
  })
  expect(
    validateSettingsExport({ extensionId: 'example', schemaVersion: 1, settings: { entries: [] } })
      .settings,
  ).toEqual({
    entries: [],
  })
})

test('rejects oversized arrays before normalising their contents', () => {
  expect(
    validateSettingsExport({
      extensionId: 'example',
      schemaVersion: 1,
      settings: { entries: Array(4).fill({ name: 'valid' }) },
    }).invalid,
  ).toEqual(['entries'])
})
