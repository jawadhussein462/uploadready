import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-pen text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.16)] hover:bg-pen-hover active:translate-y-px",
        ink: "bg-ink text-white hover:bg-[#1a2f66] active:translate-y-px",
        outline: "border border-rule bg-paper text-ink hover:border-[#b9c2d6] hover:bg-sheet",
        ghost: "text-ink-2 hover:bg-sheet hover:text-ink",
        link: "h-auto px-0 text-pen underline-offset-4 hover:underline",
        danger: "text-fail hover:bg-fail-tint",
      },
      size: {
        sm: "h-8 rounded-[8px] px-3 text-sm",
        md: "h-10 rounded-[9px] px-4 text-sm",
        lg: "h-12 rounded-[10px] px-5 text-base",
        icon: "size-9 rounded-[8px]",
        "icon-sm": "size-8 rounded-[7px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : (type ?? "button")} {...props} />;
}
