import type { UiMessageKey } from './uiLocalization'

export type FormulaSymbolCategory = 'greek' | 'operators' | 'relations' | 'arrows'

export interface FormulaSymbol {
  readonly id: string
  readonly category: FormulaSymbolCategory
  readonly labelKey: UiMessageKey
  readonly source: string
}

type FormulaSymbolStorage = Pick<Storage, 'getItem' | 'setItem'>

export const FORMULA_SYMBOL_CATEGORIES: readonly Readonly<{ id: FormulaSymbolCategory; labelKey: UiMessageKey }>[] = Object.freeze([
  Object.freeze({ id: 'greek', labelKey: 'formula.symbolsGreek' }),
  Object.freeze({ id: 'operators', labelKey: 'formula.symbolsOperators' }),
  Object.freeze({ id: 'relations', labelKey: 'formula.symbolsRelations' }),
  Object.freeze({ id: 'arrows', labelKey: 'formula.symbolsArrows' }),
])

function symbol(id: string, category: FormulaSymbolCategory, labelKey: UiMessageKey): FormulaSymbol {
  return Object.freeze({ id, category, labelKey, source: `\\${id}` })
}

export const FORMULA_SYMBOLS: readonly FormulaSymbol[] = Object.freeze([
  symbol('alpha', 'greek', 'formula.symbol.alpha'),
  symbol('beta', 'greek', 'formula.symbol.beta'),
  symbol('gamma', 'greek', 'formula.symbol.gamma'),
  symbol('delta', 'greek', 'formula.symbol.delta'),
  symbol('epsilon', 'greek', 'formula.symbol.epsilon'),
  symbol('zeta', 'greek', 'formula.symbol.zeta'),
  symbol('eta', 'greek', 'formula.symbol.eta'),
  symbol('theta', 'greek', 'formula.symbol.theta'),
  symbol('iota', 'greek', 'formula.symbol.iota'),
  symbol('kappa', 'greek', 'formula.symbol.kappa'),
  symbol('lambda', 'greek', 'formula.symbol.lambda'),
  symbol('mu', 'greek', 'formula.symbol.mu'),
  symbol('nu', 'greek', 'formula.symbol.nu'),
  symbol('xi', 'greek', 'formula.symbol.xi'),
  symbol('pi', 'greek', 'formula.symbol.pi'),
  symbol('rho', 'greek', 'formula.symbol.rho'),
  symbol('sigma', 'greek', 'formula.symbol.sigma'),
  symbol('tau', 'greek', 'formula.symbol.tau'),
  symbol('upsilon', 'greek', 'formula.symbol.upsilon'),
  symbol('phi', 'greek', 'formula.symbol.phi'),
  symbol('chi', 'greek', 'formula.symbol.chi'),
  symbol('psi', 'greek', 'formula.symbol.psi'),
  symbol('omega', 'greek', 'formula.symbol.omega'),
  symbol('Gamma', 'greek', 'formula.symbol.Gamma'),
  symbol('Delta', 'greek', 'formula.symbol.Delta'),
  symbol('Theta', 'greek', 'formula.symbol.Theta'),
  symbol('Lambda', 'greek', 'formula.symbol.Lambda'),
  symbol('Xi', 'greek', 'formula.symbol.Xi'),
  symbol('Pi', 'greek', 'formula.symbol.Pi'),
  symbol('Sigma', 'greek', 'formula.symbol.Sigma'),
  symbol('Upsilon', 'greek', 'formula.symbol.Upsilon'),
  symbol('Phi', 'greek', 'formula.symbol.Phi'),
  symbol('Psi', 'greek', 'formula.symbol.Psi'),
  symbol('Omega', 'greek', 'formula.symbol.Omega'),
  symbol('varepsilon', 'greek', 'formula.symbol.varepsilon'),
  symbol('vartheta', 'greek', 'formula.symbol.vartheta'),
  symbol('varphi', 'greek', 'formula.symbol.varphi'),
  symbol('pm', 'operators', 'formula.symbol.pm'),
  symbol('mp', 'operators', 'formula.symbol.mp'),
  symbol('times', 'operators', 'formula.symbol.times'),
  symbol('div', 'operators', 'formula.symbol.div'),
  symbol('cdot', 'operators', 'formula.symbol.cdot'),
  symbol('ast', 'operators', 'formula.symbol.ast'),
  symbol('circ', 'operators', 'formula.symbol.circ'),
  symbol('sum', 'operators', 'formula.symbol.sum'),
  symbol('prod', 'operators', 'formula.symbol.prod'),
  symbol('int', 'operators', 'formula.symbol.int'),
  symbol('le', 'relations', 'formula.symbol.le'),
  symbol('ge', 'relations', 'formula.symbol.ge'),
  symbol('ne', 'relations', 'formula.symbol.ne'),
  symbol('approx', 'relations', 'formula.symbol.approx'),
  symbol('equiv', 'relations', 'formula.symbol.equiv'),
  symbol('propto', 'relations', 'formula.symbol.propto'),
  symbol('sim', 'relations', 'formula.symbol.sim'),
  symbol('ll', 'relations', 'formula.symbol.ll'),
  symbol('gg', 'relations', 'formula.symbol.gg'),
  symbol('leftarrow', 'arrows', 'formula.symbol.leftarrow'),
  symbol('rightarrow', 'arrows', 'formula.symbol.rightarrow'),
  symbol('leftrightarrow', 'arrows', 'formula.symbol.leftrightarrow'),
  symbol('Leftarrow', 'arrows', 'formula.symbol.Leftarrow'),
  symbol('Rightarrow', 'arrows', 'formula.symbol.Rightarrow'),
  symbol('Leftrightarrow', 'arrows', 'formula.symbol.Leftrightarrow'),
  symbol('uparrow', 'arrows', 'formula.symbol.uparrow'),
  symbol('downarrow', 'arrows', 'formula.symbol.downarrow'),
  symbol('mapsto', 'arrows', 'formula.symbol.mapsto'),
])

