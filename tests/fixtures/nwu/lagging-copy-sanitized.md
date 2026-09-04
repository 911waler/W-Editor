# NWU 脱敏兼容样例

这是一篇完全虚构的普通文章，用于验证 W-Editor 的兼容边界，不来自任何真实用户或生产数据库。

## 图片属性

![脱敏图片](/static/blog_images/sanitized/example.png){width=640 height=360 align=center}

## 行内 span

普通文本与 <span style="color: #b42318; font-size: 18px">脱敏强调文本</span> 保持在同一段。

## 对齐

<div style="text-align: center;">脱敏居中文本</div>

## 代码与脚本注释

<!-- script: inspect_gpu.py -->

```python
def inspect_device():
    return "sanitized-device"
```

## 公式

行内公式 $a^2 + b^2 = c^2$。

$$
E = mc^2
$$

## 目录

[[toc]]
