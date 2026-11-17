import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_PALETTE,
  DEFAULT_THEME,
  MONO_FONT,
  PILL_KEYS,
  PRESET_NAMES,
  THEME_PRESETS,
  bannerSvg,
  chipSvg,
  describePresets,
  describeTheme,
  parseTheme,
  pillHoverFill,
  resolveTheme,
} from './style'
import type { Palette, PaletteKey } from './style'

describe('theme file', () => {
  test('valid colours and a font overlay the defaults key by key', async () => {
    const parsed = parseTheme(JSON.stringify({ colors: { paper: '#101820', ink: '#F0F0F0' }, font: 'Iosevka, monospace' }))

    expect(parsed.problems).toEqual([])
    expect(parsed.theme).toEqual({ colors: { paper: '#101820', ink: '#F0F0F0' }, font: 'Iosevka, monospace' })
    const theme = resolveTheme(parsed.theme)
    expect(theme.palette).toEqual({ ...DEFAULT_PALETTE, paper: '#101820', ink: '#F0F0F0' })
    expect(theme.font).toBe('Iosevka, monospace')
  })

  test('{} and a file with only empty colours change nothing and report nothing', async () => {
    for (const text of ['{}', '{ "colors": {} }']) {
      const parsed = parseTheme(text)
      expect(parsed).toEqual({ theme: { colors: {} }, problems: [] })
      expect(resolveTheme(parsed.theme)).toEqual(DEFAULT_THEME)
    }
  })

  test('invalid JSON and a root that is not an object are one problem each and change nothing', async () => {
    for (const text of ['{ "colors": ', '', '[1, 2]', 'null', '"#000000"']) {
      const parsed = parseTheme(text)
      expect(parsed.theme).toEqual({ colors: {} })
      expect(parsed.problems).toHaveLength(1)
    }
    expect(parseTheme('{ "colors": ').problems[0]).toMatch(/^not valid JSON: /)
    expect(parseTheme('[1, 2]').problems[0]).toBe('the file must hold a JSON object, not [1,2]')
  })

  test('each bad entry is a problem and is ignored while the good ones apply', async () => {
    const parsed = parseTheme(
      JSON.stringify({
        colors: { paper: '#101820', paperr: '#000000', ink: 12, card: 'white', panel: '#fff', accent: '#5a58eb ' },
        font: '',
        colours: {},
      }),
    )

    expect(parsed.theme).toEqual({ colors: { paper: '#101820' } })
    expect(parsed.problems).toEqual([
      '"colours" is not read: only "preset", "colors" and "font" are',
      '"paperr" in "colors" is not a palette key',
      '"ink" in "colors" is 12, not a string',
      '"card" in "colors" is "white", not a "#rrggbb" colour',
      '"panel" in "colors" is "#fff", not a "#rrggbb" colour',
      '"accent" in "colors" is "#5a58eb ", not a "#rrggbb" colour',
      '"font" is "", not a CSS font-family string of 1 to 200 characters',
    ])
    expect(resolveTheme(parsed.theme).palette).toEqual({ ...DEFAULT_PALETTE, paper: '#101820' })
  })

  test('colors that is not an object, and a font that is not a string or too long, are problems', async () => {
    expect(parseTheme('{ "colors": ["#000000"] }').problems).toEqual([
      '"colors" must be an object of palette keys to "#rrggbb" colours, not ["#000000"]',
    ])
    expect(parseTheme('{ "colors": null }').problems).toHaveLength(1)
    expect(parseTheme('{ "font": 3 }')).toEqual({
      theme: { colors: {} },
      problems: ['"font" is 3, not a CSS font-family string of 1 to 200 characters'],
    })
    expect(parseTheme(JSON.stringify({ font: '   ' })).problems).toHaveLength(1)
    expect(parseTheme(JSON.stringify({ font: 'a'.repeat(201) })).problems).toHaveLength(1)
    expect(parseTheme(JSON.stringify({ font: 'a'.repeat(200) })).theme.font).toBe('a'.repeat(200))
  })

  test('a palette key inherited from Object is not a palette key', async () => {
    expect(parseTheme('{ "colors": { "constructor": "#000000", "__proto__": "#000000" } }').problems).toEqual([
      '"constructor" in "colors" is not a palette key',
      '"__proto__" in "colors" is not a palette key',
    ])
  })

  test('a stored theme with entries no file could pass is resolved to the defaults for them', async () => {
    const theme = resolveTheme({ colors: { paper: '"/><script>', nope: '#000000', ink: '#123456' }, font: '' })

    expect(theme.palette).toEqual({ ...DEFAULT_PALETTE, ink: '#123456' })
    expect(theme.font).toBe(MONO_FONT)
  })

  test('the report names the file, the overrides in effect and each problem', async () => {
    const path = '/home/u/.claude/pulumi-plan/theme.json'

    expect(describeTheme({ path: null, isFound: false, theme: { colors: {} }, problems: [] })).toMatch(/^HOME is not set/)
    expect(describeTheme({ path, isFound: false, theme: { colors: {} }, problems: [] })).toBe(
      `No theme file at ${path}: the Pulumi plan pane uses its default look.`,
    )
    expect(describeTheme({ path, isFound: true, theme: { colors: { paper: '#000000' }, font: 'Iosevka' }, problems: [] })).toBe(
      `Theme file ${path}: 1 colour override and the font "Iosevka" in effect.`,
    )
    expect(describeTheme({ path, isFound: true, ...parseTheme('{ "colors": { "ink": "red", "card": "#000000", "panel": "#111111" } }') })).toBe(
      [
        `Theme file ${path}: 2 colour overrides and no font override in effect.`,
        '1 problem, each ignored (what it names keeps its default):',
        '- "ink" in "colors" is "red", not a "#rrggbb" colour',
      ].join('\n'),
    )
  })
})

