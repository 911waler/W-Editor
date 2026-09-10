import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures/test'

const markdown = '# Opening\n\n' + Array.from({length:45},(_,i)=>`Paragraph ${i}.\n\n`).join('') + '## Final section\n\n- [ ] Untouched task'
for (const canEdit of [false,true]) {
  test(`readonly workspace with editing permission ${canEdit}`, async ({page}) => {
    test.setTimeout(60000)
    const writes:string[]=[]
    page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url())})
    await page.route('http://127.0.0.1:4173/',async route=>{
      const response=await route.fetch()
      const bootstrap={userId:1,csrfToken:'test',initialDocumentId:'blog:1',readonly:true,apiBase:'/api/blog-editor',blogListUrl:'/blogs',categories:{study:'学习笔记'},categoryOrder:['study'],readerDocument:{documentId:'blog:1',title:'Published note',markdown},readerEditUrl:canEdit?'/blogs/1/edit':null,readerArticles:[{documentId:'blog:1',title:'Published note',group:'学习笔记',url:'/blogs/1'},{documentId:'blog:2',title:'Visible note',group:'学习笔记',url:'/blogs/2'}]}
      await route.fulfill({response,body:(await response.text()).replace('<head>',`<head><script id="nwu-editor-bootstrap" type="application/json">${JSON.stringify(bootstrap)}</script>`)})
    })
    await page.goto('/')
    await expect(page.getByTestId('nwu-reader-workspace')).toBeVisible()
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0)
    await expect(page.getByRole('toolbar')).toHaveCount(0)
    await expect(page.locator('.nwu-reader-edit')).toHaveCount(canEdit?1:0)
    if(canEdit)await expect(page.locator('.nwu-reader-edit')).toHaveAttribute('href','/blogs/1/edit')
    await expect(page.getByRole('link',{name:'Visible note',exact:true})).toHaveAttribute('href','/blogs/2')
    await page.getByRole('tab',{name:'目录',exact:true}).click()
    await page.getByRole('button',{name:'Final section',exact:true}).click()
    await expect.poll(()=>page.locator('.nwu-reader-content').evaluate(node=>node.scrollTop)).toBeGreaterThan(0)
    const lightBackground=await page.locator('.tiptap-presentation-surface').evaluate(node=>getComputedStyle(node).backgroundColor)
    await page.getByLabel('皮肤',{exact:true}).selectOption('dark')
    await expect.poll(()=>page.locator('.tiptap-presentation-surface').evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe(lightBackground)
    await expect(page.getByTestId('nwu-reader-workspace')).toHaveAttribute('data-theme','dark')
    await page.getByLabel('语言',{exact:true}).selectOption('en')
    await expect(page.getByRole('tab',{name:'Outline',exact:true})).toBeVisible()
    await page.locator('.nwu-reader-export summary').click()
    const pending=page.waitForEvent('download')
    await page.getByRole('button',{name:'Markdown',exact:true}).click()
    const file=await pending
    expect(await readFile((await file.path())!,'utf8')).toBe(markdown)
    if(canEdit) {
      for (const format of ['HTML','Word','PDF','Long image']) {
        await page.locator('.nwu-reader-export summary').click()
        const download=page.waitForEvent('download')
        await page.getByRole('button',{name:format,exact:true}).click()
        const output=await download
        const bytes=await readFile((await output.path())!)
        if(format==='PDF')expect(bytes.subarray(0,4).toString()).toBe('%PDF')
        else if(format==='Long image')expect(bytes.subarray(1,4).toString()).toBe('PNG')
        else expect(bytes.toString()).toContain('Opening')
      }
    }
    expect(writes).toEqual([])
    await page.setViewportSize({width:600,height:700})
    await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click()
    await expect(page.locator('.nwu-reader-shell')).toHaveClass(/is-collapsed/)
    await expect(page.getByLabel('Language',{exact:true})).toBeInViewport()
    await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click()
    await expect(page.getByRole('tab',{name:'Outline',exact:true})).toBeVisible()
    await page.getByRole('tab',{name:'Outline',exact:true}).press('Home')
    await expect(page.getByRole('tab',{name:'Articles',exact:true})).toHaveAttribute('aria-selected','true')
    await page.getByRole('tab',{name:'Articles',exact:true}).press('End')
    await page.getByRole('button',{name:'Opening',exact:true}).click()
    await expect(page.locator('.nwu-reader-back')).toBeInViewport()
    if(canEdit) await page.screenshot({path:'/tmp/nwu-reader-preview.png'})
  })
}
