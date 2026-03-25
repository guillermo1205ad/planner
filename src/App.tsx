import { format, parseISO } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMonthGrid,
  dateToInput,
  monthRangeFromInput,
  monthToInput,
  weekFromInput,
  weekRangeFromInput,
  weekToInput,
} from './lib/date';
import { fetchGoogleEvents, requestGoogleAccessToken, syncDayPlanToGoogleCalendar } from './lib/googleBrowser';
import { getDayPlan, getRangeSummary, getSettings, saveSettings, upsertDayPlan } from './lib/localStore';
import { DayPlan, DaySummary, GooglePlannerEvent, PlannerLevel, PlannerSettings, SectionKey } from './types';

const levels: Array<{ id: PlannerLevel; title: string; subtitle: string }> = [
  { id: 'month', title: 'Mensual', subtitle: 'Panorama de carga y eventos' },
  { id: 'week', title: 'Semanal', subtitle: 'Prioridades por bloque de 7 días' },
  { id: 'day', title: 'Diario', subtitle: 'Ejecución detallada del día' },
];

const sections: Array<{
  key: SectionKey;
  title: string;
  helper: string;
  placeholder: string;
  tone: string;
}> = [
  {
    key: 'tasksForToday',
    title: 'Tareas para hoy',
    helper: 'Acciones concretas que sí o sí se deben ejecutar hoy.',
    placeholder: 'Ej: preparar propuesta para cliente',
    tone: 'today',
  },
  {
    key: 'dontForget',
    title: 'No olvidar',
    helper: 'Recordatorios importantes para no perder contexto.',
    placeholder: 'Ej: confirmar reunión con finanzas',
    tone: 'remember',
  },
  {
    key: 'urgentTasks',
    title: 'Tareas urgentes',
    helper: 'Bloque crítico de alta prioridad y vencimiento cercano.',
    placeholder: 'Ej: responder incidente de producción',
    tone: 'urgent',
  },
  {
    key: 'notes',
    title: 'Notas',
    helper: 'Ideas, decisiones y observaciones útiles para el día.',
    placeholder: 'Ej: probar campaña A/B antes del viernes',
    tone: 'notes',
  },
];

const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

type BannerType = 'success' | 'error' | 'info';

const clonePlan = (plan: DayPlan): DayPlan => ({
  tasksForToday: [...plan.tasksForToday],
  dontForget: [...plan.dontForget],
  urgentTasks: [...plan.urgentTasks],
  notes: [...plan.notes],
});

const buildDailyMessage = (title: string, date: string, plan: DayPlan): string =>
  [
    `${title.trim() || 'Resumen del día'} ${date}`,
    `Tareas para hoy (${plan.tasksForToday.length}): ${plan.tasksForToday.join(' | ') || 'sin items'}`,
    `No olvidar (${plan.dontForget.length}): ${plan.dontForget.join(' | ') || 'sin items'}`,
    `Urgentes (${plan.urgentTasks.length}): ${plan.urgentTasks.join(' | ') || 'sin items'}`,
    `Notas (${plan.notes.length}): ${plan.notes.join(' | ') || 'sin items'}`,
  ].join('\n');

const eventTime = (event: GooglePlannerEvent): string => {
  if (event.allDay) {
    return 'Todo el día';
  }

  const parsed = parseISO(event.start);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return format(parsed, 'HH:mm');
};

const toDateKey = (value: string): string => {
  const source = value.length > 10 ? value : `${value}T00:00:00`;
  const parsed = parseISO(source);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : format(parsed, 'yyyy-MM-dd');
};

const withGoogleCounts = (
  summary: Record<string, DaySummary>,
  eventsByDate: Record<string, GooglePlannerEvent[]>,
): Record<string, DaySummary> => {
  const next = { ...summary };

  Object.entries(eventsByDate).forEach(([date, events]) => {
    if (!next[date]) {
      next[date] = {
        tasksForToday: 0,
        dontForget: 0,
        urgentTasks: 0,
        notes: 0,
        googleEvents: 0,
        total: 0,
      };
    }

    next[date] = {
      ...next[date],
      googleEvents: events.length,
    };
  });

  return next;
};

const openTelegramShare = (text: string): void => {
  const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
  window.open(shareUrl, '_blank', 'noopener,noreferrer');
};

