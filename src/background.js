import { createExtHelper } from '@platform/ext-helper';
import {
  COMMAND_BY_ID,
  DEFAULT_SETTINGS,
  clampPositive,
  isObject,
  normalizeSettings,
  normalizeTipMenuPayload,
  sanitizeSessionId
} from './shared.js';

const ext = createExtHelper();

const STATE_KEY = 'directorMvpState_v2';
const BACKEND_ENDPOINT_PREFIX = '/api/sessions';
const BACKEND_REQUEST_TIMEOUT_MS = 5000;
const BACKEND_HEARTBEAT_MS = 15000;
const STATE_BROADCAST_HEARTBEAT_MS = 7000;
const TICK_MS = 1000;

let ctx = { user: null, model: null };
let settings = normalizeSettings(DEFAULT_SETTINGS);

const createInitialState = () => ({
  isLive: false,
  totalSessionTips: 0,
  director: {
    id: null,
    name: 'Casting...',
    total: 0,
    startTime: 0
  },
  challenger: {
    id: null,
    name: 'None',
    total: 0
  },
  users: {},
  tipMenu: {
    isEnabled: false,
    settings: [],
    updatedAt: 0,
    source: 'fallback'
  },
  menuGoals: [],
  currentPerformance: null,
  queue: [],
  commandHistory: [],
  commandCooldowns: {},
  overlayFlashAt: 0,
  activityFeed: [],
  savedAt: Date.now()
});

let gameState = createInitialState();

let tickTimer = null;
let tipMenuRefreshTimer = null;
let backendHeartbeatTimer = null;
let stateBroadcastHeartbeatTimer = null;
let backendSyncChain = Promise.resolve();
let overlayOpenRequested = false;

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getSnapshotSavedAt = (snapshot) => {
  return Math.max(0, Math.floor(clampPositive(snapshot?.savedAt, 0)));
};

const getSessionId = () => sanitizeSessionId(ctx.model?.id);

const getBackendBaseUrl = () => String(settings.backendUrl || '').trim().replace(/\/+$/, '');

const getBackendApiKey = () => String(settings.backendApiKey || '').trim();

const isBackendEnabled = () => Boolean(getBackendBaseUrl() && getSessionId());

const appendActivity = (text) => {
  gameState.activityFeed.unshift({
    id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    text: String(text || '').slice(0, 180)
  });

  gameState.activityFeed = gameState.activityFeed.slice(0, 30);
};

const toUser = (userId, username) => {
  const id = String(userId || '').trim();
  if (!id) return null;

  return {
    id,
    name: String(username || 'viewer').slice(0, 60)
  };
};

const getOrCreateUserState = (userId, username) => {
  const safeUser = toUser(userId, username);
  if (!safeUser) return null;

  if (!gameState.users[safeUser.id]) {
    gameState.users[safeUser.id] = {
      id: safeUser.id,
      name: safeUser.name,
      total: 0,
      allocations: {}
    };
  }

  const userState = gameState.users[safeUser.id];
  userState.name = safeUser.name;

  if (!isObject(userState.allocations)) {
    userState.allocations = {};
  }

  return userState;
};

const getSortedUsers = () => {
  return Object.values(gameState.users).sort((a, b) => b.total - a.total);
};

const setChallenger = (sortedUsers) => {
  const challenger = sortedUsers.find((user) => user.id !== gameState.director.id);

  if (!challenger) {
    gameState.challenger = { id: null, name: 'None', total: 0 };
    return;
  }

  gameState.challenger = {
    id: challenger.id,
    name: challenger.name,
    total: challenger.total
  };
};

const safeSendChatMessage = (message) => {
  if (!message) return;

  void ext
    .makeRequest('v1.chat.message.send', {
      message,
      isAnonymous: false,
      user: ctx.user ?? null
    })
    .catch(() => null);
};