describe('themed drawing', () => {
  const dark = resolveTheme({ colors: { ink: '#e6edf3', card: '#161b22', muted: '#8b949e' }, font: 'Iosevka "Term"' })

  test('the banner and chips draw with the theme and escape its font', async () => {
    const banner = bannerSvg('PULUMI PLAN', 'DEMO', dark)
    expect(banner).toContain('fill="#e6edf3"')
    expect(banner).toContain('fill="#161b22" stroke="#e6edf3"')
    expect(banner).toContain('fill="#8b949e"')
    expect(banner).toContain('font-family="Iosevka &quot;Term&quot;"')
    expect(banner).not.toContain(DEFAULT_PALETTE.ink)

    const chip = chipSvg('drift 1', '#30363d', dark.palette.ink, dark)
    expect(chip.source).toContain('fill="#30363d" stroke="#e6edf3"')
    expect(chip.source).toContain('font-family="Iosevka &quot;Term&quot;"')
  })

  test('without a theme the banner and chips are what the defaults draw', async () => {
    expect(bannerSvg('A', 'B')).toBe(bannerSvg('A', 'B', resolveTheme({ colors: {} })))
    expect(chipSvg('x', DEFAULT_PALETTE.drift, DEFAULT_PALETTE.ink)).toEqual(
      chipSvg('x', DEFAULT_PALETTE.drift, DEFAULT_PALETTE.ink, resolveTheme({ colors: {} })),
    )
  })

  test('a pill darkens 20% toward the ink it is given', async () => {
    expect(pillHoverFill('#000000', '#ffffff')).toBe('#333333')
    expect(pillHoverFill('#006fd7')).toBe(pillHoverFill('#006fd7', DEFAULT_PALETTE.ink))
  })
})

