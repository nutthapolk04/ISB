import * as React from "react";
import { format, parseISO, isValid } from "date-fns";
import { th } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toDate = (iso: string | undefined): Date | undefined => {
  if (!iso) return undefined;
  const d = parseISO(iso);
  return isValid(d) ? d : undefined;
};

const toIso = (d: Date | undefined): string => (d ? format(d, "yyyy-MM-dd") : "");

const formatLabel = (d: Date) => format(d, "dd MMM yyyy", { locale: th });

export interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  numberOfMonths?: number;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  placeholder = "เลือกช่วงวันที่",
  disabled,
  id,
  className,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const from = toDate(startDate);
  const to = toDate(endDate);
  const range: DateRange | undefined = from || to ? { from, to } : undefined;

  const label = (() => {
    if (from && to) return `${formatLabel(from)} — ${formatLabel(to)}`;
    if (from) return `${formatLabel(from)} — …`;
    return placeholder;
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !from && !to && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={(r) => {
            onStartChange(toIso(r?.from));
            onEndChange(toIso(r?.to));
            if (r?.from && r?.to) setOpen(false);
          }}
          numberOfMonths={numberOfMonths}
          locale={th}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
