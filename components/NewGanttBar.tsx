import React from "react";

/**
 * Gantt Bar — Light mode, 4 variants
 *
 * Same markup/props as the shipped dark GanttBar, but restyled for a light
 * canvas. Pass `variant="cap" | "depth" | "track" | "full"` to switch look:
 *
 *  - "cap"   : flat tinted bar + soft top sheen (closest to a plain flat bar,
 *              most legible in dense charts)
 *  - "depth" : white card body, glossy inset fill block (light equivalent of
 *              the shipped dark treatment)
 *  - "track" : neutral track, only the completed portion gets the glossy fill
 *  - "full"  : the entire bar is the glossy surface, progress reads as a
 *              brighter wash from the left edge
 *
 * All color-mix() calls are pre-computed in plain JS (see hexToRgb/mix/rgba)
 * so no @supports fallback or CSS color-mix() support is required.
 *
 * Usage:
 * <GanttBar
 *   variant="depth"
 *   name="Prep supplier deck"
 *   percent={58}
 *   lane="#c63663"
 *   ragColor="#6ba539"
 *   left={0}
 *   width={340}
 *   labelInside
 * />
 */

// --- color helpers (replace color-mix with plain JS math) ---
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function mix(hex: string, target: "white" | "black", weightPct: number) {
  // mixes `hex` with `target` ("white" | "black") by weightPct% of hex
  const { r, g, b } = hexToRgb(hex);
  const t = target === "white" ? 255 : 0;
  const w = weightPct / 100;
  const mixChan = (c: number) => Math.round(c * w + t * (1 - w));
  return `rgb(${mixChan(r)}, ${mixChan(g)}, ${mixChan(b)})`;
}

function rgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type GanttBarVariant = "cap" | "depth" | "track" | "full";

interface GanttBarProps {
  variant?: GanttBarVariant;
  name: string;
  percent?: number;
  lane?: string;
  ragColor?: string;
  left?: number | string;
  width?: number | string;
  labelInside?: boolean;
  started?: boolean; // false => "Not started" style bar (0% fill, no rag/pct)
  onDragStart?: React.MouseEventHandler<HTMLDivElement>;
  onResizeLeft?: React.MouseEventHandler<HTMLSpanElement>;
  onResizeRight?: React.MouseEventHandler<HTMLSpanElement>;
  onResizePct?: React.MouseEventHandler<HTMLSpanElement>;
}

