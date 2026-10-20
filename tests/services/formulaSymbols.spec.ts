import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FORMULA_SYMBOL_CATEGORIES,
  FORMULA_SYMBOLS,
  formulaSymbolById,
  readRecentFormulaSymbolIds,
  RECENT_FORMULA_SYMBOLS_KEY,
  rememberFormulaSymbol,
} from '../../packages/editor-vue/src/services/formulaSymbols'
import { renderSafeKatex } from '../../src/services/safeKatexRenderer'
import { translateUi, type UiMessageKey } from '../../src/services/uiLocalization'

const expectedCommands = {
  greek: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega varepsilon vartheta varphi',
  operators: 'pm mp times div cdot ast circ sum prod int',
  relations: 'le ge ne approx equiv propto sim ll gg',
  arrows: 'leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow uparrow downarrow mapsto',
}

function stored(value: string | null) {
  const values = new Map<string, string>()
  if (value !== null) values.set(RECENT_FORMULA_SYMBOLS_KEY, value)
  return {
    values,
    get length() { return values.size },
    clear: () => { values.clear() },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, next: string) => { values.set(key, next) },
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('formula symbol catalog', () => {
  it('provides the approved commands in the four usable categories without duplicate IDs', () => {
    expect(FORMULA_SYMBOL_CATEGORIES.map(category => category.id)).toEqual(['greek', 'operators', 'relations', 'arrows'])
    expect(FORMULA_SYMBOLS).toHaveLength(65)
    expect(new Set(FORMULA_SYMBOLS.map(symbol => symbol.id)).size).toBe(65)
    for (const [category, commands] of Object.entries(expectedCommands)) {
      expect(FORMULA_SYMBOLS.filter(symbol => symbol.category === category).map(symbol => symbol.source))
        .toEqual(commands.split(' ').map(command => `\\${command}`))
    }
  })

  it('looks up only known command IDs and rejects arbitrary source or object prototype names', () => {
    expect(formulaSymbolById('alpha')).toMatchObject({ id: 'alpha', category: 'greek', source: '\\alpha' })
    expect(formulaSymbolById('Leftarrow')).toMatchObject({ id: 'Leftarrow', category: 'arrows', source: '\\Leftarrow' })
    for (const id of ['unknown', '\\href{javascript:bad}{x}', '__proto__', 'constructor', ' alpha', 'ALPHA']) {
      expect(formulaSymbolById(id)).toBeUndefined()
    }
  })

  it('renders every supplied command safely in both formula modes', () => {
    expect(FORMULA_SYMBOLS).toHaveLength(65)
    for (const symbol of FORMULA_SYMBOLS) {
      for (const mode of ['inline', 'block'] as const) {
        const rendered = renderSafeKatex(mode, symbol.source)
        expect(rendered.status, `${mode}: ${symbol.id}`).toBe('ready')
        expect(rendered.html).toContain('class="katex"')
      }
    }
  })

  it.each(['zh', 'en', 'ru'] as const)('supplies localized names for the catalog and recent controls in %s', locale => {
    expect(FORMULA_SYMBOLS).toHaveLength(65)
    const keys: readonly UiMessageKey[] = [
      'formula.specialSymbols', 'formula.recentSymbols', 'formula.noRecentSymbols',
      ...FORMULA_SYMBOL_CATEGORIES.map(category => category.labelKey),
      ...FORMULA_SYMBOLS.map(symbol => symbol.labelKey),
    ]
    for (const key of keys) {
      const translated = translateUi(locale, key)
      expect(translated.trim(), `${locale}: ${key}`).not.toBe('')
      expect(translated).not.toBe(key)
      if (locale === 'zh') expect(translated).toMatch(/\p{Script=Han}/u)
      if (locale === 'ru') expect(translated).toMatch(/\p{Script=Cyrillic}/u)
    }
  })
})

describe('recent formula symbols', () => {
  it('reads a unique catalog whitelist from persisted JSON in original order', () => {
    const storage = stored('["alpha","__proto__","alpha",null,7,{"source":"secret"},"\\\\bad","beta","Leftarrow"]')
    expect(readRecentFormulaSymbolIds(storage)).toEqual(['alpha', 'beta', 'Leftarrow'])
    expect(storage.values.size).toBe(1)
  })

  it.each([null, '{malformed', '{}', '"alpha"', 'null', '42', '["arbitrary LaTeX"]'])('ignores corrupt or absent persisted recents: %s', raw => {
    expect(readRecentFormulaSymbolIds(stored(raw))).toEqual([])
  })

  it('moves reused IDs first, caps both read and write at 12, and persists only known IDs', () => {
    const storage = stored(null)
    const ids = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi'.split(' ')
    expect(readRecentFormulaSymbolIds(stored(JSON.stringify(ids)))).toEqual(ids.slice(0, 12))
    let recent: readonly string[] = []
    for (const id of ids) recent = rememberFormulaSymbol(recent, id, storage)
    expect(recent).toEqual(['xi', 'nu', 'mu', 'lambda', 'kappa', 'iota', 'theta', 'eta', 'zeta', 'epsilon', 'delta', 'gamma'])
    recent = rememberFormulaSymbol(recent, 'theta', storage)
    expect(recent).toEqual(['theta', 'xi', 'nu', 'mu', 'lambda', 'kappa', 'iota', 'eta', 'zeta', 'epsilon', 'delta', 'gamma'])
    expect(storage.values.get(RECENT_FORMULA_SYMBOLS_KEY)).toBe('["theta","xi","nu","mu","lambda","kappa","iota","eta","zeta","epsilon","delta","gamma"]')
    expect([...storage.values.keys()]).toEqual([RECENT_FORMULA_SYMBOLS_KEY])
  })

  it('sanitizes in-memory IDs without persisting invalid insertion requests or formula text', () => {
    const storage = stored('["beta"]')
    const original = ['alpha', 'secret formula text', 'alpha', 'beta']
    expect(rememberFormulaSymbol(original, 'secret formula text', storage)).toEqual(['alpha', 'beta'])
    expect(storage.getItem(RECENT_FORMULA_SYMBOLS_KEY)).toBe('["beta"]')
    expect(rememberFormulaSymbol(original, 'gamma', storage)).toEqual(['gamma', 'alpha', 'beta'])
    expect(storage.getItem(RECENT_FORMULA_SYMBOLS_KEY)).toBe('["gamma","alpha","beta"]')
    expect(original).toEqual(['alpha', 'secret formula text', 'alpha', 'beta'])
  })

  it('survives blocked read and write methods while maintaining usable in-memory recents', () => {
    const blocked = {
      getItem: () => { throw new Error('read blocked') },
      setItem: () => { throw new Error('quota exceeded') },
    }
    expect(readRecentFormulaSymbolIds(blocked)).toEqual([])
    expect(rememberFormulaSymbol(['alpha'], 'beta', blocked)).toEqual(['beta', 'alpha'])
  })

  it('survives throwing storage method getters', () => {
    const blocked = {
      get getItem(): Storage['getItem'] { throw new Error('getter blocked') },
      get setItem(): Storage['setItem'] { throw new Error('getter blocked') },
    }
    expect(readRecentFormulaSymbolIds(blocked)).toEqual([])
    expect(rememberFormulaSymbol(['alpha'], 'beta', blocked)).toEqual(['beta', 'alpha'])
  })

  it('falls back to localStorage only for undefined storage and tolerates its blocked getter', () => {
    const storage = stored('["alpha"]')
    const getter = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage)
    expect(readRecentFormulaSymbolIds()).toEqual(['alpha'])
    expect(rememberFormulaSymbol(['alpha'], 'beta')).toEqual(['beta', 'alpha'])
    expect(storage.getItem(RECENT_FORMULA_SYMBOLS_KEY)).toBe('["beta","alpha"]')
    expect(readRecentFormulaSymbolIds(null)).toEqual([])
    expect(rememberFormulaSymbol(['alpha'], 'gamma', null)).toEqual(['gamma', 'alpha'])
    expect(storage.getItem(RECENT_FORMULA_SYMBOLS_KEY)).toBe('["beta","alpha"]')
    getter.mockImplementation(() => { throw new Error('storage forbidden') })
    expect(readRecentFormulaSymbolIds()).toEqual([])
    expect(rememberFormulaSymbol(['alpha'], 'beta')).toEqual(['beta', 'alpha'])
  })
})
