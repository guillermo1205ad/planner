import { addDays, format, parseISO } from 'date-fns';
import { DayPlan, GooglePlannerEvent } from '../types';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';

let scriptPromise: Promise<void> | null = null;

const toGoogleError = (status: number, body: string): Error => {
  if (status === 401) {
    return new Error('UNAUTHORIZED');
  }

  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
    };

    const reason = parsed.error?.errors?.[0]?.reason;
    const message = parsed.error?.message ?? body;

    if (status === 404 && reason === 'notFound') {
      return new Error('No se encontró el Calendar ID. Usa "primary" o el ID exacto del calendario.');
    }

    if (status === 403 && reason === 'insufficientPermissions') {
      return new Error('Faltan permisos de calendario. Reconecta Google y acepta los permisos.');
    }

    return new Error(`Google Calendar error ${status}: ${message}`);
  } catch {
    return new Error(`Google Calendar error ${status}: ${body}`);
  }
};

const googleFetch = async <T>(accessToken: string, url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw toGoogleError(response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

const ensureGoogleScript = (): Promise<void> => {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services.'));
    document.head.appendChild(script);
  });

  return scriptPromise;
};

export const requestGoogleAccessToken = async (clientId: string, prompt: '' | 'consent' = 'consent'): Promise<string> => {
  if (!clientId.trim()) {
    throw new Error('Debes ingresar Google Client ID.');
  }

  await ensureGoogleScript();

  return await new Promise<string>((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: GOOGLE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || 'No se obtuvo token de Google.'));
          return;
        }

        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt });
  });
};

interface GoogleEventsResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    extendedProperties?: {
      private?: {
        plannerApp?: string;
        plannerDate?: string;
        plannerKey?: string;
      };
    };
  }>;
}

export const fetchGoogleEvents = async (
  accessToken: string,
  calendarId: string,
  start: string,
  end: string,
): Promise<GooglePlannerEvent[]> => {
  const resolvedCalendarId = calendarId.trim() || 'primary';
  const url = new URL(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(resolvedCalendarId)}/events`);
  url.searchParams.set('timeMin', `${start}T00:00:00Z`);
  url.searchParams.set('timeMax', `${end}T23:59:59Z`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');

  const payload = await googleFetch<GoogleEventsResponse>(accessToken, url.toString(), { method: 'GET' });
  const items = payload.items ?? [];

  return items
    .filter((item) => item.id && item.start && item.end)
    .map((item) => ({
      id: item.id as string,
      title: item.summary?.trim() || 'Sin título',
      start: item.start?.dateTime ?? item.start?.date ?? '',
      end: item.end?.dateTime ?? item.end?.date ?? '',
      allDay: Boolean(item.start?.date && !item.start?.dateTime),
    }))
    .filter((item) => Boolean(item.start && item.end));
};

interface SyncItem {
  key: string;
  summary: string;
  description: string;
}

interface SyncResult {
  created: number;
  updated: number;
  removed: number;
}

const sectionTitle: Record<keyof DayPlan, string> = {
  tasksForToday: 'Tareas para hoy',
  dontForget: 'No olvidar',
  urgentTasks: 'Tareas urgentes',
  notes: 'Notas',
};

const buildSyncItems = (plan: DayPlan, date: string): SyncItem[] => {
  const items: SyncItem[] = [];
  const sections: Array<keyof DayPlan> = ['tasksForToday', 'dontForget', 'urgentTasks', 'notes'];
  const counters = new Map<string, number>();

  for (const section of sections) {
    for (const textRaw of plan[section]) {
      const text = textRaw.trim();
      if (!text) {
        continue;
      }

      const counterKey = `${section}|${text}`;
      const occurrence = (counters.get(counterKey) ?? 0) + 1;
      counters.set(counterKey, occurrence);

      const key = `${section}|${text}|${occurrence}`;

      items.push({
        key,
        summary: `[Planner] ${sectionTitle[section]}: ${text}`,
        description: `Sincronizado desde Planner (${date})`,
      });
    }
  }

  return items;
};

export const syncDayPlanToGoogleCalendar = async (
  accessToken: string,
  calendarId: string,
  date: string,
  plan: DayPlan,
): Promise<SyncResult> => {
  const resolvedCalendarId = calendarId.trim() || 'primary';
  const nextDate = format(addDays(parseISO(`${date}T00:00:00`), 1), 'yyyy-MM-dd');
  const desired = buildSyncItems(plan, date);
  const desiredMap = new Map(desired.map((item) => [item.key, item]));

  const listUrl = new URL(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(resolvedCalendarId)}/events`);
  listUrl.searchParams.set('timeMin', `${date}T00:00:00Z`);
  listUrl.searchParams.set('timeMax', `${date}T23:59:59Z`);
  listUrl.searchParams.set('singleEvents', 'true');
  listUrl.searchParams.set('maxResults', '250');
  listUrl.searchParams.append('privateExtendedProperty', 'plannerApp=true');
  listUrl.searchParams.append('privateExtendedProperty', `plannerDate=${date}`);

  const existingResponse = await googleFetch<GoogleEventsResponse>(accessToken, listUrl.toString(), { method: 'GET' });
  const existing = existingResponse.items ?? [];

  const existingByKey = new Map<string, { id: string }>();

  for (const event of existing) {
    const key = event.extendedProperties?.private?.plannerKey;
    if (!key || !event.id) {
      continue;
    }

    existingByKey.set(key, {
      id: event.id,
    });
  }

  let removed = 0;
  let created = 0;
  let updated = 0;

  for (const [key, event] of existingByKey.entries()) {
    if (desiredMap.has(key)) {
      continue;
    }

    const deleteUrl = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(resolvedCalendarId)}/events/${encodeURIComponent(
      event.id,
    )}`;
    await googleFetch<Record<string, never>>(accessToken, deleteUrl, { method: 'DELETE' });
    removed += 1;
  }

  for (const item of desired) {
    const eventBody = {
      summary: item.summary,
      description: item.description,
      start: { date },
      end: { date: nextDate },
      extendedProperties: {
        private: {
          plannerApp: 'true',
          plannerDate: date,
          plannerKey: item.key,
        },
      },
    };

    const existingMatch = existingByKey.get(item.key);

    if (existingMatch) {
      const patchUrl = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(resolvedCalendarId)}/events/${encodeURIComponent(
        existingMatch.id,
      )}`;
      await googleFetch<GoogleEventsResponse>(accessToken, patchUrl, {
        method: 'PATCH',
        body: JSON.stringify(eventBody),
      });
      updated += 1;
      continue;
    }

    const insertUrl = `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(resolvedCalendarId)}/events`;
    await googleFetch<GoogleEventsResponse>(accessToken, insertUrl, {
      method: 'POST',
      body: JSON.stringify(eventBody),
    });
    created += 1;
  }

  return { created, updated, removed };
};