const promoteToDirector = (user, reason) => {
  gameState.director = {
    id: user.id,
    name: user.name,
    total: user.total,
    startTime: Date.now()
  };

  gameState.overlayFlashAt = Date.now();

  if (reason === 'liveStart') {
    appendActivity(`ЭФИР стартовал. Новый режиссёр: ${user.name}`);
    safeSendChatMessage(`РЕЖИССЁР LIVE: старт! Режиссёр — ${user.name}.`);
    return;
  }

  if (reason === 'overtake') {
    appendActivity(`Смена власти: ${user.name} перехватил пульт`);
    safeSendChatMessage(`Смена режиссёра: теперь командует ${user.name}.`);
    return;
  }

  appendActivity(`Режиссёр: ${user.name}`);
};

const syncLeadership = ({ triggerUserId = '' } = {}) => {
  const sortedUsers = getSortedUsers();

  if (!gameState.isLive && gameState.totalSessionTips >= settings.preproductionGoal && sortedUsers.length) {
    gameState.isLive = true;

    const triggerUser = triggerUserId ? gameState.users[triggerUserId] : null;
    promoteToDirector(triggerUser || sortedUsers[0], 'liveStart');
  }

  if (!gameState.isLive) {
    setChallenger(sortedUsers);
    return;
  }

  if (!sortedUsers.length) {
    gameState.director = {
      id: null,
      name: 'Casting...',
      total: 0,
      startTime: 0
    };
    gameState.challenger = {
      id: null,
      name: 'None',
      total: 0
    };
    return;
  }

  const directorUser = gameState.director.id ? gameState.users[gameState.director.id] : null;
  if (!directorUser) {
    promoteToDirector(sortedUsers[0], 'fallback');
  } else {
    gameState.director.name = directorUser.name;
    gameState.director.total = directorUser.total;
  }

  const candidate = getSortedUsers().find((user) => user.id !== gameState.director.id) || null;

  if (candidate) {
    const canSwitch = Date.now() - gameState.director.startTime >= settings.minTenureSec * 1000;
    const hasEnough = candidate.total >= gameState.director.total + settings.overtakeMargin;

    if (canSwitch && hasEnough) {
      promoteToDirector(candidate, 'overtake');
    }
  }

  setChallenger(getSortedUsers());
};

const tipMenuSignature = (settingsList) => {
  return (settingsList || [])
    .map((item) => `${item.id}:${item.title}:${item.price}`)
    .join('|');
};

const pruneAllocationsToValidMenu = () => {
  const validIds = new Set(gameState.tipMenu.settings.map((item) => item.id));
  const fallbackItemId = gameState.tipMenu.settings[0]?.id || '';

  Object.values(gameState.users).forEach((user) => {
    const allocations = isObject(user.allocations) ? user.allocations : {};
    const nextAllocations = {};
    let overflow = 0;

    Object.entries(allocations).forEach(([itemId, rawAmount]) => {
      const amount = Math.max(0, Math.floor(toNumber(rawAmount, 0)));
      if (!amount) return;

      if (validIds.has(itemId)) {
        nextAllocations[itemId] = (nextAllocations[itemId] || 0) + amount;
        return;
      }

      overflow += amount;
    });

    if (overflow > 0 && fallbackItemId) {
      nextAllocations[fallbackItemId] = (nextAllocations[fallbackItemId] || 0) + overflow;
    }

    user.allocations = nextAllocations;
  });
};

const deriveMenuGoals = () => {
  const totalsByItem = {};
  const validIds = new Set(gameState.tipMenu.settings.map((item) => item.id));

  Object.values(gameState.users).forEach((user) => {
    Object.entries(user.allocations || {}).forEach(([itemId, rawAmount]) => {
      if (!validIds.has(itemId)) return;

      const amount = Math.max(0, Math.floor(toNumber(rawAmount, 0)));
      if (!amount) return;

      totalsByItem[itemId] = (totalsByItem[itemId] || 0) + amount;
    });
  });

  gameState.menuGoals = gameState.tipMenu.settings
    .map((item) => {
      const progress = totalsByItem[item.id] || 0;
      const tokensLeft = Math.max(0, item.price - progress);
      const percent = item.price > 0 ? Math.min(100, (progress / item.price) * 100) : 0;

      return {
        id: item.id,
        title: item.title,
        price: item.price,
        progress,
        tokensLeft,
        percent
      };
    })
    .sort((a, b) => {
      if (a.tokensLeft !== b.tokensLeft) return a.tokensLeft - b.tokensLeft;
      if (a.price !== b.price) return a.price - b.price;
      return a.title.localeCompare(b.title);
    });
};

