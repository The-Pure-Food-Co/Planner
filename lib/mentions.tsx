import type { ReactNode } from 'react';

/** Matches the plain-text "@Name " tokens inserted by the mention autocomplete. */
export const detectMention = (text: string, cursor: number) => {
  const upToCursor = text.slice(0, cursor);
  const m = upToCursor.match(/(?:^|\s)@([^\s@]*)$/);
  if (!m) return null;
  const query = m[1];
  return { query, start: cursor - query.length - 1, end: cursor };
};

/** Builds the "@Name" matcher for a set of known names (longest-first so
 *  "Jo Smith" wins over "Jo"), or null when there are no names to match. */
function mentionRegex(names: string[]): RegExp | null {
  const uniq = Array.from(new Set(names.filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!uniq.length) return null;
  const pattern = uniq.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`@(${pattern})\\b`, 'g');
}

/** The distinct known names @-mentioned in free text. */
export function extractMentionNames(text: string, names: string[]): string[] {
  const re = mentionRegex(names);
  if (!re || !text) return [];
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) found.add(m[1]);
  return Array.from(found);
}

/** Renders free text with "@Name" tokens (matching a known teammate) highlighted. */
export function renderMentions(text: string, names: string[]): ReactNode {
  const re = mentionRegex(names);
  if (!re) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span
        key={key++}
        className="rounded-[3px] bg-[#3b82f6]/20 text-[#3b82f6] font-medium"
      >
        @{m[1]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
