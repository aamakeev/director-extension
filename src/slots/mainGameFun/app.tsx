import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { AppSelect } from '../../shared/AppSelect';
import { chairCatchUpTokens, unlockDirectorBuyTokens } from '../../shared/chairBite';
import { COMMAND_GROUPS } from '../../shared/commands';
import { contributorColorAt } from '../../shared/contributorColors';
import { formatRemaining } from '../../shared/format';
import { userIdString, usernameString, whisperSelfId } from '../../shared/role';
import { submitMove } from '../../shared/movesStorage';
import { directorExt, useDirectorClient } from '../../shared/useDirectorState';
import { DEFAULT_SETTINGS, normalizeSettings, type DirectorSettings } from '../../shared/settings';
import {
  GOAL_FIELD,
  MARKUP_FIELD,
  REMOTE_FIELDS,
  SPOTLIGHT_FIELDS,
} from '../../shared/settingsFields';
import type {
  DirectorActivityBroadcast,
  DirectorMenuGoal,
  DirectorPublicState,
} from '../../shared/state';
import { UNLOCK_DEMO_NAMES, chipDemoFromTotal } from '../../shared/unlockDemoChips';

const TIP_PRESET_LADDER = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

/**
 * Pick up to 3 round preset amounts that are strictly less than `tokensLeft`,
 * so we never offer a tip that would overshoot the goal. The "Fill" CTA already
 * matches the exact remainder, so presets stay strictly below it.
 *
 *   tokensLeft = 50  → [10, 25]   (50 itself is the Fill button)
 *   tokensLeft = 8   → [1, 5]
 *   tokensLeft = 1   → []         (only Fill makes sense)
 */
const buildSmartPresets = (tokensLeft: number): number[] => {
  if (tokensLeft <= 1) return [];
  const candidates = TIP_PRESET_LADDER.filter((n) => n < tokensLeft);
  return candidates.slice(-3);
};

/** Panel duration after `menu_goal_complete` so every client sees the same message window. */
const MENU_GOAL_CELEBRATION_MS = 12_000;

/** Fields shown on the model's inline panel. Source of truth lives in `shared/settingsFields.ts`. */
const MODEL_SETTING_FIELDS = [MARKUP_FIELD, ...REMOTE_FIELDS, ...SPOTLIGHT_FIELDS];

const settingsToForm = (settings: DirectorSettings): Record<keyof DirectorSettings, string> => ({
  tipMenuMarkupPercent: String(settings.tipMenuMarkupPercent),
  preproductionGoal: String(settings.preproductionGoal),
  overtakeMargin: String(settings.overtakeMargin),
  minTenureSec: String(settings.minTenureSec),
  commandDurationSec: String(settings.commandDurationSec),
  commandCooldownSec: String(settings.commandCooldownSec),
  commandCostTokens: String(settings.commandCostTokens),
});

/** Park the caret at the end of the input's current value once focus settles. */
const caretToEnd = (input: HTMLInputElement | null) => {
  if (!input) return;
  requestAnimationFrame(() => {
    const len = input.value.length;
    try {
      input.setSelectionRange(len, len);
    } catch {
      // Some input types (e.g. number) refuse setSelectionRange — ignore.
    }
  });
};

const safeAmount = (raw: string): number => {
  const num = Math.floor(Number(raw));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(num, 100_000);
};

const DirectorMenuPreview = ({
  goal,
  moreCount,
}: {
  goal: DirectorMenuGoal;
  moreCount: number;
}) => {
  return (
    <div class="pricing-anim pricing-anim--static" aria-hidden="true">
      <div class="pricing-anim-top">
        <span class="pa-item">{goal.title}</span>
        <div class="pa-compare">
          {goal.basePrice < goal.price ? (
            <>
              <span class="pa-base">{goal.basePrice} tk</span>
              <span class="pa-arrow" aria-hidden="true">
                →
              </span>
              <span class="pa-director">{goal.price} tk</span>
            </>
          ) : (
            <span class="pa-flat">{goal.price} tk</span>
          )}
        </div>
      </div>
      {moreCount > 0 && (
        <p class="pa-more">
          +{moreCount} more line{moreCount > 1 ? 's' : ''} · markup applied to all
        </p>
      )}
    </div>
  );
};

/** Static preview: same pool, many small tips (matches settings mental model). */
const UnlockContributorDemo = ({
  goalTk,
  fillPercent,
}: {
  goalTk: number;
  fillPercent: number;
}) => {
  const G = Math.max(10, Math.floor(goalTk)) || 10;
  const c = chipDemoFromTotal(G);
  const pct = Math.min(100, Math.max(0, fillPercent));
  return (
    <div class="uc-demo" data-uc-chips={String(c.chipSteps)}>
      <div class="uc-demo-row">
        <span class="uc-demo-label">Unlock bar</span>
        <span class="uc-demo-tk">{G} tk</span>
      </div>
      <div class="uc-demo-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div class="uc-demo-chips">
        <span class="uc-chip">
          <span class="uc-chip-n">{UNLOCK_DEMO_NAMES[0]}</span>
          <span class="uc-chip-a">+{c.tipA}</span>
        </span>
        {c.tipB > 0 ? (
          <span class="uc-chip">
            <span class="uc-chip-n">{UNLOCK_DEMO_NAMES[1]}</span>
            <span class="uc-chip-a">+{c.tipB}</span>
          </span>
        ) : null}
        {c.tipC > 0 ? (
          <span class="uc-chip">
            <span class="uc-chip-n">{UNLOCK_DEMO_NAMES[2]}</span>
            <span class="uc-chip-a">+{c.tipC}</span>
          </span>
        ) : null}
      </div>
      <p class="uc-demo-presets muted small">10 · 25 · 50 · 100+ tk</p>
    </div>
  );
};

