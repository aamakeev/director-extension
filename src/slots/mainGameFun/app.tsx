import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { AppSelect } from '../../shared/AppSelect';
import { chairCatchUpTokens } from '../../shared/chairBite';
import { contributorColorAt } from '../../shared/contributorColors';
import { formatRemaining } from '../../shared/format';
import { userIdString, usernameString, whisperSelfId } from '../../shared/role';
import { directorExt, useDirectorClient } from '../../shared/useDirectorState';
import type {
  DirectorActivityBroadcast,
  DirectorMenuGoal,
  DirectorPublicState,
} from '../../shared/state';
import { UNLOCK_DEMO_NAMES, chipDemoFromTotal } from '../../shared/unlockDemoChips';

const TIP_PRESETS = [10, 25, 50, 100];

/** Panel duration after `menu_goal_complete` so every client sees the same message window. */
const MENU_GOAL_CELEBRATION_MS = 12_000;

const safeAmount = (raw: string): number => {
  const num = Math.floor(Number(raw));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(num, 100_000);
};

type AllocSummary = {
  goalId: string;
  title: string;
  allocated: number;
};

type StageEntry = {
  id: string;
  at: number;
  text: string;
  emoji?: string;
  tone: 'spotlight' | 'success' | 'warn' | 'info';
  kind: 'now' | 'queued' | 'history' | 'activity';
  countdown?: string;
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
  const [reallocBusy, setReallocBusy] = useState<string>('');
  const [moveOpen, setMoveOpen] = useState<string>('');
  const [moveTo, setMoveTo] = useState<string>('');
  const [moveAmount, setMoveAmount] = useState<string>('5');
  const [resetBusy, setResetBusy] = useState<boolean>(false);
  const [gameBusy, setGameBusy] = useState<'start' | 'stop' | ''>('');
  const [biteBusy, setBiteBusy] = useState(false);
  const [actFlash, setActFlash] = useState(false);
  const lastActId = useRef('');

  // Cross-slot activity broadcast (menu goal, LIVE unlock, command) — subtle shell pulse.
  useEffect(() => {
    const last = activityInbox[activityInbox.length - 1];
    if (!last || last.id === lastActId.current) return;
    lastActId.current = last.id;
    setActFlash(true);
    const t = window.setTimeout(() => setActFlash(false), 520);
    return () => window.clearTimeout(t);
  }, [activityInbox]);

  const meId = userIdString(context.user);
  const selfWhisperId = whisperSelfId(context.user);
  const meName = usernameString(context.user);
  const isModel = role === 'model';
  const isGuest = role === 'guest';
  const isDirector = Boolean(
    state?.isLive && state?.director?.id && String(state.director.id) === String(selfWhisperId),
  );
  const leadIsYou = Boolean(
    state?.isLive &&
      state.director?.id &&
      selfWhisperId &&
      String(state.director.id) === String(selfWhisperId),
  );
  const goals = state?.menuGoals ?? [];
  const modelSpendLeaders = useMemo(() => {
    if (!isModel || !state) return [];
    const map = new Map<string, { name: string; total: number }>();
    for (const goal of state.menuGoals) {
      for (const c of goal.contributors) {
        const prev = map.get(c.userId)?.total ?? 0;
        map.set(c.userId, { name: c.name, total: prev + c.amount });
      }
    }
    return [...map.entries()]
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [isModel, state]);

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

  const allocatedSummary = useMemo<AllocSummary[]>(
    () =>
      goals
        .map((g) => ({
          goalId: g.id,
          title: g.title,
          allocated: selfAllocations.byItem[g.id] ?? 0,
        }))
        .filter((entry) => entry.allocated > 0),
    [goals, selfAllocations],
  );

  // Reset move-from picker when allocation disappears.
  useEffect(() => {
    if (!moveOpen) return;
    const stillHere = allocatedSummary.some((a) => a.goalId === moveOpen);
    if (!stillHere) {
      setMoveOpen('');
      setMoveTo('');
    }
  }, [allocatedSummary, moveOpen]);

  // Pick a default destination when opening the move panel.
  useEffect(() => {
    if (!moveOpen) return;
    if (moveTo && moveTo !== moveOpen && goals.some((g) => g.id === moveTo)) return;
    const next = goals.find((g) => g.id !== moveOpen);
    setMoveTo(next?.id ?? '');
  }, [moveOpen, moveTo, goals]);

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

  const sendMove = async (fromGoalId: string) => {
    if (!meId || isModel || isGuest) return;
    const amount = safeAmount(moveAmount);
    if (!fromGoalId || !moveTo || fromGoalId === moveTo || !amount) {
      pushToast({ tone: 'warn', message: 'Pick a destination and amount' });
      return;
    }
    setReallocBusy(fromGoalId);
    try {
      await directorExt.makeRequest('v1.payment.tokens.spend', {
        tokensAmount: 1,
        tokensSpendData: {
          kind: 'director.menu.reallocate',
          fromItemId: fromGoalId,
          toItemId: moveTo,
          amount,
          userId: meId,
          username: meName,
        },
      });
      setMoveOpen('');
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Payment cancelled' });
    } finally {
      setReallocBusy('');
    }
  };

  const openSignUp = () => {
    void directorExt.makeRequest('v1.ext.signup.open', { type: 'user' }).catch(() => undefined);
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

  const resetShow = async () => {
    if (!isModel || resetBusy) return;
    const modelId = String(context.model?.id ?? meId ?? '');
    if (!modelId) return;
    setResetBusy(true);
    try {
      await directorExt.makeRequest('v1.ext.whisper', {
        data: { type: 'director.show.reset', modelId },
      });
      pushToast({ tone: 'success', message: 'Round cleared' });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Reset failed' });
    } finally {
      setResetBusy(false);
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
        <section class="menu-card">
          <div class="brand">
            <div class="brand-title brand-title-retro">by Stripchat</div>
            <div class="brand-subtitle">Connecting…</div>
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

  const liveChipLabel = !state.gameAccepting ? 'Paused' : state.isLive ? 'Live' : 'Not live yet';

  return (
    <div class={`menu-shell${actFlash ? ' menu-shell--act-pulse' : ''}`}>
      {isModel && (
        <section class="menu-card model-hub-card">
          <div class="model-hub-head">
            <h2 class="model-hub-title">Director — your control tab</h2>
            <p class="model-hub-intro">
              Viewers tip your menu lines; amounts stack toward the unlock goal from extension settings.
              At <strong>{state.preproductionGoal} tk</strong> total, the top spender becomes Director.
              They use the stream <strong>remote panel</strong> (you do not need to open it) to send paid
              actions — each press costs them <strong>{state.commandCostTokens} tk</strong>.
            </p>
          </div>
          <ul class="model-hub-list muted small">
            <li>
              <strong>Start game</strong> when you are ready — until then viewers see &quot;Paused&quot; and the room
              cannot unlock Director mode (tips on menu lines still work).
            </li>
            <li>
              <strong>{state.totalSessionTips} tk</strong> routed through this extension this round (unlock bar +
              chase tips).
            </li>
            <li>
              <strong>Pause</strong> stops Director mode and clears the current Director — menu tips keep adding
              up on each line.
            </li>
            <li>
              <strong>Clear round</strong> wipes scores, queue, and feed for a fresh game (your Stripchat tip
              menu stays as you set it).
            </li>
          </ul>
          <div class="model-hub-actions">
            <button
              type="button"
              class="primary-btn"
              disabled={state.gameAccepting || Boolean(gameBusy)}
              onClick={() => void sendGameToggle('start')}
            >
              {gameBusy === 'start' ? '…' : 'Start game'}
            </button>
            <button
              type="button"
              class="secondary-btn"
              disabled={!state.gameAccepting || Boolean(gameBusy)}
              onClick={() => void sendGameToggle('stop')}
            >
              {gameBusy === 'stop' ? '…' : 'Pause game'}
            </button>
            <button
              type="button"
              class="danger-btn"
              disabled={resetBusy || Boolean(gameBusy)}
              onClick={() => void resetShow()}
            >
              {resetBusy ? '…' : 'Clear round'}
            </button>
          </div>
          {modelSpendLeaders.length > 0 ? (
            <div class="model-hub-leaders">
              <div class="model-hub-leaders-title">Who spent the most (this round)</div>
              <ol class="model-hub-leaders-list">
                {modelSpendLeaders.map((row) => (
                  <li key={row.userId}>
                    <span class="model-hub-leaders-name">{row.name}</span>
                    <span class="model-hub-leaders-amt">{row.total} tk</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p class="muted small model-hub-leaders-empty">Viewer tips will list here with names and totals.</p>
          )}
        </section>
      )}

      {!isModel && !state.gameAccepting ? (
        <div class="game-paused-banner" role="status">
          Broadcaster paused Director unlock. Tips on menu lines below still stack on each goal.
        </div>
      ) : null}

      {/* ---------- Status ---------- */}
      <section class="menu-card status-summary-card">
        <div class="tab-status">
          <div class="tab-status-block">
            <span class="tab-status-kicker">Status</span>
            <p
              class={`tab-status-state${state.isLive && state.gameAccepting ? ' is-live' : ''}${!state.gameAccepting ? ' is-paused' : ''}`}
            >
              {liveChipLabel}
            </p>
          </div>
          {state.isLive ? (
            <div class={`tab-status-block${leadIsYou ? ' tab-status-block--you' : ''}`}>
              <span class="tab-status-kicker">Now steering</span>
              <p class="tab-status-line">
                <span class="tab-status-name">{state.director.name}</span>
                <span class="tab-status-sep">·</span>
                <span class="tab-status-tk">{state.director.total} tk</span>
              </p>
              {tenureActive && isModel ? (
                <p class="tab-status-meta">
                  Protected from swaps · {formatRemaining(state.directorTenureLeftMs)}
                </p>
              ) : null}
              {leadIsYou ? (
                <p class="tab-status-meta">
                  You spent {selfAllocations.total} tk on menu lines this round
                </p>
              ) : null}
            </div>
          ) : (
            <div class="tab-status-block">
              <span class="tab-status-kicker">Unlock</span>
              <p class="tab-status-desc">
                {isModel ? (
                  <>
                    <strong>{state.totalSessionTips}</strong> / {state.preproductionGoal} tk — lines below mirror
                    the viewer view (without tip buttons).
                  </>
                ) : (
                  <>
                    {state.totalSessionTips} / {state.preproductionGoal} tk toward going live.
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {!state.isLive && (
          <div class="bar">
            <span style={{ width: `${sessionPercent}%` }} />
          </div>
        )}

        {state.isLive && state.challenger.id && !suppressChallengerMeter ? (
          <div class="status-pressure">
            <span class="muted small">
              {isModel ? 'Next in line: ' : 'Chase: '}
              <strong>{state.challenger.name}</strong>
              {' · '}
              {state.pressure.isCritical
                ? `${state.pressure.neededToOvertake} tk to flip Director`
                : `${state.pressure.neededToOvertake} tk to take Director`}
            </span>
            <div class={`bar is-pressure${state.pressure.isCritical ? ' is-critical' : ''}`}>
              <span style={{ width: `${Math.max(2, state.pressure.percent)}%` }} />
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

        {tenureActive && !isModel && (
          <div class="status-shield">
            <span class="muted small">Director safe</span>
            <span class="muted small">{formatRemaining(state.directorTenureLeftMs)}</span>
            <div class="bar bar--shield">
              <span style={{ width: `${shieldPct}%` }} />
            </div>
          </div>
        )}

        {openChairRace && !isGuest && !isDirector && !isModel && biteNeed > 0 ? (
          <div class="chair-challenge-block chair-challenge-block--solo">
            <button
              type="button"
              class="primary-btn chair-bite-btn"
              disabled={biteBusy}
              aria-label={`Pay ${biteNeed} tk to become Director`}
              onClick={() => void sendChairBite()}
            >
              {biteBusy ? '…' : `Become Director · ${biteNeed} tk`}
            </button>
          </div>
        ) : null}
      </section>

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
                : goals.length === 0
                  ? 'Your tip menu (viewer copy)'
                  : showUnlockGuide
                    ? 'Tip menu · fills unlock'
                    : 'Your tip menu (viewer copy)'
              : goals.length === 0 && showUnlockGuide
                ? 'Unlock bar'
                : goals.length === 0
                  ? 'Tip menu'
                  : showUnlockGuide
                    ? 'Tip menu · fills unlock'
                    : 'Tip menu'}
          </span>
        </div>

        {goals.length === 0 ? (
          showUnlockGuide ? (
            <UnlockContributorDemo goalTk={state.preproductionGoal} fillPercent={sessionPercent} />
          ) : (
            <div class="empty">
              {isModel
                ? 'No tip menu lines loaded yet. When your Stripchat tip menu is active, rows appear here so you can see viewer progress.'
                : 'Tip menu is empty. Once the model sets a tip menu, items appear here.'}
            </div>
          )
        ) : (
          <div class="goals-list">
            {goals.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                celebration={
                  (goalCelebrationUntil[goal.id] ?? 0) > celebrationNow
                    ? latestMenuCompleteByItemId[goal.id] ?? null
                    : null
                }
                meId={meId}
                youAllocated={selfAllocations.byItem[goal.id] ?? 0}
                isModel={isModel}
                isGuest={isGuest}
                tipBusy={tipBusy === goal.id}
                onTip={(amt) => sendTip(goal.id, amt)}
                onSignUp={openSignUp}
                moveOpen={moveOpen === goal.id}
                onMoveToggle={() => setMoveOpen(moveOpen === goal.id ? '' : goal.id)}
                moveTo={moveTo}
                setMoveTo={setMoveTo}
                moveAmount={moveAmount}
                setMoveAmount={setMoveAmount}
                otherGoals={goals.filter((g) => g.id !== goal.id)}
                moveBusy={reallocBusy === goal.id}
                onMoveSubmit={() => sendMove(goal.id)}
              />
            ))}
          </div>
        )}

        {!isModel && selfAllocations.total > 0 && (
          <div class="self-summary">
            You've put {selfAllocations.total} tk on the table this round.
          </div>
        )}
      </section>

      {/* ---------- Stage (current + queue + history + activity merged) ---------- */}
      <StageSection state={state} isDirector={isDirector} isModel={isModel} showUnlockVisual={showUnlockGuide} />

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
  moveOpen,
  onMoveToggle,
  moveTo,
  setMoveTo,
  moveAmount,
  setMoveAmount,
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
  moveOpen: boolean;
  onMoveToggle: () => void;
  moveTo: string;
  setMoveTo: (id: string) => void;
  moveAmount: string;
  setMoveAmount: (s: string) => void;
  otherGoals: DirectorMenuGoal[];
  moveBusy: boolean;
  onMoveSubmit: () => void;
}) => {
  const [custom, setCustom] = useState<string>('');
  const classes = ['goal'];
  if (youAllocated > 0) classes.push('is-mine');
  if (moveOpen) classes.push('is-moving');
  if (celebration) classes.push('goal--celebration');

  const celebrationCopy = celebration
    ? menuGoalCelebrationCopy(celebration, goal.title, goal.price)
    : null;

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
          <span class="goal-price">target {goal.price} tk</span>
        </span>
      </div>

      <div class="goal-meta">
        <span>
          {goal.progress}/{goal.price} · {goal.tokensLeft} left
        </span>
        <span>{Math.round(goal.percent)}%</span>
      </div>

      <div class="goal-progress">
        <div class="goal-progress-done" style={{ width: `${Math.min(100, goal.percent)}%` }}>
          {goal.progress > 0 ? (
            goal.contributors.length > 0 ? (
              goal.contributors.map((c, i) => (
                <span
                  key={c.userId}
                  class={`goal-progress-seg${meId && c.userId === meId ? ' is-self' : ''}`}
                  style={{
                    flexGrow: c.amount,
                    background: contributorColorAt(i),
                  }}
                  title={`${c.name}: ${c.amount} tk`}
                />
              ))
            ) : (
              <span
                class="goal-progress-seg goal-progress-seg--solo"
                style={{ flexGrow: 1, background: 'var(--d-accent-strong)' }}
              />
            )
          ) : null}
        </div>
      </div>

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
                {TIP_PRESETS.map((preset) => (
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
                <div class="custom-tip">
                  <input
                    class="amount-input compact"
                    type="number"
                    min="1"
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
              </div>

              {youAllocated > 0 && otherGoals.length > 0 && (
                <button
                  type="button"
                  class={`move-toggle${moveOpen ? ' is-on' : ''}`}
                  onClick={onMoveToggle}
                >
                  {moveOpen ? 'Cancel move' : `Move from here (1 tk fee)`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Move controls — only visible when toggled */}
      {!isModel && !isGuest && moveOpen && otherGoals.length > 0 && (
        <div class="move-row">
          <span class="muted small">Move</span>
          <input
            class="amount-input compact"
            type="number"
            min="1"
            max={youAllocated}
            step="1"
            value={moveAmount}
            onInput={(e) => setMoveAmount((e.currentTarget as HTMLInputElement).value)}
          />
          <span class="muted small">tk →</span>
          <AppSelect
            compact
            aria-label="Goal to move tokens to"
            value={moveTo}
            options={otherGoals.map((g) => ({ value: g.id, label: g.title }))}
            onChange={setMoveTo}
          />
          <button
            type="button"
            class="primary-btn small"
            disabled={moveBusy || !moveTo || !safeAmount(moveAmount)}
            onClick={onMoveSubmit}
          >
            {moveBusy ? '…' : 'Move'}
          </button>
        </div>
      )}
    </div>
  );
};

/* ---------------- Stage (now playing + recent activity) ---------------- */

const StageSection = ({
  state,
  isDirector,
  isModel,
  showUnlockVisual,
}: {
  state: DirectorPublicState;
  isDirector: boolean;
  isModel: boolean;
  showUnlockVisual: boolean;
}) => {
  const current = state.currentPerformance;
  const entries: StageEntry[] = [];

  if (current) {
    entries.push({
      id: `now_${current.id}`,
      at: current.startedAt,
      text: `${current.label} · by ${current.issuedByName}`,
      emoji: current.emoji,
      tone: 'spotlight',
      kind: 'now',
      countdown: formatRemaining(current.remainingMs),
    });
  }
  state.queue.slice(0, 3).forEach((q) => {
    entries.push({
      id: `q_${q.id}`,
      at: q.issuedAt,
      text: `${q.label} · queued`,
      emoji: q.emoji,
      tone: 'info',
      kind: 'queued',
    });
  });
  state.activityFeed.slice(0, 6).forEach((a) => {
    entries.push({
      id: `a_${a.id}`,
      at: a.at,
      text: a.text,
      tone: a.tone === 'spotlight' ? 'spotlight' : a.tone,
      kind: 'activity',
    });
  });

  // sort newest first, keep "now" pinned on top
  const sorted = entries.sort((a, b) => {
    if (a.kind === 'now') return -1;
    if (b.kind === 'now') return 1;
    return b.at - a.at;
  });

  const stageUnlockVisual =
    sorted.length === 0 &&
    showUnlockVisual &&
    !state.isLive &&
    (state.menuSource !== 'sdk' || state.menuGoals.length === 0);

  return (
    <section class="menu-card">
      <div class="section-title">
        <span>{isModel ? 'Action queue & feed' : 'Stage'}</span>
        {isDirector && (
          <span class="muted small section-aside">Orders come from whoever holds the Director seat</span>
        )}
        {isModel && !isDirector && (
          <span class="muted small section-aside">What viewers see in the live stack</span>
        )}
      </div>
      {stageUnlockVisual ? (
        <p class="stage-idle-hint muted small">
          {isModel
            ? 'This area fills with Director actions and room events when you are live and accepting the game.'
            : 'Tips and Director orders show here once you&apos;re live.'}
        </p>
      ) : sorted.length === 0 ? (
        <div class="empty">
          {!state.gameAccepting
            ? isModel
              ? 'Game paused — Director actions are off. Menu tips still show on each line above.'
              : 'Broadcaster paused Director mode — your menu tips still count on each line.'
            : state.isLive
              ? isModel
                ? 'No action playing — waiting for the Director to send a command from their remote.'
                : 'Nothing queued · Director picks actions on the remote.'
              : isModel
                ? 'Not live yet — hit Start game when you want viewers to unlock Director mode.'
                : 'Shows here once you&apos;re live.'}
        </div>
      ) : (
        <div class="stage-feed">
          {sorted.map((entry) => (
            <div
              class={`stage-item kind-${entry.kind} tone-${entry.tone}`}
              key={entry.id}
            >
              {entry.emoji && <span class="emoji">{entry.emoji}</span>}
              <span class="text">{entry.text}</span>
              {entry.countdown && <span class="countdown">{entry.countdown}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
