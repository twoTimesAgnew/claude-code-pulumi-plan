import { expect, mock, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { launchArgv, previewArgv } from './apply'
import { URNS, applyPreview, baselinePreview, branchPreview, preMergePreview, urn } from './fixtures'
import { DEFAULT_PALETTE as PALETTE, PILL_KEYS, THEME_PRESETS, chipSvg, pillHoverFill } from './style'

const TOOL = 'mcp__pulumi-plan__show'
const HEAD = 'c0ffee0000000000000000000000000000000001'
const MAIN = 'baba000000000000000000000000000000000002'
const TOPIC = 'feed000000000000000000000000000000000003'

const PANE = {
  plugin: 'pulumi-plan',
  component: 'Pane',
  requestId: 'pulumi-plan',
  props: {
    title: 'Pulumi plan',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const files: Record<string, string> = {
  '/plans/base.json': JSON.stringify(baselinePreview),
  '/plans/branch.json': `noise\n${JSON.stringify(branchPreview)}`,
}

type Answer = { result?: unknown; deny?: string; text?: string }

const call = ($: unknown) => (input: Record<string, unknown>) =>
  ($ as { tool: { call: (input: unknown) => Promise<Answer> } }).tool.call(input)

const COLORS = new Set<string>(Object.values(PALETTE))

async function expectPaletteOnly(ui: Mounted<'terminal' | 'desktop', 'Pane'>) {
  const elements = paneElements(await ui.drawn())
  const texts = elements.filter(({ node }) => node.type === 'Text')
  expect(texts.length).toBeGreaterThan(0)
  for (const { node } of texts) {
    expect(COLORS.has(String(node.props?.color))).toBe(true)
    if (node.props?.backgroundColor !== undefined) {
      expect(COLORS.has(String(node.props.backgroundColor))).toBe(true)
    }
  }
  for (const { node } of elements.filter(({ node }) => node.type === 'Box')) {
    for (const prop of ['backgroundColor', 'borderColor'] as const) {
      if (node.props?.[prop] !== undefined) {
        expect(COLORS.has(String(node.props[prop]))).toBe(true)
      }
    }
  }
  expect(elements.filter(({ node }) => node.type === 'Code')).toHaveLength(0)
  for (const { node } of elements.filter(({ node }) => node.type === 'Svg')) {
    expectCleanSvg(String(node.props?.source))
  }
  expectNoBorders(elements)
}

function expectCleanSvg(source: string) {
  for (const hex of source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
    expect(`${hex}: ${COLORS.has(hex)}`).toBe(`${hex}: true`)
  }
  expect(source).not.toMatch(/\srx=/)
  expectWellFormed(source)
}

function expectWellFormed(source: string) {
  const tag = /<\/?[a-z]+(\s+[a-zA-Z-]+="[^"<>]*")*\s*\/?>/g
  const tags = source.match(tag) ?? []
  expect(tags.join('')).toBe(source.replace(/>[^<]*</g, '><').replace(/^[^<]*|[^>]*$/g, ''))
  const outside = source.replace(tag, '')
  expect(outside).not.toMatch(/[<>"']/)
  expect(outside.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&')
  for (const name of ['svg', 'text']) {
    expect(source.split(`<${name}`).length).toBe(source.split(`</${name}>`).length)
  }
}

function expectNoBorders(elements: { node: Node }[]) {
  const bordered = elements
    .filter(({ node }) => node.type === 'Box' && (node.props?.borderStyle !== undefined || node.props?.borderColor !== undefined))
    .map(({ node }) => JSON.stringify(node.props))
  expect(bordered).toEqual([])
}

type AnyPane = Mounted<'terminal', 'Pane'> | Mounted<'desktop', 'Pane'> | Mounted<'terminal' | 'desktop', 'Pane'>

function sectionCount(root: unknown, key: string): string | undefined {
  const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null
  const holdsButton = (node: Node): boolean =>
    (node.type === 'Button' && node.props?.key === key) || (node.children ?? []).some(child => isNode(child) && holdsButton(child))
  const label = (node: Node): string =>
    node.type === 'Svg'
      ? String(node.props?.alt)
      : (node.children ?? []).map(child => (isNode(child) ? label(child) : String(child))).join('').trim()
  let found: string | undefined
  const walk = (node: Node) => {
    const [first, second] = (node.children ?? []).filter(isNode)
    if (found === undefined && node.type === 'Box' && first?.type === 'Box' && second !== undefined && holdsButton(first)) {
      found = label(second)
    }
    for (const child of node.children ?? []) if (isNode(child)) walk(child)
  }
  walk(root as Node)

  return found
}

async function findChip(ui: AnyPane, pattern: string | RegExp): Promise<string | undefined> {
  const labels = [
    ...(await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt)),
    ...(await ui.findAll({ type: 'Text' })).map(text => text.text.trim()),
  ]

  return labels.find(label => (typeof pattern === 'string' ? label.includes(pattern) : pattern.test(label)))
}

const PILLS = new Set<string>(PILL_KEYS.map(key => PALETTE[key]))

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function paneElements(root: unknown): { node: Node; box: Node | undefined }[] {
  const found: { node: Node; box: Node | undefined }[] = []
  const walk = (value: unknown, box: Node | undefined) => {
    if (typeof value !== 'object' || value === null) return
    const node = value as Node
    found.push({ node, box })
    const nextBox = node.type === 'Box' ? node : box
    for (const child of node.children ?? []) walk(child, nextBox)
    const propChildren = node.props?.children
    if (Array.isArray(propChildren)) for (const child of propChildren) walk(child, nextBox)
  }
  walk(root, undefined)

  return found
}

async function expectPillsOnly(ui: Mounted<'terminal' | 'desktop', 'Pane'>) {
  const buttons = paneElements(await ui.drawn())
    .filter(({ node }) => node.type === 'Button')
    .map(({ node, box }) => ({ key: node.props?.key, fill: box?.props?.backgroundColor }))
  expect(buttons.length).toBeGreaterThan(0)
  for (const button of buttons) {
    expect(`${String(button.key)} on ${String(button.fill)}: ${PILLS.has(String(button.fill))}`).toBe(
      `${String(button.key)} on ${String(button.fill)}: true`,
    )
  }
  expect(buttons.length).toBe((await ui.findAll({ type: 'Button' })).length)
}

const ran = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

function engine(on: On, { isGitGone = false } = {}) {
  mock.clock(on, { now: Date.UTC(2026, 0, 2, 3, 4, 5) })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pulumi-plan__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    const text = files[e.path]

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('process.run', (_, e) => {
    if (isGitGone) {
      return ran('', 128, 'fatal: cannot change to /gone: No such file or directory')
    }
    const args = e.argv.slice(3).join(' ')
    if (args === 'rev-parse HEAD') return ran(HEAD)
    if (args === 'symbolic-ref --short -q HEAD') return ran('', 1)
    if (args === 'log -1 --format=%P%n%s HEAD') return ran(`${MAIN} ${TOPIC}\nMerge branch 'topic'`)
    if (args.includes(`--points-at ${MAIN}`)) return ran('origin/main')
    if (args.includes(`--points-at ${TOPIC}`)) return ran('topic')
    if (args === 'status --porcelain') return ran(' M a.ts\n?? b.ts\n')

    return ran('', 1, `unexpected ${args}`)
  })
}

type StoredRun = { project: string; stack: string; role: string; git: unknown }

function recordRuns(on: On): () => StoredRun[] {
  let last: StoredRun[] = []
  on('state.set', (_, e, next) => {
    if (e.plugin === 'pulumi-plan' && e.key === 'runs') {
      last = (e.value as { value: StoredRun[] }).value
    }

    return next(e)
  })

  return () => last
}

test('show stores a run with its target from the URNs and git from the worktree', async ($, on) => {
  engine(on)
  const stored = recordRuns(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await call($)({
    tool: TOOL,
    previewJson: '/plans/branch.json',
    worktree: '/wt',
    role: 'branch',
    label: 'T-1',
  })

  expect(answer.result).toMatch(/demo\/dev as branch "T-1"/)
  expect(answer.result).toMatch(/topic @ feed0000 merged onto origin\/main @ baba0000 \(HEAD c0ffee00, detached\) · 2 uncommitted files/)
  const runs = stored()
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({
    project: 'demo',
    stack: 'dev',
    git: {
      isAvailable: true,
      head: HEAD,
      branch: null,
      parents: [
        { sha: MAIN, refs: ['origin/main'] },
        { sha: TOPIC, refs: ['topic'] },
      ],
      dirtyCount: 2,
    },
  })
})

test('a worktree git cannot read is stored as git unavailable', async ($, on) => {
  engine(on, { isGitGone: true })
  const stored = recordRuns(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/gone', role: 'baseline' })

  expect(answer.deny).toBeUndefined()
  expect(stored()[0]?.git).toEqual({
    isAvailable: false,
    reason: 'fatal: cannot change to /gone: No such file or directory',
  })
})

test('a missing preview file is an error naming why', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await call($)({ tool: TOOL, previewJson: '/plans/none.json', worktree: '/wt', role: 'baseline' })

  expect(answer.text ?? answer.deny).toMatch(/does not exist/)
})

test('stack or project contradicting the URNs is an error', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const answer = await call($)({
    tool: TOOL,
    previewJson: '/plans/base.json',
    worktree: '/wt',
    role: 'baseline',
    stack: 'production',
  })

  expect(answer.text ?? answer.deny).toMatch(/stack "production" but the URNs say "dev"/)
})

test('the pane shows change counts and opens down to a property diff', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/wt', role: 'baseline' })
  await call($)({ tool: TOOL, previewJson: '/plans/branch.json', worktree: '/wt', role: 'branch', label: 'T-1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    const card = await ui.find({ type: 'Button', key: JSON.stringify(['branch', 'T-1', 'demo', 'dev']) })
    expect(card?.text).toBe('− DEMO / DEV')
    for (const chip of ['+1 CREATE', '~1 UPDATE', '±1 REPLACE', 'DRIFT 2']) {
      expect(await findChip(ui, chip )).toBeDefined()
    }
    expect(await findChip(ui, /^ ?T-1 ?$/ )).toBeDefined()
    const cardKey = JSON.stringify(['branch', 'T-1', 'demo', 'dev'])
    const rowKey = `${cardKey}|update|${URNS.SVC}`
    expect(await ui.find({ type: 'Button', key: rowKey })).toBeUndefined()

    const section = await ui.find({ type: 'Button', key: `${cardKey}|update` })
    expect(section?.text).toBe('+ UPDATE')
    expect(await findChip(ui, /^1$/ )).toBeDefined()
    await ui.press({ key: section?.key ?? '' })
    const row = await ui.find({ type: 'Button', key: rowKey })
    expect(row?.text).toBe('+ web')
    expect(await ui.find({ type: 'Text', text: 'acme:core:Service' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'spec.port' })).toBeDefined()
    expect(await findChip(ui, 'OVERLAPS DRIFT' )).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- 80$/ })).toBeUndefined()
    await expectPillsOnly(ui)

    await ui.press({ key: row?.key ?? '' })
    expect(await ui.find({ type: 'Text', text: /^- 80$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+ 82$/ })).toBeDefined()
    await expectPaletteOnly(ui)

    await ui.press({ key: row?.key ?? '' })
    await ui.press({ key: section?.key ?? '' })

    const drift = await ui.find({ type: 'Button', key: `${cardKey}|drift` })
    expect(drift?.text).toBe('+ DRIFT ALREADY IN THE STACK')
    expect(sectionCount(await ui.drawn(), `${cardKey}|drift`)).toBe('2')
    await ui.press({ key: drift?.key ?? '' })
    expect(await ui.find({ type: 'Text', text: /BASELINE ONLY \(NOT IN THE BRANCH RUN\)/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: `${cardKey}|drift|update|${URNS.SECRET}` }))?.text).toBe('+ token')
    expect(await findChip(ui, 'OPAQUE' )).toBeDefined()
    await expectPillsOnly(ui)
    await ui.press({ key: drift?.key ?? '' })
    await ui.unmount()
  }
})

test('runs stored under another shape tag read as empty', async ($, on) => {
  mock.clock(on)
  on('state.get', () => ({
    value: { value: { shape: 'runs-0', value: [{ project: 'demo', stack: 'dev', role: 'branch' }] }, version: 1 },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: 'NO PREVIEWS YET' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /mcp__pulumi-plan__show/ })).toBeDefined()
    await ui.unmount()
  }
})

