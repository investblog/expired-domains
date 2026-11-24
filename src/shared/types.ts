// Data model (SPEC section 6). Shared by capture, storage, popup, export and backup.

export const STATUSES = ['new', 'shortlist', 'rejected', 'bought'] as const;
export type Status = (typeof STATUSES)[number];

/** Value of a `d:<domain>` storage record (SPEC section 6). */
export interface DomainRecord {
  firstSeen: number;
  lastSeen: number;
  lists: string[];
  lastSource: string;
  stats: Record<string, string>;
  /** Absent means `new` (Ф20); `new` is never stored. */
  status?: Exclude<Status, 'new'>;
  tags?: string[];
  note?: string;
}

export interface ColumnMeta {
  label: string;
  title: string;
}

export interface Filter {
  text?: string;
  statuses?: Status[];
  tagsAny?: string[];
  tagsNone?: string[];
  lists?: string[];
  availability?: 'available' | 'registered';
  freshHours?: number;
  droppedWithinDays?: number;
  deletesWithinDays?: number;
  auctionActive?: true;
  minBl?: number;
  minDp?: number;
  minArchiveEntries?: number;
  archiveFirstYearMax?: number;
  maxNameLength?: number;
  zones?: string[];
  noDigits?: true;
  noHyphens?: true;
}

export interface FilterPreset {
  id: string;
  name: string;
  filter: Filter;
}

export interface Settings {
  autoCapture: boolean;
  panelCollapsed: boolean;
  filterPresets: FilterPreset[];
  activePreset: string;
  /** Badges, the status menu and "new" in the site's table (Ф28, Ф30, Ф31). Absent means true (0.1 data). */
  pageMarks?: boolean;
  /** Dim rejected rows in the site's table (Ф29). Absent means true (0.1 data). */
  dimRejected?: boolean;
}

/** `meta` storage key (section 6). `pending` is present only between steps 1 and 3 (Ф11). */
export interface Meta {
  schema: 2;
  sources: Record<string, string>;
  columns: Record<string, ColumnMeta>;
  columnOrder: string[];
  domainCount: number;
  rev: number;
  pending?: true;
}

/** Changes of user fields for one or many domains (Ф23). */
export interface Patch {
  status?: Status;
  note?: string;
  addTags?: string[];
  removeTags?: string[];
}

/** Everything a backup carries (Ф27): the user-visible state without service fields of `meta`. */
export interface State {
  records: Record<string, DomainRecord>;
  sources: Record<string, string>;
  columns: Record<string, ColumnMeta>;
  columnOrder: string[];
  settings: Settings;
}