export const App = () => {
  const client = useDirectorClient();
  const { context, role, state, selfAllocations, toasts, dismissToast, pushToast, activityInbox } =
    client;
  const [tipBusy, setTipBusy] = useState<string>('');
  const [cmdBusy, setCmdBusy] = useState<string>('');
  const [reallocBusy, setReallocBusy] = useState<string>('');
  const [gameBusy, setGameBusy] = useState<'start' | 'stop' | ''>('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [modelSettingsForm, setModelSettingsForm] = useState<Record<keyof DirectorSettings, string>>(
    settingsToForm(DEFAULT_SETTINGS),
  );
  const [biteBusy, setBiteBusy] = useState(false);
  const [unlockBuyBusy, setUnlockBuyBusy] = useState(false);
  const [actFlash, setActFlash] = useState(false);
  const lastActId = useRef('');
  const goalInputRef = useRef<HTMLInputElement>(null);

  // Cross-slot activity broadcast (menu goal, LIVE unlock, command) — subtle shell pulse.
  useEffect(() => {
    const last = activityInbox[activityInbox.length - 1];
    if (!last || last.id === lastActId.current) return;
    lastActId.current = last.id;
    setActFlash(true);
    const t = window.setTimeout(() => setActFlash(false), 520);
    return () => window.clearTimeout(t);
  }, [activityInbox]);

  useEffect(() => {
    let cancelled = false;
    void directorExt
      .makeRequest('v1.ext.settings.get', null)
      .then((res) => {
        if (cancelled) return;
        setModelSettingsForm(settingsToForm(normalizeSettings(res.settings)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const meId = userIdString(context.user);
  const selfWhisperId = whisperSelfId(context.user);
  const meName = usernameString(context.user);
  const isModel = role === 'model';
  const isGuest = role === 'guest';
  const isDirector = Boolean(
    state?.isLive && state?.director?.id && String(state.director.id) === String(selfWhisperId),
  );
  const goals = state?.menuGoals ?? [];
  const orderedGoals = useMemo(() => {
    if (isModel) return goals;

    const started = goals.filter((g) => g.progress > 0);

    const nearComplete = started
      .filter((g) => g.tokensLeft <= Math.max(1, Math.ceil(g.price * 0.35)))
      .sort((a, b) => {
        if (a.tokensLeft !== b.tokensLeft) return a.tokensLeft - b.tokensLeft;
        if (a.price !== b.price) return b.price - a.price;
        return 0;
      });

    const startedOnly = started
      .filter((g) => !nearComplete.some((x) => x.id === g.id))
      .sort((a, b) => b.price - a.price);

    const untouched = goals.filter((g) => g.progress <= 0);

    return [...nearComplete, ...startedOnly, ...untouched];
  }, [goals, isModel]);

  /** Pre-show: no SDK menu lines, or no rows yet — explain the single unlock bar + concrete tip sizes. */
  const showUnlockGuide = Boolean(
    state &&
      !state.isLive &&
      (state.menuSource !== 'sdk' || goals.length === 0),
  );

  const { goalCelebrationUntil, latestMenuCompleteByItemId } = useMemo(() => {
    const until: Record<string, number> = {};
    const latest: Partial<Record<string, DirectorActivityBroadcast>> = {};
    for (const e of activityInbox) {
      if (e.type !== 'director.activity' || e.kind !== 'menu_goal_complete' || !e.itemId) continue;
      until[e.itemId] = Math.max(until[e.itemId] ?? 0, e.at + MENU_GOAL_CELEBRATION_MS);
      latest[e.itemId] = e;
    }
    return { goalCelebrationUntil: until, latestMenuCompleteByItemId: latest };
  }, [activityInbox]);

  const [celebrationNow, setCelebrationNow] = useState(() => Date.now());
  const hasActiveMenuCelebration = useMemo(
    () => goals.some((g) => (goalCelebrationUntil[g.id] ?? 0) > celebrationNow),
    [goals, goalCelebrationUntil, celebrationNow],
  );

  useEffect(() => {
    if (!hasActiveMenuCelebration) return;
    const id = window.setInterval(() => setCelebrationNow(Date.now()), 480);
    return () => window.clearInterval(id);
  }, [hasActiveMenuCelebration]);

  const sendTip = async (goalId: string, amount: number) => {
    if (isModel || isGuest || !meId) return;
    if (!amount) return;
    setTipBusy(goalId);
    try {
      await directorExt.makeRequest('v1.payment.tokens.spend', {
        tokensAmount: amount,
        tokensSpendData: {
          kind: 'director.menu.tip',
          itemId: goalId,
          userId: meId,
          username: meName,
        },
      });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Payment cancelled' });
    } finally {
      setTipBusy('');
    }
  };

  const sendMove = async (fromGoalId: string, toGoalId: string, rawAmount: string) => {
    console.log('[viewer-move] sendMove called', { fromGoalId, toGoalId, rawAmount });
    
    if (!meId || isModel || isGuest) {
      console.log('[viewer-move] blocked: not a viewer');
      return;
    }
    const amount = safeAmount(rawAmount);
    if (!fromGoalId || !toGoalId || fromGoalId === toGoalId || !amount) {
      console.log('[viewer-move] validation failed', { fromGoalId, toGoalId, amount });
      pushToast({ tone: 'warn', message: 'Pick a destination and amount' });
      return;
    }
    setReallocBusy(fromGoalId);
    console.log('[viewer-move] calling submitMove', { meId, fromGoalId, toGoalId, amount });
    
    try {
      // Free reallocation via shared host storage. The model background drains
      // this queue on its 1 s tick and applies the change to allocations.
      const result = await submitMove(
        directorExt,
        {
          userId: meId,
          username: meName,
          fromItemId: fromGoalId,
          toItemId: toGoalId,
          amount,
        },
        (message: string, data: unknown) => {
          console.log('[viewer-move] reportError from submitMove', { message, data });
          void directorExt
            .makeRequest('v1.monitoring.report.error', { message, data })
            .catch(() => undefined);
        },
      );
      console.log('[viewer-move] submitMove result', { result });
      
      if (!result.ok) {
        console.log('[viewer-move] submitMove failed');
        pushToast({ tone: 'warn', message: 'Could not move tokens — try again' });
        return false;
      } else {
        console.log('[viewer-move] submitMove succeeded', { txnId: result.txnId });
        return true;
      }
    } catch (_err) {
      console.error('[viewer-move] exception', { err: _err });
      pushToast({ tone: 'warn', message: 'Could not move tokens — try again' });
      return false;
    } finally {
      setReallocBusy('');
    }
  };

  const openSignUp = () => {
    void directorExt.makeRequest('v1.ext.signup.open', { type: 'user' }).catch(() => undefined);
  };

  const updateModelSetting = (key: keyof DirectorSettings, value: string) => {
    setModelSettingsForm((prev) => ({ ...prev, [key]: value }));
  };

  const settingsErrors = useMemo(() => {
    const out: Partial<Record<keyof DirectorSettings, string>> = {};
    [GOAL_FIELD, ...MODEL_SETTING_FIELDS].forEach((field) => {
      const raw = modelSettingsForm[field.key].trim();
      const value = Number(raw);
      if (!raw) {
        out[field.key] = 'Required';
        return;
      }
      if (!Number.isFinite(value) || !Number.isInteger(value)) {
        out[field.key] = 'Whole number';
        return;
      }
      if (value < field.min) {
        out[field.key] = `Min ${field.min}`;
        return;
      }
      if (field.max !== undefined && value > field.max) {
        out[field.key] = `Max ${field.max}`;
      }
    });
    return out;
  }, [modelSettingsForm]);

  const saveModelSettings = async (opts: { silent?: boolean } = {}) => {
    if (!isModel || settingsBusy || Object.keys(settingsErrors).length > 0) return;
    setSettingsBusy(true);
    try {
      const settings = normalizeSettings({
        tipMenuMarkupPercent: Number(modelSettingsForm.tipMenuMarkupPercent),
        preproductionGoal: Number(modelSettingsForm.preproductionGoal),
        overtakeMargin: Number(modelSettingsForm.overtakeMargin),
        minTenureSec: Number(modelSettingsForm.minTenureSec),
        commandDurationSec: Number(modelSettingsForm.commandDurationSec),
        commandCooldownSec: Number(modelSettingsForm.commandCooldownSec),
        commandCostTokens: Number(modelSettingsForm.commandCostTokens),
      });

      await directorExt.makeRequest('v1.model.ext.settings.set', {
        settings,
        isError: false,
      });
      await directorExt.makeRequest('v1.ext.whisper.local', {
        data: { type: 'director.settings.updated' },
      });
      setModelSettingsForm(settingsToForm(settings));
      if (!opts.silent) pushToast({ tone: 'success', message: 'Settings updated' });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Could not save settings' });
    } finally {
      setSettingsBusy(false);
    }
  };

  const sendCommand = async (commandId: string) => {
    if (!state || !state.isLive || !isDirector || cmdBusy || !meId || isModel || isGuest) return;
    setCmdBusy(commandId);
    try {
      await directorExt.makeRequest('v1.payment.tokens.spend', {
        tokensAmount: state.commandCostTokens,
        tokensSpendData: {
          kind: 'director.command.issue',
          commandId,
          userId: meId,
          username: meName,
        },
      });
      // If running in the mocks playground and window.mockBus exists, emit a mock overlay notification
      if (typeof window !== 'undefined' && (window as any).mockBus) {
        (window as any).mockBus.emit('v1.ext.whispered', {
          type: 'director.activity',
          id: `cmd_${Date.now()}`,
          at: Date.now(),
          kind: 'command_start',
          label: commandId,
          emoji: '🎬',
          issuedByName: meName,
        });
      }
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Payment cancelled' });
    } finally {
      setCmdBusy('');
    }
  };

  const sendChairBite = async () => {
    if (!state || !meId || isGuest || isModel || isDirector || biteBusy) return;
    const n = chairCatchUpTokens(
      state.director.total,
      state.overtakeMargin,
      selfAllocations.total,
    );
    if (n <= 0) return;
    setBiteBusy(true);
    try {
      await directorExt.makeRequest('v1.payment.tokens.spend', {
        tokensAmount: n,
        tokensSpendData: {
          kind: 'director.chair.chase',
          userId: meId,
          username: meName,
        },
      });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Payment cancelled' });
    } finally {
      setBiteBusy(false);
    }
  };

  /**
   * Pre-live direct-buy path: pay the full unlock goal in one shot to bypass
   * the tip menu, instantly putting the room in Live mode with this viewer
   * seated as Director. Goes through the same `director.chair.chase` spend
   * intent as the post-live overtake — the model's handler already credits
   * `user.total += amount` and triggers `syncLeadership`, so paying exactly
   * `preproductionGoal` is enough to flip `isLive=true` and promote this user.
   */
  const sendUnlockBuy = async (amount: number) => {
    if (!state || !meId || isGuest || isModel || isDirector || unlockBuyBusy) return;
    if (state.isLive || !state.gameAccepting) return;
    const safeAmt = Math.max(1, Math.floor(amount));
    setUnlockBuyBusy(true);
    try {
      await directorExt.makeRequest('v1.payment.tokens.spend', {
        tokensAmount: safeAmt,
        tokensSpendData: {
          kind: 'director.chair.chase',
          userId: meId,
          username: meName,
        },
      });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Payment cancelled' });
    } finally {
      setUnlockBuyBusy(false);
    }
  };

  const sendGameToggle = async (mode: 'start' | 'stop') => {
    if (!isModel || gameBusy) return;
    const modelId = String(context.model?.id ?? meId ?? '');
    if (!modelId) return;
    setGameBusy(mode);
    try {
      await directorExt.makeRequest('v1.ext.whisper', {
        data:
          mode === 'start'
            ? { type: 'director.game.start', modelId }
            : { type: 'director.game.stop', modelId },
      });
      pushToast({
        tone: 'success',
        message: mode === 'start' ? 'Game on — viewers can unlock Director mode' : 'Game paused',
      });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Could not update game' });
    } finally {
      setGameBusy('');
    }
  };

  if (!state) {
    return (
      <div class="menu-shell">
        <section class="menu-card menu-card--loader">
          <div class="loader" role="status" aria-live="polite">
            <span class="loader-dots" aria-hidden="true">
              <span class="loader-dot" />
              <span class="loader-dot" />
              <span class="loader-dot" />
            </span>
            <span class="loader-text">Connecting…</span>
          </div>
        </section>
      </div>
    );
  }

  const sessionPercent = Math.min(
    100,
    (state.totalSessionTips / Math.max(1, state.preproductionGoal)) * 100,
  );

  const tenureActive =
    state.isLive && Boolean(state.director.id) && state.directorTenureLeftMs > 0;
  const openChairRace =
    state.isLive && Boolean(state.director.id) && !state.directorTenureLeftMs;
  const biteNeed =
    openChairRace && !isGuest && !isDirector && !isModel
      ? chairCatchUpTokens(
          state.director.total,
          state.overtakeMargin,
          selfAllocations.total,
        )
      : 0;
  const chairGuestHint =
    openChairRace && !isModel && isGuest
      ? chairCatchUpTokens(state.director.total, state.overtakeMargin, 0)
      : 0;

  /**
   * Adaptive direct-buy price for the pre-Live "Become Director" button.
   * Reads the live contributor table so the cost is always:
   *   max(remaining-to-unlock, top-other-total + overtakeMargin - my-total).
   * That way the buyer closes the gap to the unlock goal AND comes out as
   * the leading tipper — paying just enough, never the static goal. Guests
   * see a hint using the same math with a zero personal contribution.
   */
  const topOtherTotal = !state.isLive
    ? (state.sessionContributors ?? [])
        .filter((c) => !meId || c.id !== meId)
        .reduce((best, c) => Math.max(best, c.total), 0)
    : 0;
  const unlockBuyCost =
    !state.isLive && state.gameAccepting && !isModel && !isGuest
      ? unlockDirectorBuyTokens({
          preproductionGoal: state.preproductionGoal,
          totalSessionTips: state.totalSessionTips,
          overtakeMargin: state.overtakeMargin,
          mySessionTotal: selfAllocations.total,
          topOtherTotal,
        })
      : 0;
  const unlockBuyGuestHint =
    !state.isLive && state.gameAccepting && !isModel && isGuest
      ? unlockDirectorBuyTokens({
          preproductionGoal: state.preproductionGoal,
          totalSessionTips: state.totalSessionTips,
          overtakeMargin: state.overtakeMargin,
          mySessionTotal: 0,
          topOtherTotal,
        })
      : 0;
  const shieldPct = state.directorTenureLeftMs
    ? Math.max(
        2,
        Math.min(
          100,
          (state.directorTenureLeftMs / Math.max(1, state.minTenureSec * 1000)) * 100,
        ),
      )
    : 0;

  const suppressChallengerMeter =
    openChairRace && !isGuest && !isDirector && !isModel && biteNeed > 0;

  const hasSettingsError = Object.keys(settingsErrors).length > 0;
  const settingsSaveDisabled = settingsBusy || hasSettingsError;

  const launchGoal = async () => {
    if (settingsErrors['preproductionGoal'] || gameBusy) return;
    if (Number(modelSettingsForm['preproductionGoal']) !== state.preproductionGoal) {
      await saveModelSettings({ silent: true });
    }
    void sendGameToggle('start');
  };

  return (
    <div class={`menu-shell${actFlash ? ' menu-shell--act-pulse' : ''}`}>
      {/* ---------- Director Control (remote) ---------- */}
      <section class="menu-card menu-card--remote">
        <DirectorRemoteCard
          state={state}
          isModel={isModel}
          isGuest={isGuest}
          isDirector={isDirector}
          actFlash={actFlash}
          biteBusy={biteBusy}
          biteNeed={biteNeed}
          chairFromZero={chairGuestHint}
          openChairRace={openChairRace}
          tenureActive={tenureActive}
          shieldPct={shieldPct}
          cmdBusy={cmdBusy}
          unlockBuyBusy={unlockBuyBusy}
          unlockBuyCost={unlockBuyCost}
          unlockBuyGuestHint={unlockBuyGuestHint}
          onCommand={sendCommand}
          onSignUp={openSignUp}
          onChairBite={() => void sendChairBite()}
          onUnlockBuy={(amount) => void sendUnlockBuy(amount)}
          suppressChallengerMeter={suppressChallengerMeter}
          meId={meId}
        />
      </section>

      {/* ---------- Model controls ---------- */}
      {isModel && (
      <section class="menu-card status-summary-card">
        {isModel ? (
          <div class="model-inline-controls">
            <div class="model-block">
              <div class="model-block-head">
                <div class="model-block-titles">
                  <h3 class="model-block-title">
                    {state.isLive ? 'Goal reached' : 'Goal'}
                  </h3>
                  <p class="model-block-sub">
                    {state.isLive
                      ? 'Director Control unlocked — viewers compete for the seat'
                      : 'Unlocks Director Control'}
                  </p>
                </div>
              </div>
              <div
                class="model-goal-row"
                onClick={(e) => {
                  if (state.gameAccepting) return;
                  if (e.target !== goalInputRef.current) {
                    goalInputRef.current?.focus();
                  }
                }}
              >
                <span class="model-setting-input-wrap">
                  <input
                    ref={goalInputRef}
                    class={`amount-input compact${settingsErrors['preproductionGoal'] ? ' is-invalid' : ''}${state.gameAccepting ? ' is-locked' : ''}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={modelSettingsForm['preproductionGoal']}
                    disabled={state.gameAccepting}
                    title={
                      state.gameAccepting
                        ? 'Stop the goal to change the unlock target'
                        : undefined
                    }
                    onFocus={(e) => caretToEnd(e.currentTarget as HTMLInputElement)}
                    onInput={(e) =>
                      updateModelSetting(
                        'preproductionGoal',
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                  <span class="model-setting-unit">tk</span>
                </span>
              </div>
              {settingsErrors['preproductionGoal'] ? (
                <span class="model-setting-error">{settingsErrors['preproductionGoal']}</span>
              ) : null}
              <div class="model-launch-row">
                <button
                  type="button"
                  class="primary-btn"
                  disabled={
                    state.gameAccepting ||
                    Boolean(gameBusy) ||
                    Boolean(settingsErrors['preproductionGoal'])
                  }
                  onClick={() => void launchGoal()}
                >
                  {gameBusy === 'start' ? '…' : 'Launch Goal'}
                </button>
                <button
                  type="button"
                  class="danger-btn"
                  disabled={!state.gameAccepting || Boolean(gameBusy)}
                  onClick={() => void sendGameToggle('stop')}
                >
                  {gameBusy === 'stop' ? '…' : 'Stop Goal'}
                </button>
              </div>
            </div>

            <div class="model-block">
              <div class="model-block-head">
                <h3 class="model-block-title">Remote &amp; Director Seat</h3>
              </div>
              <div class="model-settings-grid">
                {MODEL_SETTING_FIELDS.map((field) => (
                  <label class="model-setting" key={field.key}>
                    <span class="model-setting-label">{field.label}</span>
                    <span class="model-setting-input-wrap">
                      <input
                        class={`amount-input compact${settingsErrors[field.key] ? ' is-invalid' : ''}`}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={modelSettingsForm[field.key]}
                        onFocus={(e) => caretToEnd(e.currentTarget as HTMLInputElement)}
                        onInput={(e) =>
                          updateModelSetting(
                            field.key,
                            (e.currentTarget as HTMLInputElement).value,
                          )
                        }
                      />
                      <span class="model-setting-unit">{field.unit}</span>
                    </span>
                    {settingsErrors[field.key] ? (
                      <span class="model-setting-error">{settingsErrors[field.key]}</span>
                    ) : null}
                  </label>
                ))}
              </div>
              <div class="model-block-foot">
                <button
                  type="button"
                  class="primary-btn small"
                  disabled={settingsSaveDisabled}
                  onClick={() => void saveModelSettings()}
                >
                  {settingsBusy ? '…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tenureActive && isModel ? (
          <div class="status-shield">
            <span class="muted small">Director protected from swaps</span>
            <span class="muted small">{formatRemaining(state.directorTenureLeftMs)}</span>
            <div class="bar bar--shield">
              <span style={{ width: `${shieldPct}%` }} />
            </div>
          </div>
        ) : null}
      </section>
      )}

      {/* ---------- Guest sign-up CTA ---------- */}
      {isGuest && (
        <section class="menu-card cta-card">
          <div class="cta-title">Sign in to play</div>
          {state.isLive && chairGuestHint > 0 ? (
            <button class="primary-btn cta-btn" type="button" onClick={openSignUp}>
              Sign up · {chairGuestHint} tk
            </button>
          ) : (
            <>
              <div class="cta-text">
                {goals.length === 0 ? (
                  <>Sign in, then tip <strong>10–100+ tk</strong> on the stream toward the bar above.</>
                ) : showUnlockGuide ? (
                  <>
                    Sign in, then use <strong>+10 … +100</strong> on a line below—they stack on the bar.
                  </>
                ) : (
                  <>Tip a menu line below — highest total becomes Director.</>
                )}
              </div>
              <button class="primary-btn cta-btn" type="button" onClick={openSignUp}>
                Sign up
              </button>
            </>
          )}
        </section>
      )}

      {/* ---------- Tip menu (or empty state) ---------- */}
      <section class="menu-card">
        <div class="section-title">
          <span>
            {isModel
              ? goals.length === 0 && showUnlockGuide
                ? 'Unlock preview'
                : 'Preview'
              : goals.length === 0 && showUnlockGuide
                ? 'Unlock bar'
                : goals.length === 0
                  ? 'Director Menu'
                  : showUnlockGuide
                    ? 'Director Menu · fills unlock'
                    : 'Director Menu'}
          </span>
        </div>

        {goals.length === 0 ? (
          showUnlockGuide ? (
            <UnlockContributorDemo goalTk={state.preproductionGoal} fillPercent={sessionPercent} />
          ) : (
            <div class="empty">
              {isModel
                ? 'No Director Menu lines loaded yet. When your Stripchat tip menu is active, rows appear here so you can see viewer progress.'
                : 'Director Menu is empty. Once the model sets a tip menu, items appear here.'}
            </div>
          )
        ) : isModel ? (
          <DirectorMenuPreview goal={orderedGoals[0]!} moreCount={orderedGoals.length - 1} />
        ) : (
          <div class="goals-list">
            {orderedGoals.map((goal) => {
              // Take the higher of the two signals so the move row shows even if the
              // targeted self-allocations whisper is delayed: broadcast contributors
              // already prove the tip landed.
              const fromSelf = selfAllocations.byItem[goal.id] ?? 0;
              const fromContrib = meId
                ? goal.contributors.find((c) => String(c.userId) === String(meId))?.amount ?? 0
                : 0;
              const youAllocated = Math.max(fromSelf, fromContrib);
              return (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  celebration={
                    (goalCelebrationUntil[goal.id] ?? 0) > celebrationNow
                      ? latestMenuCompleteByItemId[goal.id] ?? null
                      : null
                  }
                  meId={meId}
                  youAllocated={youAllocated}
                  isModel={isModel}
                  isGuest={isGuest}
                  tipBusy={tipBusy === goal.id}
                  onTip={(amt) => sendTip(goal.id, amt)}
                  onSignUp={openSignUp}
                  otherGoals={orderedGoals.filter((g) => g.id !== goal.id)}
                  moveBusy={reallocBusy === goal.id}
                  onMoveSubmit={(toGoalId, amount) => sendMove(goal.id, toGoalId, amount) as Promise<boolean>}
                />
              );
            })}
          </div>
        )}

        {!isModel && selfAllocations.total > 0 && (
          <div class="self-summary">
            You've put {selfAllocations.total} tk on the table this round.
          </div>
        )}
      </section>

      {/* ---------- Toasts ---------- */}
      {toasts.length > 0 && (
        <div class="toast-stack">
          {toasts.map((toast) => (
            <div
              class={`toast ${toast.tone}`}
              key={toast.id}
              role="status"
              onClick={() => dismissToast(toast.id)}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const menuGoalCelebrationCopy = (
  ev: DirectorActivityBroadcast | null,
  fallbackTitle: string,
  fallbackPrice: number,
): { title: string; body: string } => {
  const title =
    ev && ev.type === 'director.activity' && ev.kind === 'menu_goal_complete'
      ? (ev.itemTitle ?? fallbackTitle)
      : fallbackTitle;
  const price =
    ev && ev.type === 'director.activity' && ev.kind === 'menu_goal_complete' && ev.price != null
      ? ev.price
      : fallbackPrice;
  const contributors =
    ev && ev.type === 'director.activity' && ev.kind === 'menu_goal_complete'
      ? (ev.contributors ?? [])
      : [];

  if (contributors.length === 0) {
    return {
      title: 'Goal reached',
      body: `The room fully funded “${title}” (${price} tk). Thanks everyone who tipped.`,
    };
  }
  if (contributors.length === 1) {
    const c = contributors[0]!;
    return {
      title: 'Goal reached',
      body: `${c.name} pushed this line over the top (${price} tk). Thanks to everyone who chipped in on “${title}”.`,
    };
  }
  return {
    title: 'Goal reached',
    body: `${contributors.length} viewers stacked tips to finish “${title}” (${price} tk). This menu goal is complete — thanks everyone.`,
  };
};

/* ---------------- Goal row ---------------- */

const GoalRow = ({
  goal,
  celebration,
  meId,
  youAllocated,
  isModel,
  isGuest,
  tipBusy,
  onTip,
  onSignUp,
  otherGoals,
  moveBusy,
  onMoveSubmit,
}: {
  goal: DirectorMenuGoal;
  /** Present for ~12s after `menu_goal_complete` so all viewers see the same celebration state. */
  celebration: DirectorActivityBroadcast | null;
  meId: string;
  youAllocated: number;
  isModel: boolean;
  isGuest: boolean;
  tipBusy: boolean;
  onTip: (amount: number) => void;
  onSignUp: () => void;
  otherGoals: DirectorMenuGoal[];
  moveBusy: boolean;
  onMoveSubmit: (toGoalId: string, rawAmount: string) => Promise<boolean>;
}) => {
  const smartPresets = useMemo(() => buildSmartPresets(goal.tokensLeft), [goal.tokensLeft]);
  const [custom, setCustom] = useState<string>('');
  const [pulseTick, setPulseTick] = useState(0);
  const lastSeenProgress = useRef(goal.progress);

  // Local move-from-this-line state. Each card owns its own destination + amount.
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState<string>('');
  const [moveAmount, setMoveAmount] = useState<string>('');

  // Auto-collapse the move panel when this line no longer has any allocation.
  useEffect(() => {
    if (youAllocated <= 0 && moveOpen) setMoveOpen(false);
  }, [youAllocated, moveOpen]);

  // Default destination = first other goal; keep `moveTo` valid as the menu changes.
  useEffect(() => {
    if (!otherGoals.length) {
      if (moveTo) setMoveTo('');
      return;
    }
    if (!moveTo || !otherGoals.some((g) => g.id === moveTo)) {
      setMoveTo(otherGoals[0]!.id);
    }
  }, [otherGoals, moveTo]);

  // Default amount = whatever the viewer allocated here, capped down as they spend elsewhere.
  useEffect(() => {
    if (youAllocated <= 0) {
      if (moveAmount) setMoveAmount('');
      return;
    }
    const current = Number(moveAmount);
    if (!moveAmount || !Number.isFinite(current) || current <= 0 || current > youAllocated) {
      setMoveAmount(String(youAllocated));
    }
  }, [youAllocated, moveOpen]);

  useEffect(() => {
    if (goal.progress > lastSeenProgress.current) {
      setPulseTick((n) => n + 1);
      const id = window.setTimeout(() => setPulseTick(0), 700);
      lastSeenProgress.current = goal.progress;
      return () => window.clearTimeout(id);
    }
    lastSeenProgress.current = goal.progress;
    return undefined;
  }, [goal.progress]);

  const cardState =
    goal.percent <= 0
      ? 'idle'
      : goal.percent < 50
        ? 'filling'
        : goal.percent < 100
          ? 'hot'
          : 'full';

  const classes = ['goal', `goal--${cardState}`];
  if (youAllocated > 0) classes.push('is-mine');
  if (celebration) classes.push('goal--celebration');
  if (pulseTick > 0) classes.push('goal--pulse');

  const celebrationCopy = celebration
    ? menuGoalCelebrationCopy(celebration, goal.title, goal.price)
    : null;

  const celebrationContributors =
    celebration && celebration.type === 'director.activity' && celebration.kind === 'menu_goal_complete'
      ? celebration.contributors ?? []
      : [];

  const submitCustom = () => {
    const amt = safeAmount(custom);
    if (!amt) return;
    onTip(amt);
    setCustom('');
  };

  return (
    <div class={classes.join(' ')}>
      {celebrationCopy ? (
        <div class="goal-celebration" role="status" aria-live="polite">
          <span class="goal-celebration-badge" aria-hidden="true">
            ✓
          </span>
          <div class="goal-celebration-copy">
            <span class="goal-celebration-title">{celebrationCopy.title}</span>
            <span class="goal-celebration-body">{celebrationCopy.body}</span>
            {celebrationContributors.length > 0 && (
              <div class="goal-celebration-contributors">
                {celebrationContributors.map((c, i) => (
                  <div key={c.userId} class="goal-celebration-contributor">
                    <span
                      class="goal-celebration-contributor-name"
                      style={{ color: contributorColorAt(i) }}
                    >
                      {c.name}
                    </span>
                    <span class="goal-celebration-contributor-amount">{c.amount} tk</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      <div class="goal-head">
        <span class="goal-name">{goal.title}</span>
        <span class="goal-head-right">
          {youAllocated > 0 && (
            <span class="you-pill" title="Your tips on this goal">
              you · {youAllocated} tk
            </span>
          )}
        </span>
      </div>

      <div class="goal-progress">
        <span class="goal-progress-amount">
          <span class="goal-progress-value">{goal.progress}</span>
          <span class="goal-progress-target">/ {goal.price} tk</span>
        </span>
      </div>
      {goal.progress > 0 ? (
        <div class="goal-progress-track" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, goal.percent))}%` }} />
        </div>
      ) : null}

      {goal.contributors.length > 0 && goal.progress > 0 ? (
        <div class="goal-contrib-line">
          {goal.contributors.map((c, i) => (
            <span key={c.userId}>
              {i > 0 ? <span class="goal-contrib-sep"> · </span> : null}
              <span
                class={`goal-contrib-name${meId && c.userId === meId ? ' is-self' : ''}`}
                style={{ color: contributorColorAt(i) }}
              >
                {c.name} <span class="goal-contrib-amt">{c.amount}</span>
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {/* Tip controls — model never sees these */}
      {!isModel && (
        <div class="goal-actions">
          {isGuest ? (
            <button type="button" class="goal-locked" onClick={onSignUp}>
              <span class="lock">🔒</span>
              <span>Sign in to tip</span>
            </button>
          ) : (
            <>
              <div class="tip-presets">
                {smartPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    class="preset-btn"
                    disabled={tipBusy}
                    onClick={() => onTip(preset)}
                  >
                    +{preset}
                  </button>
                ))}
                {goal.tokensLeft > 0 && (
                  (() => {
                    // "Tip" when no one has contributed yet (be the first); "Fill"
                    // once others have chipped in (cover what's left).
                    const isFirst = goal.progress <= 0;
                    const label = isFirst ? 'Tip' : 'Fill';
                    return (
                      <button
                        type="button"
                        class="preset-btn preset-btn--fill"
                        disabled={tipBusy}
                        onClick={() => onTip(goal.tokensLeft)}
                        aria-label={`${label} the goal with ${goal.tokensLeft} tk`}
                      >
                        {tipBusy ? '…' : `${label} · ${goal.tokensLeft} tk`}
                      </button>
                    );
                  })()
                )}
              </div>
              <div class="custom-tip">
                <input
                  class="amount-input compact"
                  type="number"
                  min="1"
                  max={goal.tokensLeft > 0 ? goal.tokensLeft : undefined}
                  step="1"
                  placeholder="other"
                  value={custom}
                  disabled={tipBusy}
                  onInput={(e) => setCustom((e.currentTarget as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if ((e as KeyboardEvent).key === 'Enter') submitCustom();
                  }}
                />
                <button
                  type="button"
                  class="primary-btn small"
                  disabled={tipBusy || !safeAmount(custom)}
                  onClick={submitCustom}
                >
                  {tipBusy ? '…' : 'Tip'}
                </button>
              </div>

            </>
          )}
        </div>
      )}

      {/* Move controls — collapsed by default behind a small trigger; visible only on demand. */}
      {!isModel && !isGuest && youAllocated > 0 && otherGoals.length > 0 && (
        moveOpen ? (
          <div class="move-row">
            <span class="muted small move-row-label">Move</span>
            <input
              class="amount-input compact move-amount"
              type="number"
              min="1"
              max={youAllocated}
              step="1"
              value={moveAmount}
              onInput={(e) => setMoveAmount((e.currentTarget as HTMLInputElement).value)}
              aria-label="Tokens to move"
            />
            <span class="muted small move-row-label" aria-label="to">→</span>
            <AppSelect
              compact
              aria-label="Destination menu line"
              value={moveTo}
              options={otherGoals.map((g) => ({
                value: g.id,
                label: `${g.title} · ${g.progress}/${g.price} tk`,
              }))}
              onChange={setMoveTo}
            />
            <span class="move-row-actions">
              <button
                type="button"
                class="ghost-btn small move-cancel"
                onClick={() => setMoveOpen(false)}
                aria-label="Cancel move"
              >
                Cancel
              </button>
              <button
                type="button"
                class="primary-btn small"
                disabled={
                  moveBusy ||
                  !moveTo ||
                  !safeAmount(moveAmount) ||
                  safeAmount(moveAmount) > youAllocated
                }
                onClick={() => void onMoveSubmit(moveTo, moveAmount).then((ok) => { if (ok) setMoveOpen(false); })}
              >
                {moveBusy ? '…' : 'Move'}
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            class="move-trigger"
            onClick={() => setMoveOpen(true)}
          >
            Move tokens →
          </button>
        )
      )}
    </div>
  );
};

/* ---------------- Director Remote (control card at top of tab) ---------------- */

const DirectorRemoteCard = ({
  state,
  isModel,
  isGuest,
  isDirector,
  actFlash,
  biteBusy,
  biteNeed,
  chairFromZero,
  openChairRace,
  tenureActive,
  shieldPct,
  cmdBusy,
  unlockBuyBusy,
  unlockBuyCost,
  unlockBuyGuestHint,
  onCommand,
  onSignUp,
  onChairBite,
  onUnlockBuy,
  suppressChallengerMeter,
  meId,
}: {
  state: DirectorPublicState;
  isModel: boolean;
  isGuest: boolean;
  isDirector: boolean;
  actFlash: boolean;
  biteBusy: boolean;
  biteNeed: number;
  chairFromZero: number;
  openChairRace: boolean;
  tenureActive: boolean;
  shieldPct: number;
  cmdBusy: string;
  unlockBuyBusy: boolean;
  unlockBuyCost: number;
  unlockBuyGuestHint: number;
  onCommand: (commandId: string) => void;
  onSignUp: () => void;
  onChairBite: () => void;
  onUnlockBuy: (amount: number) => void;
  suppressChallengerMeter: boolean;
  meId: string;
}) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 500);
    return () => clearInterval(id);
  }, []);

  const canControl = isDirector && state.isLive && !isModel && !isGuest;
  const sessionPercent = Math.min(
    100,
    (state.totalSessionTips / Math.max(1, state.preproductionGoal)) * 100,
  );
  const pressurePercent = Math.max(2, state.pressure.percent);
  const current = state.currentPerformance;
  const remaining = current ? Math.max(0, current.endsAt - Date.now()) : 0;

  const showOpenSeatPanel =
    openChairRace &&
    ((isGuest && chairFromZero > 0) || (!isGuest && !isDirector && biteNeed > 0));

  return (
    <div
      class={`remote${canControl ? ' is-armed' : ' is-locked'}${actFlash ? ' is-activity-flash' : ''}`}
    >
      <div class="remote-top">
        <span class="remote-brand">Director</span>
        <span
          class={`remote-rec${state.isLive && state.gameAccepting ? ' is-on' : ''}${!state.gameAccepting ? ' is-paused' : ''}${state.gameAccepting && !state.isLive ? ' is-active' : ''}`}
        >
          <span class="led" />
          {!state.gameAccepting ? 'Paused' : state.isLive ? 'Live' : 'Active'}
        </span>
      </div>

      <div class="remote-screen">
        {isModel ? (
          <ModelRemoteScreen state={state} />
        ) : !state.gameAccepting ? (
          <>
            <span class="screen-label">Paused</span>
            <span class="screen-line">Model paused Director Control</span>
            <span class="screen-sub">Tips Cooperations is still available.</span>
          </>
        ) : current ? (
          <>
            <span class="screen-label">Happening now</span>
            <span class="screen-line">
              <span class="emoji">{current.emoji}</span>
              <span>{current.label}</span>
              <span class="screen-countdown">{formatRemaining(remaining)}</span>
            </span>
            <span class="screen-sub">Director</span>
          </>
        ) : state.isLive ? (
          isDirector ? (
            <>
              <span class="screen-label">Your turn</span>
              <span class="screen-line">Pick what happens next — tap an action below</span>
            </>
          ) : !isGuest && state.director.id && state.pressure.isCritical ? (
            <>
              <span class="screen-label">Take the seat</span>
              <span class="screen-line">Tip Director Menu lines below to overtake</span>
              <span class="screen-sub">
                {state.pressure.neededToOvertake} tk ahead of {state.director.name}
              </span>
            </>
          ) : (
            <>
              <span class="screen-label">Live</span>
              <span class="screen-line">
                {state.director.id
                  ? `${state.director.name} has the remote — hang tight for their pick`
                  : 'Waiting for someone to take the remote'}
              </span>
            </>
          )
        ) : (
          <>
            <span class="screen-label">Unlock Director</span>
            <span class="screen-line screen-line--unlock">
              <span class="screen-value">{state.totalSessionTips}</span>
              <span class="screen-target">/ {state.preproductionGoal} tk</span>
            </span>
            <span class="screen-sub screen-sub--hint">Tip the menu to unlock</span>
          </>
        )}
      </div>

      {!state.isLive && state.gameAccepting && (
        <div class="remote-meter remote-meter--unlock">
          <div class="meter-label">
            <span>{isModel ? 'Unlock target' : 'Unlock'}</span>
            <span>{Math.round(sessionPercent)}%</span>
          </div>
          {/* The contributor bar now doubles as the unlock progress meter — the
              total filled width equals `totalSessionTips / preproductionGoal`,
              while the segments break that fill down by tipper. One bar, two
              jobs, no duplicated information. */}
          <ContributorBar
            contributors={state.sessionContributors ?? []}
            goalTk={state.preproductionGoal}
            meId={meId}
          />
        </div>
      )}

      {/* Direct-buy unlock: skip the tip-menu grind by paying just enough
          (close the gap to goal + overtake the strongest other tipper by
          `overtakeMargin`). The model background then flips the room to
          Live and seats this viewer as Director in the same tick. */}
      {!state.isLive && state.gameAccepting && !isModel && state.preproductionGoal > 0 && (
        <div class="remote-open-seat remote-open-seat--unlock">
          {isGuest && unlockBuyGuestHint > 0 ? (
            <button type="button" class="bite-btn" onClick={onSignUp}>
              Sign in · {unlockBuyGuestHint} tk
            </button>
          ) : !isGuest && unlockBuyCost > 0 ? (
            <button
              type="button"
              class="bite-btn bite-btn--cta"
              disabled={unlockBuyBusy}
              aria-label={`Pay ${unlockBuyCost} tk to become Director`}
              onClick={() => onUnlockBuy(unlockBuyCost)}
            >
              {unlockBuyBusy
                ? '…'
                : `Become Director · ${unlockBuyCost} tk`}
            </button>
          ) : null}
        </div>
      )}

      {state.isLive && state.director.id && !isDirector && !isModel && (
        <div class="remote-screen remote-screen--director">
          <span class="screen-label">Now controlling</span>
          <span class="screen-line">
            <span class="emoji" aria-hidden="true">
              🎬
            </span>
            <span class="screen-director-name">{state.director.name}</span>
            <span>· {state.director.total} tk</span>
          </span>
        </div>
      )}

      {tenureActive && !isModel && (
        <div class="remote-meter remote-meter--shield">
          <div class="meter-label">
            <span>Director safe</span>
            <span>{formatRemaining(state.directorTenureLeftMs)}</span>
          </div>
          <div class="meter-bar meter-bar--shield">
            <span style={{ width: `${shieldPct}%` }} />
          </div>
        </div>
      )}

      {showOpenSeatPanel ? (
        <div class="remote-open-seat">
          {isGuest && chairFromZero > 0 ? (
            <button type="button" class="bite-btn" onClick={onSignUp}>
              Sign in · {chairFromZero} tk
            </button>
          ) : !isGuest && !isDirector && biteNeed > 0 ? (
            <button
              type="button"
              class="bite-btn bite-btn--cta"
              disabled={biteBusy}
              aria-label={`Pay ${biteNeed} tk to become Director`}
              onClick={onChairBite}
            >
              {biteBusy ? '…' : `Become Director · ${biteNeed} tk`}
            </button>
          ) : null}
        </div>
      ) : null}

      {!isModel && (
        <div class="remote-pad">
          <div class="pad-head">
            {canControl ? (
              <>
                <span class="pad-title">Actions</span>
                <span class="pad-cost">{state.commandCostTokens} tk each</span>
              </>
            ) : (
              <>
                <span class="pad-title">
                  <span class="lock">🔒</span> Locked
                </span>
                <span class="pad-cost">
                  {!state.gameAccepting
                    ? 'Waiting for the model to start'
                    : !state.isLive
                      ? 'Tip to unlock Director Control'
                      : 'Become Director to give orders'}
                </span>
              </>
            )}
          </div>

          <div class={`pad-grid${canControl ? '' : ' is-disabled'}`}>
            {COMMAND_GROUPS.flatMap((group) => group.commands).map((cmd) => {
              const cdMs = state.commandCooldowns[cmd.id] ?? 0;
              const cdSec = Math.ceil(cdMs / 1000);
              const disabled = !canControl || cdSec > 0 || cmdBusy === cmd.id;
              return (
                <button
                  type="button"
                  class="pad-key"
                  key={cmd.id}
                  disabled={disabled}
                  onClick={() => onCommand(cmd.id)}
                  aria-label={cmd.label}
                  title={cmd.label}
                >
                  <span class="pad-key-emoji">{cmd.emoji}</span>
                  <span class="pad-key-label">{cmd.label}</span>
                  {cdSec > 0 ? <span class="pad-key-cd">{cdSec}s</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {state.isLive && state.challenger.id && !suppressChallengerMeter ? (
        <div class="remote-meter remote-meter--bottom">
          <div class="meter-label">
            <span>{state.challenger.name}</span>
            <span>
              {state.pressure.isCritical
                ? `−${state.pressure.neededToOvertake}`
                : `${state.pressure.neededToOvertake} tk`}
            </span>
          </div>
          <div class={`meter-bar is-pressure${state.pressure.isCritical ? ' is-critical' : ''}`}>
            <span style={{ width: `${pressurePercent}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** Horizontal stacked bar showing every session contributor's share of the
 *  unlock goal. The current user's segment is gently accented; all others use
 *  a muted neutral fill so it's obvious which slice belongs to "me". This is
 *  secondary information, so the styling stays quiet — names only appear when
 *  they actually fit in their segment (we measure each one off-screen), and a
 *  small legend below names the two color zones (You + Others). */
const ContributorBar = ({
  contributors,
  goalTk,
  meId,
}: {
  contributors: Array<{ id: string; name: string; total: number }>;
  goalTk: number;
  meId: string;
}) => {
  if (goalTk <= 0) return null;
  const totalTipped = contributors.reduce((sum, c) => sum + c.total, 0);
  const scale = Math.max(goalTk, totalTipped); // never overflow past 100%
  const myEntry = contributors.find((c) => meId && c.id === meId);
  const myShare = myEntry ? (myEntry.total / Math.max(1, scale)) * 100 : 0;
  const othersTotal = Math.max(0, totalTipped - (myEntry?.total ?? 0));
  const othersShare = (othersTotal / Math.max(1, scale)) * 100;
  // When the viewer can't be in the contributor list (model, or non-tipping
  // viewer) "Others" reads oddly — there's no "self" to be other than. Use
  // "Room" for that case so the legend stays accurate.
  const otherLabel = myEntry ? 'Others' : 'Room';

  return (
    <div class="contributor-bar">
      <div class="contributor-bar-track" role="img" aria-label="Contributor distribution">
        {contributors.map((c) => {
          const widthPct = (c.total / Math.max(1, scale)) * 100;
          if (widthPct < 0.4) return null;
          const isSelf = Boolean(meId && c.id === meId);
          return (
            <ContributorSeg
              key={c.id}
              widthPct={widthPct}
              isSelf={isSelf}
              name={c.name}
              total={c.total}
            />
          );
        })}
      </div>
      {totalTipped > 0 ? (
        <div class="contributor-bar-legend">
          {myEntry ? (
            <span class="contributor-bar-legend-item contributor-bar-legend-item--self">
              <span class="contributor-bar-legend-dot" aria-hidden="true" />
              You · {myEntry.total} tk ({Math.round(myShare)}% of goal)
            </span>
          ) : null}
          {othersTotal > 0 ? (
            <span class="contributor-bar-legend-item contributor-bar-legend-item--others">
              <span class="contributor-bar-legend-dot" aria-hidden="true" />
              {otherLabel} · {othersTotal} tk ({Math.round(othersShare)}%)
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * One stacked-bar segment. Renders the contributor's name + amount only when
 * the full label actually fits inside the segment's width — otherwise we drop
 * the name and keep just the amount, so we never end up with truncated
 * gibberish like "Y... 100 tk". Fit is decided by an off-screen `measurer`
 * span that holds the full content so its width never changes with our
 * render decision (which would otherwise oscillate).
 */
const ContributorSeg = ({
  widthPct,
  isSelf,
  name,
  total,
}: {
  widthPct: number;
  isSelf: boolean;
  name: string;
  total: number;
}) => {
  const segRef = useRef<HTMLSpanElement>(null);
  const measurerRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  const displayName = isSelf ? 'You' : name;

  useEffect(() => {
    const seg = segRef.current;
    const measurer = measurerRef.current;
    if (!seg || !measurer) return;
    const recompute = () => {
      const styles = window.getComputedStyle(seg);
      const pad =
        (parseFloat(styles.paddingLeft) || 0) +
        (parseFloat(styles.paddingRight) || 0);
      const available = seg.clientWidth - pad;
      const needed = measurer.offsetWidth;
      setFits(needed > 0 && needed <= available);
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(seg);
    recompute();
    return () => ro.disconnect();
  }, [displayName, total, widthPct]);

  return (
    <span
      ref={segRef}
      class={`contributor-seg${isSelf ? ' is-self' : ''}`}
      style={{ width: `${widthPct}%` }}
      title={`${name} · ${total} tk`}
    >
      <span ref={measurerRef} class="contributor-seg-measurer" aria-hidden="true">
        <span class="contributor-seg-name">{displayName}</span>
        <span class="contributor-seg-amt">{total} tk</span>
      </span>
      {fits ? (
        <span class="contributor-seg-name">{displayName}</span>
      ) : null}
      <span class="contributor-seg-amt">{total} tk</span>
    </span>
  );
};

const ModelRemoteScreen = ({ state }: { state: DirectorPublicState }) => {
  if (!state.isLive) {
    return (
      <>
        <span class="screen-label">Goal</span>
        <span class="screen-line screen-line--unlock">
          <span class="screen-value">{state.totalSessionTips}</span>
          <span class="screen-target">/ {state.preproductionGoal} tk</span>
        </span>
      </>
    );
  }
  if (!state.director.id) {
    return (
      <>
        <span class="screen-label">Live</span>
        <span class="screen-line">Waiting for a Director</span>
      </>
    );
  }
  if (state.directorTenureLeftMs > 0) {
    return (
      <>
        <span class="screen-label">Director safe</span>
        <span class="screen-line">{formatRemaining(state.directorTenureLeftMs)}</span>
      </>
    );
  }
  return (
    <>
      <span class="screen-label">Now controlling</span>
      <span class="screen-line">
        <span class="emoji" aria-hidden="true">🎬</span>
        <span class="screen-director-name">{state.director.name}</span>
        <span>· {state.director.total} tk</span>
      </span>
    </>
  );
};