const APPLY = 'mcp__pulumi-plan__apply'
const STATUS = 'mcp__pulumi-plan__apply_status'
const ORIGIN = 'a11ce00000000000000000000000000000000004'
const MOVED = 'b0b0000000000000000000000000000000000005'
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5)
const BASE_SHA = 'ba5e000000000000000000000000000000000006'
const PARENT_SHA = '9a7e000000000000000000000000000000000007'
const BASE_WORKTREE = '/wt/base'
const WORKTREE = '/wt/main'
const PROJECT_DIR = '/wt/main/infra/demo'
const HOME_DIR = '/home/tester'

type Scenario = {
  head: string
  origin: string
  originAfterFetch: string
  dirty: string
  yamlName: string
  rePreview: unknown
  isFinishedOnWait: boolean
  log: string
  baseHead: string
  isAncestor: boolean
  sinceLog: string
}

type Recorder = { calls: string[]; argvs: string[][]; writes: Record<string, string>; files: Record<string, string> }

type ApplyEngine = { scenario: Scenario; rec: Recorder; clock: ReturnType<typeof mock.clock>; finish: () => void }

function applyEngine(on: On, overrides: Partial<Scenario> = {}): ApplyEngine {
  const scenario: Scenario = {
    head: ORIGIN,
    origin: ORIGIN,
    originAfterFetch: ORIGIN,
    dirty: '',
    yamlName: 'demo',
    rePreview: applyPreview('staging'),
    isFinishedOnWait: true,
    baseHead: BASE_SHA,
    isAncestor: true,
    sinceLog: `${ORIGIN}\tMerge branch 'topic' into 'main'\n`,
    log: '\u001b[32mUpdating (staging)\u001b[0m\nResources:\n    2 changed\n',
    ...overrides,
  }
  const rec: Recorder = { calls: [], argvs: [], writes: {}, files: {} }
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: HOME_DIR })
  let isFetched = false
  let exitPath = ''
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pulumi-plan__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('/Pulumi.yaml')) return { value: `name: ${scenario.yamlName}\nruntime: nodejs\n` }
    const text = rec.files[e.path]

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.exists', (_, e) => ({ value: e.path in rec.files }))
  on('fs.stat', (_, e) => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.write', (_, e) => {
    rec.writes[e.path] = e.text
    rec.files[e.path] = e.text

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    rec.argvs.push(argv)
    if (argv[0] === 'git') {
      const args = argv.slice(3).join(' ')
      rec.calls.push(`git ${args}`)
      const isBase = argv[2] === BASE_WORKTREE
      if (args === 'rev-parse HEAD') return ran(isBase ? scenario.baseHead : scenario.head)
      if (args.startsWith('merge-base --is-ancestor')) return ran('', scenario.isAncestor ? 0 : 1)
      if (args.startsWith('log --first-parent --format=%H%x09%s')) return ran(scenario.sinceLog)
      if (args === 'symbolic-ref --short -q HEAD') return ran('', 1)
      if (args === 'log -1 --format=%P%n%s HEAD') return ran(`${isBase ? PARENT_SHA : scenario.origin}\nsubject`)
      if (args.startsWith('for-each-ref')) return ran('origin/main')
      if (args === 'status --porcelain') return ran(scenario.dirty)
      if (args === 'fetch origin main') {
        isFetched = true

        return ran('')
      }
      if (args === 'rev-parse origin/main') return ran(isFetched ? scenario.originAfterFetch : scenario.origin)

      return ran('', 1, `unexpected git ${args}`)
    }
    if (argv[0] === '/bin/zsh' && argv[2] === 'exec "$@"') {
      rec.calls.push('preview')

      return ran(JSON.stringify(scenario.rePreview))
    }
    if (argv[0] === '/bin/zsh') {
      rec.calls.push('launch')
      exitPath = (argv[4] ?? '').replace(/run\.sh$/, 'up.exit')

      return ran('')
    }
    if (argv[0] === '/bin/sh') {
      rec.calls.push('wait')
      if (scenario.isFinishedOnWait) rec.files[exitPath] = '0\n'

      return ran('')
    }
    if (argv[0] === 'tail') {
      rec.calls.push('tail')

      return ran(scenario.log)
    }

    return ran('', 1, `unexpected ${argv.join(' ')}`)
  })

  return {
    scenario,
    rec,
    clock,
    finish: () => {
      rec.files[exitPath] = '0\n'
    },
  }
}

