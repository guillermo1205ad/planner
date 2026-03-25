import { env } from './env.js';
import { getDayPlan, isIsoDate, upsertDayPlan } from './store.js';
import { DayPlan, SectionKey } from './types.js';

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  text?: string;
  chat?: TelegramChat;
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

const sectionAliases: Record<string, SectionKey> = {
  hoy: 'tasksForToday',
  today: 'tasksForToday',
  tareas: 'tasksForToday',
  noolvidar: 'dontForget',
  recordar: 'dontForget',
  urgente: 'urgentTasks',
  urgentes: 'urgentTasks',
  notes: 'notes',
  nota: 'notes',
  notas: 'notes',
};

const normalizeSection = (raw: string): SectionKey | null => {
  const key = raw.toLowerCase().trim();
  return sectionAliases[key] ?? null;
};

const assertTelegramReady = (): void => {
  if (!env.telegramBotToken || !env.telegramChatId) {
    throw new Error('Telegram no está configurado (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID).');
  }
};

const telegramRequest = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  if (!env.telegramBotToken) {
    throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  }

  const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
};

export const hasTelegramConfig = (): boolean => Boolean(env.telegramBotToken && env.telegramChatId);

export const isTelegramConnected = (): boolean => hasTelegramConfig();

export const sendTelegramMessage = async (text: string, chatId?: string | number): Promise<void> => {
  assertTelegramReady();
  const resolvedChatId = chatId ?? env.telegramChatId;

  await telegramRequest('sendMessage', {
    chat_id: resolvedChatId,
    text,
  });
};

export const setTelegramWebhook = async (url: string): Promise<void> => {
  if (!env.telegramBotToken) {
    throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  }

  await telegramRequest('setWebhook', {
    url,
  });
};

const formatDayLines = (date: string, plan: DayPlan): string[] => {
  const lines = [
    `Plan del ${date}`,
    `Hoy (${plan.tasksForToday.length}): ${plan.tasksForToday.join(' | ') || 'sin tareas'}`,
    `No olvidar (${plan.dontForget.length}): ${plan.dontForget.join(' | ') || 'sin tareas'}`,
    `Urgentes (${plan.urgentTasks.length}): ${plan.urgentTasks.join(' | ') || 'sin tareas'}`,
    `Notas (${plan.notes.length}): ${plan.notes.join(' | ') || 'sin notas'}`,
  ];

  return lines;
};

const sendCommandHelp = async (chatId: number): Promise<void> => {
  const help = [
    'Comandos disponibles:',
    '/add YYYY-MM-DD seccion texto',
    '/remove YYYY-MM-DD seccion indice',
    '/list YYYY-MM-DD',
    'Secciones: hoy, noolvidar, urgente, notas',
  ].join('\n');

  await sendTelegramMessage(help, chatId);
};

const handleAddCommand = async (chatId: number, args: string[]): Promise<void> => {
  const [date, sectionRaw, ...messageParts] = args;

  if (!date || !sectionRaw || messageParts.length === 0 || !isIsoDate(date)) {
    await sendTelegramMessage('Formato inválido. Usa: /add YYYY-MM-DD seccion texto', chatId);
    return;
  }

  const section = normalizeSection(sectionRaw);
  if (!section) {
    await sendTelegramMessage('Sección inválida. Usa: hoy, noolvidar, urgente, notas', chatId);
    return;
  }

  const text = messageParts.join(' ').trim();
  if (!text) {
    await sendTelegramMessage('Debes incluir texto para la tarea.', chatId);
    return;
  }

  const current = getDayPlan(date);
  const next: DayPlan = {
    tasksForToday: [...current.tasksForToday],
    dontForget: [...current.dontForget],
    urgentTasks: [...current.urgentTasks],
    notes: [...current.notes],
  };

  next[section].push(text);
  upsertDayPlan(date, next);

  await sendTelegramMessage(`Agregado en ${sectionRaw} para ${date}.`, chatId);
};

const handleRemoveCommand = async (chatId: number, args: string[]): Promise<void> => {
  const [date, sectionRaw, indexRaw] = args;

  if (!date || !sectionRaw || !indexRaw || !isIsoDate(date)) {
    await sendTelegramMessage('Formato inválido. Usa: /remove YYYY-MM-DD seccion indice', chatId);
    return;
  }

  const section = normalizeSection(sectionRaw);
  if (!section) {
    await sendTelegramMessage('Sección inválida. Usa: hoy, noolvidar, urgente, notas', chatId);
    return;
  }

  const index = Number(indexRaw) - 1;
  if (!Number.isInteger(index) || index < 0) {
    await sendTelegramMessage('El índice debe ser un número mayor o igual a 1.', chatId);
    return;
  }

  const current = getDayPlan(date);
  const list = current[section];

  if (!list[index]) {
    await sendTelegramMessage(`No existe elemento #${index + 1} en ${sectionRaw}.`, chatId);
    return;
  }

  const next: DayPlan = {
    tasksForToday: [...current.tasksForToday],
    dontForget: [...current.dontForget],
    urgentTasks: [...current.urgentTasks],
    notes: [...current.notes],
  };

  next[section].splice(index, 1);
  upsertDayPlan(date, next);

  await sendTelegramMessage(`Eliminado #${index + 1} de ${sectionRaw} para ${date}.`, chatId);
};

const handleListCommand = async (chatId: number, args: string[]): Promise<void> => {
  const [date] = args;

  if (!date || !isIsoDate(date)) {
    await sendTelegramMessage('Formato inválido. Usa: /list YYYY-MM-DD', chatId);
    return;
  }

  const current = getDayPlan(date);
  await sendTelegramMessage(formatDayLines(date, current).join('\n'), chatId);
};

export const processTelegramUpdate = async (update: TelegramUpdate): Promise<void> => {
  const messageText = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;

  if (!messageText || !chatId || !messageText.startsWith('/')) {
    return;
  }

  const [command, ...args] = messageText.split(/\s+/);

  if (command === '/help' || command === '/start') {
    await sendCommandHelp(chatId);
    return;
  }

  if (command === '/add') {
    await handleAddCommand(chatId, args);
    return;
  }

  if (command === '/remove') {
    await handleRemoveCommand(chatId, args);
    return;
  }

  if (command === '/list') {
    await handleListCommand(chatId, args);
    return;
  }

  await sendTelegramMessage('Comando no reconocido. Usa /help para ver opciones.', chatId);
};
