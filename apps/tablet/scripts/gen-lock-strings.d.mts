// Types for gen-lock-strings.mjs (05b M-9), for the Vitest gate test (05b test 10).

export interface LockStringsData {
  version: number;
  generated_by: string;
  fallback_language: string;
  join: string;
  params: Record<string, string>;
  table: { key: string; digits: string };
  table_point_kinds: { kinds: string[]; params: string[] };
  takeaway: { kind: string; key: string };
  outcome: { kind: string; key: string; outcomes: string[] };
  unknown: { urgent: string; other: string };
  silent_kinds: string[];
  result_sounds: { kind: string; default: string; by_outcome: Record<string, string> };
  languages: Record<string, Record<string, string>>;
}

export interface LockView {
  kind: string;
  family: string;
  outcome?: string | null;
  lock: {
    kind_label_key: string;
    table_code?: string | null;
    point_code?: string | null;
    requester_name?: string | null;
    device_name?: string | null;
  };
}

export const OUTPUT: string;
export const SOURCES: Readonly<Record<'en' | 'ur' | 'sounds' | 'labels03b' | 'events', string>>;
export const REPO_ROOT: string;
export function parseStringTable(src: string, marker: string, file: string): Record<string, string>;
export function parseStringArray(src: string, re: RegExp, file: string): string[];
export function buildLockStrings(read?: (path: string) => string): LockStringsData;
export function readCommitted(): string | null;
export function serialize(data: LockStringsData): string;
export function renderLock(data: LockStringsData, view: LockView, language: string, onUnknown?: (key: string) => void): string;
export function isSilentKind(data: LockStringsData, kind: string): boolean;
export function soundOf(data: LockStringsData, kind: string, family: string, outcome: string | null | undefined): string;
