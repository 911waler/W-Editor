export const EXPECTED_UA_IDS = Array.from(
  { length: 20 },
  (_, index) => `UA-${String(index + 1).padStart(3, '0')}`,
)

export const EXPECTED_COMPONENT_IDS = [
  'component.toolbar',
  'component.appearance-theme',
  'component.text-marks',
  'component.heading',
  'component.ruby-pinyin',
  'component.font-size-picker',
  'component.color-picker',
  'component.list',
  'component.task-list',
  'component.panel',
  'component.alignment',
  'component.columns',
  'component.tabs',
  'component.accordion',
  'component.timeline',
  'component.media',
  'component.link',
  'component.simple-insert',
  'component.code-block',
  'component.inline-code',
  'component.formula',
  'component.inline-formula',
  'component.toc',
  'component.table',
  'component.attachment',
  'component.drawio',
  'component.mermaid',
  'component.chart-table',
  'component.history',
  'component.manual-save',
  'component.search-replace',
  'component.shortcut-settings',
  'component.mode-controls',
  'component.source-surface',
  'component.visual-surface',
  'component.preview-surface',
  'component.quote',
  'component.fullscreen',
  'component.locale-picker',
  'component.word-count',
  'component.export-menu',
] as const

export const EXPECTED_SYSTEM_BROWSER_JOURNEY_IDS = [
  'productionSeamAbsent',
  'selection',
  'shortcut',
  'italicSynthesis',
  'listFocus',
  'stickyToolbar',
  'panelValid',
  'panelInvalidRetry',
  'codeValid',
  'codeInvalidRetry',
  'table',
  'formula',
  'toc',
  'sourceVisualFinalConvergence',
  'autosave',
  'reload',
  'diagnostics',
] as const

export const EXPECTED_AGENT_TRIAL_COVERAGE_IDS = [
  'requirementFamilies',
  'commands',
  'parityComponents',
  'rawRecovery',
  'diagramsNetBoundary',
  'realBrowserInput',
  'persistence',
  'imports',
  'exports',
  'failureStates',
  'diagnostics',
] as const

const EXPECTED_REFERENCE_ASSET_IDS = [
  'cherry-toolbar-main-right',
  'cherry-components',
  'cherry-panel-picker',
  'cherry-formula-picker',
  'cherry-table-picker',
  'tiptap-notion-like-visual',
  'tiptap-notion-like-code',
  'tiptap-table-node',
  'w-editor-parity-document',
  'w-editor-parity-state',
] as const

const PARITY_COLUMNS = [
  'Reference owner',
  'Group / order / location',
  'DOM / geometry',
  'Visual tokens',
  'Selection / caret',
  'Keyboard / focus',
  'Contextual UI',
  'States',
  'Accessibility / responsive',
  'Markdown / Final outcomes',
  'Approved exceptions',
] as const

const IMPLEMENTATION_AUDIT_HEADING = '## Current implementation audit'
const IMPLEMENTATION_AUDIT_COLUMNS = [
  'Current implementation classification',
  'Observed gap / shared family',
  'Remediation task',
] as const
const IMPLEMENTATION_CLASSIFICATIONS = new Set([
  'Conforming',
  'Token/CSS-only',
  'Layout/interaction work',
  'Semantic/node/editor work',
])

const UA_COLUMNS = [
  'Stable ID',
  'Classification / non-reproduction boundary',
  'Production reproduction',
  'Approved requirement / design decision',
  'Explicit non-goals',
  'Implementation task',
  'Focused regression',
  'Invalidated full gates',
  'Manual recheck',
  'Final disposition',
] as const

const REFERENCE_STRING_FIELDS = [
  'animationControls',
  'baselineReviewEvidence',
  'browser',
  'browserVersion',
  'captureDate',
  'fixture',
  'id',
  'locale',
  'localPath',
  'ownership',
  'screenshotRegion',
  'sha256',
  'sourceUrl',
  'theme',
  'timeControls',
] as const

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function rowIds(source: string, pattern: RegExp): string[] {
  return source
    .split('\n')
    .map((line) => line.match(pattern)?.[1])
    .filter((id): id is string => typeof id === 'string')
}