const applyTipMenu = (tipMenu, source = 'sdk') => {
  const prevSignature = tipMenuSignature(gameState.tipMenu.settings);

  gameState.tipMenu = {
    isEnabled: Boolean(tipMenu?.isEnabled),
    settings: Array.isArray(tipMenu?.settings) ? tipMenu.settings : [],
    updatedAt: Number(tipMenu?.updatedAt || Date.now()),
    source
  };

  pruneAllocationsToValidMenu();
  deriveMenuGoals();

  const nextSignature = tipMenuSignature(gameState.tipMenu.settings);
  if (nextSignature !== prevSignature && nextSignature) {
    appendActivity('Tip menu обновлено');
  }

  return nextSignature !== prevSignature;
};

const loadTipMenu = async () => {
  try {
    const payload = await ext.makeRequest('v1.model.tip.menu.get', null);
    const normalized = normalizeTipMenuPayload(payload, settings.fallbackTipMenu);
    return applyTipMenu(normalized, 'sdk');
  } catch {
    if (!gameState.tipMenu.settings.length) {
      const normalized = normalizeTipMenuPayload(null, settings.fallbackTipMenu);
      return applyTipMenu(normalized, 'fallback');
    }

    return false;
  }
};

const getMenuItemById = (itemId) => {
  return gameState.tipMenu.settings.find((item) => item.id === itemId) || null;
};

const getFirstMenuItem = () => gameState.tipMenu.settings[0] || null;

const buildPressure = () => {
  const directorTotal = Math.max(0, toNumber(gameState.director.total, 0));
  const challengerTotal = Math.max(0, toNumber(gameState.challenger.total, 0));
  const gap = Math.max(0, directorTotal - challengerTotal);
  const threshold = directorTotal + settings.overtakeMargin;
  const percent = threshold > 0 ? Math.min(100, (challengerTotal / threshold) * 100) : 0;

  return {
    gap,
    margin: settings.overtakeMargin,
    neededToOvertake: Math.max(0, threshold - challengerTotal),
    percent,
    isCritical: gap < settings.overtakeMargin
  };
};

const buildCooldownMap = () => {
  const now = Date.now();

  return Object.keys(COMMAND_BY_ID).reduce((result, commandId) => {
    const endsAt = Number(gameState.commandCooldowns[commandId] || 0);
    if (!endsAt || endsAt <= now) {
      return result;
    }

    result[commandId] = endsAt - now;
    return result;
  }, {});
};

const buildStatePayload = () => {
  const pressure = buildPressure();
  const now = Date.now();
  const tenureLeftMs = gameState.director.startTime
    ? Math.max(0, gameState.director.startTime + settings.minTenureSec * 1000 - now)
    : 0;

  return {
    type: 'director.state',
    isLive: gameState.isLive,
    phaseLabel: gameState.isLive ? 'ЭФИР' : 'ПРЕДПРОДАКШН',
    totalSessionTips: gameState.totalSessionTips,
    preproductionGoal: settings.preproductionGoal,
    overtakeMargin: settings.overtakeMargin,
    minTenureSec: settings.minTenureSec,
    director: gameState.director,
    challenger: gameState.challenger,
    pressure,
    directorTenureLeftMs: tenureLeftMs,
    menuGoals: gameState.menuGoals,
    menuSource: gameState.tipMenu.source,
    currentPerformance: gameState.currentPerformance
      ? {
        ...gameState.currentPerformance,
        remainingMs: Math.max(0, gameState.currentPerformance.endsAt - now)
      }
      : null,
    queue: gameState.queue.map((item) => ({
      id: item.id,
      commandId: item.commandId,
      label: item.label,
      categoryTitle: item.categoryTitle,
      issuedByName: item.issuedByName,
      issuedAt: item.issuedAt
    })),
    commandHistory: gameState.commandHistory,
    commandCooldowns: buildCooldownMap(),
    overlayFlashAt: gameState.overlayFlashAt,
    activityFeed: gameState.activityFeed.slice(0, 20),
    updatedAt: now
  };
};

