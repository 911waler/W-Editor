import type {
  CommandContext,
  CommandDescriptor,
  CommandLocale,
  CommandOwner,
  CommandState,
} from './commandRegistry'
import { CHART_TABLE_DESCRIPTORS, MERMAID_DESCRIPTORS, PANEL_DESCRIPTORS } from '../codecs'

type Labels = Readonly<Record<CommandLocale, string>>
type CommandRegion = CommandDescriptor['surface']['region']
type CommandSelection = CommandContext['selectionKind']

interface CommandSeed {
  readonly contextualFor?: readonly string[]
  readonly groupId: keyof typeof COMMAND_GROUPS
  readonly icon: string
  readonly iconClass?: string
  readonly id: string
  readonly labels: Labels
  readonly menuId?: ToolbarMenuId
  readonly order: number
  readonly region?: CommandRegion
  readonly selection?: readonly CommandSelection[]
}

export interface ToolbarMenuDescriptor {
  readonly icon: string
  readonly iconClass: string | null
  readonly id: ToolbarMenuId
  readonly labels: Labels
  readonly order: number
  readonly region: 'main' | 'overflow'
}

export type ToolbarMenuId = 'alignment' | 'chart' | 'color' | 'export' | 'heading' | 'insert' | 'language' | 'mermaid' | 'panel' | 'text-style' | 'theme'

export const EXCLUDED_TOOLBAR_CONTROL_IDS = Object.freeze([
  'customMenuAName',
  'customMenuBName',
  'mobilePreview',
  'copy',
  'codeTheme',
] as const)

const labels = (en: string, zh: string, ru: string): Labels => Object.freeze({ en, ru, zh })

const COMMAND_GROUPS = Object.freeze({
  alignment: Object.freeze({ id: 'alignment', labels: labels('Alignment', '对齐', 'Выравнивание'), order: 5 }),
  chart: Object.freeze({ id: 'chart', labels: labels('Chart tables', '图表', 'Диаграммы'), order: 10 }),
  document: Object.freeze({ id: 'document', labels: labels('Document', '文档', 'Документ'), order: 12 }),
  export: Object.freeze({ id: 'export', labels: labels('Export', '导出', 'Экспорт'), order: 16 }),
  heading: Object.freeze({ id: 'heading', labels: labels('Headings', '标题', 'Заголовки'), order: 2 }),
  history: Object.freeze({ id: 'history', labels: labels('History', '历史', 'История'), order: 0 }),
  insert: Object.freeze({ id: 'insert', labels: labels('Insert', '插入', 'Вставка'), order: 8 }),
  language: Object.freeze({ id: 'language', labels: labels('Language', '语言', 'Язык'), order: 15 }),
  layout: Object.freeze({ id: 'layout', labels: labels('Layout and disclosure', '布局与展开', 'Макет'), order: 6 }),
  list: Object.freeze({ id: 'list', labels: labels('Lists', '列表', 'Списки'), order: 3 }),
  mermaid: Object.freeze({ id: 'mermaid', labels: labels('Mermaid', 'Mermaid 绘图', 'Mermaid'), order: 9 }),
  mode: Object.freeze({ id: 'mode', labels: labels('Editor mode', '编辑模式', 'Режим редактора'), order: 13 }),
  panel: Object.freeze({ id: 'panel', labels: labels('Panels', '面板', 'Панели'), order: 4 }),
  text: Object.freeze({ id: 'text', labels: labels('Text formatting', '文本格式', 'Формат текста'), order: 1 }),
  workspace: Object.freeze({ id: 'workspace', labels: labels('Workspace utilities', '工作区工具', 'Инструменты'), order: 14 }),
})

