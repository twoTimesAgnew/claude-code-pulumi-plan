import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer, ToolCallResult } from 'claude-code'

import type {
  PlanApproval,
  PlanChangeCategory,
  PlanDiagnostic,
  PlanGit,
  PlanGitParent,
  PlanJob,
  PlanProp,
  PlanRisk,
  PlanRole,
  PlanRun,
  PlanSince,
  PlanStep,
} from '../types'
import {
  APPROVAL_TTL_MS,
  STACK_PATTERN,
  WAIT_SECONDS,
  approvalProblem,
  blocksApproval,
  changeCount,
  hasControl,
  hhmm,
  isBusy,
  isInside,
  isProduction,
  jobFolderName,
  launchArgv,
  logTail,
  previewArgv,
  pulumiProjectName,
  runScript,
  sameTargets,
  stackKey,
  stepSetDiff,
  waitArgv,
} from './apply'
import {
  CHANGE_CATEGORIES,
  buildCards,
  buildDiagnostics,
  buildSteps,
  changeOnly,
  cleanText,
  compare,
  countSteps,
  deriveTarget,
  driftCount,
  gitLine,
  parsePreview,
  parseUrn,
  preMergeBaseline,
  rowPreview,
  runKey,
  shortSha,
  upsertRun,
} from './plan'
import type { Card, Entry, Preview } from './plan'
import { bannerSvg, chipSvg, describePresets, describeTheme, metaLabel, parseTheme, pillHoverFill, plural, resolveTheme } from './style'
import type { PaletteKey, PillKey, ThemeLoad } from './style'

const PANE = 'pulumi-plan'
const TOOL = 'mcp__pulumi-plan__show'
const APPLY = 'mcp__pulumi-plan__apply'
const APPLY_STATUS = 'mcp__pulumi-plan__apply_status'
const MAX_READ_BYTES = 4 * 1024 * 1024
const ROW_LIMIT = 50
const POLL_MS = 3000
const SINCE_LIMIT = 50
const PANE_TAIL_LINES = 15
const THEME_FILE = '.claude/pulumi-plan/theme.json'

const runs = atom({ plugin: 'pulumi-plan', key: 'runs' } as const, [], { shape: 'runs-1' })
const approvals = atom({ plugin: 'pulumi-plan', key: 'approvals' } as const, {}, { shape: 'approvals-1' })
const jobs = atom({ plugin: 'pulumi-plan', key: 'jobs' } as const, {}, { shape: 'jobs-1' })
const overrides = atom({ plugin: 'pulumi-plan', key: 'theme' } as const, { colors: {} }, { shape: 'theme-1' })
const OPEN = { plugin: 'pulumi-plan', key: 'open' } as const

const TITLES: Record<PlanChangeCategory, string> = {
  create: 'Create',
  update: 'Update',
  replace: 'Replace',
  delete: 'Delete',
}

const CATEGORY_PILLS: Record<PlanChangeCategory, PillKey> = {
  create: 'pillCreate',
  update: 'pillUpdate',
  replace: 'pillDanger',
  delete: 'pillDanger',
}

const CATEGORY_FILLS: Record<PlanChangeCategory, PaletteKey> = {
  create: 'create',
  update: 'update',
  replace: 'replace',
  delete: 'delete',
}

const RISKS: Record<PlanRisk, { chip: string; fill: PaletteKey; ink: PaletteKey; meaning: string }> = {
  low: { chip: 'low risk', fill: 'riskLow', ink: 'ink', meaning: 'no customer impact' },
  medium: { chip: 'medium risk', fill: 'riskMedium', ink: 'ink', meaning: 'possible customer impact' },
  high: { chip: 'high risk', fill: 'riskHigh', ink: 'onAccent', meaning: 'definite customer impact' },
}

const RISK_REASON_LIMIT = 300

const DESCRIPTION = [
  'Shows what a `pulumi preview` would change in the Pulumi plan pane, separating the change a branch makes from drift already in the stack.',
  'Call it once per preview output, right after that preview finishes, for baseline runs (from the base branch, e.g. origin/main) and branch runs alike.',
  'Call it BEFORE the scratch worktree the preview ran in is removed: git info (HEAD, branch, merge parents, dirty files) is read from `worktree` at call time.',
  'The preview must be run with `--json` and its stdout redirected to a file, e.g. `pulumi preview --stack <s> --json --non-interactive > /abs/path/preview.json`; pass that file as `previewJson`.',
  'A branch run is compared with the baseline run of the same project/stack; register the baseline too or drift cannot be separated.',
  'Role `apply` registers a preview run from a clean checkout at origin/main (after the change merged) of what an apply would do now; pass `projectDir` (the folder holding Pulumi.yaml where the preview ran) and `targets` when the preview used `--target`. Its card offers the user an Approve button for `mcp__pulumi-plan__apply`; when a paired pre-merge baseline separates the change from pending drift, it offers two: Approve all (drift included) and Approve change only (only the merge\'s own steps, via `--target`).',
  'Pass `risk` for every preview: `low` when the change has no customer impact, `medium` when customers could be affected (a restart that should be rolling, a DNS or certificate change that should be seamless), `high` when customers will be affected (downtime, a replaced database, a deleted ingress). Give the reason in `riskReason`. A card without a risk shows RISK NOT SET.',
  'For an apply after a merge, register two previews of the same stack, each from its own clean scratch worktree: `baseline` from the commit before the merge (`<merge>^1`) and `apply` from origin/main, in either order; the apply card then separates what the merge changes from drift that the apply also runs.',
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    previewJson: {
      type: 'string',
      description: "Absolute path of the file holding one preview's `--json` stdout.",
    },
    worktree: {
      type: 'string',
      description: 'Absolute path of the git checkout the preview was run from.',
    },
    role: {
      type: 'string',
      enum: ['baseline', 'branch', 'apply'],
      description:
        '`baseline` for a run from the base branch, `branch` for a run with the change applied, `apply` for a run from a clean origin/main checkout that the user may approve to apply.',
    },
    label: {
      type: 'string',
      description: 'Short name of the change set (ticket id or branch name). Required when role is `branch`.',
    },
    risk: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description:
        'Customer impact of this preview: `low` none, `medium` possible, `high` definite. Shown as a chip on the card.',
    },
    riskReason: {
      type: 'string',
      description: `One sentence on why this risk level: which customers or services are affected and how. Up to ${RISK_REASON_LIMIT} characters.`,
    },
    stack: {
      type: 'string',
      description: 'Stack name; only used when the preview has no steps to derive it from.',
    },
    project: {
      type: 'string',
      description: 'Project name; only used when the preview has no steps to derive it from.',
    },
    projectDir: {
      type: 'string',
      description: 'Role `apply` only, required: absolute path of the directory holding Pulumi.yaml, where the preview was run.',
    },
    targets: {
      type: 'array',
      items: { type: 'string' },
      description: 'Role `apply` only: the exact `--target` URNs the preview was run with, if any.',
    },
  },
  required: ['previewJson', 'worktree', 'role'],
} as const

const APPLY_DESCRIPTION = [
  'Runs `pulumi up` for one stack. It works only after the user pressed Approve on that stack\'s apply card in the Pulumi plan pane (registered with `mcp__pulumi-plan__show` role `apply`).',
  'Which button the user pressed decides the scope: Approve all applies every step, drift included; Approve change only applies only the merge\'s own steps with `--target` and leaves the drift pending.',
  'When it answers that the approval is missing, expired or void, tell the user what to press and stop.',
  'Never run `pulumi up` any other way.',
  'It re-checks the checkout and re-runs the preview first; if anything changed it applies nothing and the user must approve again.',
  'The apply runs detached: an interrupted wait does not stop it; use `mcp__pulumi-plan__apply_status` to follow it.',
].join(' ')

const STATUS_DESCRIPTION =
  'Reports the apply job of one stack started by `mcp__pulumi-plan__apply`: running or finished, exit code and the log tail. Waits up to about 9 minutes for a running job to finish.'

const STACK_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Pulumi project name, as shown on the apply card.' },
    stack: { type: 'string', description: 'Stack name, as shown on the apply card.' },
  },
  required: ['project', 'stack'],
} as const

const PRESS_HINT =
  'Ask the user to press "Approve apply" on that stack\'s apply card in the Pulumi plan pane (or, where the card offers two buttons, "Approve all" or "Approve change only"; for a production stack, then "Yes, apply to production"), and call apply again only after they have.'

type Dollar = EngineInterface

type RunArgs = {
  role: PlanRole
  label: string
  risk?: PlanRisk
  riskReason?: string
  project: string
  stack: string
  previewPath: string
  worktree: string
  projectDir?: string
  targets?: string[]
}

let poll: Timer | undefined

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _, ...rest } = record

  return rest
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readFailure($: Dollar, path: string, error: unknown): Promise<string> {
  const reason = message(error)
  try {
    if (!(await $.fs.exists(path))) {
      return `cannot read ${path}: the file does not exist`
    }
    const stat = await $.fs.stat(path)
    if (stat.size > MAX_READ_BYTES) {
      return `cannot read ${path}: it is ${(stat.size / 1024 / 1024).toFixed(1)} MiB, over the 4 MiB read limit`
    }
  } catch {
    return `cannot read ${path}: ${reason}`
  }

  return `cannot read ${path}: ${reason}`
}

