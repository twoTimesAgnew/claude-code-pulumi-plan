---
name: theme
description: Restyle the Pulumi plan pane of the pulumi-plan mod by writing its theme file. Use when the user wants to change the Pulumi plan pane's colours or font, make the pulumi-plan mod or its pane dark (or light), re-theme, restyle, recolour or rebrand the Pulumi plan pane, match it to a brand or an editor theme, or reset the pane's look to its default.
---

# Pulumi plan pane theme

The pane's look comes from one optional file: `$HOME/.claude/pulumi-plan/theme.json`. Change only that file. Never edit the mod's source (`hooks/style.ts`, `hooks/register.tsx`): an installed copy is overwritten on every update.

## Schema

```json
{ "preset": "<bundled theme>", "colors": { "<palette key>": "#rrggbb" }, "font": "<CSS font-family>" }
```

- Every key is optional. No file, or `{}`, is the default look.
- `preset` picks a bundled theme: `default`, `dark`, `solarized-dark` or `high-contrast`. `colors` then overrides single keys of that theme. `/pulumi-plan theme list` lists them.
- Overlay: each `colors` entry replaces that one key; every key left out keeps its default.
- Colours are `#rrggbb` only: no `#rgb`, no alpha, no names, no `rgb()`.
- `font` is a CSS `font-family` string of 1 to 200 characters. It sets the font of the chips and the banner, which the desktop app draws as images. Text elsewhere, and everything in the terminal, uses the surface's own monospace font.
- An invalid entry (unknown key, wrong type, bad colour, invalid JSON) is ignored, so that key keeps its default, and `/pulumi-plan theme` lists it.

## Palette keys

| Key | Default | Paints |
| --- | --- | --- |
| `paper` | `#edf7fe` | Pane background, behind the banner, the CLEAR pill and the cards |
| `card` | `#ffffff` | Card body; banner face |
| `panel` | `#f9fafb` | Body of an opened resource row (URN, provider, property diffs) |
| `ink` | `#002a54` | Main text: values, property paths, diagnostic messages, banner title, chip text by default. Also a fill: the rim around each card, every chip's outline, the banner's outline and shadow. Pill and card-title hovers mix 20% of it into their fill |
| `muted` | `#49545c` | Secondary text: resource types, ops, diff reasons, replace keys, commits on main, registered time, Details values, job folder, banner subtitle, the empty-pane hint, a git line that was not recorded |
| `faint` | `#68717a` | Tertiary text: field labels (TARGET, GIT, ...), URN and provider values, row value previews, resource types of drift rows, sub-group titles, "+N more", notes such as an expired approval |
| `divider` | `#d1d4d6` | Left bar of an opened resource row |
| `accent` | `#5a58eb` | Approve pills, the APPLY chip, left bar of the apply box |
| `accentSoft` | `#dfe5fb` | Branch label chip, "change only" chip |
| `accentPaper` | `#eef2ff` | Body of the apply box (approve buttons, targets, job status) |
| `onAccent` | `#ffffff` | Text on every pill and card title bar; text on the APPLY, applied/approved and failed/refused chips |
| `create` | `#abf6d3` | `+N CREATE` chip; Create section and drift sub-group counts; `add` property chips |
| `update` | `#fff38e` | `~N UPDATE` chip; Update section and drift sub-group counts; `update` and other property chips |
| `replace` | `#f9c8c7` | `±N REPLACE` chip; Replace section and drift sub-group counts; `replace` property chips; error diagnostic chips |
| `delete` | `#fbe1e1` | `−N DELETE` chip; Delete section and drift sub-group counts; `delete` property chips |
| `drift` | `#e5e6e8` | DRIFT N chip and Drift section count, except on an apply card paired with a pre-merge baseline; BASELINE ONLY chip; Baseline only, No longer pending and Other counts |
| `pendingDrift` | `#ffe48b` | DRIFT N chip and "Also applied: drift already pending" count on an apply card paired with a pre-merge baseline |
| `info` | `#d3e4f9` | Diagnostics section count, "Diagnostics also in the baseline" count, info diagnostic chips |
| `warning` | `#fff2c9` | Notice boxes, tag chips (OVERLAPS DRIFT, OPAQUE), warning diagnostic chips, uncommitted-files, re-previewing, applying and no-baseline chips |
| `removedBg` | `#fef2f2` | `-` (old value) diff lines; production confirmation box |
| `removedInk` | `#7c1918` | `-` diff line text |
| `addedBg` | `#ecfdf5` | `+` (new value) diff lines |
| `addedInk` | `#034f3b` | `+` diff line text |
| `danger` | `#eb3233` | Apply failed and apply refused chips; left bar of the production confirmation box |
| `dangerInk` | `#ad080a` | Refusal reason; production confirmation text |
| `ok` | `#009c69` | Applied and approved chips |
| `okInk` | `#034f3b` | Unused |
| `warnInk` | `#ba4e11` | Notice titles and left bars; text on uncommitted-files, re-previewing, applying and no-baseline chips; the git line of an apply run with no git record |
| `logBg` | `#0c1926` | `pulumi up` log tail background |
| `logInk` | `#f3f4f4` | `pulumi up` log tail text |
| `pillCard` | `#006fd7` | Card title bar (project / stack) |
| `pillNeutral` | `#68717a` | CLEAR, DETAILS, LOG, REVOKE, CANCEL, SHOW N MORE, resource row pills; Drift, No longer pending and Other section pills |
| `pillCreate` | `#007d57` | Create section pill |
| `pillUpdate` | `#8c7c16` | Update section pill |
| `pillDanger` | `#eb3233` | Replace and Delete section pills; YES, APPLY TO PRODUCTION |
| `pillPending` | `#ba4e11` | "Also applied: drift already pending" section pill |
| `pillInfo` | `#0074f8` | Diagnostics section pill |
| `riskLow` | `#abf6d3` | LOW RISK chip |
| `riskMedium` | `#ffe48b` | MEDIUM RISK chip |
| `riskHigh` | `#ad080a` | HIGH RISK chip (its text is `onAccent`) |

