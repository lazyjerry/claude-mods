export type ChangedFile = {
  path: string
  added: number
  deleted: number
  /** True when the counts were estimated (no patch available) rather than read off a diff. */
  isApprox: boolean
}

export type ChangedTurn = {
  id: string
  prompt: string
  files: ChangedFile[]
}

export type CurrentTurn = { id: string; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    'changed-files': {
      turns: ChangedTurn[]
      current: CurrentTurn | null
      isExpanded: boolean
      /** True once the pane auto-opened for this session's first change. */
      hasAutoOpened: boolean
    }
  }
}
