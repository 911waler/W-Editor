import type { ElementHandle, JSHandle, Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

const EXPECTED = {
  zh: { apply: '应用', cancel: '取消', query: '搜索文本', search: '搜索本文', toc: '目录' },
  en: { apply: 'Apply', cancel: 'Cancel', query: 'Search text', search: 'Search this article', toc: 'Table of contents' },
  ru: { apply: 'Применить', cancel: 'Отмена', query: 'Текст поиска', search: 'Поиск по статье', toc: 'Оглавление' },
} as const

type Locale = keyof typeof EXPECTED
type LocalizedString = Readonly<Record<Locale, string>>

const LOCALES: readonly Locale[] = Object.freeze(['zh', 'en', 'ru'])
const AUTHORED_TEXT = 'User English 中文 Русский E=mc^2'
const AUTHORED_URL = 'https://example.com/User-English/%E4%B8%AD%E6%96%87/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9?q=E%3Dmc%5E2#exact'
const AUTHORED_FILENAME = 'User-English_中文_Русский-E=mc^2.pdf'
const IMPORT_FILENAME = 'Imported-User-English_中文_Русский.md'
const AUTHORED_MARKDOWN = [
  '# Localization heading',
  AUTHORED_TEXT,
  `[${AUTHORED_FILENAME}](${AUTHORED_URL})`,
  '[[toc]]',
  '| Name | Value |\n| :--- | :--- |\n| User | 42 |',
  '```javascript\nconst answer = 42\n```',
  '```mermaid\nflowchart LR\n  Start([Start]) --> Finish([Finish])\n```',
  '| :line: {"title": "Line Table"} | a | b |\n| :-: | :-: | :-: |\n| x | 1 | 2 |',
  '$$\nE = mc^2\n$$',
  '::: mystery\nraw body\n:::',
  '::: info Information\nPanel body\n:::',
].join('\n\n')

function localized(en: string, zh: string, ru: string): LocalizedString {
  return Object.freeze({ en, ru, zh })
}

const SHELL = {
  zh: {
    articles: '文章',
    mode: '编辑模式',
    modes: ['源码', '可视化', '预览'],
    status: '工作区状态',
    toolbar: 'W-Editor 工具栏',
  },
  en: {
    articles: 'Articles',
    mode: 'Editor mode',
    modes: ['Source', 'Visual', 'Preview'],
    status: 'Workspace status',
    toolbar: 'W-Editor toolbar',
  },
  ru: {
    articles: 'Статьи',
    mode: 'Режим редактора',
    modes: ['Исходник', 'Визуальный', 'Просмотр'],
    status: 'Статус рабочей области',
    toolbar: 'Панель инструментов W-Editor',
  },
} as const

const SURFACES = {
  zh: {
    addColumnBefore: '在前面添加列',
    addRowBefore: '在前面添加行',
    advancedCode: '高级代码编辑器',
    chooseTableSize: '选择表格大小',
    clearColor: '清除颜色',
    code: '代码块',
    color: '文字和背景颜色',
    columns: '双栏源码',
    copyCode: '复制代码',
    previewEditCode: '编辑代码',
    drawio: 'draw.io 图表',
    editSource: '编辑源码',
    editRaw: '编辑未知块源码',
    file: '文件资源',
    foldCode: '折叠代码',
    formula: '插入公式',
    formulaRendered: '已渲染的块级公式',
    image: '图片资源',
    link: '链接目标',
    panel: '面板源码',
    raw: '未知块源码',
    shortcuts: '键盘快捷键',
    applyShortcuts: '应用快捷键',
    visualTable: '可编辑 Markdown 表格',
  },
  en: {
    addColumnBefore: 'Add column before',
    addRowBefore: 'Add row before',
    advancedCode: 'Advanced code editor',
    chooseTableSize: 'Choose table size',
    clearColor: 'Clear color',
    code: 'Code block',
    color: 'Text and background color',
    columns: 'Column layout source',
    copyCode: 'Copy code',
    previewEditCode: 'Edit code',
    drawio: 'draw.io diagram',
    editSource: 'Edit source',
    editRaw: 'Edit unknown block source',
    file: 'File asset',
    foldCode: 'Fold code',
    formula: 'Insert formula',
    formulaRendered: 'Rendered block formula',
    image: 'Image asset',
    link: 'Link destination',
    panel: 'Panel source',
    raw: 'Unknown block source',
    shortcuts: 'Keyboard shortcuts',
    applyShortcuts: 'Apply shortcuts',
    visualTable: 'Editable Markdown table',
  },
  ru: {
    addColumnBefore: 'Добавить столбец перед',
    addRowBefore: 'Добавить строку перед',
    advancedCode: 'Расширенный редактор кода',
    chooseTableSize: 'Выберите размер таблицы',
    clearColor: 'Очистить цвет',
    code: 'Блок кода',
    color: 'Цвет текста и фона',
    columns: 'Исходник макета колонок',
    copyCode: 'Копировать код',
    previewEditCode: 'Редактировать код',
    drawio: 'Диаграмма draw.io',
    editSource: 'Редактировать исходный текст',
    editRaw: 'Изменить исходник неизвестного блока',
    file: 'Файл',
    foldCode: 'Свернуть код',
    formula: 'Вставить формулу',
    formulaRendered: 'Отрисованная блочная формула',
    image: 'Изображение',
    link: 'Адрес ссылки',
    panel: 'Исходник панели',
    raw: 'Исходник неизвестного блока',
    shortcuts: 'Сочетания клавиш',
    applyShortcuts: 'Применить сочетания',
    visualTable: 'Редактируемая таблица Markdown',
  },
} as const

const MENUS = Object.freeze([
  {
    commands: Object.freeze([
      ['text.strike', localized('Strikethrough', '删除线', 'Зачёркнутый')],
      ['text.underline', localized('Underline', '下划线', 'Подчёркнутый')],
      ['text.subscript', localized('Subscript', '下标', 'Нижний индекс')],
      ['text.superscript', localized('Superscript', '上标', 'Верхний индекс')],
      ['text.ruby', localized('Ruby annotation', '注音', 'Руби-аннотация')],
      ['block.quote', localized('Quote', '引用', 'Цитата')],
    ] as const),
    id: 'text-style',
    label: localized('Text style', '文字样式', 'Стиль текста'),
    sections: Object.freeze([localized('Text formatting', '文本格式', 'Формат текста')]),
  },
  {
    commands: Object.freeze([
      ['block.h1', localized('Heading 1', '一级标题', 'Заголовок 1')],
      ['block.h2', localized('Heading 2', '二级标题', 'Заголовок 2')],
      ['block.h3', localized('Heading 3', '三级标题', 'Заголовок 3')],
      ['block.h4', localized('Heading 4', '四级标题', 'Заголовок 4')],
      ['block.h5', localized('Heading 5', '五级标题', 'Заголовок 5')],
    ] as const),
    id: 'heading',
    label: localized('Heading', '标题', 'Заголовок'),
    sections: Object.freeze([localized('Headings', '标题', 'Заголовки')]),
  },
  {
    commands: Object.freeze([
      ['panel.primary', localized('Primary panel', '主要面板', 'Основная панель')],
      ['panel.info', localized('Info panel', '信息面板', 'Информационная панель')],
      ['panel.warning', localized('Warning panel', '警告面板', 'Панель предупреждения')],
      ['panel.danger', localized('Danger panel', '危险面板', 'Панель опасности')],
      ['panel.success', localized('Success panel', '成功面板', 'Панель успеха')],
      ['layout.two-column', localized('Two columns', '双栏', 'Две колонки')],
      ['layout.multi-column', localized('Multiple columns', '多栏', 'Несколько колонок')],
      ['layout.tabs', localized('Tabs', '标签页', 'Вкладки')],
    ] as const),
    id: 'panel',
    label: localized('Panel', '面板', 'Панель'),
    sections: Object.freeze([
      localized('Panels', '面板', 'Панели'),
      localized('Layout and disclosure', '布局与展开', 'Макет'),
    ]),
  },
  {
    commands: Object.freeze([
      ['align.left', localized('Align left', '左对齐', 'По левому краю')],
      ['align.center', localized('Align center', '居中对齐', 'По центру')],
      ['align.right', localized('Align right', '右对齐', 'По правому краю')],
      ['align.justify', localized('Justify', '两端对齐', 'По ширине')],
    ] as const),
    id: 'alignment',
    label: localized('Alignment', '对齐', 'Выравнивание'),
    sections: Object.freeze([localized('Alignment', '对齐', 'Выравнивание')]),
  },
  {
    commands: Object.freeze([
      ['insert.image', localized('Image', '图片', 'Изображение')],
      ['insert.audio', localized('Audio', '音频', 'Аудио')],
      ['insert.video', localized('Video', '视频', 'Видео')],
      ['insert.link', localized('Link', '链接', 'Ссылка')],
      ['insert.horizontal-rule', localized('Horizontal rule', '分隔线', 'Горизонтальная линия')],
      ['insert.hard-break', localized('Hard break', '强制换行', 'Жёсткий перенос')],
      ['insert.code-block', localized('Code block', '代码块', 'Блок кода')],
      ['insert.inline-code', localized('Inline code', '行内代码', 'Строчный код')],
      ['insert.formula', localized('Formula', '公式', 'Формула')],
      ['insert.toc', localized(EXPECTED.en.toc, EXPECTED.zh.toc, EXPECTED.ru.toc)],
      ['insert.table', localized('Table', '表格', 'Таблица')],
      ['insert.pdf', localized('PDF attachment', 'PDF 附件', 'PDF-вложение')],
      ['insert.word', localized('Word attachment', 'Word 附件', 'Документ Word')],
      ['insert.file', localized('File attachment', '文件附件', 'Файл')],
    ] as const),
    id: 'insert',
    label: localized('Insert', '插入', 'Вставка'),
    sections: Object.freeze([localized('Insert', '插入', 'Вставка')]),
  },
  {
    commands: Object.freeze([
      ['mermaid.flowchart', localized('Flowchart', '流程图', 'Блок-схема')],
      ['mermaid.sequence', localized('Sequence diagram', '时序图', 'Диаграмма последовательности')],
      ['mermaid.state', localized('State diagram', '状态图', 'Диаграмма состояний')],
      ['mermaid.class', localized('Class diagram', '类图', 'Диаграмма классов')],
      ['mermaid.pie', localized('Pie diagram', '饼图', 'Круговая диаграмма')],
      ['mermaid.gantt', localized('Gantt diagram', '甘特图', 'Диаграмма Ганта')],
    ] as const),
    id: 'mermaid',
    label: localized('Draw', '画图', 'Рисование'),
    sections: Object.freeze([localized('Mermaid', 'Mermaid 绘图', 'Mermaid')]),
  },
  {
    commands: Object.freeze([
      ['chart.line', localized('Line chart', '折线图', 'Линейный график')],
      ['chart.bar', localized('Bar chart', '柱状图', 'Столбчатая диаграмма')],
      ['chart.radar', localized('Radar chart', '雷达图', 'Радарная диаграмма')],
      ['chart.map', localized('Map chart', '地图', 'Карта')],
      ['chart.heatmap', localized('Heatmap', '热力图', 'Тепловая карта')],
      ['chart.scatter', localized('Scatter chart', '散点图', 'Точечная диаграмма')],
      ['chart.pie', localized('Pie chart', '饼状图', 'Круговая диаграмма')],
      ['chart.sankey', localized('Sankey chart', '桑基图', 'Диаграмма Санки')],
    ] as const),
    id: 'chart',
    label: localized('Chart', '图表', 'Диаграмма'),
    sections: Object.freeze([localized('Chart tables', '图表', 'Диаграммы')]),
  },
  {
    commands: Object.freeze([
      ['language.zh', localized('Chinese', '中文', 'Китайский')],
      ['language.en', localized('English', '英语', 'Английский')],
      ['language.ru', localized('Russian', '俄语', 'Русский')],
    ] as const),
    id: 'language',
    label: localized('Language', '语言', 'Язык'),
    sections: Object.freeze([localized('Language', '语言', 'Язык')]),
  },
  {
    commands: Object.freeze([
      ['export.markdown', localized('Markdown file', 'Markdown 文件', 'Файл Markdown')],
      ['export.html', localized('HTML file', 'HTML 文件', 'Файл HTML')],
      ['export.word', localized('Word-compatible file', 'Word 兼容文件', 'Файл Word')],
      ['export.pdf', localized('Export PDF', '导出 PDF', 'Экспорт PDF')],
      ['export.screenshot', localized('Long screenshot', '长截图', 'Длинный снимок')],
    ] as const),
    id: 'export',
    label: localized('Export', '导出', 'Экспорт'),
    sections: Object.freeze([localized('Export', '导出', 'Экспорт')]),
  },
] as const)

async function authorityMarkdown(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read().markdown)
}