const sendTargetedWhisper = (targetUserId, data) => {
  void ext.makeRequest('v1.ext.whisper', {
    data: {
      ...data,
      targetUserId: String(targetUserId || '')
    }
  });
};

const sendSelfAllocations = (userId) => {
  const id = String(userId || '');
  if (!id) return;

  const user = gameState.users[id];
  const allocations = gameState.menuGoals.map((goal) => ({
    itemId: goal.id,
    title: goal.title,
    allocated: Math.max(0, Math.floor(toNumber(user?.allocations?.[goal.id], 0)))
  }));

  sendTargetedWhisper(id, {
    type: 'director.self.allocations',
    total: Math.max(0, Math.floor(toNumber(user?.total, 0))),
    allocations
  });
};

const broadcastState = () => {
  void ext.makeRequest('v1.ext.whisper', { data: buildStatePayload() });
};

const requestOverlayOpen = () => {
  if (overlayOpenRequested) return;
  overlayOpenRequested = true;

  void ext
    .makeRequest('v1.ext.overlay.open', { source: 'extension' })
    .catch(() => {
      overlayOpenRequested = false;
    });
};

const cloneStateSnapshot = (value) => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fallback to JSON clone
    }
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return createInitialState();
  }
};

const serializeState = (savedAt = Date.now()) => {
  return {
    savedAt,
    gameState: cloneStateSnapshot(gameState)
  };
};

const applyStateSnapshot = (snapshot = {}) => {
  if (!isObject(snapshot.gameState)) {
    gameState = createInitialState();
    return;
  }

  const next = snapshot.gameState;
  const users = isObject(next.users) ? next.users : {};

  gameState = createInitialState();
  gameState.isLive = Boolean(next.isLive);
  gameState.totalSessionTips = Math.max(0, Math.floor(clampPositive(next.totalSessionTips, 0)));

  if (isObject(next.director)) {
    gameState.director = {
      id: next.director.id ? String(next.director.id) : null,
      name: String(next.director.name || 'Casting...'),
      total: Math.max(0, Math.floor(clampPositive(next.director.total, 0))),
      startTime: Math.max(0, Math.floor(clampPositive(next.director.startTime, 0)))
    };
  }

  if (isObject(next.challenger)) {
    gameState.challenger = {
      id: next.challenger.id ? String(next.challenger.id) : null,
      name: String(next.challenger.name || 'None'),
      total: Math.max(0, Math.floor(clampPositive(next.challenger.total, 0)))
    };
  }

  Object.entries(users).forEach(([userId, raw]) => {
    if (!isObject(raw)) return;

    const allocationsRaw = isObject(raw.allocations) ? raw.allocations : {};
    const allocations = {};

    Object.entries(allocationsRaw).forEach(([itemId, amount]) => {
      const normalized = Math.max(0, Math.floor(clampPositive(amount, 0)));
      if (normalized > 0) {
        allocations[itemId] = normalized;
      }
    });

    gameState.users[userId] = {
      id: userId,
      name: String(raw.name || 'viewer').slice(0, 60),
      total: Math.max(0, Math.floor(clampPositive(raw.total, 0))),
      allocations
    };
  });

  if (isObject(next.tipMenu)) {
    const tipMenu = {
      isEnabled: Boolean(next.tipMenu.isEnabled),
      settings: Array.isArray(next.tipMenu.settings)
        ? next.tipMenu.settings
            .map((item) => {
              const id = String(item?.id || '').trim();
              const title = String(item?.title || '').trim();
              const price = Math.max(0, Math.floor(clampPositive(item?.price, 0)));
              if (!id || !title || !price) return null;

              return {
                id,
                title,
                price
              };
            })
            .filter(Boolean)
        : [],
      updatedAt: Math.max(0, Math.floor(clampPositive(next.tipMenu.updatedAt, 0))),
      source: String(next.tipMenu.source || 'fallback')
    };

    applyTipMenu(tipMenu, tipMenu.source);
  }

  gameState.currentPerformance = isObject(next.currentPerformance)
    ? {
      id: String(next.currentPerformance.id || ''),
      commandId: String(next.currentPerformance.commandId || ''),
      label: String(next.currentPerformance.label || ''),
      categoryTitle: String(next.currentPerformance.categoryTitle || ''),
      issuedByName: String(next.currentPerformance.issuedByName || ''),
      issuedById: String(next.currentPerformance.issuedById || ''),
      issuedAt: Math.max(0, Math.floor(clampPositive(next.currentPerformance.issuedAt, 0))),
      durationMs: Math.max(1000, Math.floor(clampPositive(next.currentPerformance.durationMs, 1000))),
      startedAt: Math.max(0, Math.floor(clampPositive(next.currentPerformance.startedAt, 0))),
      endsAt: Math.max(0, Math.floor(clampPositive(next.currentPerformance.endsAt, 0)))
    }
    : null;

  gameState.queue = Array.isArray(next.queue)
    ? next.queue
        .map((item) => {
          if (!isObject(item)) return null;

          return {
            id: String(item.id || ''),
            commandId: String(item.commandId || ''),
            label: String(item.label || ''),
            categoryTitle: String(item.categoryTitle || ''),
            issuedByName: String(item.issuedByName || ''),
            issuedById: String(item.issuedById || ''),
            issuedAt: Math.max(0, Math.floor(clampPositive(item.issuedAt, 0))),
            durationMs: Math.max(1000, Math.floor(clampPositive(item.durationMs, 1000)))
          };
        })
        .filter(Boolean)
        .slice(0, 30)
    : [];

  gameState.commandHistory = Array.isArray(next.commandHistory) ? next.commandHistory.slice(0, 20) : [];
  gameState.commandCooldowns = isObject(next.commandCooldowns) ? next.commandCooldowns : {};
  gameState.overlayFlashAt = Math.max(0, Math.floor(clampPositive(next.overlayFlashAt, 0)));
  gameState.activityFeed = Array.isArray(next.activityFeed) ? next.activityFeed.slice(0, 30) : [];
  gameState.savedAt = Math.max(0, Math.floor(clampPositive(snapshot.savedAt, Date.now())));

  deriveMenuGoals();
  syncLeadership();
};