const registerApply = async ($: unknown, stack: string, extra: Record<string, unknown> = {}, files?: Recorder['files']) => {
  if (files) files[`/plans/apply-${stack}.json`] = JSON.stringify(applyPreview(stack))

  return call($)({
    tool: TOOL,
    previewJson: `/plans/apply-${stack}.json`,
    worktree: WORKTREE,
    role: 'apply',
    projectDir: PROJECT_DIR,
    ...extra,
  })
}

const cardId = (stack: string) => JSON.stringify(['apply', 'demo', stack])

const SURFACES = ['terminal', 'desktop'] as const

async function start($: { session: { start: (e: { cwd: string; surface: 'desktop'; isInteractive: boolean }) => Promise<unknown> } }) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

test('apply with no approval is denied and starts no process', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.text ?? answer.deny).toMatch(/No approval for demo\/staging/)
  expect(rec.calls).toEqual([])
})

test('an approved apply checks git, re-previews, launches, and uses the approval up', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  const target = urn('acme:core:Service', 'web', 'staging')
  await registerApply($, 'staging', { targets: [target] }, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${cardId('staging')}|approve` })
  await ui.unmount()
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.result).toMatch(/pulumi up for demo\/staging succeeded: exit 0/)
  expect(answer.result).toMatch(/An interrupted wait does not stop the apply/)
  expect(rec.calls.slice(0, 7)).toEqual([
    'git status --porcelain',
    'git fetch origin main',
    'git rev-parse origin/main',
    'git rev-parse HEAD',
    'preview',
    'launch',
    'wait',
  ])
  const jobDir = `${HOME_DIR}/.claude/pulumi-plan/jobs/20260102T030405Z-demo-staging`
  const preview = rec.argvs.find(argv => argv[2] === 'exec "$@"')
  expect(preview).toEqual([
    '/bin/zsh',
    '-lic',
    'exec "$@"',
    'zsh',
    'pulumi',
    'preview',
    '--stack',
    'staging',
    '--json',
    '--non-interactive',
    '--suppress-outputs',
    '--target',
    target,
  ])
  expect(rec.argvs.find(argv => argv[0] === '/bin/zsh' && argv[2] !== 'exec "$@"')).toEqual(launchArgv(`${jobDir}/run.sh`))
  const script = rec.writes[`${jobDir}/run.sh`] ?? ''
  expect(script).toContain(
    `'pulumi' 'up' '--stack' 'staging' '--yes' '--skip-preview' '--non-interactive' '--suppress-outputs' '--target' '${target}' > '${jobDir}/up.log' 2>&1`,
  )
  expect(script).toContain(`cd '${PROJECT_DIR}'`)
  expect(rec.writes[`${jobDir}/preview.json`]).toBeDefined()

  rec.calls.length = 0
  const again = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })
  expect(again.text ?? again.deny).toMatch(/No approval for demo\/staging/)
  expect(rec.calls).toEqual([])
})

test('a production stack needs two presses; armed alone is denied and Cancel disarms', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: applyPreview('production') })
  await start($)
  await registerApply($, 'production', {}, rec.files)
  const id = cardId('production')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: `${id}|approve` })
  expect(await ui.find({ type: 'Button', key: `${id}|confirm` })).toBeDefined()
  const armed = await call($)({ tool: APPLY, project: 'demo', stack: 'production' })
  expect(armed.text ?? armed.deny).toMatch(/armed but not confirmed/)

  await ui.press({ key: `${id}|cancel` })
  expect(await ui.find({ type: 'Button', key: `${id}|confirm` })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `${id}|approve` })).toBeDefined()
  const cancelled = await call($)({ tool: APPLY, project: 'demo', stack: 'production' })
  expect(cancelled.text ?? cancelled.deny).toMatch(/No approval/)

  await ui.press({ key: `${id}|approve` })
  await ui.press({ key: `${id}|confirm` })
  await ui.unmount()
  const confirmed = await call($)({ tool: APPLY, project: 'demo', stack: 'production' })
  expect(confirmed.result).toMatch(/succeeded: exit 0/)
})

test('an approval older than 15 minutes is denied', async ($, on) => {
  const { rec, clock } = applyEngine(on)
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${cardId('staging')}|approve` })
  await ui.unmount()
  await clock.advance(15 * 60 * 1000)
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.text ?? answer.deny).toMatch(/expired/)
  expect(rec.calls).toEqual([])
})

test('registering the apply preview again voids the approval', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${cardId('staging')}|approve` })
  expect(await findChip(ui, /APPROVED 03:04 UTC, ONE APPLY, VALID 15 MIN/ )).toBeDefined()
  await registerApply($, 'staging', {}, rec.files)
  expect(await findChip(ui, /APPROVED/ )).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `${cardId('staging')}|approve` })).toBeDefined()
  await ui.unmount()

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })
  expect(answer.text ?? answer.deny).toMatch(/earlier apply preview and is void/)
})

test('a re-preview with different steps is refused, launches nothing, and replaces the stored run', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: applyPreview('staging', { isExtra: true }) })
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${cardId('staging')}|approve` })
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.text ?? answer.deny).toMatch(/differs from the approved preview \(1 new or changed step, 0 no longer present\)/)
  expect(rec.calls).toContain('preview')
  expect(rec.calls).not.toContain('launch')
  expect((await ui.find({ type: 'Button', key: `${cardId('staging')}|approve` }))?.text).toBe('APPROVE APPLY · 3 STEPS → demo/staging')
  expect(await findChip(ui, /APPLY REFUSED/ )).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^the re-preview differs/ })).toBeDefined()
  await ui.unmount()
})

