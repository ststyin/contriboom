export const THEMES = {
  dark: {
    floor: '#202b36', accent: '#ffae57',
    greens: ['#202b36', '#164d36', '#217a46', '#3caf59', '#86df75'],
  },
  light: {
    floor: '#e4e9dd', accent: '#b65a15',
    greens: ['#e4e9dd', '#c5e6ad', '#8fc56c', '#4b9b50', '#257645'],
  },
} as const;
export type Theme = keyof typeof THEMES;