export const TOOLBAR_MENU_DESCRIPTORS: readonly ToolbarMenuDescriptor[] = Object.freeze([
  Object.freeze({ icon: 'S', iconClass: 'ch-icon-strike', id: 'text-style', labels: labels('Text style', '文字样式', 'Стиль текста'), order: 10, region: 'main' }),
  Object.freeze({ icon: 'A', iconClass: 'ch-icon-color', id: 'color', labels: labels('Text color and background', '文字颜色和背景', 'Цвет текста и фона'), order: 20, region: 'main' }),
  Object.freeze({ icon: 'H', iconClass: 'ch-icon-header', id: 'heading', labels: labels('Heading', '标题', 'Заголовок'), order: 30, region: 'main' }),
  Object.freeze({ icon: '▣', iconClass: 'ch-icon-tips', id: 'panel', labels: labels('Panel', '面板', 'Панель'), order: 40, region: 'main' }),
  Object.freeze({ icon: '≡', iconClass: 'ch-icon-align', id: 'alignment', labels: labels('Alignment', '对齐', 'Выравнивание'), order: 50, region: 'main' }),
  Object.freeze({ icon: '+', iconClass: null, id: 'insert', labels: labels('Insert', '插入', 'Вставка'), order: 60, region: 'main' }),
  Object.freeze({ icon: '◇', iconClass: null, id: 'mermaid', labels: labels('Draw', '画图', 'Рисование'), order: 70, region: 'main' }),
  Object.freeze({ icon: '▥', iconClass: 'ch-icon-insertLineChart', id: 'chart', labels: labels('Chart', '图表', 'Диаграмма'), order: 80, region: 'main' }),
  Object.freeze({ icon: '◐', iconClass: 'ch-icon-main-theme', id: 'theme', labels: labels('Theme', '主题', 'Тема'), order: 85, region: 'main' }),
  Object.freeze({ icon: 'EN', iconClass: null, id: 'language', labels: labels('Language', '语言', 'Язык'), order: 90, region: 'main' }),
  Object.freeze({ icon: '⇩', iconClass: null, id: 'export', labels: labels('Export', '导出', 'Экспорт'), order: 100, region: 'main' }),
])

const alignmentSelection = Object.freeze<readonly CommandSelection[]>(['text', 'semantic-node'])
const textSelection = Object.freeze<readonly CommandSelection[]>(['text'])
const anySelection = Object.freeze<readonly CommandSelection[]>(['none', 'semantic-node', 'text'])
const insertionSelection = Object.freeze<readonly CommandSelection[]>(['none', 'text'])

function seed(
  id: string,
  groupId: CommandSeed['groupId'],
  order: number,
  icon: string,
  en: string,
  zh: string,
  ru: string,
  options: Omit<CommandSeed, 'groupId' | 'icon' | 'id' | 'labels' | 'order'> = {},
): CommandSeed {
  return Object.freeze({ groupId, icon, id, labels: labels(en, zh, ru), order, ...options })
}