describe('bundled themes', () => {
  test('a preset sets the palette and colours still override single keys of it', async () => {
    const parsed = parseTheme(JSON.stringify({ preset: 'dark', colors: { accent: '#123456' } }))

    expect(parsed).toEqual({ theme: { preset: 'dark', colors: { accent: '#123456' } }, problems: [] })
    expect(resolveTheme(parsed.theme).palette).toEqual({ ...DEFAULT_PALETTE, ...THEME_PRESETS.dark, accent: '#123456' })
  })

  test('the default preset is the same as no preset', async () => {
    const parsed = parseTheme('{ "preset": "default" }')

    expect(parsed).toEqual({ theme: { colors: {} }, problems: [] })
    expect(resolveTheme(parsed.theme)).toEqual(DEFAULT_THEME)
  })

  test('an unknown preset is a problem and keeps the default look', async () => {
    for (const preset of ['nope', 7, 'toString']) {
      const parsed = parseTheme(JSON.stringify({ preset }))

      expect(parsed.theme).toEqual({ colors: {} })
      expect(parsed.problems).toEqual([
        `"preset" is ${JSON.stringify(preset)}, not one of "default", "dark", "solarized-dark", "high-contrast"`,
      ])
    }
  })

  test('the report names the preset in effect, and the list marks it', async () => {
    const path = '/home/u/.claude/pulumi-plan/theme.json'

    expect(describeTheme({ path, isFound: true, ...parseTheme('{ "preset": "high-contrast" }') })).toBe(
      `Theme file ${path}: the "high-contrast" theme with 0 colour overrides and no font override in effect.`,
    )
    expect(describePresets('dark')).toContain('- dark (in effect)')
    expect(describePresets(undefined)).toContain('- default (in effect)')
  })

  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map(at => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255

      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)

    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
  }
  const pairs = (P: Palette): [string, PaletteKey, PaletteKey | string, number][] => [
    ...(['ink', 'muted', 'faint'] as const).flatMap(fg =>
      (['card', 'panel', 'accentPaper'] as const).map(bg => [`${fg} on ${bg}`, fg, bg, 4.5] as [string, PaletteKey, PaletteKey, number]),
    ),
    ...(['warning', 'create', 'update', 'replace', 'delete', 'drift', 'pendingDrift', 'info', 'accentSoft', 'riskLow', 'riskMedium'] as const).map(
      bg => [`ink on ${bg}`, 'ink', bg, 4.5] as [string, PaletteKey, PaletteKey, number],
    ),
    ['warnInk on warning', 'warnInk', 'warning', 4.5],
    ['warnInk on card', 'warnInk', 'card', 4.5],
    ['dangerInk on accentPaper', 'dangerInk', 'accentPaper', 4.5],
    ['dangerInk on removedBg', 'dangerInk', 'removedBg', 4.5],
    ['removedInk on removedBg', 'removedInk', 'removedBg', 4.5],
    ['addedInk on addedBg', 'addedInk', 'addedBg', 4.5],
    ['logInk on logBg', 'logInk', 'logBg', 4.5],
    ...(['accent', 'ok', 'danger', 'riskHigh', ...PILL_KEYS] as const).flatMap(bg => [
      [`onAccent on ${bg}`, 'onAccent', bg, 3] as [string, PaletteKey, PaletteKey, number],
      [`onAccent on ${bg} hovered`, 'onAccent', pillHoverFill(P[bg], P.ink), 3] as [string, PaletteKey, string, number],
    ]),
  ]

  for (const name of PRESET_NAMES.filter(name => name !== 'default')) {
    test(`the ${name} preset keeps the documented contrast`, async () => {
      const P = resolveTheme({ preset: name, colors: {} }).palette
      const weak = pairs(P)
        .map(([pair, fg, bg, min]) => ({ pair, ratio: contrast(P[fg], bg.startsWith('#') ? bg : P[bg as PaletteKey]), min }))
        .filter(({ ratio, min }) => ratio < min)
        .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(2)}`)

      expect(weak).toEqual([])
    })
  }
})