async function readGit($: Dollar, worktree: string): Promise<PlanGit> {
  const git = async (...args: string[]) => {
    const ran = await $.process.run(['git', '-C', worktree, ...args], { timeoutMs: 15000 })

    return { ...ran, stdout: ran.stdout.trim() }
  }
  try {
    const head = await git('rev-parse', 'HEAD')
    if (head.exitCode !== 0 || head.stdout === '') {
      return { isAvailable: false, reason: head.stderr.trim() || `git rev-parse exited ${head.exitCode}` }
    }
    const branch = await git('symbolic-ref', '--short', '-q', 'HEAD')
    const log = await git('log', '-1', '--format=%P%n%s', 'HEAD')
    const [parentLine = '', ...subject] = log.stdout.split('\n')
    const parentShas = parentLine.split(' ').filter(sha => sha !== '')
    const isDetached = branch.exitCode !== 0 || branch.stdout === ''
    const refsAt = async (sha: string) => {
      const refs = await git('for-each-ref', '--format=%(refname:short)', '--points-at', sha, 'refs/heads', 'refs/remotes')

      return refs.exitCode === 0 ? refs.stdout.split('\n').filter(ref => ref !== '') : []
    }
    const isMerge = isDetached && parentShas.length === 2
    const parents: PlanGitParent[] = []
    for (const sha of parentShas) {
      parents.push({ sha, refs: isMerge ? await refsAt(sha) : [] })
    }
    const status = await git('status', '--porcelain')
    const origin = await git('rev-parse', '--verify', '-q', 'origin/main')
    const originMain = origin.exitCode === 0 && origin.stdout !== '' ? origin.stdout : undefined
    let isOnMain: boolean | undefined
    let behindMain: number | undefined
    if (originMain !== undefined) {
      const ancestor = await git('merge-base', '--is-ancestor', 'HEAD', 'origin/main')
      isOnMain = ancestor.exitCode === 0 ? true : ancestor.exitCode === 1 ? false : undefined
      if (isOnMain) {
        const behind = await git('rev-list', '--count', '--first-parent', 'HEAD..origin/main')
        const count = Number.parseInt(behind.stdout, 10)
        behindMain = behind.exitCode === 0 && Number.isFinite(count) ? count : undefined
      }
    }

    return {
      isAvailable: true,
      head: head.stdout,
      branch: isDetached ? null : branch.stdout,
      subject: subject.join('\n'),
      parents,
      headRefs: await refsAt(head.stdout),
      dirtyCount: status.exitCode === 0 ? status.stdout.split('\n').filter(line => line !== '').length : 0,
      ...(originMain === undefined ? {} : { originMain }),
      ...(isOnMain === undefined ? {} : { isOnMain }),
      ...(behindMain === undefined ? {} : { behindMain }),
    }
  } catch (error) {
    return { isAvailable: false, reason: message(error) }
  }
}

async function realPath($: Dollar, path: string): Promise<string | null> {
  try {
    const stat = await $.fs.stat(path, { resolve: true })

    return stat.realPath ?? path
  } catch {
    return null
  }
}

async function applyBlockers($: Dollar, run: PlanRun): Promise<string[]> {
  const reasons: string[] = []
  const git = run.git
  if (!git.isAvailable) {
    reasons.push(`git unavailable: ${git.reason}`)
  } else {
    if (git.dirtyCount > 0) {
      reasons.push(`the worktree has ${git.dirtyCount} uncommitted file${git.dirtyCount === 1 ? '' : 's'}`)
    }
    let origin = ''
    try {
      const ran = await $.process.run(['git', '-C', run.worktree, 'rev-parse', 'origin/main'], { timeoutMs: 15000 })
      origin = ran.exitCode === 0 ? ran.stdout.trim() : ''
    } catch {
      origin = ''
    }
    if (origin === '') {
      reasons.push('origin/main is not known in the worktree')
    } else if (origin !== git.head) {
      reasons.push(`HEAD ${shortSha(git.head)} is not origin/main (${shortSha(origin)})`)
    }
  }
  const projectDir = run.projectDir ?? ''
  const [realDir, realTree] = await Promise.all([realPath($, projectDir), realPath($, run.worktree)])
  if (realDir === null) {
    reasons.push(`projectDir ${projectDir} does not exist`)
  } else if (realTree === null || !isInside(realDir, realTree)) {
    reasons.push(`projectDir ${projectDir} is not inside the worktree ${run.worktree}`)
  }
  let yaml: string | null = null
  try {
    const raw = await $.fs.read(`${projectDir}/Pulumi.yaml`)
    yaml = typeof raw === 'string' ? raw : null
  } catch {
    yaml = null
  }
  if (yaml === null) {
    reasons.push(`no Pulumi.yaml in ${projectDir}`)
  } else {
    const name = pulumiProjectName(yaml)
    if (name !== run.project) {
      reasons.push(`Pulumi.yaml names project "${name ?? ''}", the URNs say "${run.project}"`)
    }
  }
  if (!STACK_PATTERN.test(run.stack)) {
    reasons.push(`stack name "${run.stack}" does not match ${STACK_PATTERN}`)
  }
  const errors = run.diagnostics.filter(d => d.severity === 'error').length
  if (errors > 0) {
    reasons.push(`the preview reported ${errors} error diagnostic${errors === 1 ? '' : 's'}`)
  }
  if (changeCount(run) === 0) {
    reasons.push('the preview has no create, update, replace or delete step')
  }

  return reasons
}

async function compareSince($: Dollar, apply: PlanRun, baseline: PlanRun): Promise<PlanSince> {
  if (!baseline.git.isAvailable) {
    return { baselineHead: '', isAncestor: false, reason: 'the baseline run has no git record' }
  }
  const baselineHead = baseline.git.head
  if (!apply.git.isAvailable) {
    return { baselineHead, isAncestor: false, reason: 'the apply run has no git record' }
  }
  if (baselineHead === apply.git.head) {
    return { baselineHead, isAncestor: false, reason: 'the baseline is the same commit as the apply run, not a pre-merge commit' }
  }
  try {
    const git = (...args: string[]) => $.process.run(['git', '-C', apply.worktree, ...args], { timeoutMs: 30000 })
    const ancestor = await git('merge-base', '--is-ancestor', baselineHead, apply.git.head)
    if (ancestor.exitCode === 1) {
      return {
        baselineHead,
        isAncestor: false,
        reason: `the baseline commit ${shortSha(baselineHead)} is not an ancestor of the apply run's ${shortSha(apply.git.head)}`,
      }
    }
    if (ancestor.exitCode !== 0) {
      return { baselineHead, isAncestor: false, reason: `git merge-base failed: ${ancestor.stderr.trim() || `exit ${ancestor.exitCode}`}` }
    }
    const log = await git('log', '--first-parent', '--format=%H%x09%s', `${baselineHead}..${apply.git.head}`)
    if (log.exitCode !== 0) {
      return { baselineHead, isAncestor: false, reason: `git log failed: ${log.stderr.trim() || `exit ${log.exitCode}`}` }
    }
    const commits = log.stdout
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => {
        const tab = line.indexOf('\t')

        return tab < 0 ? { sha: line.trim(), subject: '' } : { sha: line.slice(0, tab), subject: line.slice(tab + 1) }
      })

    return {
      baselineHead,
      isAncestor: true,
      commits: commits.slice(0, SINCE_LIMIT),
      ...(commits.length > SINCE_LIMIT ? { more: commits.length - SINCE_LIMIT } : {}),
    }
  } catch (error) {
    return { baselineHead, isAncestor: false, reason: `git failed in ${apply.worktree}: ${message(error)}` }
  }
}

async function linkSince($: Dollar, project: string, stack: string): Promise<PlanRun[]> {
  const list = await read($, runs)
  const apply = list.find(r => r.role === 'apply' && r.project === project && r.stack === stack)
  const baseline = list.find(r => r.role === 'baseline' && r.project === project && r.stack === stack)
  if (!apply || !baseline) {
    return list
  }
  const since = await compareSince($, apply, baseline)

  return update($, runs, current =>
    current.map(r =>
      r.role === 'apply' && r.runId === apply.runId && r.registeredAt === apply.registeredAt ? { ...r, since } : r,
    ),
  )
}

async function buildRun($: Dollar, preview: Preview, args: RunArgs): Promise<PlanRun> {
  const { steps, sameCount } = buildSteps(preview.steps)
  const run: PlanRun = {
    role: args.role,
    label: args.label,
    ...(args.risk === undefined ? {} : { risk: args.risk }),
    ...(args.riskReason ? { riskReason: args.riskReason } : {}),
    project: args.project,
    stack: args.stack,
    previewPath: args.previewPath,
    worktree: args.worktree,
    registeredAt: await $.clock.now(),
    durationSec: preview.duration === null ? null : preview.duration / 1e9,
    changeSummary: preview.changeSummary,
    git: await readGit($, args.worktree),
    steps,
    diagnostics: buildDiagnostics(preview.diagnostics),
    sameCount,
  }
  if (args.role === 'apply') {
    run.runId = crypto.randomUUID()
    run.projectDir = args.projectDir ?? ''
    if (args.targets && args.targets.length > 0) {
      run.targets = args.targets
    }
    const blockers = await applyBlockers($, run)
    if (blockers.length > 0) {
      run.applyBlocked = blockers.join('; ')
    }
  }

  return run
}

