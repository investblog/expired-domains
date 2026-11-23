// Side panel ↔ content script (SPEC Ф13в): the side panel asks the active tab what is open there
// and can press "Save page" for the user. Kept apart from the writer protocol (messages.ts): these
// never reach the background's `eds:*` router, and nothing here writes storage.

import type { AddResult } from '@/background/store';
import type { Response } from './messages';

export type PageMode = 'ready' | 'empty' | 'broken';

/** What the content script reports about its page. */
export type PageState = { listing: false } | { listing: true; mode: PageMode; rows: number };

export type TabRequest = { type: 'edsTab:state' } | { type: 'edsTab:save' };
export type TabSaveResult = Response<AddResult>;

/** Sent by the content script once its page is ready, so an open side panel re-asks. */
export const TAB_READY = 'edsTab:ready';

export const isTabRequest = (v: unknown): v is TabRequest =>
  typeof v === 'object' &&
  v !== null &&
  ((v as { type?: unknown }).type === 'edsTab:state' || (v as { type?: unknown }).type === 'edsTab:save');

export const isTabReady = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && (v as { type?: unknown }).type === TAB_READY;

export const isPageState = (v: unknown): v is PageState =>
  typeof v === 'object' && v !== null && typeof (v as { listing?: unknown }).listing === 'boolean';
