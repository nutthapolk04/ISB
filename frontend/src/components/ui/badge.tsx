import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium leading-none transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary/20 bg-primary/15 text-primary hover:bg-primary/20",
        secondary: "border-border bg-secondary text-secondary-foreground hover:bg-secondary/90",
        destructive: "border-destructive/25 bg-destructive/15 text-destructive hover:bg-destructive/20",
        success: "border-success/25 bg-success/15 text-success hover:bg-success/20",
        warning: "border-warning/25 bg-warning/15 text-warning hover:bg-warning/20",
        outline: "border-border bg-background text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
