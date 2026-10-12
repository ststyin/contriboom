<p align="center">
  <img src="assets/readme/logo.svg" width="132" alt="Contriboom logo">
</p>

<h1 align="center">Contriboom</h1>
<p align="center"><strong>Make your contributions a blast.</strong></p>
<p align="center">English · <a href="README.zh-CN.md">简体中文</a></p>

Turn your GitHub contribution calendar into a looping SVG animation.

<p align="center">
  <img src="assets/readme/hero.svg" width="900" alt="A robot clears and rebuilds a contribution calendar">
</p>

This is an animation generator; it does not modify your contributions or provide a playable game.

- Embed animated or static SVGs in your profile README.
- Run daily with GitHub Actions, or generate locally with Node.js.
- Choose full clearing or a preview with a bomb budget, with configurable blast and damage rules.
- Pick a theme and use your own character image.

[Quick start](#quick-start) · [Configuration](#configuration) · [Visual examples](#visual-examples) · [Troubleshooting](#troubleshooting)

## Quick start

### 1. Add the workflow to your profile repository

In your `USERNAME/USERNAME` repository, create `.github/workflows/contriboom.yml`. The following workflow generates the images, commits them to your default branch, and refreshes them daily at **00:23 UTC** (**08:23 Asia/Shanghai**). You can also run it manually from the Actions tab.

```yaml
name: Update contribution animation

on:
  schedule:
    - cron: '23 0 * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: contriboom-profile
  cancel-in-progress: false

jobs:
  generate:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.repository.default_branch }}

      - name: Generate contribution arena
        id: contriboom
        uses: ststyin/contriboom@main
        with:
          username: ${{ github.repository_owner }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          output-dir: images/contriboom

      - name: Commit updated images
        shell: bash
        env:
          SVG: ${{ steps.contriboom.outputs.svg }}
          SVG_STATIC: ${{ steps.contriboom.outputs.svg-static }}
        run: |
          git add -f -- "$SVG" "$SVG_STATIC"
          if git diff --cached --quiet; then
            echo "Contribution images are unchanged."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "Update contribution animation"
          git push
```

The [annotated workflow example](examples/profile.yml) includes every input. For a specific release or revision, replace `@main` with your chosen tag or commit SHA.

### 2. Generate once and embed the image

Run **Update contribution animation** manually and wait for its image commit. Then add this to your profile `README.md`:

```markdown
![My contribution animation](images/contriboom/game.svg)
```

For a static calendar:

```markdown
![My contribution calendar](images/contriboom/game-static.svg)
```

Use the exact directory configured in `output-dir`. These relative links assume the README and generated images are in the same repository and branch.

## Configuration

Configure the Action inside the generation step's `with:` block. Inputs that you omit use the defaults below. Numeric examples are quoted so YAML passes them as strings.

### Data source and output

| Input | Default | Accepted values / behavior |
| --- | --- | --- |
| `username` | `${{ github.repository_owner }}` | The GitHub account to read. |
| `github-token` | `${{ github.token }}` | A token authorized to read that account's contributions. The workflow example passes `${{ secrets.GITHUB_TOKEN }}`. |
| `year` | Empty | Empty: past 365 days, including today. Integer from `2008` through the current UTC year: that calendar year. The current year fetches January 1 through today; future dates are padded with empty cells. |
| `output-dir` | `artifacts` | A subdirectory inside the caller's repository workspace. The example uses `images/contriboom`. |

### Playback

| Input | Default | Accepted values / behavior |
| --- | --- | --- |
| `mode` | `clear` | `clear`: requires a safe full clear, without a bomb count cap. `preview`: limits the number of bombs and can leave blocks uncleared. |
| `max-bombs` | `'5'` | Integer `0–20`. Bomb count limit for `preview`; `0` disables bomb placement. |

`max-bombs` is optional in `preview` mode and defaults to 5. It is an upper limit: fewer bombs may be placed if the calendar is cleared or no safe placement is available. It does not cap a `clear` round. Loop duration is calculated automatically from movement, bombs, and the rebuild sequence; there is no time limit. A full clear can take several minutes on a dense calendar.

### Explosion rules

| Input | Default | Accepted values / behavior |
| --- | --- | --- |
| `block-damage` | `fade` | `fade`: each hit lowers the activity level by one until the block disappears. `instant`: removes a block on the first hit. |
| `range-mode` | `fixed` | `fixed`, `previous-day`, `previous-week`, or `previous-month`. See the calculation below. |
| `range` | `'4'` | Integer `1–10`, in cells. The blast distance in `fixed` mode; the maximum distance in adaptive modes. |

Adaptive modes calculate one range for the entire replay from the contribution counts in the previous **1**, **7**, or **30** days:

```text
effective range = max(1, min(range, ceil(daily average)))
```

The reference day is excluded. For GitHub data, it is the last day requested from the API; for local JSON, it is the final input date. Missing days count as zero. For example, a 7-day average of `2.3` with `range: '4'` produces a range of `3`; an average of `8` produces `4`.

Explosions travel in four directions, stop at the first contribution block in each direction, and stay inside the calendar. The contribution data itself is preserved; only the animation's block state changes.

### Appearance and randomness

| Input | Default | Accepted values / behavior |
| --- | --- | --- |
| `theme` | `github` | `github`, `light`, `dark`, `ocean`, `sakura`, `cyberpunk`, `sunset`, `nord`, `mocha`, `mint`, `sky`, `lavender`, `peach`, `sand`, `rose`. Recolors the animated and static calendars. |
| `player-icon` | Empty | Empty: built-in robot. Otherwise an image path inside the caller's repository, including nested directories. PNG, JPEG, GIF, WebP, or SVG; maximum **2 MiB**. Embedded into the animated SVG. |
| `player-icon-trim` | `auto` | `auto`: fits the character after trimming transparent or near-white margins. `none`: preserves the full image canvas. Applies to custom icons. |
| `seed` | `'42'` | A JavaScript safe integer. Identical data, generation settings, and seed produce the same replay. Different seeds can change choices between equally good moves. |

Custom characters retain their own artwork and colors. The static calendar does not include a player.

### Action outputs and generated files

| Action output | Value |
| --- | --- |
| `output-dir` | Absolute path to the generated directory. |
| `svg` | Absolute path to `game.svg`. |
| `svg-static` | Absolute path to `game-static.svg`. |

Each run also writes `contributions.json` (the input calendar) and `replay.json` (configuration, events, statistics, and range calculation). The profile workflow commits only the two SVG files.

## Visual examples

These examples use synthetic calendars rendered by Contriboom's actual simulator and SVG renderer. Most use a compact 20-week calendar and `preview` mode so the differences are easy to inspect. Unless a table heading says otherwise, comparisons use the same data, `seed: '42'`, `range: '4'`, `block-damage: fade`, and `max-bombs: '5'`. Open an SVG directly to restart its animation.

### Three themes

Change `theme` in `with:`. The same replay is shown in three of the 15 palettes:

| `theme: github` (default) | `theme: dark` | `theme: sakura` |
| --- | --- | --- |
| ![GitHub theme](assets/readme/theme-github.svg) | ![Dark theme](assets/readme/theme-dark.svg) | ![Sakura theme](assets/readme/theme-sakura.svg) |

### Full clear and preview

```yaml
# Default: omit mode for full clearing.
mode: preview
max-bombs: '5'
```

| `mode: clear` (default) | `mode: preview` |
| --- | --- |
| ![Full clear](assets/readme/mode-clear.svg) | ![Preview with five bombs](assets/readme/theme-github.svg) |

The full-clear demo takes about **154 seconds** to remove all 51 blocks; the preview places 5 bombs and loops after **18 seconds**. Both loop durations are calculated automatically.

### Preview bomb budget

These previews compare `max-bombs` values of `0`, `1`, `5`, and `20`. A larger budget allows more bomb placements and can produce a longer loop; `0` produces a patrol without bombs.

| `max-bombs: '0'` (patrol only) | `max-bombs: '1'` |
| --- | --- |
| ![Patrol without bombs](assets/readme/preview-zero-bombs.svg) | ![One-bomb preview](assets/readme/preview-one-bomb.svg) |

| `max-bombs: '5'` (default) | `max-bombs: '20'` |
| --- | --- |
| ![Five-bomb preview](assets/readme/theme-github.svg) | ![Twenty-bomb preview](assets/readme/preview-twenty-bombs.svg) |

### Block damage

```yaml
block-damage: instant # Default: fade.
```

| `block-damage: fade` (default) | `block-damage: instant` |
| --- | --- |
| ![Fading blocks](assets/readme/theme-github.svg) | ![Instant block destruction](assets/readme/damage-instant.svg) |

In `fade` mode, a level-4 block needs four hits. `instant` removes it with one hit. Both rebuild the original calendar before the next loop.

### Fixed and adaptive range

```yaml
range-mode: previous-week # Default: fixed.
range: '4'                # Fixed distance or adaptive cap.
```

Fixed distance, 1 cell versus 4 cells:

| `range: '1'` | `range: '4'` (default) |
| --- | --- |
| ![One-cell explosion range](assets/readme/range-1.svg) | ![Four-cell explosion range](assets/readme/theme-github.svg) |

The same synthetic data produces ranges of 1, 2, and 3 in the adaptive modes below. All use a cap of 4.

| `range-mode: fixed` (default; range 4) | `range-mode: previous-day` (range 1) |
| --- | --- |
| ![Fixed range](assets/readme/theme-github.svg) | ![Previous-day range](assets/readme/range-1.svg) |

| `range-mode: previous-week` (range 2) | `range-mode: previous-month` (range 3) |
| --- | --- |
| ![Previous-week range](assets/readme/range-2.svg) | ![Previous-month range](assets/readme/range-3.svg) |

### Custom player and icon margins

<p align="center">
  <img src="assets/readme/fox-icon.svg" width="128" alt="Example orange fox player icon">
</p>

To try this character, download [fox-icon.svg](assets/readme/fox-icon.svg), save it as `assets/fox.svg` **in your profile repository**, and configure:

```yaml
player-icon: assets/fox.svg
player-icon-trim: auto # Default; omit this line to keep auto trimming.
```

| `player-icon` omitted (default robot) | `player-icon: assets/fox.svg` |
| --- | --- |
| ![Default robot](assets/readme/theme-github.svg) | ![Custom fox character](assets/readme/player-fox-auto.svg) |

Set `player-icon-trim: none` to keep deliberate padding. The same padded fox image is used on both sides below; preserving its margins makes the character appear smaller.

| `player-icon-trim: auto` (default) | `player-icon-trim: none` |
| --- | --- |
| ![Auto-trimmed fox](assets/readme/player-fox-auto.svg) | ![Fox with original margins](assets/readme/player-fox-none.svg) |

### Seeds

```yaml
seed: '66' # Default: 42.
```

| `seed: '42'` (default) | `seed: '66'` |
| --- | --- |
| ![Seed 42](assets/readme/theme-github.svg) | ![Seed 66](assets/readme/seed-66.svg) |

The input calendar stays the same in this comparison. When using a built-in CLI fixture, `--seed` also controls the generated fixture data.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| The workflow cannot push its image commit | Workflow write permission and repository rules must allow the bot to push to the target branch. |
| Missing token, access denied, or account not found | Check `username` and token access. GitHub fetch failures are reported; they are not replaced by simulated contributions. |
| Rate limit or network timeout | Retry after the reported limit or connection issue is resolved. The CLI can reuse a valid local cache. |
| Cannot safely clear the calendar | Use `mode: preview` for that calendar. Full clearing requires an empty spawn cell and a safe path away from every bomb. |
| Empty contribution calendar | The robot patrols without inventing contributions. A fully occupied preview has no player spawn and renders as a static calendar. |
| Custom character is too small | Use `player-icon-trim: auto`; use `none` only when you want to retain image padding. |
| README still shows an older image | Check the exact file path and branch, and confirm the workflow pushed the image commit. Browser or GitHub image-proxy caches can delay updates; see [GitHub's cache troubleshooting](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls). |
