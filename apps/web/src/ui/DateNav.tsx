import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { addDays, fmtDate } from '../lib/format';
import { useStore } from '../lib/store';
import { Button, IconButton, cx } from './kit';

/** Plan-date switcher: today, tomorrow, or any day; plus "copy today's plan". */
export function DateNav({ showCopy = true }: { showCopy?: boolean }) {
  const date = useStore((s) => s.date);
  const today = useStore((s) => s.today);
  const setDate = useStore((s) => s.setDate);
  const isToday = date === today;
  const tomorrow = addDays(today, 1);
  return (
    <div className="flex items-center gap-1">
      <IconButton size="sm" label="Previous day" onClick={() => setDate(addDays(date, -1))}>
        <ChevronLeft size={15} />
      </IconButton>
      <div className={cx('flex h-7 items-center rounded-lg px-2 text-[12px] font-semibold', isToday ? 'bg-panel-3' : 'bg-violet-weak text-violet')}>
        {isToday ? 'Today' : date === tomorrow ? 'Tomorrow' : 'Plan'} · {fmtDate(date)}
      </div>
      <IconButton size="sm" label="Next day" onClick={() => setDate(addDays(date, 1))}>
        <ChevronRight size={15} />
      </IconButton>
      {!isToday && (
        <Button size="sm" variant="ghost" onClick={() => setDate(today)}>
          Back to today
        </Button>
      )}
      {isToday && (
        <Button size="sm" variant="ghost" onClick={() => setDate(tomorrow)}>
          Plan tomorrow
        </Button>
      )}
      {showCopy && !isToday && (
        <Button size="sm" icon={<Copy size={12} />} onClick={() => useStore.getState().copyPlanFrom(today)} title="Copy crews, destinations and times from today's plan">
          Copy today
        </Button>
      )}
    </div>
  );
}
