import { isObject, validateSettings } from './settings-schema.js'

/**
 * Bind backups to an extension-owned schema and stable product identifier.
 * @param {import('./types').SettingsTransferOptions} options
 */
export function createSettingsTransfer({ extensionId, schema, schemaVersion, migrate }) {
  if (typeof extensionId != 'string' || !extensionId.trim()) {
    throw new Error('extensionId must be a non-empty string')
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('schemaVersion must be a positive safe integer')
  }

  /**
   * @param {Record<string, unknown>} settings
   * @param {string} version Extension version, for diagnostics only.
   * @returns {import('./types').SettingsExport}
   */
  function createSettingsExport(settings, version) {
    return { extensionId, schemaVersion, settings, version }
  }

  /** @param {unknown} input */
  function envelopeError(input) {
    if (!isObject(input) || !isObject(input.settings)) return 'noSettingsObject'
    if (
      typeof input.schemaVersion != 'number' ||
      !Number.isSafeInteger(input.schemaVersion) ||
      input.schemaVersion < 1
    ) {
      return 'invalidSettingsSchemaVersion'
    }
    if (input.extensionId !== extensionId) return 'settingsExtensionMismatch'
  }

  /**
   * Returns diagnostics; callers must reject the whole restore if any are present.
   * Migrations run only for this extension's current or older formats.
   * @param {unknown} input
   * @returns {import('./types').ValidateSettingsExportResult}
   */
  function validateSettingsExport(input) {
    const rejected = { settings: {}, invalid: [], unknown: [] }
    const error = envelopeError(input)
    if (error) return { ...rejected, error }
    let candidate = /** @type {import('./types').SettingsExport} */ (input)
    if (migrate && candidate.schemaVersion <= schemaVersion) {
      try {
        candidate = migrate(structuredClone(candidate))
      } catch {
        return { ...rejected, error: 'settingsMigrationFailed' }
      }
      const error = envelopeError(candidate)
      if (error) return { ...rejected, error }
    }
    if (candidate.schemaVersion < schemaVersion) {
      return { ...rejected, error: 'unsupportedSettingsSchemaVersion' }
    }
    const result = validateSettings(candidate.settings, schema)
    // Array normalisation can discard invalid items; a restore must report that
    // loss instead of silently replacing the user's complete settings with it.
    for (const [key, value] of Object.entries(result.settings)) {
      if (
        schema[key].normalise &&
        JSON.stringify(value) !== JSON.stringify(candidate.settings[key])
      ) {
        result.invalid.push(key)
      }
    }
    if (candidate.schemaVersion > schemaVersion) {
      return { ...result, warning: 'newerSettingsSchemaVersion' }
    }
    return result
  }

  /**
   * Parse and validate a complete restore without modifying stored settings.
   * @param {string} json
   * @returns {import('./types').SettingsImportValidation}
   */
  function validateSettingsJson(json) {
    let input
    try {
      input = JSON.parse(json)
    } catch (error) {
      return { settings: null, issues: [{ code: 'invalidJsonFile', detail: error.message }] }
    }
    const { settings, invalid, unknown, error, warning } = validateSettingsExport(input)
    if (error) return { settings: null, issues: [{ code: error }] }
    /** @type {import('./types').SettingsImportIssue[]} */
    const issues = []
    if (warning) issues.push({ code: 'unsupportedSettingsSchemaVersion' })
    if (invalid.length) issues.push({ code: 'invalidSettings', detail: invalid.join(', ') })
    if (unknown.length) issues.push({ code: 'unknownSettings', detail: unknown.join(', ') })
    return { settings: issues.length ? null : settings, issues }
  }

  return { createSettingsExport, validateSettingsExport, validateSettingsJson }
}
