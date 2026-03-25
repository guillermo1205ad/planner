import fs from 'node:fs';
import path from 'node:path';
import { eachDayOfInterval, format } from 'date-fns';
import { DayPlan, DaySummary, PlannerStore, StoredDayPlan } from './types.js';

const dataFilePath = path.join(process.cwd(), 'server', 'data', 'planner-data.json');

const defaultStore: PlannerStore = {
  days: {},
};

const emptyDayPlan = (): DayPlan => ({
  tasksForToday: [],
  dontForget: [],
  urgentTasks: [],
  notes: [],
});

const cleanLines = (values: string[]): string[] =>
  values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const normalizeDayPlan = (plan: DayPlan): DayPlan => ({
  tasksForToday: cleanLines(plan.tasksForToday),
  dontForget: cleanLines(plan.dontForget),
  urgentTasks: cleanLines(plan.urgentTasks),
  notes: cleanLines(plan.notes),
});

const ensureStoreFile = (): void => {
  const directory = path.dirname(dataFilePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(dataFilePath)) {
    fs.writeFileSync(dataFilePath, JSON.stringify(defaultStore, null, 2), 'utf8');
  }
};

const readStore = (): PlannerStore => {
  ensureStoreFile();

  try {
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PlannerStore>;
    return {
      days: parsed.days ?? {},
    };
  } catch {
    return { ...defaultStore };
  }
};

const writeStore = (store: PlannerStore): void => {
  ensureStoreFile();
  fs.writeFileSync(dataFilePath, JSON.stringify(store, null, 2), 'utf8');
};

export const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const asDate = new Date(`${value}T00:00:00`);
  return !Number.isNaN(asDate.getTime());
};

export const getDayPlan = (date: string): StoredDayPlan => {
  const store = readStore();
  const existing = store.days[date];

  if (existing) {
    return existing;
  }

  return {
    ...emptyDayPlan(),
    updatedAt: '',
  };
};

export const upsertDayPlan = (date: string, plan: DayPlan): StoredDayPlan => {
  const store = readStore();
  const normalized = normalizeDayPlan(plan);

  const nextValue: StoredDayPlan = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };

  store.days[date] = nextValue;
  writeStore(store);

  return nextValue;
};

export const getRangeSummary = (start: string, end: string): Record<string, DaySummary> => {
  const store = readStore();
  const dates = eachDayOfInterval({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
  });

  const summary: Record<string, DaySummary> = {};

  for (const current of dates) {
    const dateKey = format(current, 'yyyy-MM-dd');
    const day = store.days[dateKey] ?? {
      ...emptyDayPlan(),
      updatedAt: '',
    };

    const taskCount = day.tasksForToday.length + day.dontForget.length + day.urgentTasks.length;

    summary[dateKey] = {
      tasksForToday: day.tasksForToday.length,
      dontForget: day.dontForget.length,
      urgentTasks: day.urgentTasks.length,
      notes: day.notes.length,
      googleEvents: 0,
      total: taskCount,
    };
  }

  return summary;
};
