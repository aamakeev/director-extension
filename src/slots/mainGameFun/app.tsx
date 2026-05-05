import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { chairCatchUpTokens } from '../../shared/chairBite';
import { contributorColorAt } from '../../shared/contributorColors';
import { formatRemaining } from '../../shared/format';
import { userIdString, usernameString } from '../../shared/role';
import { directorExt, useDirectorClient } from '../../shared/useDirectorState';
import type { DirectorMenuGoal, DirectorPublicState } from '../../shared/state';
import { UNLOCK_DEMO_NAMES, chipDemoFromTotal } from '../../shared/unlockDemoChips';

const TIP_PRESETS = [10, 25, 50, 100];

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
        <span class="uc-demo-label">Room goal</span>
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
  const meName = usernameString(context.user);
  const isModel = role === 'model';
  const isGuest = role === 'guest';
  const isDirector = Boolean(state?.isLive && state?.director?.id && state.director.id === meId);
  const goals = state?.menuGoals ?? [];
  /** Pre-show: no SDK menu lines, or no rows yet — explain the single unlock bar + concrete tip sizes. */
  const showUnlockGuide = Boolean(
    state &&
      !state.isLive &&
      (state.menuSource !== 'sdk' || goals.length === 0),
  );

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
    if (!state || !meId || isModel || isGuest || isDirector || biteBusy) return;
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
      pushToast({ tone: 'success', message: 'Show reset' });
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Reset failed' });
    } finally {
      setResetBusy(false);
    }
  };

  if (!state) {
    return (
      <div class="menu-shell">
        <section class="menu-card">
          <div class="brand">
            <div class="brand-title">Director</div>
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
    openChairRace && !isModel && !isGuest && !isDirector
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

  return (
    <div class={`menu-shell${actFlash ? ' menu-shell--act-pulse' : ''}`}>
      {/* ---------- Status ---------- */}
      <section class="menu-card">
        <div class="status-row">
          <div class={`live-chip${state.isLive ? ' is-live' : ''}`}>
            <span class="dot" />
            <span>{state.isLive ? 'LIVE' : 'Pre-show'}</span>
          </div>
          {state.isLive ? (
            <div class="lead-inline">
              <span class="muted small">Lead</span>
              <span class="lead-name">🎬 {state.director.name}</span>
              <span class="muted small">· {state.director.total} tk</span>
            </div>
          ) : (
            <div class="muted small">
              {state.totalSessionTips} / {state.preproductionGoal} tk to start
            </div>
          )}
        </div>

        {!state.isLive && (
          <div class="bar">
            <span style={{ width: `${sessionPercent}%` }} />
          </div>
        )}

        {state.isLive && state.challenger.id ? (
          <div class="status-pressure">
            <span class="muted small">
              Challenger: <strong>{state.challenger.name}</strong>
              {' · '}
              {state.pressure.isCritical
                ? `${state.pressure.neededToOvertake} tk to flip`
                : `${state.pressure.neededToOvertake} tk to overtake`}
            </span>
            <div class={`bar is-pressure${state.pressure.isCritical ? ' is-critical' : ''}`}>
              <span style={{ width: `${Math.max(2, state.pressure.percent)}%` }} />
            </div>
          </div>
        ) : null}

        {tenureActive && (
          <div class="status-shield">
            <span class="muted small">Lead safe</span>
            <span class="muted small">{formatRemaining(state.directorTenureLeftMs)}</span>
            <div class="bar bar--shield">
              <span style={{ width: `${shieldPct}%` }} />
            </div>
          </div>
        )}

        {openChairRace && !isModel && !isGuest && !isDirector && biteNeed > 0 ? (
          <div class="chair-bite-row">
            <button
              type="button"
              class="primary-btn chair-bite-btn"
              disabled={biteBusy}
              onClick={() => void sendChairBite()}
            >
              {biteBusy ? '…' : `Take chair · ${biteNeed} tk`}
            </button>
          </div>
        ) : null}
      </section>

      {/* ---------- Guest sign-up CTA ---------- */}
      {isGuest && (
        <section class="menu-card cta-card">
          <div class="cta-title">Sign in to play</div>
          <div class="cta-text">
            {state.isLive && chairGuestHint > 0 ? (
              <p class="cta-banana">
                LIVE: <strong>{chairGuestHint} tk</strong> from your first tips to take Director.
              </p>
            ) : null}
            {goals.length === 0 ? (
              <>Sign in, then tip <strong>10–100+ tk</strong> on the stream toward the bar above.</>
            ) : showUnlockGuide ? (
              <>
                Sign in, then use <strong>+10 … +100</strong> on a line below—they stack on the bar.
              </>
            ) : (
              <>Tip a goal below. Top tipper becomes Director.</>
            )}
          </div>
          <button class="primary-btn cta-btn" type="button" onClick={openSignUp}>
            Sign up
          </button>
        </section>
      )}

      {/* ---------- Model controls ---------- */}
      {isModel && (
        <section class="menu-card model-card">
          <div class="model-card-text">
            <div class="model-card-title">Show controls</div>
            <div class="model-card-sub">
              Reset clears the leaderboard, lead, queue and ends the show. Tip menu stays as you
              configured it.
            </div>
          </div>
          <button
            class="danger-btn"
            type="button"
            onClick={resetShow}
            disabled={resetBusy}
          >
            {resetBusy ? 'Resetting…' : 'Reset show'}
          </button>
        </section>
      )}

      {/* ---------- Tip menu (or empty state) ---------- */}
      <section class="menu-card">
        <div class="section-title">
          <span>
            {goals.length === 0 && showUnlockGuide
              ? 'Room goal'
              : goals.length === 0
                ? 'Tip menu'
                : showUnlockGuide
                  ? 'Tip toward unlock'
                  : 'Tip menu'}
          </span>
        </div>

        {goals.length === 0 ? (
          showUnlockGuide ? (
            <UnlockContributorDemo goalTk={state.preproductionGoal} fillPercent={sessionPercent} />
          ) : (
            <div class="empty">Tip menu is empty. Once the model sets a tip menu, items appear here.</div>
          )
        ) : (
          <div class="goals-list">
            {goals.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
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

        {selfAllocations.total > 0 && (
          <div class="self-summary">
            You've put {selfAllocations.total} tk on the table this round.
          </div>
        )}
      </section>

      {/* ---------- Stage (current + queue + history + activity merged) ---------- */}
      <StageSection state={state} isDirector={isDirector} showUnlockVisual={showUnlockGuide} />

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

/* ---------------- Goal row ---------------- */

const GoalRow = ({
  goal,
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

  const submitCustom = () => {
    const amt = safeAmount(custom);
    if (!amt) return;
    onTip(amt);
    setCustom('');
  };

  return (
    <div class={classes.join(' ')}>
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
        <div class="goal-contrib-line" aria-hidden={isModel}>
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
          <select
            class="select compact"
            value={moveTo}
            onChange={(e) => setMoveTo((e.currentTarget as HTMLSelectElement).value)}
          >
            {otherGoals.map((g) => (
              <option value={g.id} key={g.id}>
                {g.title}
              </option>
            ))}
          </select>
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
  showUnlockVisual,
}: {
  state: DirectorPublicState;
  isDirector: boolean;
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
        <span>Stage</span>
        {isDirector && (
          <span class="muted small section-aside">Use the remote on the stream to call shots</span>
        )}
      </div>
      {stageUnlockVisual ? (
        <p class="stage-idle-hint muted small">
          Director calls and tips show here after the room goes LIVE.
        </p>
      ) : sorted.length === 0 ? (
        <div class="empty">
          {state.isLive
            ? 'Stage clear · waiting for the Director to call a shot.'
            : 'Activity will appear once tips start flowing.'}
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
