<p align="center">
  <img src="assets/readme/logo.svg" width="104" alt="Contriboom 标志">
</p>

<h1 align="center">Contriboom</h1>
<p align="center"><strong>Make your contributions a blast.</strong></p>
<p align="center"><a href="README.md">English</a> · 简体中文</p>

将 GitHub 贡献日历变成循环播放的 SVG 动画。

<p align="center">
  <img src="assets/readme/hero.svg" width="600" alt="机器人清除贡献方块并恢复日历的动画">
</p>

本项目是动画生成工具，不会修改你的贡献记录，也不是可手动操作的游戏。

- 将动态或静态 SVG 放进个人主页 README。
- 通过 GitHub Actions 每日更新，或使用 Node.js 本地生成。
- 选择完整清场或限制炸弹数量的预览，配置爆炸范围和方块伤害规则。
- 更换主题，使用自己的角色图片。

[快速开始](#快速开始) · [配置参数](#配置参数) · [效果演示](#效果演示) · [常见问题](#常见问题)

## 快速开始

### 1. 在个人主页仓库添加 workflow

在 `用户名/用户名` 仓库中创建 `.github/workflows/contriboom.yml`。下面的 workflow 会生成图片、提交到默认分支，并在每天 **UTC 00:23**（**北京时间 08:23**）更新。也可以在 Actions 页面手动运行。

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
        uses: ststyin/Contriboom@v1.0.0
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

[带完整注释的 workflow 示例](examples/profile.yml) 列出了所有参数。示例使用 `v1.0.0` 发布标签，使用 `@main` 会跟随最新开发代码。

### 2. 运行一次并引用图片

手动运行 **Update contribution animation**，等待图片提交完成，然后在个人主页的 `README.md` 中加入：

```markdown
![我的贡献动画](images/contriboom/game.svg)
```

引用静态日历：

```markdown
![我的贡献日历](images/contriboom/game-static.svg)
```

图片路径必须与 `output-dir` 一致。以上相对路径要求 README 和图片位于同一仓库、同一分支。

## 配置参数

在生成步骤的 `with:` 中填写配置。未填写的参数使用下表中的默认值。数字示例使用引号，使 YAML 将其作为字符串传递。

### 数据来源与输出

| 参数 | 默认值 | 可选值或行为 |
| --- | --- | --- |
| `username` | `${{ github.repository_owner }}` | 要读取贡献数据的 GitHub 用户名。 |
| `github-token` | `${{ github.token }}` | 有权读取该账号贡献数据的访问令牌。workflow 示例使用 `${{ secrets.GITHUB_TOKEN }}`。 |
| `year` | 留空 | 留空：最近 365 天，包含今天。整数 `2008` 至当前 UTC 年份：指定自然年。当前年份读取 1 月 1 日到今天，未来日期补为空格。 |
| `output-dir` | `artifacts` | 调用方仓库工作区内的子目录；示例使用 `images/contriboom`。 |

### 播放模式

| 参数 | 默认值 | 可选值或行为 |
| --- | --- | --- |
| `mode` | `clear` | `clear`：要求安全完整清场，不限制炸弹数量。`preview`：限制炸弹数量，可能留下未清除的方块。 |
| `max-bombs` | `'5'` | 整数 `0–20`。`preview` 模式的炸弹数量上限；`0` 表示不放置炸弹。 |

`preview` 模式可以省略 `max-bombs`，默认值为 5。它是炸弹数量上限，如果已清场或没有安全放置位置，实际数量可能更少；它不限制 `clear` 模式的一轮清场。循环时长根据移动、炸弹和恢复日历的动画自动计算，不设时间上限。贡献密集时，完整清场可能需要数分钟。

### 炸弹规划

| 参数 | 默认值 | 可选值或行为 |
| --- | --- | --- |
| `planner` | `balanced` | `balanced`、`fewer-bombs`、`fast-clear` 或 `min-bombs`，目标与保证见下表。 |
| `planner-search-limit` | `'10000'` | 正的 JavaScript 安全整数。`min-bombs` 的搜索状态预算，包含初始状态；其他策略不使用此预算。 |

| 策略 | 目标与保证 |
| --- | --- |
| `balanced` | 原有贪心评分，兼顾命中数量、接近距离和撤离距离。 |
| `fewer-bombs` | 通过有限前瞻减少用弹。与 `balanced` 的完整方案比较，先选择炸弹更少的方案，数量相同再选择行走步数更少的方案；不保证全局最少。 |
| `fast-clear` | 通过有限前瞻缩短模拟清场时间。与 `balanced` 的完整方案比较并保留更快的方案，可能比 `fewer-bombs` 使用更多炸弹；不保证全局最短时间。 |
| `min-bombs` | 在固定出生与入场结果后，按现有移动、爆炸、伤害和逐颗放弹规则，精确求解最少炸弹数。仅支持 `mode: clear`；预算不足以证明最优时会报错。 |

所有策略沿用相同的移动、爆炸、安全撤离、出生和自动入场规则。最少炸弹搜索在出生与入场结果固定后开始，入场移除方块不消耗炸弹。搜索不优化其他出生位置或入场清除区域，也不保证在同样少的炸弹数下行走距离最短。

`min-bombs` 适合小规模输入。即使方块稀疏，也可能超出搜索预算；普通全年日历建议使用 `fewer-bombs`，需要证明最优时再选精确搜索。不会将未证明最优的方案静默作为 `min-bombs` 返回。

`planner-search-limit` 统计剪枝后纳入搜索的节点数，包含初始局面；同一剩余耐久局面若以更少炸弹重新进入搜索，也会再次计数。它不限制炸弹数量、计算秒数或动画时长。增大数值允许更多搜索，也可能增加时间和内存消耗，但不能确保一定能证明最优。

在 `preview` 模式下，`fewer-bombs` 和 `fast-clear` 优先增加炸弹预算内的命中次数，再比较实际清除数量；`fade` 模式每次命中降低一级耐久。效果相同时，`fast-clear` 优先选择模拟耗时更短的方案。耗时包含接近炸弹位置的移动、引信和火焰等待，撤离发生在引信倒计时内。策略计算时间与动画时长分开。

```yaml
mode: clear
planner: fewer-bombs
```

本地生成可使用 `npm run generate -- --fixture demo --planner fast-clear`。小日历的精确搜索可使用 `npm run generate -- --input small-calendar.json --planner min-bombs --planner-search-limit 20000`。所选策略和预算会记录到 `replay.json`。省略 `planner` 时沿用原来的 `balanced` 行为。

GitHub Actions 需要引用 `action.yml` 已包含这些参数的分支、提交或发布版本。仅在 `with:` 中增加参数不会升级 `uses:` 固定的版本；测试 PR 时，应将 `uses:` 指向该 PR 的分支或提交。

### 爆炸规则

| 参数 | 默认值 | 可选值或行为 |
| --- | --- | --- |
| `block-damage` | `fade` | `fade`：每次命中降低一级活跃等级，直到方块消失。`instant`：第一次命中就清除方块。 |
| `range-mode` | `fixed` | `fixed`、`previous-day`、`previous-week`、`previous-month`，计算方法见下文。 |
| `range` | `'4'` | 整数 `1–10`，单位格。固定模式下为实际爆炸距离，自适应模式下为距离上限。 |

自适应模式按前 **1**、**7** 或 **30** 天的贡献次数计算整轮回放统一使用的爆炸范围：

```text
实际范围 = max(1, min(range, ceil(日均贡献次数)))
```

计算不包含参考日期当天。GitHub 数据以 API 查询的最后一天为参考日期，本地 JSON 以最后一条记录的日期为参考日期。缺失日期按零计算。例如，前 7 天日均 `2.3` 次、`range: '4'` 时，实际范围为 `3`；日均 `8` 次时，实际范围为 `4`。

爆炸沿四个方向传播，每个方向遇到第一个贡献方块后停止，不会越出日历边界。动画中的方块状态会变化，原始贡献数据保持不变。

### 外观与随机性

| 参数 | 默认值 | 可选值或行为 |
| --- | --- | --- |
| `theme` | `github` | `github`、`light`、`dark`、`ocean`、`sakura`、`cyberpunk`、`sunset`、`nord`、`mocha`、`mint`、`sky`、`lavender`、`peach`、`sand`、`rose`。同时改变动态和静态日历的配色。 |
| `player-icon` | 留空 | 留空：内置机器人。也可以填写调用方仓库内的图片路径，支持子目录。格式 PNG、JPEG、GIF、WebP、SVG，最大 **2 MiB**；图片嵌入动态 SVG。 |
| `player-icon-trim` | `auto` | `auto`：裁掉透明或近白色留白，使角色适配格子。`none`：保留完整画布。仅用于自定义图片。 |
| `seed` | `'42'` | JavaScript 安全整数。数据、生成配置和种子相同时，生成相同回放。不同种子可能改变同等优先级的行动选择。 |

自定义角色保留原有图案和颜色。静态日历中没有角色。

### Action 输出与生成文件

| Action 输出 | 内容 |
| --- | --- |
| `output-dir` | 生成目录的绝对路径。 |
| `svg` | `game.svg` 的绝对路径。 |
| `svg-static` | `game-static.svg` 的绝对路径。 |

每次运行还会生成 `contributions.json`（输入日历）和 `replay.json`（配置、事件、统计及范围计算结果）。个人主页 workflow 只提交两张 SVG 图片。

## 效果演示

下面的图使用模拟日历，由项目现有的模拟器和 SVG 渲染器生成。大部分使用 20 周的紧凑日历和 `preview` 模式，便于比较。除图片上方说明的参数外，对比使用相同的数据，以及 `seed: '42'`、`range: '4'`、`block-damage: fade`、`max-bombs: '5'`。直接打开 SVG 可以重新开始播放。

### 三种主题

修改 `with:` 中的 `theme` 即可。下面展示 15 种主题中的三种，回放内容相同：

<p align="center">
  <strong><code>theme: github</code>（默认）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="GitHub 主题">
</p>

<p align="center">
  <strong><code>theme: dark</code></strong><br>
  <img src="assets/readme/theme-dark.svg" width="300" alt="深色主题">
</p>

<p align="center">
  <strong><code>theme: sakura</code></strong><br>
  <img src="assets/readme/theme-sakura.svg" width="300" alt="樱花主题">
</p>

### 完整清场与预览

```yaml
# Default: omit mode for full clearing.
mode: preview
max-bombs: '5'
```

<p align="center">
  <strong><code>mode: clear</code>（默认）</strong><br>
  <img src="assets/readme/mode-clear.svg" width="300" alt="完整清场">
</p>

<p align="center">
  <strong><code>mode: preview</code></strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="五枚炸弹预览">
</p>

完整清场示例约需 **154 秒**清除全部 51 个方块；预览示例放置 5 枚炸弹，**18 秒**后开始下一轮。两种模式的循环时长均自动计算。

### 全满日历的入场

如果日历没有空格，或无法安全放置第一颗炸弹，会先通过入场动画临时腾出 **2 × 2** 区域，再让角色出现。已有安全出生位时沿用原来的方式。入场会尽量少腾空贡献方块，将其计入清除统计，并在循环结束时恢复原始等级。入场不占用 `max-bombs`，普通炸弹仍遵循 `block-damage`，无需额外配置。单列日历无法提供对角撤离位置，因此会腾出整列。

<p align="center">
  <strong>全满日历自动入场（<code>mode: preview</code>、<code>max-bombs: '5'</code>）</strong><br>
  <img src="assets/readme/full-calendar-entry.svg" width="300" alt="全满贡献日历的自动入场">
</p>

### 预览炸弹上限

下面分别设置 `max-bombs` 为 `0`、`1`、`5`、`20`。上限越大，允许放置的炸弹越多，循环也可能更长；`0` 表示只巡逻、不放炸弹。

<p align="center">
  <strong><code>max-bombs: '0'</code>（只巡逻）</strong><br>
  <img src="assets/readme/preview-zero-bombs.svg" width="300" alt="不放炸弹的巡逻">
</p>

<p align="center">
  <strong><code>max-bombs: '1'</code></strong><br>
  <img src="assets/readme/preview-one-bomb.svg" width="300" alt="一枚炸弹预览">
</p>

<p align="center">
  <strong><code>max-bombs: '5'</code>（默认）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="五枚炸弹预览">
</p>

<p align="center">
  <strong><code>max-bombs: '20'</code></strong><br>
  <img src="assets/readme/preview-twenty-bombs.svg" width="300" alt="二十枚炸弹预览">
</p>

### 方块伤害

```yaml
block-damage: instant # Default: fade.
```

<p align="center">
  <strong><code>block-damage: fade</code>（默认）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="逐级变浅">
</p>

<p align="center">
  <strong><code>block-damage: instant</code></strong><br>
  <img src="assets/readme/damage-instant.svg" width="300" alt="一次清除">
</p>

`fade` 模式下，等级为 4 的方块需要命中四次；`instant` 模式命中一次就消失。两种模式都会在下一轮之前恢复原始日历。

### 固定与自适应范围

```yaml
range-mode: previous-week # Default: fixed.
range: '4'                # Fixed distance or adaptive cap.
```

固定距离 1 格和 4 格的对比：

<p align="center">
  <strong><code>range: '1'</code></strong><br>
  <img src="assets/readme/range-1.svg" width="300" alt="一格爆炸范围">
</p>

<p align="center">
  <strong><code>range: '4'</code>（默认）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="四格爆炸范围">
</p>

下面三种自适应模式根据相同的模拟数据，分别得到 1、2、3 格的实际范围；上限都为 4 格。

<p align="center">
  <strong><code>range-mode: fixed</code>（默认，范围 4）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="固定范围">
</p>

<p align="center">
  <strong><code>range-mode: previous-day</code>（范围 1）</strong><br>
  <img src="assets/readme/range-1.svg" width="300" alt="前一天的范围">
</p>

<p align="center">
  <strong><code>range-mode: previous-week</code>（范围 2）</strong><br>
  <img src="assets/readme/range-2.svg" width="300" alt="前七天的范围">
</p>

<p align="center">
  <strong><code>range-mode: previous-month</code>（范围 3）</strong><br>
  <img src="assets/readme/range-3.svg" width="300" alt="前三十天的范围">
</p>

### 自定义角色与留白

<p align="center">
  <img src="assets/readme/fox-icon.svg" width="128" alt="示例橙色狐狸角色">
</p>

如果想使用这只狐狸，下载 [fox-icon.svg](assets/readme/fox-icon.svg)，保存到**你自己的个人主页仓库**中，路径为 `assets/fox.svg`，然后配置：

```yaml
player-icon: assets/fox.svg
player-icon-trim: auto # Default; omit this line to keep auto trimming.
```

<p align="center">
  <strong>不填写 <code>player-icon</code>（默认机器人）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="默认机器人">
</p>

<p align="center">
  <strong><code>player-icon: assets/fox.svg</code></strong><br>
  <img src="assets/readme/player-fox-auto.svg" width="300" alt="自定义狐狸">
</p>

如果想保留图片原有留白，设置 `player-icon-trim: none`。下面两侧使用同一张带留白的狐狸图片，保留留白后角色看起来更小。

<p align="center">
  <strong><code>player-icon-trim: auto</code>（默认）</strong><br>
  <img src="assets/readme/player-fox-auto.svg" width="300" alt="自动裁剪留白">
</p>

<p align="center">
  <strong><code>player-icon-trim: none</code></strong><br>
  <img src="assets/readme/player-fox-none.svg" width="300" alt="保留原始留白">
</p>

### 随机种子

```yaml
seed: '66' # Default: 42.
```

<p align="center">
  <strong><code>seed: '42'</code>（默认）</strong><br>
  <img src="assets/readme/theme-github.svg" width="300" alt="种子 42">
</p>

<p align="center">
  <strong><code>seed: '66'</code></strong><br>
  <img src="assets/readme/seed-66.svg" width="300" alt="种子 66">
</p>

这里保持输入日历不变。使用 CLI 内置示例数据时，`--seed` 也会影响示例数据本身。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| workflow 无法推送图片提交 | 工作流写权限和仓库规则需要允许机器人推送到目标分支。 |
| 缺少令牌、访问被拒绝或账号不存在 | 检查 `username` 和令牌权限。GitHub 获取失败会直接报错，不会用模拟数据替代。 |
| API 限流或网络超时 | 等待限流或连接问题解决后重试。CLI 可以复用有效的本地缓存。 |
| 提示无法安全完整清场 | 全满日历会自动创建入场区域，但每次放置炸弹后仍需有安全撤离路径。若自定义模拟配置阻碍完整清场，可使用 `mode: preview`。 |
| `min-bombs search limit ... reached before proving` | 增大 `planner-search-limit`，或改用 `fewer-bombs`。该限制统计纳入搜索的节点数，不是秒数或炸弹数；无法证明最优时生成失败。 |
| `min-bombs requires mode clear` | 设置 `mode: clear`，或为 `preview` 选择其他策略。 |
| 日历没有贡献 | 机器人会巡逻，不会虚构贡献。 |
| 自定义角色过小 | 使用 `player-icon-trim: auto`；只有想保留图片留白时才使用 `none`。 |
| README 仍显示旧图片 | 核对文件路径和分支，确认 workflow 已推送图片提交。浏览器或 GitHub 图片代理缓存可能导致延迟，参见 [GitHub 缓存排查文档](https://docs.github.com/zh/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)。 |

## 友情链接

🌐 [Linux Do](https://linux.do)