const writeStateToSessionStorage = (snapshot) => {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore sessionStorage failures
  }
};

const readStateFromSessionStorage = () => {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const makeBackendRequest = async (method, path, body) => {
  const backendBaseUrl = getBackendBaseUrl();
  if (!backendBaseUrl) return null;

  const headers = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const apiKey = getBackendApiKey();
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${backendBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: controller.signal
    });

    if (response.status === 404) {
      return { notFound: true };
    }

    if (response.status === 409) {
      try {
        const payload = await response.json();
        return isObject(payload)
          ? { ...payload, conflict: true }
          : { conflict: true };
      } catch {
        return { conflict: true };
      }
    }

    if (!response.ok) {
      throw new Error(`Backend request failed (${response.status})`);
    }

    if (response.status === 204) {
      return null;
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

const persistStateToBackend = (snapshot) => {
  if (!isBackendEnabled()) return;

  const sessionId = getSessionId();
  if (!sessionId) return;

  const path = `${BACKEND_ENDPOINT_PREFIX}/${encodeURIComponent(sessionId)}`;

  backendSyncChain = backendSyncChain
    .catch(() => null)
    .then(async () => {
      try {
        const result = await makeBackendRequest('PUT', path, { state: snapshot });
        if (result?.conflict) {
          const conflictSnapshot = isObject(result?.state) ? result.state : await loadRemoteState();
          if (applyRemoteSnapshotIfNewer(conflictSnapshot)) {
            broadcastState();
          }
        }
      } catch {
        // keep local-only mode when backend unavailable
      }
    });
};

const saveState = () => {
  gameState.savedAt = Date.now();
  const snapshot = serializeState(gameState.savedAt);
  writeStateToSessionStorage(snapshot);
  persistStateToBackend(snapshot);
};

const loadRemoteState = async () => {
  if (!isBackendEnabled()) return null;

  const sessionId = getSessionId();
  if (!sessionId) return null;

  try {
    const path = `${BACKEND_ENDPOINT_PREFIX}/${encodeURIComponent(sessionId)}`;
    const payload = await makeBackendRequest('GET', path);

    if (!payload || payload.notFound || !isObject(payload.state)) {
      return null;
    }

    return payload.state;
  } catch {
    return null;
  }
};

const applyRemoteSnapshotIfNewer = (remoteSnapshot) => {
  if (!isObject(remoteSnapshot?.gameState)) {
    return false;
  }

  const localSavedAt = Math.max(0, Math.floor(clampPositive(gameState.savedAt, 0)));
  const remoteSavedAt = getSnapshotSavedAt(remoteSnapshot);

  if (remoteSavedAt <= localSavedAt) {
    return false;
  }

  applyStateSnapshot(remoteSnapshot);
  writeStateToSessionStorage(remoteSnapshot);
  return true;
};

const hydrateState = async () => {
  const localSnapshot = readStateFromSessionStorage();
  if (localSnapshot) {
    applyStateSnapshot(localSnapshot);
  }

  const remoteSnapshot = await loadRemoteState();
  if (!remoteSnapshot) {
    if (isBackendEnabled()) {
      persistStateToBackend(localSnapshot || serializeState(Date.now()));
    }

    return;
  }

  const localSavedAt = getSnapshotSavedAt(localSnapshot);
  const remoteSavedAt = getSnapshotSavedAt(remoteSnapshot);

  if (remoteSavedAt >= localSavedAt) {
    applyStateSnapshot(remoteSnapshot);
    writeStateToSessionStorage(remoteSnapshot);
    return;
  }

  if (localSnapshot) {
    persistStateToBackend(localSnapshot);
  }
};

const setTipMenuRefreshInterval = () => {
  if (tipMenuRefreshTimer) {
    clearInterval(tipMenuRefreshTimer);
    tipMenuRefreshTimer = null;
  }

  tipMenuRefreshTimer = setInterval(() => {
    void loadTipMenu().then((changed) => {
      if (changed) {
        saveState();
        broadcastState();
      }
    });
  }, settings.tipMenuRefreshSec * 1000);
};

const handleTipContribution = (payload) => {
  const data = payload?.tokensSpendData || {};
  if (data.action !== 'director.menu.tip') {
    return;
  }

  const userState = getOrCreateUserState(data.userId, data.username);
  if (!userState) return;

  const amount = Math.max(0, Math.floor(toNumber(payload.tokensAmount, 0)));
  if (!amount) {
    return;
  }

  const requestedItemId = String(data.itemId || '').trim();
  const targetItem = getMenuItemById(requestedItemId) || getFirstMenuItem();

  if (!targetItem) {
    sendTargetedWhisper(userState.id, {
      type: 'director.menu.tip.result',
      status: 'rejected',
      message: 'Сейчас нет доступных позиций tip menu'
    });
    return;
  }

  userState.total += amount;
  userState.allocations[targetItem.id] = (userState.allocations[targetItem.id] || 0) + amount;

  gameState.totalSessionTips += amount;

  syncLeadership({ triggerUserId: userState.id });
  deriveMenuGoals();

  appendActivity(`${userState.name} +${amount} тк в «${targetItem.title}»`);

  sendTargetedWhisper(userState.id, {
    type: 'director.menu.tip.result',
    status: 'accepted',
    message: `Вклад принят: ${amount} тк в «${targetItem.title}»`
  });

  sendSelfAllocations(userState.id);

  saveState();
  broadcastState();
};

const handleReallocate = (data) => {
  const userState = getOrCreateUserState(data?.userId, data?.username);
  if (!userState) {
    return;
  }

  const fromItemId = String(data?.fromItemId || '').trim();
  const toItemId = String(data?.toItemId || '').trim();
  const amount = Math.max(0, Math.floor(toNumber(data?.amount, 0)));

  if (!fromItemId || !toItemId || fromItemId === toItemId || !amount) {
    sendTargetedWhisper(userState.id, {
      type: 'director.menu.reallocate.result',
      status: 'rejected',
      message: 'Проверьте from/to и сумму для перераспределения'
    });
    return;
  }

  const fromItem = getMenuItemById(fromItemId);
  const toItem = getMenuItemById(toItemId);

  if (!fromItem || !toItem) {
    sendTargetedWhisper(userState.id, {
      type: 'director.menu.reallocate.result',
      status: 'rejected',
      message: 'Одна из позиций уже недоступна'
    });
    return;
  }

  const available = Math.max(0, Math.floor(toNumber(userState.allocations[fromItemId], 0)));
  if (available < amount) {
    sendTargetedWhisper(userState.id, {
      type: 'director.menu.reallocate.result',
      status: 'rejected',
      message: `Недостаточно баланса в «${fromItem.title}»`
    });
    return;
  }

  userState.allocations[fromItemId] = available - amount;
  if (userState.allocations[fromItemId] <= 0) {
    delete userState.allocations[fromItemId];
  }

  userState.allocations[toItemId] = (userState.allocations[toItemId] || 0) + amount;

  deriveMenuGoals();
  appendActivity(`${userState.name} перекинул ${amount} тк: «${fromItem.title}» → «${toItem.title}»`);

  sendTargetedWhisper(userState.id, {
    type: 'director.menu.reallocate.result',
    status: 'accepted',
    message: `Перераспределено ${amount} тк`
  });

  sendSelfAllocations(userState.id);

  saveState();
  broadcastState();
};

const handleCommandIssue = (data) => {
  const userId = String(data?.userId || '').trim();
  const username = String(data?.username || 'viewer');
  const commandId = String(data?.commandId || '').trim();

  if (!userId || !commandId) {
    return;
  }

  const command = COMMAND_BY_ID[commandId];
  if (!command) {
    sendTargetedWhisper(userId, {
      type: 'director.command.result',
      status: 'rejected',
      message: 'Неизвестная команда'
    });
    return;
  }

  if (!gameState.isLive) {
    sendTargetedWhisper(userId, {
      type: 'director.command.result',
      status: 'rejected',
      message: 'Пульт активируется после выхода в LIVE'
    });
    return;
  }

  if (!gameState.director.id || gameState.director.id !== userId) {
    sendTargetedWhisper(userId, {
      type: 'director.command.result',
      status: 'rejected',
      message: 'Пульт доступен только текущему Режиссёру'
    });
    return;
  }

  const now = Date.now();
  const cooldownEndsAt = Math.max(0, Math.floor(toNumber(gameState.commandCooldowns[commandId], 0)));
  if (cooldownEndsAt > now) {
    sendTargetedWhisper(userId, {
      type: 'director.command.result',
      status: 'rejected',
      message: `Команда на кулдауне: ${Math.ceil((cooldownEndsAt - now) / 1000)}с`
    });
    return;
  }

  const durationMs = settings.commandDurationSec * 1000;
  const commandEntry = {
    id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    commandId: command.id,
    label: command.label,
    categoryTitle: command.categoryTitle,
    issuedById: userId,
    issuedByName: username,
    issuedAt: now,
    durationMs
  };

  if (!gameState.currentPerformance) {
    gameState.currentPerformance = {
      ...commandEntry,
      startedAt: now,
      endsAt: now + durationMs
    };
  } else {
    gameState.queue.push(commandEntry);
    gameState.queue = gameState.queue.slice(0, 40);
  }

  gameState.commandCooldowns[commandId] = now + settings.commandCooldownSec * 1000;
  gameState.commandHistory.unshift({
    id: commandEntry.id,
    commandId: commandEntry.commandId,
    label: commandEntry.label,
    categoryTitle: commandEntry.categoryTitle,
    issuedByName: commandEntry.issuedByName,
    issuedAt: commandEntry.issuedAt
  });
  gameState.commandHistory = gameState.commandHistory.slice(0, 25);

  gameState.overlayFlashAt = now;

  appendActivity(`Команда режиссёра: ${command.label}`);
  safeSendChatMessage(`Режиссёр: ${command.categoryTitle} / ${command.label}`);

  sendTargetedWhisper(userId, {
    type: 'director.command.result',
    status: 'accepted',
    message: `Команда «${command.label}» отправлена`,
    commandId,
    cooldownMs: settings.commandCooldownSec * 1000
  });

  saveState();
  broadcastState();
};

const tick = () => {
  const now = Date.now();
  let changed = false;

  if (gameState.currentPerformance && now >= gameState.currentPerformance.endsAt) {
    if (gameState.queue.length > 0) {
      const next = gameState.queue.shift();
      const durationMs = Math.max(1000, Math.floor(toNumber(next.durationMs, settings.commandDurationSec * 1000)));

      gameState.currentPerformance = {
        ...next,
        startedAt: now,
        endsAt: now + durationMs
      };

      appendActivity(`В эфире: ${next.label}`);
    } else {
      gameState.currentPerformance = null;
      appendActivity('Текущая команда завершена');
    }

    changed = true;
  }

  const cooldownKeys = Object.keys(gameState.commandCooldowns);
  cooldownKeys.forEach((commandId) => {
    const endsAt = Math.max(0, Math.floor(toNumber(gameState.commandCooldowns[commandId], 0)));
    if (!endsAt || endsAt <= now) {
      delete gameState.commandCooldowns[commandId];
      changed = true;
    }
  });

  if (changed) {
    saveState();
  }

  if (gameState.isLive || gameState.currentPerformance || cooldownKeys.length > 0) {
    broadcastState();
  }
};

const startTicker = () => {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_MS);
};

const startBackendHeartbeat = () => {
  if (backendHeartbeatTimer) {
    clearInterval(backendHeartbeatTimer);
    backendHeartbeatTimer = null;
  }

  backendHeartbeatTimer = setInterval(() => {
    if (!isBackendEnabled()) return;

    const savedAt = Math.max(0, Math.floor(clampPositive(gameState.savedAt, 0)));
    const snapshot = serializeState(savedAt || Date.now());
    persistStateToBackend(snapshot);
  }, BACKEND_HEARTBEAT_MS);
};

const startStateBroadcastHeartbeat = () => {
  if (stateBroadcastHeartbeatTimer) return;

  stateBroadcastHeartbeatTimer = setInterval(() => {
    broadcastState();
  }, STATE_BROADCAST_HEARTBEAT_MS);
};

const loadSettings = async () => {
  const { settings: raw } = await ext.makeRequest('v1.model.ext.settings.get', null);
  settings = normalizeSettings(raw || DEFAULT_SETTINGS);
};

const reloadSettings = async () => {
  try {
    await loadSettings();
    setTipMenuRefreshInterval();
    startBackendHeartbeat();
    syncLeadership();
    await loadTipMenu();

    saveState();
    broadcastState();
  } catch {
    // ignore settings reload failures
  }
};

const handleWhisper = (data) => {
  if (!isObject(data)) return;

  if (data.type === 'director.state.request') {
    broadcastState();
    return;
  }

  if (data.type === 'director.self.allocations.request') {
    sendSelfAllocations(data.userId);
    return;
  }

  if (data.type === 'director.menu.reallocate') {
    handleReallocate(data);
    return;
  }

  if (data.type === 'director.command.issue') {
    handleCommandIssue(data);
    return;
  }

  if (data.type === 'director.settings.updated') {
    void reloadSettings();
  }
};

const init = async () => {
  ctx = await ext.makeRequest('v1.ext.context.get', null);

  await loadSettings();
  await hydrateState();

  if (!gameState.tipMenu.settings.length) {
    await loadTipMenu();
  } else {
    deriveMenuGoals();
  }

  syncLeadership();

  ext.subscribe('v1.ext.whispered', handleWhisper);
  ext.subscribe('v1.payment.tokens.spend.succeeded', handleTipContribution);

  requestOverlayOpen();
  startTicker();
  setTipMenuRefreshInterval();
  startBackendHeartbeat();
  startStateBroadcastHeartbeat();

  saveState();
  broadcastState();
};

void init();
