import { describe, expect, it, vi } from 'vitest'
import {
  createUiLocalizationStore,
  translateUi,
  type UiLocale,
} from '../../src/services/uiLocalization'

describe('UI localization', () => {
  it.each<[UiLocale, string]>([
    ['zh', '应用'],
    ['en', 'Apply'],
    ['ru', 'Применить'],
  ])('translates common.apply in %s', (locale, expected) => {
    expect(translateUi(locale, 'common.apply')).toBe(expected)
  })

  it.each<[UiLocale, string]>([
    ['zh', '目录已存在。'],
    ['en', 'Table of contents already exists.'],
    ['ru', 'Оглавление уже существует.'],
  ])('translates toc.alreadyExists in %s', (locale, expected) => {
    expect(translateUi(locale, 'toc.alreadyExists')).toBe(expected)
  })

  it.each<[UiLocale, string]>([
    ['zh', '已插入目录。'],
    ['en', 'Table of contents inserted.'],
    ['ru', 'Оглавление вставлено.'],
  ])('translates toc.inserted in %s', (locale, expected) => {
    expect(translateUi(locale, 'toc.inserted')).toBe(expected)
  })

  it('interpolates named values and rejects missing values', () => {
    expect(translateUi('zh', 'search.resultCount', { current: 2, total: 5 })).toBe('第 2 项，共 5 项')
    expect(() => translateUi('en', 'search.resultCount', { current: 2 })).toThrow(/total/u)
  })

  it('notifies once per actual locale change and supports unsubscribe', () => {
    const store = createUiLocalizationStore('zh')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.setLocale('en')
    store.setLocale('en')
    unsubscribe()
    store.setLocale('ru')
    expect(store.locale).toBe('ru')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('en')
  })
})
