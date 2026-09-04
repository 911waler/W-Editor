import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import DesktopApp from '../src/DesktopApp.vue'
import { clearMocks, mockIPC, mockWindows } from '../node_modules/@tauri-apps/api/mocks.js'

const DATA_ROOT_STATUS = Object.freeze({
  librarySchemaVersion: 2,
  message: null,
  root: 'G:\\W-EditorData',
  state: 'ready',
  writeProbe: true,
})

let currentDataRootStatus: Readonly<Record<string, unknown>> = DATA_ROOT_STATUS
let dialogResults: Array<string | null | Error> = []
const ipcCalls: Array<Readonly<{ command: string; payload: unknown }>> = []

const ARTICLE = Object.freeze({
  createdAt: '2026-01-15T11:00:00.000Z',
  deletedAt: null,
  documentId: 'desktop-article',
  markdown: '# Desktop article\n\nBody',
  revision: 3,
  seedKey: null,
  title: 'Desktop article',
  updatedAt: '2026-01-15T11:30:00.000Z',
})

beforeEach(() => {
  currentDataRootStatus = DATA_ROOT_STATUS
  dialogResults = []
  ipcCalls.length = 0
  mockWindows('main')
  mockIPC(async (command: string, payload) => {
    ipcCalls.push(Object.freeze({ command, payload }))
    if (command === 'plugin:dialog|open' || command === 'plugin:dialog|save') {
      const result = dialogResults.shift() ?? null
      if (result instanceof Error) throw result
      return result
    }
    if (command === 'data_root_status') return currentDataRootStatus
    if (command === 'library_seed_catalog') return Object.freeze([])
    if (command === 'library_list_articles') return Object.freeze([ARTICLE])
    if (command === 'recovery_load_draft') return null
    if (command === 'workspace_load_state') {
      return Object.freeze({
        documentId: ARTICLE.documentId,
        mode: 'visual',
        scroll: null,
        sidebar: Object.freeze({ open: true, width: 252 }),
        updatedAt: '2026-01-15T11:45:00.000Z',
      })
    }
    if (command === 'settings_get') {
      return Object.freeze({ resolved: Object.freeze({ lineSpacing: 'normal', theme: 'gray' }) })
    }
    if (command === 'desktop_release_info') {
      return Object.freeze({
        automaticUpdate: false,
        downloadUrl: null,
        productName: 'W-Editor',
        signed: false,
        updateMode: 'manual',
        version: '0.1.0',
      })
    }
    if (command === 'startup_file_requests') return Object.freeze([])
    return undefined
  }, { shouldMockEvents: true })
})

afterEach(() => {
  clearMocks()
  document.body.replaceChildren()
  delete document.documentElement.dataset['desktopReady']
})

async function mountReadyDesktop() {
  const wrapper = mount(DesktopApp, { attachTo: document.body })
  for (let index = 0; index < 4; index += 1) await flushPromises()
  expect(document.documentElement.dataset['desktopReady'], wrapper.text()).toBe('true')
  return wrapper
}

async function mountUnconfiguredDesktop() {
  currentDataRootStatus = Object.freeze({
    librarySchemaVersion: 0,
    message: null,
    root: null,
    state: 'unconfigured',
    writeProbe: false,
  })
  const wrapper = mount(DesktopApp, { attachTo: document.body })
  for (let index = 0; index < 4; index += 1) await flushPromises()
  expect(wrapper.find('[data-testid="desktop-data-root-setup"]').exists()).toBe(true)
  return wrapper
}

async function chooseLanguage(wrapper: Awaited<ReturnType<typeof mountReadyDesktop>>, locale: 'en' | 'ru'): Promise<void> {
  await wrapper.get('[data-toolbar-menu="language"] .toolbar-menu__trigger').trigger('click')
  await wrapper.get(`[data-command-id="language.${locale}"]`).trigger('pointerdown')
  await wrapper.get(`[data-command-id="language.${locale}"]`).trigger('click')
  await flushPromises()
}

