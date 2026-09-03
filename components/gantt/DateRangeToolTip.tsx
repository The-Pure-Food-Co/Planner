import { Calendar } from "lucide-react";

/**
 * Recreated using the exact style block provided:
 * - dual radial-gradient background with background-blend-mode: overlay
 *   (soft white highlight radial + solid color radial underneath)
 * - box-shadow: outer drop shadow + two inset highlights/shadows
 * - border-radius: 12px, padding: 10px 20px, gap: 6px
 * - font-weight 400, letter-spacing -.13px, font-size 16px, white text
 *
 * Original blue base colors (#1e82e0 -> #1c38ea) replaced with C63663-based tones.
 */
interface DateRangeTooltipProps {
  startDate?: string;
  endDate?: string;
  style?: React.CSSProperties;
  className?: string;
  compact?: boolean;
}

export default function DateRangeTooltip({
  startDate = "12 Jan 2026",
  endDate = "18 Jan 2026",
  style,
  className,
  compact,
}: DateRangeTooltipProps) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "fit-content",
        display: "flex",
        alignItems: "center",
        gap: compact ? "4px" : "6px",
        overflow: "hidden",
        padding: compact ? "5px 10px" : "10px 20px",
        fontWeight: 400,
        letterSpacing: "-.13px",
        color: "#fff",
        fontSize: compact ? "11px" : "16px",
        fontFamily:
          'var(--font-geist), ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
        backgroundBlendMode: "overlay, normal",
        background:
          "radial-gradient(101.79% 101.79% at 65.61% 81.79%, #fff9 0, #fff0 100%), radial-gradient(114.65% 114.65% at 9.73% 17.27%, #d9527f 0, #a12649 100%)",
        transition: "transform .16s ease-out",
        boxShadow:
          "20px 20px 24px #f394ac66, inset -3px -3px 4px #fbbfe566, inset 4px 4px 4px #e4131a1a",
        borderRadius: compact ? "8px" : "12px",
        ...style,
      }}
    >
      <Calendar className={compact ? "w-3 h-3 shrink-0" : "w-4 h-4 shrink-0"} strokeWidth={2} />
      <span style={{ whiteSpace: "nowrap" }}>
        {startDate} <span style={{ opacity: 0.75, margin: "0 2px" }}>–</span> {endDate}
      </span>
    </div>
  );
}