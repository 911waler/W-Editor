import { afterEach, describe, expect, it, vi } from 'vitest'

import { TiptapVisualAdapter, type TiptapVisualProjection } from '../../src/adapters'
import {
  attachmentSource,
  drawioSource,
  mediaSource,
  mermaidStarterSource,
  projectOrdinaryMarkdown,
} from '../../src/codecs'
import { DocumentSession, type DocumentSnapshot } from '../../src/core'
import { createUiLocalizationStore } from '../../src/services/uiLocalization'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function mount(markdown: string, documentId: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const localization = createUiLocalizationStore('en')
  const session = new DocumentSession({ documentId, markdown })
  const adapter = new TiptapVisualAdapter({
    host,
    localization,
    project: projectOrdinaryMarkdown,
    session,
  })
  adapters.push(adapter)
  return { adapter, host, localization, session }
}

function selectText(adapter: TiptapVisualAdapter, text: string): void {
  const documentNode = adapter.schema().nodeFromJSON(adapter.documentJSON())
  let position: number | null = null
  documentNode.descendants((node, nodePosition) => {
    if (!node.isText || node.text !== text || position !== null) return true
    position = nodePosition
    return false
  })
  if (position === null) throw new Error(`Text ${text} was not found.`)
  adapter.setSelection({ anchor: position, head: position })
}

function actionCopy(host: HTMLElement, kind: 'column' | 'row'): string[] {
  return [...host.querySelectorAll<HTMLElement>(`[data-table-menu="${kind}"] [data-table-action]`)]
    .map((action) => action.textContent ?? '')
}

const FULL_MARKDOWN = [
  '[[toc]]',
  'Inline $x + y$ formula.',
  '```typescript\nconst answer = 42\nconst second = 2\nconst third = 3\nconst fourth = 4\nconst fifth = 5\nconst sixth = 6\nconst seventh = 7\nconst eighth = 8\nconst ninth = 9\nconst tenth = 10\nconst eleventh = 11\nconst twelfth = 12\nconst thirteenth = 13\n```',
  '$$\nE = mc^2\n$$',
  '| Name | Role |\n| :--- | :--- |\n| Ada | Engineer |',
].join('\n\n')

