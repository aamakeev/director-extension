export const COMMAND_GROUPS = [
  {
    id: 'visual',
    title: 'ВИЗУАЛ',
    commands: [
      { id: 'visual_closeup', label: 'Крупный план' },
      { id: 'visual_angle', label: 'Ракурс' },
      { id: 'visual_eyes', label: 'В глаза' }
    ]
  },
  {
    id: 'tempo',
    title: 'ТЕМП',
    commands: [
      { id: 'tempo_slow', label: 'Медленно' },
      { id: 'tempo_turbo', label: 'Турбо' },
      { id: 'tempo_freeze', label: 'Замри' }
    ]
  },
  {
    id: 'sound',
    title: 'ЗВУК',
    commands: [
      { id: 'sound_whisper', label: 'Шёпот' },
      { id: 'sound_dirty_talk', label: 'Dirty Talk' },
      { id: 'sound_silence', label: 'Тишина' }
    ]
  },
  {
    id: 'acting',
    title: 'АКТЕРСТВО',
    commands: [
      { id: 'acting_good', label: 'Хорошая девочка' },
      { id: 'acting_bad', label: 'Плохая девочка' }
    ]
  }
];

export const COMMAND_BY_ID = Object.fromEntries(
  COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((command) => [
      command.id,
      {
        ...command,
        categoryId: group.id,
        categoryTitle: group.title
      }
    ])
  )
);

export const DEFAULT_SETTINGS = {
  preproductionGoal: 50,
  overtakeMargin: 10,
  minTenureSec: 15,
  commandDurationSec: 20,
  commandCooldownSec: 6,
  tipMenuRefreshSec: 20,
  fallbackTipMenu: 'Крупный план|25\nТанец|40\nВ глаза|30',
  backendUrl: '',
  backendApiKey: ''
};

const toNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return fallback;
  if (num > max) return max;
  return Math.floor(num);
};

const toString = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const slugify = (input, fallback) => {
  const slug = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  return slug || fallback;
};

export const normalizeSettings = (raw = {}) => {
  return {
    preproductionGoal: toNumber(raw.preproductionGoal, DEFAULT_SETTINGS.preproductionGoal, {
      min: 10,
      max: 10000
    }),
    overtakeMargin: toNumber(raw.overtakeMargin, DEFAULT_SETTINGS.overtakeMargin, {
      min: 1,
      max: 1000
    }),
    minTenureSec: toNumber(raw.minTenureSec, DEFAULT_SETTINGS.minTenureSec, {
      min: 5,
      max: 600
    }),
    commandDurationSec: toNumber(raw.commandDurationSec, DEFAULT_SETTINGS.commandDurationSec, {
      min: 5,
      max: 300
    }),
    commandCooldownSec: toNumber(raw.commandCooldownSec, DEFAULT_SETTINGS.commandCooldownSec, {
      min: 1,
      max: 120
    }),
    tipMenuRefreshSec: toNumber(raw.tipMenuRefreshSec, DEFAULT_SETTINGS.tipMenuRefreshSec, {
      min: 5,
      max: 300
    }),
    fallbackTipMenu: toString(raw.fallbackTipMenu, DEFAULT_SETTINGS.fallbackTipMenu),
    backendUrl: toString(raw.backendUrl, DEFAULT_SETTINGS.backendUrl),
    backendApiKey: toString(raw.backendApiKey, DEFAULT_SETTINGS.backendApiKey)
  };
};

export const parseFallbackTipMenu = (fallbackText) => {
  return String(fallbackText || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [titlePart, pricePart] = line.split('|').map((part) => part.trim());
      const title = String(titlePart || 'Позиция').slice(0, 80);
      const price = Number(pricePart || 0);
      const normalizedPrice = Number.isFinite(price) ? Math.max(1, Math.floor(price)) : 1;

      return {
        id: slugify(`${title}_${normalizedPrice}_${index}`, `fallback_${index}`),
        title,
        price: normalizedPrice
      };
    })
    .filter((item) => item.title && item.price > 0);
};

const normalizeTipMenuItem = (item, index) => {
  const activity = String(item?.activity || '').trim();
  const price = Math.max(0, Math.floor(Number(item?.price || 0)));

  if (!activity || !price) {
    return null;
  }

  const sourceId = String(item?.id || '').trim();
  const id = sourceId
    ? slugify(sourceId, `tip_${index}`)
    : slugify(`${activity}_${price}_${index}`, `tip_${index}`);

  return {
    id,
    title: activity,
    price
  };
};

export const normalizeTipMenuPayload = (payload, fallbackText) => {
  const rawSettings = Array.isArray(payload?.tipMenu?.settings)
    ? payload.tipMenu.settings
    : [];

  const normalized = rawSettings
    .map((item, index) => normalizeTipMenuItem(item, index))
    .filter(Boolean);

  const settings = normalized.length ? normalized : parseFallbackTipMenu(fallbackText);

  return {
    isEnabled: settings.length > 0,
    settings,
    updatedAt: Number(payload?.tipMenu?.updatedAt || Date.now())
  };
};

export const formatSeconds = (ms) => {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (!minutes) {
    return `${seconds}s`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const isObject = (value) => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const sanitizeSessionId = (value) => {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
};

export const clampPositive = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
};
