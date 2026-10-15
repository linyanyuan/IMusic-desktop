// 封面尺寸约定 —— 回归锚点：首页「热门歌单/推荐歌曲/最近播放」封面全部消失。
//
// 首页卡片用 `size={0}` + `className="!h-auto aspect-square w-full"` 填满网格单元。
// Cover 早期无条件写内联 `width/height: size`，而内联样式优先级高于 class，
// 于是 size=0 时封面被压成 0×0 —— 图片其实已加载（naturalWidth>0）却完全不可见，
// 只看 `data-cover-loaded` 属性是查不出来的（当时正是这么漏掉的）。

import assert from 'node:assert/strict'
import test from 'node:test'
import { coverStyle } from '../src/components/Cover'

test('size=0（填满网格单元的约定）不下发内联宽高，交给 className', () => {
  const style = coverStyle(0)
  assert.equal('width' in style, false, 'size=0 时不能写 width，否则内联样式压过 w-full → 0 宽')
  assert.equal('height' in style, false, 'size=0 时不能写 height，否则 !h-auto 才有意义')
})

test('size>0 时下发明确的像素宽高', () => {
  const style = coverStyle(48)
  assert.equal(style.width, 48)
  assert.equal(style.height, 48)
})

test('size=0 仍保留占位渐变背景（哈希取色不能被尺寸规则吃掉）', () => {
  const style = coverStyle(0, { background: 'linear-gradient(135deg, hsl(200 72% 90%), hsl(232 58% 80%))' })
  assert.equal('width' in style, false)
  assert.match(String(style.background), /linear-gradient/)
})

test('负值/NaN 按「不写尺寸」处理，不允许出现非法内联样式', () => {
  assert.equal('width' in coverStyle(-1), false)
  assert.equal('width' in coverStyle(Number.NaN), false)
})