function tableCells(row: string): string[] {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateSystemBrowserSmokeReport(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value['results'])) {
    return ['System-browser smoke report must contain results']
  }
  const errors: string[] = []
  const results = value['results']
  const names = results.map((result) => isRecord(result) ? result['name'] : null)
  if (!arraysEqual(names.filter((name): name is string => typeof name === 'string'), ['chrome', 'edge'])) {
    errors.push('System-browser smoke must record stable Chrome and Edge in order')
  }
  for (const candidate of results) {
    if (!isRecord(candidate)) {
      errors.push('Every system-browser result must be an object')
      continue
    }
    const name = isNonEmptyString(candidate['name']) ? candidate['name'] : '<unknown>'
    if (candidate['status'] !== 'passed' || !isNonEmptyString(candidate['actualVersion'])) {
      errors.push(`System-browser ${name} must pass with its actual version recorded`)
    }
    const journey = candidate['journey']
    if (!isRecord(journey) || !arraysEqual(Object.keys(journey), EXPECTED_SYSTEM_BROWSER_JOURNEY_IDS)) {
      errors.push(`System-browser ${name} journey must contain every required Task 24.4 scenario in order`)
      continue
    }
    if (EXPECTED_SYSTEM_BROWSER_JOURNEY_IDS.some((id) => journey[id] !== true)) {
      errors.push(`System-browser ${name} journey must pass every required Task 24.4 scenario`)
    }
  }
  return errors
}

function validatePassedRecord(
  value: unknown,
  expectedIds: readonly string[],
  label: string,
): string[] {
  if (!isRecord(value) || !arraysEqual(Object.keys(value), expectedIds)) {
    return [`Agent trial ${label} must exactly match the frozen inventory in order`]
  }
  return expectedIds.some((id) => value[id] !== 'passed')
    ? [`Agent trial ${label} must pass every frozen inventory item`]
    : []
}

export function validateAgentHandsOnTrialReport(
  value: unknown,
  requirementFamilyIds: readonly string[],
  commandIds: readonly string[],
): string[] {
  if (!isRecord(value)) return ['Agent hands-on trial report must be an object']
  const errors: string[] = []
  if (
    value['status'] !== 'passed'
    || value['productionSeam'] !== 'absent'
    || value['trialMode'] !== 'headed-stable-chrome-slow-production-ui'
  ) {
    errors.push('Agent trial must pass in headed stable Chrome against a pure-production build')
  }
  const browser = value['browser']
  if (!isRecord(browser) || !isNonEmptyString(browser['version'])) {
    errors.push('Agent trial must record the actual stable Chrome version')
  }
  errors.push(...validatePassedRecord(
    value['coverage'],
    EXPECTED_AGENT_TRIAL_COVERAGE_IDS,
    'coverage categories',
  ))
  const inventory = value['inventory']
  if (!isRecord(inventory)) {
    errors.push('Agent trial must record requirement, command, and parity inventories')
  } else {
    errors.push(...validatePassedRecord(
      inventory['requirementFamilies'],
      requirementFamilyIds,
      'requirement-family evidence',
    ))
    errors.push(...validatePassedRecord(
      inventory['commands'],
      commandIds,
      'command evidence',
    ))
    errors.push(...validatePassedRecord(
      inventory['parityComponents'],
      EXPECTED_COMPONENT_IDS,
      'parity-component evidence',
    ))
  }
  const diagnostics = value['diagnostics']
  if (!isRecord(diagnostics) || !Array.isArray(diagnostics['localErrors']) || diagnostics['localErrors'].length !== 0) {
    errors.push('Agent trial must finish with zero local production diagnostics')
  }
  return errors
}

function validateHeader(source: string, prefix: string, columns: readonly string[]): boolean {
  const header = source.split('\n').find((line) => line.startsWith(prefix)) ?? ''
  return columns.every((column) => header.includes(` ${column} `))
}

export function validateUserAcceptanceMatrix(source: string): string[] {
  const errors: string[] = []
  const ids = rowIds(source, /^\| `?(UA-\d{3})`? \|/u)
  if (!arraysEqual(ids, EXPECTED_UA_IDS)) {
    errors.push('UA rows must be exactly UA-001 through UA-020 in order')
  }
  if (!validateHeader(source, '| Stable ID |', UA_COLUMNS)) {
    errors.push('UA matrix header is incomplete')
  }

  const rows = source.split('\n').filter((line) => /^\| `?UA-\d{3}`? \|/u.test(line))
  if (
    rows.some((row) => {
      const cells = tableCells(row)
      return cells.length !== UA_COLUMNS.length || cells.some((cell) => cell.length === 0 || cell === 'TBD')
    })
  ) {
    errors.push('Every UA row must contain all required non-placeholder fields')
  }
  return errors
}