export default function GanttBar({
  variant = "cap",
  name,
  percent = 0,
  lane = "#c63663",
  ragColor = "#6ba539",
  left = 0,
  width = 260,
  labelInside = false,
  started = true,
  onDragStart,
  onResizeLeft,
  onResizeRight,
  onResizePct,
}: GanttBarProps) {
  // Precomputed color-mix() replacements, shared across variants
  const laneAlpha15 = rgba(lane, 0.15);
  const laneAlpha22 = rgba(lane, 0.22);
  const laneAlpha40 = rgba(lane, 0.4);
  const laneAlpha45 = rgba(lane, 0.45);
  const laneAlpha55 = rgba(lane, 0.55);
  const laneAlpha60 = rgba(lane, 0.6);
  const laneLight22 = mix(lane, "white", 22); // flat tint bg for "cap"/"track"
  const laneLight50 = mix(lane, "white", 50);
  const laneDark75 = mix(lane, "black", 75);
  const laneWhite15 = mix(lane, "white", 15);
  const laneBlack60 = mix(lane, "black", 60);

  const barStyle = {
    left: typeof left === "number" ? `${left}px` : left,
    width: typeof width === "number" ? `${width}px` : width,
    "--lane": lane,
    "--lane-alpha-15": laneAlpha15,
    "--lane-alpha-22": laneAlpha22,
    "--lane-alpha-40": laneAlpha40,
    "--lane-alpha-45": laneAlpha45,
    "--lane-alpha-55": laneAlpha55,
    "--lane-alpha-60": laneAlpha60,
    "--lane-light-22": laneLight22,
    "--lane-light-50": laneLight50,
    "--lane-dark-75": laneDark75,
    "--lane-white-15": laneWhite15,
    "--lane-black-60": laneBlack60,
  } as React.CSSProperties;

  const isDarkText = variant === "cap" || variant === "track";
  const labelInsideColor = isDarkText ? "#2c2c2c" : "#fff";
  const labelInsideShadow = isDarkText ? "none" : "0 1px 2px rgba(0,0,0,.25)";

  return (
    <div className="gbl-row">
      <div
        className={`gbl-bar gbl-${variant}`}
        style={barStyle}
        onMouseDown={onDragStart}
      >
        <div className="gbl-fill" style={{ width: `${percent}%` }}>
          {started && (
            <span
              className="gbl-grip gbl-grip-pct"
              style={{ left: `calc(${percent}% - 6px)` }}
              onMouseDown={onResizePct}
            />
          )}
        </div>

        <span
          className={`gbl-blabel${labelInside ? " gbl-inside" : ""}`}
          style={
            labelInside
              ? { color: labelInsideColor, textShadow: labelInsideShadow }
              : undefined
          }
        >
          {name}
        </span>

        {started && (
          <span
            className="gbl-bpct"
            style={!labelInside ? undefined : { color: labelInsideColor }}
          >
            {percent}%
          </span>
        )}
        {started && (
          <span className="gbl-rag" style={{ background: ragColor }} />
        )}

        <span className="gbl-grip gbl-grip-left" onMouseDown={onResizeLeft} />
        <span
          className="gbl-grip gbl-grip-right"
          onMouseDown={onResizeRight}
        />
      </div>

      <style>{`
        .gbl-row {
          position: relative;
          height: 44px;
        }

        .gbl-bar {
          position: absolute;
          top: 6px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          cursor: grab;
          user-select: none;
          touch-action: none;
          transition: box-shadow 0.15s;
          z-index: 2;
          overflow: visible;
        }

        .gbl-grip {
          position: absolute;
          top: 50%;
          width: 3px;
          height: 20px;
          margin-top: -10px;
          border-radius: 2px;
          background: #fff;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
          opacity: 0;
          cursor: ew-resize;
          transition: opacity 0.2s;
          z-index: 3;
        }

        .gbl-bar:hover .gbl-grip { opacity: 0.9; }
        .gbl-grip.gbl-grip-left { left: 2px; }
        .gbl-grip.gbl-grip-right { right: 2px; }

        .gbl-grip.gbl-grip-pct {
          width: 12px;
          height: 12px;
          margin-top: -6px;
          right: -6px;
          border-radius: 3px;
          background: #fff;
          border: none;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
          transition: opacity 0.15s, transform 0.15s;
          transform: rotate(45deg);
          z-index: 3;
        }

        .gbl-bar:hover .gbl-grip.gbl-grip-pct { opacity: 0.9; }
        .gbl-grip.gbl-grip-pct:hover {
          opacity: 1;
          transform: rotate(45deg) scale(1.25);
        }

        .gbl-blabel {
          position: absolute;
          left: 100%;
          top: 50%;
          transform: translateY(-50%);
          margin-left: 10px;
          z-index: 1;
          font-size: 14px;
          font-weight: 500;
          color: #2c2c2c;
          white-space: nowrap;
        }

        .gbl-blabel.gbl-inside {
          left: 10px;
          margin-left: 0;
        }

        .gbl-bpct {
          position: absolute;
          right: 6px;
          font-size: 11px;
          font-weight: 400;
          color: #2c2c2c;
          opacity: 0.75;
          z-index: 1;
        }

        .gbl-rag {
          position: absolute;
          right: -5px;
          top: -5px;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          border: 2px solid #fff;
          z-index: 2;
        }

        /* ================= Variant: cap ================= */
        /* Flat tinted bar, soft top sheen strip. Closest to a plain flat
           bar, most legible in dense charts. */
        .gbl-cap {
          background: var(--lane-light-22);
          border: 1px solid var(--lane-alpha-60);
          box-shadow: 0 2px 6px var(--lane-alpha-22);
        }
        .gbl-cap::before {
          content: '';
          position: absolute;
          inset: 1px 1px auto 1px;
          height: 42%;
          border-radius: 7px 7px 40% 40%/7px 7px 100% 100%;
          background: linear-gradient(180deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%);
          pointer-events: none;
        }
        .gbl-cap .gbl-fill {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          border-radius: 7px 0 0 7px;
          background: var(--lane-alpha-55);
        }
        .gbl-cap .gbl-fill::before {
          content: '';
          position: absolute;
          inset: 1px 0 auto 1px;
          right: 1px;
          height: 42%;
          background: linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 100%);
        }

        /* ================= Variant: depth ================= */
        /* White elevated card body, glossy inset fill block. Light-mode
           equivalent of the shipped dark treatment. */
        .gbl-depth {
          background: #ffffff;
          border: 1px solid #e7e0dd;
          box-shadow: 0 1px 2px var(--lane-alpha-15) inset;
        }
        .gbl-depth:hover {
          box-shadow: 0 4px 14px rgba(44, 44, 44, 0.1), 0 1px 2px var(--lane-alpha-15) inset;
        }
        .gbl-depth .gbl-fill {
          position: absolute;
          inset: 3px;
          border-radius: 6px 0 0 6px;
          overflow: hidden;
          background:
            radial-gradient(120% 160% at 75% 100%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 55%),
            radial-gradient(140% 140% at 15% 10%, var(--lane-light-50) 0%, var(--lane-dark-75) 100%);
          background-blend-mode: overlay, normal;
          box-shadow:
            3px 4px 10px var(--lane-alpha-45),
            inset -2px -2px 3px var(--lane-white-15),
            inset 2px 2px 3px var(--lane-black-60);
        }
        .gbl-depth .gbl-blabel.gbl-inside,
        .gbl-depth .gbl-bpct { position: relative; z-index: 2; }

        /* ================= Variant: track ================= */
        /* Neutral track; only the completed portion gets the glossy fill. */
        .gbl-track {
          background: #f1ecea;
          border: 1px solid #e7e0dd;
        }
        .gbl-track .gbl-fill {
          position: absolute;
          inset: 0;
          border-radius: 7px 0 0 7px;
          overflow: hidden;
          background:
            radial-gradient(120% 120% at 70% 85%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 60%),
            radial-gradient(130% 130% at 12% 15%, var(--lane-light-50) 0%, var(--lane-dark-75) 100%);
          background-blend-mode: overlay, normal;
          box-shadow:
            2px 0 8px var(--lane-alpha-40),
            inset -2px -2px 3px var(--lane-white-15),
            inset 2px 2px 3px var(--lane-black-60);
        }

        /* ================= Variant: full ================= */
        /* The whole bar is the glossy surface; progress reads as a
           brighter wash from the left edge. */
        .gbl-full {
          background:
            radial-gradient(120% 120% at 70% 85%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 60%),
            radial-gradient(130% 130% at 12% 15%, var(--lane-light-50) 0%, var(--lane-dark-75) 100%);
          background-blend-mode: overlay, normal;
          box-shadow:
            0 6px 14px var(--lane-alpha-45),
            inset -2px -2px 3px var(--lane-white-15),
            inset 3px 3px 4px var(--lane-black-60);
        }
        .gbl-full .gbl-fill {
          position: absolute;
          inset: 0;
          border-radius: 8px 0 0 8px;
          overflow: hidden;
          background: linear-gradient(90deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 100%);
        }
        .gbl-full .gbl-blabel,
        .gbl-full .gbl-bpct {
          color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,.25);
        }
      `}</style>
    </div>
  );
}