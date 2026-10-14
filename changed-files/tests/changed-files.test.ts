import { expect, test } from 'claude-code/testing'

import { countLines, countPatch, diffSnapshots, parseNumstat, snippet } from '../hooks/lib'

const PANE = {
  plugin: 'changed-files',
  component: 'Pane',
  requestId: 'changed-files',
  props: {
    title: '變更檔案',
    isFocused: false,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 16 },
    view: {},
  },
} as const

const EDIT_RESULT = {
  filePath: '/repo/a.ts',
  oldString: 'x',
  newString: 'y',
  originalFile: 'x\n',
  structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-x', '+y', '+z'] }],
  userModified: false,
  replaceAll: false,
}

test('countPatch reads + and - lines off a structured patch', () => {
  expect(countPatch(EDIT_RESULT.structuredPatch)).toEqual({ added: 2, deleted: 1, isApprox: false })
  expect(countPatch([])).toEqual({ added: 0, deleted: 0, isApprox: false })
})

test('countLines ignores one trailing newline and counts nothing for empty text', () => {
  expect(countLines('')).toBe(0)
  expect(countLines('a')).toBe(1)
  expect(countLines('a\nb\n')).toBe(2)
})

test('snippet keeps the first non-empty line and cuts it', () => {
  expect(snippet('\n  hello world\nmore', 5)).toBe('hello…')
  expect(snippet('short', 10)).toBe('short')
})

test('parseNumstat and diffSnapshots give the per-command delta, clamped at 0', () => {
  const before = { tracked: parseNumstat('3\t1\ta.ts\0-\t-\tbin.png\0'), untracked: new Set(['n.txt']) }
  const after = { tracked: parseNumstat('5\t1\ta.ts\0-\t-\tbin.png\0'), untracked: new Set(['n.txt', 'new.md']) }
  const delta = diffSnapshots(before, after)
  expect([...delta.changed]).toEqual([['a.ts', { added: 2, deleted: 0 }]])
  expect(delta.created).toEqual(['new.md'])
  const reverted = diffSnapshots(after, before)
  expect(reverted.changed.size).toBe(0)
  expect(reverted.created).toEqual([])
})

test('an Edit of the turn lands in the pane with its counts, and the pane collapses', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({ result: EDIT_RESULT }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('session.root', () => ({ value: '/repo' }))

  await $.turn.start({ text: '改 a.ts', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'x', new_string: 'y\nz' })

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: '1 檔 +2 −1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /改 a\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /a\.ts$/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /改 a\.ts/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '1 檔 +2 −1' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /改 a\.ts/ })).toBeDefined()
  await ui.unmount()
})