export function validateToolbarComponentParityMatrix(
  source: string,
  expectedCommandIds: readonly string[],
): string[] {
  const errors: string[] = []
  const [frozenSource = '', auditSource = ''] = source.split(IMPLEMENTATION_AUDIT_HEADING, 2)
  const [commandSection = '', componentSection = ''] = frozenSource.split(
    '## Associated component parity rows',
    2,
  )
  const commandIds = rowIds(commandSection, /^\| `([^`]+)` \|/u)
  const componentIds = rowIds(componentSection, /^\| `(component\.[^`]+)` \|/u)

  if (!arraysEqual(commandIds, expectedCommandIds)) {
    errors.push('Command parity rows must exactly match the 80-command inventory in order')
  }
  if (!arraysEqual(componentIds, EXPECTED_COMPONENT_IDS)) {
    errors.push('Component parity rows must exactly match the frozen component inventory in order')
  }
  if (
    !validateHeader(frozenSource, '| Stable ID |', PARITY_COLUMNS) ||
    !validateHeader(frozenSource, '| Component ID |', PARITY_COLUMNS)
  ) {
    errors.push('Parity matrix headers are incomplete')
  }

  const parityRows = frozenSource
    .split('\n')
    .filter((line) => /^\| `(?:component\.)?[a-z][a-z0-9.-]+` \|/u.test(line))
  const incompleteRow = parityRows.some((row) => {
    const cells = tableCells(row)
    return (
      cells.length !== PARITY_COLUMNS.length + 1 ||
      cells.some((cell) => cell.length === 0 || cell === 'TBD')
    )
  })
  if (incompleteRow) {
    errors.push('Every parity row must contain all required non-placeholder fields')
  }
  if (parityRows.some((row) => !/^(?:None|Approved:)/u.test(tableCells(row).at(-1) ?? ''))) {
    errors.push('Every parity exception must be None or start with Approved:')
  }

  const auditIds = rowIds(auditSource, /^\| `([^`]+)` \|/u)
  const expectedAuditIds = [...expectedCommandIds, ...EXPECTED_COMPONENT_IDS]
  if (!arraysEqual(auditIds, expectedAuditIds)) {
    errors.push('Implementation audit rows must exactly match every command and component in order')
  }
  if (!validateHeader(
    auditSource,
    '| Stable ID / Component ID |',
    IMPLEMENTATION_AUDIT_COLUMNS,
  )) {
    errors.push('Implementation audit header is incomplete')
  }

  const auditRows = auditSource
    .split('\n')
    .filter((line) => /^\| `(?:component\.)?[a-z][a-z0-9.-]+` \|/u.test(line))
  if (auditRows.some((row) => {
    const cells = tableCells(row)
    return cells.length !== IMPLEMENTATION_AUDIT_COLUMNS.length + 1
      || cells.some((cell) => cell.length === 0 || cell === 'TBD')
  })) {
    errors.push('Every implementation audit row must contain all required non-placeholder fields')
  }
  if (auditRows.some((row) => {
    const classification = tableCells(row)[1]?.replace(/^`|`$/gu, '') ?? ''
    return !IMPLEMENTATION_CLASSIFICATIONS.has(classification)
  })) {
    errors.push('Every implementation audit row must use one of the four approved classifications')
  }
  if (auditRows.some((row) => {
    const cells = tableCells(row)
    const classification = cells[1]?.replace(/^`|`$/gu, '') ?? ''
    const remediation = cells[3] ?? ''
    return classification === 'Conforming'
      ? remediation !== 'None'
      : !remediation.startsWith('Task ')
  })) {
    errors.push('Implementation audit remediation must be None only for conforming rows and a Task for all others')
  }
  return errors
}

export function validateReferenceBaselineManifest(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ['Reference baseline manifest must be an object']
  }
  if (value['pixelCanonicalEngine'] !== 'Playwright bundled Chromium 151.0.7922.34') {
    errors.push('Reference baseline canonical pixel engine is not frozen')
  }
  if (value['unreviewedRerecordingForbidden'] !== true) {
    errors.push('Unreviewed baseline re-recording must be forbidden')
  }
  const assets = value['assets']
  if (!Array.isArray(assets)) {
    return [...errors, 'Reference baseline assets must be an array']
  }

  const ids = assets.map((asset) =>
    isRecord(asset) && isNonEmptyString(asset['id']) ? asset['id'] : '',
  )
  if (!arraysEqual(ids, EXPECTED_REFERENCE_ASSET_IDS)) {
    errors.push('Reference asset rows must exactly match the frozen asset inventory in order')
  }

  for (const candidate of assets) {
    if (!isRecord(candidate)) {
      errors.push('Every reference asset must be an object')
      continue
    }
    const id = isNonEmptyString(candidate['id']) ? candidate['id'] : '<unknown>'
    for (const field of REFERENCE_STRING_FIELDS) {
      if (!isNonEmptyString(candidate[field])) {
        errors.push(`Reference asset ${id} is missing ${field}`)
      }
    }
    if (!Array.isArray(candidate['fonts']) || candidate['fonts'].length === 0) {
      errors.push(`Reference asset ${id} is missing fonts`)
    }
    if (!Array.isArray(candidate['masks'])) {
      errors.push(`Reference asset ${id} is missing masks`)
    }
    if (typeof candidate['dpr'] !== 'number' || candidate['dpr'] <= 0) {
      errors.push(`Reference asset ${id} has an invalid dpr`)
    }
    const viewport = candidate['viewport']
    if (
      !isRecord(viewport) ||
      typeof viewport['width'] !== 'number' ||
      viewport['width'] <= 0 ||
      typeof viewport['height'] !== 'number' ||
      viewport['height'] <= 0
    ) {
      errors.push(`Reference asset ${id} has an invalid viewport`)
    }
    const tolerance = candidate['tolerance']
    if (
      !isRecord(tolerance) ||
      typeof tolerance['threshold'] !== 'number' ||
      tolerance['threshold'] < 0 ||
      typeof tolerance['maxDiffPixelRatio'] !== 'number' ||
      tolerance['maxDiffPixelRatio'] < 0
    ) {
      errors.push(`Reference asset ${id} has an invalid tolerance`)
    }
  }
  return errors
}

export function validateAcceptanceChecklist(
  source: string,
  requirementTitles: readonly string[],
  commandIds: readonly string[],
): string[] {
  const errors: string[] = []
  const requirementRows = requirementTitles.filter((title) => source.includes(`| ${title} |`))
  if (!arraysEqual(requirementRows, requirementTitles)) {
    errors.push('Acceptance checklist must map every current OpenSpec requirement')
  }

  const checklistCommandIds = rowIds(source, /^\| `CMD-\d{3}` \| `([^`]+)` \|/u)
  if (!arraysEqual(checklistCommandIds, commandIds)) {
    errors.push('Acceptance checklist command rows must match the 80-command inventory in order')
  }
  const componentIds = rowIds(source, /^\| `(component\.[^`]+)` \|/u)
  if (!arraysEqual(componentIds, EXPECTED_COMPONENT_IDS)) {
    errors.push('Acceptance checklist must map every frozen component in order')
  }
  const uaIds = rowIds(source, /^\| `(UA-\d{3})` \|/u)
  if (!arraysEqual(uaIds, EXPECTED_UA_IDS)) {
    errors.push('Acceptance checklist must map every UA finding in order')
  }
  const crossCuttingIds = rowIds(source, /^\| `(X-\d{2})` \|/u)
  const expectedCrossCuttingIds = Array.from(
    { length: 9 },
    (_, index) => `X-${String(index + 1).padStart(2, '0')}`,
  )
  if (!arraysEqual(crossCuttingIds, expectedCrossCuttingIds)) {
    errors.push('Acceptance checklist must map all nine cross-cutting routes in order')
  }
  if (
    !source.includes('Task 18.9 stays open') ||
    !source.includes('All 74 requirement-derived checks') ||
    !source.includes('All 80 public command checks') ||
    !source.includes('All 40 named parity component checks') ||
    !source.includes('User explicitly confirms the whole first-round editor')
  ) {
    errors.push('Acceptance checklist completion and user-acceptance policy is incomplete')
  }
  return errors
}
