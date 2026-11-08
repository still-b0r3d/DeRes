/**
 * The version as the page shows it (the footer, the injector's Defaults):
 * package.json's number with a last ".0" left off, so 1.0.0 shows as 1.0, the
 * way the PC app writes its own. A number whose last part isn't 0 stays whole
 * (0.9.4, 0.9.2.1, 1.0.1), and so does anything that isn't a plain number.
 */
export function shownVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, '$1')
}
