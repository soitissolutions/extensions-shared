//#region Helpers
/**
 * @param {string} previous
 * @param {string} current
 * @param {string} threshold
 */
export function crossesVersionThreshold(previous, current, threshold) {
  return isVersionLessThan(previous, threshold) && !isVersionLessThan(current, threshold)
}

/**
 * @param {string} v1
 * @param {string} v2
 */
export function isVersionLessThan(v1, v2) {
  const a = v1.split('.').map(Number)
  const b = v2.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff < 0) return true
    if (diff > 0) return false
  }
  return false
}
//#endregion
