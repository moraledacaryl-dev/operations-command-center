import type { SVGProps } from 'react';

const paths = {
  home: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  check: 'M9 12l2 2 4-4 M21 12a9 9 0 1 1-9-9',
  tasks: 'M9 5h11 M9 12h11 M9 19h11 M3 5l1 1 2-2 M3 12l1 1 2-2 M3 19l1 1 2-2',
  projects: 'M12 3l10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5',
  request: 'M22 2 9 15 M22 2l-8 20-5-7-7-5z',
  guests: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  maintenance: 'M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18a2.1 2.1 0 0 0 3 3l5.3-5.3a5 5 0 0 0 6.4-6.4L15 12l-3-3z',
  rooms: 'M4 21V3h16v18 M2 21h20 M8 7h2 M14 7h2 M8 11h2 M14 11h2 M10 21v-6h4v6',
  shift: 'M3 7h17l-4-4 M21 17H4l4 4 M20 7l-4 4 M4 17l4-4',
  review: 'M4 4h16v16H4z M4 10h16 M10 10v10',
  approval: 'M9 12l2 2 4-4 M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 3v5h5 M12 7v5l3 2',
  palette: 'M12 3a9 9 0 1 0 0 18c3 0 1-4 4-4h1a5 5 0 0 0 4-5 9 9 0 0 0-9-9 M7 10h.01 M10 7h.01 M15 7h.01 M17 11h.01',
  health: 'M3 12h4l3-8 4 16 3-8h4',
  marketing: 'M3 10v4h4l11 5V5L7 10z M7 14l2 7h4l-2-5 M21 9v6',
  edit: 'M16 3l5 5-13 13H3v-5z M13 6l5 5',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  external: 'M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14 M5 12h14',
  close: 'M6 6l12 12 M6 18 18 6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  panel: 'M3 3h18v18H3z M9 3v18',
  logout: 'M9 3H3v18h6 M10 12h11 M17 8l4 4-4 4',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  leaf: 'M12 21v-9 M12 15C5 15 3 11 3 6c6 0 9 3 9 9 M12 12c0-6 3-9 9-9 0 6-3 9-9 9',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  refresh: 'M20 7a9 9 0 0 0-15-2L2 8 M2 3v5h5 M4 17a9 9 0 0 0 15 2l3-3 M22 21v-5h-5',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]} /></svg>;
}