function normalizeVisibleString(value: string | null): string {
  return value?.replace(/\s+/gu, ' ').trim() ?? ''
}

const LOCALIZATION_RETRY_TIMEOUT = 1_000

async function expectSoftText(locator: Locator, expected: string): Promise<void> {
  await expect.soft.poll(
    async () => normalizeVisibleString(await locator.textContent()),
    { timeout: LOCALIZATION_RETRY_TIMEOUT },
  ).toBe(expected)
}

async function expectSoftAriaLabel(locator: Locator, expected: string): Promise<void> {
  await expect.soft.poll(
    async () => locator.getAttribute('aria-label'),
    { timeout: LOCALIZATION_RETRY_TIMEOUT },
  ).toBe(expected)
}

async function expectSoftTitle(locator: Locator, expected: string): Promise<void> {
  await expect.soft.poll(
    async () => locator.getAttribute('title'),
    { timeout: LOCALIZATION_RETRY_TIMEOUT },
  ).toBe(expected)
}

type AppOwnedString = Readonly<{ origin: string; value: string }>

async function appOwnedStrings(scope: Locator, excludedSelectors: readonly string[] = []): Promise<readonly AppOwnedString[]> {
  await expect(scope).toBeVisible()
  return scope.evaluate((root, exclusions) => {
    const excluded = exclusions.join(',')
    const isExcluded = (element: Element): boolean => excluded.length > 0 && element.closest(excluded) !== null
    const isVisible = (element: Element): boolean => {
      if (element.closest('[aria-hidden="true"]') !== null) return false
      const htmlElement = element as HTMLElement
      const style = getComputedStyle(htmlElement)
      return style.display !== 'none' && style.visibility !== 'hidden' && htmlElement.getClientRects().length > 0
    }
    const strings: { origin: string; value: string }[] = []
    const elements = [root, ...root.querySelectorAll('*')]
    for (const element of elements) {
      if (isExcluded(element) || !isVisible(element)) continue
      for (const attribute of ['aria-label', 'placeholder', 'title'] as const) {
        const value = element.getAttribute(attribute)?.replace(/\s+/gu, ' ').trim() ?? ''
        if (value.length > 0) strings.push({ origin: `${element.tagName.toLowerCase()}[${attribute}]`, value })
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement
      if (parent === null || isExcluded(parent) || parent.closest('[contenteditable="true"], .cm-content') !== null || !isVisible(parent)) continue
      const value = node.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
      if (value.length > 0) strings.push({ origin: `${parent.tagName.toLowerCase()}#text`, value })
    }
    return strings
  }, [...excludedSelectors])
}

function stripStableTechnicalContent(value: string): string {
  return value
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, '')
    .replace(/\b[A-Za-z0-9._-]+\.(?:md|markdown|pdf|docx?|html?|png|jpe?g|gif|svg|mp3|mp4|webm)\b/giu, '')
    .replace(/\b(?:W-Editor|Markdown|KaTeX|Cherry|Tiptap|draw\.io|Mermaid|JavaScript|HTML|PDF|Word|URL|MIME|JSON|SVG|PNG|JPE?G|GIF|WebM|MP3|MP4|UTF-8|HSL|RGB|HEX)\b/giu, '')
    .replace(/\b(?:Ctrl|Cmd|Mod|Control(?:Left|Right)?|Shift(?:Left|Right)?|Alt(?:Left|Right)?|Meta(?:Left|Right)?|Enter|NumpadEnter|Escape|Esc|Tab|Space|Spacebar|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu|Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal)|F(?:[1-9]|1[0-2]))\b/gu, '')
    .replace(/#[0-9A-Fa-f]{3,8}\b/gu, '')
}

