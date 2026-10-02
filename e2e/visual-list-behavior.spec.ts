import type { Locator, Page } from '@playwright/test'

import { openReadyApp } from './fixtures/app'
import { expect, test } from './fixtures/test'

type ListCommandId = 'list.ordered' | 'list.task' | 'list.unordered'

const LIST_CASES: readonly Readonly<{
  commandId: ListCommandId
  joined: string
  split: string
  withParagraph: string
}>[] = Object.freeze([
  Object.freeze({
    commandId: 'list.ordered',
    joined: '1. AlphaBravo',
    split: '1. Alpha\n2. Bravo',
    withParagraph: '1. Alpha\n\nTail',
  }),
  Object.freeze({
    commandId: 'list.unordered',
    joined: '- AlphaBravo',
    split: '- Alpha\n- Bravo',
    withParagraph: '- Alpha\n\nTail',
  }),
  Object.freeze({
    commandId: 'list.task',
    joined: '- [ ] AlphaBravo',
    split: '- [ ] Alpha\n- [ ] Bravo',
    withParagraph: '- [ ] Alpha\n\nTail',
  }),
])

async function authority(page: Page) {
  return page.evaluate(() => window.__W_EDITOR_AUTHORITY__?.read() ?? null)
}

async function expectAuthority(page: Page, markdown: string): Promise<void> {
  await expect.poll(async () => (await authority(page))?.markdown).toBe(markdown)
  await expect.poll(async () => (await authority(page))?.synchronizationStatus).toBe('synchronized')
}

async function openVisualMarkdown(page: Page, markdown: string): Promise<Locator> {
  await openReadyApp(page)
  await page.locator('[data-command-id="mode.source"]').click()
  await page.locator('#markdown-source-editor').fill(markdown)
  await expectAuthority(page, markdown)
  await page.locator('[data-command-id="mode.visual"]').click()
  await expect(page.getByTestId('editor-surface')).toHaveAttribute('data-mode', 'visual')
  const editor = page.locator('.ProseMirror')
  await expect(editor).toBeVisible()
  return editor
}

async function invokeListToolbar(page: Page, commandId: ListCommandId): Promise<void> {
  await page.locator('[data-toolbar-menu="list"] .toolbar-menu__trigger').click()
  const command = page.locator(`[data-command-id="${commandId}"]`)
  await expect(command).toBeEnabled()
  await command.click()
}

async function placeCaret(page: Page, paragraph: Locator, offset: number): Promise<void> {
  await paragraph.click()
  await page.keyboard.press('Home')
  for (let index = 0; index < offset; index += 1) await page.keyboard.press('ArrowRight')
}

