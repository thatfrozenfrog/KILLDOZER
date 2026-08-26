import type { ITheme } from "@xterm/xterm";
import schemesData from "./base24/schemes.json";

export interface Base24Scheme {
  slug: string;
  name: string;
  palette: Record<string, string>;
}

export const schemes = schemesData as unknown as Base24Scheme[];

const STORAGE_KEY = "base24-scheme";
export const DEFAULT_SCHEME = "gruvbox-dark";

export function currentScheme(): Base24Scheme {
  const slug = localStorage.getItem(STORAGE_KEY) || DEFAULT_SCHEME;
  return (
    schemes.find((s) => s.slug === slug) ||
    schemes.find((s) => s.slug === DEFAULT_SCHEME) ||
    schemes[0]
  );
}

export function applyScheme(slug: string): Base24Scheme {
  const scheme =
    schemes.find((s) => s.slug === slug) ||
    schemes.find((s) => s.slug === DEFAULT_SCHEME) ||
    schemes[0];
  localStorage.setItem(STORAGE_KEY, scheme.slug);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(scheme.palette)) {
    root.style.setProperty("--" + key.toLowerCase(), value);
  }
  return scheme;
}

export function xtermTheme(palette: Record<string, string>): ITheme {
  return {
    background: palette.base00,
    foreground: palette.base05,
    cursor: palette.base05,
    cursorAccent: palette.base00,
    selectionBackground: palette.base02,
    black: palette.base00,
    red: palette.base08,
    green: palette.base0B,
    yellow: palette.base0A,
    blue: palette.base0D,
    magenta: palette.base0E,
    cyan: palette.base0C,
    white: palette.base05,
    brightBlack: palette.base03,
    brightRed: palette.base12,
    brightGreen: palette.base14,
    brightYellow: palette.base13,
    brightBlue: palette.base16,
    brightMagenta: palette.base17,
    brightCyan: palette.base15,
    brightWhite: palette.base07,
  };
}
