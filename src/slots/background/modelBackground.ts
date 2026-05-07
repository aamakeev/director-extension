import type {
  TEvents,
  TV1ExtContext,
  TV1PaymentData,
  TV1TipMenu,
} from '@stripchatdev/ext-helper';
import { createExtHelper } from '@stripchatdev/ext-helper';

import { chairCatchUpTokens } from '../../shared/chairBite';
import { COMMAND_BY_ID, type DirectorCommand } from '../../shared/commands';
import { clampInt, isObject } from '../../shared/format';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type DirectorSettings,
} from '../../shared/settings';
import {
  TIP_MENU_FALLBACK,
  applyMarkupToMenu,
  isWhisperEnvelope,
  tipMenuToItems,
  type DirectorActivity,
  type DirectorActivityBroadcast,
  type DirectorMenuContributor,
  type DirectorMenuGoal,
  type DirectorMenuItem,
  type DirectorPerformance,
  type DirectorPublicState,
  type DirectorQueueEntry,
  type DirectorUser,
  type WhisperEnvelope,
} from '../../shared/state';
import {
  claimHostActivityForEvent,
  clearHostActivity,
  createHostActivitySlot,
  releaseCommandHostActivity,
  type HostActivitySlot,
} from '../../shared/hostExtensionActivity';

const TICK_MS = 1000;
const HEARTBEAT_MS = 7_000;

type ModelGameState = {
  gameAccepting: boolean;
  isLive: boolean;
  totalSessionTips: number;
  director: { id: string | null; name: string; total: number; startedAt: number };
  challenger: { id: string | null; name: string; total: number };
  users: Record<string, DirectorUser>;
  menu: DirectorMenuItem[];
  menuSource: 'sdk' | 'fallback';
  currentPerformance: DirectorPerformance | null;
  queue: DirectorPerformance[];
  commandHistory: DirectorQueueEntry[];
  commandCooldowns: Record<string, number>;
  flashAt: number;
  activityFeed: DirectorActivity[];
  seenTransactions: Set<string>;
};

const createInitialState = (): ModelGameState => ({
  gameAccepting: false,
  isLive: false,
  totalSessionTips: 0,
  director: { id: null, name: 'Open seat', total: 0, startedAt: 0 },
  challenger: { id: null, name: 'No chase yet', total: 0 },
  users: {},
  menu: [],
  menuSource: 'fallback',
  currentPerformance: null,
  queue: [],
  commandHistory: [],
  commandCooldowns: {},
  flashAt: 0,
  activityFeed: [],
  seenTransactions: new Set(),
});

