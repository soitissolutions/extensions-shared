//#region Helpers
/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isObject(value) {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}
//#endregion

//#region Field descriptor factories
/** @returns {import('./types').FieldDescriptor} */
export function boolean() {
  return {
    validate: (value) => typeof value == 'boolean',
  }
}

/**
 * @param {{ maxLength?: number }} [options]
 * @returns {import('./types').FieldDescriptor}
 */
export function string({ maxLength } = {}) {
  return {
    validate: (value) =>
      typeof value == 'string' && (maxLength == null || value.length <= maxLength),
  }
}

/**
 * @param {string[]} allowedValues
 * @returns {import('./types').FieldDescriptor}
 */
export function oneOf(allowedValues) {
  return {
    validate: (value) => typeof value == 'string' && allowedValues.includes(value),
  }
}

/**
 * Validates that an array is empty or has at least one valid item. Only valid
 * items are retained.
 * @param {import('./types').FieldDescriptor} item
 * @param {{ maxLength?: number }} [options]
 * @returns {import('./types').FieldDescriptor}
 */
export function arrayOf(item, { maxLength } = {}) {
  return {
    validate: (value) =>
      Array.isArray(value) &&
      (maxLength == null || value.length <= maxLength) &&
      (value.length == 0 || value.some(item.validate)),
    normalise: (values) => {
      const valid = values.filter(item.validate)
      return maxLength != null ? valid.slice(0, maxLength) : valid
    },
  }
}

/**
 * Wraps a field descriptor to also accept `null`/`undefined`. Use for optional
 * fields within `object()` descriptors.
 * @param {import('./types').FieldDescriptor} field
 * @returns {import('./types').FieldDescriptor}
 */
export function optional(field) {
  return {
    validate: (value) => value == null || field.validate(value),
  }
}

/**
 * Validates a plain object against a map of field descriptors. All fields are
 * required unless wrapped with `optional()`.
 * @param {Record<string, import('./types').FieldDescriptor>} fields
 * @returns {import('./types').FieldDescriptor}
 */
export function object(fields) {
  return {
    validate: (value) =>
      isObject(value) && Object.entries(fields).every(([key, field]) => field.validate(value[key])),
  }
}
//#endregion

//#region Validation
/**
 * Validates and normalises a settings object against a schema. Unknown and
 * invalid keys are dropped.
 * @param {Record<string, unknown>} input
 * @param {Record<string, import('./types').FieldDescriptor>} schema
 * @returns {import('./types').ValidateSettingsResult}
 */
export function validateSettings(input, schema) {
  /** @type {Record<string, unknown>} */
  const settings = {}
  const invalid = []
  const unknown = []

  for (const [key, value] of Object.entries(input)) {
    const field = Object.hasOwn(schema, key) ? schema[key] : null
    if (!field) {
      unknown.push(key)
      continue
    }
    if (!field.validate(value)) {
      invalid.push(key)
      continue
    }
    settings[key] = field.normalise ? field.normalise(value) : value
  }

  return { settings, invalid, unknown }
}
//#endregion
