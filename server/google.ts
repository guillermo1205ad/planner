import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { Credentials } from 'google-auth-library';
import { env } from './env.js';
import { GooglePlannerEvent } from './types.js';

const tokenFilePath = path.join(process.cwd(), 'server', 'data', 'google-tokens.json');

const ensureTokenDir = (): void => {
  const directory = path.dirname(tokenFilePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

const readTokens = (): Credentials | null => {
  if (!fs.existsSync(tokenFilePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(tokenFilePath, 'utf8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
};

const writeTokens = (tokens: Credentials): void => {
  ensureTokenDir();
  fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2), 'utf8');
};

const createOAuthClient = () => {
  if (!hasGoogleConfig()) {
    return null;
  }

  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
};

const createAuthedClient = () => {
  const client = createOAuthClient();
  if (!client) {
    return null;
  }

  const tokens = readTokens();
  if (!tokens) {
    return null;
  }

  client.setCredentials(tokens);

  client.on('tokens', (newTokens) => {
    const merged = {
      ...tokens,
      ...newTokens,
    };
    writeTokens(merged);
  });

  return client;
};

export const hasGoogleConfig = (): boolean =>
  Boolean(env.googleClientId && env.googleClientSecret && env.googleRedirectUri);

export const isGoogleConnected = (): boolean => Boolean(hasGoogleConfig() && readTokens());

export const getGoogleAuthUrl = (): string | null => {
  const client = createOAuthClient();
  if (!client) {
    return null;
  }

  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
};

export const exchangeGoogleCode = async (code: string): Promise<void> => {
  const client = createOAuthClient();
  if (!client) {
    throw new Error('Google Calendar no está configurado.');
  }

  const { tokens } = await client.getToken(code);
  writeTokens(tokens);
};

export const fetchGoogleEvents = async (start: string, end: string): Promise<GooglePlannerEvent[]> => {
  const client = createAuthedClient();
  if (!client) {
    return [];
  }

  const calendar = google.calendar({ version: 'v3', auth: client });
  const response = await calendar.events.list({
    calendarId: env.googleCalendarId,
    timeMin: `${start}T00:00:00Z`,
    timeMax: `${end}T23:59:59Z`,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });

  const items = response.data.items ?? [];

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