const SYMBOLS_BY_ID = new Map(FORMULA_SYMBOLS.map(value => [value.id, value]))

export function formulaSymbolById(id: string): FormulaSymbol | undefined {
  return SYMBOLS_BY_ID.get(id)
}

export const RECENT_FORMULA_SYMBOLS_KEY = 'w-editor:formula-recent-symbols:v1'
export const MAX_RECENT_FORMULA_SYMBOLS = 12

function validatedRecentIds(ids: readonly unknown[]): readonly string[] {
  const recent: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || !SYMBOLS_BY_ID.has(id) || recent.includes(id)) continue
    recent.push(id)
    if (recent.length === MAX_RECENT_FORMULA_SYMBOLS) break
  }
  return Object.freeze(recent)
}

function resolveStorage(storage: FormulaSymbolStorage | null | undefined): FormulaSymbolStorage | null {
  if (storage !== undefined) return storage
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readRecentFormulaSymbolIds(storage?: FormulaSymbolStorage | null): readonly string[] {
  try {
    const raw = resolveStorage(storage)?.getItem(RECENT_FORMULA_SYMBOLS_KEY)
    if (raw === null || raw === undefined) return Object.freeze([])
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? validatedRecentIds(parsed) : Object.freeze([])
  } catch {
    return Object.freeze([])
  }
}

export function rememberFormulaSymbol(
  recentIds: readonly string[],
  id: string,
  storage?: FormulaSymbolStorage | null,
): readonly string[] {
  if (!SYMBOLS_BY_ID.has(id)) return validatedRecentIds(recentIds)
  const recent = validatedRecentIds([id, ...recentIds])
  try {
    resolveStorage(storage)?.setItem(RECENT_FORMULA_SYMBOLS_KEY, JSON.stringify(recent))
  } catch {
    // Storage is optional: a blocked getter or failed write must not block insertion.
  }
  return recent
}