const COMMAND_SEEDS: readonly CommandSeed[] = Object.freeze([
  seed('history.undo', 'history', 1, '↶', 'Undo', '撤销', 'Отменить', { iconClass: 'ch-icon-undo', region: 'main', selection: anySelection }),
  seed('history.redo', 'history', 2, '↷', 'Redo', '重做', 'Повторить', { iconClass: 'ch-icon-redo', region: 'main', selection: anySelection }),
  seed('text.bold', 'text', 1, 'B', 'Bold', '粗体', 'Жирный', { iconClass: 'ch-icon-bold', region: 'main', selection: textSelection }),
  seed('text.italic', 'text', 2, 'I', 'Italic', '斜体', 'Курсив', { iconClass: 'ch-icon-italic', region: 'main', selection: textSelection }),
  seed('text.strike', 'text', 3, 'S', 'Strikethrough', '删除线', 'Зачёркнутый', { iconClass: 'ch-icon-strike', menuId: 'text-style', selection: textSelection }),
  seed('text.underline', 'text', 4, 'U', 'Underline', '下划线', 'Подчёркнутый', { iconClass: 'ch-icon-underline', menuId: 'text-style', selection: textSelection }),
  seed('text.subscript', 'text', 5, 'x₂', 'Subscript', '下标', 'Нижний индекс', { iconClass: 'ch-icon-sub', menuId: 'text-style', selection: textSelection }),
  seed('text.superscript', 'text', 6, 'x²', 'Superscript', '上标', 'Верхний индекс', { iconClass: 'ch-icon-sup', menuId: 'text-style', selection: textSelection }),
  seed('text.ruby', 'text', 7, '注', 'Ruby annotation', '注音', 'Руби-аннотация', { iconClass: 'ch-icon-pinyin', menuId: 'text-style', selection: textSelection }),
  seed('block.quote', 'text', 8, '>', 'Quote', '引用', 'Цитата', { menuId: 'text-style', selection: textSelection }),
  seed('text.size', 'text', 8, '↕', 'Font size', '字号', 'Размер шрифта', { iconClass: 'ch-icon-size', region: 'main', selection: textSelection }),
  seed('text.color', 'text', 9, 'A', 'Text color', '文字颜色', 'Цвет текста', { iconClass: 'ch-icon-color', menuId: 'color', selection: textSelection }),
  seed('text.background', 'text', 10, '▰', 'Background color', '背景颜色', 'Цвет фона', { iconClass: 'ch-icon-square', menuId: 'color', selection: textSelection }),
  seed('block.h1', 'heading', 1, 'H1', 'Heading 1', '一级标题', 'Заголовок 1', { menuId: 'heading', selection: textSelection }),
  seed('block.h2', 'heading', 2, 'H2', 'Heading 2', '二级标题', 'Заголовок 2', { menuId: 'heading', selection: textSelection }),
  seed('block.h3', 'heading', 3, 'H3', 'Heading 3', '三级标题', 'Заголовок 3', { menuId: 'heading', selection: textSelection }),
  seed('block.h4', 'heading', 4, 'H4', 'Heading 4', '四级标题', 'Заголовок 4', { menuId: 'heading', selection: textSelection }),
  seed('block.h5', 'heading', 5, 'H5', 'Heading 5', '五级标题', 'Заголовок 5', { menuId: 'heading', selection: textSelection }),
  seed('list.ordered', 'list', 1, '1.', 'Ordered list', '有序列表', 'Нумерованный список', { iconClass: 'ch-icon-ol', region: 'main', selection: textSelection }),
  seed('list.unordered', 'list', 2, '•', 'Bullet list', '无序列表', 'Маркированный список', { iconClass: 'ch-icon-ul', region: 'main', selection: textSelection }),
  seed('list.task', 'list', 3, '☐', 'Task list', '任务列表', 'Список задач', { iconClass: 'ch-icon-checklist', region: 'main', selection: textSelection }),
  ...PANEL_DESCRIPTORS.map((descriptor, index) => seed(
    descriptor.commandId,
    'panel',
    index + 1,
    descriptor.icon,
    descriptor.labels.en,
    descriptor.labels.zh,
    descriptor.labels.ru,
    { menuId: 'panel', selection: insertionSelection },
  )),
  seed('align.left', 'alignment', 1, '≡', 'Align left', '左对齐', 'По левому краю', { menuId: 'alignment', selection: alignmentSelection }),
  seed('align.center', 'alignment', 2, '≡', 'Align center', '居中对齐', 'По центру', { menuId: 'alignment', selection: alignmentSelection }),
  seed('align.right', 'alignment', 3, '≡', 'Align right', '右对齐', 'По правому краю', { menuId: 'alignment', selection: alignmentSelection }),
  seed('align.justify', 'alignment', 4, '≡', 'Justify', '两端对齐', 'По ширине', { menuId: 'alignment', selection: textSelection }),
  seed('layout.two-column', 'layout', 1, 'Ⅱ', 'Two columns', '双栏', 'Две колонки', { menuId: 'panel', selection: insertionSelection }),
  seed('layout.multi-column', 'layout', 2, 'Ⅲ', 'Multiple columns', '多栏', 'Несколько колонок', { menuId: 'panel', selection: insertionSelection }),
  seed('layout.tabs', 'layout', 3, '▤', 'Tabs', '标签页', 'Вкладки', { menuId: 'panel', selection: insertionSelection }),
  seed('layout.accordion', 'layout', 4, '⌄', 'Accordion', '折叠面板', 'Аккордеон', { iconClass: 'ch-icon-insertFlow', region: 'main', selection: insertionSelection }),
  seed('layout.timeline', 'layout', 5, '◉', 'Timeline', '时间线', 'Временная шкала', { iconClass: 'ch-icon-timeline', region: 'main', selection: insertionSelection }),
  seed('insert.image', 'insert', 1, '▧', 'Image', '图片', 'Изображение', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.audio', 'insert', 2, '♪', 'Audio', '音频', 'Аудио', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.video', 'insert', 3, '▶', 'Video', '视频', 'Видео', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.link', 'insert', 4, '↗', 'Link', '链接', 'Ссылка', { menuId: 'insert', selection: textSelection }),
  seed('insert.horizontal-rule', 'insert', 5, '―', 'Horizontal rule', '分隔线', 'Горизонтальная линия', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.hard-break', 'insert', 6, '↵', 'Hard break', '强制换行', 'Жёсткий перенос', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.code-block', 'insert', 7, '</>', 'Code block', '代码块', 'Блок кода', { contextualFor: ['code-block'], menuId: 'insert', selection: anySelection }),
  seed('insert.inline-code', 'insert', 8, '`', 'Inline code', '行内代码', 'Строчный код', { menuId: 'insert', selection: textSelection }),
  seed('insert.formula', 'insert', 9, '∑', 'Formula', '公式', 'Формула', { iconClass: 'ch-icon-insertFormula', menuId: 'insert', selection: anySelection }),
  seed('insert.toc', 'insert', 10, '☷', 'Table of contents', '目录', 'Оглавление', { menuId: 'insert', selection: anySelection }),
  seed('insert.table', 'insert', 11, '▦', 'Table', '表格', 'Таблица', { iconClass: 'ch-icon-table', menuId: 'insert', selection: insertionSelection }),
  seed('insert.pdf', 'insert', 12, 'PDF', 'PDF attachment', 'PDF 附件', 'PDF-вложение', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.word', 'insert', 13, 'W', 'Word attachment', 'Word 附件', 'Документ Word', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.file', 'insert', 14, '⌑', 'File attachment', '文件附件', 'Файл', { menuId: 'insert', selection: insertionSelection }),
  seed('insert.drawio', 'insert', 15, '◇', 'draw.io diagram', 'draw.io 图表', 'Диаграмма draw.io', { region: 'main', selection: insertionSelection }),
  ...MERMAID_DESCRIPTORS.map((descriptor, index) => seed(
    descriptor.commandId,
    'mermaid',
    index + 1,
    descriptor.icon,
    descriptor.labels.en,
    descriptor.labels.zh,
    descriptor.labels.ru,
    { menuId: 'mermaid', selection: insertionSelection },
  )),
  ...CHART_TABLE_DESCRIPTORS.map((descriptor, index) => seed(
    descriptor.commandId,
    'chart',
    index + 1,
    descriptor.icon,
    descriptor.labels.en,
    descriptor.labels.zh,
    descriptor.labels.ru,
    { menuId: 'chart', selection: insertionSelection },
  )),
  seed('document.manual-save', 'document', 1, '✓', 'Save version', '保存版本', 'Сохранить версию', { iconClass: 'ch-icon-check', region: 'main', selection: anySelection }),
  seed('search.replace', 'workspace', 1, '⌕', 'Search', '搜索', 'Поиск', { iconClass: 'ch-icon-search', region: 'main', selection: anySelection }),
  seed('settings.shortcuts', 'workspace', 2, '⌨', 'Keyboard shortcuts', '快捷键', 'Сочетания клавиш', { iconClass: 'ch-icon-command', region: 'main', selection: anySelection }),
  seed('application.fullscreen', 'workspace', 3, '⛶', 'Fullscreen', '全屏', 'Полный экран', { iconClass: 'ch-icon-fullscreen', region: 'main', selection: anySelection }),
  seed('document.word-count', 'workspace', 4, '#', 'Word count', '字数统计', 'Статистика', { region: 'main', selection: anySelection }),
  seed('mode.source', 'mode', 1, '</>', 'Source', '源码', 'Исходник', { region: 'mode', selection: anySelection }),
  seed('mode.visual', 'mode', 2, '¶', 'Visual', '可视化', 'Визуальный', { region: 'mode', selection: anySelection }),
  seed('mode.preview', 'mode', 3, '◉', 'Preview', '预览', 'Просмотр', { iconClass: 'ch-icon-previewClose', region: 'mode', selection: anySelection }),
  seed('language.zh', 'language', 1, '中', 'Chinese', '中文', 'Китайский', { menuId: 'language', selection: anySelection }),
  seed('language.en', 'language', 2, 'EN', 'English', '英语', 'Английский', { menuId: 'language', selection: anySelection }),
  seed('language.ru', 'language', 3, 'RU', 'Russian', '俄语', 'Русский', { menuId: 'language', selection: anySelection }),
  seed('export.markdown', 'export', 1, 'MD', 'Markdown file', 'Markdown 文件', 'Файл Markdown', { menuId: 'export', selection: anySelection }),
  seed('export.html', 'export', 2, 'HTML', 'HTML file', 'HTML 文件', 'Файл HTML', { menuId: 'export', selection: anySelection }),
  seed('export.word', 'export', 3, 'W', 'Word-compatible file', 'Word 兼容文件', 'Файл Word', { menuId: 'export', selection: anySelection }),
  seed('export.pdf', 'export', 4, 'PDF', 'Export PDF', '导出 PDF', 'Экспорт PDF', { menuId: 'export', selection: anySelection }),
  seed('export.screenshot', 'export', 5, 'PNG', 'Long screenshot', '长截图', 'Длинный снимок', { menuId: 'export', selection: anySelection }),
])

const contentOwners = Object.freeze({ preview: null, source: 'source', visual: 'visual' }) satisfies Readonly<Record<CommandContext['mode'], CommandOwner | null>>
const applicationOwners = Object.freeze({ preview: 'application', source: 'application', visual: 'application' }) satisfies Readonly<Record<CommandContext['mode'], CommandOwner | null>>

function isApplicationCommand(commandId: string): boolean {
  return commandId.startsWith('application.')
    || commandId.startsWith('document.')
    || commandId.startsWith('export.')
    || commandId.startsWith('language.')
    || commandId.startsWith('mode.')
    || commandId.startsWith('settings.')
    || commandId === 'search.replace'
}

function commandState(commandId: string, selection: readonly CommandSelection[]): (context: CommandContext) => CommandState {
  return (context) => {
    const active = context.activeCommandIds?.has(commandId) ?? false
    if (!selection.includes(context.selectionKind)) {
      return Object.freeze({
        active,
        disabledReason: context.selectionKind === 'semantic-node'
          ? 'This command cannot safely change the selected semantic node.'
          : 'This command requires an applicable document selection.',
        enabled: false,
      })
    }
    return Object.freeze({ active, disabledReason: null, enabled: true })
  }
}

export function createToolbarCommandDescriptors(): readonly CommandDescriptor[] {
  return Object.freeze(COMMAND_SEEDS.map((command) => {
    const group = COMMAND_GROUPS[command.groupId]
    const applicationCommand = isApplicationCommand(command.id)
    return Object.freeze({
      contextualFor: Object.freeze([...(command.contextualFor ?? [])]),
      group,
      icon: command.icon,
      iconClass: command.iconClass ?? null,
      id: command.id,
      labels: command.labels,
      order: command.order,
      owner: applicationCommand ? applicationOwners : contentOwners,
      semanticOutcome: `${applicationCommand ? 'application' : 'cherry'}:${command.id}`,
      selection: command.selection ?? insertionSelection,
      state: commandState(command.id, command.selection ?? insertionSelection),
      surface: Object.freeze({
        control: command.menuId === undefined ? 'button' as const : 'menu-item' as const,
        menuId: command.menuId ?? null,
        order: command.region === 'main' && command.id === 'search.replace'
          ? 70
          : command.region === 'main' && command.id === 'document.manual-save'
            ? 80
            : command.order,
        region: command.region ?? 'main',
      }),
      verification: Object.freeze({
        automatedEvidence: Object.freeze([`unit:command:${command.id}`, `e2e:toolbar:${command.id}`]),
        manualCheck: `Invoke ${command.id} in each applicable mode and confirm the matrix outcome.`,
        matrixId: command.id,
      }),
    }) satisfies CommandDescriptor
  }))
}