test('origin/main moving or a dirty tree is refused before any pulumi process', async ($, on) => {
  const { rec, scenario } = applyEngine(on)
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const approveOnce = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${cardId('staging')}|approve` })
    await ui.unmount()
    rec.calls.length = 0
  }

  await approveOnce()
  scenario.originAfterFetch = MOVED
  const moved = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })
  expect(moved.text ?? moved.deny).toMatch(/origin\/main moved/)
  expect(rec.calls.some(c => c === 'preview' || c === 'launch')).toBe(false)

  scenario.originAfterFetch = ORIGIN
  await approveOnce()
  scenario.dirty = ' M Pulumi.staging.yaml\n'
  const dirty = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })
  expect(dirty.text ?? dirty.deny).toMatch(/uncommitted files/)
  expect(rec.calls).toEqual(['git status --porcelain'])
})

test('ineligible apply previews show the reason and no Approve button', async ($, on) => {
  const cases = [
    { overrides: { head: MOVED }, reason: /HEAD b0b00000 is not origin\/main \(a11ce000\)/ },
    { overrides: { yamlName: 'other' }, reason: /Pulumi.yaml names project "other", the URNs say "demo"/ },
    { overrides: {}, reason: /1 error diagnostic/, isError: true },
  ]
  const { rec, scenario } = applyEngine(on)
  await start($)
  for (const { overrides, reason, isError } of cases) {
    Object.assign(scenario, { head: ORIGIN, yamlName: 'demo' }, overrides)
    rec.files['/plans/apply-staging.json'] = JSON.stringify(applyPreview('staging', { isError: isError === true }))
    await registerApply($, 'staging')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: 'APPLY BLOCKED' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: reason })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: `${cardId('staging')}|approve` })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('quotes, spaces and $() in a target or path cannot break out of the command', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  const target = urn('acme:core:Service', `it's $(touch /tmp/pwned) a b`, 'staging')
  const dir = `${WORKTREE}/it's $(id) dir`
  await registerApply($, 'staging', { targets: [target], projectDir: dir }, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${cardId('staging')}|approve` })
  await ui.unmount()

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.result).toMatch(/succeeded/)
  const preview = rec.argvs.find(argv => argv[2] === 'exec "$@"') ?? []
  expect(preview.slice(-2)).toEqual(['--target', target])
  expect(preview[2]).toBe('exec "$@"')
  const script = Object.entries(rec.writes).find(([path]) => path.endsWith('/run.sh'))?.[1] ?? ''
  expect(script).toContain(`cd '/wt/main/it'\\''s $(id) dir' ||`)
  expect(script).toContain(`'--target' 'urn:pulumi:staging::demo::acme:core:Service::it'\\''s $(touch /tmp/pwned) a b' >`)
  const launch = rec.argvs.find(argv => argv[0] === '/bin/zsh' && argv[2] !== 'exec "$@"') ?? []
  expect(launch.slice(0, 4)).toEqual(['/bin/zsh', '-lic', 'nohup /bin/sh "$1" </dev/null >/dev/null 2>&1 &!', 'zsh'])
})

test('the apply card through eligible, armed, approved, running and finished', async ($, on) => {
  const engineState = applyEngine(on, { rePreview: applyPreview('production'), isFinishedOnWait: false })
  const { rec, clock } = engineState
  await start($)
  await registerApply($, 'production', {}, rec.files)
  const id = cardId('production')
  const onBoth = async (check: (ui: Mounted<'terminal' | 'desktop', 'Pane'>) => Promise<void>) => {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await check(ui)
      await ui.unmount()
    }
  }

  await onBoth(async ui => {
    expect((await ui.find({ type: 'Button', key: `${id}|approve` }))?.text).toBe('APPROVE APPLY · 2 STEPS → demo/production')
    expect(await ui.find({ type: 'Text', text: /An apply runs every step below, drift included\./ })).toBeDefined()
  })

  const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await first.press({ key: `${id}|approve` })
  await first.unmount()
  await onBoth(async ui => {
    expect(await ui.find({ type: 'Text', text: /Production stack demo\/production/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: `${id}|confirm` }))?.text).toBe('YES, APPLY TO PRODUCTION')
    expect(await ui.find({ type: 'Button', key: `${id}|cancel` })).toBeDefined()
    await expectPillsOnly(ui)
  })

  const second = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await second.press({ key: `${id}|confirm` })
  await second.unmount()
  await onBoth(async ui => {
    expect(await findChip(ui, /APPROVED 03:04 UTC, ONE APPLY, VALID 15 MIN/ )).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${id}|revoke` })).toBeDefined()
    await expectPaletteOnly(ui)
    await expectPillsOnly(ui)
  })

  const running = await call($)({ tool: APPLY, project: 'demo', stack: 'production' })
  expect(running.result).toMatch(/still running/)
  expect(running.result).toMatch(new RegExp(STATUS))
  await onBoth(async ui => {
    expect(await findChip(ui, /APPLYING… STARTED 03:04 UTC/ )).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Resources:\n {4}2 changed/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${id}|approve` })).toBeUndefined()
  })

  const clear = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clear.press({ key: 'clear' })
  await clear.unmount()

  engineState.finish()
  await clock.advance(3000)
  await onBoth(async ui => {
    expect(await findChip(ui, /APPLIED 03:04 UTC, EXIT 0/ )).toBeDefined()
    expect(await ui.find({ type: 'Button', key: `${id}|approve` })).toBeUndefined()
    await ui.press({ key: `${id}|log` })
    expect(await ui.find({ type: 'Text', text: /Updating \(staging\)\nResources:/ })).toBeDefined()
    await expectPillsOnly(ui)
    await expectPaletteOnly(ui)
    await ui.press({ key: `${id}|log` })
  })
  const status = await call($)({ tool: STATUS, project: 'demo', stack: 'production' })
  expect(status.result).toMatch(/succeeded: exit 0/)
})

const registerBaseline = async ($: unknown, stack: string, files: Recorder['files']) => {
  files[`/plans/base-${stack}.json`] = JSON.stringify(preMergePreview(stack))

  return call($)({ tool: TOOL, previewJson: `/plans/base-${stack}.json`, worktree: BASE_WORKTREE, role: 'baseline' })
}