function staleLanguageStrings(strings: readonly AppOwnedString[], locale: Locale): readonly AppOwnedString[] {
  return strings.filter(({ value }) => {
    const inspectable = stripStableTechnicalContent(value)
    if (locale === 'en') return /[\p{Script=Han}\p{Script=Cyrillic}]/u.test(inspectable)
    if (/\p{Script=Han}/u.test(inspectable)) return locale === 'ru'
    if (/\p{Script=Cyrillic}/u.test(inspectable)) return locale === 'zh'
    return /[A-Za-z]{2,}/u.test(inspectable)
  })
}

async function assertLocalizedSurface(
  scope: Locator,
  locale: Locale,
  excludedSelectors: readonly string[] = [],
): Promise<void> {
  const readStaleStrings = async (): Promise<readonly AppOwnedString[]> =>
    staleLanguageStrings(await appOwnedStrings(scope, excludedSelectors), locale)
  await expect.soft.poll(
    readStaleStrings,
    {
      message: `${locale} surface contains visible stale-language app copy`,
      timeout: LOCALIZATION_RETRY_TIMEOUT,
    },
  ).toEqual([])
}

async function assertStartupLanguageContract(page: Page): Promise<void> {
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  const owner = page.locator('[data-toolbar-menu="language"]')
  const trigger = owner.locator('.toolbar-menu__trigger')
  await expect(trigger).toHaveAttribute('aria-label', '语言')
  await trigger.click()
  const panel = owner.getByRole('menu')
  await expect(panel).toBeVisible()
  const commands = panel.locator('[data-command-id]')
  expect(await commands.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-command-id')))).toEqual([
    'language.zh',
    'language.en',
    'language.ru',
  ])
  expect(await commands.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-checked')))).toEqual([
    'true',
    'false',
    'false',
  ])
  expect(await commands.locator('span').evaluateAll((elements) => elements
    .filter((element) => !element.classList.contains('toolbar-menu__icon'))
    .map((element) => element.textContent?.trim()))).toEqual(['中文', '英语', '俄语'])
  await assertLocalizedSurface(panel, 'zh')
  await page.keyboard.press('Escape')
}