function countsLine(run: PlanRun): string {
  const counts = countSteps(run.steps)
  const parts = (['create', 'update', 'replace', 'delete', 'other'] as const)
    .filter(category => counts[category] > 0)
    .map(category => `${category} ${counts[category]}`)

  return parts.length > 0 ? parts.join(', ') : 'no changes'
}

type ApplyScope = { isChangeOnly: boolean; targets: string[] | undefined; steps: PlanStep[] }

function offeredChange(list: readonly PlanRun[], run: PlanRun): { steps: PlanStep[]; targets: string[] } | null {
  const card = buildCards(list).find(c => c.isApply && c.run.runId === run.runId && c.run.registeredAt === run.registeredAt)
  const offer = card ? changeOnly(card) : null

  return offer !== null && 'targets' in offer ? offer : null
}

function answer(run: PlanRun, baseline: PlanRun | undefined, apply: PlanRun | undefined): string {
  const git = gitLine(run.git)
  const lines = [
    `Registered ${run.project}/${run.stack} as ${run.role}${run.label ? ` "${run.label}"` : ''}.`,
    `git: ${git.text}${git.dirty ? ` · ${git.dirty}` : ''}`,
    `steps: ${countsLine(run)}`,
    run.risk
      ? `risk: ${run.risk} (${RISKS[run.risk].meaning})${run.riskReason ? ` · ${run.riskReason}` : ''}`
      : 'risk: not set; register again with risk (low, medium or high) so the card shows it.',
  ]
  if (run.role === 'branch') {
    if (baseline) {
      const comparison = compare(run, baseline)
      const change = CHANGE_CATEGORIES.map(c => `${c} ${comparison.change[c].length}`).join(', ')
      lines.push(
        `change: ${change}; drift ${driftCount(comparison)}; baseline only ${comparison.baselineOnly.length}; new diagnostics ${comparison.newDiagnostics.length}`,
      )
    } else {
      lines.push('No baseline registered for this project/stack: drift is not separated.')
    }
  }
  if (run.role === 'apply') {
    const pair = preMergeBaseline(run, baseline)
    const comparison = compare(run, pair.baseline)
    const offer = changeOnly({ id: runKey(run), run, baseline: pair.baseline, isBaselineOnly: false, isApply: true, comparison })
    if (pair.baseline) {
      const change = CHANGE_CATEGORIES.map(c => `${c} ${comparison.change[c].length}`).join(', ')
      const commits = (run.since?.commits?.length ?? 0) + (run.since?.more ?? 0)
      lines.push(
        `Paired with the pre-merge baseline at ${shortSha(pair.baseline.git.isAvailable ? pair.baseline.git.head : '')} (${commits} commit${commits === 1 ? '' : 's'} on main since): this change ${change}; drift already pending that the apply also runs ${driftCount(comparison)}; no longer pending ${comparison.baselineOnly.length}.`,
      )
    } else {
      lines.push(`No pre-merge baseline paired (${pair.reason ?? 'unknown'}): change and drift are not separated.`)
    }
    if (run.applyBlocked) {
      lines.push(`Apply blocked: ${run.applyBlocked}. No Approve button is offered.`)
    } else if (offer !== null && 'targets' in offer) {
      const steps = changeCount(run)
      const drift = driftCount(comparison)
      lines.push(
        `Apply eligible: the card offers the user two buttons, Approve all (${plural(steps, 'step')}, drift included) and Approve change only (${plural(offer.steps.length, 'step')} via --target, ${plural(drift, 'drift step')} left pending). Do not call ${APPLY} until the user says which one they pressed.`,
      )
    } else {
      lines.push(
        `Apply eligible: the card offers the user an Approve button. Do not call ${APPLY} until the user says they pressed it.${offer === null ? '' : ` Change only is not offered: ${offer.blocked}.`}`,
      )
    }
  }
  if (run.role === 'baseline' && apply) {
    const pair = preMergeBaseline(apply, run)
    lines.push(
      pair.baseline
        ? `Paired as the pre-merge baseline of the ${run.project}/${run.stack} apply run.`
        : `Not used as the pre-merge baseline of the ${run.project}/${run.stack} apply run: ${pair.reason ?? 'unknown'}.`,
    )
  }
  lines.push('Shown in the Pulumi plan pane.')

  return lines.join('\n')
}

