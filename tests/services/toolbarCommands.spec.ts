import { describe, expect, it } from 'vitest'

import { CommandRegistry } from '../../src/services/commandRegistry'
import { TOOLBAR_MENU_DESCRIPTORS, createToolbarCommandDescriptors } from '../../src/services/toolbarCommands'

describe('toolbar command descriptors', () => {
  it('describes the complete visible inventory with presentation and verification metadata', () => {
    const registry = new CommandRegistry(createToolbarCommandDescriptors())

    expect(registry.list()).toHaveLength(80)
    expect(new Set(registry.list().map((command) => command.id)).size).toBe(80)
    for (const command of registry.list()) {
      expect(command.icon.length).toBeGreaterThan(0)
      expect(command.labels.en.length).toBeGreaterThan(0)
      expect(command.labels.zh.length).toBeGreaterThan(0)
      expect(command.labels.ru.length).toBeGreaterThan(0)
      expect(command.selection.length).toBeGreaterThan(0)
      expect(command.verification.matrixId).toBe(command.id)
      expect(command.verification.automatedEvidence).toHaveLength(2)
    }
  })

  it('places commands in the frozen Cherry menu hierarchy and exposes official icon tokens', () => {
    const declaredMenus = new Set<string>(TOOLBAR_MENU_DESCRIPTORS.map((menu) => menu.id))
    const descriptors = createToolbarCommandDescriptors()

    for (const command of descriptors.filter((candidate) => candidate.surface.control === 'menu-item')) {
      expect(command.surface.menuId).not.toBeNull()
      expect(declaredMenus.has(command.surface.menuId ?? '')).toBe(true)
    }
    expect(TOOLBAR_MENU_DESCRIPTORS.map((menu) => menu.id)).toEqual([
      'text-style',
      'color',
      'heading',
      'panel',
      'alignment',
      'insert',
      'mermaid',
      'chart',
      'theme',
      'language',
      'export',
    ])
    expect(TOOLBAR_MENU_DESCRIPTORS.every((menu) => menu.region === 'main')).toBe(true)

    const byId = new Map(descriptors.map((command) => [command.id, command]))
    expect(byId.get('text.strike')?.surface.menuId).toBe('text-style')
    expect(byId.get('text.underline')?.surface.menuId).toBe('text-style')
    expect(byId.get('text.subscript')?.surface.menuId).toBe('text-style')
    expect(byId.get('text.superscript')?.surface.menuId).toBe('text-style')
    expect(byId.get('text.ruby')?.surface.menuId).toBe('text-style')
    expect(byId.get('block.quote')?.surface.menuId).toBe('text-style')
    expect(byId.get('block.quote')?.icon).toBe('>')
    expect(byId.get('text.color')?.surface.menuId).toBe('color')
    expect(byId.get('text.background')?.surface.menuId).toBe('color')
    expect(byId.has('export.word')).toBe(false)
    expect(byId.has('insert.word')).toBe(true)
    expect(byId.get('insert.reference')).toMatchObject({ icon: 'Ref', surface: { menuId: 'insert' } })
    expect(byId.get('insert.table')?.surface.menuId).toBe('insert')
    expect(byId.get('layout.accordion')?.surface.control).toBe('button')
    expect(byId.get('mermaid.flowchart')?.surface.menuId).toBe('mermaid')
    expect(byId.get('chart.line')?.surface.menuId).toBe('chart')

    expect(byId.get('text.bold')?.iconClass).toBe('ch-icon-bold')
    expect(byId.get('text.italic')?.iconClass).toBe('ch-icon-italic')
    expect(byId.get('list.ordered')?.iconClass).toBe('ch-icon-ol')
    expect(byId.get('history.undo')?.iconClass).toBe('ch-icon-undo')
    expect(byId.get('settings.shortcuts')?.iconClass).toBe('ch-icon-command')
    expect(byId.get('search.replace')?.iconClass).toBe('ch-icon-search')
    expect(byId.get('application.fullscreen')?.iconClass).toBe('ch-icon-fullscreen')

    const menus = new Map(TOOLBAR_MENU_DESCRIPTORS.map((menu) => [menu.id, menu]))
    expect(menus.get('text-style')?.iconClass).toBe('ch-icon-strike')
    expect(menus.get('color')?.iconClass).toBe('ch-icon-color')
    expect(menus.get('heading')?.iconClass).toBe('ch-icon-header')
    expect(menus.get('panel')?.iconClass).toBe('ch-icon-tips')
    expect(menus.get('alignment')?.iconClass).toBe('ch-icon-align')
    expect(menus.get('chart')?.iconClass).toBe('ch-icon-insertLineChart')
    expect(menus.get('theme')?.iconClass).toBe('ch-icon-main-theme')
  })

  it('declares semantic-node context actions through the same stable command identity', () => {
    const descriptors = createToolbarCommandDescriptors()
    const code = descriptors.find((command) => command.id === 'insert.code-block')
    const formula = descriptors.find((command) => command.id === 'insert.formula')
    const image = descriptors.find((command) => command.id === 'insert.image')

    expect(code?.contextualFor).toEqual(['code-block'])
    expect(code?.selection).toContain('semantic-node')
    expect(formula?.selection).toContain('semantic-node')
    expect(image?.selection).not.toContain('semantic-node')
  })
})
