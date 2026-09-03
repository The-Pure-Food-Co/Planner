import type { ReactNode } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import type { Workspace } from '@/lib/types';
import { wsStatuses } from '@/lib/utils';

const QUOTED = /"([^"]+)"/g;

// The real color the quoted value stands for — a status/lane's own
// configured color (so "Not Started" → its grey, "In Progress" → its
// yellow/orange, matching whatever a workspace actually set up) rather
// than one made-up color per field type.
function chipColorFor(field: string | undefined, text: string, ws: Workspace | undefined): string | undefined {
  if (!ws) return undefined;
  if (field === 'status') return wsStatuses(ws).find((s) => s.label === text)?.color;
  if (field === 'lane') return ws.lanes.find((l) => l.label === text)?.color;
  return undefined;
}

// Activity messages embed values in quotes (task/lane/status names) — render
// each as an Astryx Badge instead of literal quote marks. Status and lane
// values pick up their own configured color; anything else (task names,
// free text) stays a plain neutral chip.
export default function ActivityMessage({
  message,
  field,
  ws,
}: {
  message: string;
  field?: string;
  ws?: Workspace;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  QUOTED.lastIndex = 0;
  while ((m = QUOTED.exec(message))) {
    if (m.index > last) parts.push(message.slice(last, m.index));
    const color = chipColorFor(field, m[1], ws);
    parts.push(
      color ? (
        <Badge key={key++} label={m[1]} className="align-middle" style={{ backgroundColor: color, color: '#fff' }} />
      ) : (
        <Badge key={key++} variant="neutral" label={m[1]} className="align-middle" />
      )
    );
    last = m.index + m[0].length;
  }
  if (last < message.length) parts.push(message.slice(last));
  return <>{parts}</>;
}