async function selectLocale(page: Page, locale: Locale): Promise<void> {
  await page.locator('[data-toolbar-menu="language"] .toolbar-menu__trigger').click()
  const command = page.locator(`[data-command-id="language.${locale}"]`)
  await command.click()
  await expect(command).toHaveAttribute('aria-checked', 'true')
}

async function seedAuthoredDocument(page: Page): Promise<void> {
  const input = page.getByTestId('import-markdown-input')
  await input.setInputFiles({
    buffer: Buffer.from(AUTHORED_MARKDOWN, 'utf8'),
    mimeType: 'text/markdown',
    name: IMPORT_FILENAME,
  })
  const confirmation = page.getByTestId('document-lifecycle-confirmation')
  await expect(confirmation).toHaveAttribute('data-confirmation-kind', 'import')
  await confirmation.getByTestId('document-lifecycle-confirm').click()
  await expect(confirmation).toHaveCount(0)
  await expect.poll(() => authorityMarkdown(page)).toBe(AUTHORED_MARKDOWN)
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  await expect(page.locator('.ProseMirror p').filter({ hasText: AUTHORED_TEXT })).toHaveText(AUTHORED_TEXT)
}

type BrowserSelectionSnapshot = Readonly<{
  anchorOffset: number
  focusOffset: number
  rangeCount: number
  text: string
}>

