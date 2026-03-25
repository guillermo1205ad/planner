import { GooglePlannerEvent } from '../types';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

let scriptPromise: Promise<void> | null = null;

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
  }>;
}

export const fetchGoogleEvents = async (
  accessToken: string,
  calendarId: string,
  start: string,
  end: string,
): Promise<GooglePlannerEvent[]> => {
  const resolvedCalendarId = calendarId.trim() || 'primary';
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(resolvedCalendarId)}/events`);
  url.searchParams.set('timeMin', `${start}T00:00:00Z`);
  url.searchParams.set('timeMax', `${end}T23:59:59Z`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('UNAUTHORIZED');
    }

    const body = await response.text();
    throw new Error(`Google Calendar error ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as GoogleEventsResponse;
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
