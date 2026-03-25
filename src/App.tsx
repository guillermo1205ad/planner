import { format, parseISO } from 'date-fns';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dateToInput, monthRangeFromInput, monthToInput, weekRangeFromInput, weekToInput } from './lib/date';
import { requestGoogleAccessToken, syncDayPlanToGoogleCalendar } from './lib/googleBrowser';
import { getDayPlan, listRangeTasks, upsertDayPlan } from './lib/localStore';
import { DayPlan, PlannedTaskItem, PlannerLevel, SectionKey } from './types';

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const GOOGLE_CALENDAR_ID = (import.meta.env.VITE_GOOGLE_CALENDAR_ID as string | undefined)?.trim() || 'primary';

const levels: Array<{ id: PlannerLevel; title: string; subtitle: string }> = [
  { id: 'month', title: 'Mensual', subtitle: 'Listado de tareas del mes' },
  { id: 'week', title: 'Semanal', subtitle: 'Listado de tareas de la semana' },
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

const sectionLabel: Record<SectionKey, string> = {
  tasksForToday: 'Tarea de hoy',
  dontForget: 'No olvidar',
  urgentTasks: 'Urgente',
  notes: 'Nota',
};

type BannerType = 'success' | 'error' | 'info';

const clonePlan = (plan: DayPlan): DayPlan => ({
  tasksForToday: [...plan.tasksForToday],
  dontForget: [...plan.dontForget],
  urgentTasks: [...plan.urgentTasks],
  notes: [...plan.notes],
});

function App() {
  const initialDate = useMemo(() => new Date(), []);
  const [activeLevel, setActiveLevel] = useState<PlannerLevel>('month');
  const [monthValue, setMonthValue] = useState(monthToInput(initialDate));
  const [weekValue, setWeekValue] = useState(weekToInput(initialDate));
  const [dayValue, setDayValue] = useState(dateToInput(initialDate));

  const [dayPlan, setDayPlan] = useState<DayPlan>(clonePlan(getDayPlan(dayValue)));
  const [googleAccessToken, setGoogleAccessToken] = useState('');
  const [syncGoogleOnSave, setSyncGoogleOnSave] = useState(true);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [savingDay, setSavingDay] = useState(false);
  const [storeVersion, setStoreVersion] = useState(0);

  const [drafts, setDrafts] = useState<Record<SectionKey, string>>({
    tasksForToday: '',
    dontForget: '',
    urgentTasks: '',
    notes: '',
  });

  const [banner, setBanner] = useState<{ type: BannerType; text: string } | null>(null);
  const bannerTimer = useRef<number | null>(null);

  const showBanner = (type: BannerType, text: string): void => {
    setBanner({ type, text });

    if (bannerTimer.current) {
      window.clearTimeout(bannerTimer.current);
    }

    bannerTimer.current = window.setTimeout(() => {
      setBanner(null);
    }, 5000);
  };

  useEffect(
    () => () => {
      if (bannerTimer.current) {
        window.clearTimeout(bannerTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    setDayPlan(clonePlan(getDayPlan(dayValue)));
  }, [dayValue, storeVersion]);

  const monthRange = useMemo(() => monthRangeFromInput(monthValue), [monthValue]);
  const weekRange = useMemo(() => weekRangeFromInput(weekValue), [weekValue]);

  const monthTaskList = useMemo(
    () => listRangeTasks(monthRange.start, monthRange.end),
    [monthRange.end, monthRange.start, storeVersion],
  );
  const weekTaskList = useMemo(
    () => listRangeTasks(weekRange.start, weekRange.end),
    [weekRange.end, weekRange.start, storeVersion],
  );

  const googleConfigured = GOOGLE_CLIENT_ID.length > 0;
  const googleConnected = googleAccessToken.length > 0;

  const connectGoogle = async (): Promise<void> => {
    if (!googleConfigured) {
      showBanner('error', 'Falta VITE_GOOGLE_CLIENT_ID en .env');
      return;
    }

    setIntegrationBusy(true);
    try {
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID, 'consent');
      setGoogleAccessToken(token);
      showBanner('success', 'Google Calendar conectado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo conectar Google Calendar.';
      showBanner('error', message);
    } finally {
      setIntegrationBusy(false);
    }
  };

  const disconnectGoogle = (): void => {
    setGoogleAccessToken('');
    showBanner('info', 'Google Calendar desconectado.');
  };

  const syncDayWithGoogle = async (date: string, plan: DayPlan): Promise<boolean> => {
    if (!googleConnected) {
      showBanner('info', 'Conecta Google Calendar para sincronizar.');
      return false;
    }

    try {
      const result = await syncDayPlanToGoogleCalendar(googleAccessToken, GOOGLE_CALENDAR_ID, date, plan);
      showBanner(
        'success',
        `Google sincronizado: ${result.created} creados, ${result.updated} actualizados, ${result.removed} eliminados.`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo sincronizar con Google Calendar.';

      if (message === 'UNAUTHORIZED') {
        setGoogleAccessToken('');
        showBanner('info', 'Tu sesión expiró. Conecta Google nuevamente.');
      } else {
        showBanner('error', message);
      }

      return false;
    }
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
    setStoreVersion((previous) => previous + 1);
    showBanner('success', 'Plan diario guardado localmente.');

    if (syncGoogleOnSave && googleConnected) {
      await syncDayWithGoogle(dayValue, dayPlan);
    }

    setSavingDay(false);
  };

  const jumpToDay = (date: string): void => {
    setDayValue(date);
    setActiveLevel('day');
  };

  const renderTaskList = (tasks: PlannedTaskItem[], emptyText: string) => {
    if (tasks.length === 0) {
      return <p className="loading">{emptyText}</p>;
    }

    return (
      <ul className="task-feed">
        {tasks.map((task, index) => (
          <li key={`${task.date}-${task.section}-${task.text}-${index}`} className="task-item">
            <div className="task-main">
              <span className="task-date">{format(parseISO(`${task.date}T00:00:00`), 'dd MMM')}</span>
              <span className="task-tag">{sectionLabel[task.section]}</span>
              <p>{task.text}</p>
            </div>
            <button type="button" className="button button-ghost" onClick={() => jumpToDay(task.date)}>
              Abrir día
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Planificador Profesional</p>
          <h1>Mensual, semanal y diario en una sola operación.</h1>
          <p className="lead">Planificación local y sincronización con Google Calendar.</p>
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
          <p>La configuración de Google viene desde `.env` (no editable en pantalla).</p>
          <div className="integration-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void connectGoogle()}
              disabled={!googleConfigured || integrationBusy}
            >
              {integrationBusy ? 'Conectando...' : 'Conectar Google'}
            </button>
            <button type="button" className="button button-ghost" onClick={disconnectGoogle} disabled={!googleConnected}>
              Desconectar
            </button>
          </div>
          <small className="hint">Variables usadas: `VITE_GOOGLE_CLIENT_ID` y `VITE_GOOGLE_CALENDAR_ID`.</small>
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
              <h2>Planificación mensual · {monthValue}</h2>
              <p>Listado de todo lo pendiente para este mes.</p>
            </div>
            {renderTaskList(monthTaskList, 'No hay tareas registradas este mes.')}
          </div>
        ) : null}

        {activeLevel === 'week' ? (
          <div className="view-block">
            <div className="view-title">
              <h2>Planificación semanal · {weekRange.start} a {weekRange.end}</h2>
              <p>Listado de tareas pendientes para esta semana.</p>
            </div>
            {renderTaskList(weekTaskList, 'No hay tareas registradas esta semana.')}
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