test('an apply run with an ancestor baseline splits change from pending drift and still applies', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerBaseline($, 'staging', rec.files)
  const shown = await registerApply($, 'staging', {}, rec.files)
  expect(shown.result).toMatch(/this change create 1, update 0, replace 0, delete 0; drift already pending that the apply also runs 1; no longer pending 1/)
  const id = cardId('staging')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', key: `${id}|approve` }))?.text).toBe(
      'APPROVE ALL · 2 STEPS (1 CHANGE + 1 DRIFT) → demo/staging',
    )
    expect(await findChip(ui, '+1 CREATE' )).toBeDefined()
    expect(await findChip(ui, /~1 UPDATE/ )).toBeUndefined()
    const pending = await ui.find({ type: 'Button', key: `${id}|drift` })
    expect(pending?.text).toBe('+ ALSO APPLIED: DRIFT ALREADY PENDING')
    expect((await ui.find({ type: 'Button', key: `${id}|no-longer-pending` }))?.text).toBe('+ NO LONGER PENDING')
    await ui.press({ key: pending?.key ?? '' })
    const row = await ui.find({ type: 'Button', key: `${id}|drift|update|${urn('acme:core:Service', 'web', 'staging')}` })
    await ui.press({ key: row?.key ?? '' })
    expect(await ui.find({ type: 'Text', text: /^- 80$/ })).toBeDefined()
    await expectPillsOnly(ui)
    await expectPaletteOnly(ui)
    await ui.press({ key: row?.key ?? '' })
    await ui.press({ key: pending?.key ?? '' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${id}|approve` })
  await ui.unmount()
  rec.calls.length = 0
  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })
  expect(answer.result).toMatch(/succeeded: exit 0/)
  expect(rec.calls.slice(0, 7)).toEqual([
    'git status --porcelain',
    'git fetch origin main',
    'git rev-parse origin/main',
    'git rev-parse HEAD',
    'preview',
    'launch',
    'wait',
  ])
})

test('a baseline registered after the apply run pairs it without voiding the approval', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const id = cardId('staging')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'NO PRE-MERGE BASELINE: CHANGE AND DRIFT NOT SEPARATED' })).toBeDefined()
  await ui.press({ key: `${id}|approve` })

  const shown = await registerBaseline($, 'staging', rec.files)

  expect(shown.result).toMatch(/Paired as the pre-merge baseline/)
  expect(await findChip(ui, /APPROVED 03:04 UTC/ )).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `${id}|drift` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /NO PRE-MERGE BASELINE/ })).toBeUndefined()
  await ui.unmount()
  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })
  expect(answer.result).toMatch(/succeeded: exit 0/)
})

test('a baseline that is not an ancestor is not used, and the card says so', async ($, on) => {
  const { rec } = applyEngine(on, { isAncestor: false })
  await start($)
  await registerBaseline($, 'staging', rec.files)
  const shown = await registerApply($, 'staging', {}, rec.files)
  expect(shown.result).toMatch(/No pre-merge baseline paired \(the baseline commit ba5e0000 is not an ancestor/)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'NO PRE-MERGE BASELINE: CHANGE AND DRIFT NOT SEPARATED' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /is not an ancestor of the apply run's a11ce000/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: `${cardId('staging')}|approve` }))?.text).toBe('APPROVE APPLY · 2 STEPS → demo/staging')
    expect(await ui.find({ type: 'Button', key: `${cardId('staging')}|drift` })).toBeUndefined()
    expect(await findChip(ui, /^ ?~1 UPDATE ?$/ )).toBeDefined()
    await ui.unmount()
  }
})

test('the commits on main since the baseline are listed', async ($, on) => {
  const subjects = Array.from({ length: 7 }, (_, i) => `Merge change ${i + 1}`)
  const shas = subjects.map((_, i) => `c${i}`.padEnd(40, '0'))
  const { rec } = applyEngine(on, { sinceLog: shas.map((sha, i) => `${sha}\t${subjects[i]}`).join('\n') })
  await start($)
  await registerBaseline($, 'staging', rec.files)
  await registerApply($, 'staging', {}, rec.files)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /ba5e0000 · 7 COMMITS ON MAIN/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'c0000000 Merge change 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'c4000000 Merge change 5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Merge change 6/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '+2 more' })).toBeDefined()
    await ui.unmount()
  }
})

test('the banner SVG escapes a project name with &, < and quotes and stays under the size limit', async ($, on) => {
  engine(on)
  await start($)
  const odd = `urn:pulumi:dev::a&b<"c'd::acme:core:Queue::jobs`
  files['/plans/odd.json'] = JSON.stringify({
    steps: [{ op: 'create', urn: odd, newState: { urn: odd, inputs: { name: 'jobs' } } }],
    diagnostics: [],
    changeSummary: { create: 1 },
  })
  await call($)({ tool: TOOL, previewJson: '/plans/odd.json', worktree: '/wt', role: 'branch', label: 'T-2' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = (await ui.findAll({ type: 'Svg' })).find(found => String(found.props.alt).startsWith('PULUMI PLAN'))
  const source = String(svg?.props.source)
  expect(source).toContain('A&amp;B&lt;&quot;C&apos;D / DEV · 1 STACK · 1 STEP TO CHANGE · 0 DRIFT')
  expect(source.length).toBeLessThan(131072)
  const tags = source.match(/<\/?[a-z]+(\s+[a-zA-Z-]+="[^"<>]*")*\s*\/?>/g) ?? []
  expect(tags.join('')).toBe(source.replace(/>[^<]*</g, '><').replace(/^[^<]*|[^>]*$/g, ''))
  const outside = source.replace(/<\/?[a-z]+(\s+[a-zA-Z-]+="[^"<>]*")*\s*\/?>/g, '')
  expect(outside).not.toMatch(/[<>"']/)
  expect(outside.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&')
  for (const name of ['svg', 'text']) {
    expect(source.split(`<${name}`).length).toBe(source.split(`</${name}>`).length)
  }
  expect(String(svg?.props.alt)).toContain(`A&B<"C'D / DEV`)
  await ui.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: 'PULUMI PLAN' })).toBeDefined()
  await terminal.unmount()
})

test('a baseline run with no git record says not recorded, not unavailable', async ($, on) => {
  engine(on, { isGitGone: true })
  await start($)
  await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/gone', role: 'baseline' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(
      await ui.find({ type: 'Text', text: 'not recorded: /gone was not a git checkout when this preview was registered' }),
    ).toBeDefined()
    const details = JSON.stringify(['baseline', 'demo', 'dev'])
    expect(await ui.find({ type: 'Text', text: /cannot change to \/gone/ })).toBeUndefined()
    await ui.press({ key: `${details}|details` })
    expect(await ui.find({ type: 'Text', text: /cannot change to \/gone/ })).toBeDefined()
    await ui.press({ key: `${details}|details` })
    expect(await ui.find({ type: 'Text', text: /git unavailable/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('show records main ancestry and draws a merge commit of main as origin/main', async ($, on) => {
  const head = '5fb6000000000000000000000000000000000008'
  const older = '9a2b000000000000000000000000000000000009'
  let current = head
  const argvs: string[][] = []
  mock.clock(on, { now: NOW })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pulumi-plan__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', (_, e) => (files[e.path] === undefined ? { deny: 'ENOENT' } : { value: files[e.path] ?? '' }))
  on('process.run', (_, e) => {
    argvs.push([...e.argv])
    const args = e.argv.slice(3).join(' ')
    if (args === 'rev-parse HEAD') return ran(current)
    if (args === 'symbolic-ref --short -q HEAD') return ran('', 1)
    if (args === 'log -1 --format=%P%n%s HEAD') return ran(`${MAIN} ${TOPIC}\nMerge branch 'demo-9' into 'main'`)
    if (args.startsWith('for-each-ref')) return ran(args.includes(head) ? 'origin/HEAD\norigin/main\nmain\nlocal-x' : 'a\nb\nc')
    if (args === 'status --porcelain') return ran('')
    if (args === 'rev-parse --verify -q origin/main') return ran(head)
    if (args === 'merge-base --is-ancestor HEAD origin/main') return ran('', 0)
    if (args === 'rev-list --count --first-parent HEAD..origin/main') return ran(current === head ? '0' : '2')

    return ran('', 1, `unexpected ${args}`)
  })
  const stored = recordRuns(on)
  await start($)
  const atMain = await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/wt', role: 'baseline' })
  expect(atMain.result).toMatch(/git: origin\/main @ 5fb60000 · Merge branch 'demo-9' into 'main'/)
  expect(stored()[0]?.git).toMatchObject({ originMain: head, isOnMain: true, behindMain: 0, headRefs: ['origin/HEAD', 'origin/main', 'main', 'local-x'] })
  expect(argvs).toContainEqual(['git', '-C', '/wt', 'rev-list', '--count', '--first-parent', 'HEAD..origin/main'])

  current = older
  const behind = await call($)({ tool: TOOL, previewJson: '/plans/branch.json', worktree: '/wt', role: 'branch', label: 'T-3' })
  expect(behind.result).toMatch(/git: 9a2b0000 on main, 2 commits behind origin\/main · Merge branch 'demo-9' into 'main'/)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /merged onto/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: "9a2b0000 on main, 2 commits behind origin/main · Merge branch 'demo-9' into 'main'" })).toBeDefined()
    await ui.unmount()
  }
})

test('the Details section hides HEAD, paths and the summary until pressed', async ($, on) => {
  engine(on)
  await start($)
  await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/wt', role: 'baseline' })
  await call($)({ tool: TOOL, previewJson: '/plans/branch.json', worktree: '/wt', role: 'branch', label: 'T-1' })
  const cardKey = JSON.stringify(['branch', 'T-1', 'demo', 'dev'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'demo / dev' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^TARGET/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^BASE GIT/ })).toBeDefined()
    for (const hidden of [HEAD, '/plans/branch.json', '/plans/base.json', /"update":3/]) {
      expect(await ui.find({ type: 'Text', text: hidden })).toBeUndefined()
    }
    const details = await ui.find({ type: 'Button', key: `${cardKey}|details` })
    expect(details?.text).toBe('+ DETAILS')
    await ui.press({ key: `${cardKey}|details` })
    for (const shown of [HEAD, '/plans/branch.json', '/plans/base.json', /"update":3/, /^BASE PREVIEW/, /^SUMMARY/]) {
      expect(await ui.find({ type: 'Text', text: shown })).toBeDefined()
    }
    await expectPillsOnly(ui)
    await ui.press({ key: `${cardKey}|details` })
    await ui.unmount()
  }
})

test('chip SVGs grow with their text, escape it, and use only palette colours with square corners', async () => {
  const short = chipSvg('drift 1', PALETTE.drift, PALETTE.ink)
  const long = chipSvg('drift already pending 12', PALETTE.drift, PALETTE.ink)
  expect(short.width).toBe(Math.ceil(16 + 7 * 7.4))
  expect(long.width).toBeGreaterThan(short.width)
  expect(short.height).toBe(22)
  expect(short.alt).toBe('DRIFT 1')
  expect(short.source).toContain(`width="${short.width}"`)
  expect(short.source).toContain('<rect x="0.75" y="0.75"')
  expect(short.source).toContain('stroke-width="1.5"')

  const odd = chipSvg(`a&b<c>"d'`, PALETTE.warning, PALETTE.warnInk)
  expect(odd.source).toContain('A&amp;B&lt;C&gt;&quot;D&apos;')
  expect(odd.alt).toBe(`A&B<C>"D'`)
  expect(odd.width).toBe(Math.ceil(16 + 9 * 7.4))
  expect(chipSvg('−1 delete', PALETTE.delete, PALETTE.ink).width).toBe(Math.ceil(16 + 9 * 7.4))
  for (const svg of [short, long, odd]) {
    expectCleanSvg(svg.source)
  }
})

test('no Box in the pane carries a border, on desktop and terminal', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: applyPreview('production') })
  await start($)
  await registerBaseline($, 'production', rec.files)
  await registerApply($, 'production', {}, rec.files)
  const id = cardId('production')
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await first.press({ key: `${id}|approve` })
  await first.press({ key: `${id}|drift` })
  await first.press({ key: `${id}|drift|update|${urn('acme:core:Service', 'web', 'production')}` })
  await first.press({ key: `${id}|details` })
  await first.unmount()

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: `${id}|confirm` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- 80$/ })).toBeDefined()
    expectNoBorders(paneElements(await ui.drawn()))
    await expectPaletteOnly(ui)
    await expectPillsOnly(ui)
    await ui.unmount()
  }
})

