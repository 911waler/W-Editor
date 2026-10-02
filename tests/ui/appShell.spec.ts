import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import App from '../../src/ui/App.vue'
import {
  PANEL_DESCRIPTORS,
  chartTableStarterSource,
  columnLayoutStarterSource,
  disclosureStarterSource,
  formatRichInlineMark,
  mermaidStarterSource,
  panelStarterSource,
  referenceMarkdown,
  timelineStarterSource,
  type RichInlineMarkCommandId,
} from '../../src/codecs'
import { BrowserRenderedExportError, type RenderedExportAdapter } from '../../src/services'
import { ArticleCatalogAdapter } from '../../src/services/articleCatalog'
import CodeMirrorSourceEditorHost from '../../src/ui/CodeMirrorSourceEditorHost.vue'

type AppWrapper = ReturnType<typeof mount>
type TestLocale = 'zh' | 'en' | 'ru'

const PRODUCT_NOTES_MARKDOWN = new ArticleCatalogAdapter().lookup('product-notes')?.initialMarkdown ?? ''

function seedArticleAutosave(documentId: string, markdown: string, savedAt: Date): void {
  window.localStorage.setItem(`w-editor:v1:document:${encodeURIComponent(documentId)}`, JSON.stringify({
    autosave: { markdown, revision: 1, savedAt: savedAt.toISOString() },
    documentId,
    manualCheckpoint: null,
    preDestructiveReplace: null,
    preModeSwitch: null,
    schemaVersion: 1,
    status: { lastPersistenceFailure: null },
  }))
}

