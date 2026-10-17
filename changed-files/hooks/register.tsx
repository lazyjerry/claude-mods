import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChangedFile, ChangedTurn } from '../types'
import {
  countLines,
  countPatch,
  diffSnapshots,
  mergeFile,
  parseNumstat,
  parseZeroList,
  relativeTo,
  snippet,
  sumFiles,
} from './lib'
import type { Counts, Snapshot } from './lib'

const PANE = 'changed-files'
const TITLE = '變更檔案'
const KEEP_TURNS = 30
const PROMPT_CHARS = 48
const MAX_ROWS = 16

const turns = atom({ plugin: 'changed-files', key: 'turns' } as const, [])
const current = atom({ plugin: 'changed-files', key: 'current' } as const, null)
const isExpanded = atom({ plugin: 'changed-files', key: 'isExpanded' } as const, true)
const hasAutoOpened = atom({ plugin: 'changed-files', key: 'hasAutoOpened' } as const, false)

type Engine = EngineInterface

// Module-level: a hot reload starts these over, and each is re-read lazily.
let root: string | undefined
// undefined: not checked yet; null: the session's cwd is not inside a git repo
let gitRoot: string | null | undefined

const projectRoot = async ($: Engine): Promise<string> => {
  root ??= await $.session.root().catch(() => '')
  return root
}

const repoRoot = async ($: Engine): Promise<string | null> => {
  if (gitRoot !== undefined) return gitRoot
  const ran = await $.process.run(['git', 'rev-parse', '--show-toplevel']).catch(() => undefined)
  gitRoot = ran !== undefined && ran.exitCode === 0 ? ran.stdout.trim() : null
  return gitRoot
}

/** The working tree against HEAD: tracked files' numstat and the untracked paths. */
const snapshot = async ($: Engine): Promise<Snapshot | undefined> => {
  const cwd = await repoRoot($)
  if (cwd === null) return undefined
  const [numstat, others] = await Promise.all([
    $.process.run(['git', 'diff', '--numstat', '-z', 'HEAD', '--'], { cwd, timeoutMs: 10_000 }),
    $.process.run(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd, timeoutMs: 10_000 }),
  ]).catch(() => [undefined, undefined])
  if (numstat === undefined || others === undefined) return undefined
  return {
    tracked: numstat.exitCode === 0 ? parseNumstat(numstat.stdout) : new Map(),
    untracked: others.exitCode === 0 ? new Set(parseZeroList(others.stdout)) : new Set(),
  }
}

/** Files a turn changed in the session's list, under the current turn (or an unnamed one). */
const record = async ($: Engine, path: string, counts: Counts): Promise<void> => {
  if (counts.added === 0 && counts.deleted === 0) return
  const file: ChangedFile = { path: relativeTo(await projectRoot($), path), ...counts }
  const now = await read($, current)
  await update($, turns, list => {
    const last = list[list.length - 1]
    const id = now?.id ?? last?.id ?? 'session'
    const prompt = now?.prompt ?? last?.prompt ?? '（沒有提示）'
    if (last !== undefined && last.id === id) {
      const turn: ChangedTurn = { ...last, files: mergeFile(last.files, file) }
      return [...list.slice(0, -1), turn]
    }
    return [...list, { id, prompt, files: [file] }].slice(-KEEP_TURNS)
  })
  $.ui.status(await summary($))
  await openOnFirstChange($)
}

/** 面板只在 session 第一次記到變更時自動開；之後由 /changed-files 開，關掉就不再自動冒出來。 */
const openOnFirstChange = async ($: Engine): Promise<void> => {
  if (await read($, hasAutoOpened)) return
  await update($, hasAutoOpened, () => true)
  await $.ui.open({ id: PANE, title: TITLE, rows: MAX_ROWS }).catch(() => undefined)
}

/** 沒有畫面板的 surface（如 VS Code 未開放面板時）改看狀態列與指令輸出的文字版。 */
const summary = async ($: Engine): Promise<string | undefined> => {
  const files = (await read($, turns)).flatMap(turn => turn.files)
  if (files.length === 0) return undefined
  const total = sumFiles(files)
  const paths = new Set(files.map(file => file.path)).size

  return `${TITLE} ${paths} 檔 +${total.added} −${total.deleted}${total.isApprox ? ' ~' : ''}`
}

