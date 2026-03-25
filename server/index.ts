import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { format, isAfter, parseISO } from 'date-fns';
import { env } from './env.js';
import { exchangeGoogleCode, fetchGoogleEvents, getGoogleAuthUrl, hasGoogleConfig, isGoogleConnected } from './google.js';
import { getDayPlan, getRangeSummary, isIsoDate, upsertDayPlan } from './store.js';
import { updateDaySchema } from './types.js';

const app = express();

app.use(
  cors({
    origin: env.frontendUrl,
  }),
);
app.use(express.json({ limit: '1mb' }));

const errorPayload = (message: string) => ({ ok: false, error: message });

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    google: {
      configured: hasGoogleConfig(),
      connected: isGoogleConnected(),
    },
  });
});

app.get('/api/planner/day', (req, res) => {
  const date = String(req.query.date ?? '');
  if (!isIsoDate(date)) {
    res.status(400).json(errorPayload('El parámetro date debe ser YYYY-MM-DD.'));
    return;
  }

  res.json({
    ok: true,
    date,
    plan: getDayPlan(date),
  });
});

app.put('/api/planner/day', async (req, res) => {
  const date = String(req.query.date ?? '');
  if (!isIsoDate(date)) {
    res.status(400).json(errorPayload('El parámetro date debe ser YYYY-MM-DD.'));
    return;
  }

  const parsed = updateDaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(errorPayload('Body inválido para actualizar plan diario.'));
    return;
  }

  const updated = upsertDayPlan(date, parsed.data.plan);

  res.json({
    ok: true,
    date,
    plan: updated,
  });
});

app.get('/api/planner/range', async (req, res) => {
  const start = String(req.query.start ?? '');
  const end = String(req.query.end ?? '');

  if (!isIsoDate(start) || !isIsoDate(end)) {
    res.status(400).json(errorPayload('Los parámetros start y end deben ser YYYY-MM-DD.'));
    return;
  }

  const startDate = parseISO(start);
  const endDate = parseISO(end);

  if (isAfter(startDate, endDate)) {
    res.status(400).json(errorPayload('start no puede ser mayor que end.'));
    return;
  }

  const summaryByDate = getRangeSummary(start, end);
  const eventsByDate: Record<string, Array<{ id: string; title: string; start: string; end: string; allDay: boolean }>> = {};

  try {
    const events = await fetchGoogleEvents(start, end);

    for (const event of events) {
      const key = format(parseISO(event.start.length > 10 ? event.start : `${event.start}T00:00:00`), 'yyyy-MM-dd');

      if (!eventsByDate[key]) {
        eventsByDate[key] = [];
      }

      eventsByDate[key].push(event);

      if (!summaryByDate[key]) {
        summaryByDate[key] = {
          tasksForToday: 0,
          dontForget: 0,
          urgentTasks: 0,
          notes: 0,
          googleEvents: 0,
          total: 0,
        };
      }

      summaryByDate[key].googleEvents += 1;
    }
  } catch {
    // Si Google falla, devolvemos sólo el plan local para no bloquear la UI.
  }

  res.json({
    ok: true,
    start,
    end,
    summaryByDate,
    eventsByDate,
  });
});

app.get('/api/google/status', (_req, res) => {
  res.json({
    ok: true,
    configured: hasGoogleConfig(),
    connected: isGoogleConnected(),
  });
});

app.get('/api/google/auth-url', (_req, res) => {
  const url = getGoogleAuthUrl();
  if (!url) {
    res.status(400).json(errorPayload('Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI.'));
    return;
  }

  res.json({
    ok: true,
    url,
  });
});

app.get('/api/google/callback', async (req, res) => {
  const code = String(req.query.code ?? '');
  if (!code) {
    res.status(400).send('No se recibió código de autorización.');
    return;
  }

  try {
    await exchangeGoogleCode(code);
    res.send(`
      <html>
        <body style="font-family: system-ui; padding: 24px; background: #f5f7fb;">
          <h2>Google Calendar conectado</h2>
          <p>Ya puedes cerrar esta ventana y volver al planificador.</p>
        </body>
      </html>
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la conexión con Google.';
    res.status(500).send(message);
  }
});

app.get('/api/google/events', async (req, res) => {
  const start = String(req.query.start ?? '');
  const end = String(req.query.end ?? '');

  if (!isIsoDate(start) || !isIsoDate(end)) {
    res.status(400).json(errorPayload('Los parámetros start y end deben ser YYYY-MM-DD.'));
    return;
  }

  try {
    const events = await fetchGoogleEvents(start, end);
    res.json({
      ok: true,
      events,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron obtener eventos de Google Calendar.';
    res.status(500).json(errorPayload(message));
  }
});

const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }

    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Error interno del servidor.';
  res.status(500).json(errorPayload(message));
});

app.listen(env.port, () => {
  console.log(`Planner API running on http://localhost:${env.port}`);
});