async function openVisibleToolbarMenu(wrapper: AppWrapper, menuId: string): Promise<ReturnType<AppWrapper['get']>> {
  const trigger = wrapper.get(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`)
  expect(trigger.isVisible()).toBe(true)
  await trigger.trigger('pointerdown')
  await trigger.trigger('click')
  await flushPromises()
  const panel = wrapper.get(`[data-toolbar-menu="${menuId}"] .toolbar-menu__panel`)
  expect(trigger.attributes('aria-expanded')).toBe('true')
  expect(panel.isVisible()).toBe(true)
  return panel
}

async function chooseVisibleLanguage(wrapper: AppWrapper, locale: TestLocale): Promise<void> {
  const panel = await openVisibleToolbarMenu(wrapper, 'language')
  const item = panel.get(`[data-command-id="language.${locale}"]`)
  expect(item.isVisible()).toBe(true)
  await item.trigger('pointerdown')
  await item.trigger('click')
  await flushPromises()
}

async function clickVisibleMenuCommand(wrapper: AppWrapper, menuId: string, commandId: string): Promise<void> {
  const panel = await openVisibleToolbarMenu(wrapper, menuId)
  const item = panel.get(`[data-command-id="${commandId}"]`)
  expect(item.isVisible()).toBe(true)
  await item.trigger('pointerdown')
  await item.trigger('click')
  await flushPromises()
}

async function activateSourceMode(wrapper: ReturnType<typeof mount>, locale: 'en' | 'zh' = 'en'): Promise<void> {
  await wrapper.get('[data-command-id="mode.source"]').trigger('click')
  if (locale === 'en') await chooseVisibleLanguage(wrapper, 'en')
  await flushPromises()
}

describe('desktop workspace shell', () => {
  it('renders the article, toolbar, mode, status, and exactly one active content region', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.find('.workspace-header').exists()).toBe(false)
    expect(wrapper.find('.document-state').exists()).toBe(false)
    expect(wrapper.find('[aria-label="文章"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="W-Editor 工具栏"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="编辑模式"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="工作区状态"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Document workspace')
    expect(wrapper.find('[aria-label="Workspace status"]').exists()).toBe(false)
    expect(wrapper.findAll('.content-surface')).toHaveLength(1)
    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('visual')
    await wrapper.get('.mode-control button:nth-child(1)').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.content-surface')).toHaveLength(1)
    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('source')
    expect(document.activeElement).toBe(wrapper.get('#markdown-source').element)
    wrapper.unmount()
  })

  it('updates an already-open docked Search bar in place across Chinese, English, and Russian', async () => {
    const wrapper = mount(App, { attachTo: document.body })

    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('.search-dock')
    const dialogElement = dialog.element
    await dialog.get('.search-dock__expand').trigger('click')
    expect(dialog.attributes('aria-label')).toBe('搜索本文')
    expect(dialog.get('#workspace-search').attributes('placeholder')).toBe('搜索文本')
    expect(dialog.get('#workspace-replacement').attributes('placeholder')).toBe('替换文本')
    expect(dialog.get('.search-dock__toggle').attributes('aria-label')).toBe('区分大小写')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(dialog.element).toBe(dialogElement)
    expect(dialog.attributes('aria-label')).toBe('Search this article')
    expect(dialog.get('#workspace-replacement').attributes('placeholder')).toBe('Replacement text')

    await chooseVisibleLanguage(wrapper, 'ru')
    expect(dialog.element).toBe(dialogElement)
    expect(dialog.attributes('aria-label')).toBe('Поиск по статье')
    expect(dialog.get('#workspace-replacement').attributes('placeholder')).toBe('Текст для замены')
    wrapper.unmount()
  })

  it('updates an already-open Formula picker in place across Chinese, English, and Russian', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.formula')
    const picker = wrapper.get('[data-picker-command="insert.formula"]')
    const pickerElement = picker.element
    expect(picker.text()).toContain('公式模板')
    expect(picker.text()).not.toContain('Formula templates')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(picker.element).toBe(pickerElement)
    expect(picker.text()).toContain('Formula templates')

    await chooseVisibleLanguage(wrapper, 'ru')
    expect(picker.element).toBe(pickerElement)
    expect(picker.text()).toContain('Шаблоны формул')
    wrapper.unmount()
  })

  it('updates an already-open table dimension picker in place across Chinese, English, and Russian', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.table')
    const picker = wrapper.get('[data-table-dimension-picker]')
    const pickerElement = picker.element
    expect(picker.attributes('aria-label')).toBe('选择表格大小')
    expect(picker.attributes('aria-label')).not.toBe('Choose table size')
    expect(picker.get('[role="status"]').text()).toBe('1 列 × 1 数据行')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-table-dimension-picker]').element).toBe(pickerElement)
    expect(picker.element).toBe(pickerElement)
    expect(picker.attributes('aria-label')).toBe('Choose table size')
    expect(picker.get('[role="status"]').text()).toBe('1 column × 1 data row')

    await chooseVisibleLanguage(wrapper, 'ru')
    expect(wrapper.get('[data-table-dimension-picker]').element).toBe(pickerElement)
    expect(picker.element).toBe(pickerElement)
    expect(picker.attributes('aria-label')).toBe('Выберите размер таблицы')
    expect(picker.get('[role="status"]').text()).toBe('1 столбец × 1 строка данных')
    wrapper.unmount()
  })

  it('updates the workspace status in the same DOM across Chinese, English, and Russian', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    const status = wrapper.get('.status-region')
    const statusElement = status.element
    expect(status.attributes('aria-label')).toBe('工作区状态')
    expect(status.text()).toContain('所有更改已同步')
    expect(status.text()).toContain('自动保存')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.status-region').element).toBe(statusElement)
    expect(status.attributes('aria-label')).toBe('Workspace status')
    expect(status.text()).toContain('All changes synchronized')
    expect(status.text()).toContain('Autosave')

    await chooseVisibleLanguage(wrapper, 'ru')
    expect(wrapper.get('.status-region').element).toBe(statusElement)
    expect(status.attributes('aria-label')).toBe('Статус рабочей области')
    expect(status.text()).toContain('Все изменения синхронизированы')
    expect(status.text()).toContain('Автосохранение')
    wrapper.unmount()
  })

  it('updates the export menu in the same DOM through real visible menu interactions', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    let exportMenu = await openVisibleToolbarMenu(wrapper, 'export')
    const exportMenuElement = exportMenu.element
    expect(exportMenu.text()).toContain('Markdown 文件')

    await chooseVisibleLanguage(wrapper, 'en')
    exportMenu = await openVisibleToolbarMenu(wrapper, 'export')
    expect(exportMenu.element).toBe(exportMenuElement)
    expect(exportMenu.text()).toContain('Markdown file')

    await chooseVisibleLanguage(wrapper, 'ru')
    exportMenu = await openVisibleToolbarMenu(wrapper, 'export')
    expect(exportMenu.element).toBe(exportMenuElement)
    expect(exportMenu.text()).toContain('Файл Markdown')
    wrapper.unmount()
  })

  it('renders dispatcher command outcomes with live localized labels instead of command IDs', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')

    await wrapper.get('[data-command-id="search.replace"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    const feedback = wrapper.get('.status-region__command')
    const feedbackElement = feedback.element
    expect(feedback.text()).toBe('已打开搜索。')
    expect(feedback.text()).not.toContain('search.replace')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.status-region__command').element).toBe(feedbackElement)
    expect(feedback.text()).toBe('Search opened.')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(wrapper.get('.status-region__command').element).toBe(feedbackElement)
    expect(feedback.text()).toBe('Открыт редактор: Поиск.')
    expect(feedback.text()).not.toContain('search.replace')

    await wrapper.get('.search-dock__close').trigger('click')
    await chooseVisibleLanguage(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Keep token tail')
    textarea.setSelectionRange(5, 10)
    await source.trigger('select')
    await wrapper.get('[data-command-id="text.bold"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="text.bold"]').trigger('click')
    await flushPromises()
    const boldFeedback = wrapper.get('.status-region__command')
    const boldFeedbackElement = boldFeedback.element
    expect(boldFeedback.text()).toBe('已应用 粗体。')
    expect(boldFeedback.text()).not.toContain('text.bold')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.status-region__command').element).toBe(boldFeedbackElement)
    expect(boldFeedback.text()).toBe('Bold applied.')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(boldFeedback.text()).toBe('Применено: Жирный.')
    expect(boldFeedback.text()).not.toContain('text.bold')

    await chooseVisibleLanguage(wrapper, 'zh')
    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.table')
    const tableCell = wrapper.get('[data-table-picker-columns="2"][data-table-picker-rows="2"]')
    expect(tableCell.isVisible()).toBe(true)
    await tableCell.trigger('pointerdown')
    await tableCell.trigger('click')
    await flushPromises()
    const insertedFeedback = wrapper.get('.status-region__command')
    const insertedFeedbackElement = insertedFeedback.element
    expect(insertedFeedback.text()).toBe('已插入 表格。')
    expect(insertedFeedback.text()).not.toContain('insert.table')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.status-region__command').element).toBe(insertedFeedbackElement)
    expect(insertedFeedback.text()).toBe('Table inserted.')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(insertedFeedback.text()).toBe('Вставлено: Таблица.')

    await chooseVisibleLanguage(wrapper, 'zh')
    await wrapper.get('[data-command-id="mode.visual"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    const modeFeedback = wrapper.get('.status-region__command')
    const modeFeedbackElement = modeFeedback.element
    expect(modeFeedback.text()).toBe('已切换到可视化模式。')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.status-region__command').element).toBe(modeFeedbackElement)
    expect(modeFeedback.text()).toBe('Mode changed to Visual.')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(modeFeedback.text()).toBe('Выбран режим Визуальный.')
    wrapper.unmount()
  })

  it('keeps date-group labels reactive while preserving locale-neutral 24-hour article times', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    const card = wrapper.get('.article-card--active')
    const cardElement = card.element
    expect(wrapper.get('[data-testid="article-date-heading"]').text()).toBe('未更新')
    expect(card.get('time').text()).toBe('--:--')

    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.article-card--active').element).toBe(cardElement)
    expect(wrapper.get('[data-testid="article-date-heading"]').text()).toBe('Not updated')
    expect(card.get('time').text()).toBe('--:--')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(wrapper.get('[data-testid="article-date-heading"]').text()).toBe('Не обновлялось')

    await chooseVisibleLanguage(wrapper, 'zh')
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await wrapper.get('#markdown-source').setValue('# Recently saved')
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    const now = new Date()
    const expectedTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    expect(wrapper.get('[data-testid="article-date-heading"]').text()).toBe('今天')
    expect(wrapper.get('.article-card--active time').text()).toBe(expectedTime)
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-testid="article-date-heading"]').text()).toBe('Today')
    expect(wrapper.get('.article-card--active time').text()).toBe(expectedTime)
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(wrapper.get('[data-testid="article-date-heading"]').text()).toBe('Сегодня')
    expect(wrapper.get('.article-card--active time').text()).toBe(expectedTime)
    wrapper.unmount()
  })

  it('updates shortcuts, statistics, and lifecycle confirmation in place through visible locale controls', async () => {
    const wrapper = mount(App, { attachTo: document.body })

    await wrapper.get('[data-command-id="settings.shortcuts"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="settings.shortcuts"]').trigger('click')
    await flushPromises()
    const shortcuts = wrapper.get('[data-testid="shortcut-settings"]')
    const shortcutsElement = shortcuts.element
    expect(shortcuts.text()).toContain('键盘快捷键')
    const italicRecorder = shortcuts.get('[data-shortcut-command="text.italic"] [data-shortcut-recorder]')
    expect(italicRecorder.attributes('aria-label')).toBe('为 斜体 录制快捷键')
    expect(italicRecorder.attributes('aria-label')).not.toContain('text.italic')
    await italicRecorder.trigger('click')
    const recordingStatus = shortcuts.get('.shortcut-recording-status')
    const recordingStatusElement = recordingStatus.element
    expect(recordingStatus.text()).toContain('斜体')
    expect(recordingStatus.text()).not.toContain('text.italic')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-testid="shortcut-settings"]').element).toBe(shortcutsElement)
    expect(shortcuts.text()).toContain('Keyboard shortcuts')
    expect(shortcuts.get('.shortcut-recording-status').element).toBe(recordingStatusElement)
    expect(recordingStatus.text()).toContain('Italic')
    expect(italicRecorder.attributes('aria-label')).toBe('Record shortcut for Italic')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(shortcuts.text()).toContain('Сочетания клавиш')
    expect(shortcuts.get('.shortcut-recording-status').element).toBe(recordingStatusElement)
    expect(recordingStatus.text()).toContain('Курсив')
    expect(italicRecorder.attributes('aria-label')).toBe('Записать сочетание для Курсив')
    await shortcuts.findAll('.dialog-panel__actions button')[1]?.trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    await wrapper.get('[data-command-id="document.word-count"]').trigger('pointerdown')
    await wrapper.get('[data-command-id="document.word-count"]').trigger('click')
    await flushPromises()
    const statistics = wrapper.get('[data-testid="word-count-dialog"]')
    const statisticsElement = statistics.element
    expect(statistics.text()).toContain('文档统计')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-testid="word-count-dialog"]').element).toBe(statisticsElement)
    expect(statistics.text()).toContain('Document statistics')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(statistics.text()).toContain('Статистика документа')
    await statistics.get('.primary-action').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    for (const selector of [
      '[data-testid="clear-document"]',
      '[data-testid="reset-document"]',
      '[data-testid="restore-pre-mode-switch"]',
      '[data-testid="restore-pre-destructive-replace"]',
    ]) {
      expect(wrapper.find(selector).exists()).toBe(false)
    }
    wrapper.unmount()
  })

  it('updates link, rich text, and color pickers in place through visible locale controls', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Keep token tail')
    textarea.setSelectionRange(5, 10)
    await source.trigger('select')

    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.link')
    const link = wrapper.get('[data-picker-command="insert.link"]')
    const linkElement = link.element
    expect(link.text()).toContain('链接目标')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-picker-command="insert.link"]').element).toBe(linkElement)
    expect(link.text()).toContain('Link destination')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(link.text()).toContain('Адрес ссылки')
    await link.get('.dialog-panel__actions button').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    await clickVisibleMenuCommand(wrapper, 'text-style', 'text.ruby')
    const rich = wrapper.get('[data-picker-command="text.ruby"]')
    const richElement = rich.element
    expect(rich.text()).toContain('基础文字')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-picker-command="text.ruby"]').element).toBe(richElement)
    expect(rich.text()).toContain('Base text')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(rich.text()).toContain('Основной текст')
    await rich.get('.dialog-panel__actions button').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    const colorTrigger = wrapper.get('[data-toolbar-menu="color"] .toolbar-menu__trigger')
    expect(colorTrigger.isVisible()).toBe(true)
    await colorTrigger.trigger('pointerdown')
    await colorTrigger.trigger('click')
    await flushPromises()
    const color = wrapper.get('[data-picker-command="text.color"]')
    const colorElement = color.element
    expect(color.get('[role="tablist"]').attributes('aria-label')).toBe('颜色类型')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-picker-command="text.color"]').element).toBe(colorElement)
    expect(color.get('[role="tablist"]').attributes('aria-label')).toBe('Color type')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(color.get('[role="tablist"]').attributes('aria-label')).toBe('Тип цвета')
    await color.trigger('keydown', { key: 'Escape' })
    wrapper.unmount()
  })

  it('localizes stable panel and layout validation codes without embedding English diagnostics', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha')
    textarea.setSelectionRange(5, 5)
    await source.trigger('select')

    const cases = [
      {
        commandId: 'panel.info',
        input: '#panel-source',
        invalid: '::: info Missing body\n\n:::',
        menuId: 'panel',
        englishDiagnostic: 'Source must be one complete Cherry info panel.',
      },
      {
        commandId: 'layout.two-column',
        input: '#column-layout-source',
        invalid: '::: 2cols Invalid\nOnly one column\n:::',
        menuId: 'panel',
        englishDiagnostic: 'Source must be one valid Cherry 2cols container.',
      },
      {
        commandId: 'layout.tabs',
        input: '#disclosure-source',
        invalid: '::: tabs\n:: Only\nOne\n:::',
        menuId: 'panel',
        englishDiagnostic: 'Tabs require at least two non-empty labeled sections.',
      },
      {
        commandId: 'layout.timeline',
        input: '#timeline-source',
        invalid: '::: timeline Release\n:: [unknown] today Invalid status\n:::',
        menuId: null,
        englishDiagnostic: 'Timeline requires a title and one or more valid [status] time title items.',
      },
    ] as const

    for (const entry of cases) {
      await chooseVisibleLanguage(wrapper, 'zh')
      if (entry.menuId === null) {
        const command = wrapper.get(`[data-command-id="${entry.commandId}"]`)
        expect(command.isVisible()).toBe(true)
        await command.trigger('pointerdown')
        await command.trigger('click')
        await flushPromises()
      } else {
        await clickVisibleMenuCommand(wrapper, entry.menuId, entry.commandId)
      }
      const dialog = wrapper.get(`[data-picker-command="${entry.commandId}"]`)
      await dialog.get(entry.input).setValue(entry.invalid)
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      const alert = dialog.get('[role="alert"]')
      const alertElement = alert.element
      expect(alert.text()).toMatch(/[\u3400-\u9fff]/u)
      expect(alert.text()).not.toContain(entry.englishDiagnostic)

      await chooseVisibleLanguage(wrapper, 'en')
      expect(dialog.get('[role="alert"]').element).toBe(alertElement)
      expect(alert.text()).toMatch(/[A-Za-z]/u)
      expect(alert.text()).not.toContain(entry.englishDiagnostic)

      await chooseVisibleLanguage(wrapper, 'ru')
      expect(dialog.get('[role="alert"]').element).toBe(alertElement)
      expect(alert.text()).toMatch(/[А-Яа-яЁё]/u)
      expect(alert.text()).not.toContain(entry.englishDiagnostic)
      await dialog.get('.dialog-panel__actions button').trigger('click')
      await flushPromises()
    }
    wrapper.unmount()
  })

  it('updates App-hosted code, media, and draw.io child dialogs in place', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')

    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.code-block')
    const code = wrapper.get('[data-editor-command="insert.code-block"]')
    const codeElement = code.element
    expect(code.text()).toContain('代码块')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-editor-command="insert.code-block"]').element).toBe(codeElement)
    expect(code.text()).toContain('Code block')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(code.text()).toContain('Блок кода')
    await code.get('.dialog-panel__actions button').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.image')
    const media = wrapper.get('[data-editor-command="insert.image"]')
    const mediaElement = media.element
    expect(media.text()).toContain('图片资源')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-editor-command="insert.image"]').element).toBe(mediaElement)
    expect(media.text()).toContain('Image asset')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(media.text()).toContain('Изображение')
    await media.get('.dialog-panel__actions button').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.file')
    const attachment = wrapper.get('[data-editor-command="insert.file"]')
    const attachmentElement = attachment.element
    expect(attachment.text()).toContain('文件资源')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-editor-command="insert.file"]').element).toBe(attachmentElement)
    expect(attachment.text()).toContain('File asset')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(attachment.text()).toContain('Файл')
    await attachment.get('.dialog-panel__actions button').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    const drawioTrigger = wrapper.get('[data-command-id="insert.drawio"]')
    expect(drawioTrigger.isVisible()).toBe(true)
    await drawioTrigger.trigger('pointerdown')
    await drawioTrigger.trigger('click')
    await flushPromises()
    const drawio = wrapper.get('[data-editor-command="insert.drawio"]')
    const drawioElement = drawio.element
    expect(drawio.text()).toContain('draw.io 图表')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-editor-command="insert.drawio"]').element).toBe(drawioElement)
    expect(drawio.text()).toContain('draw.io diagram')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(drawio.text()).toContain('Диаграмма draw.io')
    await drawio.get('button').trigger('click')
    wrapper.unmount()
  })

  it('updates Source, Visual, and final Preview child surfaces in place', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const sourceSurface = wrapper.get('.source-surface')
    const sourceElement = sourceSurface.element
    expect(wrapper.get('#markdown-source').attributes('aria-label')).toBe('Markdown 源码测试控件')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.source-surface').element).toBe(sourceElement)
    expect(wrapper.get('#markdown-source').attributes('aria-label')).toBe('Markdown source test control')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(wrapper.get('#markdown-source').attributes('aria-label')).toBe('Тестовый элемент исходного Markdown')

    await chooseVisibleLanguage(wrapper, 'zh')
    await wrapper.get('#markdown-source').setValue('```javascript\nconst answer = 42\n```')
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    const visual = wrapper.get('.visual-surface')
    const visualElement = visual.element
    expect(visual.get('[data-semantic-copy="code-block"]').attributes('aria-label')).toBe('复制代码')
    expect(visual.find('[data-semantic-copy="code-block"] .ch-icon-copy').exists()).toBe(true)
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.visual-surface').element).toBe(visualElement)
    expect(visual.get('[data-semantic-copy="code-block"]').attributes('aria-label')).toBe('Copy code')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(visual.get('[data-semantic-copy="code-block"]').attributes('aria-label')).toBe('Копировать код')

    await chooseVisibleLanguage(wrapper, 'zh')
    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    const preview = wrapper.get('.visual-surface')
    const previewElement = preview.element
    expect(previewElement).toBe(visualElement)
    expect(preview.attributes('data-mode')).toBe('preview')
    expect(preview.get('.visual-code-block__toolbar').attributes('aria-label')).toBe('代码块操作')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('.visual-surface').element).toBe(previewElement)
    expect(preview.get('.visual-code-block__toolbar').attributes('aria-label')).toBe('Code block actions')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(preview.get('.visual-code-block__toolbar').attributes('aria-label')).toBe('Действия с блоком кода')
    wrapper.unmount()
  })

  it('uses localized Mermaid variant labels and keeps Mermaid and chart editors open in place', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    const mermaid = mermaidStarterSource('mermaid.flowchart')
    await source.setValue(mermaid)
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-semantic-edit="mermaid-editor"]').trigger('pointerdown')
    await wrapper.get('[data-semantic-edit="mermaid-editor"]').trigger('click')
    await flushPromises()
    const mermaidDialog = wrapper.get('[data-editor-command="mermaid.source"]')
    const mermaidElement = mermaidDialog.element
    const mermaidHost = wrapper.getComponent(CodeMirrorSourceEditorHost)
    const mermaidEditorContent = mermaidDialog.get('.cm-content')
    const mermaidEditorContentElement = mermaidEditorContent.element
    expect(mermaidHost.props('sourceMode')).toBe('code')
    expect(mermaidHost.props('titleOverride')).toBe('Mermaid 流程图')
    expect(mermaidEditorContent.attributes('aria-label')).toBe('源码')
    expect(mermaidDialog.get('h2').text()).toBe('Mermaid 流程图')
    expect(mermaidDialog.get('h2').text()).not.toContain('flowchart')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-editor-command="mermaid.source"]').element).toBe(mermaidElement)
    expect(mermaidDialog.get('.cm-content').element).toBe(mermaidEditorContentElement)
    expect(mermaidHost.props('titleOverride')).toBe('Mermaid Flowchart')
    expect(mermaidEditorContent.attributes('aria-label')).toBe('Source')
    expect(mermaidDialog.get('h2').text()).toBe('Mermaid Flowchart')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(mermaidDialog.get('.cm-content').element).toBe(mermaidEditorContentElement)
    expect(mermaidHost.props('titleOverride')).toBe('Mermaid Блок-схема')
    expect(mermaidEditorContent.attributes('aria-label')).toBe('Исходный код')
    expect(mermaidDialog.get('h2').text()).toBe('Mermaid Блок-схема')
    await mermaidDialog.get('.dialog-panel__actions button').trigger('click')

    await chooseVisibleLanguage(wrapper, 'zh')
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', mermaid)
    await wrapper.get('#markdown-source').setValue(chartTableStarterSource('chart.line'))
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-semantic-edit="chart-table-editor"]').trigger('pointerdown')
    await wrapper.get('[data-semantic-edit="chart-table-editor"]').trigger('click')
    await flushPromises()
    const chart = wrapper.get('[data-editor-command="chart-table.editor"]')
    const chartElement = chart.element
    expect(chart.text()).toContain('编辑图表表格')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(wrapper.get('[data-editor-command="chart-table.editor"]').element).toBe(chartElement)
    expect(chart.text()).toContain('Edit chart table')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(chart.text()).toContain('Редактировать таблицу диаграммы')
    await chart.get('.dialog-panel__actions button').trigger('click')
    wrapper.unmount()
  })

  it('collapses and restores the article region without removing the editor workspace', async () => {
    const wrapper = mount(App)
    const toggle = wrapper.get('.article-panel__header .icon-button')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.article-panel').classes()).toContain('article-panel--collapsed')
    expect(wrapper.find('.article-list').exists()).toBe(false)
    expect(wrapper.findAll('.content-surface')).toHaveLength(1)
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.article-list').exists()).toBe(true)
    wrapper.unmount()
  })

  it('switches the left panel between article recovery and a live H1-H5 outline', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const markdown = '# Alpha\n\n## Beta\n\n```md\n# Hidden\n```\n\n### Gamma'
    await wrapper.get('#markdown-source').setValue(markdown)
    await flushPromises()

    const articleTab = wrapper.get('[data-article-panel-tab="articles"]')
    const outlineTab = wrapper.get('[data-article-panel-tab="outline"]')
    expect(articleTab.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.article-list').exists()).toBe(true)
    expect(wrapper.find('.article-lifecycle').exists()).toBe(true)

    await outlineTab.trigger('click')
    expect(outlineTab.attributes('aria-selected')).toBe('true')
    expect(outlineTab.text()).toBe('目录')
    expect(wrapper.get('.article-panel__header h2').text()).toBe('目录')
    expect(wrapper.find('.article-list').exists()).toBe(false)
    expect(wrapper.find('.article-lifecycle').exists()).toBe(false)
    expect(wrapper.findAll('.article-outline__text').map((item) => item.text())).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(wrapper.find('.article-outline__level').exists()).toBe(false)
    expect(wrapper.findAll('.article-outline__number').map((item) => item.text())).toEqual(['1', '1.1', '1.1.1'])
    expect(wrapper.get('.article-outline__heading').text()).toContain('本文目录')

    await wrapper.findAll('.article-outline__item')[1]?.trigger('click')
    const source = wrapper.get('#markdown-source').element as HTMLTextAreaElement
    expect(source.selectionStart).toBe(markdown.indexOf('## Beta'))
    expect(wrapper.findAll('.article-outline__item')[1]?.classes()).toContain('article-outline__item--active')

    await articleTab.trigger('click')
    expect(wrapper.find('.article-list').exists()).toBe(true)
    expect(wrapper.find('.article-lifecycle').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows real fixed-article state, resizes accessibly, and preserves per-document edits on switching', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const cards = wrapper.findAll('.article-card')
    expect(cards).toHaveLength(3)
    expect(cards[0]?.attributes('aria-current')).toBe('page')
    expect(cards[0]?.get('time').text()).toBe('--:--')

    await wrapper.get('#markdown-source').setValue('# Edited welcome')
    expect(wrapper.get('.article-card--active').get('time').text()).toBe('--:--')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave pending')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint dirty')

    const separator = wrapper.get('[aria-label="Resize article panel"]')
    expect(separator.attributes('aria-valuenow')).toBe('252')
    await separator.trigger('keydown', { key: 'ArrowRight' })
    expect(separator.attributes('aria-valuenow')).toBe('268')
    expect(wrapper.get('.workspace-body').attributes('style')).toContain('--article-panel-width: 268px')

    await cards[1]?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="article-switch-decision"]').exists()).toBe(true)
    await wrapper.get('[data-testid="article-switch-draft"]').trigger('click')
    await flushPromises()
    await activateSourceMode(wrapper)
    expect(wrapper.get('.article-card--active').text()).toContain('Product notes')
    expect(wrapper.get('[data-document-id="welcome"] time').text()).not.toBe('--:--')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', PRODUCT_NOTES_MARKDOWN)
    await wrapper.findAll('.article-card')[0]?.trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', '# Edited welcome')
    wrapper.unmount()
  })

  it('groups compact article rows by local update date with deterministic 24-hour times', () => {
    const fixedCatalog = new ArticleCatalogAdapter().list()
    const catalog = [
      ...fixedCatalog,
      { documentId: 'untimed', initialMarkdown: '# Untimed', title: 'Untimed article' },
    ]
    const todayLate = new Date()
    todayLate.setHours(18, 31, 0, 0)
    const todayEarly = new Date()
    todayEarly.setHours(9, 5, 0, 0)
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(23, 4, 0, 0)
    seedArticleAutosave('welcome', fixedCatalog[0]?.initialMarkdown ?? '', todayLate)
    seedArticleAutosave('product-notes', fixedCatalog[1]?.initialMarkdown ?? '', todayEarly)
    seedArticleAutosave('formatting-gallery', fixedCatalog[2]?.initialMarkdown ?? '', yesterday)

    const wrapper = mount(App, { props: { articleCatalog: catalog } })
    const date = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0'),
    ].join('/')
    const groups = wrapper.findAll('[data-testid="article-date-group"]')
    expect(groups.map((group) => group.get('[data-testid="article-date-heading"]').text())).toEqual([
      '今天',
      date,
      '未更新',
    ])
    expect(groups[0]?.findAll('[data-testid="desktop-library-article"]').map((row) => row.attributes('data-document-id'))).toEqual([
      'welcome',
      'product-notes',
    ])
    expect(groups[0]?.findAll('time').map((time) => time.text())).toEqual(['18:31', '09:05'])
    expect(groups[1]?.get('time').text()).toBe('23:04')
    expect(groups[2]?.get('time').text()).toBe('--:--')
    expect(groups[0]?.get('[data-document-id="welcome"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.article-list').text()).not.toMatch(/自动保存|更新于|检查点/u)
    expect(wrapper.find('.article-card__meta').exists()).toBe(false)

    wrapper.unmount()
  })

  it('holds article switching through source composition and switches after compositionend', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    await source.trigger('compositionstart')
    await wrapper.findAll('.article-card')[1]?.trigger('click')
    await flushPromises()

    expect(wrapper.get('.article-card--active').text()).toContain('Welcome to W-Editor')
    expect(wrapper.get('.status-region').text()).toContain('Waiting for composition')

    await source.trigger('compositionend')
    await flushPromises()

    expect(wrapper.get('.article-card--active').text()).toContain('Product notes')
    wrapper.unmount()
  })

  it('autosaves the latest active document after 1000 ms and restores it on startup', async () => {
    const first = mount(App, { attachTo: document.body })
    await activateSourceMode(first)
    await first.get('#markdown-source').setValue('# Locally restored')
    expect(first.get('[aria-label="Workspace status"]').text()).toContain('Autosave pending')

    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()

    expect(first.get('[aria-label="Workspace status"]').text()).toContain('Autosave saved')
    const stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      autosave: { markdown: string; revision: number }
    }
    expect(stored.autosave).toMatchObject({ markdown: '# Locally restored', revision: 1 })
    first.unmount()

    const restored = mount(App, { attachTo: document.body })
    await activateSourceMode(restored)
    expect(restored.get('#markdown-source').element).toHaveProperty('value', '# Locally restored')
    expect(restored.get('[aria-label="Workspace status"]').text()).toContain('Autosave saved')
    restored.unmount()
  })

  it('stores only the latest manual checkpoint and marks exact checkpoint content clean', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('#markdown-source').setValue('# First checkpoint')
    await wrapper.get('[data-command-id="document.manual-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint clean')
    let stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      manualCheckpoint: { markdown: string }
    }
    expect(stored.manualCheckpoint.markdown).toBe('# First checkpoint')

    await wrapper.get('#markdown-source').setValue('# Second checkpoint')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint dirty')
    await wrapper.get('[data-command-id="document.manual-save"]').trigger('click')
    await flushPromises()
    stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      manualCheckpoint: { markdown: string }
    }
    expect(stored.manualCheckpoint.markdown).toBe('# Second checkpoint')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint clean')
    wrapper.unmount()
  })

  it('persists an exact pre-mode-switch checkpoint independently of autosave', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('#markdown-source').setValue('# Protected mode boundary')
    await wrapper.get('.mode-control button:nth-child(2)').trigger('click')
    await flushPromises()

    const stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      autosave: { markdown: string }
      preDestructiveReplace: unknown
      preModeSwitch: { markdown: string }
    }
    expect(stored.autosave.markdown).toBe('# Protected mode boundary')
    expect(stored.preModeSwitch.markdown).toBe('# Protected mode boundary')
    expect(stored.preDestructiveReplace).toBeNull()
    wrapper.unmount()
  })

  it('uses one continuous Tiptap canvas for ordinary blocks without fabricated complex nodes', async () => {
    const wrapper = mount(App)
    await activateSourceMode(wrapper)
    await wrapper.get('#markdown-source').setValue('Alpha\n\nBeta')
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.visual-surface').classes()).toContain('continuous-canvas')
    expect(wrapper.findAll('.ordinary-block')).toHaveLength(2)
    for (const block of wrapper.findAll('.ordinary-block')) {
      expect(block.classes()).not.toContain('complex-node')
    }
    expect(wrapper.find('[data-page-break]').exists()).toBe(false)
    expect(wrapper.findAll('.visual-surface .ProseMirror')).toHaveLength(1)
    expect(wrapper.findAll('.complex-node')).toHaveLength(0)
    wrapper.unmount()
  })

  it('renders the official Cherry toolbar hierarchy and icon font through the public DOM', async () => {
    const wrapper = mount(App)
    await activateSourceMode(wrapper)
    const expectedByMenu = {
      'text-style': ['text.strike', 'text.underline', 'text.subscript', 'text.superscript', 'text.ruby'],
      color: ['text.color', 'text.background'],
      alignment: ['align.left', 'align.justify'],
      mermaid: ['mermaid.flowchart', 'mermaid.gantt'],
      chart: ['chart.line', 'chart.sankey'],
      export: ['export.markdown', 'export.screenshot'],
      heading: ['block.h1', 'block.h5'],
      insert: ['insert.image', 'insert.formula', 'insert.table', 'insert.file'],
      language: ['language.zh', 'language.ru'],
      panel: ['panel.success', 'layout.two-column', 'layout.tabs'],
    }
    for (const commandId of ['text.bold', 'text.italic', 'text.size', 'insert.drawio', 'layout.timeline', 'layout.accordion', 'settings.shortcuts', 'document.word-count']) {
      expect(wrapper.find(`[data-command-id="${commandId}"]`).exists()).toBe(true)
    }

    for (const [menuId, commandIds] of Object.entries(expectedByMenu)) {
      await wrapper.get(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).trigger('click')
      for (const commandId of commandIds) {
        expect(wrapper.find(`[data-toolbar-menu="${menuId}"] [data-command-id="${commandId}"]`).exists()).toBe(true)
      }
      await wrapper.get(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).trigger('click')
    }
    expect(wrapper.get('[data-command-id="text.bold"] .ch-icon').classes()).toContain('ch-icon-bold')
    expect(wrapper.get('[data-command-id="text.italic"] .ch-icon').classes()).toContain('ch-icon-italic')
    expect(wrapper.get('[data-toolbar-menu="text-style"] .toolbar-menu__trigger .ch-icon').classes()).toContain('ch-icon-strike')
    expect(wrapper.get('[data-toolbar-menu="color"] .toolbar-menu__trigger .ch-icon').classes()).toContain('ch-icon-color')
    expect(wrapper.get('[data-toolbar-menu="heading"] .toolbar-menu__trigger .ch-icon').classes()).toContain('ch-icon-header')
    expect(wrapper.get('[data-toolbar-menu="chart"] .toolbar-menu__trigger .ch-icon').classes()).toContain('ch-icon-insertLineChart')
    expect(wrapper.get('[data-command-id="settings.shortcuts"] .ch-icon').classes()).toContain('ch-icon-command')
    expect(wrapper.get('[data-command-id="search.replace"] .ch-icon').classes()).toContain('ch-icon-search')
    expect(wrapper.get('[data-command-id="application.fullscreen"] .ch-icon').classes()).toContain('ch-icon-fullscreen')
    expect(wrapper.get('[data-command-id="insert.drawio"] .tool-button__text').text()).toBe('draw.io')
    expect(wrapper.get('[data-command-id="document.word-count"] .tool-button__text').text()).toBe('Word count')
    expect(wrapper.get('[data-command-id="mode.source"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-command-id="mode.visual"]').attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('switches and restores the whole-workspace appearance theme without mutating Markdown', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    const shell = wrapper.get('.workspace-shell')
    const markdownBefore = window.localStorage.getItem('w-editor:v1:document:welcome')
    expect(shell.attributes('data-theme')).toBe('gray')
    expect(shell.classes()).toContain('theme__gray')
    expect(wrapper.get('[data-toolbar-menu="theme"] .toolbar-menu__trigger .ch-icon').classes()).toContain('ch-icon-main-theme')

    await wrapper.get('[data-toolbar-menu="theme"] .toolbar-menu__trigger').trigger('click')
    expect(wrapper.findAll('[data-theme-option]')).toHaveLength(8)
    await wrapper.get('[data-theme-option="abyss"]').trigger('click')
    await flushPromises()

    expect(shell.attributes('data-theme')).toBe('abyss')
    expect(shell.classes()).toContain('theme__abyss')
    expect(shell.classes()).not.toContain('theme__gray')
    expect(window.localStorage.getItem('w-editor:appearance-theme')).toBe('abyss')
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(markdownBefore)
    expect(wrapper.get('.status-region').text()).toContain('界面主题已切换为深海')

    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.visual-surface').attributes('data-mode')).toBe('preview')
    expect(wrapper.get('.workspace-shell').classes()).toContain('theme__abyss')

    await wrapper.get('[data-toolbar-menu="theme"] .toolbar-menu__trigger').trigger('click')
    expect(wrapper.get('[data-theme-option="abyss"]').attributes('aria-checked')).toBe('true')
    wrapper.unmount()

    const restored = mount(App)
    expect(restored.get('.workspace-shell').attributes('data-theme')).toBe('abyss')
    restored.unmount()
  })

  it.each([
    ['text.bold', '**'],
    ['text.italic', '*'],
    ['text.strike', '~~'],
    ['text.underline', '++'],
    ['text.subscript', '~'],
    ['text.superscript', '^'],
  ] as const)('applies and removes %s through the source toolbar with exact Markdown', async (commandId, marker) => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Keep token tail')
    textarea.setSelectionRange(5, 10)
    await source.trigger('select')

    const openCommand = async () => wrapper.get(`[data-command-id="${commandId}"]`)
    let command = await openCommand()
    const activeAttribute = command.attributes('role') === 'menuitemcheckbox' ? 'aria-checked' : 'aria-pressed'
    expect(command.attributes(activeAttribute)).toBe('false')
    await command.trigger('click')
    await flushPromises()

    expect(textarea.value).toBe(`Keep ${marker}token${marker} tail`)
    command = await openCommand()
    expect(command.attributes(activeAttribute)).toBe('true')
    await command.trigger('click')
    await flushPromises()

    expect(textarea.value).toBe('Keep token tail')
    command = await openCommand()
    expect(command.attributes(activeAttribute)).toBe('false')
    wrapper.unmount()
  })

  it.each(['block.h1', 'block.h2', 'block.h3', 'block.h4', 'block.h5'] as const)(
    'applies %s to the current source line and reports the active level',
    async (commandId) => {
      const wrapper = mount(App, { attachTo: document.body })
      await activateSourceMode(wrapper)
      const source = wrapper.get('#markdown-source')
      const textarea = source.element as HTMLTextAreaElement
      await source.setValue('Heading')
      textarea.setSelectionRange(3, 3)
      await source.trigger('select')
      await wrapper.get('[data-toolbar-menu="heading"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
      await flushPromises()

      expect(textarea.value).toBe(`${'#'.repeat(Number(commandId.at(-1)))} Heading`)
      await wrapper.get('[data-toolbar-menu="heading"] .toolbar-menu__trigger').trigger('click')
      expect(wrapper.get(`[data-command-id="${commandId}"]`).attributes('aria-checked')).toBe('true')
      expect(wrapper.find('[data-command-id="block.h6"]').exists()).toBe(false)
      wrapper.unmount()
    },
  )

  it.each([
    ['list.ordered', '1. Alpha\n2. Bravo'],
    ['list.unordered', '- Alpha\n- Bravo'],
    ['list.task', '- [ ] Alpha\n- [ ] Bravo'],
  ] as const)('applies %s to selected source lines and reports the active list', async (commandId, expected) => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha\nBravo')
    textarea.setSelectionRange(0, 11)
    await source.trigger('select')
    await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
    await flushPromises()

    expect(textarea.value).toBe(expected)
    expect(wrapper.get(`[data-command-id="${commandId}"]`).attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('applies a validated source link from its dialog and makes cancel a no-op', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Keep label tail')
    textarea.setSelectionRange(5, 10)
    await source.trigger('select')
    const open = async () => {
      await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get('[data-command-id="insert.link"]').trigger('click')
      await flushPromises()
      return wrapper.get('[data-picker-command="insert.link"]')
    }
    let dialog = await open()
    await dialog.get('.dialog-panel__actions button').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Keep label tail')

    dialog = await open()
    await dialog.get('#link-url').setValue('https://example.com')
    await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Keep [label](https://example.com) tail')
    wrapper.unmount()
  })

  it('routes formula insertion through a validated semantic editor with apply and cancel', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha')
    textarea.setSelectionRange(5, 5)
    await source.trigger('select')
    const open = async () => {
      await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get('[data-command-id="insert.formula"]').trigger('click')
      await flushPromises()
      return wrapper.get('[data-picker-command="insert.formula"]')
    }
    let dialog = await open()
    expect((dialog.get('input[value="block"]').element as HTMLInputElement).checked).toBe(true)
    await dialog.get('.dialog-panel__actions button').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Alpha')

    dialog = await open()
    await dialog.get('input[value="inline"]').setValue(true)
    expect((dialog.get('input[value="inline"]').element as HTMLInputElement).checked).toBe(true)
    await dialog.get('input[value="block"]').setValue(true)
    await dialog.get('#formula-source').setValue('E = mc^2')
    await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Alpha\n\n$$\nE = mc^2\n$$')
    wrapper.unmount()
  })

  it.each(['layout.tabs', 'layout.accordion'] as const)(
    'opens a detached %s draft, retains local validation errors, and commits only Apply',
    async (commandId) => {
      const wrapper = mount(App, { attachTo: document.body })
      await activateSourceMode(wrapper)
      const source = wrapper.get('#markdown-source')
      const textarea = source.element as HTMLTextAreaElement
      await source.setValue('Alpha')
      textarea.setSelectionRange(5, 5)
      await source.trigger('select')
      const open = async () => {
        await wrapper.get('[data-toolbar-menu="panel"] .toolbar-menu__trigger').trigger('click')
        await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
        await flushPromises()
        return wrapper.get(`[data-picker-command="${commandId}"]`)
      }

      let dialog = await open()
      await dialog.get('#disclosure-source').setValue(commandId === 'layout.tabs'
        ? '::: tabs\n:: Only\nOne\n:::'
        : '+++ Empty\n\n+++')
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      expect(dialog.find('[role="alert"]').exists()).toBe(true)
      expect(textarea.value).toBe('Alpha')
      await dialog.get('.dialog-panel__actions button').trigger('click')
      await flushPromises()
      expect(textarea.value).toBe('Alpha')

      dialog = await open()
      const starter = disclosureStarterSource(commandId)
      expect((dialog.get('#disclosure-source').element as HTMLTextAreaElement).value).toBe(starter)
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      expect(textarea.value).toBe(`Alpha\n\n${starter}`)
      wrapper.unmount()
    },
  )

  it('opens a detached timeline draft, retains local validation errors, and commits only Apply', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha')
    textarea.setSelectionRange(5, 5)
    await source.trigger('select')
    const open = async () => {
      await wrapper.get('[data-command-id="layout.timeline"]').trigger('click')
      await flushPromises()
      return wrapper.get('[data-picker-command="layout.timeline"]')
    }

    let dialog = await open()
    const invalid = '::: timeline Release\n:: [unknown] today Invalid status\n:::'
    await dialog.get('#timeline-source').setValue(invalid)
    await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
    await flushPromises()
    expect(dialog.find('[role="alert"]').exists()).toBe(true)
    expect((dialog.get('#timeline-source').element as HTMLTextAreaElement).value).toBe(invalid)
    expect(textarea.value).toBe('Alpha')
    await dialog.get('.dialog-panel__actions button').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Alpha')

    dialog = await open()
    const starter = timelineStarterSource()
    expect((dialog.get('#timeline-source').element as HTMLTextAreaElement).value).toBe(starter)
    await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe(`Alpha\n\n${starter}`)
    wrapper.unmount()
  })

  it.each(PANEL_DESCRIPTORS)(
    'opens a detached $commandId editor and validates before one Apply',
    async ({ commandId }) => {
      const wrapper = mount(App, { attachTo: document.body })
      await activateSourceMode(wrapper)
      const source = wrapper.get('#markdown-source')
      const textarea = source.element as HTMLTextAreaElement
      await source.setValue('Alpha')
      textarea.setSelectionRange(5, 5)
      await source.trigger('select')
      const open = async () => {
        await wrapper.get('[data-toolbar-menu="panel"] .toolbar-menu__trigger').trigger('click')
        await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
        await flushPromises()
        return wrapper.get(`[data-picker-command="${commandId}"]`)
      }

      let dialog = await open()
      await dialog.get('#panel-source').setValue(`::: ${commandId.slice('panel.'.length)} Missing body\n\n:::`)
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      expect(dialog.find('[role="alert"]').exists()).toBe(true)
      expect(textarea.value).toBe('Alpha')
      await dialog.get('.dialog-panel__actions button').trigger('click')
      await flushPromises()

      dialog = await open()
      const starter = panelStarterSource(commandId)
      expect((dialog.get('#panel-source').element as HTMLTextAreaElement).value).toBe(starter)
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      expect(textarea.value).toBe(`Alpha\n\n${starter}`)
      wrapper.unmount()
    },
  )

  it.each(['layout.two-column', 'layout.multi-column'] as const)(
    'opens a detached %s editor and validates before one Apply',
    async (commandId) => {
      const wrapper = mount(App, { attachTo: document.body })
      await activateSourceMode(wrapper)
      const source = wrapper.get('#markdown-source')
      const textarea = source.element as HTMLTextAreaElement
      await source.setValue('Alpha')
      textarea.setSelectionRange(5, 5)
      await source.trigger('select')
      const open = async () => {
        await wrapper.get('[data-toolbar-menu="panel"] .toolbar-menu__trigger').trigger('click')
        await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
        await flushPromises()
        return wrapper.get(`[data-picker-command="${commandId}"]`)
      }

      let dialog = await open()
      await dialog.get('#column-layout-source').setValue('::: 2cols Invalid\nOnly one column\n:::')
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      expect(dialog.find('[role="alert"]').exists()).toBe(true)
      expect(textarea.value).toBe('Alpha')
      await dialog.get('.dialog-panel__actions button').trigger('click')
      await flushPromises()

      dialog = await open()
      const starter = columnLayoutStarterSource(commandId)
      expect((dialog.get('#column-layout-source').element as HTMLTextAreaElement).value).toBe(starter)
      await dialog.get('.dialog-panel__actions .primary-action').trigger('click')
      await flushPromises()
      expect(textarea.value).toBe(`Alpha\n\n${starter}`)
      wrapper.unmount()
    },
  )

  it('opens the selected semantic NodeView edit action with its current source and no pre-apply revision', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const panel = panelStarterSource('panel.info').replace('Information', 'Current title')
    await source.setValue(panel)
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    const edit = wrapper.get('[data-semantic-edit="panel-editor"]')
    await edit.trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[data-picker-command="panel.info"]')
    expect((dialog.get('#panel-source').element as HTMLTextAreaElement).value).toBe(panel)
    await dialog.get('.dialog-panel__actions button').trigger('click')
    await flushPromises()
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(panel)
    wrapper.unmount()
  })

  it('reports code clipboard success and permission failure without changing content', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const source = '```javascript\nconst answer = 42\n```'
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    try {
      await wrapper.get('#markdown-source').setValue(source)
      await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-semantic-copy="code-block"]').trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith('const answer = 42')
      expect(wrapper.get('.status-region__command').text()).toBe('Code copied.')

      writeText.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      await wrapper.get('[data-semantic-copy="code-block"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('.status-region__command').text()).toContain('Code copy failed')
      expect(wrapper.get('[data-w-editor-node="code-block"] code').text()).toBe('const answer = 42')
    } finally {
      wrapper.unmount()
      if (originalClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
  })

  it('applies a selected code language once, persists, previews, and cancels without a later change', async () => {
    const original = '```javascript\nconst answer = 42\n```'
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('#markdown-source').setValue(original)
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-semantic-edit="code-block-editor"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.code-mirror-dialog .cm-editor').exists()).toBe(true)

    expect(wrapper.get('#code-block-language').element.tagName).toBe('SELECT')
    await wrapper.get('#code-block-language').setValue('typescript')
    await wrapper.get('[data-editor-command="insert.code-block"] .primary-action').trigger('click')
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    expect(wrapper.find('[data-editor-command="insert.code-block"]').exists()).toBe(false)
    expect(wrapper.get('[data-w-editor-node="code-block"]').attributes('data-preview-state')).toBe('ready')

    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    const applied = '```typescript\nconst answer = 42\n```'
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', applied)
    const stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      autosave: { markdown: string }
    }
    expect(stored.autosave.markdown).toBe(applied)

    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-semantic-edit="code-block-editor"]').trigger('click')
    await flushPromises()
    await wrapper.get('#code-block-language').setValue('')
    await wrapper.get('[data-editor-command="insert.code-block"] .dialog-panel__actions button').trigger('click')
    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.visual-surface').html()).toContain('language-typescript')
    expect(wrapper.get('.visual-surface').text()).toContain('const answer = 42')
    wrapper.unmount()
  })

  it.each([
    ['insert.inline-code', 0, 5, '`Alpha`'],
    ['insert.hard-break', 2, 2, 'Al  \npha'],
    ['insert.horizontal-rule', 2, 2, 'Alpha\n\n---'],
    ['insert.toc', 2, 2, 'Alpha\n\n[[toc]]'],
  ] as const)('executes %s through its exact source insertion route', async (commandId, from, to, expected) => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha')
    textarea.setSelectionRange(from, to)
    await source.trigger('select')
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
    await flushPromises()
    expect(textarea.value).toBe(expected)
    wrapper.unmount()
  })

  it('keeps one TOC in source mode', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('# Alpha')
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    await source.trigger('select')

    const insertToc = async () => clickVisibleMenuCommand(wrapper, 'insert', 'insert.toc')
    await insertToc()
    expect(textarea.value).toBe('# Alpha\n\n[[toc]]')
    expect(textarea.value.match(/^\[\[toc\]\]$/gmu)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    const storedAfterFirst = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      autosave: { markdown: string; revision: number }
    }
    const firstRevision = storedAfterFirst.autosave.revision

    await insertToc()
    expect(wrapper.get('.status-region__command').text()).toBe('目录已存在。')
    expect(textarea.value).toBe('# Alpha\n\n[[toc]]')
    expect(textarea.value.match(/^\[\[toc\]\]$/gmu)).toHaveLength(1)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([9, 16])
    expect(document.activeElement).toBe(textarea)
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    const storedAfterSecond = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      autosave: { markdown: string; revision: number }
    }
    expect(storedAfterSecond.autosave.markdown).toBe('# Alpha\n\n[[toc]]')
    expect(storedAfterSecond.autosave.revision).toBe(firstRevision)
    wrapper.unmount()
  })

  it('does not defer TOC selection after the source marker is removed before Visual entry', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    await source.setValue('# Alpha\n\n[[toc]]')

    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.toc')
    expect(wrapper.get('.status-region__command').text()).toBe('目录已存在。')

    await source.setValue('# Alpha')
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-w-editor-node="toc"]').exists()).toBe(false)
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', '# Alpha')
    wrapper.unmount()
  })

  it('does not defer TOC selection into another article before Visual entry', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    await source.setValue('# Alpha\n\n[[toc]]')

    await clickVisibleMenuCommand(wrapper, 'insert', 'insert.toc')
    expect(wrapper.get('.status-region__command').text()).toBe('目录已存在。')

    await wrapper.findAll('.article-card')[1]?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="article-switch-decision"]').exists()).toBe(true)
    await wrapper.get('[data-testid="article-switch-draft"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-w-editor-node="toc"]').exists()).toBe(false)
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty(
      'value',
      PRODUCT_NOTES_MARKDOWN,
    )
    wrapper.unmount()
  })

  it.each([
    ['text.ruby', 'annotation'],
    ['text.size', '24'],
    ['text.color', '#2563eb'],
    ['text.background', '#bbf7d0'],
  ] as const)('applies %s from its picker and leaves source unchanged on cancel', async (commandId, value) => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Keep token tail')
    textarea.setSelectionRange(5, 10)
    await source.trigger('select')

    const openPicker = async () => {
      const menuId = commandId === 'text.ruby'
        ? 'text-style'
        : commandId === 'text.color' || commandId === 'text.background'
          ? 'color'
          : null
      if (menuId !== null) {
        await wrapper.get(`[data-toolbar-menu="${menuId}"] .toolbar-menu__trigger`).trigger('click')
      }
      if (menuId !== 'color' || commandId !== 'text.color') {
        await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
      }
      await flushPromises()
      return wrapper.get(`[data-picker-command="${commandId}"]`)
    }
    let picker = await openPicker()
    expect(picker.attributes('role')).toBe('dialog')
    if (commandId === 'text.color' || commandId === 'text.background') {
      await picker.trigger('keydown', { key: 'Escape' })
    } else {
      await picker.get('.dialog-panel__actions button').trigger('click')
    }
    await flushPromises()
    expect(textarea.value).toBe('Keep token tail')

    picker = await openPicker()
    await picker.get('#rich-picker-value').setValue(value)
    if (commandId !== 'text.color' && commandId !== 'text.background') {
      await picker.get('.dialog-panel__actions .primary-action').trigger('click')
    }
    await flushPromises()

    expect(textarea.value).toBe(
      `Keep ${formatRichInlineMark(commandId as RichInlineMarkCommandId, 'token', value)} tail`,
    )
    expect(wrapper.get(`[data-command-id="${commandId}"]`).attributes(
      commandId === 'text.size' ? 'aria-pressed' : 'aria-checked',
    )).toBe('true')
    wrapper.unmount()
  })

  it('opens the Cherry color picker directly without a redundant text/background menu', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-toolbar-menu="color"] .toolbar-menu__trigger').trigger('click')
    await flushPromises()

    const picker = wrapper.get('[data-picker-command="text.color"]')
    expect(wrapper.get('[data-toolbar-menu="color"] [role="menu"]').isVisible()).toBe(false)
    expect(picker.get('.rich-color-picker__tabs').text()).toContain('文字')
    expect(picker.get('.rich-color-picker__tabs').text()).toContain('背景')
    expect(picker.get('[data-color-action="clear"]').text()).toContain('清除颜色')
    expect(picker.find('.rich-color-picker__saturation').exists()).toBe(true)
    expect(picker.find('.rich-color-picker__hue').exists()).toBe(true)
    expect(picker.text()).toContain('最近使用颜色')
    expect(picker.text()).toContain('系统预设颜色')
    expect(picker.findAll('.rich-color-picker__preset')).toHaveLength(50)
    wrapper.unmount()
  })

  it('renders the flushed authoritative revision in a read-only final preview', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('#markdown-source').setValue('# Transactional preview\n\nExact source revision.')
    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.content-surface')).toHaveLength(1)
    expect(wrapper.get('.visual-surface').attributes('data-mode')).toBe('preview')
    expect(wrapper.get('.visual-surface .ProseMirror').attributes('aria-readonly')).toBe('true')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('[contenteditable="true"]').exists()).toBe(false)
    expect(wrapper.get('.visual-surface h1').text()).toBe('Transactional preview')
    expect(wrapper.get('.visual-surface').text()).toContain('Exact source revision.')
    wrapper.unmount()
  })

  it('routes explicit mode controls and the toolbar preview toggle through the same coordinated activation path', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const exactMarkdown = '# Coordinated modes\n\nPending source is flushed.'
    await wrapper.get('#markdown-source').setValue(exactMarkdown)
    expect(wrapper.findAll('.mode-control button').map((button) => button.text())).toEqual([
      'Source',
      'Visual',
      'Preview',
    ])

    const previewToggle = wrapper.get('[data-testid="toolbar-preview-toggle"]')
    expect(previewToggle.attributes('data-command-alias')).toBe('mode.preview')
    expect(previewToggle.attributes('aria-pressed')).toBe('false')
    await previewToggle.trigger('click')
    await flushPromises()
    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('preview')
    expect(wrapper.get('.visual-surface h1').text()).toBe('Coordinated modes')
    expect(previewToggle.attributes('aria-pressed')).toBe('true')

    await previewToggle.trigger('click')
    await flushPromises()
    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('source')
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', exactMarkdown)

    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    await previewToggle.trigger('click')
    await flushPromises()
    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('preview')
    await previewToggle.trigger('click')
    await flushPromises()
    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('visual')
    wrapper.unmount()
  })

  it('enters, exits, reports fullscreen failure, and cleans application state without content revisions', async () => {
    const originalFullscreenElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    const originalExitFullscreen = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
    let fullscreenElement: Element | null = null
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen })
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const shell = wrapper.get('.workspace-shell').element as HTMLElement
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = shell
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(shell, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    const originalMarkdown = (wrapper.get('#markdown-source').element as HTMLTextAreaElement).value
    const originalEnvelope = window.localStorage.getItem('w-editor:v1:document:welcome')
    const invokeFullscreen = async () => {
      await wrapper.get('[data-command-id="application.fullscreen"]').trigger('click')
      await flushPromises()
    }

    try {
      await invokeFullscreen()
      expect(requestFullscreen).toHaveBeenCalledOnce()
      expect(document.fullscreenElement).toBe(shell)
      expect(wrapper.get('.status-region__command').text()).toBe('Fullscreen entered.')
      expect(wrapper.get('[data-command-id="application.fullscreen"]').attributes('aria-pressed')).toBe('true')
      await wrapper.get('[data-command-id="application.fullscreen"]').trigger('click')
      await flushPromises()
      expect(exitFullscreen).toHaveBeenCalledOnce()
      expect(document.fullscreenElement).toBeNull()

      Object.defineProperty(shell, 'requestFullscreen', {
        configurable: true,
        value: vi.fn().mockRejectedValue(new Error('Fullscreen permission denied.')),
      })
      await invokeFullscreen()
      expect(wrapper.get('[data-testid="fullscreen-error"]').text()).toContain('Fullscreen permission denied.')
      expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(originalMarkdown)
      expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(originalEnvelope)
    } finally {
      wrapper.unmount()
      if (originalFullscreenElement === undefined) Reflect.deleteProperty(document, 'fullscreenElement')
      else Object.defineProperty(document, 'fullscreenElement', originalFullscreenElement)
      if (originalExitFullscreen === undefined) Reflect.deleteProperty(document, 'exitFullscreen')
      else Object.defineProperty(document, 'exitFullscreen', originalExitFullscreen)
    }
  })

  it('switches toolbar presentation across Chinese, English, and Russian while preserving command IDs and source', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source').element as HTMLTextAreaElement
    const exactMarkdown = source.value
    const originalEnvelope = window.localStorage.getItem('w-editor:v1:document:welcome')
    const chooseLanguage = async (commandId: 'language.en' | 'language.ru' | 'language.zh') => {
      await wrapper.get('[data-toolbar-menu="language"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
      await flushPromises()
    }

    expect(wrapper.get('[data-command-id="search.replace"]').text()).toContain('Search')
    await chooseLanguage('language.zh')
    expect(wrapper.get('[data-command-id="search.replace"]').text()).toContain('搜索')
    expect(wrapper.findAll('.mode-control button').map((button) => button.text())).toEqual(['源码', '可视化', '预览'])
    expect(wrapper.get('[data-testid="toolbar-preview-toggle"]').text()).toContain('预览')
    await wrapper.get('[data-toolbar-menu="language"] .toolbar-menu__trigger').trigger('click')
    expect(wrapper.get('[data-command-id="language.zh"]').attributes('aria-checked')).toBe('true')
    await wrapper.get('[data-command-id="language.ru"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-command-id="search.replace"]').text()).toContain('Поиск')
    expect(wrapper.findAll('.mode-control button').map((button) => button.text())).toEqual(['Исходник', 'Визуальный', 'Просмотр'])

    await chooseLanguage('language.en')
    expect(wrapper.get('[data-command-id="search.replace"]').text()).toContain('Search')
    expect(wrapper.findAll('.mode-control button').map((button) => button.text())).toEqual(['Source', 'Visual', 'Preview'])
    expect(source.value).toBe(exactMarkdown)
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(originalEnvelope)
    await wrapper.get('[data-toolbar-menu="language"] .toolbar-menu__trigger').trigger('click')
    expect(wrapper.findAll('[data-command-id]').map((node) => node.attributes('data-command-id'))).toContain('language.zh')
    expect(wrapper.findAll('[data-command-id]').map((node) => node.attributes('data-command-id'))).toContain('language.en')
    wrapper.unmount()
  })

  it('opens statistics from the flushed authoritative revision, updates counts, and never mutates content', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    await source.setValue('Hello world\n\nПривет мир')
    const exactMarkdown = (source.element as HTMLTextAreaElement).value
    const envelopeBefore = window.localStorage.getItem('w-editor:v1:document:welcome')
    const openStatistics = async () => {
      await wrapper.get('[data-command-id="document.word-count"]').trigger('click')
      await flushPromises()
      return wrapper.get('[data-testid="word-count-dialog"]')
    }

    let dialog = await openStatistics()
    expect(dialog.get('[data-statistic="revision"]').text()).toBe('1')
    expect(dialog.get('[data-statistic="words"]').text()).toBe('4')
    expect(dialog.get('[data-statistic="lines"]').text()).toBe('3')
    expect(dialog.get('[data-statistic="paragraphs"]').text()).toBe('2')
    expect((source.element as HTMLTextAreaElement).value).toBe(exactMarkdown)
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
    await dialog.get('.primary-action').trigger('click')

    await source.setValue(`${exactMarkdown} again`)
    expect(wrapper.get('.workspace-controls__meta').text()).toContain('5 words')
    dialog = await openStatistics()
    expect(dialog.get('[data-statistic="revision"]').text()).toBe('2')
    expect(dialog.get('[data-statistic="words"]').text()).toBe('5')
    expect((source.element as HTMLTextAreaElement).value).toBe(`${exactMarkdown} again`)
    await dialog.get('.primary-action').trigger('click')
    wrapper.unmount()
  })

  it('shows live body counts alongside source words and excludes references across editor modes', async () => {
    seedArticleAutosave('welcome', '', new Date())
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper, 'zh')
    const source = wrapper.get('#markdown-source')
    const citation = referenceMarkdown({ id: 'count-test', number: 1, text: 'Author. Long reference title.' })
    const markdown = `中文 **hello** ${citation}`
    await source.setValue(markdown)
    await flushPromises()
    const counter = () => wrapper.get('[data-testid="body-word-count"]')
    expect(counter().text()).toBe('正文 3 字')
    expect(counter().attributes('title')).toContain('不计参考文献')
    expect(wrapper.get('.workspace-controls__meta').text()).toContain('个词')
    for (const mode of ['visual', 'preview', 'source']) {
      await wrapper.get(`[data-command-id="mode.${mode}"]`).trigger('click')
      await flushPromises()
      expect(counter().text()).toBe('正文 3 字')
    }
    expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(markdown)
    const persisted = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome')!)
    expect(persisted.autosave.markdown).toBe(markdown)
    expect(persisted.autosave.revision).toBe(2)
    await wrapper.get('#markdown-source').setValue(`${markdown} 新增`)
    expect(counter().text()).toBe('正文 5 字')
    await chooseVisibleLanguage(wrapper, 'en')
    expect(counter().text()).toBe('Body: 5')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(counter().text()).toBe('Текст: 5')
    wrapper.unmount()
  })

  it('downloads exact pending Markdown without changing autosave or manual-checkpoint state', async () => {
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:exact-markdown')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)

    try {
      const exactMarkdown = '# Pending export\n\nCafé 👋\n\n'
      await wrapper.get('#markdown-source').setValue(exactMarkdown)
      const statusBefore = wrapper.get('[aria-label="Workspace status"]').text()
      const envelopeBefore = window.localStorage.getItem('w-editor:v1:document:welcome')

      await chooseVisibleLanguage(wrapper, 'zh')
      await clickVisibleMenuCommand(wrapper, 'export', 'export.markdown')

      expect(createObjectURL).toHaveBeenCalledOnce()
      const downloaded = createObjectURL.mock.calls[0]?.[0]
      expect(downloaded).toBeInstanceOf(Blob)
      await expect((downloaded as Blob).text()).resolves.toBe(exactMarkdown)
      expect(click).toHaveBeenCalledOnce()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:exact-markdown')
      expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(exactMarkdown)
      const exportFeedback = wrapper.get('.status-region__command')
      const exportFeedbackElement = exportFeedback.element
      expect(exportFeedback.text()).toBe('Markdown 修订 1 已下载。')
      await chooseVisibleLanguage(wrapper, 'en')
      expect(wrapper.get('.status-region__command').element).toBe(exportFeedbackElement)
      expect(exportFeedback.text()).toBe('Markdown revision 1 downloaded.')
      expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave pending')
      expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint dirty')
      expect(statusBefore).toContain('Autosave pending')
      expect(statusBefore).toContain('Manual checkpoint dirty')
      await chooseVisibleLanguage(wrapper, 'ru')
      expect(wrapper.get('.status-region__command').element).toBe(exportFeedbackElement)
      expect(exportFeedback.text()).toBe('Редакция Markdown 1 загружена.')
      expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
    } finally {
      wrapper.unmount()
      click.mockRestore()
      if (originalCreateObjectURL === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
      else Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
      if (originalRevokeObjectURL === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
      else Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    }
  })

  it('exports safe standalone HTML files from one settled Tiptap presentation per request and exposes failures', async () => {
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:rendered-export')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const render = vi.fn((snapshot: { readonly documentId: string; readonly markdown: string; readonly revision: number }) => ({
      html: '<h1>Rendered export</h1><script>bad()</script><a href="javascript:bad()" onclick="bad()">unsafe</a>',
      snapshot,
    }))
    const wrapper = mount(App, { attachTo: document.body, props: { previewRenderer: { render } } })
    await activateSourceMode(wrapper)

    const invokeExport = async (commandId: 'export.html') => {
      await wrapper.get('[data-toolbar-menu="export"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
      await flushPromises()
    }

    try {
      const exactMarkdown = '# Rendered export\n\nPending 👋\n\n<script>bad()</script><a href="javascript:bad()" onclick="bad()">unsafe</a>\n'
      await wrapper.get('#markdown-source').setValue(exactMarkdown)
      const envelopeBefore = window.localStorage.getItem('w-editor:v1:document:welcome')

      await invokeExport('export.html')
      expect(wrapper.find('[data-command-id="export.word"]').exists()).toBe(false)

      expect(render).not.toHaveBeenCalled()
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const [htmlBlob] = createObjectURL.mock.calls.map(([blob]) => blob)
      expect(htmlBlob).toBeInstanceOf(Blob)
      const html = await htmlBlob?.text()
      expect(html).toContain('<!doctype html>')
      expect(html).toContain('class="w-editor-export tiptap ProseMirror rendered-document-content"')
      expect(html).toContain('Rendered export')
      expect(html).toContain('unsafe')
      for (const exported of [html]) {
        const parsed = new DOMParser().parseFromString(exported ?? '', 'text/html')
        expect(parsed.querySelector('main script, main [onclick], main a[href^="javascript:"]')).toBeNull()
      }
      expect(click).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledTimes(1)
      expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(exactMarkdown)
      expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
      expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave pending')
      expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint dirty')

      createObjectURL.mockImplementationOnce(() => { throw new Error('Downloads are blocked.') })
      await invokeExport('export.html')
      expect(wrapper.get('[data-testid="export-error"]').text()).toContain('Downloads are blocked.')
      expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(exactMarkdown)
      expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
    } finally {
      wrapper.unmount()
      click.mockRestore()
      if (originalCreateObjectURL === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
      else Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
      if (originalRevokeObjectURL === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
      else Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    }
  })

  it('downloads PDF and screenshot artifacts from the safe rendered pending revision without changing save state', async () => {
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:long-screenshot')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const capturePdf = vi.fn(async (rendered: { readonly documentId: string; readonly revision: number }) => Object.freeze({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      filename: `${rendered.documentId}.pdf`,
      mediaType: 'application/pdf',
      omittedRemoteImageCount: 1,
      revision: rendered.revision,
    }))
    const captureLongScreenshot = vi.fn(async (rendered: { readonly documentId: string; readonly revision: number }) => Object.freeze({
      blob: new Blob(['png'], { type: 'image/png' }),
      filename: `${rendered.documentId}.png`,
      mediaType: 'image/png',
      omittedRemoteImageCount: 2,
      revision: rendered.revision,
    }))
    const renderedExportAdapter = Object.freeze({
      captureLongScreenshot,
      capturePdf,
    }) satisfies RenderedExportAdapter
    const render = vi.fn((snapshot: { readonly documentId: string; readonly markdown: string; readonly revision: number }) => ({
      html: '<h1>Safe print</h1><script>bad()</script>',
      snapshot,
    }))
    const wrapper = mount(App, {
      attachTo: document.body,
      props: { previewRenderer: { render }, renderedExportAdapter },
    })
    await activateSourceMode(wrapper)
    const invokeExport = async (commandId: 'export.pdf' | 'export.screenshot') => {
      await wrapper.get('[data-toolbar-menu="export"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
      await flushPromises()
    }

    try {
      const exactMarkdown = '# Safe print\n\nPending revision.\n'
      await wrapper.get('#markdown-source').setValue(exactMarkdown)
      const envelopeBefore = window.localStorage.getItem('w-editor:v1:document:welcome')
      await invokeExport('export.pdf')
      expect(wrapper.get('.status-region__command').text()).toContain('remote images omitted: 1')
      await invokeExport('export.screenshot')
      expect(wrapper.get('.status-region__command').text()).toContain('remote images omitted: 2')

      expect(capturePdf).toHaveBeenCalledWith(expect.objectContaining({
        bodyHtml: '',
        documentId: 'welcome',
        lineHeight: 1.75,
        mountPresentation: expect.any(Function),
        presentationEngine: 'tiptap',
        revision: 1,
        theme: 'gray',
      }))
      expect(captureLongScreenshot).toHaveBeenCalledWith(expect.objectContaining({
        bodyHtml: '',
        documentId: 'welcome',
        lineHeight: 1.75,
        mountPresentation: expect.any(Function),
        presentationEngine: 'tiptap',
        revision: 1,
        theme: 'gray',
      }))
      expect(createObjectURL).toHaveBeenCalledTimes(2)
      expect(click).toHaveBeenCalledTimes(2)
      expect(revokeObjectURL).toHaveBeenCalledTimes(2)
      expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(exactMarkdown)
      expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
      expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave pending')
      expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint dirty')
    } finally {
      wrapper.unmount()
      click.mockRestore()
      if (originalCreateObjectURL === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
      else Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
      if (originalRevokeObjectURL === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
      else Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    }
  })

  it('shows PDF, taint, and oversize export failures without changing content', async () => {
    const captureLongScreenshot = vi.fn()
      .mockRejectedValueOnce(new BrowserRenderedExportError('CROSS_ORIGIN_TAINT', 'A remote image cannot be captured safely.'))
      .mockRejectedValueOnce(new BrowserRenderedExportError('CAPTURE_OVERSIZE', 'The rendered document exceeds the screenshot limit.'))
    const renderedExportAdapter = Object.freeze({
      captureLongScreenshot,
      capturePdf: () => { throw new BrowserRenderedExportError('PDF_FAILED', 'The browser could not create the PDF file.') },
    }) satisfies RenderedExportAdapter
    const wrapper = mount(App, { attachTo: document.body, props: { renderedExportAdapter } })
    await activateSourceMode(wrapper)
    const invokeExport = async (commandId: 'export.pdf' | 'export.screenshot') => {
      await wrapper.get('[data-toolbar-menu="export"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get(`[data-command-id="${commandId}"]`).trigger('click')
      await flushPromises()
    }

    const exactMarkdown = (wrapper.get('#markdown-source').element as HTMLTextAreaElement).value
    const envelopeBefore = window.localStorage.getItem('w-editor:v1:document:welcome')
    await invokeExport('export.pdf')
    expect(wrapper.get('[data-testid="export-error"]').text()).toContain('could not create the PDF file')
    await invokeExport('export.screenshot')
    expect(wrapper.get('[data-testid="export-error"]').text()).toContain('remote image cannot be captured safely')
    await invokeExport('export.screenshot')
    expect(wrapper.get('[data-testid="export-error"]').text()).toContain('exceeds the screenshot limit')
    expect((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value).toBe(exactMarkdown)
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave idle')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint clean')
    wrapper.unmount()
  })

  it('exposes disabled reasons for preview content commands while leaving application commands available', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()

    const contentCommands = wrapper.findAll('[data-command-id^="history."], [data-command-id="text.bold"], [data-command-id="text.italic"]')
    expect(contentCommands).toHaveLength(4)
    for (const command of contentCommands) {
      expect(command.attributes('disabled')).toBeDefined()
      expect(command.attributes('aria-describedby')).toBe('content-command-reason')
      expect(command.attributes('title')).toBe('Unavailable in final preview.')
    }
    expect(wrapper.get('#content-command-reason').text()).toBe('Document editing commands are unavailable in final preview.')
    expect((wrapper.get('[data-command-id="search.replace"]').element as HTMLButtonElement).disabled).toBe(false)
    expect((wrapper.get('[data-command-id="document.manual-save"]').element as HTMLButtonElement).disabled).toBe(false)
    wrapper.unmount()
  })

  it('cannot mutate hidden content from a preview menu and returns the exact source after application UI use', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const exactMarkdown = '# Preview command safety\n\nHidden authority stays exact.'
    await wrapper.get('#markdown-source').setValue(exactMarkdown)
    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()

    const strike = wrapper.get('[data-command-id="text.strike"]')
    expect(strike.attributes('disabled')).toBeDefined()
    expect(strike.attributes('title')).toBe('Unavailable in final preview.')
    await strike.trigger('click')
    expect(wrapper.get('.visual-surface h1').text()).toBe('Preview command safety')

    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.search-dock').exists()).toBe(true)
    expect(wrapper.find('.dialog-backdrop').exists()).toBe(false)
    await wrapper.get('.search-dock__close').trigger('click')
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', exactMarkdown)
    wrapper.unmount()
  })

  it('searches, navigates, replaces one or all source matches through checked document patches, and cancels as a no-op', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha beta alpha')

    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    await wrapper.get('#workspace-search').setValue('alpha')
    expect(wrapper.get('[data-testid="search-status"]').text()).toBe('Result 1 of 2')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 5])

    await wrapper.get('.search-dock__next').trigger('click')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([11, 16])
    await wrapper.get('.search-dock__expand').trigger('click')
    await wrapper.get('#workspace-replacement').setValue('Omega')
    await wrapper.get('.search-dock__replace-button').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Alpha beta Omega')
    expect(wrapper.get('[data-testid="search-status"]').text()).toBe('Result 1 of 1')

    await wrapper.findAll('.search-dock__replace-button')[1]?.trigger('click')
    await flushPromises()
    expect(textarea.value).toBe('Omega beta Omega')
    expect(wrapper.get('[data-testid="search-status"]').text()).toBe('No matches.')
    await wrapper.get('.search-dock__close').trigger('click')
    await flushPromises()

    const beforeCancel = textarea.value
    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    await wrapper.get('#workspace-search').setValue('Omega')
    await wrapper.get('.search-dock__expand').trigger('click')
    await wrapper.get('#workspace-replacement').setValue('Cancelled')
    await wrapper.get('.search-dock__close').trigger('click')
    await flushPromises()
    expect(textarea.value).toBe(beforeCancel)
    wrapper.unmount()
  })

  it('presents search as a non-modal editor-adjacent navigation bar', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('.search-dock')
    expect(dialog.attributes('role')).toBe('search')
    expect(dialog.attributes('aria-modal')).toBeUndefined()
    expect(wrapper.find('.dialog-backdrop').exists()).toBe(false)
    expect(dialog.find('#workspace-search').exists()).toBe(true)
    expect(dialog.find('.search-dock__toggle[aria-pressed="false"]').exists()).toBe(true)
    expect(dialog.find('[data-testid="search-status"]').exists()).toBe(true)
    expect(dialog.find('#workspace-replacement').exists()).toBe(false)
    await dialog.get('.search-dock__expand').trigger('click')
    expect(dialog.find('#workspace-replacement').exists()).toBe(true)
    expect(dialog.findAll('.search-dock__replace-button')).toHaveLength(2)

    wrapper.unmount()
  })

  it('uses the active visual adapter for search replacement and keeps preview replacement read-only', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    await wrapper.get('#markdown-source').setValue('Alpha beta Alpha')
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    await wrapper.get('#workspace-search').setValue('Alpha')
    await wrapper.get('.search-dock__expand').trigger('click')
    await wrapper.get('#workspace-replacement').setValue('Omega')
    expect(wrapper.get('[data-testid="search-status"]').text()).toBe('Result 1 of 2')
    await wrapper.findAll('.search-dock__replace-button')[1]?.trigger('click')
    await flushPromises()
    expect(wrapper.get('.visual-surface').text()).toContain('Omega beta Omega')
    await wrapper.get('.search-dock__close').trigger('click')
    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-command-id="search.replace"]').trigger('click')
    await flushPromises()
    await wrapper.get('#workspace-search').setValue('Omega')
    expect(wrapper.get('[data-testid="search-status"]').text()).toBe('Result 1 of 2')
    await wrapper.get('.search-dock__expand').trigger('click')
    for (const button of wrapper.findAll('.search-dock__replace-button')) {
      expect((button.element as HTMLButtonElement).disabled).toBe(true)
    }
    await wrapper.get('.search-dock__close').trigger('click')
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'Omega beta Omega')
    wrapper.unmount()
  })

  it('configures shortcuts by stable registry command ID without revising content and keeps cancel atomic', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const originalMarkdown = (source.element as HTMLTextAreaElement).value
    const originalEnvelope = window.localStorage.getItem('w-editor:v1:document:welcome')
    const shortcutPreferencesKey = 'w-editor:v1:preferences'
    const openSettings = async () => {
      await wrapper.get('[data-command-id="settings.shortcuts"]').trigger('click')
      await flushPromises()
      return wrapper.get('[data-testid="shortcut-settings"]')
    }
    const action = (dialog: ReturnType<typeof openSettings> extends Promise<infer T> ? T : never, name: string) => {
      const control = dialog.findAll('.dialog-panel__actions button').find((button) => button.text().trim() === name)
      if (control === undefined) throw new Error(`Missing shortcut action ${name}.`)
      return control
    }
    const record = async (
      dialog: ReturnType<typeof openSettings> extends Promise<infer T> ? T : never,
      commandId: string,
      key: string,
    ) => {
      await dialog.get(`[data-shortcut-command="${commandId}"] [data-shortcut-recorder]`).trigger('click')
      await dialog.trigger('keydown', { altKey: true, ctrlKey: true, key })
    }

    let dialog = await openSettings()
    const bold = dialog.get('[data-shortcut-command="text.bold"] [data-shortcut-recorder]')
    expect(bold.attributes('data-shortcut-value')).toBe('Mod-b')
    await record(dialog, 'text.bold', 'k')
    await action(dialog, 'Cancel').trigger('click')
    await flushPromises()
    expect((source.element as HTMLTextAreaElement).value).toBe(originalMarkdown)
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave idle')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint clean')
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(originalEnvelope)
    expect(window.localStorage.getItem(shortcutPreferencesKey)).toBeNull()

    dialog = await openSettings()
    await record(dialog, 'text.bold', 'k')
    await action(dialog, 'Apply shortcuts').trigger('click')
    await flushPromises()
    expect((source.element as HTMLTextAreaElement).value).toBe(originalMarkdown)
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Autosave idle')
    expect(wrapper.get('[aria-label="Workspace status"]').text()).toContain('Manual checkpoint clean')
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(originalEnvelope)
    expect(window.localStorage.getItem(shortcutPreferencesKey)).toContain('"text.bold":"Mod-Alt-k"')

    await source.setValue('Alpha')
    const textarea = source.element as HTMLTextAreaElement
    textarea.setSelectionRange(0, 5)
    await source.trigger('select')
    await source.trigger('keydown', { altKey: true, ctrlKey: true, key: 'k' })
    await flushPromises()
    expect(textarea.value).toBe('**Alpha**')

    dialog = await openSettings()
    await record(dialog, 'text.italic', 'k')
    const conflict = dialog.get('[role="alert"]')
    const conflictElement = conflict.element
    expect(conflict.text()).toContain('Italic')
    expect(conflict.text()).toContain('Bold')
    expect(conflict.text()).not.toContain('text.italic')
    expect(conflict.text()).not.toContain('text.bold')
    await chooseVisibleLanguage(wrapper, 'zh')
    expect(dialog.get('[role="alert"]').element).toBe(conflictElement)
    expect(conflict.text()).toContain('斜体')
    expect(conflict.text()).toContain('粗体')
    await chooseVisibleLanguage(wrapper, 'ru')
    expect(dialog.get('[role="alert"]').element).toBe(conflictElement)
    expect(conflict.text()).toContain('Курсив')
    expect(conflict.text()).toContain('Жирный')
    expect(textarea.value).toBe('**Alpha**')
    await action(dialog, 'Отмена').trigger('click')
    wrapper.unmount()
  })

  it('focuses Search on open and restores the opening Source caret after an empty or no-match close', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source')
    const textarea = source.element as HTMLTextAreaElement
    await source.setValue('Alpha beta omega')
    textarea.setSelectionRange(8, 8)
    const trigger = wrapper.get('[data-command-id="search.replace"]')
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    await flushPromises()

    expect(wrapper.get('.search-dock').attributes('role')).toBe('search')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('#workspace-search').element)
    await wrapper.get('#workspace-search').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.search-dock').exists()).toBe(false)
    expect(document.activeElement).toBe(source.element)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([8, 8])

    await trigger.trigger('click')
    await flushPromises()
    await wrapper.get('#workspace-search').setValue('Alpha')
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([0, 5])
    await wrapper.get('#workspace-search').setValue('AlphaX')
    expect(wrapper.get('[data-testid="search-status"]').text()).toBe('No matches.')
    await wrapper.get('.search-dock__close').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(source.element)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([8, 8])
    wrapper.unmount()
  })

  it('places line spacing immediately before Word count, removes the Final Preview heading, and keeps the preference outside document revisions', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await activateSourceMode(wrapper)
    const source = wrapper.get('#markdown-source').element as HTMLTextAreaElement
    const markdownBefore = source.value
    const lineSpacing = wrapper.get('[data-toolbar-slot="line-spacing"]')
    const wordCount = wrapper.get('[data-command-id="document.word-count"]')
    expect(lineSpacing.element.compareDocumentPosition(wordCount.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const envelopeBefore = window.localStorage.getItem('w-editor:v1:document:welcome')

    await lineSpacing.get('button').trigger('click')
    const menu = wrapper.get('[data-testid="line-spacing-menu"]')
    expect(menu.findAll('[role="menuitemradio"]')).toHaveLength(4)
    await menu.get('[data-line-spacing-option="double"]').trigger('click')
    expect(wrapper.get('.workspace-shell').attributes('style')).toContain('--w-editor-line-height: 2')
    expect(source.value).toBe(markdownBefore)
    expect(window.localStorage.getItem('w-editor:v1:document:welcome')).toBe(envelopeBefore)
    expect(window.localStorage.getItem('w-editor:line-spacing')).toBe('double')

    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.preview-label').exists()).toBe(false)
    expect(wrapper.get('.visual-surface').text()).not.toContain('最终 Cherry 预览')
    wrapper.unmount()
  })

  it('does not invoke the Cherry renderer when application Preview uses the read-only Tiptap presentation', async () => {
    const failure = Object.assign(new Error('Preview fixture failed.'), { code: 'CHERRY_RENDER_FAILED' })
    const render = vi.fn(() => { throw failure })
    const wrapper = mount(App, {
      attachTo: document.body,
      props: { previewRenderer: { render } },
    })
    await activateSourceMode(wrapper)
    const preview = wrapper.get('[data-command-id="mode.preview"]')
    ;(preview.element as HTMLButtonElement).focus()
    await preview.trigger('click')
    await flushPromises()

    expect(wrapper.get('.content-surface').attributes('data-mode')).toBe('preview')
    expect(wrapper.get('.visual-surface .ProseMirror').attributes('contenteditable')).toBe('false')
    expect(render).not.toHaveBeenCalled()
    expect(wrapper.find('.workspace-error').exists()).toBe(false)
    wrapper.unmount()
  })
})
