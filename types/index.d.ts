export type PlanRole = 'baseline' | 'branch' | 'apply'

export type PlanRisk = 'low' | 'medium' | 'high'

export type PlanCategory = 'create' | 'update' | 'replace' | 'delete' | 'other'

export type PlanChangeCategory = Exclude<PlanCategory, 'other'>

export type PlanProp = {
  path: string
  kind: string
  old?: string
  new?: string
}

export type PlanStep = {
  urn: string
  type: string
  name: string
  category: PlanCategory
  ops: string[]
  provider?: string
  id?: string
  diffReasons: string[]
  replaceReasons: string[]
  props: PlanProp[]
  propsOverflow: number
  isOpaque: boolean
}

export type PlanDiagnostic = {
  severity: string
  urn?: string
  message: string
}

export type PlanGitParent = {
  sha: string
  refs: string[]
}

export type PlanGit =
  | {
      isAvailable: true
      head: string
      branch: string | null
      subject: string
      parents: PlanGitParent[]
      headRefs: string[]
      dirtyCount: number
      originMain?: string
      isOnMain?: boolean
      behindMain?: number
    }
  | { isAvailable: false; reason: string }

export type PlanRun = {
  role: PlanRole
  label: string
  risk?: PlanRisk
  riskReason?: string
  project: string
  stack: string
  previewPath: string
  worktree: string
  registeredAt: number
  durationSec: number | null
  changeSummary: Record<string, number> | null
  git: PlanGit
  steps: PlanStep[]
  diagnostics: PlanDiagnostic[]
  sameCount: number
  runId?: string
  projectDir?: string
  targets?: string[]
  applyBlocked?: string
  since?: PlanSince
}

export type PlanSinceCommit = {
  sha: string
  subject: string
}

export type PlanSince = {
  baselineHead: string
  isAncestor: boolean
  commits?: PlanSinceCommit[]
  more?: number
  reason?: string
}

export type PlanApproval = {
  runId: string
  registeredAt: number
  status: 'armed' | 'approved'
  at: number
  scope?: 'change'
  targets?: string[]
}

export type PlanJobStatus = 'previewing' | 'running' | 'succeeded' | 'failed' | 'refused'

export type PlanJob = {
  status: PlanJobStatus
  runId: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  jobDir?: string
  tail?: string
  reason?: string
  scope?: 'change'
  targets?: string[]
}

export type PlanTheme = {
  preset?: string
  colors: Record<string, string>
  font?: string
}

declare module 'claude-code' {
  interface PluginState {
    'pulumi-plan': {
      runs: Shaped<PlanRun[]>
      open: StateFamily<boolean>
      approvals: Shaped<Record<string, PlanApproval>>
      jobs: Shaped<Record<string, PlanJob>>
      theme: Shaped<PlanTheme>
    }
  }
}