describe('UAT-DTR-021 Desktop shell information architecture', () => {
  it('keeps only Library status and Reader above the workspace while routing details to their owners', async () => {
    const wrapper = await mountReadyDesktop()

    const primaryBar = wrapper.get('[data-testid="desktop-primary-bar"]')
    expect(primaryBar.get('[data-testid="desktop-library-status"]').text()).toContain('G:\\W-EditorData')
    expect(primaryBar.find('[data-testid="desktop-reader-entry"]').exists()).toBe(true)
    expect(primaryBar.find('[data-testid="desktop-data-root-entry"]').exists()).toBe(false)
    expect(primaryBar.find('[data-testid="desktop-settings-entry"]').exists()).toBe(false)
    expect(primaryBar.find('[data-testid="desktop-update-entry"]').exists()).toBe(false)
    expect(primaryBar.text()).not.toContain('W-EDITOR DESKTOP')
    expect(wrapper.find('.desktop-header-panel').exists()).toBe(false)

    const library = wrapper.get('[data-testid="desktop-library-sidebar"]')
    expect(library.get('[data-testid="desktop-library-article"]').text()).toContain(ARTICLE.title)
    expect(library.find('[data-testid="desktop-recent-activity"]').exists()).toBe(false)
    expect(library.find('[data-testid="clear-document"]').exists()).toBe(false)
    expect(library.find('[data-testid="reset-document"]').exists()).toBe(false)
    expect(library.find('[data-testid="restore-pre-mode-switch"]').exists()).toBe(false)
    expect(library.find('[data-testid="restore-pre-destructive-replace"]').exists()).toBe(false)
    const toolbar = wrapper.get('.toolbar-region')
    const settingsSlot = toolbar.get('[data-testid="desktop-settings-toolbar-slot"]')
    const settingsEntry = toolbar.get('[data-testid="desktop-settings-entry"]')
    expect(settingsEntry.element.tagName).toBe('BUTTON')
    expect(settingsEntry.attributes('aria-label')).toBe('设置')
    expect(settingsEntry.attributes('title')).toBe('设置')
    expect(settingsEntry.get('.desktop-settings-icon').text()).toBe('⚙')
    const exportMenu = toolbar.get('[data-toolbar-menu="export"]')
    expect(exportMenu.element.compareDocumentPosition(settingsSlot.element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    const workspace = wrapper.get('.workspace-shell')
    const statusBar = wrapper.get('[data-testid="desktop-document-status"]')
    expect(statusBar.element.tagName).toBe('FOOTER')
    expect(statusBar.attributes('role')).toBe('status')
    expect(statusBar.attributes('aria-live')).toBe('polite')
    expect(workspace.element.compareDocumentPosition(statusBar.element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    await primaryBar.get('[data-testid="desktop-reader-entry"]').trigger('click')
    await flushPromises()
    const reader = wrapper.get('[data-testid="desktop-reader-parity"]')
    expect(reader.find('[data-presentation-engine="tiptap"] .ProseMirror').exists()).toBe(true)
    expect(reader.find('[data-semantic-edit]').exists()).toBe(false)
    await reader.get('[data-testid="desktop-reader-preview-close"]').trigger('click')

    ;(settingsEntry.element as HTMLButtonElement).focus()
    await settingsEntry.trigger('click')
    await flushPromises()
    const settings = wrapper.get('[data-testid="desktop-settings-destination"]')
    expect(settings.find('[data-testid="desktop-settings-migration"]').exists()).toBe(true)
    expect(settings.find('[data-testid="desktop-settings-updates"]').exists()).toBe(true)
    expect(settings.get('[data-testid="desktop-update-version"]').text()).toContain('0.1.0')
    expect(wrapper.find('.desktop-header-panel').exists()).toBe(false)

    const closeSettings = settings.get('[data-testid="desktop-settings-close"]')
    expect(document.activeElement).toBe(closeSettings.element)
    await closeSettings.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="desktop-settings-destination"]').exists()).toBe(false)
    expect(document.activeElement).toBe(settingsEntry.element)

    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await wrapper.get('#markdown-source').setValue('# Changed in Desktop')
    await flushPromises()
    expect(wrapper.get('[data-testid="desktop-save-state"]').text()).toContain('有未保存更改')
    expect(document.title).toMatch(/^\* /u)

    wrapper.unmount()
  })
})

describe('UAT-DTR-022 Desktop Settings modal', () => {
  it('opens a focus-contained modal with only data migration and release information', async () => {
    const wrapper = await mountReadyDesktop()
    const settingsEntry = wrapper.get('[data-testid="desktop-settings-entry"]')
    ;(settingsEntry.element as HTMLButtonElement).focus()

    await settingsEntry.trigger('click')
    await flushPromises()

    const backdrop = wrapper.get('[data-testid="desktop-settings-backdrop"]')
    const settings = backdrop.get('[data-testid="desktop-settings-destination"]')
    expect(settings.attributes('role')).toBe('dialog')
    expect(settings.attributes('aria-modal')).toBe('true')
    expect(settings.get('#desktop-settings-migration-title').text()).toBe('数据迁移')
    expect(settings.find('[data-testid="desktop-settings-migration"]').exists()).toBe(true)
    expect(settings.find('[data-testid="desktop-settings-updates"]').exists()).toBe(true)
    expect(settings.find('[data-testid="desktop-settings-data"]').exists()).toBe(false)
    expect(settings.find('[data-testid="desktop-data-root-path"]').exists()).toBe(false)
    expect(settings.find('[data-testid="desktop-refresh-data-root"]').exists()).toBe(false)
    expect(settings.find('[data-testid="desktop-uninstall-preview"]').exists()).toBe(false)
    expect(settings.find('[data-testid="desktop-settings-preferences"]').exists()).toBe(false)

    const close = settings.get('[data-testid="desktop-settings-close"]')
    const browse = settings.get('[data-testid="desktop-browse-migration-parent"]')
    expect(document.activeElement).toBe(close.element)

    ;(browse.element as HTMLButtonElement).focus()
    await settings.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(close.element)

    ;(close.element as HTMLButtonElement).focus()
    await settings.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(browse.element)

    await settings.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-testid="desktop-settings-backdrop"]').exists()).toBe(false)
    expect(document.activeElement).toBe(settingsEntry.element)

    await settingsEntry.trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="desktop-settings-backdrop"]').trigger('mousedown')
    await flushPromises()
    expect(wrapper.find('[data-testid="desktop-settings-backdrop"]').exists()).toBe(false)
    expect(document.activeElement).toBe(settingsEntry.element)

    wrapper.unmount()
  })
})

describe('UAT-DTR-024 Desktop daily Library and toolbar Settings boundary', () => {
  it('removes destructive/recovery buttons from Library and exposes Settings as a gear after Export', async () => {
    const wrapper = await mountReadyDesktop()
    const library = wrapper.get('[data-testid="desktop-library-sidebar"]')
    for (const selector of [
      '[data-testid="clear-document"]',
      '[data-testid="reset-document"]',
      '[data-testid="restore-pre-mode-switch"]',
      '[data-testid="restore-pre-destructive-replace"]',
    ]) {
      expect(library.find(selector).exists()).toBe(false)
    }

    const toolbar = wrapper.get('.toolbar-region')
    const exportMenu = toolbar.get('[data-toolbar-menu="export"]')
    const settingsSlot = toolbar.get('[data-testid="desktop-settings-toolbar-slot"]')
    const settingsEntry = toolbar.get('[data-testid="desktop-settings-entry"]')
    expect(exportMenu.element.compareDocumentPosition(settingsSlot.element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(settingsSlot.element.compareDocumentPosition(toolbar.get('[data-command-id="application.fullscreen"]').element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(settingsEntry.get('.desktop-settings-icon').text()).toBe('⚙')
    expect(settingsEntry.get('svg, .ch-icon, .desktop-settings-icon').exists()).toBe(true)
    expect(settingsEntry.attributes('aria-label')).toBe('设置')
    expect(settingsEntry.attributes('title')).toBe('设置')

    await settingsEntry.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="desktop-settings-destination"]').attributes('role')).toBe('dialog')
    await wrapper.get('[data-testid="desktop-settings-close"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(settingsEntry.element)
    wrapper.unmount()
  })
})

describe('UAT-DTR-025 Desktop native export destination', () => {
  it('opens the native save dialog and writes the generated artifact only to the selected path', async () => {
    dialogResults.push('D:\\Exports\\desktop-article.md')
    const wrapper = await mountReadyDesktop()

    await wrapper.get('[data-toolbar-menu="export"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="export.markdown"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="export.markdown"]').trigger('click')
    await flushPromises()

    const saveCall = ipcCalls.find(({ command }) => command === 'plugin:dialog|save')
    expect(saveCall?.payload).toMatchObject({
      options: {
        defaultPath: 'desktop-article.md',
        title: '保存导出文件',
      },
    })
    const writeCall = ipcCalls.find(({ command }) => command === 'export_write_file')
    expect(writeCall?.payload).toMatchObject({ destinationPath: 'D:\\Exports\\desktop-article.md' })
    const bytes = (writeCall?.payload as { bytes?: number[] } | undefined)?.bytes
    expect(new TextDecoder().decode(Uint8Array.from(bytes ?? []))).toBe(ARTICLE.markdown)
    wrapper.unmount()
  })

  it('does not write an export when the native save dialog is cancelled', async () => {
    dialogResults.push(null)
    const wrapper = await mountReadyDesktop()

    await wrapper.get('[data-toolbar-menu="export"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="export.markdown"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="export.markdown"]').trigger('click')
    await flushPromises()

    expect(ipcCalls.some(({ command }) => command === 'plugin:dialog|save')).toBe(true)
    expect(ipcCalls.some(({ command }) => command === 'export_write_file')).toBe(false)
    wrapper.unmount()
  })
})

describe('UAT-DTR-020 Desktop shell locale', () => {
  it('starts in Chinese and keeps an open Settings destination synchronized with the shared locale', async () => {
    const wrapper = await mountReadyDesktop()
    const workspace = wrapper.get('.workspace-shell').element

    expect(wrapper.get('[data-testid="desktop-reader-entry"]').text()).toBe('阅读')
    const settingsEntry = wrapper.get('[data-testid="desktop-settings-entry"]')
    expect(settingsEntry.attributes('aria-label')).toBe('设置')
    expect(wrapper.find('[data-testid="desktop-recent-activity"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="desktop-save-state"]').text()).toBe('保存：干净')

    await settingsEntry.trigger('click')
    await flushPromises()
    const settings = wrapper.get('[data-testid="desktop-settings-destination"]')
    const settingsElement = settings.element
    expect(settings.get('#desktop-settings-title').text()).toBe('设置')
    expect(settings.get('#desktop-settings-migration-title').text()).toBe('数据迁移')
    expect(settings.get('#desktop-settings-updates-title').text()).toBe('关于与更新')
    expect(settings.get('[data-testid="desktop-settings-close"]').text()).toBe('关闭')

    await chooseLanguage(wrapper, 'en')
    expect(wrapper.get('.workspace-shell').element).toBe(workspace)
    expect(wrapper.get('[data-testid="desktop-settings-destination"]').element).toBe(settingsElement)
    expect(wrapper.get('[data-testid="desktop-reader-entry"]').text()).toBe('Reader')
    expect(wrapper.get('[data-testid="desktop-settings-entry"]').attributes('aria-label')).toBe('Settings')
    expect(wrapper.get('#desktop-settings-migration-title').text()).toBe('Data migration')

    await chooseLanguage(wrapper, 'ru')
    expect(wrapper.get('.workspace-shell').element).toBe(workspace)
    expect(wrapper.get('[data-testid="desktop-settings-destination"]').element).toBe(settingsElement)
    expect(wrapper.get('[data-testid="desktop-reader-entry"]').text()).toBe('Чтение')
    expect(wrapper.get('[data-testid="desktop-settings-entry"]').attributes('aria-label')).toBe('Настройки')
    expect(wrapper.get('#desktop-settings-migration-title').text()).toBe('Перенос данных')

    wrapper.unmount()
  })
})

describe('UAT-DTR-019 native Data Root directory selection', () => {
  it('selects or preserves first-use and migration parent paths through the Tauri dialog boundary', async () => {
    dialogResults.push('G:\\Picked parent')
    let wrapper = await mountUnconfiguredDesktop()
    const firstUseInput = wrapper.get('[data-testid="desktop-data-root-parent"]')
    await firstUseInput.setValue('C:\\Manual parent')
    await wrapper.get('[data-testid="desktop-browse-data-root"]').trigger('click')
    await flushPromises()
    expect((firstUseInput.element as HTMLInputElement).value).toBe('G:\\Picked parent')
    expect(ipcCalls.at(-1)).toMatchObject({
      command: 'plugin:dialog|open',
      payload: { options: { directory: true, multiple: false } },
    })

    dialogResults.push(null)
    await firstUseInput.setValue('C:\\Keep this parent')
    await wrapper.get('[data-testid="desktop-browse-data-root"]').trigger('click')
    await flushPromises()
    expect((firstUseInput.element as HTMLInputElement).value).toBe('C:\\Keep this parent')

    dialogResults.push(new Error('picker denied'))
    await wrapper.get('[data-testid="desktop-browse-data-root"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="desktop-folder-picker-error"]').text()).toContain('无法打开文件夹选择窗口')
    expect((firstUseInput.element as HTMLInputElement).value).toBe('C:\\Keep this parent')

    wrapper.unmount()
    document.body.replaceChildren()
    currentDataRootStatus = DATA_ROOT_STATUS
    dialogResults.push('G:\\Migration parent')
    wrapper = await mountReadyDesktop()
    await wrapper.get('[data-testid="desktop-settings-entry"]').trigger('click')
    await flushPromises()
    const migrationInput = wrapper.get('[data-testid="desktop-migration-parent"]')
    await migrationInput.setValue('C:\\Existing migration parent')
    await wrapper.get('[data-testid="desktop-browse-migration-parent"]').trigger('click')
    await flushPromises()
    expect((migrationInput.element as HTMLInputElement).value).toBe('G:\\Migration parent')

    dialogResults.push(null)
    await migrationInput.setValue('C:\\Keep migration parent')
    await wrapper.get('[data-testid="desktop-browse-migration-parent"]').trigger('click')
    await flushPromises()
    expect((migrationInput.element as HTMLInputElement).value).toBe('C:\\Keep migration parent')

    wrapper.unmount()
  })
})
