import { addDays, endOfMonth, format, isValid, parse, startOfMonth, startOfWeek } from 'date-fns';

export interface CalendarCell {
  date: Date;
  dateKey: string;
  inCurrentMonth: boolean;
}

export const dateToInput = (date: Date): string => format(date, 'yyyy-MM-dd');

export const monthToInput = (date: Date): string => format(date, 'yyyy-MM');

export const weekToInput = (date: Date): string => format(date, "RRRR-'W'II");

export const buildMonthGrid = (monthInput: string): CalendarCell[] => {
  const parsed = parse(monthInput, 'yyyy-MM', new Date());
  const monthStart = startOfMonth(isValid(parsed) ? parsed : new Date());
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const currentMonth = format(monthStart, 'yyyy-MM');

  return Array.from({ length: 42 }, (_, index) => {
    const current = addDays(gridStart, index);
    return {
      date: current,
      dateKey: dateToInput(current),
      inCurrentMonth: format(current, 'yyyy-MM') === currentMonth,
    };
  });
};

export const monthRangeFromInput = (monthInput: string): { start: string; end: string } => {
  const parsed = parse(monthInput, 'yyyy-MM', new Date());
  const monthStart = startOfMonth(isValid(parsed) ? parsed : new Date());
  const monthEnd = endOfMonth(monthStart);

  return {
    start: dateToInput(monthStart),
    end: dateToInput(monthEnd),
  };
};

export const weekFromInput = (weekInput: string): Date[] => {
  const parsed = parse(`${weekInput}-1`, "RRRR-'W'II-i", new Date());
  const weekStart = isValid(parsed) ? parsed : startOfWeek(new Date(), { weekStartsOn: 1 });

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
};

export const weekRangeFromInput = (weekInput: string): { start: string; end: string } => {
  const weekDays = weekFromInput(weekInput);
  const first = weekDays[0] ?? new Date();
  const last = weekDays[6] ?? first;

  return {
    start: dateToInput(first),
    end: dateToInput(last),
  };
};