for (const viewport of [
  Object.freeze({ height: 1000, label: 'desktop', width: 1440 }),
  Object.freeze({ height: 900, label: 'narrow', width: 768 }),
] as const) {
  test(`UA-004 ${viewport.label} list geometry uses the frozen Cherry hanging-indent tokens`, async ({ page }) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    const editor = await openVisualMarkdown(page, 'Anchor\n\n1. Ordered\n\n- Bullet\n\n- [ ] Task')
    const geometry = await editor.evaluate((root) => {
      const paragraph = root.querySelector<HTMLElement>('p')
      const ordered = root.querySelector<HTMLElement>('ol')
      const bullet = root.querySelector<HTMLElement>('ul:not([data-type="taskList"])')
      const task = root.querySelector<HTMLElement>('ul[data-type="taskList"]')
      const taskItem = task?.querySelector<HTMLElement>('li') ?? null
      const taskCheckbox = task?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null
      const taskParagraph = task?.querySelector<HTMLElement>('p') ?? null
      if (paragraph === null || ordered === null || bullet === null || task === null
        || taskItem === null || taskCheckbox === null || taskParagraph === null) {
        throw new Error('The list geometry fixture did not project every required node.')
      }
      const anchorLeft = paragraph.getBoundingClientRect().left
      const orderedStyle = getComputedStyle(ordered)
      const bulletStyle = getComputedStyle(bullet)
      const taskStyle = getComputedStyle(task)
      const taskItemStyle = getComputedStyle(taskItem)
      const checkboxRect = taskCheckbox.getBoundingClientRect()
      const taskTextRect = taskParagraph.getBoundingClientRect()
      return {
        bulletIndent: bullet.querySelector('p')!.getBoundingClientRect().left - anchorLeft,
        bulletMarginBlockEnd: bulletStyle.marginBlockEnd,
        bulletPaddingInlineStart: bulletStyle.paddingInlineStart,
        orderedIndent: ordered.querySelector('p')!.getBoundingClientRect().left - anchorLeft,
        orderedMarginBlockEnd: orderedStyle.marginBlockEnd,
        orderedPaddingInlineStart: orderedStyle.paddingInlineStart,
        taskCheckboxAnchor: checkboxRect.left - anchorLeft,
        taskDisplay: taskItemStyle.display,
        taskIndent: taskTextRect.left - anchorLeft,
        taskListStyle: taskItemStyle.listStyleType,
        taskMarginBlockEnd: taskStyle.marginBlockEnd,
        taskPaddingInlineStart: taskStyle.paddingInlineStart,
        taskRowOffset: Math.abs((checkboxRect.top + checkboxRect.height / 2)
          - (taskTextRect.top + Number.parseFloat(getComputedStyle(taskParagraph).lineHeight) / 2)),
      }
    })

    expect(geometry).toEqual({
      bulletIndent: 24,
      bulletMarginBlockEnd: '16px',
      bulletPaddingInlineStart: '24px',
      orderedIndent: 24,
      orderedMarginBlockEnd: '16px',
      orderedPaddingInlineStart: '24px',
      taskCheckboxAnchor: 0,
      taskDisplay: 'flex',
      taskIndent: 24,
      taskListStyle: 'none',
      taskMarginBlockEnd: '16px',
      taskPaddingInlineStart: '0px',
      taskRowOffset: 0,
    })
  })
}

test('UA-004 real Tab nesting preserves exact Markdown, 24px geometry, focus, undo, redo, and reload', async ({ page }) => {
  const editor = await openVisualMarkdown(page, '1. Parent\n2. Child')
  const child = editor.locator('ol > li > p').filter({ hasText: 'Child' })
  await child.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Tab')

  const nested = editor.locator('ol ol')
  await expect(nested).toHaveCount(1)
  await expectAuthority(page, '1. Parent\n   1. Child')
  await expect(editor).toBeFocused()
  expect(await nested.evaluate((list) => {
    const nestedText = list.querySelector('p')?.getBoundingClientRect().left
    const parentText = list.parentElement?.querySelector(':scope > p')?.getBoundingClientRect().left
    return nestedText === undefined || parentText === undefined ? null : nestedText - parentText
  })).toBe(24)

  await page.keyboard.press('Control+z')
  await expectAuthority(page, '1. Parent\n2. Child')
  await expect(nested).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expectAuthority(page, '1. Parent\n   1. Child')
  await expect(nested).toHaveCount(1)

  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, '1. Parent\n   1. Child')
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'visual') {
    await page.locator('[data-command-id="mode.visual"]').click()
  }
  await expect(page.locator('.ProseMirror ol ol')).toHaveCount(1)
})

for (const listCase of LIST_CASES) {
  test(`UA-005 ${listCase.commandId} toolbar-to-Enter splits a non-empty item at the live caret`, async ({ page }) => {
    const editor = await openVisualMarkdown(page, 'AlphaBravo')
    await placeCaret(page, editor.locator('p').first(), 5)
    await invokeListToolbar(page, listCase.commandId)
    await page.keyboard.press('Enter')

    await expectAuthority(page, listCase.split)
    await expect(editor).toBeFocused()
    expect(await editor.evaluate(() => {
      const selection = window.getSelection()
      const item = selection?.anchorNode instanceof Node
        ? selection.anchorNode.parentElement?.closest('li')
        : null
      return { offset: selection?.anchorOffset ?? null, text: item?.querySelector('p')?.textContent ?? null }
    })).toEqual({ offset: 0, text: 'Bravo' })

    await page.keyboard.press('Control+z')
    await expectAuthority(page, listCase.joined)
    await page.keyboard.press('Control+Shift+z')
    await expectAuthority(page, listCase.split)
  })

  test(`UA-005 ${listCase.commandId} empty-item Enter exits to a paragraph for immediate typing`, async ({ page }) => {
    const editor = await openVisualMarkdown(page, 'Alpha')
    await placeCaret(page, editor.locator('p').first(), 5)
    await invokeListToolbar(page, listCase.commandId)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Tail')

    await expectAuthority(page, listCase.withParagraph)
    await expect(editor).toBeFocused()
    const paragraphs = editor.locator(':scope > p')
    await expect(paragraphs).toHaveCount(1)
    await expect(paragraphs).toHaveText('Tail')
  })
}

