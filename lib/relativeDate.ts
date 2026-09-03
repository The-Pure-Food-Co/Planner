// Power BI-style relative date slicer windows. Boundary rules verified
// against the PBIX reports: "Last N months" = (today - N months, today],
// i.e. the start is today - N months + 1 day; calendar variants cover whole
// complete periods excluding the current one.
export type RelDir = 'last' | 'this' | 'next';
export type RelUnit =
  | 'days'
  | 'weeks'
  | 'calendarWeeks'
  | 'months'
  | 'calendarMonths'
  | 'years'
  | 'calendarYears';

export const REL_UNITS: { value: RelUnit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'calendarWeeks', label: 'Calendar weeks' },
  { value: 'months', label: 'Months' },
  { value: 'calendarMonths', label: 'Calendar months' },
  { value: 'years', label: 'Years' },
  { value: 'calendarYears', label: 'Calendar years' },
];

export function relativeWindow(
  dir: RelDir,
  n: number,
  unit: RelUnit,
  today: Date
): { start: Date; end: Date } {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const day = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd);
  // Monday of the current week
  const monday = day(y, m, d - ((today.getDay() + 6) % 7));

  if (dir === 'this') {
    switch (unit) {
      case 'days':
        return { start: day(y, m, d), end: day(y, m, d) };
      case 'weeks':
      case 'calendarWeeks':
        return { start: monday, end: day(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6) };
      case 'months':
      case 'calendarMonths':
        return { start: day(y, m, 1), end: day(y, m + 1, 0) };
      default:
        return { start: day(y, 0, 1), end: day(y, 11, 31) };
    }
  }

  const last = dir === 'last';
  switch (unit) {
    case 'days':
      return last
        ? { start: day(y, m, d - n + 1), end: day(y, m, d) }
        : { start: day(y, m, d + 1), end: day(y, m, d + n) };
    case 'weeks':
      return last
        ? { start: day(y, m, d - 7 * n + 1), end: day(y, m, d) }
        : { start: day(y, m, d + 1), end: day(y, m, d + 7 * n) };
    case 'calendarWeeks': {
      if (last) {
        const end = day(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1); // last Sunday
        return { start: day(end.getFullYear(), end.getMonth(), end.getDate() - 7 * n + 1), end };
      }
      const start = day(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
      return { start, end: day(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n - 1) };
    }
    case 'months':
      return last
        ? { start: day(y, m - n, d + 1), end: day(y, m, d) }
        : { start: day(y, m, d + 1), end: day(y, m + n, d) };
    case 'calendarMonths':
      return last
        ? { start: day(y, m - n, 1), end: day(y, m, 0) }
        : { start: day(y, m + 1, 1), end: day(y, m + 1 + n, 0) };
    case 'years':
      return last
        ? { start: day(y - n, m, d + 1), end: day(y, m, d) }
        : { start: day(y, m, d + 1), end: day(y + n, m, d) };
    case 'calendarYears':
      return last
        ? { start: day(y - n, 0, 1), end: day(y - 1, 11, 31) }
        : { start: day(y + 1, 0, 1), end: day(y + n, 11, 31) };
  }
}
