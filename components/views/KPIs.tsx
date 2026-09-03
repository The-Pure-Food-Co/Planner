'use client';
import { usePlannerStore } from '@/store/plannerStore';
import { useIsAppAdmin } from '@/lib/permissions';
import { ragColor, ragBadgeColor, RAGS, isoWeek, uuid } from '@/lib/utils';
import type { KpiGroup, Kpi, KpiEntry, RagStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function SparkSvg({ entries }: { entries: KpiEntry[] }) {
  const vals = [...entries]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((e) => e.value)
    .filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  const w = 92,
    h = 26,
    p = 3;
  const mn = Math.min(...vals),
    mx = Math.max(...vals);
  const xs = (i: number) => p + (i * (w - 2 * p)) / (vals.length - 1);
  const ys = (v: number) =>
    mx === mn ? h / 2 : p + ((mx - v) * (h - 2 * p)) / (mx - mn);
  const pts = vals
    .map((v, i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`)
    .join(' ');
  const last = vals.length - 1;
  return (
    <svg
      width={w}
      height={h}
      style={{
        verticalAlign: 'middle',
        marginLeft: 8,
      }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke="#C63663"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={xs(last)} cy={ys(vals[last])} r="2.6" fill="#C63663" />
    </svg>
  );
}

export default function KPIs() {
  const { data, updateKpiGroups } = usePlannerStore();
  const groups = data.kpiGroups || [];
  const canEdit = useIsAppAdmin();

  const update = (newGroups: KpiGroup[]) => {
    if (!canEdit) return;
    updateKpiGroups(newGroups);
  };

  return (
    <div className="page">
      {groups.map((g, gi) => {
        const allWeeks = [
          ...new Set(g.kpis.flatMap((k) => k.entries.map((e) => e.week))),
        ].sort();
        return (
          <div key={g.id} className="kpi-group">
            <h2>
              {g.name}
              {canEdit && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  const wk = prompt('Week (YYYY-Www):', isoWeek(new Date()));
                  if (!wk || !/^\d{4}-W\d{2}$/.test(wk)) return;
                  const next = groups.map((gr, i) =>
                    i !== gi
                      ? gr
                      : {
                          ...gr,
                          kpis: gr.kpis.map((k) =>
                            k.entries.find((e) => e.week === wk)
                              ? k
                              : {
                                  ...k,
                                  entries: [
                                    ...k.entries,
                                    {
                                      week: wk,
                                      value: null,
                                      rag: 'none' as RagStatus,
                                      notes: '',
                                    },
                                  ],
                                }
                          ),
                        }
                  );
                  update(next);
                }}
              >
                + Week
              </Button>
              )}
              {canEdit && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => {
                  const name = prompt('KPI name:');
                  if (!name) return;
                  const next = groups.map((gr, i) =>
                    i !== gi
                      ? gr
                      : {
                          ...gr,
                          kpis: [
                            ...gr.kpis,
                            {
                              id: uuid(),
                              name,
                              unit: '',
                              target: null,
                              direction: 'higher_better' as const,
                              rag: 'none' as RagStatus,
                              entries: [],
                            },
                          ],
                        }
                  );
                  update(next);
                }}
              >
                + KPI
              </Button>
              )}
            </h2>
            <table className="kpi">
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                    }}
                  >
                    KPI
                  </th>
                  {allWeeks.map((w) => (
                    <th key={w}>{w.replace('-W', ' W')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.kpis.map((k, ki) => (
                  <tr key={k.id}>
                    <td className="name">
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <Badge
                          size="sm"
                          color={ragBadgeColor(k.rag)}
                          className={canEdit ? 'cursor-pointer' : undefined}
                          title={canEdit ? 'click to cycle RAG' : undefined}
                          onClick={() => {
                            if (!canEdit) return;
                            const next = groups.map((gr, i) =>
                              i !== gi
                                ? gr
                                : {
                                    ...gr,
                                    kpis: gr.kpis.map((kp, j) =>
                                      j !== ki
                                        ? kp
                                        : {
                                            ...kp,
                                            rag: RAGS[
                                              (RAGS.indexOf(kp.rag) + 1) %
                                                RAGS.length
                                            ],
                                          }
                                    ),
                                  }
                            );
                            update(next);
                          }}
                        >
                          {k.rag}
                        </Badge>
                        <b
                          style={{
                            marginLeft: 6,
                          }}
                        >
                          {k.name}
                        </b>
                        <SparkSvg entries={k.entries} />
                      </div>
                      <div className="kpi-meta">
                        target {k.target ?? '—'}
                        {k.unit || ''} ·{' '}
                        {k.direction === 'lower_better'
                          ? '↓ better'
                          : '↑ better'}
                      </div>
                    </td>
                    {allWeeks.map((w) => {
                      const e = k.entries.find((x) => x.week === w);
                      return (
                        <td
                          key={w}
                          style={
                            e?.rag && e.rag !== 'none'
                              ? {
                                  boxShadow: `inset 0 -3px 0 ${ragColor(e.rag)}`,
                                }
                              : undefined
                          }
                        >
                          <input
                            type="number"
                            defaultValue={e?.value ?? ''}
                            placeholder="—"
                            disabled={!canEdit}
                            onChange={(ev) => {
                              const val =
                                ev.target.value === ''
                                  ? null
                                  : Number(ev.target.value);
                              const next = groups.map((gr, i) =>
                                i !== gi
                                  ? gr
                                  : {
                                      ...gr,
                                      kpis: gr.kpis.map((kp, j) => {
                                        if (j !== ki) return kp;
                                        let entries = kp.entries.filter(
                                          (x) => x.week !== w
                                        );
                                        let rag: RagStatus = 'none';
                                        if (val != null && kp.target != null) {
                                          const good =
                                            kp.direction === 'lower_better'
                                              ? val <= kp.target
                                              : val >= kp.target;
                                          const close =
                                            kp.direction === 'lower_better'
                                              ? val <= kp.target * 1.1
                                              : val >= kp.target * 0.9;
                                          rag = good
                                            ? 'green'
                                            : close
                                              ? 'amber'
                                              : 'red';
                                        }
                                        entries = [
                                          ...entries,
                                          {
                                            week: w,
                                            value: val,
                                            rag,
                                            notes: e?.notes ?? '',
                                          },
                                        ];
                                        return {
                                          ...kp,
                                          entries,
                                        };
                                      }),
                                    }
                              );
                              update(next);
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {canEdit && (
      <Button
        variant="outline"
        onClick={() => {
          const n = prompt('Group name:');
          if (n)
            update([
              ...groups,
              {
                id: uuid(),
                name: n,
                kpis: [],
              },
            ]);
        }}
      >
        + KPI Group
      </Button>
      )}
    </div>
  );
}