test('the pending drift section counts drift steps only, like the header chip, when it also holds diagnostics', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  const shared = [{ message: 'shared note', severity: 'info' }]
  rec.files['/plans/base-staging.json'] = JSON.stringify({ ...preMergePreview('staging'), diagnostics: shared })
  rec.files['/plans/apply-staging.json'] = JSON.stringify({ ...applyPreview('staging'), diagnostics: shared })
  await call($)({ tool: TOOL, previewJson: '/plans/base-staging.json', worktree: BASE_WORKTREE, role: 'baseline' })
  await registerApply($, 'staging')
  const id = cardId('staging')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await findChip(ui, 'DRIFT 1')).toBeDefined()
    expect(sectionCount(await ui.drawn(), `${id}|drift`)).toBe('1')
    expect(sectionCount(await ui.drawn(), `${id}|no-longer-pending`)).toBe('1')
    await ui.press({ key: `${id}|drift` })
    expect(await ui.find({ type: 'Text', text: /DIAGNOSTICS ALSO IN THE BASELINE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'shared note' })).toBeDefined()
    expect(await findChip(ui, 'APPROVE ALL · 2 STEPS (1 CHANGE + 1 DRIFT) → demo/staging')).toBeDefined()
    await ui.press({ key: `${id}|drift` })
    await ui.unmount()
  }
})

test('a pill darkens 20% toward ink on hover', async () => {
  expect(PILL_KEYS.map(key => pillHoverFill(PALETTE[key]))).toEqual([
    '#0061bd',
    '#484fcd',
    '#536372',
    '#006c56',
    '#706c22',
    '#bc303a',
    '#95471e',
    '#0065d7',
  ])
})

test('every Button underlines on hover inside its own keyed wrapper that darkens its fill, keys distinct across cards', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerBaseline($, 'production', rec.files)
  await registerApply($, 'production', {}, rec.files)
  await registerApply($, 'staging', {}, rec.files)
  const cards = [cardId('production'), cardId('staging')]
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await first.press({ key: `${cards[0]}|approve` })
  await first.press({ key: `${cards[0]}|drift` })
  for (const id of cards) {
    await first.press({ key: `${id}|details` })
  }
  await first.unmount()

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    type Hovered = Node & { hover?: unknown }
    const buttons: Hovered[] = []
    const wrapped: { button: Hovered; box: Hovered }[] = []
    const walk = (node: Node) => {
      for (const child of node.children ?? []) {
        if (typeof child !== 'object' || child === null) continue
        const next = child as Node
        if (next.type === 'Button') buttons.push(next)
        if (node.type === 'Box' && next.type === 'Button') wrapped.push({ button: next, box: node })
        walk(next)
      }
    }
    walk((await ui.drawn()) as Node)
    expect(buttons.length).toBe((await ui.findAll({ type: 'Button' })).length)
    expect(buttons.length).toBeGreaterThan(cards.length * 4)
    for (const button of buttons) {
      expect(button.hover).toEqual({ underline: true })
    }
    expect(wrapped.length).toBe(buttons.length)
    const keys = wrapped.map(({ box }) => box.props?.key)
    for (const { button, box } of wrapped) {
      const key = String(button.props?.key)
      expect(typeof box.props?.key).toBe('string')
      expect(box.props?.key).toBe(cards.includes(key) ? `${key}|bar` : `${key}|pill`)
      expect(box.hover).toEqual({ backgroundColor: pillHoverFill(String(box.props?.backgroundColor)) })
    }
    expect(wrapped.filter(({ box }) => String(box.props?.key).endsWith('|bar')).length).toBe(cards.length)
    expect(new Set(keys).size).toBe(keys.length)
    await ui.unmount()
  }
})

const QUEUE = (stack: string) => urn('acme:core:Queue', 'jobs', stack)

function targetedPreview(stack: string) {
  const full = applyPreview(stack)

  return { ...full, steps: full.steps.filter(step => step.op !== 'update'), changeSummary: { create: 1, same: 4 } }
}

function recordState<T>(on: On, key: string): () => T | undefined {
  let last: T | undefined
  on('state.set', (_, e, next) => {
    if (e.plugin === 'pulumi-plan' && e.key === key) {
      last = (e.value as unknown as { value: T }).value
    }

    return next(e)
  })

  return () => last
}

type ApplyRun = { role: string; stack: string; runId?: string; registeredAt: number; targets?: string[]; steps: unknown[] }

const storedApply = (runs: ApplyRun[] | undefined, stack: string) => runs?.find(run => run.role === 'apply' && run.stack === stack)

test('an apply card with a pre-merge baseline, change and drift offers Approve all and Approve change only', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerBaseline($, 'staging', rec.files)
  const shown = await registerApply($, 'staging', {}, rec.files)
  await registerApply($, 'dev', {}, rec.files)
  expect(shown.result).toMatch(
    /two buttons, Approve all \(2 steps, drift included\) and Approve change only \(1 step via --target, 1 drift step left pending\)\. Do not call mcp__pulumi-plan__apply until the user says which one they pressed\./,
  )

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const id = cardId('staging')
    expect((await ui.find({ type: 'Button', key: `${id}|approve` }))?.text).toBe('APPROVE ALL · 2 STEPS (1 CHANGE + 1 DRIFT) → demo/staging')
    expect((await ui.find({ type: 'Button', key: `${id}|approve-change` }))?.text).toBe(
      'APPROVE CHANGE ONLY · 1 STEP (1 DRIFT LEFT PENDING) → demo/staging',
    )
    expect(await ui.find({ type: 'Text', text: /^Approve all runs every step below, drift included\. Approve change only runs this change's steps with --target/ })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: `${cardId('dev')}|approve` }))?.text).toBe('APPROVE APPLY · 2 STEPS → demo/dev')
    expect(await ui.find({ type: 'Button', key: `${cardId('dev')}|approve-change` })).toBeUndefined()
    await expectPillsOnly(ui)
    await expectPaletteOnly(ui)
    await ui.unmount()
  }
})

test('Approve change only re-previews and applies only the change URNs and leaves the stored apply run alone', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: targetedPreview('staging') })
  const runs = recordState<ApplyRun[]>(on, 'runs')
  await start($)
  await registerBaseline($, 'staging', rec.files)
  await registerApply($, 'staging', {}, rec.files)
  const before = storedApply(runs(), 'staging')
  const id = cardId('staging')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' as (typeof SURFACES)[number] })
  await ui.press({ key: `${id}|approve-change` })
  expect(await findChip(ui, /APPROVED 03:04 UTC, CHANGE ONLY \(1 TARGET\), ONE APPLY, VALID 15 MIN/)).toBeDefined()
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.result).toMatch(/pulumi up for demo\/staging \(change only, 1 target\) succeeded: exit 0/)
  expect(answer.result).toMatch(/The pending drift was not applied; applying it needs a new apply preview/)
  expect(rec.calls.slice(0, 7)).toEqual([
    'git status --porcelain',
    'git fetch origin main',
    'git rev-parse origin/main',
    'git rev-parse HEAD',
    'preview',
    'launch',
    'wait',
  ])
  expect(rec.argvs.find(argv => argv[2] === 'exec "$@"')).toEqual(previewArgv('staging', [QUEUE('staging')]))
  const jobDir = `${HOME_DIR}/.claude/pulumi-plan/jobs/20260102T030405Z-demo-staging`
  expect(rec.writes[`${jobDir}/run.sh`]).toContain(
    `'--suppress-outputs' '--target' '${QUEUE('staging')}' > '${jobDir}/up.log' 2>&1`,
  )
  expect(rec.writes[`${jobDir}/run.sh`]?.split("'--target'")).toHaveLength(2)
  const after = storedApply(runs(), 'staging')
  expect(after).toEqual(before)
  expect(after?.targets).toBeUndefined()
  expect(after?.steps).toHaveLength(2)
  expect(await findChip(ui, /CHANGE ONLY, 1 TARGET/)).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `${id}|approve-change` })).toBeUndefined()
  await expectPaletteOnly(ui)
  await ui.unmount()
})

