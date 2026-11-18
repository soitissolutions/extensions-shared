export type FieldDescriptor = {
  validate: (value: any) => boolean
  normalise?: (value: any) => any
}

export type ValidateSettingsResult = {
  settings: Record<string, unknown>
  invalid: string[]
  unknown: string[]
}

export type SettingsExport = {
  extensionId: string
  schemaVersion: number
  settings: Record<string, unknown>
  version?: string
}

export type SettingsImportError =
  | 'noSettingsObject'
  | 'invalidSettingsSchemaVersion'
  | 'settingsExtensionMismatch'
  | 'settingsMigrationFailed'
  | 'unsupportedSettingsSchemaVersion'

export type SettingsTransferOptions = {
  extensionId: string
  /** Convert supported formats to the current schema; called only after checking extension identity. */
  migrate?: (input: SettingsExport) => SettingsExport
  schema: Record<string, FieldDescriptor>
  schemaVersion: number
}

export type ValidateSettingsExportResult = ValidateSettingsResult & {
  error?: SettingsImportError
  warning?: 'newerSettingsSchemaVersion'
}

export type FeatureSearchControllerOptions = {
  panel: Element
  input: HTMLInputElement
  row: HTMLElement
  toggle: HTMLElement
  clear: HTMLElement
  empty: HTMLElement
  normalizeTerms?: (text: string) => string
  onOpen?: () => void
  onFilteringChange?: (filtering: boolean) => void
}

export type DebugTraceEntry = {
  details: Record<string, unknown>
  event: string
  time: number
  workerId: string
}

export type ExtensionsProSubscription =
  | {
      type: 'lifetime'
      active: true
      status: 'active'
      createdAt: number
    }
  | {
      type: 'annual' | 'monthly'
      active: boolean
      // The only statuses an extension should see
      status:
        // Active statuses
        | 'active'
        | 'past_due'
        | 'trialing'
        // Inactive statuses
        | 'canceled'
        | 'paused'
      createdAt: number
      currentPeriodEnd: number
      cancelAtPeriodEnd: boolean
      canceledAt: number | null
    }

export type SettingsImportIssue = {
  code:
    | SettingsImportError
    | 'invalidJsonFile'
    | 'invalidSettings'
    | 'unknownSettings'
    | 'noFileSelected'
    | 'settingsImportFailed'
  detail?: string
}

export type SettingsImportValidation = {
  settings: Record<string, unknown> | null
  issues: SettingsImportIssue[]
}

export type SettingsImportResult = {
  success: boolean
  issues: SettingsImportIssue[]
}

export type SettingsTransferControllerOptions = {
  transfer: ReturnType<typeof import('./settings-transfer').createSettingsTransfer>
  filenamePrefix: string
  browser: 'chrome' | 'edge' | 'firefox' | 'ios' | 'mac'
  isBrowserAction?: boolean
  importButton: HTMLButtonElement
  exportButton: Element
  fileInput: HTMLInputElement
  onImportResult: (result: SettingsImportResult | null) => void
  onExportError?: (error: Error) => void
  readSettings?: () => Promise<Record<string, unknown>>
  writeSettings?: (settings: Record<string, unknown>, options: { replace: boolean }) => Promise<void>
}
