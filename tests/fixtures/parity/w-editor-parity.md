# W-Editor parity fixture

[[toc]]

## Inline content

Paragraph with *italic*, **bold**, `inline code`, { 汉字 | han4 zi4 }, $x^2 + y^2$, and a [link](https://example.com).

::: primary Panel title
Panel body with deterministic text.
:::

+++ Accordion title
Accordion body with deterministic text.
+++

::: timeline Release plan
:: [done] 2026-01-15 Complete
  Stable completed item
:: [doing] 2026-03-20 Active
  Stable active item
:: [todo] 2026-06-01 Planned
  Stable planned item
:: [error] 2026-07-01 Failed
  Stable error item
:: [milestone] 2026-08-01 Milestone
  Stable milestone item
:::

## Formula

$$
E = mc^2
$$

## Lists

1. Ordered one
2. Ordered two
   1. Nested ordered

- Unordered one
- Unordered two

- [ ] Pending task
- [x] Completed task

## Table

| Name | Role | State |
| :--- | :---: | ---: |
| Alpha | Editor | 2 |
| Beta | Reviewer | 1 |

## Code

```ts
const message = 'deterministic parity fixture'
console.log(message)
```

> Contextual quote fixture
