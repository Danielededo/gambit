// Theme switching. Each theme is a stylesheet in styles/themes/ that defines
// the full set of CSS variables; switching swaps the href of the theme <link>.

const STORAGE_KEY = "gambit-theme";

export const THEMES = {
  light: "Light",
  dark: "Dark",
  blue: "Blue",
  sepia: "Sepia",
};

export const DEFAULT_THEME = "light";

export function getSavedTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return saved && THEMES[saved] ? saved : DEFAULT_THEME;
}

export function applyTheme(name) {
  if (!THEMES[name]) name = DEFAULT_THEME;
  const link = document.getElementById("theme-stylesheet");
  link.href = `styles/themes/${name}.css`;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // localStorage can be unavailable; the choice just won't persist.
  }
  return name;
}
