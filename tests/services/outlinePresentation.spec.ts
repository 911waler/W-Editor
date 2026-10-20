import { expect, it } from 'vitest'
import { numberOutline, activeOutlineIndex, visibleOutlineItems } from '../../packages/editor-vue/src/services/outlinePresentation'

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

it('hides only descendants while preserving numbering and original navigation indices', () => {
  const items = numberOutline([
    {level: 2, text: 'A'}, {level: 4, text: 'B'}, {level: 5, text: 'C'},
    {level: 4, text: 'D'}, {level: 2, text: 'E'}, {level: 3, text: 'F'},
  ])
  expect(visibleOutlineItems(items, new Set([0, 1])).map(item => [item.text, item.number, item.outlineIndex, item.hasChildren, item.collapsed]))
    .toEqual([['A', '1', 0, true, true], ['E', '2', 4, true, false], ['F', '2.1', 5, false, false]])
  expect(visibleOutlineItems(items, new Set([1])).map(item => item.text)).toEqual(['A', 'B', 'D', 'E', 'F'])
  expect(visibleOutlineItems(items, new Set()).map(item => item.text)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  expect(visibleOutlineItems([], new Set())).toEqual([])
})

it('keeps heading-level gaps and equal-level indentation independent of preceding ancestors', () => {
  const items = numberOutline([{level: 1}, {level: 4}, {level: 2}, {level: 4}])
  expect(items.map(item => item.indentDepth)).toEqual([0, 3, 1, 3])
  expect(items.map(item => item.depth)).toEqual([0, 1, 1, 2])
  expect(items.map(item => item.number)).toEqual(['1', '1.1', '1.2', '1.2.1'])
  expect(visibleOutlineItems(items, new Set([1])).length).toBe(4)
  expect(visibleOutlineItems(items, new Set([2])).map(item => item.level)).toEqual([1, 4, 2])
})

it('normalizes the shallowest document level without flattening earlier deeper headings', () => {
  expect(numberOutline([{level: 4}, {level: 2}, {level: 3}]).map(item => item.indentDepth)).toEqual([2, 0, 1])
  expect(numberOutline([{level: 2}, {level: 2}, {level: 3}]).map(item => item.indentDepth)).toEqual([0, 0, 1])
  expect(numberOutline([])).toEqual([])
})
