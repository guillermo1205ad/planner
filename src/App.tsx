import { useEffect, useMemo, useRef, useState } from 'react';
import { dateToInput } from './lib/date';
import { requestGoogleAccessToken, syncDayPlanToGoogleCalendar } from './lib/googleBrowser';
import { getDayPlan, upsertDayPlan } from './lib/localStore';
import { DayPlan, SectionKey } from './types';

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
const GOOGLE_CALENDAR_ID = (import.meta.env.VITE_GOOGLE_CALENDAR_ID as string | undefined)?.trim() || 'primary';

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

type BannerType = 'success' | 'error' | 'info';

const clonePlan = (plan: DayPlan): DayPlan => ({
  tasksForToday: [...plan.tasksForToday],
  dontForget: [...plan.dontForget],
  urgentTasks: [...plan.urgentTasks],
  notes: [...plan.notes],
});

function App() {
  const initialDate = useMemo(() => new Date(), []);
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
  const silentConnectTried = useRef(false);

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

  const googleConfigured = GOOGLE_CLIENT_ID.length > 0;
  const googleConnected = googleAccessToken.length > 0;

  const connectGoogle = async (prompt: '' | 'consent' = 'consent'): Promise<void> => {
    if (!googleConfigured) {
      showBanner('error', 'Falta VITE_GOOGLE_CLIENT_ID en .env');
      return;
    }

    setIntegrationBusy(true);
    try {
      const token = await requestGoogleAccessToken(GOOGLE_CLIENT_ID, prompt);
      setGoogleAccessToken(token);
      if (prompt === 'consent') {
        showBanner('success', 'Google Calendar conectado.');
      }
    } catch (error) {
      if (prompt === '') {
        return;
      }
      const message = error instanceof Error ? error.message : 'No se pudo conectar Google Calendar.';
      showBanner('error', message);
    } finally {
      setIntegrationBusy(false);
    }
  };

  useEffect(() => {
    if (!googleConfigured || googleConnected || integrationBusy || silentConnectTried.current) {
      return;
    }

    silentConnectTried.current = true;
    void connectGoogle('');
  }, [googleConfigured, googleConnected, integrationBusy]);

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

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Planificador Profesional</p>
          <h1>Planificación diaria en una sola operación.</h1>
          <p className="lead">Organiza tu día y sincroniza con Google Calendar.</p>
        </div>
      </header>

      {banner ? <div className={`banner banner-${banner.type}`}>{banner.text}</div> : null}

      <section className="control-panel">
        <div className="pickers single-picker">
          <label>
            Día
            <input type="date" value={dayValue} onChange={(event) => setDayValue(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="workspace-panel">
        <div className="view-block">
          <div className="view-title">
            <h2>Vista diaria · {dayValue}</h2>
            <p>Organiza ejecución y seguimiento en bloques claros para operar con foco.</p>
          </div>
          <div className="day-actions-row">
            <div className="day-toggle-group">
              <p className="hint">
                Google Calendar: {googleConnected ? 'Conectado' : googleConfigured ? 'No conectado' : 'Sin configurar'}
              </p>
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
              {!googleConnected && googleConfigured ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void connectGoogle('consent')}
                  disabled={integrationBusy || savingDay}
                >
                  {integrationBusy ? 'Conectando...' : 'Conectar Google'}
                </button>
              ) : null}
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
                      <input type="text" value={item} onChange={(event) => updateItem(section.key, index, event.target.value)} />
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
      </section>
    </div>
  );
}

export default App;