function App() {
  const initialDate = useMemo(() => new Date(), []);
  const [activeLevel, setActiveLevel] = useState<PlannerLevel>('month');
  const [monthValue, setMonthValue] = useState(monthToInput(initialDate));
  const [weekValue, setWeekValue] = useState(weekToInput(initialDate));
  const [dayValue, setDayValue] = useState(dateToInput(initialDate));

  const [dayPlan, setDayPlan] = useState<DayPlan>(clonePlan(getDayPlan(dayValue)));
  const [summaryByDate, setSummaryByDate] = useState<Record<string, DaySummary>>({});
  const [eventsByDate, setEventsByDate] = useState<Record<string, GooglePlannerEvent[]>>({});

  const [settings, setSettings] = useState<PlannerSettings>(getSettings());
  const [googleAccessToken, setGoogleAccessToken] = useState('');
  const [shareOnSave, setShareOnSave] = useState(false);
  const [syncGoogleOnSave, setSyncGoogleOnSave] = useState(true);
  const [integrationBusy, setIntegrationBusy] = useState<'google' | 'telegram' | null>(null);
  const [loadingRange, setLoadingRange] = useState(false);
  const [savingDay, setSavingDay] = useState(false);

  const [drafts, setDrafts] = useState<Record<SectionKey, string>>({
    tasksForToday: '',
    dontForget: '',
    urgentTasks: '',
    notes: '',
  });

  const [banner, setBanner] = useState<{ type: BannerType; text: string } | null>(null);
  const bannerTimer = useRef<number | null>(null);

  const showBanner = useCallback((type: BannerType, text: string) => {
    setBanner({ type, text });

    if (bannerTimer.current) {
      window.clearTimeout(bannerTimer.current);
    }

    bannerTimer.current = window.setTimeout(() => {
      setBanner(null);
    }, 5000);
  }, []);

  useEffect(
    () => () => {
      if (bannerTimer.current) {
        window.clearTimeout(bannerTimer.current);
      }
    },
    [],
  );

  const activeRange = useMemo(() => {
    if (activeLevel === 'month') {
      return monthRangeFromInput(monthValue);
    }

    if (activeLevel === 'week') {
      return weekRangeFromInput(weekValue);
    }

    return { start: dayValue, end: dayValue };
  }, [activeLevel, monthValue, weekValue, dayValue]);

  const loadRange = useCallback(
    async (start: string, end: string) => {
      setLoadingRange(true);

      const localSummary = getRangeSummary(start, end);
      let nextEventsByDate: Record<string, GooglePlannerEvent[]> = {};

      if (googleAccessToken) {
        try {
          const events = await fetchGoogleEvents(googleAccessToken, settings.googleCalendarId, start, end);
          nextEventsByDate = events.reduce<Record<string, GooglePlannerEvent[]>>((accumulator, event) => {
            const key = toDateKey(event.start);
            if (!accumulator[key]) {
              accumulator[key] = [];
            }
            accumulator[key].push(event);
            return accumulator;
          }, {});
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo leer Google Calendar.';

          if (message === 'UNAUTHORIZED') {
            setGoogleAccessToken('');
            showBanner('info', 'Tu sesión de Google expiró. Pulsa "Conectar Google" nuevamente.');
          } else {
            showBanner('error', message);
          }
        }
      }

      setEventsByDate(nextEventsByDate);
      setSummaryByDate(withGoogleCounts(localSummary, nextEventsByDate));
      setLoadingRange(false);
    },
    [googleAccessToken, settings.googleCalendarId, showBanner],
  );

  useEffect(() => {
    const next = getDayPlan(dayValue);
    setDayPlan(clonePlan(next));
  }, [dayValue]);

  useEffect(() => {
    void loadRange(activeRange.start, activeRange.end);
  }, [activeRange.end, activeRange.start, loadRange]);

  const persistSettings = (next: PlannerSettings): void => {
    setSettings(saveSettings(next));
  };

  const updateSettings = (field: keyof PlannerSettings, value: string): void => {
    const next = { ...settings, [field]: value };
    persistSettings(next);
  };

  const connectGoogle = async (): Promise<void> => {
    setIntegrationBusy('google');
    try {
      const token = await requestGoogleAccessToken(settings.googleClientId, 'consent');
      setGoogleAccessToken(token);
      showBanner('success', 'Google Calendar conectado desde el navegador.');
      await loadRange(activeRange.start, activeRange.end);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo conectar Google Calendar.';
      showBanner('error', message);
    } finally {
      setIntegrationBusy(null);
    }
  };

  const disconnectGoogle = (): void => {
    setGoogleAccessToken('');
    showBanner('info', 'Google Calendar desconectado en esta sesión.');
    void loadRange(activeRange.start, activeRange.end);
  };

  const addItem = (section: SectionKey): void => {
    const value = drafts[section].trim();
    if (!value) {
      return;
    }

    setDayPlan((previous) => ({
      ...previous,
      [section]: [...previous[section], value],
    }));
    setDrafts((previous) => ({ ...previous, [section]: '' }));
  };

  const removeItem = (section: SectionKey, index: number): void => {
    setDayPlan((previous) => {
      const next = [...previous[section]];
      next.splice(index, 1);
      return {
        ...previous,
        [section]: next,
      };
    });
  };

  const updateItem = (section: SectionKey, index: number, value: string): void => {
    setDayPlan((previous) => {
      const next = [...previous[section]];
      next[index] = value;
      return {
        ...previous,
        [section]: next,
      };
    });
  };

  const saveDay = async (): Promise<void> => {
    setSavingDay(true);
    const updated = upsertDayPlan(dayValue, dayPlan);
    setDayPlan(clonePlan(updated));
    await loadRange(activeRange.start, activeRange.end);
    showBanner('success', 'Plan diario guardado localmente.');

    if (syncGoogleOnSave && googleConnected) {
      await syncDayWithGoogle(dayValue, dayPlan);
    }

    if (shareOnSave) {
      openTelegramShare(buildDailyMessage(settings.telegramMessageTemplate, dayValue, dayPlan));
    }

    setSavingDay(false);
  };

  const sendTelegramTest = (): void => {
    setIntegrationBusy('telegram');
    openTelegramShare('Mensaje de prueba desde Planner en GitHub Pages.');
    showBanner('info', 'Se abrió Telegram para compartir el mensaje.');
    setIntegrationBusy(null);
  };

  const sendDailySummary = (): void => {
    setIntegrationBusy('telegram');
    openTelegramShare(buildDailyMessage(settings.telegramMessageTemplate, dayValue, dayPlan));
    showBanner('info', 'Se abrió Telegram con el resumen diario.');
    setIntegrationBusy(null);
  };

  const syncDayWithGoogle = async (date: string, plan: DayPlan): Promise<boolean> => {
    if (!googleConnected) {
      showBanner('info', 'Conecta Google Calendar para sincronizar.');
      return false;
    }

    try {
      const result = await syncDayPlanToGoogleCalendar(googleAccessToken, settings.googleCalendarId, date, plan);
      showBanner(
        'success',
        `Google sincronizado: ${result.created} creados, ${result.updated} actualizados, ${result.removed} eliminados.`,
      );
      await loadRange(activeRange.start, activeRange.end);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo sincronizar con Google Calendar.';

      if (message === 'UNAUTHORIZED') {
        setGoogleAccessToken('');
        showBanner('info', 'Tu sesión de Google expiró. Reconecta Google y vuelve a sincronizar.');
      } else {
        showBanner('error', message);
      }

      return false;
    }
  };

  const jumpToDay = (date: string): void => {
    setDayValue(date);
    setActiveLevel('day');
  };

  const monthCells = useMemo(() => buildMonthGrid(monthValue), [monthValue]);
  const weekDays = useMemo(() => weekFromInput(weekValue), [weekValue]);

  const weekLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[6];

    if (!first || !last) {
      return '';
    }

    return `${format(first, 'dd MMM')} - ${format(last, 'dd MMM yyyy')}`;
  }, [weekDays]);

  const googleConfigured = settings.googleClientId.trim().length > 0;
  const googleConnected = googleAccessToken.length > 0;

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Planificador Profesional</p>
          <h1>Mensual, semanal y diario en una sola operación.</h1>
          <p className="lead">
            Modo GitHub Pages: planificación local, Google Calendar desde navegador y envío a Telegram por enlace.
          </p>
        </div>
      </header>

      {banner ? <div className={`banner banner-${banner.type}`}>{banner.text}</div> : null}

      <section className="integration-grid">
        <article className="integration-card">
          <div className="integration-header">
            <h2>Google Calendar</h2>
            <span className={`status-dot ${googleConnected ? 'online' : googleConfigured ? 'pending' : 'offline'}`}>
              {googleConnected ? 'Conectado' : googleConfigured ? 'Listo para conectar' : 'Sin configurar'}
            </span>
          </div>
          <p>Conecta Google desde frontend para mostrar eventos en mes, semana y día.</p>
          <div className="field">
            <label htmlFor="google-client-id">Google Client ID</label>
            <input
              id="google-client-id"
              type="text"
              value={settings.googleClientId}
              onChange={(event) => updateSettings('googleClientId', event.target.value)}
              placeholder="xxxx.apps.googleusercontent.com"
            />
          </div>
          <div className="field">
            <label htmlFor="google-calendar-id">Calendar ID</label>
            <input
              id="google-calendar-id"
              type="text"
              value={settings.googleCalendarId}
              onChange={(event) => updateSettings('googleCalendarId', event.target.value)}
              placeholder="primary"
            />
          </div>
          <div className="integration-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void connectGoogle()}
              disabled={!googleConfigured || integrationBusy === 'google'}
            >
              {integrationBusy === 'google' ? 'Conectando...' : 'Conectar Google'}
            </button>
            <button type="button" className="button button-ghost" onClick={disconnectGoogle} disabled={!googleConnected}>
              Desconectar
            </button>
          </div>
          <small className="hint">En Google OAuth agrega tu dominio de GitHub Pages como origen autorizado.</small>
        </article>

        <article className="integration-card">
          <div className="integration-header">
            <h2>Telegram</h2>
            <span className="status-dot online">Modo Pages</span>
          </div>
          <p>Sin backend: se abre Telegram con mensaje prellenado para que tú lo envíes al chat.</p>
          <div className="field">
            <label htmlFor="telegram-template">Título del resumen</label>
            <input
              id="telegram-template"
              type="text"
              value={settings.telegramMessageTemplate}
              onChange={(event) => updateSettings('telegramMessageTemplate', event.target.value)}
              placeholder="Resumen del día"
            />
          </div>
          <div className="integration-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={sendTelegramTest}
              disabled={integrationBusy === 'telegram'}
            >
              Mensaje de prueba
            </button>
          </div>
          <small className="hint">No se almacenan tokens de Telegram en el frontend por seguridad.</small>
        </article>
      </section>

      <section className="control-panel">
        <div className="level-switch">
          {levels.map((level) => (
            <button
              key={level.id}
              type="button"
              className={`level-button ${activeLevel === level.id ? 'active' : ''}`}
              onClick={() => setActiveLevel(level.id)}
            >
              <span>{level.title}</span>
              <small>{level.subtitle}</small>
            </button>
          ))}
        </div>

        <div className="pickers">
          <label>
            Mes
            <input type="month" value={monthValue} onChange={(event) => setMonthValue(event.target.value)} />
          </label>
          <label>
            Semana
            <input type="week" value={weekValue} onChange={(event) => setWeekValue(event.target.value)} />
          </label>
          <label>
            Día
            <input type="date" value={dayValue} onChange={(event) => setDayValue(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="workspace-panel">
        {activeLevel === 'month' ? (
          <div className="view-block">
            <div className="view-title">
              <h2>Vista mensual · {monthValue}</h2>
              <p>Carga de tareas y eventos por día. Haz clic en cualquier fecha para abrir su vista diaria.</p>
            </div>
            {loadingRange ? <p className="loading">Cargando resumen mensual...</p> : null}
            <div className="month-grid">
              {weekdays.map((day) => (
                <div key={day} className="weekday">
                  {day}
                </div>
              ))}
              {monthCells.map((cell) => {
                const summary = summaryByDate[cell.dateKey];
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className={`day-cell ${cell.inCurrentMonth ? '' : 'outside'} ${dayValue === cell.dateKey ? 'selected' : ''}`}
                    onClick={() => jumpToDay(cell.dateKey)}
                  >
                    <span className="day-number">{format(cell.date, 'd')}</span>
                    <div className="metrics">
                      <span>Hoy {summary?.tasksForToday ?? 0}</span>
                      <span>Urgente {summary?.urgentTasks ?? 0}</span>
                      <span>Google {summary?.googleEvents ?? 0}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {activeLevel === 'week' ? (
          <div className="view-block">
            <div className="view-title">
              <h2>Vista semanal · {weekLabel}</h2>
              <p>Distribución detallada de prioridades más eventos sincronizados de Google Calendar.</p>
            </div>
            {loadingRange ? <p className="loading">Cargando resumen semanal...</p> : null}
            <div className="week-cards">
              {weekDays.map((day) => {
                const dateKey = dateToInput(day);
                const summary = summaryByDate[dateKey];
                const events = eventsByDate[dateKey] ?? [];

                return (
                  <article className="week-card" key={dateKey}>
                    <header>
                      <h3>{format(day, "EEEE d 'de' MMMM")}</h3>
                      <button type="button" className="button button-ghost" onClick={() => jumpToDay(dateKey)}>
                        Abrir día
                      </button>
                    </header>
                    <div className="week-metrics">
                      <span>Hoy: {summary?.tasksForToday ?? 0}</span>
                      <span>No olvidar: {summary?.dontForget ?? 0}</span>
                      <span>Urgentes: {summary?.urgentTasks ?? 0}</span>
                      <span>Notas: {summary?.notes ?? 0}</span>
                      <span>Google: {summary?.googleEvents ?? 0}</span>
                    </div>
                    <ul className="event-list">
                      {events.length === 0 ? <li className="empty-line">Sin eventos de Google Calendar.</li> : null}
                      {events.map((event) => (
                        <li key={event.id}>
                          <span>{event.title}</span>
                          <small>{eventTime(event)}</small>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {activeLevel === 'day' ? (
          <div className="view-block">
            <div className="view-title">
              <h2>Vista diaria · {dayValue}</h2>
              <p>Organiza ejecución y seguimiento en bloques claros para operar con foco.</p>
            </div>
            <div className="day-actions-row">
              <div className="day-toggle-group">
                <label className="checkbox">
                  <input type="checkbox" checked={shareOnSave} onChange={(event) => setShareOnSave(event.target.checked)} />
                  Abrir Telegram al guardar
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={syncGoogleOnSave}
                    onChange={(event) => setSyncGoogleOnSave(event.target.checked)}
                    disabled={!googleConnected}
                  />
                  Sincronizar Google al guardar
                </label>
              </div>
              <div className="actions-inline">
                <button type="button" className="button button-secondary" onClick={sendDailySummary}>
                  Compartir resumen
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void syncDayWithGoogle(dayValue, dayPlan)}
                  disabled={!googleConnected || savingDay}
                >
                  Sincronizar Google
                </button>
                <button type="button" className="button button-primary" onClick={() => void saveDay()} disabled={savingDay}>
                  {savingDay ? 'Guardando...' : 'Guardar día'}
                </button>
              </div>
            </div>
            <div className="sections-grid">
              {sections.map((section) => (
                <article key={section.key} className={`section-card ${section.tone}`}>
                  <h3>{section.title}</h3>
                  <p>{section.helper}</p>
                  <div className="compose-row">
                    <input
                      type="text"
                      value={drafts[section.key]}
                      onChange={(event) => setDrafts((previous) => ({ ...previous, [section.key]: event.target.value }))}
                      placeholder={section.placeholder}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addItem(section.key);
                        }
                      }}
                    />
                    <button type="button" className="button button-ghost" onClick={() => addItem(section.key)}>
                      Agregar
                    </button>
                  </div>
                  <ul className="item-list">
                    {dayPlan[section.key].length === 0 ? <li className="empty-line">Sin elementos aún.</li> : null}
                    {dayPlan[section.key].map((item, index) => (
                      <li key={`${section.key}-${index}`}>
                        <input
                          type="text"
                          value={item}
                          onChange={(event) => updateItem(section.key, index, event.target.value)}
                        />
                        <button type="button" className="button button-danger" onClick={() => removeItem(section.key, index)}>
                          Quitar
                        </button>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default App;
