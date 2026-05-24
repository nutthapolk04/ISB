import * as React from "react";
import { format, parseISO, isValid } from "date-fns";
import { enUS, th } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { Calendar as CalendarIcon } from "lucide-react";

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

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled,
  min,
  max,
  id,
  className,
}: DatePickerProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "th" ? th : enUS;
  const effectivePlaceholder = placeholder ?? t("common.selectDate");
  const [open, setOpen] = React.useState(false);
  const selected = toDate(value);
  const fromDate = toDate(min);
  const toDateLimit = toDate(max);

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
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selected ? format(selected, "dd MMM yyyy", { locale: dateLocale }) : effectivePlaceholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(toIso(d));
            if (d) setOpen(false);
          }}
          fromDate={fromDate}
          toDate={toDateLimit}
          locale={dateLocale}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
