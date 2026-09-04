import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const matrixPath = 'docs/user-acceptance-remediation-matrix.md'
const expectedFindingIds = Array.from(
  { length: 20 },
  (_, index) => `UA-${String(index + 1).padStart(3, '0')}`,
)
const requiredColumns = [
  'Stable ID',
  'Classification / non-reproduction boundary',
  'Production reproduction',
  'Approved requirement / design decision',
  'Explicit non-goals',
  'Implementation task',
  'Focused regression',
  'Invalidated full gates',
  'Manual recheck',
  'Final disposition',
] as const

describe('user acceptance remediation matrix', () => {
  it('records exactly one complete row for every UA-001 through UA-020 finding', () => {
    expect(existsSync(matrixPath), `${matrixPath} must exist`).toBe(true)

    const matrix = readFileSync(matrixPath, 'utf8')
    const header = matrix.split('\n').find((line) => line.startsWith('| Stable ID |')) ?? ''
    const findingIds = [...matrix.matchAll(/^\| `?(UA-\d{3})`? \|/gmu)].map((match) => match[1])

    for (const column of requiredColumns) {
      expect(header, `matrix header must include ${column}`).toContain(` ${column} `)
    }
    expect(findingIds).toEqual(expectedFindingIds)

    const rows = matrix.split('\n').filter((line) => /^\| `?UA-\d{3}`? \|/u.test(line))
    expect(rows).toHaveLength(20)
    for (const row of rows) {
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      expect(cells).toHaveLength(requiredColumns.length)
      expect(cells.every((cell) => cell.length > 0 && cell !== 'TBD')).toBe(true)
    }
  })

  it('records completed downstream evidence without closing whole-editor user acceptance', () => {
    const matrix = readFileSync(matrixPath, 'utf8')
    const rows = matrix.split('\n').filter((line) => /^\| `?UA-\d{3}`? \|/u.test(line))

    for (const row of rows) {
      expect(row).toContain(
        'Tasks 24.2–24.5 passed; whole-editor user reacceptance remains pending.',
      )
    }
    expect(matrix).toContain('## Tasks 24.2–24.5 completion evidence')
    for (const taskId of ['24.2', '24.3', '24.4', '24.5']) {
      expect(matrix).toContain(`- Task ${taskId}`)
    }
    expect(matrix).toContain('Task 18.9 remains open')
  })
})
