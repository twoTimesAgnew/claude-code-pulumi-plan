import type { PlanTheme } from '../types'

export const DEFAULT_PALETTE = {
  paper: '#edf7fe',
  card: '#ffffff',
  panel: '#f9fafb',
  ink: '#002a54',
  muted: '#49545c',
  faint: '#68717a',
  divider: '#d1d4d6',
  accent: '#5a58eb',
  accentSoft: '#dfe5fb',
  accentPaper: '#eef2ff',
  onAccent: '#ffffff',
  create: '#abf6d3',
  update: '#fff38e',
  replace: '#f9c8c7',
  delete: '#fbe1e1',
  drift: '#e5e6e8',
  pendingDrift: '#ffe48b',
  info: '#d3e4f9',
  warning: '#fff2c9',
  removedBg: '#fef2f2',
  removedInk: '#7c1918',
  addedBg: '#ecfdf5',
  addedInk: '#034f3b',
  danger: '#eb3233',
  dangerInk: '#ad080a',
  ok: '#009c69',
  okInk: '#034f3b',
  warnInk: '#ba4e11',
  logBg: '#0c1926',
  logInk: '#f3f4f4',
  pillCard: '#006fd7',
  pillNeutral: '#68717a',
  pillCreate: '#007d57',
  pillUpdate: '#8c7c16',
  pillDanger: '#eb3233',
  pillPending: '#ba4e11',
  pillInfo: '#0074f8',
  riskLow: '#abf6d3',
  riskMedium: '#ffe48b',
  riskHigh: '#ad080a',
} as const

export type PaletteKey = keyof typeof DEFAULT_PALETTE

export type Palette = Record<PaletteKey, string>

export const PILL_KEYS = [
  'pillCard',
  'accent',
  'pillNeutral',
  'pillCreate',
  'pillUpdate',
  'pillDanger',
  'pillPending',
  'pillInfo',
] as const satisfies readonly PaletteKey[]

export type PillKey = (typeof PILL_KEYS)[number]

export const THEME_PRESETS = {
  default: {},
  dark: {
    paper: '#0d1117',
    card: '#161b22',
    panel: '#1c2129',
    ink: '#e6edf3',
    muted: '#b1bac4',
    faint: '#8b949e',
    divider: '#30363d',
    accent: '#6e40c9',
    accentSoft: '#2d2459',
    accentPaper: '#1b1730',
    create: '#1b4332',
    update: '#4b3f0b',
    replace: '#5c1f22',
    delete: '#45232a',
    drift: '#30363d',
    pendingDrift: '#5a4210',
    info: '#173a5e',
    warning: '#3a2f12',
    removedBg: '#3c1618',
    removedInk: '#ffb1ab',
    addedBg: '#0f2d1d',
    addedInk: '#7ee2a8',
    danger: '#b62324',
    dangerInk: '#ff9492',
    ok: '#1a7f37',
    warnInk: '#f2b45a',
    logBg: '#010409',
    logInk: '#e6edf3',
    pillCard: '#1f5fbf',
    pillNeutral: '#484f58',
    pillCreate: '#176b2c',
    pillUpdate: '#7d6008',
    pillDanger: '#b62324',
    pillPending: '#9a4a07',
    pillInfo: '#1f5fbf',
    riskLow: '#1b4332',
    riskMedium: '#5a4210',
    riskHigh: '#b62324',
  },
  'solarized-dark': {
    paper: '#002b36',
    card: '#073642',
    panel: '#0a3f4c',
    ink: '#fdf6e3',
    muted: '#b8c4c4',
    faint: '#9fb0b0',
    divider: '#586e75',
    accent: '#5459b0',
    accentSoft: '#2e3a6b',
    accentPaper: '#0b3340',
    onAccent: '#fdf6e3',
    create: '#1f4a2a',
    update: '#4d4000',
    replace: '#5c1f1e',
    delete: '#4a2326',
    drift: '#134552',
    pendingDrift: '#5a3d00',
    info: '#0f4a6e',
    warning: '#3d3500',
    removedBg: '#3b1a1a',
    removedInk: '#ffb3ae',
    addedBg: '#123d26',
    addedInk: '#a8e6a1',
    danger: '#c02a27',
    dangerInk: '#ff9b97',
    ok: '#4f6b00',
    okInk: '#a8e6a1',
    warnInk: '#e8a54b',
    logBg: '#001e26',
    logInk: '#eee8d5',
    pillCard: '#1f6fa8',
    pillNeutral: '#4a5f66',
    pillCreate: '#4f6b00',
    pillUpdate: '#7a6500',
    pillDanger: '#c02a27',
    pillPending: '#a63d10',
    pillInfo: '#1f6fa8',
    riskLow: '#1f4a2a',
    riskMedium: '#5a3d00',
    riskHigh: '#c02a27',
  },
  'high-contrast': {
    paper: '#ffffff',
    card: '#ffffff',
    panel: '#f2f2f2',
    ink: '#000000',
    muted: '#1a1a1a',
    faint: '#333333',
    divider: '#000000',
    accent: '#0000c8',
    accentSoft: '#d6d6ff',
    accentPaper: '#f0f0ff',
    create: '#b8f5c8',
    update: '#fff27a',
    replace: '#ffc2c2',
    delete: '#ffd6d6',
    drift: '#e0e0e0',
    pendingDrift: '#ffd966',
    info: '#cce0ff',
    warning: '#fff0b3',
    removedBg: '#ffe5e5',
    removedInk: '#7a0000',
    addedBg: '#e5ffef',
    addedInk: '#00451f',
    danger: '#b00000',
    dangerInk: '#8b0000',
    ok: '#006b2e',
    okInk: '#00451f',
    warnInk: '#7a3300',
    logBg: '#000000',
    logInk: '#ffffff',
    pillCard: '#003f8a',
    pillNeutral: '#404040',
    pillCreate: '#005c2e',
    pillUpdate: '#5c5000',
    pillDanger: '#b00000',
    pillPending: '#7a3300',
    pillInfo: '#0047b3',
    riskLow: '#b8f5c8',
    riskMedium: '#ffd966',
    riskHigh: '#8b0000',
  },
} as const satisfies Record<string, Partial<Palette>>