test('ordered, unordered, and task toolbar states follow the current caret location', async ({ page }) => {
  const editor = await openVisualMarkdown(page, '1. Ordered\n\n- Unordered\n\n- [ ] Task\n\nPlain')
  const cases = [
    { commandId: 'list.ordered', paragraph: editor.locator('ol > li > p') },
    { commandId: 'list.unordered', paragraph: editor.locator('ul:not([data-type="taskList"]) > li > p') },
    { commandId: 'list.task', paragraph: editor.locator('ul[data-type="taskList"] > li p') },
  ] as const
  for (const current of cases) {
    await current.paragraph.click()
    await expect(page.locator(`[data-command-id="${current.commandId}"]`)).toHaveAttribute('aria-checked', 'true')
  }

  await editor.locator(':scope > p', { hasText: 'Plain' }).click()
  for (const current of cases) {
    await expect(page.locator(`[data-command-id="${current.commandId}"]`)).toHaveAttribute('aria-checked', 'false')
  }
})

test('UA-006 task items reset checked state, stay horizontal, and expose click and keyboard semantics', async ({ page }) => {
  const editor = await openVisualMarkdown(page, '- [x] Alpha')
  const firstItem = editor.locator('ul[data-type="taskList"] > li').first()
  const firstText = firstItem.locator('p')
  const firstCheckbox = firstItem.locator('input[type="checkbox"]')

  await expect(firstCheckbox).toHaveAccessibleName('Task item checkbox for Alpha')
  await expect(firstCheckbox).toBeChecked()
  await firstText.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Bravo')
  await expectAuthority(page, '- [x] Alpha\n- [ ] Bravo')

  const secondItem = editor.locator('ul[data-type="taskList"] > li').nth(1)
  const secondCheckbox = secondItem.locator('input[type="checkbox"]')
  await expect(secondCheckbox).toHaveAccessibleName('Task item checkbox for Bravo')
  await expect(secondCheckbox).not.toBeChecked()
  const rowGeometry = await secondItem.evaluate((item) => {
    const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const paragraph = item.querySelector<HTMLElement>('p')
    if (checkbox === null || paragraph === null) throw new Error('Task row controls are incomplete.')
    const checkboxRect = checkbox.getBoundingClientRect()
    const paragraphRect = paragraph.getBoundingClientRect()
    return {
      display: getComputedStyle(item).display,
      gap: paragraphRect.left - checkboxRect.right,
      rowOffset: Math.abs((checkboxRect.top + checkboxRect.height / 2)
        - (paragraphRect.top + Number.parseFloat(getComputedStyle(paragraph).lineHeight) / 2)),
    }
  })
  expect(rowGeometry).toEqual({ display: 'flex', gap: 8, rowOffset: 0 })

  await secondCheckbox.focus()
  await page.keyboard.press('Space')
  await expectAuthority(page, '- [x] Alpha\n- [x] Bravo')
  await expect(secondCheckbox).toBeChecked()
  await firstCheckbox.click()
  await expectAuthority(page, '- [ ] Alpha\n- [x] Bravo')

  await secondItem.locator('p').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expectAuthority(page, '- [ ] Alpha\n- [x] Bravo!')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Control+z')
  await expectAuthority(page, '- [ ] Alpha\n- [x] Bravo')

  await expect.poll(async () => (await authority(page))?.autosaveStatus).toBe('saved')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-w-editor-ready', 'true')
  await expectAuthority(page, '- [ ] Alpha\n- [x] Bravo')
  if (await page.getByTestId('editor-surface').getAttribute('data-mode') !== 'visual') {
    await page.locator('[data-command-id="mode.visual"]').click()
  }
  await expect(page.locator('ul[data-type="taskList"] > li input[type="checkbox"]')).toHaveCount(2)
})
