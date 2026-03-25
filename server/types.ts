import { z } from 'zod';

export const dayPlanSchema = z.object({
  tasksForToday: z.array(z.string().trim().min(1).max(280)).max(100),
  dontForget: z.array(z.string().trim().min(1).max(280)).max(100),
  urgentTasks: z.array(z.string().trim().min(1).max(280)).max(100),
  notes: z.array(z.string().trim().min(1).max(500)).max(100),
});

export const updateDaySchema = z.object({
  plan: dayPlanSchema,
  notifyTelegram: z.boolean().optional().default(false),
});

export type DayPlan = z.infer<typeof dayPlanSchema>;
export type SectionKey = keyof DayPlan;

export interface StoredDayPlan extends DayPlan {
  updatedAt: string;
}

export interface PlannerStore {
  days: Record<string, StoredDayPlan>;
}

export interface DaySummary {
  tasksForToday: number;
  dontForget: number;
  urgentTasks: number;
  notes: number;
  googleEvents: number;
  total: number;
}

export interface GooglePlannerEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}
