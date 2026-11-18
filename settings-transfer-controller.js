import { get, setSettings } from './settings.js'

/**
 * Attach backup/restore behaviour to extension-owned markup and result rendering.
 * @param {import('./types').SettingsTransferControllerOptions} options
 */
export function createSettingsTransferController({
  transfer,
  filenamePrefix,
  browser,
  isBrowserAction = false,
  importButton,
  exportButton,
  fileInput,
  onImportResult,
  onExportError = () => {},
  readSettings = async () => (await get('settings')).settings || {},
  writeSettings = setSettings,
}) {
  const document = fileInput.ownerDocument
  const importRequiresTab = isBrowserAction && browser == 'firefox'
  const exportRequiresTab = isBrowserAction && browser == 'mac'
  let clearMessagesTimeout
  let connected = false
  /** @type {Promise<import('./types').SettingsImportResult> | undefined} */
  let importTask

  function openOptionsPage() {
    chrome.runtime.openOptionsPage()
    window.close()
  }

  async function exportSettings() {
    if (exportRequiresTab) {
      openOptionsPage()
      return
    }
    const version = chrome.runtime.getManifest().version
    const settings = await readSettings()
    const sorted = Object.fromEntries(
      Object.entries(settings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
    const json = JSON.stringify(transfer.createSettingsExport(sorted, version), null, 2)
    const filename = `${filenamePrefix}-v${version}-settings.json`
    const blob = new Blob([json], { type: 'application/json' })
    if (browser == 'ios') {
      const file = new File([blob], filename, { type: 'application/json' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
      } else {
        window.open(`data:application/json;charset=utf-8,${encodeURIComponent(json)}`)
      }
      return
    }
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.download = filename
      anchor.href = url
      anchor.click()
    } finally {
      requestIdleCallback(() => URL.revokeObjectURL(url))
    }
  }

  function importSettings() {
    if (importTask) return importTask
    const file = fileInput.files?.[0]
    // Retain the File before clearing the input so it can be selected again later.
    fileInput.value = ''
    const inputWasDisabled = fileInput.disabled
    const buttonWasDisabled = importButton.disabled
    fileInput.disabled = true
    importButton.disabled = true
    importTask = Promise.resolve()
      .then(() => restoreFile(file))
      .finally(() => {
        fileInput.disabled = inputWasDisabled
        importButton.disabled = buttonWasDisabled
        importTask = undefined
      })
    return importTask
  }

  async function restoreFile(file) {
    clearTimeout(clearMessagesTimeout)
    onImportResult(null)
    /** @type {import('./types').SettingsImportResult} */
    let result
    if (!file) {
      result = { success: false, issues: [{ code: 'noFileSelected' }] }
    } else {
      try {
        const { settings, issues } = transfer.validateSettingsJson(await file.text())
        if (settings === null) result = { success: false, issues }
        else {
          // The shared writer waits for a synced PUT before replacing local state.
          await writeSettings(settings, { replace: true })
          result = { success: true, issues: [] }
        }
      } catch {
        result = { success: false, issues: [{ code: 'settingsImportFailed' }] }
      }
    }
    onImportResult(result)
    if (result.success) {
      clearMessagesTimeout = setTimeout(() => onImportResult(null), 3000)
    }
    return result
  }

  function chooseImportFile() {
    if (importTask) return
    clearTimeout(clearMessagesTimeout)
    onImportResult(null)
    if (importRequiresTab) openOptionsPage()
    else fileInput.click()
  }

  function onExport() {
    void exportSettings().catch((error) => {
      if (error.name != 'AbortError') onExportError(error)
    })
  }

  function onImport() {
    void importSettings()
  }

  function connect() {
    if (connected) return
    connected = true
    importButton.addEventListener('click', chooseImportFile)
    exportButton.addEventListener('click', onExport)
    fileInput.addEventListener('change', onImport)
  }

  function destroy() {
    if (connected) {
      importButton.removeEventListener('click', chooseImportFile)
      exportButton.removeEventListener('click', onExport)
      fileInput.removeEventListener('change', onImport)
      connected = false
    }
    clearTimeout(clearMessagesTimeout)
  }

  return {
    connect,
    destroy,
    exportSettings,
    importSettings,
    chooseImportFile,
    importRequiresTab,
    exportRequiresTab,
  }
}