## Contrast

Keep 4.5:1 or more for every pair below; the bold `onAccent` labels need at least 3:1, also against their hover fill (the fill moved 20% toward `ink`).

- `ink`, `muted`, `faint` on `card`, `panel` and `accentPaper`
- `ink` on `warning`, `create`, `update`, `replace`, `delete`, `drift`, `pendingDrift`, `info`, `accentSoft`, `riskLow`, `riskMedium`
- `warnInk` on `warning` and on `card`
- `dangerInk` on `accentPaper` and on `removedBg`
- `removedInk` on `removedBg`, `addedInk` on `addedBg`, `logInk` on `logBg`
- `onAccent` on `accent`, `ok`, `danger`, `riskHigh` and every `pill*` key
- `ink` as a rim against `paper` and `card`: on a dark theme `ink` is light, so cards get a light rim

## Procedure

1. Read `$HOME/.claude/pulumi-plan/theme.json` if it exists, and keep what it has unless the user asked to change it. When a bundled theme is close to what the user wants (dark, solarized, high contrast), set `preset` to it and add only the differences to `colors`.
2. Work out the new values and merge them into its `colors` (and `font`).
3. Drop every entry equal to its value in the chosen `preset`, or with no preset its default in the table above (compare case-insensitively), and `font` when it is `ui-monospace, SFMono-Regular, Menlo, monospace`.
4. Create `$HOME/.claude/pulumi-plan/` if it is missing and write the file as formatted JSON.
5. Tell the user to run `/pulumi-plan theme` (or start a new session). It reports the file, how many colour overrides and whether a font override are in effect, and every problem; an open pane redraws at once. When they report a problem, fix the file and have them run it again.

## Reset

Delete the file or write `{}`, then `/pulumi-plan theme`. To reset one key, remove it from `colors`.

## Example: dark

Every key a coherent dark look needs; `onAccent` keeps its default white and `okInk` is unused.

```json
{
  "colors": {
    "paper": "#0d1117",
    "card": "#161b22",
    "panel": "#1c2129",
    "ink": "#e6edf3",
    "muted": "#b1bac4",
    "faint": "#8b949e",
    "divider": "#30363d",
    "accent": "#6e40c9",
    "accentSoft": "#2d2459",
    "accentPaper": "#1b1730",
    "create": "#1b4332",
    "update": "#4b3f0b",
    "replace": "#5c1f22",
    "delete": "#45232a",
    "drift": "#30363d",
    "pendingDrift": "#5a4210",
    "info": "#173a5e",
    "warning": "#3a2f12",
    "removedBg": "#3c1618",
    "removedInk": "#ffb1ab",
    "addedBg": "#0f2d1d",
    "addedInk": "#7ee2a8",
    "danger": "#b62324",
    "dangerInk": "#ff9492",
    "ok": "#1a7f37",
    "warnInk": "#f2b45a",
    "logBg": "#010409",
    "logInk": "#e6edf3",
    "pillCard": "#1f5fbf",
    "pillNeutral": "#484f58",
    "pillCreate": "#176b2c",
    "pillUpdate": "#7d6008",
    "pillDanger": "#b62324",
    "pillPending": "#9a4a07",
    "pillInfo": "#1f5fbf",
    "riskLow": "#1b4332",
    "riskMedium": "#5a4210",
    "riskHigh": "#b62324"
  }
}
```
