# pulumi-plan

A Claude Code mod that shows what `pulumi preview` would change, separates a branch's own change from drift already pending in the stack, and gates `pulumi up` behind an Approve button the user presses.

Not affiliated with Pulumi or Anthropic.

![The Pulumi plan pane: a branch review card for a staging stack and an apply card for a production stack, with dummy data](docs/screenshot.png)

## What it does

- A pane ("Pulumi plan") with one card per project/stack, fed by `pulumi preview --json` output files that Claude registers.
- A risk label on every card: LOW RISK (no customer impact), MEDIUM RISK (possible customer impact) or HIGH RISK (definite customer impact), with Claude's one-line reason. Claude passes it when it registers the preview; a card registered without one shows RISK NOT SET.
- Change vs drift: a `branch` preview is compared with a `baseline` preview of the same project/stack. Steps only the branch run has are the change; steps both have are drift already in the stack.
- Apply cards: a preview registered with role `apply` gets an Approve button. `pulumi up` runs only through the mod's `apply` tool, and only after that press.
- Two approval scopes when the apply card is paired with a pre-merge baseline: "Approve all" (every step, drift included) and "Approve change only" (only the merge's own steps, run with `--target`; the drift stays pending). The scope comes from which button was pressed; the tool takes no scope argument.

## Requirements

- Claude Code with mod (hooks module) support. Developed and tested on 2.1.325.
- `/bin/zsh`. Every pulumi call is launched through `/bin/zsh -lic`, so pulumi sees what your login and interactive shell exports (for example `PULUMI_CONFIG_PASSPHRASE` or cloud credentials set in `~/.zshrc`).
- `pulumi` and `git` on that shell's PATH.
- The base branch is `origin/main`. This is hard-coded.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pulumi-plan --marketplace twoTimesAgnew/claude-code-pulumi-plan
```

From a shell:

```bash
claude plugin install pulumi-plan --marketplace twoTimesAgnew/claude-code-pulumi-plan
```

Registered runs live in session state and do not survive a session restart; register them again afterwards.

## Tools and command

| Name | Arguments / behavior |
| --- | --- |
| `mcp__pulumi-plan__show` | `previewJson`: absolute path of a file holding one preview's `--json` stdout. `worktree`: absolute path of the git checkout the preview ran from. `role`: `baseline` \| `branch` \| `apply`. Optional `label` (required for `branch`). `risk`: `low` \| `medium` \| `high`, the preview's customer impact (none, possible, definite), with a one-sentence `riskReason` (up to 300 characters). `stack` and `project`: only used when the preview has no steps to derive them from. `projectDir`: role `apply`, required, the directory holding `Pulumi.yaml`. `targets`: role `apply`, the exact `--target` URNs the preview used. Git info (HEAD, branch, merge parents, dirty file count) is read from `worktree` at call time, so register before removing a scratch worktree. |
| `mcp__pulumi-plan__apply` | `project`, `stack`. Works only after the Approve press. |
| `mcp__pulumi-plan__apply_status` | `project`, `stack`. Reports running/finished, exit code and log tail; waits up to about 9 minutes for a running job. |
| `/pulumi-plan` | Opens the pane. `/pulumi-plan clear` empties it. `/pulumi-plan theme` rereads the theme file and lists any problems in it. `/pulumi-plan theme list` lists the bundled themes and marks the one in effect. |

## Look and feel

The pane's colours and chip font come from an optional `~/.claude/pulumi-plan/theme.json`.

Four themes are bundled: `default`, `dark`, `solarized-dark` and `high-contrast` (light, black on white). Pick one with `preset`, then run `/pulumi-plan theme`:

```json
{ "preset": "dark" }
```

`colors` entries still apply on top of the preset, one key at a time. Each `colors` entry overrides one palette key (`#rrggbb` only); every key left out keeps its default. `font` is a CSS font-family for the chips and banner the desktop app draws as images.

```json
{
  "colors": { "paper": "#0d1117", "card": "#161b22", "ink": "#e6edf3" },
  "font": "JetBrains Mono, monospace"
}
```

The file is read at session start; `/pulumi-plan theme` rereads it, redraws the pane and lists anything it ignored. Ask Claude to restyle the pane and the bundled `/pulumi-plan:theme` skill writes the file (it lists every palette key, what it paints, and a full dark theme). To reset, delete the file or write `{}`.

## Workflows

1. Reviewing a branch: preview each touched stack twice, from `origin/main` (role `baseline`) and from a scratch worktree with the branch merged onto it (role `branch`), each with

   ```bash
   pulumi preview --stack <stack> --json --non-interactive --suppress-outputs > /abs/path/preview.json
   ```

   and register each file with `show`. Pass the `--json` stdout file, not a `--save-plan` file.

2. Applying after a merge: two previews of the same stack, each from its own clean scratch worktree: `baseline` at the commit before the merge (`<merge>^1`) and `apply` at `origin/main`. The apply card then splits what the merge changes from drift the apply would also run. Press Approve, then Claude calls `apply`.

## What the apply tool checks

- An approval exists for that exact registered preview, is at most 15 minutes old, and is used once.
- Stacks whose name contains `prod` (case-insensitive) need a second press: "Yes, apply to production".
- The worktree is clean; after `git fetch origin main`, HEAD equals `origin/main` and the previewed commit.
- It runs its own fresh preview and compares it step by step with the approved one; any difference means nothing is applied and a new approval is needed. For "Approve change only" the targeted re-preview must equal the change steps. That option is not offered when a change step and a drift step touch the same resource.
- Then `pulumi up --stack <stack> --yes --skip-preview --non-interactive --suppress-outputs [--target ...]` runs detached, so an interrupted turn does not stop it. Each job keeps `preview.json`, `run.sh`, `up.log` and `up.exit` in `~/.claude/pulumi-plan/jobs/<UTC stamp>-<project>-<stack>/`.

## Limits

- The gate is the mod's own code, in a folder an agent with file access can edit. It stops an unapproved apply in normal use; it is not tamper-proof. Pair it with a deny rule for `pulumi up`, `destroy`, `refresh` and `import` in your Claude Code Bash permissions, so the tool is the only route to an apply.
- Updates with no visible property diff (secret or computed values) compare equal in the re-preview check.
- Property values are compared on their first 4,000 characters.
- `origin/main` and `/bin/zsh` are hard-coded.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Types are written by Claude Code into `.claude-plugin/types/` (git-ignored) once the mod has loaded, and `tsconfig.json` extends the tsconfig there. To work on a local copy, `claude --plugin-dir <folder>` loads it for one session.

## License

MIT with the Commons Clause, see `LICENSE`. In short (the LICENSE text governs): use, modify and share it freely, including at work; you may not sell it or a paid product or service (hosting, consulting and support included) whose value derives substantially from it. This makes it source-available, not OSI-approved.