test('a change-only re-preview with other steps is refused, launches nothing, and keeps the stored apply run', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: applyPreview('staging') })
  const runs = recordState<ApplyRun[]>(on, 'runs')
  await start($)
  await registerBaseline($, 'staging', rec.files)
  await registerApply($, 'staging', {}, rec.files)
  const before = storedApply(runs(), 'staging')
  const id = cardId('staging')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${id}|approve-change` })
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  const jobDir = `${HOME_DIR}/.claude/pulumi-plan/jobs/20260102T030405Z-demo-staging`
  expect(answer.deny).toMatch(/the targeted re-preview differs from the approved change steps \(1 new or changed step, 0 no longer present\)/)
  expect(answer.deny).toContain(`${jobDir}/preview.json`)
  expect(answer.deny).toMatch(/register a fresh apply preview/)
  expect(rec.calls).toContain('preview')
  expect(rec.calls).not.toContain('launch')
  expect(rec.argvs.find(argv => argv[2] === 'exec "$@"')).toEqual(previewArgv('staging', [QUEUE('staging')]))
  expect(storedApply(runs(), 'staging')).toEqual(before)
  expect(await findChip(ui, /APPLY REFUSED/)).toBeDefined()
  expect((await ui.find({ type: 'Button', key: `${id}|approve` }))?.text).toBe('APPROVE ALL · 2 STEPS (1 CHANGE + 1 DRIFT) → demo/staging')
  expect(await ui.find({ type: 'Button', key: `${id}|approve-change` })).toBeDefined()
  await ui.unmount()
})

test('on a production stack Approve change only arms, names the change steps, and the confirmed approval keeps its scope', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: targetedPreview('production') })
  const approvals = recordState<Record<string, unknown>>(on, 'approvals')
  await start($)
  await registerBaseline($, 'production', rec.files)
  await registerApply($, 'production', {}, rec.files)
  const id = cardId('production')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' as (typeof SURFACES)[number] })
  await ui.press({ key: `${id}|approve-change` })
  expect(
    await ui.find({
      type: 'Text',
      text: 'Production stack demo/production: this applies the 1 change step to production with --target and leaves 1 drift step pending. Confirm or cancel.',
    }),
  ).toBeDefined()
  expect(approvals()?.['demo/production']).toMatchObject({ status: 'armed', scope: 'change', targets: [QUEUE('production')] })
  const armed = await call($)({ tool: APPLY, project: 'demo', stack: 'production' })
  expect(armed.deny).toMatch(/armed but not confirmed/)

  await ui.press({ key: `${id}|confirm` })
  expect(approvals()?.['demo/production']).toMatchObject({ status: 'approved', scope: 'change', targets: [QUEUE('production')] })
  expect(await findChip(ui, /APPROVED 03:04 UTC, CHANGE ONLY \(1 TARGET\)/)).toBeDefined()
  await expectPillsOnly(ui)
  await ui.unmount()

  const confirmed = await call($)({ tool: APPLY, project: 'demo', stack: 'production' })
  expect(confirmed.result).toMatch(/\(change only, 1 target\) succeeded: exit 0/)
  expect(rec.argvs.find(argv => argv[2] === 'exec "$@"')).toEqual(previewArgv('production', [QUEUE('production')]))
})

test('a change step on a resource with pending drift offers no change-only button and says why', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  const web = urn('acme:core:Service', 'web', 'staging')
  const queue = QUEUE('staging')
  rec.files['/plans/base-staging.json'] = JSON.stringify({
    steps: [
      { op: 'create', urn: queue, newState: { urn: queue, inputs: { name: 'jobs' } } },
      {
        op: 'update',
        urn: web,
        oldState: { urn: web, id: 'w', inputs: { port: 80 } },
        newState: { urn: web, inputs: { port: 82 } },
        detailedDiff: { port: { kind: 'update', inputDiff: true } },
      },
    ],
    diagnostics: [],
  })
  await call($)({ tool: TOOL, previewJson: '/plans/base-staging.json', worktree: BASE_WORKTREE, role: 'baseline' })
  const shown = await registerApply($, 'staging', {}, rec.files)
  expect(shown.result).toMatch(
    /an Approve button\. .* Change only is not offered: 1 change step touches a resource that also has pending drift, so --target would apply that drift too\./,
  )
  const id = cardId('staging')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Button', key: `${id}|approve` }))?.text).toBe('APPROVE APPLY · 2 STEPS (1 CHANGE + 1 DRIFT) → demo/staging')
    expect(await ui.find({ type: 'Button', key: `${id}|approve-change` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'CHANGE ONLY NOT OFFERED' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 change step touches a resource that also has pending drift/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^An apply runs every step below, drift included\.$/ })).toBeDefined()
    await expectPaletteOnly(ui)
    await ui.unmount()
  }
})

test('a change set that moved after Approve change only is denied before any process', async ($, on) => {
  const { rec } = applyEngine(on, { rePreview: targetedPreview('staging') })
  await start($)
  await registerBaseline($, 'staging', rec.files)
  await registerApply($, 'staging', {}, rec.files)
  const id = cardId('staging')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${id}|approve-change` })
  expect(await findChip(ui, /CHANGE ONLY \(1 TARGET\)/)).toBeDefined()

  const legacy = urn('acme:core:Bucket', 'legacy', 'staging')
  rec.files['/plans/base-staging.json'] = JSON.stringify({
    steps: [{ op: 'delete', urn: legacy, oldState: { urn: legacy, id: 'legacy-1', inputs: { name: 'legacy' } } }],
    diagnostics: [],
  })
  await call($)({ tool: TOOL, previewJson: '/plans/base-staging.json', worktree: BASE_WORKTREE, role: 'baseline' })
  expect(await findChip(ui, /APPROVED/)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `${id}|approve-change` })).toBeUndefined()
  await ui.unmount()
  rec.calls.length = 0

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.deny).toMatch(/the change set of demo\/staging moved since "Approve change only" was pressed/)
  expect(answer.deny).toMatch(/Approve change only"; for a production stack/)
  expect(rec.calls).toEqual([])
})

test('Approve all on a two-button card re-previews and applies every step without --target', async ($, on) => {
  const { rec } = applyEngine(on)
  await start($)
  await registerBaseline($, 'staging', rec.files)
  await registerApply($, 'staging', {}, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `${cardId('staging')}|approve` })
  expect(await findChip(ui, /^ ?APPROVED 03:04 UTC, ONE APPLY, VALID 15 MIN ?$/)).toBeDefined()
  await ui.unmount()

  const answer = await call($)({ tool: APPLY, project: 'demo', stack: 'staging' })

  expect(answer.result).toMatch(/pulumi up for demo\/staging succeeded: exit 0/)
  expect(answer.result).not.toMatch(/change only|pending drift was not applied/)
  expect(rec.argvs.find(argv => argv[2] === 'exec "$@"')).toEqual(previewArgv('staging', undefined))
  const script = Object.entries(rec.writes).find(([path]) => path.endsWith('/run.sh'))?.[1] ?? ''
  expect(script).toContain(`'--suppress-outputs' > `)
  expect(script).not.toContain('--target')
})

const THEME_PATH = `${HOME_DIR}/.claude/pulumi-plan/theme.json`

type Command = { command: { run: (input: { command: string; args?: string }) => Promise<Answer> } }

const runCommand = ($: unknown, args: string) => ($ as Command).command.run({ command: 'pulumi-plan', args })

