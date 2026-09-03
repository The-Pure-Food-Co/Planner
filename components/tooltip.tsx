"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Elevated } from "@/lib/elevated";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  delayDuration?: number;
  side?: "top" | "bottom" | "left" | "right";
  /** Pass to force show/hide the tooltip (e.g. during a drag), bypassing hover. */
  open?: boolean;
}

function Tooltip({ content, children, delayDuration = 600, side = "top", open }: TooltipProps) {
  // Keep the Root always controlled so it never flips controlled<->uncontrolled
  // (which React warns about). When `open` is provided it overrides hover;
  // otherwise we track hover ourselves.
  const [hoverOpen, setHoverOpen] = useState(false);
  const forced = open !== undefined;
  return (
    <TooltipPrimitive.Provider delay={delayDuration}>
      <TooltipPrimitive.Root
        open={forced ? open : hoverOpen}
        onOpenChange={forced ? undefined : setHoverOpen}
      >
        <TooltipPrimitive.Trigger render={children} />
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Positioner side={side} sideOffset={6} className="z-[70] outline-none">
            <TooltipPrimitive.Popup
              render={<Elevated offset={2} shadowLevel={3} />}
              className="px-2 py-1 text-[12px] text-foreground select-none"
            >
              {content}
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

Tooltip.displayName = "Tooltip";

export { Tooltip };
