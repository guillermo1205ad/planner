import dotenv from 'dotenv';

dotenv.config();

const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  port: parsePort(process.env.PORT, 8080),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8080/api/google/callback',
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID ?? 'primary',
};