function recordUi(on: On, { isPaneOpen = false } = {}) {
  const opened: string[] = []
  const toasts: string[] = []
  on('ui.open', { id: 'pulumi-plan' }, (_, e, next) => {
    opened.push(String(e.backgroundColor))

    return next(e)
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: isPaneOpen ? [{ id: 'pulumi-plan', title: 'Pulumi plan', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))

  return { opened, toasts }
}

async function drawnColors(ui: AnyPane): Promise<Set<string>> {
  const colors = new Set<string>()
  for (const { node } of paneElements(await ui.drawn())) {
    for (const prop of ['color', 'backgroundColor'] as const) {
      if (node.props?.[prop] !== undefined) colors.add(String(node.props[prop]))
    }
    const hover = (node as { hover?: { backgroundColor?: unknown } }).hover
    if (hover?.backgroundColor !== undefined) colors.add(String(hover.backgroundColor))
    if (node.type === 'Svg') {
      for (const hex of String(node.props?.source).match(/#[0-9a-fA-F]{6}\b/g) ?? []) colors.add(hex)
    }
  }

  return colors
}

async function expectThemeColors(ui: AnyPane, colors: Record<string, string>) {
  const palette: Record<string, string> = { ...PALETTE, ...colors }
  const allowed = new Set([...Object.values(palette), ...PILL_KEYS.map(key => pillHoverFill(palette[key] ?? '', palette.ink))])
  const drawn = await drawnColors(ui)
  expect([...drawn].filter(color => !allowed.has(color))).toEqual([])
  for (const [key, color] of Object.entries(colors)) {
    expect(`${key} ${color}: ${drawn.has(color)}`).toBe(`${key} ${color}: true`)
    const fallback = PALETTE[key as keyof typeof PALETTE]
    expect(`${key} default ${fallback}: ${drawn.has(fallback)}`).toBe(`${key} default ${fallback}: false`)
  }
}

const DARK = { paper: '#0d1117', ink: '#e6edf3', accent: '#8957e5', pillCard: '#1f6feb' }

test('a theme file present at session start colours the pane, its pills, chips, banner and background', async ($, on) => {
  const { opened, toasts } = recordUi(on)
  const { rec } = applyEngine(on)
  rec.files[THEME_PATH] = JSON.stringify({ colors: DARK, font: 'Iosevka Term, monospace' })
  await start($)
  await registerBaseline($, 'staging', rec.files)
  await registerApply($, 'staging', {}, rec.files)

  expect(toasts).toEqual([])
  expect(opened.at(-1)).toBe(DARK.paper)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await expectThemeColors(ui, DARK)
    type Hovered = Node & { hover?: unknown }
    const byKey = async (key: string) => paneElements(await ui.drawn()).find(({ node }) => node.props?.key === key)?.node as Hovered | undefined
    const bar = await byKey(`${cardId('staging')}|bar`)
    const approve = await byKey(`${cardId('staging')}|approve|pill`)
    expect(bar?.props?.backgroundColor).toBe(DARK.pillCard)
    expect(bar?.hover).toEqual({ backgroundColor: pillHoverFill(DARK.pillCard, DARK.ink) })
    expect(approve?.props?.backgroundColor).toBe(DARK.accent)
    expect(approve?.hover).toEqual({ backgroundColor: pillHoverFill(DARK.accent, DARK.ink) })
    if (surface === 'desktop') {
      const banner = (await ui.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt).startsWith('PULUMI PLAN'))
      expect(String(banner?.props.source)).toContain('font-family="Iosevka Term, monospace"')
      expectWellFormed(String(banner?.props.source))
    }
    await ui.unmount()
  }
})

test('/pulumi-plan theme rereads the file, reports it, and the open pane redraws with the new colours', async ($, on) => {
  const { opened } = recordUi(on, { isPaneOpen: true })
  const { rec } = applyEngine(on)
  rec.files[THEME_PATH] = JSON.stringify({ colors: { pillCard: '#1f6feb' } })
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' as (typeof SURFACES)[number] })
  await expectThemeColors(ui, { pillCard: '#1f6feb' })

  rec.files[THEME_PATH] = JSON.stringify({ colors: { pillCard: '#8250df', paper: '#fdf6e3', ink: 'navy' }, font: 'Fira Code' })
  const answer = await runCommand($, 'theme')

  expect(answer.text).toBe(
    [
      `Theme file ${THEME_PATH}: 2 colour overrides and the font "Fira Code" in effect.`,
      '1 problem, each ignored (what it names keeps its default):',
      '- "ink" in "colors" is "navy", not a "#rrggbb" colour',
    ].join('\n'),
  )
  await expectThemeColors(ui, { pillCard: '#8250df', paper: '#fdf6e3' })
  expect(opened.at(-1)).toBe('#fdf6e3')

  delete rec.files[THEME_PATH]
  expect((await runCommand($, 'theme')).text).toBe(`No theme file at ${THEME_PATH}: the Pulumi plan pane uses its default look.`)
  await expectPaletteOnly(ui)
  expect(opened.at(-1)).toBe(PALETTE.paper)
  await ui.unmount()
})

test('/pulumi-plan theme leaves a closed pane closed', async ($, on) => {
  const { opened } = recordUi(on)
  const { rec } = applyEngine(on)
  await start($)
  rec.files[THEME_PATH] = '{}'

  expect((await runCommand($, 'theme')).text).toBe(`Theme file ${THEME_PATH}: 0 colour overrides and no font override in effect.`)
  expect(opened).toEqual([])
})

for (const [kind, broken] of [
  ['invalid JSON', '{ "colors": { "paper": '],
  ['a bad colour', '{ "colors": { "paper": "dark" } }'],
  ['a root that is not an object', '[]'],
] as const) {
  test(`a theme file with ${kind} leaves the default look, still draws the pane, and toasts once at session start`, async ($, on) => {
    const { opened, toasts } = recordUi(on)
    const { rec } = applyEngine(on)
    rec.files[THEME_PATH] = broken
    await start($)
    await registerBaseline($, 'staging', rec.files)
    await registerApply($, 'staging', {}, rec.files)

    expect(toasts).toEqual([`The theme file ${THEME_PATH} has 1 problem; /pulumi-plan theme lists them.`])
    expect(opened.at(-1)).toBe(PALETTE.paper)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await findChip(ui, 'APPROVE ALL · 2 STEPS (1 CHANGE + 1 DRIFT) → demo/staging')).toBeDefined()
      await expectPaletteOnly(ui)
      await expectPillsOnly(ui)
      await ui.unmount()
    }
  })
}

test('with HOME unset the theme is the default and /pulumi-plan theme says why', async ($, on) => {
  engine(on)
  mock.env(on, {})
  const { toasts } = recordUi(on)
  await start($)

  expect(toasts).toEqual([])
  expect((await runCommand($, 'theme')).text).toMatch(/^HOME is not set/)
})

test('a risk label shows as a chip with its reason, and a preview without one says so', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const base = await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/wt', role: 'baseline' })
  const branch = await call($)({
    tool: TOOL,
    previewJson: '/plans/branch.json',
    worktree: '/wt',
    role: 'branch',
    label: 'T-1',
    risk: 'high',
    riskReason: 'Replacing the web service drops\nevery open session.',
  })

  expect(base.result).toMatch(/^risk: not set/m)
  expect(branch.result).toMatch(/^risk: high \(definite customer impact\) · Replacing the web service drops every open session\.$/m)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await findChip(ui, 'HIGH RISK')).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Replacing the web service drops every open session.' })).toBeDefined()
    await expectPaletteOnly(ui)
  }
})

test('each risk level draws its own chip colours', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const levels = [
    ['low', 'LOW RISK', PALETTE.riskLow, PALETTE.ink],
    ['medium', 'MEDIUM RISK', PALETTE.riskMedium, PALETTE.ink],
    ['high', 'HIGH RISK', PALETTE.riskHigh, PALETTE.onAccent],
  ] as const
  for (const [risk] of levels) {
    await call($)({ tool: TOOL, previewJson: '/plans/branch.json', worktree: '/wt', role: 'branch', label: `T-${risk}`, risk })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const [, label, fill, ink] of levels) {
    const svg = (await ui.findAll({ type: 'Svg' })).find(node => String(node.props.alt) === label)
    expect(String(svg?.props.source)).toBe(chipSvg(label, fill, ink).source)
  }
})

test('an unknown risk level or an overlong reason is refused', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const odd = await call($)({ tool: TOOL, previewJson: '/plans/base.json', worktree: '/wt', role: 'baseline', risk: 'severe' })
  const long = await call($)({
    tool: TOOL,
    previewJson: '/plans/base.json',
    worktree: '/wt',
    role: 'baseline',
    risk: 'low',
    riskReason: 'x'.repeat(301),
  })

  expect(odd.text ?? odd.deny).toMatch(/risk must be "low", "medium" or "high"/)
  expect(long.text ?? long.deny).toMatch(/riskReason must be at most 300 characters/)
})

test('a preset in the theme file draws the pane in that theme, and /pulumi-plan theme list marks it', async ($, on) => {
  recordUi(on, { isPaneOpen: true })
  const { rec } = applyEngine(on)
  rec.files[THEME_PATH] = JSON.stringify({ preset: 'solarized-dark', colors: { pillCard: '#1f6feb' } })
  await start($)
  await registerApply($, 'staging', {}, rec.files)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' as (typeof SURFACES)[number] })

  const drawn = await drawnColors(ui)
  const solarized = THEME_PRESETS['solarized-dark']
  for (const color of [solarized.paper, solarized.card, solarized.ink, solarized.accent, '#1f6feb']) {
    expect(`${color}: ${drawn.has(color)}`).toBe(`${color}: true`)
  }
  for (const color of [PALETTE.paper, PALETTE.ink, solarized.pillCard]) {
    expect(`${color}: ${drawn.has(color)}`).toBe(`${color}: false`)
  }
  const listed = (await runCommand($, 'theme list')).text ?? ''
  expect(listed).toContain('- solarized-dark (in effect)')
  expect(listed).not.toContain('- default (in effect)')
})
