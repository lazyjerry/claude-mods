import type { ChangedFile } from '../types'

export type Counts = { added: number; deleted: number; isApprox: boolean }
export type Numstat = { added: number; deleted: number }
export type Snapshot = { tracked: Map<string, Numstat>; untracked: Set<string> }

type Patch = readonly { lines: readonly string[] }[]

/** Counts the `+` and `-` lines of a structured patch (Edit / Write results). */
export const countPatch = (patch: Patch): Counts => {
  let added = 0
  let deleted = 0
  for (const hunk of patch) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) deleted += 1
    }
  }
  return { added, deleted, isApprox: false }
}

/** Lines of a text: none for '', a trailing newline adds no line. */
export const countLines = (text: string): number => {
  if (text === '') return 0
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n').length
}

/** `git diff --numstat -z`: "added\tdeleted\tpath\0" per file; binary files read `-`. */
export const parseNumstat = (stdout: string): Map<string, Numstat> => {
  const map = new Map<string, Numstat>()
  for (const row of stdout.split('\0')) {
    if (row === '') continue
    const [a, d, ...rest] = row.split('\t')
    const path = rest.join('\t')
    if (path === '' || a === undefined || d === undefined) continue
    map.set(path, { added: a === '-' ? 0 : Number(a), deleted: d === '-' ? 0 : Number(d) })
  }
  return map
}

/** `git ls-files -z`: paths separated by NUL. */
export const parseZeroList = (stdout: string): string[] =>
  stdout.split('\0').filter(path => path !== '')

/**
 * What a Bash command changed, from two snapshots against HEAD: a tracked
 * file's counts grew, or an untracked file appeared. A count that shrank
 * (a commit, a revert) is clamped to 0 and dropped.
 */
export const diffSnapshots = (
  before: Snapshot,
  after: Snapshot,
): { changed: Map<string, Numstat>; created: string[] } => {
  const changed = new Map<string, Numstat>()
  for (const [path, now] of after.tracked) {
    const was = before.tracked.get(path) ?? { added: 0, deleted: 0 }
    const added = Math.max(0, now.added - was.added)
    const deleted = Math.max(0, now.deleted - was.deleted)
    if (added > 0 || deleted > 0) changed.set(path, { added, deleted })
  }
  const created = [...after.untracked].filter(path => !before.untracked.has(path))
  return { changed, created }
}

/** The path as shown: relative to `root` when inside it. */
export const relativeTo = (root: string, path: string): string => {
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** The first line of a prompt, cut to `max` characters. */
export const snippet = (text: string, max: number): string => {
  const line = text.split('\n').find(one => one.trim() !== '') ?? ''
  const chars = [...line.trim()]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

/** Adds one change to a turn's list, summing into an existing row of the same path. */
export const mergeFile = (files: readonly ChangedFile[], one: ChangedFile): ChangedFile[] => {
  const index = files.findIndex(file => file.path === one.path)
  if (index < 0) return [...files, one]
  const was = files[index]!
  const merged: ChangedFile = {
    path: was.path,
    added: was.added + one.added,
    deleted: was.deleted + one.deleted,
    isApprox: was.isApprox || one.isApprox,
  }
  return [...files.slice(0, index), merged, ...files.slice(index + 1)]
}

export const sumFiles = (files: readonly ChangedFile[]): Counts =>
  files.reduce<Counts>(
    (sum, file) => ({
      added: sum.added + file.added,
      deleted: sum.deleted + file.deleted,
      isApprox: sum.isApprox || file.isApprox,
    }),
    { added: 0, deleted: 0, isApprox: false },
  )
