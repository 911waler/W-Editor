import { describe, expect, it } from 'vitest'

import { renumberBlockFormulas } from '../../packages/editor-vue/src/services/formulaNumbering'

describe('document formula numbering', () => {
  it('repairs stale duplicate labels and leaves a repeated pass free of DOM mutations', () => {
    const root = document.createElement('div')
    root.innerHTML = '<figure class="formula-node--block" data-formula-number="9"><span class="formula-rendered">a</span><span class="formula-node__number">(9)</span><span class="formula-node__number">(10)</span></figure><div class="Cherry-Math">b</div><span class="formula-node--inline">inline</span><div class="formula-rendered--block">dialog preview</div>'
    renumberBlockFormulas(root)
    expect([...root.querySelectorAll('.formula-node__number')].map(label => label.textContent)).toEqual(['(1)', '(2)'])
    expect(root.querySelector('.formula-node--inline .formula-node__number, .formula-rendered--block .formula-node__number')).toBeNull()
    expect(root.querySelector('.formula-rendered')?.textContent).toBe('a')
    const observer = new MutationObserver(() => undefined)
    observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true })
    try {
      renumberBlockFormulas(root)
      expect(observer.takeRecords()).toEqual([])
    } finally { observer.disconnect() }
  })
})

it('derives reference labels and native anchors from unique current block identities', () => {
  const root = document.createElement('div')
  root.innerHTML = '<a data-formula-reference-target="a">stale</a><figure class="formula-node--block" data-formula-id="a"></figure>'
  renumberBlockFormulas(root)
  expect(root.querySelector('a')?.textContent).toBe('Equation 1')
  expect(root.querySelector('a')?.getAttribute('href')).toBe('#wformula-a')
  expect(root.querySelector('figure')?.id).toBe('wformula-a')
  root.append(root.querySelector('figure')!.cloneNode(true))
  renumberBlockFormulas(root)
  expect(root.querySelector('a')?.textContent).toBe('Equation (unavailable)')
  expect(root.querySelector('a')?.hasAttribute('href')).toBe(false)
  expect(root.querySelectorAll('[id="wformula-a"]')).toHaveLength(0)
})

it('updates formula labels through the legacy renderer locale refresh', async () => {
  const { updateRendererLabels } = await import('../../packages/editor-vue/src/rendering/rendererHydration')
  const root = document.createElement('div')
  root.innerHTML = '<a data-formula-reference-target="a"></a><figure class="formula-node--block" data-formula-id="a"></figure>'
  updateRendererLabels(root, 'zh')
  expect(root.querySelector('a')?.textContent).toBe('公式 1')
  updateRendererLabels(root, 'ru')
  expect(root.querySelector('a')?.textContent).toBe('Формула 1')
})