export type PresetName = keyof typeof THEME_PRESETS

export const PRESET_NAMES = Object.keys(THEME_PRESETS) as PresetName[]

export function isPresetName(name: unknown): name is PresetName {
  return typeof name === 'string' && Object.hasOwn(THEME_PRESETS, name)
}

export function pillHoverFill(fill: string, ink: string = DEFAULT_PALETTE.ink): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)

  return `#${[1, 3, 5]
    .map(at => {
      const v = channel(fill, at)

      return Math.round(v + (channel(ink, at) - v) * 0.2).toString(16).padStart(2, '0')
    })
    .join('')}`
}

export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export type Theme = { palette: Palette; font: string }

export const DEFAULT_THEME: Theme = { palette: DEFAULT_PALETTE, font: MONO_FONT }

const THEME_HEX = /^#[0-9a-fA-F]{6}$/

const THEME_FONT_LIMIT = 200

export type ParsedTheme = { theme: PlanTheme; problems: string[] }

export type ThemeLoad = ParsedTheme & { path: string | null; isFound: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPaletteKey(key: string): key is PaletteKey {
  return Object.hasOwn(DEFAULT_PALETTE, key)
}

function isFont(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= THEME_FONT_LIMIT
}

function shown(value: unknown): string {
  const json = JSON.stringify(value) ?? String(value)

  return json.length > 40 ? `${json.slice(0, 39)}…` : json
}

export function parseTheme(text: string): ParsedTheme {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (error) {
    return { theme: { colors: {} }, problems: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!isRecord(root)) {
    return { theme: { colors: {} }, problems: [`the file must hold a JSON object, not ${shown(root)}`] }
  }
  const problems = Object.keys(root)
    .filter(key => key !== 'preset' && key !== 'colors' && key !== 'font')
    .map(key => `${shown(key)} is not read: only "preset", "colors" and "font" are`)
  if (root.preset !== undefined && !isPresetName(root.preset)) {
    problems.push(`"preset" is ${shown(root.preset)}, not one of ${PRESET_NAMES.map(name => `"${name}"`).join(', ')}`)
  }
  const colors: Record<string, string> = {}
  const given = root.colors === undefined ? {} : root.colors
  if (!isRecord(given)) {
    problems.push(`"colors" must be an object of palette keys to "#rrggbb" colours, not ${shown(given)}`)
  } else {
    for (const [key, value] of Object.entries(given)) {
      if (!isPaletteKey(key)) {
        problems.push(`${shown(key)} in "colors" is not a palette key`)
      } else if (typeof value !== 'string') {
        problems.push(`${shown(key)} in "colors" is ${shown(value)}, not a string`)
      } else if (!THEME_HEX.test(value)) {
        problems.push(`${shown(key)} in "colors" is ${shown(value)}, not a "#rrggbb" colour`)
      } else {
        colors[key] = value
      }
    }
  }
  if (root.font !== undefined && !isFont(root.font)) {
    problems.push(`"font" is ${shown(root.font)}, not a CSS font-family string of 1 to ${THEME_FONT_LIMIT} characters`)
  }

  return {
    theme: {
      ...(isPresetName(root.preset) && root.preset !== 'default' ? { preset: root.preset } : {}),
      colors,
      ...(isFont(root.font) ? { font: root.font } : {}),
    },
    problems,
  }
}

export function resolveTheme(theme: PlanTheme): Theme {
  const palette: Palette = { ...DEFAULT_PALETTE, ...(isPresetName(theme.preset) ? THEME_PRESETS[theme.preset] : {}) }
  for (const [key, value] of Object.entries(theme.colors)) {
    if (isPaletteKey(key) && THEME_HEX.test(value)) {
      palette[key] = value
    }
  }

  return { palette, font: isFont(theme.font) ? theme.font : MONO_FONT }
}

export function describeTheme(load: ThemeLoad): string {
  if (load.path === null) {
    return 'HOME is not set, so there is no theme file to read: the Pulumi plan pane keeps its default look.'
  }
  if (!load.isFound) {
    return `No theme file at ${load.path}: the Pulumi plan pane uses its default look.`
  }
  const { preset, colors, font } = load.theme
  const lines = [
    `Theme file ${load.path}: ${preset === undefined ? '' : `the "${preset}" theme with `}${plural(Object.keys(colors).length, 'colour override')} and ${font === undefined ? 'no font override' : `the font ${JSON.stringify(font)}`} in effect.`,
  ]
  if (load.problems.length > 0) {
    lines.push(`${plural(load.problems.length, 'problem')}, each ignored (what it names keeps its default):`, ...load.problems.map(p => `- ${p}`))
  }

  return lines.join('\n')
}

export function describePresets(current: string | undefined): string {
  return [
    'Bundled themes (set "preset" in the theme file, then /pulumi-plan theme):',
    ...PRESET_NAMES.map(name => `- ${name}${(current ?? 'default') === name ? ' (in effect)' : ''}`),
    'Entries in "colors" still override single keys of the chosen theme.',
  ].join('\n')
}

export const LABEL_WIDTH = 13

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

export function bannerSvg(title: string, subtitle: string, theme: Theme = DEFAULT_THEME): string {
  const font = escapeXml(theme.font)
  const P = theme.palette

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="76" viewBox="0 0 480 76">',
    `<rect x="5" y="5" width="474" height="70" fill="${P.ink}"/>`,
    `<rect x="1" y="1" width="472" height="68" fill="${P.card}" stroke="${P.ink}" stroke-width="2"/>`,
    `<text x="18" y="32" font-family="${font}" font-size="22" font-weight="700" letter-spacing="3" fill="${P.ink}">${escapeXml(title)}</text>`,
    `<text x="18" y="54" font-family="${font}" font-size="13" letter-spacing="1" fill="${P.muted}">${escapeXml(subtitle)}</text>`,
    '</svg>',
  ].join('')
}

export function metaLabel(label: string): string {
  return label.toUpperCase().padEnd(LABEL_WIDTH, ' ')
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export type ChipSvg = { source: string; width: number; height: number; alt: string }

export function chipSvg(text: string, fill: string, ink: string, theme: Theme = DEFAULT_THEME): ChipSvg {
  const label = text.toUpperCase()
  const width = Math.ceil(16 + [...label].length * 7.4)
  const height = 22
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" fill="${fill}" stroke="${theme.palette.ink}" stroke-width="1.5"/>`,
    `<text x="8" y="15" font-family="${escapeXml(theme.font)}" font-size="11" font-weight="600" letter-spacing="0.5" fill="${ink}">${escapeXml(label)}</text>`,
    '</svg>',
  ].join('')

  return { source, width, height, alt: label }
}