describe('Tiptap NodeView localization', () => {
  it('updates mounted TOC, formula, code, and table copy without rebuilding the editor or mutating content', () => {
    const { adapter, host, localization } = mount(FULL_MARKDOWN, 'localized-node-views')

    const toc = host.querySelector<HTMLElement>('[data-w-editor-node="toc"]')!
    const tocTitle = toc.querySelector<HTMLElement>('.toc-node__title')!
    const tocEmpty = toc.querySelector<HTMLElement>('[data-toc-empty]')!
    const inlineFormula = host.querySelector<HTMLElement>('[data-w-editor-node="formula"][data-formula-mode="inline"]')!
    const blockFormula = host.querySelector<HTMLElement>('[data-w-editor-node="formula"][data-formula-mode="block"]')!
    const renderedInlineFormula = inlineFormula.querySelector<HTMLElement>('.formula-rendered')!
    const renderedBlockFormula = blockFormula.querySelector<HTMLElement>('.formula-rendered')!
    const code = host.querySelector<HTMLElement>('[data-w-editor-node="code-block"]')!
    const codeToolbar = code.querySelector<HTMLElement>('.visual-code-block__toolbar')!
    const codeLanguage = code.querySelector<HTMLSelectElement>('[data-code-action="language"]')!
    const codeCopy = code.querySelector<HTMLButtonElement>('[data-code-action="copy"]')!
    const codeEdit = code.querySelector<HTMLButtonElement>('[data-code-action="advanced"]')!
    const codeFold = code.querySelector<HTMLButtonElement>('[data-code-action="fold"]')!
    const codeExpand = code.querySelector<HTMLButtonElement>('[data-code-action="expand"]')!
    const tableNode = host.querySelector<HTMLElement>('[data-w-editor-node="ordinary-table"]')!
    const table = tableNode.querySelector<HTMLTableElement>('table')!

    expect(toc.getAttribute('aria-label')).toBe('Table of contents')
    expect(tocTitle.textContent).toBe('Table of contents')
    expect(tocEmpty.textContent).toBe('No headings yet.')
    expect(inlineFormula.getAttribute('aria-label')).toBe('Rendered inline formula')
    expect(blockFormula.getAttribute('aria-label')).toBe('Rendered block formula')
    expect(renderedInlineFormula.getAttribute('aria-label')).toBe('Rendered inline formula')
    expect(renderedBlockFormula.getAttribute('aria-label')).toBe('Rendered block formula')
    expect(code.getAttribute('aria-label')).toBe('Editable code block')
    expect(codeToolbar.getAttribute('aria-label')).toBe('Code block actions')
    expect(codeLanguage.getAttribute('aria-label')).toBe('Change language')
    expect(codeCopy.textContent).toBe('')
    expect(codeCopy.getAttribute('aria-label')).toBe('Copy code')
    expect(codeEdit.textContent).toBe('')
    expect(codeEdit.getAttribute('title')).toBe('Advanced code editor')
    expect(codeEdit.getAttribute('aria-label')).toBe('Advanced code editor')
    expect(codeFold.textContent).toBe('')
    expect(codeFold.getAttribute('aria-label')).toBe('Fold code')

    codeCopy.click()
    expect(codeCopy.textContent).toBe('')
    codeFold.click()
    expect(codeFold.textContent).toBe('')
    expect(codeExpand.getAttribute('aria-label')).toBe('Expand code')
    codeEdit.click()
    expect(adapter.setSelectedSemanticLocalError('Renderer offline.')).toBe(true)
    const codeAlert = code.querySelector<HTMLElement>('[role="alert"]')!
    expect(codeAlert.textContent).toBe('Renderer offline.')
    expect(codeAlert.getAttribute('aria-label')).toBe('Code preview error')
    codeCopy.click()
    expect(codeCopy.textContent).toBe('')

    selectText(adapter, 'Ada')
    const rowHandle = tableNode.querySelector<HTMLButtonElement>('[data-table-handle="row"]')!
    const columnHandle = tableNode.querySelector<HTMLButtonElement>('[data-table-handle="column"]')!
    expect(table.getAttribute('aria-label')).toBe('Editable Markdown table')
    expect(rowHandle.getAttribute('aria-label')).toBe('Row 2 actions')
    expect(columnHandle.getAttribute('aria-label')).toBe('Column 1 actions')
    expect(actionCopy(tableNode, 'row')).toEqual([
      'Move row up',
      'Move row down',
      'Add row before',
      'Add row after',
      'Duplicate row',
      'Delete row',
    ])
    expect(actionCopy(tableNode, 'column')).toEqual([
      'Move column left',
      'Move column right',
      'Add column before',
      'Add column after',
      'Sort ascending',
      'Sort descending',
      'Align column left',
      'Align column center',
      'Align column right',
      'Duplicate column',
      'Delete column',
    ])
    expect(tableNode.querySelector('[data-table-advanced-action]')).toBeNull()

    const tocTitleBeforeLocaleChange = toc.querySelector<HTMLElement>('.toc-node__title')!
    const tocEmptyBeforeLocaleChange = toc.querySelector<HTMLElement>('[data-toc-empty]')!
    const jsonBefore = JSON.stringify(adapter.documentJSON())
    const selectionBefore = adapter.selection()
    localization.setLocale('zh')

    expect(host.querySelector('[data-w-editor-node="toc"]')).toBe(toc)
    expect(host.querySelector('[data-w-editor-node="formula"][data-formula-mode="inline"]')).toBe(inlineFormula)
    expect(host.querySelector('[data-w-editor-node="formula"][data-formula-mode="block"]')).toBe(blockFormula)
    expect(host.querySelector('[data-w-editor-node="code-block"]')).toBe(code)
    expect(host.querySelector('[data-w-editor-node="ordinary-table"]')).toBe(tableNode)
    expect(toc.getAttribute('aria-label')).toBe('目录')
    expect(toc.querySelector('.toc-node__title')).toBe(tocTitleBeforeLocaleChange)
    expect(toc.querySelector('[data-toc-empty]')).toBe(tocEmptyBeforeLocaleChange)
    expect(tocTitleBeforeLocaleChange.textContent).toBe('目录')
    expect(tocEmptyBeforeLocaleChange.textContent).toBe('暂无标题。')
    expect(inlineFormula.getAttribute('aria-label')).toBe('已渲染的行内公式')
    expect(blockFormula.getAttribute('aria-label')).toBe('已渲染的块级公式')
    expect(renderedInlineFormula.getAttribute('aria-label')).toBe('已渲染的行内公式')
    expect(renderedBlockFormula.getAttribute('aria-label')).toBe('已渲染的块级公式')
    expect(code.getAttribute('aria-label')).toBe('可编辑代码块')
    expect(codeToolbar.getAttribute('aria-label')).toBe('代码块操作')
    expect(codeLanguage.getAttribute('aria-label')).toBe('更改语言')
    expect(codeCopy.textContent).toBe('')
    expect(codeCopy.getAttribute('aria-label')).toBe('复制代码')
    expect(codeEdit.textContent).toBe('')
    expect(codeEdit.getAttribute('title')).toBe('高级代码编辑器')
    expect(codeEdit.getAttribute('aria-label')).toBe('高级代码编辑器')
    expect(codeFold.textContent).toBe('')
    expect(codeFold.getAttribute('aria-label')).toBe('折叠代码')
    expect(codeExpand.getAttribute('aria-label')).toBe('展开代码')
    expect(codeAlert.textContent).toBe('Renderer offline.')
    expect(codeAlert.getAttribute('aria-label')).toBe('代码预览错误')
    expect(table.getAttribute('aria-label')).toBe('可编辑 Markdown 表格')
    expect(rowHandle.getAttribute('aria-label')).toBe('第 2 行操作')
    expect(columnHandle.getAttribute('aria-label')).toBe('第 1 列操作')
    expect(actionCopy(tableNode, 'row')).toEqual([
      '上移行',
      '下移行',
      '在前面添加行',
      '在下方添加行',
      '复制行',
      '删除行',
    ])
    expect(actionCopy(tableNode, 'column')).toEqual([
      '左移列',
      '右移列',
      '在前面添加列',
      '在右侧添加列',
      '升序排序',
      '降序排序',
      '列左对齐',
      '列居中对齐',
      '列右对齐',
      '复制列',
      '删除列',
    ])
    expect(tableNode.querySelector('[data-table-advanced-action]')).toBeNull()
    expect(JSON.stringify(adapter.documentJSON())).toBe(jsonBefore)
    expect(adapter.selection()).toEqual(selectionBefore)

    adapter.destroy()
    adapters.splice(adapters.indexOf(adapter), 1)
    localization.setLocale('en')
    expect(tocTitleBeforeLocaleChange.textContent).toBe('目录')
    expect(codeCopy.textContent).toBe('')
    expect(codeEdit.textContent).toBe('')
    expect(renderedInlineFormula.getAttribute('aria-label')).toBe('已渲染的行内公式')
    expect(renderedBlockFormula.getAttribute('aria-label')).toBe('已渲染的块级公式')
    expect(table.getAttribute('aria-label')).toBe('可编辑 Markdown 表格')
    expect(rowHandle.getAttribute('aria-label')).toBe('第 2 行操作')
    expect(columnHandle.getAttribute('aria-label')).toBe('第 1 列操作')
  })

  it('updates raw, media, attachment, and draw.io labels while preserving literal author data', () => {
    const rawInline = '@@mystery(x)@@'
    const rawBlock = '::: mystery\nbody\n:::'
    const video = mediaSource('video', 'Clip', 'https://assets.example.test/clip.mp4')
    const attachment = attachmentSource({
      kind: 'word',
      mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      name: 'Guide',
      size: 128,
      url: 'https://assets.example.test/guide.docx',
    })
    const drawio = drawioSource(
      'Architecture',
      'data:image/png;base64,AAAA',
      '<mxfile><diagram id="localization"/></mxfile>',
    )
    const markdown = [`Before ${rawInline} after`, rawBlock, video, attachment, drawio].join('\n\n')
    const { adapter, host, localization } = mount(markdown, 'localized-semantic-raw')

    const inlineNode = host.querySelector<HTMLElement>('[data-w-editor-node="raw-inline"]')!
    const blockNode = host.querySelector<HTMLElement>('[data-w-editor-node="raw-block"]')!
    const inlineEdit = inlineNode.querySelector<HTMLButtonElement>('[data-raw-edit="rawInline"]')!
    const blockEdit = blockNode.querySelector<HTMLButtonElement>('[data-raw-edit="rawBlock"]')!
    const media = host.querySelector<HTMLElement>('[data-semantic-kind="media"]')!
    const attachmentNode = host.querySelector<HTMLElement>('[data-semantic-kind="attachment"]')!
    const drawioNode = host.querySelector<HTMLElement>('[data-semantic-kind="drawio"]')!
    const mediaIdentity = media.querySelector<HTMLElement>('.semantic-node-view__identity')!
    const attachmentIdentity = attachmentNode.querySelector<HTMLElement>('.semantic-node-view__identity')!
    const drawioIdentity = drawioNode.querySelector<HTMLElement>('.semantic-node-view__identity')!
    const mediaEdit = media.querySelector<HTMLButtonElement>('[data-semantic-edit="media-editor"]')!
    const attachmentType = attachmentNode.querySelector<HTMLElement>('.semantic-preview__attachment-type')!
    const attachmentLink = attachmentNode.querySelector<HTMLAnchorElement>('[data-semantic-attachment-link]')!

    media.querySelector<HTMLElement>('.semantic-preview__media-element')?.dispatchEvent(new Event('error'))
    const mediaFallback = media.querySelector<HTMLElement>('[data-media-fallback="video"] strong')!
    expect(inlineNode.getAttribute('aria-label')).toBe('Unknown inline source')
    expect(blockNode.getAttribute('aria-label')).toBe('Unknown block source')
    expect(inlineEdit.textContent).toBe('Edit source')
    expect(inlineEdit.getAttribute('aria-label')).toBe('Edit unknown inline source')
    expect(blockEdit.getAttribute('aria-label')).toBe('Edit unknown block source')
    expect(mediaIdentity.textContent).toBe('Video · Clip')
    expect(mediaEdit.textContent).toBe('Edit source')
    expect(mediaEdit.getAttribute('aria-label')).toBe('Edit source: Video · Clip')
    expect(mediaFallback.textContent).toBe('Video preview unavailable')
    expect(attachmentIdentity.textContent).toBe('Word document · Guide')
    expect(attachmentType.textContent).toBe('Word document')
    expect(attachmentLink.textContent).toBe('Open Guide')
    expect(drawioIdentity.textContent).toBe('draw.io diagram · Architecture')

    const jsonBefore = JSON.stringify(adapter.documentJSON())
    localization.setLocale('zh')

    expect(host.querySelector('[data-w-editor-node="raw-inline"]')).toBe(inlineNode)
    expect(host.querySelector('[data-semantic-kind="media"]')).toBe(media)
    expect(inlineNode.getAttribute('aria-label')).toBe('未知行内源码')
    expect(blockNode.getAttribute('aria-label')).toBe('未知块源码')
    expect(inlineEdit.textContent).toBe('编辑源码')
    expect(inlineEdit.getAttribute('aria-label')).toBe('编辑未知行内源码')
    expect(blockEdit.getAttribute('aria-label')).toBe('编辑未知块源码')
    expect(mediaIdentity.textContent).toBe('视频 · Clip')
    expect(mediaEdit.textContent).toBe('编辑源码')
    expect(mediaEdit.getAttribute('aria-label')).toBe('编辑源码：视频 · Clip')
    expect(mediaFallback.textContent).toBe('视频预览不可用')
    expect(attachmentIdentity.textContent).toBe('Word 文档 · Guide')
    expect(attachmentType.textContent).toBe('Word 文档')
    expect(attachmentLink.textContent).toBe('打开 Guide')
    expect(drawioIdentity.textContent).toBe('draw.io 图表 · Architecture')
    expect(inlineNode.querySelector('.raw-node__source')?.textContent).toBe(rawInline)
    expect(blockNode.querySelector('.raw-node__source')?.textContent).toBe(rawBlock)
    expect(JSON.stringify(adapter.documentJSON())).toBe(jsonBefore)

    adapter.destroy()
    adapters.splice(adapters.indexOf(adapter), 1)
    localization.setLocale('en')
    expect(inlineNode.getAttribute('aria-label')).toBe('未知行内源码')
    expect(blockEdit.getAttribute('aria-label')).toBe('编辑未知块源码')
    expect(mediaIdentity.textContent).toBe('视频 · Clip')
    expect(mediaEdit.textContent).toBe('编辑源码')
    expect(attachmentIdentity.textContent).toBe('Word 文档 · Guide')
    expect(drawioIdentity.textContent).toBe('draw.io 图表 · Architecture')
  })

  it('uses an English localization store when the adapter is created without one', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'default-localization', markdown: FULL_MARKDOWN })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    adapters.push(adapter)

    expect(host.querySelector('.toc-node__title')?.textContent).toBe('Table of contents')
    expect(host.querySelector('[data-code-action="advanced"]')?.textContent).toBe('')
    expect(host.querySelector('[data-formula-mode="inline"]')?.getAttribute('aria-label'))
      .toBe('Rendered inline formula')
    expect(host.querySelector('[data-formula-mode="inline"] .formula-rendered')?.getAttribute('aria-label'))
      .toBe('Rendered inline formula')
    expect(host.querySelector('[data-w-editor-node="ordinary-table"] table')?.getAttribute('aria-label'))
      .toBe('Editable Markdown table')
  })

  it('relocalizes mounted Mermaid and formula error states without storing translated fallback detail', async () => {
    const mermaidHost = document.createElement('div')
    document.body.append(mermaidHost)
    const localization = createUiLocalizationStore('en')
    const mermaidSession = new DocumentSession({
      documentId: 'localized-mermaid-error',
      markdown: mermaidStarterSource('mermaid.flowchart'),
    })
    const mermaidAdapter = new TiptapVisualAdapter({
      host: mermaidHost,
      localization,
      mermaidRenderer: { render: async () => Promise.reject('renderer offline') },
      project: projectOrdinaryMarkdown,
      session: mermaidSession,
    })
    adapters.push(mermaidAdapter)

    await vi.waitFor(() => {
      expect(mermaidHost.querySelector('.semantic-node-view__error')?.textContent)
        .toBe('Mermaid preview failed: Unknown Mermaid rendering error.')
    })
    const mermaidError = mermaidHost.querySelector<HTMLElement>('.semantic-node-view__error')!
    expect(mermaidError.dataset['mermaidPreviewMessage']).toBeUndefined()

    localization.setLocale('zh')
    expect(mermaidError.textContent).toBe('Mermaid 预览失败：未知 Mermaid 渲染错误。')
    expect(mermaidError.textContent).not.toContain('Unknown Mermaid rendering error.')

    localization.setLocale('en')
    const externalErrorHost = document.createElement('div')
    document.body.append(externalErrorHost)
    const externalErrorSession = new DocumentSession({
      documentId: 'localized-mermaid-external-error',
      markdown: mermaidStarterSource('mermaid.flowchart'),
    })
    const externalErrorAdapter = new TiptapVisualAdapter({
      host: externalErrorHost,
      localization,
      mermaidRenderer: { render: async () => Promise.reject(new Error('Renderer offline.')) },
      project: projectOrdinaryMarkdown,
      session: externalErrorSession,
    })
    adapters.push(externalErrorAdapter)
    await vi.waitFor(() => {
      expect(externalErrorHost.querySelector('.semantic-node-view__error')?.textContent)
        .toBe('Mermaid preview failed: Renderer offline.')
    })
    const externalError = externalErrorHost.querySelector<HTMLElement>('.semantic-node-view__error')!
    expect(externalError.dataset['mermaidPreviewMessage']).toBe('Renderer offline.')
    localization.setLocale('zh')
    expect(externalError.textContent).toBe('Mermaid 预览失败：Renderer offline.')

    const formulaHost = document.createElement('div')
    document.body.append(formulaHost)
    const formulaSession = new DocumentSession({ documentId: 'localized-formula-error', markdown: 'preserved source' })
    const formulaProject = (snapshot: DocumentSnapshot): TiptapVisualProjection => ({
      content: {
        content: [{
          attrs: {
            content: '\0',
            formulaMode: 'block',
            projectionId: 'formula-error',
            source: '$$\n\\0\n$$',
            sourceFrom: 0,
            sourceTo: snapshot.markdown.length,
          },
          type: 'formulaBlock',
        }],
        type: 'doc',
      },
      map: { documentLength: snapshot.markdown.length, entries: [], revision: snapshot.revision },
      revision: snapshot.revision,
      source: snapshot.markdown,
    })
    const formulaAdapter = new TiptapVisualAdapter({
      host: formulaHost,
      localization,
      project: formulaProject,
      session: formulaSession,
    })
    adapters.push(formulaAdapter)

    const formulaError = formulaHost.querySelector<HTMLElement>('.formula-rendered[data-render-state="error"]')!
    expect(formulaError.textContent).toBe('公式预览不可用。')
    localization.setLocale('en')
    expect(formulaError.textContent).toBe('Formula preview unavailable.')
  })

  it('localizes semantic source actions in place', () => {
    const localization = createUiLocalizationStore('en')
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'semantic-source-actions', markdown: 'preserved source' })
    const project = (snapshot: DocumentSnapshot): TiptapVisualProjection => ({
      content: {
        content: [{
          attrs: {
            code: 'const value = 1',
            editorId: 'code-block-editor',
            identity: 'Code · typescript',
            kind: 'code-block',
            language: 'typescript',
            projectionId: 'semantic-code',
            source: '```typescript\nconst value = 1\n```',
          },
          type: 'semanticBlock',
        }],
        type: 'doc',
      },
      map: { documentLength: snapshot.markdown.length, entries: [], revision: snapshot.revision },
      revision: snapshot.revision,
      source: snapshot.markdown,
    })
    const adapter = new TiptapVisualAdapter({ host, localization, project, session })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-w-editor-node="semantic-block"]')!
    const copy = node.querySelector<HTMLButtonElement>('[data-semantic-copy="code-block"]')!
    const edit = node.querySelector<HTMLButtonElement>('[data-semantic-edit="code-block-editor"]')!
    expect(copy.textContent).toBe('Copy source')
    expect(copy.getAttribute('aria-label')).toBe('Copy source')
    expect(edit.textContent).toBe('Edit source')
    expect(edit.getAttribute('aria-label')).toBe('Edit source: Code · typescript')

    const jsonBefore = JSON.stringify(adapter.documentJSON())
    const selectionBefore = adapter.selection()
    localization.setLocale('zh')
    expect(host.querySelector('[data-w-editor-node="semantic-block"]')).toBe(node)
    expect(copy.textContent).toBe('复制源码')
    expect(copy.getAttribute('aria-label')).toBe('复制源码')
    expect(edit.textContent).toBe('编辑源码')
    expect(edit.getAttribute('aria-label')).toBe('编辑源码：Code · typescript')
    expect(JSON.stringify(adapter.documentJSON())).toBe(jsonBefore)
    expect(adapter.selection()).toEqual(selectionBefore)
  })
})
