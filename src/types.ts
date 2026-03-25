export type PlannerLevel = 'month' | 'week' | 'day';

export interface DayPlan {
  tasksForToday: string[];
  dontForget: string[];
  urgentTasks: string[];
  notes: string[];
}

export type SectionKey = keyof DayPlan;

export interface StoredDayPlan extends DayPlan {
  updatedAt: string;
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

export interface PlannedTaskItem {
  date: string;
  section: SectionKey;
  text: string;
}
