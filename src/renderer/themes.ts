export const THEMES = {
  dark: {
    background: '#0d1117', panel: '#141b23', border: '#293440', text: '#f0f4f8',
    muted: '#91a2b5', floor: '#202b36', ring: '#18212b', accent: '#ffae57',
    greens: ['#202b36', '#164d36', '#217a46', '#3caf59', '#86df75'],
  },
  light: {
    background: '#fbfaf5', panel: '#f1f2e9', border: '#d8ddcf', text: '#25382f',
    muted: '#64776c', floor: '#e4e9dd', ring: '#eef0e6', accent: '#b65a15',
    greens: ['#e4e9dd', '#c5e6ad', '#8fc56c', '#4b9b50', '#257645'],
  },
} as const;
export type Theme = keyof typeof THEMES;
