import { expect, it } from 'vitest'
import { numberOutline, activeOutlineIndex } from '../../packages/editor-vue/src/services/outlinePresentation'

it('numbers actual hierarchy without zero prefixes or phantom skipped levels', () => {
  const items = [{level:2,text:'访问'},{level:2,text:'申请'},{level:4,text:'服务器'},{level:4,text:'网站'},{level:1,text:'附录'}]
  expect(numberOutline(items).map(i => [i.number,i.depth])).toEqual([['1',0],['2',0],['2.1',1],['2.2',1],['3',0]])
  expect(items[0]).toEqual({level:2,text:'访问'})
})
it('tracks the last passed heading, including the final short section', () => {
  expect(activeOutlineIndex([100,300,600],32)).toBe(0)
  expect(activeOutlineIndex([-300,10,310],32)).toBe(1)
  expect(activeOutlineIndex([-300,10,310],32,true)).toBe(2)
  expect(activeOutlineIndex([],32)).toBe(-1)
})
