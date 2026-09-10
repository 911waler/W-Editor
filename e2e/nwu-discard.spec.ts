import { expect, test } from './fixtures/test'

test('NWU discards restored and edited drafts to canonical text without a manual save, including reload', async ({page}) => {
  let draft='Recovered unsaved text'
  const saves: {markdown:string;saveKind:string}[]=[]
  const metadata={title:'First note',category:'other',visibility:'private',allowedUsernames:[]}
  await page.route('**/api/blog-editor/**',async route=>{
    const path=new URL(route.request().url()).pathname
    let body:unknown
    if(path.endsWith('/save')) {
      const input=route.request().postDataJSON() as {markdown:string;saveKind:string}
      saves.push(input); draft=input.markdown; body={serverRevision:'r1'}
    } else if(path.includes('/state/')) {
      body=route.request().method()==='GET' ? {draft:{documentId:'blog:1',userId:'1',baseServerRevision:'r1',markdown:draft,metadata}} : {}
    } else if(path.endsWith('/documents')) body={items:[{documentId:'blog:1',title:'First note',group:'其他'},{documentId:'blog:2',title:'Second note',group:'其他'}],nextCursor:null}
    else { const id=path.endsWith('blog%3A2')?'blog:2':'blog:1'; body={document:{documentId:id,markdown:id==='blog:1'?'Canonical saved text':'Second text',revision:0,serverRevision:'r1'},metadata:{...metadata,title:id==='blog:1'?'First note':'Second note'}} }
    await route.fulfill({json:body})
  })
  const bootstrap={userId:1,csrfToken:'test',initialDocumentId:'blog:1',readonly:false,apiBase:'/api/blog-editor',blogListUrl:'/blogs',categories:{other:'其他'}}
  await page.route(/http:\/\/127\.0\.0\.1:4173\/(?:blogs\/\d+\/edit)?$/,async route=>{
    const response=await route.fetch()
    await route.fulfill({response,body:(await response.text()).replaceAll('./assets/', '/assets/').replace('<head>',`<head><script id="nwu-editor-bootstrap" type="application/json">${JSON.stringify(bootstrap)}</script>`)})
  })
  await page.goto('/')
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor')).toHaveText('Recovered unsaved text')
  await page.locator('#markdown-source-editor').fill('More unsaved changes')
  await page.locator('.article-card').filter({hasText:'Second note'}).click()
  const dialog=page.getByTestId('article-switch-decision')
  await expect(dialog.getByRole('button')).toHaveText(['取消', '丢弃修改', '保存修改'])
  await expect(dialog).not.toContainText('在 NWU 中')
  await expect(dialog).not.toContainText('不会删除文章')
  await dialog.getByTestId('article-switch-cancel').click()
  await expect(page).toHaveURL(/blogs\/1\/edit/)
  await expect(page.locator('#markdown-source-editor')).toHaveText('More unsaved changes')
  await page.locator('.article-card').filter({hasText:'Second note'}).click()
  await page.screenshot({path:'/tmp/nwu-discard-dialog.png'})
  await dialog.getByTestId('article-switch-discard').click()
  await expect(page).toHaveURL(/blogs\/2\/edit/)
  expect(draft).toBe('Canonical saved text')
  expect(saves.every(save=>save.saveKind==='autosave-draft')).toBe(true)
  await page.locator('.article-card').filter({hasText:'First note'}).click()
  await expect(page.locator('#markdown-source-editor')).toHaveText('Canonical saved text')
  await page.reload()
  await page.locator('[data-command-id="mode.source"]').click()
  await expect(page.locator('#markdown-source-editor')).toHaveText('Canonical saved text')
})