function formatTime(ms: number): string {
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC`
}

async function readTail($: Dollar, jobDir: string, lines = 60): Promise<string> {
  try {
    const ran = await $.process.run(['tail', '-n', String(lines), `${jobDir}/up.log`], { timeoutMs: 15000 })

    return ran.exitCode === 0 ? logTail(ran.stdout) : ''
  } catch {
    return ''
  }
}

async function readExitCode($: Dollar, jobDir: string): Promise<number | null> {
  try {
    if (!(await $.fs.exists(`${jobDir}/up.exit`))) {
      return null
    }
    const raw = await $.fs.read(`${jobDir}/up.exit`)
    const code = Number.parseInt(typeof raw === 'string' ? raw.trim() : '', 10)

    return Number.isFinite(code) ? code : 1
  } catch {
    return null
  }
}

async function refreshJob($: Dollar, key: string): Promise<PlanJob | undefined> {
  const job = (await read($, jobs))[key]
  if (!job || job.status !== 'running' || job.jobDir === undefined) {
    return job
  }
  const jobDir = job.jobDir
  const [tail, exitCode] = await Promise.all([readTail($, jobDir), readExitCode($, jobDir)])
  if (exitCode === null && tail === (job.tail ?? '')) {
    return job
  }
  const now = await $.clock.now()
  const stored = await update($, jobs, record => {
    const current = record[key]
    if (!current || current.status !== 'running' || current.jobDir !== jobDir) {
      return record
    }
    const next: PlanJob =
      exitCode === null
        ? { ...current, tail }
        : { ...current, tail, exitCode, endedAt: now, status: exitCode === 0 ? 'succeeded' : 'failed' }

    return { ...record, [key]: next }
  })

  return stored[key]
}

async function pollJobs($: Dollar, timer: Timer): Promise<void> {
  const all = await read($, jobs)
  const running = Object.keys(all).filter(key => all[key]?.status === 'running')
  if (running.length === 0) {
    timer.cancel()
    if (poll === timer) {
      poll = undefined
    }

    return
  }
  for (const key of running) {
    await refreshJob($, key)
  }
}

function startPolling($: Dollar): void {
  poll?.cancel()
  const timer: Timer = $.clock.every(POLL_MS, () => {
    void pollJobs($, timer)
  })
  poll = timer
}

async function clearAll($: Dollar): Promise<string[]> {
  const current = await read($, jobs)
  const busy = Object.keys(current).filter(key => isBusy(current[key]))
  await update($, runs, list => list.filter(run => run.role === 'apply' && busy.includes(stackKey(run))))
  await update($, approvals, () => ({}))
  await update($, jobs, record => Object.fromEntries(Object.entries(record).filter(([, job]) => isBusy(job))))

  return busy
}

async function waitForJob($: Dollar, key: string, jobDir: string): Promise<PlanJob | undefined> {
  try {
    await $.process.run(waitArgv(`${jobDir}/up.exit`, WAIT_SECONDS), { timeoutMs: 600000 })
  } catch {
    // The apply goes on detached; the state below says where it stands.
  }

  return refreshJob($, key)
}

function describeJob(key: string, job: PlanJob | undefined, now: number): string {
  if (!job) {
    return `No apply job for ${key} in this session.`
  }
  const scope = job.scope === 'change' ? ` (change only, ${plural(job.targets?.length ?? 0, 'target')})` : ''
  if (job.status === 'refused') {
    return `The last apply for ${key}${scope} was refused: ${job.reason ?? 'no reason recorded'}`
  }
  if (job.status === 'previewing') {
    return `The apply for ${key}${scope} is still re-previewing (started ${hhmm(job.startedAt)}); pulumi up has not started.`
  }
  const lines: string[] = []
  if (job.status === 'running') {
    lines.push(
      `pulumi up for ${key}${scope} is still running (started ${hhmm(job.startedAt)}, ${Math.round((now - job.startedAt) / 1000)}s ago). Call ${APPLY_STATUS} with this project and stack to wait again.`,
    )
  } else {
    const seconds = Math.round(((job.endedAt ?? now) - job.startedAt) / 1000)
    lines.push(`pulumi up for ${key}${scope} ${job.status === 'succeeded' ? 'succeeded' : 'failed'}: exit ${job.exitCode ?? '?'} after ${seconds}s.`)
  }
  if (job.status === 'succeeded' && job.scope === 'change') {
    lines.push(`The pending drift was not applied; applying it needs a new apply preview registered with ${TOOL} role "apply".`)
  }
  if (job.jobDir) {
    lines.push(`Job folder: ${job.jobDir} (preview.json, run.sh, up.log, up.exit).`)
  }
  lines.push(
    `An interrupted wait does not stop the apply: pulumi runs detached and writes ${job.jobDir ?? 'the job folder'}/up.log and up.exit.`,
  )
  if (job.tail) {
    lines.push('Last log lines:', job.tail)
  }

  return lines.join('\n')
}

async function refuseJob($: Dollar, key: string, reason: string): Promise<void> {
  const now = await $.clock.now()
  await update($, jobs, (record): Record<string, PlanJob> => {
    const current = record[key]

    return current ? { ...record, [key]: { ...current, status: 'refused', reason, endedAt: now } } : record
  })
}

async function launch($: Dollar, run: PlanRun, key: string, now: number, scope: ApplyScope): Promise<ToolCallResult> {
  const refuse = async (reason: string): Promise<ToolCallResult> => {
    await refuseJob($, key, reason)

    return { deny: `${APPLY}: ${reason} Nothing was applied. The approval was used up; a new press is needed for another try.` }
  }
  const projectDir = run.projectDir ?? ''
  const git = async (...args: string[]) => $.process.run(['git', '-C', run.worktree, ...args], { timeoutMs: 120000 })

  const status = await git('status', '--porcelain')
  if (status.exitCode !== 0) {
    return refuse(`checkout changed: git status failed in ${run.worktree}: ${status.stderr.trim()}. A new preview is needed.`)
  }
  if (status.stdout.trim() !== '') {
    return refuse('checkout changed: the worktree has uncommitted files. A new preview from a clean origin/main checkout is needed.')
  }
  const fetched = await git('fetch', 'origin', 'main')
  if (fetched.exitCode !== 0) {
    return refuse(`git fetch origin main failed: ${fetched.stderr.trim()}`)
  }
  const origin = (await git('rev-parse', 'origin/main')).stdout.trim()
  const head = (await git('rev-parse', 'HEAD')).stdout.trim()
  if (origin === '' || origin !== head) {
    return refuse(
      `origin/main moved: it is now ${shortSha(origin)}, the checkout is at ${shortSha(head)}. A new preview at origin/main is needed.`,
    )
  }
  if (!run.git.isAvailable || head !== run.git.head) {
    return refuse(
      `checkout changed: HEAD is ${shortSha(head)}, the preview ran at ${run.git.isAvailable ? shortSha(run.git.head) : 'an unknown commit'}. A new preview is needed.`,
    )
  }

  const home = await $.env.get('HOME')
  if (!home) {
    return refuse('HOME is not set, so the job folder cannot be made.')
  }
  const jobDir = `${home}/.claude/pulumi-plan/jobs/${jobFolderName(now, run.project, run.stack)}`
  await update($, jobs, record => {
    const current = record[key]

    return current ? { ...record, [key]: { ...current, jobDir } } : record
  })

  const preview = await $.process.run(previewArgv(run.stack, scope.targets), { cwd: projectDir, timeoutMs: 600000 })
  await $.fs.write(`${jobDir}/preview.json`, preview.stdout)
  if (preview.isStdoutTruncated) {
    return refuse('the re-preview printed more than 4 MiB of JSON, which cannot be compared.')
  }
  if (preview.exitCode !== 0) {
    return refuse(`the re-preview exited ${preview.exitCode}: ${logTail(preview.stderr, 20, 1500)}`)
  }
  let parsed: Preview
  try {
    parsed = parsePreview(preview.stdout)
  } catch (error) {
    return refuse(`the re-preview output is not a preview: ${message(error)}`)
  }
  const errors = parsed.diagnostics.filter(d => d.severity === 'error')
  if (errors.length > 0) {
    return refuse(`the re-preview reported ${errors.length} error diagnostic${errors.length === 1 ? '' : 's'}.`)
  }
  const fresh = buildSteps(parsed.steps).steps
  const difference = stepSetDiff(scope.steps, fresh)
  const changed = `${difference.added} new or changed step${difference.added === 1 ? '' : 's'}, ${difference.removed} no longer present`
  if ((difference.added > 0 || difference.removed > 0) && scope.isChangeOnly) {
    return refuse(
      `the targeted re-preview differs from the approved change steps (${changed}); it is in ${jobDir}/preview.json. The stored apply preview is unchanged; register a fresh apply preview with ${TOOL} role "apply" for the user to review and approve again.`,
    )
  }
  if (difference.added > 0 || difference.removed > 0) {
    const freshRun = await buildRun($, parsed, {
      role: 'apply',
      label: '',
      project: run.project,
      stack: run.stack,
      previewPath: `${jobDir}/preview.json`,
      worktree: run.worktree,
      projectDir,
      ...(run.targets ? { targets: run.targets } : {}),
    })
    await update($, runs, list => upsertRun(list, freshRun))
    await linkSince($, run.project, run.stack)

    return refuse(
      `the re-preview differs from the approved preview (${changed}). The ${key} apply card now shows the fresh preview; the user must review it and approve again.`,
    )
  }

  const scriptPath = `${jobDir}/run.sh`
  await $.fs.write(scriptPath, runScript(projectDir, jobDir, run.stack, scope.targets))
  const started = await $.process.run(launchArgv(scriptPath), { cwd: projectDir, timeoutMs: 60000 })
  if (started.exitCode !== 0) {
    return refuse(`the launcher exited ${started.exitCode}: ${logTail(started.stderr, 20, 1500)}`)
  }
  const startedAt = await $.clock.now()
  await update($, jobs, (record): Record<string, PlanJob> => {
    const current = record[key]

    return current ? { ...record, [key]: { ...current, status: 'running', startedAt, jobDir } } : record
  })
  startPolling($)

  const job = await waitForJob($, key, jobDir)

  return { result: describeJob(key, job, await $.clock.now()) }
}

async function runApply($: Dollar, input: Record<string, unknown>): Promise<ToolCallResult> {
  const project = text(input.project)
  const stack = text(input.stack)
  if (!STACK_PATTERN.test(stack)) {
    return { deny: `${APPLY}: stack name "${stack}" is refused; it must match ${STACK_PATTERN}.` }
  }
  const key = `${project}/${stack}`
  const run = (await read($, runs)).find(r => r.role === 'apply' && r.project === project && r.stack === stack)
  if (!run || run.runId === undefined || run.projectDir === undefined) {
    return {
      deny: `${APPLY}: no apply preview is registered for ${key}. Run the preview from a clean origin/main checkout and register it with ${TOOL} role "apply" first.`,
    }
  }
  if (run.applyBlocked) {
    return { deny: `${APPLY}: the apply preview for ${key} is not eligible: ${run.applyBlocked}.` }
  }
  if (isBusy((await read($, jobs))[key])) {
    return { deny: `${APPLY}: an apply job for ${key} is already running; use ${APPLY_STATUS}.` }
  }
  const now = await $.clock.now()
  const approval = (await read($, approvals))[key]
  const problem = approvalProblem(approval, run, now)
  if (problem !== null) {
    return { deny: `${APPLY}: ${problem} ${PRESS_HINT}` }
  }
  const isChangeOnly = approval?.scope === 'change'
  const approvedTargets = approval?.targets ?? []
  const offer = isChangeOnly ? offeredChange(await read($, runs), run) : null
  if (isChangeOnly && (offer === null || !sameTargets(offer.targets, approvedTargets))) {
    return {
      deny: `${APPLY}: the change set of ${key} moved since "Approve change only" was pressed (a baseline or apply preview was registered again), so that approval no longer matches the card. ${PRESS_HINT}`,
    }
  }
  const scope: ApplyScope =
    isChangeOnly && offer !== null
      ? { isChangeOnly: true, targets: approvedTargets, steps: offer.steps }
      : { isChangeOnly: false, targets: run.targets, steps: run.steps }

  const outcome = { isConsumed: false, isClaimed: false }
  await update($, approvals, record => {
    const stored = record[key]
    outcome.isConsumed =
      approvalProblem(stored, run, now) === null &&
      (stored?.scope === 'change') === isChangeOnly &&
      sameTargets(stored?.targets ?? [], approvedTargets)

    return outcome.isConsumed ? omit(record, key) : record
  })
  if (!outcome.isConsumed) {
    return { deny: `${APPLY}: the approval for ${key} changed while it was checked. ${PRESS_HINT}` }
  }
  const runId = run.runId
  await update($, jobs, (record): Record<string, PlanJob> => {
    outcome.isClaimed = !isBusy(record[key])

    return outcome.isClaimed
      ? {
          ...record,
          [key]: {
            status: 'previewing',
            runId,
            startedAt: now,
            ...(scope.isChangeOnly ? { scope: 'change' as const, targets: approvedTargets } : {}),
          },
        }
      : record
  })
  if (!outcome.isClaimed) {
    return { deny: `${APPLY}: another apply for ${key} started meanwhile; the approval was used up.` }
  }

  try {
    return await launch($, run, key, now, scope)
  } catch (error) {
    const reason = `the apply tool failed: ${message(error)}`
    const ended = await $.clock.now()
    await update($, jobs, (record): Record<string, PlanJob> => {
      const current = record[key]

      return current?.status === 'previewing'
        ? { ...record, [key]: { ...current, status: 'refused', reason, endedAt: ended } }
        : record
    })

    return { deny: `${APPLY}: ${reason}. Check the job folder under ~/.claude/pulumi-plan/jobs and ${APPLY_STATUS} before trying again.` }
  }
}

async function applyStatus($: Dollar, input: Record<string, unknown>): Promise<ToolCallResult> {
  const key = `${text(input.project)}/${text(input.stack)}`
  let job = (await read($, jobs))[key]
  if (job?.status === 'running' && job.jobDir !== undefined) {
    job = await waitForJob($, key, job.jobDir)
  }

  return { result: describeJob(key, job, await $.clock.now()) }
}

async function loadTheme($: Dollar): Promise<ThemeLoad> {
  let home: string | undefined
  try {
    home = await $.env.get('HOME')
  } catch {
    home = undefined
  }
  if (!home) {
    return { theme: { colors: {} }, problems: [], path: null, isFound: false }
  }
  const path = `${home}/${THEME_FILE}`
  try {
    if (!(await $.fs.exists(path))) {
      return { theme: { colors: {} }, problems: [], path, isFound: false }
    }
    const raw = await $.fs.read(path)

    return { ...parseTheme(typeof raw === 'string' ? raw : ''), path, isFound: true }
  } catch (error) {
    return { theme: { colors: {} }, problems: [`cannot read ${path}: ${message(error)}`], path, isFound: true }
  }
}

async function refreshTheme($: Dollar): Promise<ThemeLoad> {
  const load = await loadTheme($)
  await update($, overrides, () => load.theme)

  return load
}

async function openPane($: Dollar): Promise<void> {
  const { palette } = resolveTheme(await read($, overrides))
  await $.ui.open({ id: PANE, title: 'Pulumi plan', backgroundColor: palette.paper })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'show',
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'apply',
      description: APPLY_DESCRIPTION,
      inputSchema: STACK_INPUT_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'apply_status',
      description: STATUS_DESCRIPTION,
      inputSchema: STACK_INPUT_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({
      name: 'pulumi-plan',
      description: 'Open the Pulumi plan pane; `/pulumi-plan clear` empties it, `/pulumi-plan theme` reloads its theme file, `/pulumi-plan theme list` lists the bundled themes',
      argumentHint: '[clear|theme|theme list]',
    })
    try {
      const load = await refreshTheme($)
      if (load.path !== null && load.problems.length > 0) {
        $.ui.toast(`The theme file ${load.path} has ${plural(load.problems.length, 'problem')}; /pulumi-plan theme lists them.`)
      }
    } catch {
      // The pane keeps the default look.
    }
    const now = await $.clock.now()
    const stored = await update($, jobs, record =>
      Object.fromEntries(
        Object.entries(record).map(([key, job]) => [
          key,
          job.status === 'previewing'
            ? { ...job, status: 'refused' as const, endedAt: now, reason: 'interrupted before pulumi up was launched' }
            : job,
        ]),
      ),
    )
    if (Object.values(stored).some(job => job.status === 'running')) {
      startPolling($)
    }

    return next(e)
  })

  on('command.run', { command: 'pulumi-plan' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'clear') {
      const kept = await clearAll($)

      return {
        text:
          kept.length > 0
            ? `Pulumi plan pane cleared, except the running apply job${kept.length === 1 ? '' : 's'} for ${kept.join(', ')}.`
            : 'Pulumi plan pane cleared.',
      }
    }
    if (args === 'theme list') {
      const load = await refreshTheme($)

      return { text: describePresets(load.theme.preset) }
    }
    if (args === 'theme') {
      const load = await refreshTheme($)
      if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
        await openPane($)
      }

      return { text: describeTheme(load) }
    }
    await openPane($)

    return { text: 'Pulumi plan pane opened.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e): Promise<ToolCallResult> => {
    const input = e as unknown as Record<string, unknown>
    const previewPath = text(input.previewJson)
    const worktree = text(input.worktree)
    const role = text(input.role)
    const label = text(input.label)
    const risk = text(input.risk)
    const riskReason = cleanText(text(input.riskReason)).replace(/\s+/g, ' ').trim()
    const givenStack = text(input.stack)
    const givenProject = text(input.project)
    const projectDir = text(input.projectDir)
    const targets = Array.isArray(input.targets) ? input.targets : []
    if (!isAbsolute(previewPath) || !isAbsolute(worktree)) {
      return { deny: `${TOOL}: previewJson and worktree must be absolute paths.` }
    }
    if (role !== 'baseline' && role !== 'branch' && role !== 'apply') {
      return { deny: `${TOOL}: role must be "baseline", "branch" or "apply".` }
    }
    if (role === 'branch' && label === '') {
      return { deny: `${TOOL}: label is required for a branch run.` }
    }
    if (risk !== '' && !Object.hasOwn(RISKS, risk)) {
      return { deny: `${TOOL}: risk must be "low", "medium" or "high".` }
    }
    if (riskReason.length > RISK_REASON_LIMIT) {
      return { deny: `${TOOL}: riskReason must be at most ${RISK_REASON_LIMIT} characters.` }
    }
    if (role === 'apply') {
      if (!isAbsolute(projectDir) || hasControl(projectDir)) {
        return { deny: `${TOOL}: projectDir is required for an apply run and must be an absolute path.` }
      }
      if (!targets.every(target => typeof target === 'string' && target.startsWith('urn:pulumi:') && !hasControl(target))) {
        return { deny: `${TOOL}: targets must be a list of Pulumi URNs.` }
      }
    }

    let raw: string
    try {
      const read = await $.fs.read(previewPath)
      raw = typeof read === 'string' ? read : ''
    } catch (error) {
      return { deny: `${TOOL}: ${await readFailure($, previewPath, error)}` }
    }

    let preview: Preview
    try {
      preview = parsePreview(raw)
    } catch (error) {
      return { deny: `${TOOL}: ${previewPath} is not a preview: ${message(error)}` }
    }

    const derived = deriveTarget(preview.steps)
    if (derived) {
      const conflicts = [
        givenStack !== '' && givenStack !== derived.stack ? `stack "${givenStack}" but the URNs say "${derived.stack}"` : '',
        givenProject !== '' && givenProject !== derived.project
          ? `project "${givenProject}" but the URNs say "${derived.project}"`
          : '',
      ].filter(c => c !== '')
      if (conflicts.length > 0) {
        return { deny: `${TOOL}: given ${conflicts.join(' and ')}.` }
      }
    } else if (givenStack === '' || givenProject === '') {
      return { deny: `${TOOL}: the preview has no steps to derive the stack and project from; pass stack and project.` }
    }
    const project = derived?.project ?? givenProject
    const stack = derived?.stack ?? givenStack
    const prefix = `urn:pulumi:${stack}::${project}::`
    const foreign = (targets as string[]).filter(target => !target.startsWith(prefix))
    if (role === 'apply' && foreign.length > 0) {
      return { deny: `${TOOL}: every target must be a URN of ${project}/${stack}; ${foreign.length} is not.` }
    }

    const run = await buildRun($, preview, {
      role,
      label,
      ...(risk === '' ? {} : { risk: risk as PlanRisk }),
      riskReason,
      project,
      stack,
      previewPath,
      worktree,
      ...(role === 'apply' ? { projectDir, targets: targets as string[] } : {}),
    })
    let stored = await update($, runs, list => upsertRun(list, run))
    if (role === 'apply') {
      const key = stackKey(run)
      await update($, jobs, record => (isBusy(record[key]) ? record : omit(record, key)))
    }
    if (role === 'apply' || role === 'baseline') {
      stored = await linkSince($, project, stack)
    }
    await openPane($)
    const sameStack = (r: PlanRun) => r.project === project && r.stack === stack
    const baseline = stored.find(r => r.role === 'baseline' && sameStack(r))
    const apply = stored.find(r => r.role === 'apply' && sameStack(r))
    const current = role === 'apply' ? (apply ?? run) : run

    return { result: answer(current, baseline, apply) }
  }).catch(($, e, next) => ({
    deny: `${TOOL} failed: ${next.error.message ?? next.error.kind}`,
  }))

  on('tool.call', { tool: APPLY }, async ($, e): Promise<ToolCallResult> =>
    runApply($, e as unknown as Record<string, unknown>),
  ).catch(($, e, next) => ({
    deny: `${APPLY} failed: ${next.error.message ?? next.error.kind}. If it had started, check the job folder under ~/.claude/pulumi-plan/jobs before trying again.`,
  }))

  on('tool.call', { tool: APPLY_STATUS }, async ($, e): Promise<ToolCallResult> =>
    applyStatus($, e as unknown as Record<string, unknown>),
  ).catch(($, e, next) => ({
    deny: `${APPLY_STATUS} failed: ${next.error.message ?? next.error.kind}`,
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const isTerminal = e.surface === 'terminal'
    const theme = resolveTheme(await read($, overrides))
    const P = theme.palette
    const all = await read($, runs)
    const approvalsNow = await read($, approvals)
    const jobsNow = await read($, jobs)
    const now = await $.clock.now()
    const isOpen = (id: string, initial: boolean) => read($, atom({ ...OPEN, id }, initial))
    const toggle = (id: string, initial: boolean) => () => update($, atom({ ...OPEN, id }, initial), value => !value)
    const glyph = (open: boolean) => (open ? '−' : '+')
    type Size = 'caption' | 'footnote' | 'body' | 'heading' | 'title'

    const chip = (text: string, fill: string, ink: string = P.ink) => {
      if (!isTerminal && 'Svg' in table) {
        const Svg = table.Svg
        const svg = chipSvg(text, fill, ink, theme)

        return <Svg source={svg.source} alt={svg.alt} width={svg.width} height={svg.height} />
      }

      return (
        <Text color={ink} backgroundColor={fill} mono size="caption" weight="medium">
          {` ${text.toUpperCase()} `}
        </Text>
      )
    }

    const titleBar = (content: RenderChildren, hoverKey?: string) => (
      <Box
        {...(hoverKey === undefined ? {} : { key: `${hoverKey}|bar`, hover: { backgroundColor: pillHoverFill(P.pillCard, P.ink) } })}
        flexDirection="row"
        backgroundColor={P.pillCard}
        paddingX={1}
        paddingY="xs"
      >
        {content}
      </Box>
    )

    const cardFrame = (bar: RenderChildren, body: RenderChildren) => (
      <Box backgroundColor={P.ink} padding="xs">
        <Box flexDirection="column" backgroundColor={P.card} flexGrow={1}>
          {bar}
          <Box flexDirection="column" padding={1} gap={1}>
            {body}
          </Box>
        </Box>
      </Box>
    )

    const callout = (bar: string, body: string, children: RenderChildren) => (
      <Box backgroundColor={bar} paddingLeft="xs">
        <Box backgroundColor={body} padding={1} flexDirection="column" gap={1} flexGrow={1}>
          {children}
        </Box>
      </Box>
    )

    const chipRow = (chips: RenderChildren) => (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {chips}
      </Box>
    )

    const pill = (key: string, caption: string, onPress: () => unknown, fill: PillKey, size: Size = 'caption') => (
      <Box
        key={`${key}|pill`}
        backgroundColor={P[fill]}
        hover={{ backgroundColor: pillHoverFill(P[fill], P.ink) }}
        paddingX={1}
        flexShrink={0}
        alignSelf="flex-start"
      >
        <Button key={key} plain hover={{ underline: true }} onPress={onPress}>
          <Text color={P.onAccent} mono size={size} weight="bold">
            {caption}
          </Text>
        </Button>
      </Box>
    )

    const toggleRow = (key: string, caption: string, initial: boolean, fill: PillKey, beside: RenderChildren, size: Size = 'caption') => (
      <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
        {pill(key, caption, toggle(key, initial), fill, size)}
        {beside}
      </Box>
    )

    const value = (text: string, color: string = P.ink, size: Size = 'body') => (
      <Text color={color} mono size={size}>
        {text}
      </Text>
    )

    const metaRow = (name: string, content: RenderChildren) => (
      <Box flexDirection="row">
        <Box flexShrink={0}>
          <Text color={P.faint} mono size="caption">
            {metaLabel(name)}
          </Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={1}>
          {content}
        </Box>
      </Box>
    )

    const notice = (title: string, detail?: string) =>
      callout(P.warnInk, P.warning, [
        <Text color={P.warnInk} mono size="caption" weight="bold">
          {title.toUpperCase()}
        </Text>,
        detail !== undefined && value(detail, P.ink, 'caption'),
      ])

    const logBlock = (text: string) => (
      <Box backgroundColor={P.logBg} paddingX={1}>
        <Text color={P.logInk} mono size="caption">
          {text}
        </Text>
      </Box>
    )

    const kindFill = (kind: string) =>
      kind.startsWith('add')
        ? P.create
        : kind.startsWith('delete')
          ? P.delete
          : kind.endsWith('replace')
            ? P.replace
            : P.update

    const diffBlock = (text: string, sign: '-' | '+') => (
      <Box backgroundColor={sign === '-' ? P.removedBg : P.addedBg} paddingX={1}>
        <Text color={sign === '-' ? P.removedInk : P.addedInk} mono size="caption">
          {cleanText(text)
            .split('\n')
            .map(line => `${sign} ${line}`)
            .join('\n')}
        </Text>
      </Box>
    )

    const drawProp = (prop: PlanProp) => {
      const isAdd = prop.kind.startsWith('add')
      const isDelete = prop.kind.startsWith('delete')
      const missing = [
        prop.old === undefined && !isAdd ? 'old value not in the preview state' : '',
        prop.new === undefined && !isDelete ? 'new value not in the preview inputs' : '',
      ].filter(m => m !== '')

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Text color={P.ink} mono weight="semibold">
              {cleanText(prop.path)}
            </Text>
            {chip(prop.kind, kindFill(prop.kind))}
          </Box>
          {prop.old !== undefined && diffBlock(prop.old, '-')}
          {prop.new !== undefined && diffBlock(prop.new, '+')}
          {missing.length > 0 && value(`(${missing.join('; ')})`, P.faint, 'caption')}
        </Box>
      )
    }

    const drawRow = async (groupId: string, entry: Entry, isMuted: boolean) => {
      const { step, tags } = entry
      const id = `${groupId}|${step.urn}`
      const open = await isOpen(id, false)
      const preview = rowPreview(step)
      const header = toggleRow(id, `${glyph(open)} ${cleanText(step.name)}`, false, 'pillNeutral', [
        <Text color={isMuted ? P.faint : P.muted} mono size="caption">
          {step.type}
        </Text>,
        preview !== '' && (
          <Text color={P.faint} mono size="caption">
            {cleanText(preview)}
          </Text>
        ),
        ...tags.map(tag => chip(tag, P.warning)),
      ])
      if (!open) {
        return header
      }

      return (
        <Box flexDirection="column">
          {header}
          <Box marginLeft={2}>
            {callout(P.divider, P.panel, [
              metaRow('urn', value(cleanText(step.urn), P.faint, 'caption')),
              step.provider !== undefined && metaRow('provider', value(cleanText(step.provider), P.faint, 'caption')),
              step.ops.length > 1 && metaRow('ops', value(step.ops.join(', '), P.muted, 'caption')),
              step.diffReasons.length > 0 && metaRow('diff reasons', value(step.diffReasons.join(', '), P.muted, 'caption')),
              step.replaceReasons.length > 0 && metaRow('replace keys', value(step.replaceReasons.join(', '), P.muted, 'caption')),
              step.isOpaque &&
                notice(
                  'Opaque: content not comparable',
                  'Pulumi reports a change but the preview shows no differing inputs (secret or computed values); see Diagnostics.',
                ),
              ...step.props.map(drawProp),
              step.propsOverflow > 0 && value(`${step.propsOverflow} more properties not kept`, P.faint, 'caption'),
            ])}
          </Box>
        </Box>
      )
    }

    const drawEntries = async (groupId: string, entries: readonly Entry[], isMuted: boolean) => {
      const moreId = `${groupId}|more`
      const showAll = await isOpen(moreId, false)
      const visible = showAll ? entries : entries.slice(0, ROW_LIMIT)
      const rows = await Promise.all(visible.map(entry => drawRow(groupId, entry, isMuted)))

      return (
        <Box flexDirection="column" rowGap="xs">
          {rows}
          {!showAll && entries.length > ROW_LIMIT && (
            pill(moreId, `SHOW ${entries.length - ROW_LIMIT} MORE`, toggle(moreId, false), 'pillNeutral')
          )}
        </Box>
      )
    }

    const severityFill = (severity: string) =>
      severity === 'error' ? P.replace : severity === 'warning' ? P.warning : P.info

    const drawDiagnostics = (diagnostics: readonly PlanDiagnostic[]) => (
      <Box flexDirection="column" rowGap="xs">
        {diagnostics.map(d => {
          const urn = d.urn ? parseUrn(d.urn) : null

          return (
            <Box flexDirection="row" gap={1}>
              {chip(d.severity, severityFill(d.severity))}
              <Box flexShrink={1}>
                <Text color={P.ink} mono size="caption">
                  {`${urn ? `${urn.type} ${cleanText(urn.name)}: ` : ''}${cleanText(d.message).trim()}`}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const subGroup = (title: string, count: number, fill: string, body: RenderChildren) => (
      <Box flexDirection="column">
        <Text color={P.faint} mono size="caption" weight="bold">
          {`${title.toUpperCase()} `}
          <Text color={P.ink} backgroundColor={fill} mono size="caption">
            {` ${count} `}
          </Text>
        </Text>
        {body}
      </Box>
    )

    const drawSection = async (
      id: string,
      title: string,
      count: number,
      fill: string,
      pillFill: PillKey,
      body: () => Promise<RenderChildren>,
      shownCount: number = count,
    ) => {
      if (count === 0) {
        return null
      }
      const open = await isOpen(id, false)

      return (
        <Box flexDirection="column" gap={1}>
          {toggleRow(
            id,
            `${glyph(open)} ${title.toUpperCase()}`,
            false,
            pillFill,
            chip(String(shownCount), fill),
          )}
          {open && (
            <Box flexDirection="column" paddingLeft={2} gap={1}>
              {await body()}
            </Box>
          )}
        </Box>
      )
    }

    const gitValue = (run: PlanRun): RenderChildren => {
      const line = gitLine(run.git)
      if (run.git.isAvailable) {
        return [value(line.text), line.dirty !== null && chip(line.dirty, P.warning, P.warnInk)]
      }
      if (run.role === 'apply') {
        return value(line.text, P.warnInk)
      }

      return value(`not recorded: ${run.worktree} was not a git checkout when this preview was registered`, P.muted)
    }

    const currentApplyRun = async (run: PlanRun) => {
      const current = (await read($, runs)).find(r => r.role === 'apply' && stackKey(r) === stackKey(run))
      if (!current || current.runId === undefined || current.runId !== run.runId || current.applyBlocked) {
        return null
      }

      return blocksApproval((await read($, jobs))[stackKey(current)], current) ? null : { ...current, runId: current.runId }
    }

    const approve = (run: PlanRun, scope?: 'change') => async () => {
      const current = await currentApplyRun(run)
      if (!current) {
        return
      }
      const offer = scope === 'change' ? offeredChange(await read($, runs), current) : null
      if (scope === 'change' && offer === null) {
        return
      }
      const at = await $.clock.now()
      const status = isProduction(current.stack) ? 'armed' : 'approved'
      await update($, approvals, (record): Record<string, PlanApproval> => ({
        ...record,
        [stackKey(current)]: {
          runId: current.runId,
          registeredAt: current.registeredAt,
          status,
          at,
          ...(offer === null ? {} : { scope: 'change' as const, targets: offer.targets }),
        },
      }))
    }

    const confirm = (run: PlanRun) => async () => {
      const current = await currentApplyRun(run)
      if (!current) {
        return
      }
      const at = await $.clock.now()
      const key = stackKey(current)
      await update($, approvals, (record): Record<string, PlanApproval> => {
        const armed = record[key]

        return armed?.status === 'armed' && armed.runId === current.runId
          ? { ...record, [key]: { ...armed, status: 'approved', at } }
          : record
      })
    }

    const withdraw = (run: PlanRun) => () => update($, approvals, record => omit(record, stackKey(run)))

    const drawJob = async (card: Card, job: PlanJob) => {
      const logId = `${card.id}|log`
      const isLogOpen = await isOpen(logId, false)
      const isFinished = job.status === 'succeeded' || job.status === 'failed'
      const tail = job.tail ?? ''

      return (
        <Box flexDirection="column" gap={1}>
          {chipRow([
            job.status === 'previewing' && chip(`re-previewing before the apply · started ${hhmm(job.startedAt)}`, P.warning, P.warnInk),
            job.status === 'running' && chip(`applying… started ${hhmm(job.startedAt)}`, P.warning, P.warnInk),
            job.status === 'succeeded' &&
              chip(`applied ${hhmm(job.endedAt ?? job.startedAt)}, exit ${job.exitCode ?? 0}`, P.ok, P.onAccent),
            job.status === 'failed' && chip(`apply failed, exit ${job.exitCode ?? '?'}`, P.danger, P.onAccent),
            job.status === 'refused' && chip('apply refused', P.danger, P.onAccent),
            job.scope === 'change' && chip(`change only, ${plural(job.targets?.length ?? 0, 'target')}`, P.accentSoft),
          ])}
          {job.status === 'refused' && value(job.reason ?? 'no reason recorded', P.dangerInk, 'caption')}
          {job.status === 'running' && tail !== '' && logBlock(tail.split('\n').slice(-PANE_TAIL_LINES).join('\n'))}
          {job.jobDir !== undefined && metaRow('job folder', value(job.jobDir, P.muted, 'caption'))}
          {isFinished && tail !== '' && (
            pill(logId, `${glyph(isLogOpen)} LOG`, toggle(logId, false), 'pillNeutral')
          )}
          {isFinished && tail !== '' && isLogOpen && logBlock(tail)}
        </Box>
      )
    }

    const approveCaption = (card: Card, verb = 'APPROVE APPLY') => {
      const { run, comparison } = card
      const steps = changeCount(run)
      const target = `${run.project}/${run.stack}`
      if (card.baseline) {
        const change = CHANGE_CATEGORIES.reduce((sum, category) => sum + comparison.change[category].length, 0)

        return `${verb} · ${steps} STEP${steps === 1 ? '' : 'S'} (${change} CHANGE + ${driftCount(comparison)} DRIFT) → ${target}`
      }

      return `${verb} · ${steps} STEP${steps === 1 ? '' : 'S'} → ${target}`
    }

    const changeCaption = (card: Card, offered: { steps: PlanStep[] }) => {
      const { run, comparison } = card
      const steps = offered.steps.length

      return `APPROVE CHANGE ONLY · ${steps} STEP${steps === 1 ? '' : 'S'} (${driftCount(comparison)} DRIFT LEFT PENDING) → ${run.project}/${run.stack}`
    }

    const drawApproval = (card: Card, offered: { steps: PlanStep[]; targets: string[] } | null) => {
      const { run } = card
      const key = stackKey(run)
      const approval = approvalsNow[key]
      const isBound =
        approval !== undefined &&
        approval.runId === run.runId &&
        approval.registeredAt === run.registeredAt &&
        (approval.scope !== 'change' || (offered !== null && sameTargets(offered.targets, approval.targets ?? [])))
      const isChangeOnly = isBound && approval.scope === 'change'
      const steps = changeCount(run)
      const drift = driftCount(card.comparison)
      const changeSteps = offered?.steps.length ?? 0
      if (isBound && approval.status === 'approved' && now - approval.at < APPROVAL_TTL_MS) {
        return chipRow([
          chip(
            isChangeOnly
              ? `approved ${hhmm(approval.at)}, change only (${plural(approval.targets?.length ?? 0, 'target')}), one apply, valid 15 min`
              : `approved ${hhmm(approval.at)}, one apply, valid 15 min`,
            P.ok,
            P.onAccent,
          ),
          pill(`${card.id}|revoke`, 'REVOKE', withdraw(run), 'pillNeutral'),
        ])
      }
      if (isBound && approval.status === 'armed') {
        return (
          callout(P.danger, P.removedBg, [
            value(
              isChangeOnly
                ? `Production stack ${key}: this applies the ${plural(changeSteps, 'change step')} to production with --target and leaves ${plural(drift, 'drift step')} pending. Confirm or cancel.`
                : `Production stack ${key}: this applies ${plural(steps, 'step')} to production. Confirm or cancel.`,
              P.dangerInk,
            ),
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {pill(`${card.id}|confirm`, 'YES, APPLY TO PRODUCTION', confirm(run), 'pillDanger')}
              {pill(`${card.id}|cancel`, 'CANCEL', withdraw(run), 'pillNeutral')}
            </Box>,
          ])
        )
      }

      return (
        <Box flexDirection="column" gap={1}>
          {isBound && approval.status === 'approved' && value(`The approval from ${hhmm(approval.at)} expired.`, P.faint, 'caption')}
          {offered === null ? (
            pill(`${card.id}|approve`, approveCaption(card), approve(run), 'accent')
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {pill(`${card.id}|approve`, approveCaption(card, 'APPROVE ALL'), approve(run), 'accent')}
              {pill(`${card.id}|approve-change`, changeCaption(card, offered), approve(run, 'change'), 'accent')}
            </Box>
          )}
        </Box>
      )
    }

    const drawApply = async (card: Card) => {
      const { run } = card
      const job = jobsNow[stackKey(run)]
      const canApprove = run.runId !== undefined && !run.applyBlocked && !blocksApproval(job, run)
      const targets = run.targets ?? []
      const offer = changeOnly(card)
      const offered = offer !== null && 'targets' in offer ? offer : null

      return callout(P.accent, P.accentPaper, [
        value(
          offered === null
            ? 'An apply runs every step below, drift included.'
            : 'Approve all runs every step below, drift included. Approve change only runs this change\'s steps with --target and leaves the steps under "Also applied: drift already pending" for a later apply.',
        ),
        canApprove && offer !== null && 'blocked' in offer && notice('Change only not offered', offer.blocked),
        targets.length > 0 &&
          metaRow(
            `targets (${targets.length})`,
            <Box flexDirection="column">{targets.map(target => value(cleanText(target), P.ink, 'caption'))}</Box>,
          ),
        run.applyBlocked !== undefined && notice('Apply blocked', run.applyBlocked),
        job !== undefined && (await drawJob(card, job)),
        canApprove && drawApproval(card, offered),
      ])
    }

    const drawSince = (run: PlanRun, baseline: PlanRun) => {
      const since = run.since
      const commits = since?.commits ?? []
      const total = commits.length + (since?.more ?? 0)
      const head = baseline.git.isAvailable ? shortSha(baseline.git.head) : ''
      const shown = commits.slice(0, 5)
      const rest = total - shown.length

      return (
        <Box flexDirection="column">
          <Text color={P.ink} mono>
            {`${head} · `}
            <Text color={P.muted} mono size="caption">
              {`${total} COMMIT${total === 1 ? '' : 'S'} ON MAIN`}
            </Text>
          </Text>
          {shown.map(commit => value(`${shortSha(commit.sha)} ${cleanText(commit.subject)}`, P.muted, 'caption'))}
          {rest > 0 && value(`+${rest} more`, P.faint, 'caption')}
        </Box>
      )
    }

    const drawCard = async (card: Card) => {
      const { run, comparison } = card
      const id = card.id
      const open = await isOpen(id, true)
      const drift = driftCount(comparison)
      const isPending = card.isApply && card.baseline !== undefined
      const labelChip = card.isBaselineOnly
        ? chip('baseline only', P.drift)
        : card.isApply
          ? chip('apply', P.accent, P.onAccent)
          : chip(run.label, P.accentSoft)
      const riskChip = run.risk
        ? chip(RISKS[run.risk].chip, P[RISKS[run.risk].fill], P[RISKS[run.risk].ink])
        : chip('risk not set', P.warning, P.warnInk)
      const counts = [
        comparison.change.create.length > 0 && chip(`+${comparison.change.create.length} create`, P.create),
        comparison.change.update.length > 0 && chip(`~${comparison.change.update.length} update`, P.update),
        comparison.change.replace.length > 0 && chip(`±${comparison.change.replace.length} replace`, P.replace),
        comparison.change.delete.length > 0 && chip(`−${comparison.change.delete.length} delete`, P.delete),
        comparison.hasBaseline && chip(`drift ${drift}`, isPending ? P.pendingDrift : P.drift),
      ]
      const header = titleBar(
        <Button key={id} plain hover={{ underline: true }} onPress={toggle(id, true)}>
          <Text color={P.onAccent} mono size="heading" weight="bold">
            {`${glyph(open)} ${run.project.toUpperCase()} / ${run.stack.toUpperCase()}`}
          </Text>
        </Button>,
        id,
      )
      const chips = chipRow([labelChip, riskChip, ...counts])
      if (!open) {
        return cardFrame(header, chips)
      }

      const driftSections = async () => {
        const groups = await Promise.all(
          CHANGE_CATEGORIES.filter(category => comparison.drift[category].length > 0).map(async category =>
            subGroup(
              TITLES[category],
              comparison.drift[category].length,
              P[CATEGORY_FILLS[category]],
              await drawEntries(`${id}|drift|${category}`, comparison.drift[category], !isPending),
            ),
          ),
        )

        return (
          <Box flexDirection="column" gap={1}>
            {groups}
            {!isPending &&
              comparison.baselineOnly.length > 0 &&
              subGroup(
                'Baseline only (not in the branch run)',
                comparison.baselineOnly.length,
                P.drift,
                await drawEntries(`${id}|baseline-only`, comparison.baselineOnly, true),
              )}
            {comparison.driftDiagnostics.length > 0 &&
              subGroup(
                'Diagnostics also in the baseline',
                comparison.driftDiagnostics.length,
                P.info,
                drawDiagnostics(comparison.driftDiagnostics),
              )}
          </Box>
        )
      }

      const sections = [
        ...(await Promise.all(
          CHANGE_CATEGORIES.map(category =>
            drawSection(`${id}|${category}`, TITLES[category], comparison.change[category].length, P[CATEGORY_FILLS[category]], CATEGORY_PILLS[category], () =>
              drawEntries(`${id}|${category}`, comparison.change[category], false),
            ),
          ),
        )),
        await drawSection(`${id}|diagnostics`, 'Diagnostics', comparison.newDiagnostics.length, P.info, 'pillInfo', async () =>
          drawDiagnostics(comparison.newDiagnostics),
        ),
        isPending
          ? await drawSection(
              `${id}|drift`,
              'Also applied: drift already pending',
              drift + comparison.driftDiagnostics.length,
              P.pendingDrift,
              'pillPending',
              driftSections,
              drift,
            )
          : await drawSection(
              `${id}|drift`,
              'Drift already in the stack',
              drift + comparison.baselineOnly.length + comparison.driftDiagnostics.length,
              P.drift,
              'pillNeutral',
              driftSections,
              drift,
            ),
        isPending
          ? await drawSection(`${id}|no-longer-pending`, 'No longer pending', comparison.baselineOnly.length, P.drift, 'pillNeutral', () =>
              drawEntries(`${id}|baseline-only`, comparison.baselineOnly, true),
            )
          : null,
        await drawSection(`${id}|other`, 'Other', comparison.other.length, P.drift, 'pillNeutral', () =>
          drawEntries(`${id}|other`, comparison.other, true),
        ),
      ]

      const detailsId = `${id}|details`
      const isDetailsOpen = await isOpen(detailsId, false)
      const notices = [
        !comparison.hasBaseline && !card.isApply && chip('no baseline registered: drift not separated', P.warning, P.warnInk),
        card.isApply &&
          card.baseline === undefined &&
          notice(
            'No pre-merge baseline: change and drift not separated',
            card.noBaselineReason === 'no baseline registered for this stack' ? undefined : card.noBaselineReason,
          ),
      ]

      return cardFrame(
        header,
        <Box flexDirection="column" gap={1}>
          {chips}
          <Box flexDirection="column">
            {metaRow('target', value(`${run.project} / ${run.stack}`))}
            {run.riskReason && metaRow('risk', value(run.riskReason))}
            {metaRow('git', gitValue(run))}
            {isPending && card.baseline && metaRow('since', drawSince(run, card.baseline))}
            {card.baseline && metaRow('base git', gitValue(card.baseline))}
            {metaRow(
              'registered',
              value(
                `${formatTime(run.registeredAt)}${run.durationSec === null ? '' : ` · took ${run.durationSec.toFixed(1)}s`}`,
                P.muted,
              ),
            )}
          </Box>
          {chipRow(notices)}
          {card.isApply && (await drawApply(card))}
          {sections}
          {toggleRow(detailsId, `${glyph(isDetailsOpen)} DETAILS`, false, 'pillNeutral', null)}
          {isDetailsOpen && (
            <Box flexDirection="column" paddingLeft={2}>
              {run.git.isAvailable && metaRow('head', value(run.git.head, P.muted))}
              {run.projectDir !== undefined && metaRow('project dir', value(run.projectDir, P.muted))}
              {metaRow('preview', value(run.previewPath, P.muted))}
              {card.baseline && metaRow('base preview', value(card.baseline.previewPath, P.muted))}
              {metaRow('summary', value(JSON.stringify(run.changeSummary), P.muted, 'caption'))}
              {!run.git.isAvailable && metaRow('git reason', value(run.git.reason, P.faint, 'caption'))}
            </Box>
          )}
        </Box>,
      )
    }

    const cards = buildCards(all)
    const stacks = new Set(all.map(run => `${run.project}/${run.stack}`))
    const changeTotal = cards.reduce(
      (sum, card) => sum + CHANGE_CATEGORIES.reduce((n, category) => n + card.comparison.change[category].length, 0),
      0,
    )
    const driftTotal = cards.reduce((sum, card) => sum + (card.comparison.hasBaseline ? driftCount(card.comparison) : 0), 0)
    const only = stacks.size === 1 ? [...stacks][0] : undefined
    const subtitle = [
      ...(only === undefined ? [] : [only.replace('/', ' / ')]),
      plural(stacks.size, 'stack'),
      `${changeTotal} step${changeTotal === 1 ? '' : 's'} to change`,
      `${driftTotal} drift`,
    ]
      .join(' · ')
      .toUpperCase()

    const banner = () => {
      if (!isTerminal && 'Svg' in table) {
        const Svg = table.Svg

        return <Svg source={bannerSvg('PULUMI PLAN', subtitle, theme)} alt={`PULUMI PLAN · ${subtitle}`} />
      }

      return (
        <Box flexDirection="column" backgroundColor={P.card} paddingX={1}>
          <Text color={P.ink} mono size="title" weight="bold">
            PULUMI PLAN
          </Text>
          <Text color={P.muted} mono size="caption">
            {subtitle}
          </Text>
        </Box>
      )
    }

    const drawn = await Promise.all(cards.map(drawCard))

    return (
      <Box flexDirection="column" backgroundColor={P.paper} padding={1} gap={1}>
        {banner()}
        {pill('clear', 'CLEAR', () => clearAll($), 'pillNeutral')}
        {all.length === 0 && (
          cardFrame(
            titleBar(
              <Text color={P.onAccent} mono size="heading" weight="bold">
                NO PREVIEWS YET
              </Text>,
            ),
            value(`Previews appear here once ${TOOL} is called for a \`pulumi preview --json\` output.`, P.muted),
          )
        )}
        {drawn}
      </Box>
    )
  })
}
