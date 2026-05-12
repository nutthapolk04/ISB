import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type TooltipSide = "top" | "bottom" | "left" | "right";

export interface IconButtonProps extends Omit<ButtonProps, "aria-label"> {
  tooltip: string;
  tooltipSide?: TooltipSide;
  tooltipDelay?: number;
}

/**
 * Icon-only button with a required tooltip + aria-label.
 * Use instead of `<Button size="icon">` whenever the button has no visible text.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { tooltip, tooltipSide = "top", tooltipDelay = 200, size = "icon", variant = "ghost", children, ...rest },
    ref,
  ) => (
    <Tooltip delayDuration={tooltipDelay}>
      <TooltipTrigger asChild>
        <Button ref={ref} size={size} variant={variant} aria-label={tooltip} {...rest}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  ),
);
IconButton.displayName = "IconButton";
