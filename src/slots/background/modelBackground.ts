import type {
  TEvents,
  TV1ExtContext,
  TV1ExtUser,
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
  durationMsForDirectorActivity,
  releaseCommandHostActivity,
  type HostActivitySlot,
} from '../../shared/hostExtensionActivity';
import { drainMoves } from '../../shared/movesStorage';
import {
  clearGameState,
  loadGameState,
  saveGameState,
  type PersistedGameState,
} from '../../shared/gameStorage';

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
  /** Recent broadcast activities so newly-mounted decorative iframes can backfill. */
  recentActivities: DirectorActivityBroadcast[];
  seenTransactions: Set<string>;
  seenMoveTxnIds: Set<string>;
  drainingMoves: boolean;
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
  recentActivities: [],
  seenTransactions: new Set(),
  seenMoveTxnIds: new Set(),
  drainingMoves: false,
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

  /**
   * Public room chat via SDK (`v1.chat.message.send`).
   * Docs: https://extensions.udi.stripchat.dev/docs/api/requests#v1-chat-message-send
   * For tipper-attributable messages, pass `user` so the host renders the tipper's
   * username/avatar; otherwise the model's `context.user` authors the message.
   */
  const asAttributedUser = (actor: { userId: string; username: string } | null): TV1ExtUser | null => {
    if (!actor) return null;
    const idNum = Number(actor.userId);
    if (!Number.isFinite(idNum) || idNum <= 0) return null;
    return {
      isGuest: false,
      id: idNum,
      username: actor.username || 'viewer',
      status: 'public',
      hasTokens: true,
      hasPaidBefore: true,
      hasUltimateSubscription: false,
      isModel: false,
    } as unknown as TV1ExtUser;
  };

  const resolveChatActor = (
    actor: { userId: string; username: string } | null | undefined,
  ): { userId: string; username: string } | null => {
    if (actor) return actor;
    if (context.user && !context.user.isGuest) {
      return {
        userId: String(context.user.id),
        username: context.user.username,
      };
    }
    return null;
  };

  const sendPublicChat = (
    message: string,
    actor?: { userId: string; username: string } | null,
    options?: { anonymous?: boolean },
  ) => {
    const text = message.trim().slice(0, 2000);
    if (!text) return;
    const anonymous = options?.anonymous === true;
    const resolvedActor = anonymous ? null : resolveChatActor(actor);
    void ext
      .makeRequest('v1.chat.message.send', {
        message: text,
        isAnonymous: anonymous,
        user: anonymous ? null : asAttributedUser(resolvedActor),
      })
      .catch((err: unknown) =>
        reportError('director v1.chat.message.send failed', { err: String(err) }),
      );

    safeBroadcast({
      type: 'director.chat.message',
      message: text,
      userId: resolvedActor?.userId,
      username: resolvedActor?.username,
      anonymous,
    });
  };

  /**
   * Tip-attributable public chat. Same transport as `sendPublicChat`, but we
   * pass an explicit actor so the host renders that viewer as the speaker
   * (avoids the model's name prefixing system-y notices).
   * `v1.chatbot.message.send` is reserved for the chatbot extension category
   * and is not available here, so we stick to `v1.chat.message.send`.
   */
  const sendSystemChat = (
    message: string,
    actor?: { userId: string; username: string } | null,
  ) => sendPublicChat(message, actor ?? null);

  /** Anonymous room notice — no author label on the chat line. */
  const sendAnonymousChat = (message: string) =>
    sendPublicChat(message, null, { anonymous: true });

  /**
   * Send a single chat line built from atoms. Atoms are concatenated with a
   * single space; Stripchat's chat renderer wraps the result by whitespace
   * so each atom ends up on its own row in narrow chat layouts. We rely on
   * natural wrapping rather than forced newlines.
   */
  const sendChatAtoms = (
    atoms: string[],
    actor?: { userId: string; username: string } | null,
  ) => {
    const text = atoms
      .map((t) => t.trim())
      .filter(Boolean)
      .join(' ');
    if (!text) return;
    if (actor) {
      sendSystemChat(text, actor);
    } else {
      sendAnonymousChat(text);
    }
  };

  const safeBroadcast = (data: WhisperEnvelope) => {
    void ext
      .makeRequest('v1.ext.whisper', { data: data as Record<string, unknown> })
      .catch((err: unknown) => reportError('director model whisper failed', { err: String(err) }));
  };

  /** Room whisper + local whisper + SDK host activity (`v1.ext.activity.*`). */
  const relayActivity = (payload: DirectorActivityBroadcast) => {
    // Stamp the per-kind display duration once on the envelope so every consumer
    // (chiefly the model's right-overlay activity badge) renders a consistent timer.
    const enriched: DirectorActivityBroadcast =
      payload.durationMs !== undefined
        ? payload
        : {
            ...payload,
            durationMs: durationMsForDirectorActivity(
              payload.kind,
              settings.commandDurationSec,
            ),
          };
    // Keep a small backfill buffer so viewers whose decorative iframe was not
    // mounted when this event broadcasted can pick it up on their next state
    // sync (see `buildPublicState`).
    state.recentActivities = [enriched, ...state.recentActivities]
      .filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
      .slice(0, 12);
    void ext
      .makeRequest('v1.ext.whisper', { data: enriched as Record<string, unknown> })
      .catch((err: unknown) =>
        reportError('director activity whisper (room) failed', { err: String(err) }),
      );
    void ext
      .makeRequest('v1.ext.whisper.local', { data: enriched as Record<string, unknown> })
      .catch((err: unknown) =>
        reportError('director activity whisper.local failed', { err: String(err) }),
      );
    // Re-broadcast after the host-activity slot has been granted so the freshly
    // mounted decorative-overlay iframe (which didn't exist when the first whisper
    // fired) actually receives the event. Existing iframes dedupe by activity `id`.
    void claimHostActivityForEvent(
      ext,
      hostActivitySlot,
      enriched.kind,
      settings.commandDurationSec,
      reportError,
    ).then(() => {
      setTimeout(() => {
        void ext
          .makeRequest('v1.ext.whisper', { data: enriched as Record<string, unknown> })
          .catch((err: unknown) =>
            reportError('director activity whisper (replay) failed', { err: String(err) }),
          );
      }, 800);
    });
  };

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
    const actor = { userId: user.id, username: user.name };
    if (reason === 'liveStart') {
      appendActivity(`We're LIVE — Director: ${user.name}`, 'spotlight');
      // Chat lines are emitted by the caller AFTER the tip chat so the order
      // reads naturally: tip → unlock notice → new Director.
    } else if (reason === 'overtake') {
      appendActivity(`New Director: ${user.name}`, 'spotlight');
      sendChatAtoms(['took', 'the', '{#accent}Director seat{/accent}'], actor);
    }
  };

  const syncLeadership = (
    triggerUserId: string | null,
    /**
     * Caller knows the same input event will already produce a stronger /
     * more specific overlay banner (e.g. `menu_goal_complete` when the
     * triggering tip also closed a menu line). Setting this skips the
     * generic `control_unlock` banner so viewers don't see two stacked
     * announcements about the same moment.
     */
    suppressUnlockActivity = false,
  ) => {
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
      if (!suppressUnlockActivity) {
        relayActivity({
          type: 'director.activity',
          id: `live_${Date.now()}`,
          at: Date.now(),
          kind: 'control_unlock',
          directorName: state.director.name,
          preproductionGoal: settings.preproductionGoal,
        });
      }
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
      });
  };

  const clearItemAllocations = (itemId: string) => {
    Object.values(state.users).forEach((user) => {
      if (user.allocations[itemId]) {
        delete user.allocations[itemId];
      }
    });
  };

  const checkMenuGoalCompletions = () => {
    for (const g of deriveGoals()) {
      if (g.price <= 0 || g.progress < g.price) continue;
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
      // Two distinct chat lines depending on who paid for the line:
      //   - exactly one tipper paid the whole price → attribute to them
      //     ("CurveyZeal | bought 'Cum'") so it reads as their solo purchase.
      //   - multiple tippers chipped in → anonymous "Room filled 'Cum'"
      //     notice, so no single contributor gets the credit.
      const soloBuyer =
        contributors.length === 1 && contributors[0]!.amount >= g.price
          ? contributors[0]!
          : null;
      if (soloBuyer) {
        sendChatAtoms(['bought', `{#accent}"${g.title}"{/accent}`], {
          userId: soloBuyer.userId,
          username: soloBuyer.name,
        });
      } else {
        sendChatAtoms(['Room', 'filled', `{#accent}"${g.title}"{/accent}`]);
      }
      clearItemAllocations(g.id);
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
      sessionContributors: Object.values(state.users)
        .filter((u) => u.total > 0)
        .map((u) => ({ id: u.id, name: u.name, total: u.total }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        .slice(0, 16),
      // Trim to events whose display duration hasn't expired yet so viewers
      // who just mounted only get current-relevant activities.
      recentActivities: state.recentActivities.filter(
        (a) => a.at + (a.durationMs ?? 6_000) > now,
      ),
      updatedAt: now,
    };
  };

  const broadcastState = () => {
    safeBroadcast(buildPublicState());
    schedulePersist();
  };

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersist = () => {
    if (persistTimer) return; // already scheduled
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const users: PersistedGameState['users'] = Object.values(state.users).map((u) => ({
        id: u.id,
        name: u.name,
        total: u.total,
        allocations: { ...u.allocations },
      }));
      void saveGameState(ext, {
        version: 1,
        gameAccepting: state.gameAccepting,
        isLive: state.isLive,
        totalSessionTips: state.totalSessionTips,
        director: { ...state.director },
        challenger: { ...state.challenger },
        users,
        savedAt: Date.now(),
      });
    }, 2000); // debounce 2s so we don't spam storage on every tick
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

  /**
   * Apply a fully-validated tip to a menu line. Shared between:
   *   - the extension's own UI flow (`director.menu.tip` whisper after a
   *     successful `v1.payment.tokens.spend`), and
   *   - native room tips on the same menu position that we observe via
   *     `v1.tokens.spent` (Stripchat tip menu / chat tip).
   *
   * `source === 'extension'` keeps the original UX (toast back to the spender,
   * extension-authored chat lines, allocations sync). `source === 'native'`
   * suppresses chat lines (the host already prints the native tip in chat) and
   * the per-spender toast (the native tipper isn't viewing through our UI).
   * Either way the room sees `tip_received` / `menu_goal_complete` overlays
   * and the model's panel feed updates.
   */
  const applyMenuLineTip = (params: {
    userId: string;
    username: string;
    item: DirectorMenuItem;
    amount: number;
    /** Unique key for the activity id and the in-memory dedupe set. */
    tipKey: string;
    source: 'extension' | 'native';
  }): boolean => {
    const { item, source } = params;
    const amount = Math.max(0, Math.floor(params.amount));
    if (!amount) return false;

    if (state.seenTransactions.has(params.tipKey)) return false;

    const user = ensureUser(params.userId, params.username);
    if (!user) return false;

    markTransaction(params.tipKey);

    user.total += amount;
    user.allocations[item.id] = (user.allocations[item.id] ?? 0) + amount;
    state.totalSessionTips += amount;

    // Look at the line BEFORE leadership runs — if this tip closes the line
    // we'll let `menu_goal_complete` be the single overlay event for the
    // moment and tell `syncLeadership` to skip the generic `control_unlock`
    // banner that would otherwise stack on top of it.
    const itemTotal = Object.values(state.users).reduce(
      (sum, u) => sum + clampInt(u.allocations?.[item.id], 0),
      0,
    );
    const itemLeft = Math.max(0, item.price - itemTotal);
    const tipClosedLine = itemLeft === 0;

    const wasLive = state.isLive;
    syncLeadership(user.id, tipClosedLine);

    const lineNudge = itemLeft > 0 ? ` · ${itemLeft} tk left` : '';
    const goalNudge = !wasLive && state.isLive ? ' · Director unlocked!' : '';
    appendActivity(
      `${user.name} +${amount}tk → "${item.title}"${lineNudge}${goalNudge}`,
      'success',
    );
    if (source === 'extension') {
      sendToast(user.id, 'success', `Counted: ${amount}tk → "${item.title}"`);
    }

    // Three mutually-exclusive cases for both the chat AND the overlay notice:
    //   1. Tip didn't close the menu line → broadcast `tip_received` + emit
    //      partial-tip chat.
    //   2. Tip closed the line alone → `checkMenuGoalCompletions` broadcasts
    //      `menu_goal_complete` with sole contributor + emits `bought "X"`.
    //   3. Tip closed the line with help → `menu_goal_complete` with multiple
    //      contributors + anonymous `Room filled "X"`.
    // Skip the `tip_received` broadcast when the line closes — otherwise
    // viewers see "X tipped …" followed by "X bought …" / "Room filled …"
    // back-to-back. Only one notification per logical event.
    if (!tipClosedLine) {
      relayActivity({
        type: 'director.activity',
        id: `tip_${params.tipKey}`,
        at: Date.now(),
        kind: 'tip_received',
        itemId: item.id,
        itemTitle: item.title,
        price: item.price,
        amount,
        issuedByName: user.name,
        preproductionGoal: settings.preproductionGoal,
      });
    }
    checkMenuGoalCompletions();

    if (source === 'extension' && !tipClosedLine) {
      sendChatAtoms(
        [
          'tipped',
          `{#accent}${amount} tk{/accent}`,
          '→',
          `{#accent}${item.title}{/accent}`,
          `{#fade}· ${itemLeft} tk left{/fade}`,
        ],
        { userId: user.id, username: user.name },
      );
    }
    // If this tip just unlocked Director Control, emit an unlock notice +
    // the new Director attribution. These have different authors (anonymous
    // vs. the new director), so they have to stay as separate chat lines.
    if (!wasLive && state.isLive) {
      sendChatAtoms(['Director', 'unlocked', '—', "we're", 'LIVE']);
      if (state.director.id) {
        sendChatAtoms(['is', 'Director'], {
          userId: state.director.id,
          username: state.director.name,
        });
      }
    }
    sendSelfAllocations(user.id);
    broadcastState();
    return true;
  };

  const handleMenuTip = (envelope: Extract<WhisperEnvelope, { type: 'director.menu.tip' }>) => {
    const payment = validatePayment(envelope.paymentData, envelope.amount, envelope.userId);
    if (!payment) return;

    const item = state.menu.find((m) => m.id === envelope.itemId) ?? state.menu[0];
    if (!item) {
      sendToast(envelope.userId, 'warn', 'No tip menu items available right now');
      return;
    }

    applyMenuLineTip({
      userId: envelope.userId,
      username: envelope.username,
      item,
      amount: envelope.amount,
      tipKey: payment.transactionId,
      source: 'extension',
    });
  };

  /**
   * Map a tip we observed via `v1.tokens.spent` to one of our menu lines.
   * Stripchat's tip-menu source puts the activity name in `tipData.message`,
   * so we match on title (case-insensitive). If that fails, we fall back to
   * picking a uniquely-priced item — useful when the host strips the message
   * or when the model's tip menu uses prices that happen to be 1:1.
   */
  const matchMenuItemForNativeTip = (
    message: string | undefined,
    amount: number,
  ): DirectorMenuItem | null => {
    const trimmed = String(message || '').trim().toLowerCase();
    if (trimmed) {
      const byTitle = state.menu.find(
        (m) => m.title.trim().toLowerCase() === trimmed,
      );
      if (byTitle) return byTitle;
    }
    const byPrice = state.menu.filter(
      (m) => m.price === amount || m.basePrice === amount,
    );
    if (byPrice.length === 1) return byPrice[0]!;
    return null;
  };

  const handleNativeTip = (payload: TEvents['v1.tokens.spent']) => {
    const tipData = payload.tipData;
    // Tips initiated by *this* extension already flow through the whisper
    // pipeline (`handleMenuTip`); the same payment also re-emits as
    // `v1.tokens.spent` with `isOriginalSource === true`, so we skip those
    // here to avoid double-counting.
    if (tipData.isOriginalSource) return;
    // Only tips the host explicitly bound to a menu position are unambiguous
    // enough to attribute. Other sources (console, fullscreen, generic
    // sendTipButton, etc.) can't be reliably mapped to a line.
    if (tipData.source !== 'tipMenu') return;

    const amount = Math.max(0, Math.floor(Number(tipData.amount) || 0));
    if (!amount) return;

    const item = matchMenuItemForNativeTip(tipData.message, amount);
    if (!item) {
      void ext
        .makeRequest('v1.monitoring.report.log', {
          message: 'director: native tipMenu tip could not be matched to a menu line',
          data: { message: tipData.message ?? null, amount, tipId: tipData.id },
        })
        .catch(() => undefined);
      return;
    }

    // Identity: logged-in tippers keep their stable id. Anonymous tippers get
    // a per-tip synthetic id so they don't all collapse onto the same bucket
    // (which would otherwise pile every anonymous tip onto a single allocation
    // and a single Director-seat contender).
    const tipUser = tipData.user ?? null;
    const isLoggedIn = Boolean(tipUser && !tipUser.isGuest);
    const userId = isLoggedIn
      ? String((tipUser as Extract<TV1ExtUser, { isGuest: false }>).id)
      : `anon_${tipData.id}`;
    const username = isLoggedIn
      ? String((tipUser as Extract<TV1ExtUser, { isGuest: false }>).username || 'viewer')
      : tipData.isAnonymous
        ? 'Anonymous'
        : 'Guest';

    applyMenuLineTip({
      userId,
      username,
      item,
      amount,
      tipKey: tipData.id,
      source: 'native',
    });
  };

  const handleChairChase = (envelope: Extract<WhisperEnvelope, { type: 'director.chair.chase' }>) => {
    const payment = validatePayment(envelope.paymentData, envelope.amount, envelope.userId);
    if (!payment) return;

    const amount = Math.max(0, Math.floor(envelope.amount));
    if (amount <= 0) return;

    const user = ensureUser(envelope.userId, envelope.username);
    if (!user) return;

    markTransaction(payment.transactionId);

    // Always credit the payment so the chaser never silently loses tokens to
    // a race with concurrent tips, an active tenure window, or a stale UI.
    // Chair-chase tokens count toward session totals and the user's running
    // total (used for seat math) but are deliberately NOT applied to any menu
    // line's allocation — they're seat-takeover money, not a menu tip, so they
    // must not show up as a goal contribution or trigger goal completion.
    user.total += amount;
    state.totalSessionTips += amount;

    const wasLive = state.isLive;
    const previousDirectorId = state.director.id;
    syncLeadership(user.id);
    const tookSeat = state.director.id === user.id && previousDirectorId !== user.id;
    // When a chase pays enough to unlock the room AND seat the chaser in one
    // shot (the new "Become Director" direct-buy flow), `syncLeadership`
    // already broadcasts a `control_unlock` activity. Suppress the
    // `chair_chase_takeover` follow-up so viewers don't see two overlapping
    // hero banners about the same moment.
    const liveJustStarted = !wasLive && state.isLive;

    if (tookSeat) {
      appendActivity(`${user.name} +${amount}tk → Director chase`, 'success');
      sendToast(user.id, 'success', `${amount}tk toward the Director seat`);
      // Short line — `setDirector(reason='overtake')` (triggered by
      // syncLeadership above) already emits a second attributed
      // "took the Director seat" message, so the chaser ends up with two
      // tidy lines instead of one long combined one.
      sendChatAtoms(['tipped', `{#accent}${amount} tk{/accent}`], {
        userId: envelope.userId,
        username: envelope.username,
      });
      if (!liveJustStarted) {
        relayActivity({
          type: 'director.activity',
          // Deterministic id from transactionId so the chaser's iframe dedupes
          // this event against the one their viewerBackground already broadcast.
          id: `chase_${payment.transactionId}`,
          at: Date.now(),
          kind: 'chair_chase_takeover',
          issuedByName: user.name,
          directorName: state.director.name,
        });
      }
    } else if (state.director.id === user.id) {
      sendToast(user.id, 'info', `${amount}tk credited — you already hold the seat`);
    } else {
      const stillNeed = chairCatchUpTokens(
        state.director.total,
        settings.overtakeMargin,
        user.total,
      );
      const tenureLeft = state.director.startedAt
        ? Math.max(0, state.director.startedAt + settings.minTenureSec * 1000 - Date.now())
        : 0;
      if (tenureLeft > 0) {
        sendToast(
          user.id,
          'info',
          `${amount}tk credited — Director safe ${Math.ceil(tenureLeft / 1000)}s more`,
        );
      } else if (stillNeed > 0) {
        sendToast(user.id, 'info', `${amount}tk credited — ${stillNeed}tk more to take the seat`);
      } else {
        sendToast(user.id, 'info', `${amount}tk credited`);
      }
    }

    sendSelfAllocations(user.id);
    broadcastState();
  };

  /**
   * Apply a single move record drained from `v1.storage`. The viewer already
   * paid for the original tip, so this is just a state shuffle — no payment
   * validation, just sanity checks against the user's existing allocations.
   * Returns true when the record applied (state mutated).
   */
  const applyMoveRecord = (record: {
    txnId: string;
    userId: string;
    username: string;
    fromItemId: string;
    toItemId: string;
    amount: number;
  }): boolean => {
    const fromId = String(record.fromItemId || '').trim();
    const toId = String(record.toItemId || '').trim();
    const amount = Math.max(0, Math.floor(record.amount));
    const userId = String(record.userId || '').trim();

    console.log('[director-apply] checking move record', {
      txnId: record.txnId,
      fromId,
      toId,
      amount,
      userId,
    });

    if (!fromId || !toId || fromId === toId || !amount) {
      console.log('[director-apply] validation failed - invalid ids/amount');
      reportError('director: move record validation failed', {
        txnId: record.txnId,
        fromId,
        toId,
        amount,
      });
      return false;
    }

    const user = state.users[userId];
    if (!user) {
      console.log('[director-apply] user not found', { userId });
      reportError('director: move user not found in state', {
        txnId: record.txnId,
        userId,
        username: record.username,
      });
      return false;
    }

    const fromItem = state.menu.find((m) => m.id === fromId);
    const toItem = state.menu.find((m) => m.id === toId);
    if (!fromItem || !toItem) {
      console.log('[director-apply] menu items not found', { fromId, toId, menuIds: state.menu.map((m) => m.id) });
      reportError('director: move menu items not found', {
        txnId: record.txnId,
        fromId,
        toId,
      });
      sendToast(user.id, 'warn', 'One of the menu positions is no longer available');
      return false;
    }

    const available = clampInt(user.allocations[fromId], 0);
    console.log('[director-apply] checking funds', { available, requested: amount });
    if (available < amount) {
      console.log('[director-apply] insufficient funds');
      reportError('director: move insufficient funds', {
        txnId: record.txnId,
        userId,
        fromId,
        available,
        requested: amount,
      });
      return false;
    }

    user.allocations[fromId] = available - amount;
    if (user.allocations[fromId] <= 0) delete user.allocations[fromId];
    user.allocations[toId] = (user.allocations[toId] ?? 0) + amount;

    console.log('[director-apply] move applied successfully', {
      txnId: record.txnId,
      userId,
      fromId,
      toId,
      amount,
    });

    appendActivity(
      `${user.name} moved ${amount}tk: "${fromItem.title}" → "${toItem.title}"`,
      'info',
    );
    reportError('director: move applied successfully', {
      txnId: record.txnId,
      userId,
      fromId,
      toId,
      amount,
    });
    sendToast(user.id, 'success', `Reallocated ${amount}tk`);
    return true;
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
    // Deterministic id derived from the unique transactionId so the viewer's
    // own `handleWhispered` (which receives this same event back from the
    // model's room whisper) dedupes against the activity already in flight
    // and does not re-claim the host activity slot.
    const entry: DirectorPerformance = {
      id: `cmd_${payment.transactionId}`,
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

    const willStartImmediately = !state.currentPerformance;
    if (willStartImmediately) {
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
    // Only fire the decorative `command_start` when this command is actually
    // starting now. For queued commands the `tick` handler broadcasts the
    // same id when it dequeues, so iframes get exactly one notification at
    // the moment the cue truly begins on stream.
    if (willStartImmediately) {
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
    }
    sendChatAtoms(
      ['called', command.emoji, `{#accent}${command.label}{/accent}`],
      { userId: envelope.userId, username: envelope.username },
    );

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
    state.totalSessionTips = 0;
    state.director = { id: null, name: 'Open seat', total: 0, startedAt: 0 };
    state.challenger = { id: null, name: 'No chase yet', total: 0 };
    state.users = {};
    state.currentPerformance = null;
    state.queue = [];
    state.commandHistory = [];
    state.commandCooldowns = {};
    state.flashAt = 0;
    state.activityFeed = [];
    state.seenTransactions = new Set();
    state.seenMoveTxnIds = new Set();
    state.drainingMoves = false;
    void clearGameState(ext);
    void clearHostActivity(ext, hostActivitySlot);
    appendActivity('Model paused Director game', 'info');
    relayActivity({
      type: 'director.activity',
      id: `paused_${Date.now()}`,
      at: Date.now(),
      kind: 'game_paused',
      preproductionGoal: settings.preproductionGoal,
    });
    // Single chat message — atoms split by newlines render as separate rows.
    sendChatAtoms([
      'Director game paused.',
      '{#fade}Menu tips still stack.{/fade}',
    ]);
    broadcastState();
  };

  const resumeGameRound = () => {
    state.gameAccepting = true;
    appendActivity('Model started Director game', 'info');
    relayActivity({
      type: 'director.activity',
      id: `started_${Date.now()}`,
      at: Date.now(),
      kind: 'game_started',
      preproductionGoal: settings.preproductionGoal,
    });
    sendChatAtoms([
      'Director game started.',
      'Reach the {#accent}unlock goal{/accent} to release the remote.',
      '{#fade}Top spender becomes Director.{/fade}',
    ]);
    syncLeadership(null);
    broadcastState();
  };

  const handleWhispered = (data: TEvents['v1.ext.whispered']) => {
    if (!isWhisperEnvelope(data)) return;
    if (data.type === 'director.activity') {
      return;
    }
    if (data.type === 'director.chat.message') {
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
      // Reallocations now flow through `v1.storage` (drained on tick); the
      // legacy whisper envelope is ignored for backward compatibility.
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

  /**
   * Pull any move records the viewer slot pushed via `submitMove` and apply
   * them. Runs as a fire-and-forget alongside the regular sync tick; a single
   * `drainingMoves` flag prevents re-entry while a previous drain is in flight.
   */
  const drainMovesTick = () => {
    if (state.drainingMoves) {
      console.log('[director-tick] drain already in progress, skipping');
      return;
    }
    state.drainingMoves = true;
    console.log('[director-tick] drain tick started');
    
    void (async () => {
      try {
        const records = await drainMoves(ext, state.seenMoveTxnIds, reportError);
        console.log('[director-tick] drainMoves returned', { recordCount: records.length });
        
        if (!records.length) {
          console.log('[director-tick] no new records to process');
          return;
        }

        console.log('[director-tick] processing records', {
          count: records.length,
          records: records.map((r) => ({ txnId: r.txnId, userId: r.userId, amount: r.amount })),
        });

        const touchedUserIds = new Set<string>();
        let appliedAny = false;
        for (const record of records) {
          state.seenMoveTxnIds.add(record.txnId);
          const applied = applyMoveRecord(record);
          console.log('[director-tick] apply result', { txnId: record.txnId, applied });
          if (applied) {
            touchedUserIds.add(String(record.userId));
            appliedAny = true;
          }
        }

        // Cap the seen set so it doesn't grow unbounded across long sessions.
        if (state.seenMoveTxnIds.size > 500) {
          const arr = Array.from(state.seenMoveTxnIds);
          state.seenMoveTxnIds = new Set(arr.slice(arr.length - 250));
        }

        if (!appliedAny) {
          console.log('[director-tick] no moves applied, skipping state update');
          return;
        }

        console.log('[director-tick] updating state for users', { userIds: Array.from(touchedUserIds) });

        // Refresh derived state for affected users. user.total is session-lifetime
        // tips — it must not be recomputed from allocations because completed
        // menu goals call clearItemAllocations() (history is intentionally not
        // kept in user.allocations). Moves only shuffle allocations between
        // items and never add new tokens, so user.total stays correct as-is.
        for (const uid of touchedUserIds) {
          if (!state.users[uid]) continue;
          sendSelfAllocations(uid);
        }
        if (state.isLive) syncLeadership(null);
        checkMenuGoalCompletions();
        broadcastState();
        console.log('[director-tick] state updated and broadcast');
      } catch (err) {
        console.error('[director-tick] drain error', { err });
      } finally {
        state.drainingMoves = false;
        console.log('[director-tick] drain tick completed');
      }
    })();
  };

  const tick = () => {
    drainMovesTick();
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

    // Restore persisted game state — survives model page refresh.
    // Only pauseGameRound (Stop Goal) clears this.
    try {
      const saved = await loadGameState(ext);
      if (saved && saved.gameAccepting) {
        state.gameAccepting = saved.gameAccepting;
        state.isLive = saved.isLive;
        state.totalSessionTips = saved.totalSessionTips;
        state.director = { ...saved.director };
        state.challenger = { ...saved.challenger };
        // Re-hydrate user allocations
        for (const u of saved.users) {
          if (!u.id) continue;
          state.users[u.id] = {
            id: u.id,
            name: u.name,
            total: u.total,
            allocations: { ...u.allocations },
          };
        }
        void ext
          .makeRequest('v1.monitoring.report.log', {
            message: 'director: restored game state from storage',
            data: { userCount: saved.users.length, isLive: saved.isLive, savedAt: saved.savedAt },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      reportError('director: failed to restore game state', { err: String(err) });
    }

    ext.subscribe('v1.ext.whispered', handleWhispered);
    ext.subscribe('v1.payment.tokens.spend.succeeded', relayChairChaseSpendFromModelClient);
    ext.subscribe('v1.tipMenu.updated', handleTipMenuUpdated);
    ext.subscribe('v1.ext.context.updated', handleContextUpdated);
    ext.subscribe('v1.ext.activity.busy', handleActivityBusy);
    ext.subscribe('v1.ext.activity.available', handleActivityAvailable);
    ext.subscribe('v1.tokens.spent', handleNativeTip);

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
    ext.unsubscribe('v1.tokens.spent', handleNativeTip);
    void clearHostActivity(ext, hostActivitySlot);
  };
};
