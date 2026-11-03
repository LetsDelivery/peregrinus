/** `system` follows the operating system, so whether it is night has to be asked of it. */
export const isNight = (theme) =>
  theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)

/** The wordmark file whose text reads on the current background. */
export const logoFor = (theme) => (isNight(theme) ? '/wordmark-dark.svg' : '/wordmark.svg')

/** Puts the chosen theme on the page, and the wordmark whose text reads on it. */
export const applyTheme = (theme) => {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme
  } else {
    delete document.documentElement.dataset.theme
  }
  document.querySelector('.logo')?.setAttribute('src', logoFor(theme))
}