const listText = async ($: Engine): Promise<string> => {
  const list = await read($, turns)
  if (list.length === 0) return '這個 session 還沒有改到檔案。'
  const head = (await summary($)) ?? TITLE
  const rows = [...list].reverse().flatMap((turn, i) => [
    `#${list.length - i} ${turn.prompt}`,
    ...turn.files.map(file => `  +${file.added} −${file.deleted}  ${file.path}${file.isApprox ? ' ~' : ''}`),
  ])

  return [head, ...rows].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = undefined
    gitRoot = undefined
    await $.command.register({
      name: 'changed-files',
      description: '打開本 session 的變更檔案面板（每輪的檔案與增刪行數）',
    })

    return next(e)
  })

  on('command.run', { command: 'changed-files' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, rows: MAX_ROWS })

    return { text: `變更檔案面板已打開。\n${await listText($)}` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, current, () => ({ id: e.turnId, prompt: snippet(e.text, PROMPT_CHARS) }))

    return next(e)
  })

  // 每輪結束，這輪有改到檔案才在對話裡追加一行摘要（不改動模型的回答）
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    const turn = (await read($, turns)).find(one => one.id === e.turnId)
    if (turn !== undefined && turn.files.length > 0) {
      const { added, deleted } = sumFiles(turn.files)
      $.ui.log(`${TITLE}（本輪）${turn.files.length} 檔 +${added} −${deleted}`)    }

    return ran
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === undefined && ran.result.staged !== true) {
      await record($, e.file_path, countPatch(ran.result.structuredPatch))
    }

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === undefined && ran.result.staged !== true) {
      const { structuredPatch, originalFile, content } = ran.result
      const counts: Counts =
        structuredPatch.length > 0
          ? countPatch(structuredPatch)
          : {
              added: countLines(content),
              deleted: originalFile === null ? 0 : countLines(originalFile),
              isApprox: originalFile !== null && originalFile !== content,
            }
      await record($, e.file_path, counts)
    }

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError === undefined && ran.result.error === undefined) {
      const { edit_mode, new_source, old_source } = ran.result
      await record($, e.notebook_path, {
        added: edit_mode === 'delete' ? 0 : countLines(new_source),
        deleted: countLines(old_source ?? ''),
        isApprox: true,
      })
    }

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before = await snapshot($)
    const ran = await next(e)
    if (before === undefined || ran.deny !== undefined) return ran
    const after = await snapshot($)
    if (after === undefined) return ran
    const cwd = (await repoRoot($)) ?? ''
    const { changed, created } = diffSnapshots(before, after)
    for (const [path, counts] of changed) {
      await record($, `${cwd}/${path}`, { ...counts, isApprox: false })
    }
    for (const path of created) {
      const text = await $.fs.read(`${cwd}/${path}`).catch(() => undefined)
      await record($, `${cwd}/${path}`, {
        added: text === undefined ? 0 : countLines(text),
        deleted: 0,
        isApprox: text === undefined,
      })
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, turns)
    const expanded = await read($, isExpanded)
    const allFiles = list.flatMap(turn => turn.files)
    const total = sumFiles(allFiles)
    const paths = new Set(allFiles.map(file => file.path)).size
    const width = Math.max(20, e.props.bodyColumns)

    const toggle = () => {
      void update($, isExpanded, was => !was)
      void $.ui.open({ id: PANE, title: TITLE, rows: expanded ? 1 : MAX_ROWS }).catch(() => undefined)
    }

    return (
      <Box flexDirection="column" width={width}>
        <Box flexDirection="row" gap={1}>
          <Text>
            {paths} 檔 +{total.added} −{total.deleted}
            {total.isApprox ? ' ~' : ''}
          </Text>
          <Button
            key="toggle"
            hotkey="x"
            plain
            dimColor
            label={expanded ? '[收合]' : '[展開]'}
            onPress={toggle}
          />
        </Box>
        {expanded && list.length === 0 && <Text dimColor>這個 session 還沒有改到檔案。</Text>}
        {expanded &&
          [...list].reverse().map((turn, i) => (
            <Box flexDirection="column">
              <Text dimColor wrap="truncate-end">
                #{list.length - i} {turn.prompt}
              </Text>
              {turn.files.map(file => (
                <Box flexDirection="row" gap={1}>
                  <Text color="green">{`+${file.added}`.padStart(5)}</Text>
                  <Text color="red">{`−${file.deleted}`.padStart(5)}</Text>
                  <Text wrap="truncate-start">
                    {file.path}
                    {file.isApprox ? ' ~' : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          ))}
      </Box>
    )
  })
}
