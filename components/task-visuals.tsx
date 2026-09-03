import type { IconComponent } from '@/lib/icon-context';

// Shared, contextual visual bits for task pickers (dropdown-menu rows, Select
// items, table cells). Kept in one place so the Task editor, Table, and the
// workspace editors render identical status / RAG affordances.

/** A small filled color dot as an IconComponent — for the base-ui <Select>. */
export function dotIcon(color: string): IconComponent {
  return ({ size, className }) => (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size ?? 16,
        height: size ?? 16,
        flexShrink: 0,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
    </span>
  );
}

/** Inline color dot for dropdown-menu rows and triggers. */
export function Dot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}