type VisualIdentity = Readonly<{
  anchorNode: JSHandle<Node | null>
  nodeHandles: readonly ElementHandle<Node>[]
  nodeSelector: string
  root: ElementHandle<Node>
  selection: BrowserSelectionSnapshot
}>

async function browserSelectionSnapshot(page: Page): Promise<BrowserSelectionSnapshot> {
  return page.evaluate(() => {
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    return {
      anchorOffset: selection.anchorOffset,
      focusOffset: selection.focusOffset,
      rangeCount: selection.rangeCount,
      text: selection.toString(),
    }
  })
}

async function captureVisualIdentity(page: Page): Promise<VisualIdentity> {
  const paragraph = page.locator('.ProseMirror p').filter({ hasText: AUTHORED_TEXT })
  await paragraph.evaluate((element, authoredText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let textNode = walker.nextNode()
    while (textNode !== null && !textNode.textContent?.includes(authoredText)) textNode = walker.nextNode()
    if (textNode === null) throw new Error('Authored localization text node was not found.')
    const start = textNode.textContent?.indexOf('User English') ?? -1
    if (start < 0) throw new Error('Authored selection start was not found.')
    const range = document.createRange()
    range.setStart(textNode, start)
    range.setEnd(textNode, start + 'User English'.length)
    const selection = window.getSelection()
    if (selection === null) throw new Error('Browser selection is unavailable.')
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, AUTHORED_TEXT)
  const nodeSelector = '.ProseMirror [data-w-editor-node], .ProseMirror [data-semantic-kind]'
  const root = await page.locator('.ProseMirror').elementHandle()
  if (root === null) throw new Error('Visual ProseMirror root was not found.')
  const nodeHandles = await page.locator(nodeSelector).elementHandles()
  expect(nodeHandles.length).toBeGreaterThan(0)
  return Object.freeze({
    anchorNode: await page.evaluateHandle(() => window.getSelection()?.anchorNode ?? null),
    nodeHandles: Object.freeze(nodeHandles),
    nodeSelector,
    root,
    selection: await browserSelectionSnapshot(page),
  })
}

async function assertVisualIdentity(page: Page, identity: VisualIdentity): Promise<void> {
  expect(await identity.root.evaluate((root) => root === document.querySelector('.ProseMirror'))).toBe(true)
  const currentNodeCount = await page.locator(identity.nodeSelector).count()
  expect(currentNodeCount).toBe(identity.nodeHandles.length)
  for (const [index, handle] of identity.nodeHandles.entries()) {
    expect(await handle.evaluate((node, input) => node === document.querySelectorAll(input.selector)[input.index], {
      index,
      selector: identity.nodeSelector,
    })).toBe(true)
  }
  expect(await identity.anchorNode.evaluate((anchor) => anchor !== null && anchor === window.getSelection()?.anchorNode)).toBe(true)
  expect(await browserSelectionSnapshot(page)).toEqual(identity.selection)
}

async function articleTitles(page: Page): Promise<readonly string[]> {
  return page.locator('.article-card__title').allTextContents()
}

async function assertAuthoredContent(
  page: Page,
  expectedArticleTitles: readonly string[],
): Promise<void> {
  await expect.poll(() => authorityMarkdown(page)).toBe(AUTHORED_MARKDOWN)
  const markdown = await authorityMarkdown(page)
  expect(markdown).toContain(AUTHORED_TEXT)
  expect(markdown).toContain(AUTHORED_URL)
  expect(markdown).toContain(AUTHORED_FILENAME)
  expect(await articleTitles(page)).toEqual(expectedArticleTitles)
  expect(normalizeVisibleString(await page.locator('.workspace-controls__meta > span').first().textContent())).toBe(expectedArticleTitles[0])
}

async function assertShell(page: Page, locale: Locale): Promise<void> {
  const expected = SHELL[locale]
  await expect(page.locator('.workspace-header')).toHaveCount(0)
  await expect(page.locator('.document-state')).toHaveCount(0)
  await expectSoftAriaLabel(page.locator('.article-panel'), expected.articles)
  await expectSoftText(page.locator('.article-panel h2'), expected.articles)
  await expectSoftAriaLabel(page.getByRole('toolbar').first(), expected.toolbar)
  await expectSoftAriaLabel(page.locator('.mode-control'), expected.mode)
  await expectSoftText(page.locator('[data-command-id="mode.source"]'), expected.modes[0])
  await expectSoftText(page.locator('[data-command-id="mode.visual"]'), expected.modes[1])
  await expectSoftText(page.locator('[data-command-id="mode.preview"]'), expected.modes[2])
  await expectSoftAriaLabel(page.locator('.status-region'), expected.status)
  await assertLocalizedSurface(page.locator('.workspace-shell'), locale, [
    '[data-testid="editor-surface"]',
    '.article-card__title',
    '.workspace-controls__meta > span:first-child',
  ])
}

async function assertEveryTopLevelMenu(page: Page, locale: Locale): Promise<void> {
  await page.locator('.ProseMirror p').filter({ hasText: AUTHORED_TEXT }).click()
  const color = page.locator('[data-toolbar-menu="color"] .toolbar-menu__trigger')
  await expectSoftAriaLabel(color, locale === 'en' ? 'Text color and background' : locale === 'zh' ? '文字颜色和背景' : 'Цвет текста и фона')
  await color.click()
  const colorDialog = page.locator('[data-picker-command="text.color"]')
  await expect(colorDialog).toBeVisible()
  await expectSoftText(colorDialog.locator('h2'), SURFACES[locale].color)
  await expectSoftText(colorDialog.locator('[data-color-action="clear"]'), SURFACES[locale].clearColor)
  await assertLocalizedSurface(colorDialog, locale)
  await page.keyboard.press('Escape')

  const themeLabels = {
    en: ['Default', 'Dark', 'Gray', 'Abyss', 'Fresh', 'Passion', 'Elegant', 'Quiet'],
    ru: ['По умолчанию', 'Тёмная', 'Серая', 'Бездна', 'Свежая', 'Яркая', 'Мягкая', 'Спокойная'],
    zh: ['默认', '暗黑', '沉稳', '深海', '清新', '热情', '淡雅', '清幽'],
  } as const
  const themeOwner = page.locator('[data-toolbar-menu="theme"]')
  const themeTrigger = themeOwner.locator('.toolbar-menu__trigger')
  const themeLabel = locale === 'en' ? 'Theme' : locale === 'zh' ? '主题' : 'Тема'
  await expectSoftAriaLabel(themeTrigger, themeLabel)
  await themeTrigger.click()
  const themePanel = themeOwner.getByRole('menu')
  await expect(themePanel).toBeVisible()
  await expectSoftAriaLabel(themePanel, themeLabel)
  expect.soft(await themePanel.locator('[data-theme-option] > span:last-child').allTextContents()).toEqual(themeLabels[locale])
  await assertLocalizedSurface(themePanel, locale)
  await page.keyboard.press('Escape')

  for (const menu of MENUS) {
    const owner = page.locator(`[data-toolbar-menu="${menu.id}"]`)
    const trigger = owner.locator('.toolbar-menu__trigger')
    await expectSoftAriaLabel(trigger, menu.label[locale])
    await trigger.click()
    const panel = owner.getByRole('menu')
    await expect(panel).toBeVisible()
    await expectSoftAriaLabel(panel, menu.label[locale])
    expect.soft(await panel.locator('.toolbar-menu__section > p').allTextContents()).toEqual(
      menu.sections.map((section) => section[locale]),
    )
    const commandButtons = panel.locator('[data-command-id]')
    expect.soft(await commandButtons.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-command-id')))).toEqual(
      menu.commands.map(([commandId]) => commandId),
    )
    for (const [commandId, labels] of menu.commands) {
      const command = panel.locator(`[data-command-id="${commandId}"]`)
      await expectSoftText(command.locator('span').last(), labels[locale])
      await expectSoftTitle(command, labels[locale])
    }
    await assertLocalizedSurface(panel, locale)
    await page.keyboard.press('Escape')
  }
}

async function openMenuCommand(page: Page, menu: string, command: string): Promise<void> {
  await page.locator(`[data-toolbar-menu="${menu}"] .toolbar-menu__trigger`).click()
  await page.locator(`[data-command-id="${command}"]`).click()
}

async function assertApplyCancel(dialog: Locator, locale: Locale): Promise<void> {
  const actions = dialog.locator('.dialog-panel__actions')
  const buttons = actions.locator('button')
  expect(await buttons.count()).toBeGreaterThanOrEqual(2)
  await expectSoftText(buttons.first(), EXPECTED[locale].cancel)
  await expectSoftText(buttons.last(), EXPECTED[locale].apply)
}

async function closeFirstDialogAction(dialog: Locator): Promise<void> {
  await dialog.locator('.dialog-panel__actions button').first().click()
  await expect(dialog).toHaveCount(0)
}

async function assertDialogs(page: Page, locale: Locale): Promise<void> {
  const surface = SURFACES[locale]

  await page.locator('[data-command-id="search.replace"]').click()
  const search = page.locator('.search-dock')
  await expect(search).toBeVisible()
  await expect(search).toHaveAttribute('aria-label', EXPECTED[locale].search)
  await expect(search.locator('#workspace-search')).toHaveAttribute('placeholder', EXPECTED[locale].query)
  await assertLocalizedSurface(search, locale, ['.search-dock__toggle'])
  await search.locator('.search-dock__close').click()
  await expect(search).toHaveCount(0)

  await page.locator('[data-command-id="settings.shortcuts"]').click()
  const shortcuts = page.getByTestId('shortcut-settings')
  await expect(shortcuts).toBeVisible()
  await expectSoftText(shortcuts.locator('h2'), surface.shortcuts)
  await expectSoftText(shortcuts.locator('.dialog-panel__actions button').nth(1), EXPECTED[locale].cancel)
  await expectSoftText(shortcuts.locator('.dialog-panel__actions button').last(), surface.applyShortcuts)
  const stableCommandIds = await shortcuts.locator('[data-shortcut-command]').evaluateAll((rows) => rows.map((row) => ({
    commandId: row.getAttribute('data-shortcut-command'),
    visibleId: row.querySelector('code')?.textContent?.trim() ?? null,
  })))
  expect.soft(stableCommandIds.length).toBeGreaterThan(0)
  expect.soft(stableCommandIds.every(({ commandId, visibleId }) => commandId !== null && visibleId === commandId)).toBe(true)
  await assertLocalizedSurface(shortcuts, locale, ['[data-shortcut-command] code'])
  await shortcuts.locator('.dialog-panel__actions button').nth(1).click()

  await page.locator('[data-command-alias="insert.formula"]').click()
  let dialog = page.locator('[data-picker-command="insert.formula"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.formula)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  await openMenuCommand(page, 'insert', 'insert.link')
  dialog = page.locator('[data-picker-command="insert.link"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.link)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  await openMenuCommand(page, 'insert', 'insert.table')
  dialog = page.locator('[data-table-dimension-picker]')
  await expect(dialog).toBeVisible()
  await expectSoftAriaLabel(dialog, surface.chooseTableSize)
  await assertLocalizedSurface(dialog, locale)
  await page.keyboard.press('Escape')

  for (const asset of [
    { command: 'insert.image', heading: surface.image },
    { command: 'insert.file', heading: surface.file },
  ]) {
    await openMenuCommand(page, 'insert', asset.command)
    dialog = page.locator(`[data-editor-command="${asset.command}"]`)
    await expect(dialog).toBeVisible()
    await expectSoftText(dialog.locator('h2'), asset.heading)
    await assertApplyCancel(dialog, locale)
    await assertLocalizedSurface(dialog, locale)
    await closeFirstDialogAction(dialog)
  }

  await page.locator('[data-command-id="insert.drawio"]').click()
  dialog = page.locator('[data-editor-command="insert.drawio"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.drawio)
  await assertLocalizedSurface(dialog, locale)
  await dialog.locator('header button').first().click()
  await expect(dialog).toHaveCount(0)

  await openMenuCommand(page, 'insert', 'insert.code-block')
  dialog = page.locator('[data-editor-command="insert.code-block"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.code)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  await openMenuCommand(page, 'panel', 'panel.info')
  dialog = page.locator('[data-picker-command="panel.info"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.panel)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  await openMenuCommand(page, 'panel', 'layout.two-column')
  dialog = page.locator('[data-picker-command="layout.two-column"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.columns)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  const mermaidEdit = page.locator('[data-semantic-kind="mermaid"] [data-semantic-edit="mermaid-editor"]')
  await mermaidEdit.focus()
  await mermaidEdit.press('Enter')
  dialog = page.locator('[data-editor-command="mermaid.source"]')
  await expect(dialog).toBeVisible()
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  const chartEdit = page.locator('[data-semantic-kind="chart-table"] [data-semantic-edit="chart-table-editor"]')
  await chartEdit.focus()
  await chartEdit.press('Enter')
  dialog = page.locator('[data-editor-command="chart-table.editor"]')
  await expect(dialog).toBeVisible()
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale, ['[data-chart-draft-preview]'])
  await closeFirstDialogAction(dialog)
}

async function assertVisualNodeControls(page: Page, locale: Locale): Promise<void> {
  const surface = SURFACES[locale]
  await page.locator('[data-command-id="mode.visual"]').click()
  await expectSoftText(page.locator('[data-w-editor-node="toc"] .toc-node__title'), EXPECTED[locale].toc)
  const paragraph = page.locator('.ProseMirror p').filter({ hasText: AUTHORED_TEXT })
  await expect(paragraph).toHaveText(AUTHORED_TEXT)
  await paragraph.hover()
  await page.locator('.visual-block-handle').click()
  const blockMenu = page.locator('.visual-block-menu').filter({ has: page.locator('[data-block-action="duplicate"]') })
  await assertLocalizedSurface(blockMenu, locale)
  await blockMenu.locator('[data-block-action="color"]').click()
  await assertLocalizedSurface(page.locator('.visual-block-color-menu'), locale)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await paragraph.hover()
  await page.locator('.visual-block-add').click()
  await assertLocalizedSurface(page.locator('.visual-block-menu--insert'), locale)
  await page.keyboard.press('Escape')

  const table = page.locator('[data-w-editor-node="ordinary-table"]')
  await expectSoftAriaLabel(table.locator('table'), surface.visualTable)
  await table.locator('tbody tr').last().locator('th, td').first().click()
  await table.locator('[data-table-handle="row"]').click()
  await expectSoftText(table.locator('[data-table-action="add-row-before"]'), surface.addRowBefore)
  await assertLocalizedSurface(table.locator('[data-table-menu="row"]'), locale)
  await page.keyboard.press('Escape')
  await table.locator('[data-table-handle="column"]').click()
  await expectSoftText(table.locator('[data-table-action="add-column-before"]'), surface.addColumnBefore)
  await assertLocalizedSurface(table.locator('[data-table-menu="column"]'), locale)
  await page.keyboard.press('Escape')

  const code = page.locator('[data-w-editor-node="code-block"]')
  await expectSoftAriaLabel(code.locator('[data-code-action="copy"]'), surface.copyCode)
  await expectSoftAriaLabel(code.locator('[data-code-action="advanced"]'), surface.advancedCode)
  await expectSoftAriaLabel(code.locator('[data-code-action="fold"]'), surface.foldCode)
  for (const control of ['copy', 'advanced']) {
    await assertLocalizedSurface(code.locator(`[data-code-action="${control}"]`), locale)
  }

  const formula = page.locator('[data-w-editor-node="formula"][data-formula-mode="block"]')
  await expectSoftAriaLabel(formula, surface.formulaRendered)
  await formula.dblclick()
  let dialog = page.locator('[data-picker-command="insert.formula"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.formula)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  const raw = page.locator('[data-w-editor-node="raw-block"]')
  await expectSoftAriaLabel(raw.locator('[data-raw-edit]'), surface.editRaw)
  await assertLocalizedSurface(raw.locator('[data-raw-edit]'), locale)
  await raw.locator('[data-raw-edit]').focus()
  await raw.locator('[data-raw-edit]').press('Enter')
  dialog = page.locator('[data-editor-command="raw.source"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.raw)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)

  const semantic = page.locator('[data-semantic-kind="panel"]')
  await expectSoftText(semantic.locator('[data-semantic-edit]'), surface.editSource)
  await assertLocalizedSurface(semantic.locator('[data-semantic-edit]'), locale)
  await semantic.locator('[data-semantic-edit]').focus()
  await semantic.locator('[data-semantic-edit]').press('Enter')
  dialog = page.locator('[data-picker-command="panel.info"]')
  await expect(dialog).toBeVisible()
  await expectSoftText(dialog.locator('h2'), surface.panel)
  await assertApplyCancel(dialog, locale)
  await assertLocalizedSurface(dialog, locale)
  await closeFirstDialogAction(dialog)
}

async function assertFinalCodeControls(page: Page, locale: Locale): Promise<void> {
  await page.locator('[data-command-id="mode.preview"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'preview')
  const code = page.locator('.preview-rendered-content [data-w-editor-node="code-block"]').filter({ hasText: 'const answer = 42' })
  await expect(code).toHaveCount(1)
  await expectSoftAriaLabel(code.locator('[data-semantic-copy="code-block"]'), SURFACES[locale].copyCode)
  await expectSoftAriaLabel(code.locator('[data-semantic-edit="code-block-editor"]'), SURFACES[locale].advancedCode)
  await expect(code.locator('[data-code-action="fold"]')).toBeHidden()
  await expect(code.locator('[data-code-action="expand"]')).toBeHidden()
  await assertLocalizedSurface(code.locator('.visual-code-block__toolbar'), locale)
}

test('all production UI families localize through real language commands without changing authored text', async ({ page }) => {
  test.setTimeout(240_000)
  await openReadyApp(page)
  await assertStartupLanguageContract(page)
  const expectedArticleTitles = await articleTitles(page)
  expect(expectedArticleTitles.length).toBeGreaterThan(0)
  await seedAuthoredDocument(page)

  const visualIdentity = await captureVisualIdentity(page)
  for (const locale of LOCALES) {
    await selectLocale(page, locale)
    await assertVisualIdentity(page, visualIdentity)
    await assertAuthoredContent(page, expectedArticleTitles)
  }

  for (const locale of LOCALES) {
    await selectLocale(page, locale)
    await page.locator('[data-command-id="mode.visual"]').click()
    await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
    await assertShell(page, locale)
    await assertEveryTopLevelMenu(page, locale)
    await assertDialogs(page, locale)
    await assertVisualNodeControls(page, locale)
    await assertFinalCodeControls(page, locale)
    await assertAuthoredContent(page, expectedArticleTitles)
  }
})