export const startModelBackground = (): (() => void) => {
  const ext = createExtHelper();

  let context: TV1ExtContext = {};
  let settings: DirectorSettings = { ...DEFAULT_SETTINGS };
  let state = createInitialState();
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  const hostActivitySlot: HostActivitySlot = createHostActivitySlot();

  const reportError = (message: string, data: unknown) => {
    void ext
      .makeRequest('v1.monitoring.report.error', { message, data })
      .catch(() => undefined);
  };

  /** Public room chat via SDK (`v1.chat.message.send` — extension message, not chatbot). */
  const sendPublicChat = (message: string) => {
    const text = message.trim().slice(0, 2000);
    if (!text) return;
    void ext
      .makeRequest('v1.chat.message.send', {
        message: text,
        isAnonymous: false,
        user: context.user ?? null,
      })
      .catch((err: unknown) =>
        reportError('director v1.chat.message.send failed', { err: String(err) }),
      );
  };

  const safeBroadcast = (data: WhisperEnvelope) => {
    void ext
      .makeRequest('v1.ext.whisper', { data: data as Record<string, unknown> })
      .catch((err: unknown) => reportError('director model whisper failed', { err: String(err) }));
  };

  /** Room whisper + local whisper + SDK host activity (`v1.ext.activity.*`). */
  const relayActivity = (payload: DirectorActivityBroadcast) => {
    void ext
      .makeRequest('v1.ext.whisper', { data: payload as Record<string, unknown> })
      .catch((err: unknown) =>
        reportError('director activity whisper (room) failed', { err: String(err) }),
      );
    void ext
      .makeRequest('v1.ext.whisper.local', { data: payload as Record<string, unknown> })
      .catch((err: unknown) =>
        reportError('director activity whisper.local failed', { err: String(err) }),
      );
    void claimHostActivityForEvent(
      ext,
      hostActivitySlot,
      payload.kind,
      settings.commandDurationSec,
      reportError,
    );
  };

  /** Tip-menu lines that already fired `menu_goal_complete` this show. */
  let menuGoalsCompleted = new Set<string>();

  const appendActivity = (text: string, tone: DirectorActivity['tone'] = 'info') => {
    state.activityFeed.unshift({
      id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      text: text.slice(0, 200),
      tone,
    });
    state.activityFeed = state.activityFeed.slice(0, 30);
  };

  const ensureUser = (userId: string, username: string): DirectorUser | null => {
    const id = String(userId || '').trim();
    if (!id) return null;
    const existing = state.users[id];
    if (existing) {
      existing.name = String(username || existing.name).slice(0, 60);
      return existing;
    }
    const created: DirectorUser = {
      id,
      name: String(username || 'viewer').slice(0, 60),
      total: 0,
      allocations: {},
    };
    state.users[id] = created;
    return created;
  };

  const sortedUsers = (): DirectorUser[] =>
    Object.values(state.users).sort((a, b) => b.total - a.total);

  const setChallengerFrom = (sorted: DirectorUser[]) => {
    const candidate = sorted.find((u) => u.id !== state.director.id);
    if (!candidate) {
      state.challenger = { id: null, name: 'No chase yet', total: 0 };
      return;
    }
    state.challenger = { id: candidate.id, name: candidate.name, total: candidate.total };
  };

  const promoteToDirector = (
    user: DirectorUser,
    reason: 'liveStart' | 'overtake' | 'fallback',
  ) => {
    state.director = {
      id: user.id,
      name: user.name,
      total: user.total,
      startedAt: Date.now(),
    };
    state.flashAt = Date.now();
    if (reason === 'liveStart') {
      appendActivity(`We're LIVE — Director: ${user.name}`, 'spotlight');
      sendPublicChat(
        `We're LIVE! Tip goal met — ${user.name} is Director and calls the shots.`,
      );
    } else if (reason === 'overtake') {
      appendActivity(`New Director: ${user.name}`, 'spotlight');
      sendPublicChat(`${user.name} is now Director.`);
    }
  };

  const syncLeadership = (triggerUserId: string | null) => {
    const sorted = sortedUsers();

    if (
      state.gameAccepting &&
      !state.isLive &&
      state.totalSessionTips >= settings.preproductionGoal &&
      sorted.length
    ) {
      state.isLive = true;
      const trigger = triggerUserId ? state.users[triggerUserId] ?? null : null;
      promoteToDirector(trigger ?? sorted[0]!, 'liveStart');
      relayActivity({
        type: 'director.activity',
        id: `live_${Date.now()}`,
        at: Date.now(),
        kind: 'control_unlock',
        directorName: state.director.name,
        preproductionGoal: settings.preproductionGoal,
      });
    }

    if (!state.isLive) {
      setChallengerFrom(sorted);
      return;
    }

    if (!sorted.length) {
      state.director = { id: null, name: 'Open seat', total: 0, startedAt: 0 };
      state.challenger = { id: null, name: 'No chase yet', total: 0 };
      return;
    }

    const directorUser = state.director.id ? state.users[state.director.id] : null;
    if (!directorUser) {
      promoteToDirector(sorted[0]!, 'fallback');
    } else {
      state.director.name = directorUser.name;
      state.director.total = directorUser.total;
    }

    const candidate = sortedUsers().find((u) => u.id !== state.director.id) ?? null;
    if (candidate) {
      const canSwitch =
        Date.now() - state.director.startedAt >= settings.minTenureSec * 1000;
      const hasEnough = candidate.total >= state.director.total + settings.overtakeMargin;
      if (canSwitch && hasEnough) {
        promoteToDirector(candidate, 'overtake');
      }
    }

    setChallengerFrom(sortedUsers());
  };

  const pruneAllocationsToMenu = () => {
    const validIds = new Set(state.menu.map((item) => item.id));
    const fallbackId = state.menu[0]?.id ?? '';
    Object.values(state.users).forEach((user) => {
      const next: Record<string, number> = {};
      let overflow = 0;
      Object.entries(user.allocations || {}).forEach(([id, amount]) => {
        const value = clampInt(amount, 0);
        if (!value) return;
        if (validIds.has(id)) {
          next[id] = (next[id] ?? 0) + value;
        } else {
          overflow += value;
        }
      });
      if (overflow > 0 && fallbackId) {
        next[fallbackId] = (next[fallbackId] ?? 0) + overflow;
      }
      user.allocations = next;
    });
  };

  const contributorsForItem = (itemId: string): DirectorMenuContributor[] => {
    const validIds = new Set(state.menu.map((item) => item.id));
    if (!validIds.has(itemId)) return [];
    const rows: DirectorMenuContributor[] = [];
    Object.values(state.users).forEach((user) => {
      const amount = clampInt(user.allocations?.[itemId], 0);
      if (amount > 0) {
        rows.push({ userId: user.id, name: user.name, amount });
      }
    });
    rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    return rows;
  };

  const deriveGoals = (): DirectorMenuGoal[] => {
    const totals: Record<string, number> = {};
    const validIds = new Set(state.menu.map((item) => item.id));
    Object.values(state.users).forEach((user) => {
      Object.entries(user.allocations || {}).forEach(([id, amount]) => {
        if (!validIds.has(id)) return;
        totals[id] = (totals[id] ?? 0) + clampInt(amount, 0);
      });
    });
    return state.menu
      .map((item) => {
        const progress = totals[item.id] ?? 0;
        const tokensLeft = Math.max(0, item.price - progress);
        const percent = item.price > 0 ? Math.min(100, (progress / item.price) * 100) : 0;
        const contributors = contributorsForItem(item.id);
        return { ...item, progress, tokensLeft, percent, contributors };
      })
      .sort((a, b) => {
        if (a.tokensLeft !== b.tokensLeft) return a.tokensLeft - b.tokensLeft;
        if (a.price !== b.price) return a.price - b.price;
        return a.title.localeCompare(b.title);
      });
  };

  const checkMenuGoalCompletions = () => {
    for (const g of deriveGoals()) {
      if (g.price <= 0 || g.progress < g.price) continue;
      if (menuGoalsCompleted.has(g.id)) continue;
      menuGoalsCompleted.add(g.id);
      const contributors = g.contributors.length ? g.contributors : contributorsForItem(g.id);
      const names = contributors.map((c) => c.name).join(', ');
      const n = contributors.length;
      const who =
        n === 0
          ? 'Room funded this line'
          : n === 1
            ? `${contributors[0]!.name} contributed`
            : `${n} viewers contributed: ${names}`;
      appendActivity(`Room collected for "${g.title}" (${who}) for "${g.title}".`, 'spotlight');
      relayActivity({
        type: 'director.activity',
        id: `goal_${g.id}_${Date.now()}`,
        at: Date.now(),
        kind: 'menu_goal_complete',
        itemId: g.id,
        itemTitle: g.title,
        price: g.price,
        contributors,
      });
      const detail =
        n === 0
          ? 'Room funded this tip menu line.'
          : n === 1
            ? `${contributors[0]!.name} contributed ${contributors[0]!.amount} tk.`
            : `${n} viewers contributed (${contributors
                .map((c) => `${c.name} ${c.amount} tk`)
                .join(', ')}).`;
      sendPublicChat(
        `Stage — room filled "${g.title}" (${g.price} tk). ${detail} Thank you for "${g.title}".`,
      );
    }
  };

  const repriceMenu = () => {
    state.menu = applyMarkupToMenu(state.menu, settings.tipMenuMarkupPercent);
  };

  const applyTipMenu = (tipMenu: TV1TipMenu | null) => {
    const items = tipMenuToItems(tipMenu);
    if (items.length) {
      state.menu = items;
      state.menuSource = 'sdk';
    } else if (!state.menu.length) {
      state.menu = TIP_MENU_FALLBACK;
      state.menuSource = 'fallback';
    }
    repriceMenu();
    pruneAllocationsToMenu();
  };

  const buildPressure = () => {
    const directorTotal = Math.max(0, state.director.total);
    const challengerTotal = Math.max(0, state.challenger.total);
    const gap = Math.max(0, directorTotal - challengerTotal);
    const threshold = directorTotal + settings.overtakeMargin;
    const percent = threshold > 0 ? Math.min(100, (challengerTotal / threshold) * 100) : 0;
    return {
      gap,
      margin: settings.overtakeMargin,
      neededToOvertake: Math.max(0, threshold - challengerTotal),
      percent,
      isCritical: gap < settings.overtakeMargin,
    };
  };

  const cooldownMap = (): Record<string, number> => {
    const now = Date.now();
    const out: Record<string, number> = {};
    for (const [id, endsAt] of Object.entries(state.commandCooldowns)) {
      const ends = clampInt(endsAt, 0);
      if (ends > now) out[id] = ends - now;
    }
    return out;
  };

  const buildPublicState = (): DirectorPublicState => {
    const now = Date.now();
    const tenureLeft = state.director.startedAt
      ? Math.max(0, state.director.startedAt + settings.minTenureSec * 1000 - now)
      : 0;
    return {
      type: 'director.state',
      gameAccepting: state.gameAccepting,
      isLive: state.isLive,
      totalSessionTips: state.totalSessionTips,
      preproductionGoal: settings.preproductionGoal,
      overtakeMargin: settings.overtakeMargin,
      minTenureSec: settings.minTenureSec,
      commandCostTokens: settings.commandCostTokens,
      director: { ...state.director },
      challenger: { ...state.challenger },
      pressure: buildPressure(),
      directorTenureLeftMs: tenureLeft,
      menuGoals: deriveGoals(),
      menuSource: state.menuSource,
      currentPerformance: state.currentPerformance
        ? {
            ...state.currentPerformance,
            remainingMs: Math.max(0, state.currentPerformance.endsAt - now),
          }
        : null,
      queue: state.queue.map(({ startedAt: _s, endsAt: _e, ...entry }) => entry),
      commandHistory: state.commandHistory.slice(0, 8),
      commandCooldowns: cooldownMap(),
      flashAt: state.flashAt,
      activityFeed: state.activityFeed.slice(0, 12),
      updatedAt: now,
    };
  };

  const broadcastState = () => {
    safeBroadcast(buildPublicState());
  };

  const sendSelfAllocations = (userId: string) => {
    const id = String(userId || '');
    if (!id) return;
    const user = state.users[id];
    const goals = deriveGoals();
    safeBroadcast({
      type: 'director.self.allocations',
      targetUserId: id,
      total: user?.total ?? 0,
      allocations: goals.map((g) => ({
        itemId: g.id,
        title: g.title,
        allocated: clampInt(user?.allocations?.[g.id], 0),
      })),
    });
  };

  const sendToast = (
    targetUserId: string,
    tone: 'success' | 'warn' | 'info',
    message: string,
  ) => {
    safeBroadcast({
      type: 'director.toast',
      targetUserId: String(targetUserId || ''),
      tone,
      message: message.slice(0, 200),
    });
  };

  const validatePayment = (paymentData: unknown, expectedAmount: number, userId: string): TV1PaymentData | null => {
    if (!isObject(paymentData)) return null;
    const data = paymentData as TV1PaymentData;
    if (
      typeof data.amount !== 'string' ||
      typeof data.paymentToken !== 'string' ||
      typeof data.transactionId !== 'string' ||
      typeof data.userId !== 'string'
    ) {
      return null;
    }
    const amount = Number(data.amount);
    if (!Number.isFinite(amount) || amount < expectedAmount) return null;
    if (String(data.userId) !== String(userId)) return null;
    if (state.seenTransactions.has(data.transactionId)) return null;
    return data;
  };

  const markTransaction = (txId: string) => {
    state.seenTransactions.add(txId);
    if (state.seenTransactions.size > 500) {
      const arr = Array.from(state.seenTransactions);
      state.seenTransactions = new Set(arr.slice(arr.length - 250));
    }
  };

  const handleMenuTip = (envelope: Extract<WhisperEnvelope, { type: 'director.menu.tip' }>) => {
    const payment = validatePayment(envelope.paymentData, envelope.amount, envelope.userId);
    if (!payment) return;

    const user = ensureUser(envelope.userId, envelope.username);
    if (!user) return;

    const item = state.menu.find((m) => m.id === envelope.itemId) ?? state.menu[0];
    if (!item) {
      sendToast(user.id, 'warn', 'No tip menu items available right now');
      return;
    }

    const amount = Math.max(0, Math.floor(envelope.amount));
    if (!amount) return;

    markTransaction(payment.transactionId);

    user.total += amount;
    user.allocations[item.id] = (user.allocations[item.id] ?? 0) + amount;
    state.totalSessionTips += amount;

    syncLeadership(user.id);
    appendActivity(`${user.name} +${amount}tk → "${item.title}"`, 'success');
    sendToast(user.id, 'success', `Counted: ${amount}tk → "${item.title}"`);
    checkMenuGoalCompletions();
    sendSelfAllocations(user.id);
    broadcastState();
  };

  const handleChairChase = (envelope: Extract<WhisperEnvelope, { type: 'director.chair.chase' }>) => {
    const payment = validatePayment(envelope.paymentData, envelope.amount, envelope.userId);
    if (!payment) return;

    if (!state.isLive || !state.director.id) {
      sendToast(envelope.userId, 'warn', 'Director takeover only works while we are live');
      return;
    }

    const tenureLeft = state.director.startedAt
      ? Math.max(0, state.director.startedAt + settings.minTenureSec * 1000 - Date.now())
      : 0;
    if (tenureLeft > 0) {
      sendToast(envelope.userId, 'warn', 'Wait until the Director safe window ends');
      return;
    }

    if (state.director.id === envelope.userId) {
      sendToast(envelope.userId, 'warn', 'You are already the Director');
      return;
    }

    const user = ensureUser(envelope.userId, envelope.username);
    if (!user) return;

    const need = chairCatchUpTokens(
      state.director.total,
      settings.overtakeMargin,
      user.total,
    );
    if (need <= 0) {
      sendToast(envelope.userId, 'info', 'You already qualify—syncing…');
      syncLeadership(user.id);
      broadcastState();
      return;
    }

    const amount = Math.max(0, Math.floor(envelope.amount));
    if (amount !== need) {
      sendToast(envelope.userId, 'warn', `Tip exactly ${need} tk to become Director`);
      return;
    }

    const item = state.menu[0];
    if (!item) {
      sendToast(user.id, 'warn', 'No menu lines to attach this tip to');
      return;
    }

    markTransaction(payment.transactionId);

    user.total += amount;
    user.allocations[item.id] = (user.allocations[item.id] ?? 0) + amount;
    state.totalSessionTips += amount;

    syncLeadership(user.id);
    appendActivity(`${user.name} +${amount}tk → Director chase`, 'success');
    sendToast(user.id, 'success', `${amount}tk toward the Director seat`);
    checkMenuGoalCompletions();
    sendSelfAllocations(user.id);
    broadcastState();
  };

  const handleReallocate = (
    envelope: Extract<WhisperEnvelope, { type: 'director.menu.reallocate' }>,
  ) => {
    const payment = validatePayment(envelope.paymentData, 1, envelope.userId);
    if (!payment) return;
    markTransaction(payment.transactionId);

    const user = ensureUser(envelope.userId, envelope.username);
    if (!user) return;

    const fromId = String(envelope.fromItemId || '').trim();
    const toId = String(envelope.toItemId || '').trim();
    const amount = Math.max(0, Math.floor(envelope.amount));
    if (!fromId || !toId || fromId === toId || !amount) {
      sendToast(user.id, 'warn', 'Invalid reallocation request');
      return;
    }
    const fromItem = state.menu.find((m) => m.id === fromId);
    const toItem = state.menu.find((m) => m.id === toId);
    if (!fromItem || !toItem) {
      sendToast(user.id, 'warn', 'One of the menu positions is no longer available');
      return;
    }

    const available = clampInt(user.allocations[fromId], 0);
    if (available < amount) {
      sendToast(user.id, 'warn', `Not enough balance in "${fromItem.title}"`);
      return;
    }

    user.allocations[fromId] = available - amount;
    if (user.allocations[fromId] <= 0) delete user.allocations[fromId];
    user.allocations[toId] = (user.allocations[toId] ?? 0) + amount;

    appendActivity(
      `${user.name} moved ${amount}tk: "${fromItem.title}" → "${toItem.title}"`,
      'info',
    );
    sendToast(user.id, 'success', `Reallocated ${amount}tk`);
    checkMenuGoalCompletions();
    sendSelfAllocations(user.id);
    broadcastState();
  };

  const handleCommandIssue = (
    envelope: Extract<WhisperEnvelope, { type: 'director.command.issue' }>,
  ) => {
    const payment = validatePayment(
      envelope.paymentData,
      settings.commandCostTokens,
      envelope.userId,
    );
    if (!payment) return;

    const command: DirectorCommand | undefined = COMMAND_BY_ID[envelope.commandId];
    if (!command) {
      sendToast(envelope.userId, 'warn', 'Unknown command');
      return;
    }
    if (!state.isLive) {
      sendToast(envelope.userId, 'warn', 'Commands unlock once we are LIVE');
      return;
    }
    if (!state.director.id || state.director.id !== envelope.userId) {
      sendToast(envelope.userId, 'warn', 'Only the Director can send commands');
      return;
    }
    const now = Date.now();
    const cdEnds = clampInt(state.commandCooldowns[command.id], 0);
    if (cdEnds > now) {
      sendToast(
        envelope.userId,
        'warn',
        `Command on cooldown: ${Math.ceil((cdEnds - now) / 1000)}s`,
      );
      return;
    }

    markTransaction(payment.transactionId);

    const durationMs = settings.commandDurationSec * 1000;
    const entry: DirectorPerformance = {
      id: `cmd_${now}_${Math.random().toString(36).slice(2, 6)}`,
      commandId: command.id,
      label: command.label,
      emoji: command.emoji,
      categoryTitle: command.categoryTitle,
      issuedById: envelope.userId,
      issuedByName: envelope.username,
      issuedAt: now,
      durationMs,
      startedAt: now,
      endsAt: now + durationMs,
    };

    if (!state.currentPerformance) {
      state.currentPerformance = entry;
    } else {
      state.queue.push(entry);
      state.queue = state.queue.slice(0, 20);
    }

    state.commandCooldowns[command.id] = now + settings.commandCooldownSec * 1000;
    state.commandHistory.unshift({
      id: entry.id,
      commandId: entry.commandId,
      label: entry.label,
      emoji: entry.emoji,
      categoryTitle: entry.categoryTitle,
      issuedById: entry.issuedById,
      issuedByName: entry.issuedByName,
      issuedAt: entry.issuedAt,
      durationMs: entry.durationMs,
    });
    state.commandHistory = state.commandHistory.slice(0, 12);
    state.flashAt = now;

    appendActivity(`Director: ${command.emoji} ${command.label}`, 'spotlight');
    relayActivity({
      type: 'director.activity',
      id: entry.id,
      at: now,
      kind: 'command_start',
      commandId: command.id,
      label: command.label,
      emoji: command.emoji,
      issuedByName: envelope.username,
    });
    sendPublicChat(`Director called: ${command.emoji} ${command.label}`);

    sendToast(envelope.userId, 'success', `"${command.label}" sent`);
    broadcastState();
  };

  const verifyModelWhisper = (modelId: unknown): boolean => {
    const expected = String(context.model?.id ?? '');
    return Boolean(expected && String(modelId) === expected);
  };

  const pauseGameRound = () => {
    state.gameAccepting = false;
    state.isLive = false;
    state.director = { id: null, name: 'Open seat', total: 0, startedAt: 0 };
    state.challenger = { id: null, name: 'No chase yet', total: 0 };
    state.currentPerformance = null;
    state.queue = [];
    state.commandHistory = [];
    state.commandCooldowns = {};
    state.flashAt = 0;
    void clearHostActivity(ext, hostActivitySlot);
    appendActivity('Broadcaster paused Director mode', 'info');
    broadcastState();
  };

  const resumeGameRound = () => {
    state.gameAccepting = true;
    appendActivity('Broadcaster resumed Director mode', 'info');
    syncLeadership(null);
    broadcastState();
  };

  const handleWhispered = (data: TEvents['v1.ext.whispered']) => {
    if (!isWhisperEnvelope(data)) return;
    if (data.type === 'director.activity') {
      return;
    }
    if (data.type === 'director.state.request') {
      broadcastState();
      return;
    }
    if (data.type === 'director.menu.tip') {
      handleMenuTip(data);
      return;
    }
    if (data.type === 'director.menu.reallocate') {
      handleReallocate(data);
      return;
    }
    if (data.type === 'director.chair.chase') {
      handleChairChase(data);
      return;
    }
    if (data.type === 'director.command.issue') {
      handleCommandIssue(data);
      return;
    }
    if (data.type === 'director.settings.updated') {
      void reloadSettings();
      return;
    }
    if (data.type === 'director.game.stop') {
      if (!verifyModelWhisper(data.modelId)) return;
      pauseGameRound();
      return;
    }
    if (data.type === 'director.game.start') {
      if (!verifyModelWhisper(data.modelId)) return;
      resumeGameRound();
      return;
    }
    if (data.type === 'director.show.reset') {
      const modelId = String(context.model?.id ?? '');
      if (!modelId || String(data.modelId) !== modelId) return;
      const preservedMenu = state.menu;
      const preservedSource = state.menuSource;
      state = createInitialState();
      state.menu = preservedMenu;
      state.menuSource = preservedSource;
      menuGoalsCompleted.clear();
      state.gameAccepting = false;
      void clearHostActivity(ext, hostActivitySlot);
      appendActivity('Strike — model cleared the set', 'spotlight');
      broadcastState();
    }
  };

  const relayChairChaseSpendFromModelClient = (
    payload: TEvents['v1.payment.tokens.spend.succeeded'],
  ) => {
    const intent = payload.tokensSpendData;
    if (!isObject(intent) || intent.kind !== 'director.chair.chase') return;
    const userId = String(
      (intent as { userId?: string }).userId || payload.paymentData.userId || '',
    );
    const username = String((intent as { username?: string }).username || '');
    const envelope: WhisperEnvelope = {
      type: 'director.chair.chase',
      paymentData: payload.paymentData,
      amount: Math.max(0, Math.floor(Number(payload.paymentData.amount))) || 0,
      userId,
      username,
    };
    void ext
      .makeRequest('v1.ext.whisper', {
        data: envelope as Record<string, unknown>,
        paymentData: payload.paymentData,
      })
      .catch((err: unknown) =>
        reportError('director model chair chase relay whisper failed', { err: String(err) }),
      );
  };

  const handleTipMenuUpdated = (payload: TEvents['v1.tipMenu.updated']) => {
    applyTipMenu(payload.tipMenu);
    broadcastState();
  };

  const handleContextUpdated = (payload: TEvents['v1.ext.context.updated']) => {
    context = payload.context;
    broadcastState();
  };

  const handleActivityBusy = (_payload: TEvents['v1.ext.activity.busy']) => {
    /* Host activity channel in use (see SDK `v1.ext.activity.busy`). */
  };

  const handleActivityAvailable = (_payload: TEvents['v1.ext.activity.available']) => {
    /* Channel free for `v1.ext.activity.request` (see SDK `v1.ext.activity.available`). */
  };

  const tick = () => {
    const now = Date.now();
    let dirty = false;

    if (state.currentPerformance && now >= state.currentPerformance.endsAt) {
      void releaseCommandHostActivity(ext, hostActivitySlot);
      const next = state.queue.shift();
      if (next) {
        const cmd = COMMAND_BY_ID[next.commandId];
        state.currentPerformance = {
          ...next,
          startedAt: now,
          endsAt: now + next.durationMs,
        };
        appendActivity(`Live now: ${next.emoji} ${next.label}`, 'info');
        relayActivity({
          type: 'director.activity',
          id: next.id,
          at: now,
          kind: 'command_start',
          commandId: next.commandId,
          label: cmd?.label ?? next.label,
          emoji: cmd?.emoji ?? next.emoji,
          issuedByName: next.issuedByName,
        });
      } else {
        state.currentPerformance = null;
        appendActivity('Nothing playing — ready for the next order', 'info');
      }
      dirty = true;
    }

    for (const id of Object.keys(state.commandCooldowns)) {
      const ends = clampInt(state.commandCooldowns[id], 0);
      if (!ends || ends <= now) {
        delete state.commandCooldowns[id];
        dirty = true;
      }
    }

    if (state.isLive) syncLeadership(null);

    if (dirty || state.isLive || state.currentPerformance) {
      broadcastState();
    }
  };

  const reloadSettings = async () => {
    try {
      const res = await ext.makeRequest('v1.ext.settings.get', null);
      settings = normalizeSettings(res.settings);
      repriceMenu();
      syncLeadership(null);
      broadcastState();
    } catch (err) {
      reportError('director failed to reload settings', { err: String(err) });
    }
  };

  const init = async () => {
    try {
      context = await ext.makeRequest('v1.ext.context.get', null);
    } catch (err) {
      reportError('director model failed to load context', { err: String(err) });
    }

    try {
      const res = await ext.makeRequest('v1.ext.settings.get', null);
      settings = normalizeSettings(res.settings);
    } catch (_err) {
      settings = { ...DEFAULT_SETTINGS };
    }

    try {
      const res = await ext.makeRequest('v1.tipMenu.get', null);
      applyTipMenu(res.tipMenu);
    } catch (_err) {
      applyTipMenu(null);
    }

    ext.subscribe('v1.ext.whispered', handleWhispered);
    ext.subscribe('v1.payment.tokens.spend.succeeded', relayChairChaseSpendFromModelClient);
    ext.subscribe('v1.tipMenu.updated', handleTipMenuUpdated);
    ext.subscribe('v1.ext.context.updated', handleContextUpdated);
    ext.subscribe('v1.ext.activity.busy', handleActivityBusy);
    ext.subscribe('v1.ext.activity.available', handleActivityAvailable);

    tickTimer = setInterval(tick, TICK_MS);
    heartbeatTimer = setInterval(broadcastState, HEARTBEAT_MS);

    syncLeadership(null);
    broadcastState();

    void ext
      .makeRequest('v1.monitoring.report.log', {
        message: 'director model background ready',
        data: { modelId: context.model?.id ?? null },
      })
      .catch(() => undefined);
  };

  void init();

  return () => {
    if (tickTimer) clearInterval(tickTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    ext.unsubscribe('v1.ext.whispered', handleWhispered);
    ext.unsubscribe('v1.payment.tokens.spend.succeeded', relayChairChaseSpendFromModelClient);
    ext.unsubscribe('v1.tipMenu.updated', handleTipMenuUpdated);
    ext.unsubscribe('v1.ext.context.updated', handleContextUpdated);
    ext.unsubscribe('v1.ext.activity.busy', handleActivityBusy);
    ext.unsubscribe('v1.ext.activity.available', handleActivityAvailable);
    void clearHostActivity(ext, hostActivitySlot);
  };
};
