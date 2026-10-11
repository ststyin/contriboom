function palette(colors: readonly [string, string, string, string, string]) {
  return { floor: colors[0], colors };
}

export const THEMES = {
  // GitHub Primer contribution.default.bgColor: neutral.2, green.1/3/4/6.
  // https://github.com/primer/primitives/blob/main/src/tokens/component/contribution.json5
  github: palette(['#eff2f5', '#aceebb', '#4ac26b', '#2da44e', '#116329']),
  dark: palette(['#202b36', '#164d36', '#217a46', '#3caf59', '#86df75']),
  light: palette(['#e4e9dd', '#c5e6ad', '#8fc56c', '#4b9b50', '#257645']),
  ocean: palette(['#172B3A', '#204D66', '#28799A', '#35AECA', '#8CE4EA']),
  sakura: palette(['#F1E6EB', '#EBC0D1', '#DB8BAE', '#BF5386', '#8C2F5C']),
  cyberpunk: palette(['#211B35', '#4C2F73', '#7850A8', '#AD7BDB', '#E1B5FF']),
  sunset: palette(['#EEE8DC', '#F3CFAC', '#E7A06C', '#C86B43', '#94412B']),
  nord: palette(['#2E3440', '#4C627C', '#5E81AC', '#81A1C1', '#88C0D0']),
  mocha: palette(['#1E1E2E', '#494166', '#736197', '#9F83C7', '#CBA6F7']),
  mint: palette(['#EDF3F0', '#DAE9E0', '#C1DACA', '#A5C7B3', '#84AD95']),
  sky: palette(['#EFF3F6', '#DEE8F0', '#C8D8E6', '#AEC4D8', '#8CAAC3']),
  lavender: palette(['#F2EFF5', '#E4DDEF', '#D3C7E4', '#BFB0D5', '#A392BF']),
  peach: palette(['#F7F0EA', '#F1DFD0', '#E8C9B3', '#DDAF91', '#C78F6D']),
  sand: palette(['#F4F1E8', '#E8E1CA', '#D9CEAF', '#C6B88E', '#B0A074']),
  rose: palette(['#F6EFF0', '#EEDDE1', '#E2C3CC', '#CFA5B3', '#B78396']),
} as const;
export type Theme = keyof typeof THEMES;
export const DEFAULT_THEME: Theme = 'github';
