import { Children, isValidElement } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Badge as ShadcnBadge } from "./ui/badge";
import { Button as ShadcnButton } from "./ui/button";
import {
  Dialog as ShadcnDialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type LegacyButtonProps = Omit<
  ComponentProps<typeof ShadcnButton>,
  "variant"
> & {
  variant?: "default" | "secondary" | "danger" | "ghost";
};

export function Button({ variant = "default", ...props }: LegacyButtonProps) {
  return (
    <ShadcnButton
      variant={variant === "danger" ? "destructive" : variant}
      {...props}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const classes = {
    neutral: "border-border bg-muted text-muted-foreground",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
  };
  return (
    <ShadcnBadge variant="outline" className={classes[tone]}>
      {children}
    </ShadcnBadge>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          wide
            ? "max-h-[90vh] overflow-hidden sm:max-w-[min(1080px,96vw)]"
            : "sm:max-w-md"
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-auto">{children}</div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </ShadcnDialog>
  );
}

type OptionProps = { value?: string | number; children?: ReactNode };
export function Select({
  value,
  onChange,
  disabled,
  children,
  className,
}: {
  value?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const options = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<OptionProps>[];
  return (
    <ShadcnSelect
      value={String(value ?? "")}
      onValueChange={(next) => onChange?.({ target: { value: next } })}
      disabled={disabled}
    >
      <SelectTrigger className={className ?? "min-w-[170px]"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={String(option.props.value)}
            value={String(option.props.value)}
          >
            {option.props.children}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadcnSelect>
  );
}

export { Input, Slider, Switch, Textarea };
