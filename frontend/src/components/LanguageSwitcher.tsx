import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Languages, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LANGUAGES = [
  { code: 'th', badge: 'TH', label: 'ภาษาไทย' },
  { code: 'en', badge: 'EN', label: 'English' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language?.startsWith('th') ? 'th' : 'en';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Languages className="h-[1.2rem] w-[1.2rem]" />
          <span className="sr-only">Toggle language</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {LANGUAGES.map(({ code, badge, label }) => {
          const active = current === code;
          return (
            <DropdownMenuItem
              key={code}
              onClick={() => i18n.changeLanguage(code)}
              className={active ? 'bg-blue-50 text-blue-700 font-medium focus:bg-blue-100 focus:text-blue-700' : ''}
            >
              <span
                className={`mr-2 inline-flex h-5 w-7 items-center justify-center rounded border text-[10px] font-mono font-semibold tracking-wide ${
                  active
                    ? 'border-blue-400 bg-blue-100 text-blue-700'
                    : 'border-border bg-muted text-muted-foreground'
                }`}
              >
                {badge}
              </span>
              <span className="flex-1">{label}</span>
              {active && <Check className="ml-2 h-3.5 w-3.5 text-blue-600 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
