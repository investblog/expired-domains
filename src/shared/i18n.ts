import { browser } from 'wxt/browser';

/**
 * Shorthand for browser.i18n.getMessage() (SPEC Н3).
 * Falls back to the key name when a message is missing.
 */
export function t(key: string, ...substitutions: string[]): string {
  const msg = browser.i18n.getMessage(key as any, substitutions.length > 0 ? substitutions : undefined);
  return msg || key;
}
