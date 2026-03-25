import { eachDayOfInterval, format } from 'date-fns';
import { DayPlan, DaySummary, PlannedTaskItem, StoredDayPlan } from '../types';

const STORE_KEY = 'planner_store_v2';

interface PlannerStore {
  days: Record<string, StoredDayPlan>;
}

const defaultPlan = (): DayPlan => ({
  tasksForToday: [],
  dontForget: [],
  urgentTasks: [],
  notes: [],
});

const defaultStore = (): PlannerStore => ({
  days: {},
});

const normalizeLines = (values: string[]): string[] =>
  values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const normalizePlan = (plan: DayPlan): DayPlan => ({
  tasksForToday: normalizeLines(plan.tasksForToday),
  dontForget: normalizeLines(plan.dontForget),
  urgentTasks: normalizeLines(plan.urgentTasks),
  notes: normalizeLines(plan.notes),
});

const safeParseStore = (raw: string | null): PlannerStore => {
  if (!raw) {
    return defaultStore();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PlannerStore>;
    return {
      days: parsed.days ?? {},
    };
  } catch {
    return defaultStore();
  }
};

export const readStore = (): PlannerStore => safeParseStore(window.localStorage.getItem(STORE_KEY));

export const writeStore = (store: PlannerStore): void => {
  window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
};

export const getDayPlan = (date: string): StoredDayPlan => {
  const store = readStore();
  const existing = store.days[date];

  if (existing) {
    return existing;
  }

  return {
    ...defaultPlan(),
    updatedAt: '',
  };
};

export const upsertDayPlan = (date: string, plan: DayPlan): StoredDayPlan => {
  const store = readStore();
  const normalized = normalizePlan(plan);

  const next: StoredDayPlan = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };

  store.days[date] = next;
  writeStore(store);

  return next;
};

export const getRangeSummary = (start: string, end: string): Record<string, DaySummary> => {
  const store = readStore();
  const dates = eachDayOfInterval({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
  });

  const summary: Record<string, DaySummary> = {};

  for (const date of dates) {
    const key = format(date, 'yyyy-MM-dd');
    const value = store.days[key] ?? {
      ...defaultPlan(),
      updatedAt: '',
    };

    summary[key] = {
      tasksForToday: value.tasksForToday.length,
      dontForget: value.dontForget.length,
      urgentTasks: value.urgentTasks.length,
      notes: value.notes.length,
      googleEvents: 0,
      total: value.tasksForToday.length + value.dontForget.length + value.urgentTasks.length,
    };
  }

  return summary;
};

export const listRangeTasks = (start: string, end: string): PlannedTaskItem[] => {
  const store = readStore();
  const dates = eachDayOfInterval({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
  });

  const items: PlannedTaskItem[] = [];

  for (const date of dates) {
    const key = format(date, 'yyyy-MM-dd');
    const plan = store.days[key];

    if (!plan) {
      continue;
    }

    for (const text of plan.tasksForToday) {
      items.push({ date: key, section: 'tasksForToday', text });
    }
    for (const text of plan.dontForget) {
      items.push({ date: key, section: 'dontForget', text });
    }
    for (const text of plan.urgentTasks) {
      items.push({ date: key, section: 'urgentTasks', text });
    }
    for (const text of plan.notes) {
      items.push({ date: key, section: 'notes', text });
    }
  }

  return items;
};
