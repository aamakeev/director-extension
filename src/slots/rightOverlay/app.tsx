import { useEffect, useRef, useState } from 'preact/hooks';

import { COMMAND_GROUPS } from '../../shared/commands';
import { chairCatchUpTokens } from '../../shared/chairBite';
import { formatRemaining } from '../../shared/format';
import { resolveRole, userIdString, usernameString } from '../../shared/role';
import { directorExt, useDirectorClient } from '../../shared/useDirectorState';
import type { DirectorPublicState } from '../../shared/state';

export const App = () => {
  const { context, state, selfAllocations, pushToast, activityInbox } = useDirectorClient();
  const [, setTick] = useState(0);
  const [cmdBusy, setCmdBusy] = useState<string>('');
  const [biteBusy, setBiteBusy] = useState(false);
  const [actFlash, setActFlash] = useState(false);
  const lastActId = useRef<string>('');

  useEffect(() => {
    const last = activityInbox[activityInbox.length - 1];
    if (!last || last.id === lastActId.current) return;
    lastActId.current = last.id;
    setActFlash(true);
    const t = window.setTimeout(() => setActFlash(false), 640);
    return () => window.clearTimeout(t);
  }, [activityInbox]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 500);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return (
      <div class="overlay-shell">
        <div class={`remote${actFlash ? ' is-activity-flash' : ''}`}>
          <div class="remote-top">
            <span class="remote-brand">Director</span>
            <span class="remote-rec">
              <span class="led" />
              SYNC
            </span>
          </div>
          <div class="remote-screen">
            <span class="screen-label">Status</span>
            <span class="screen-empty">Connecting…</span>
          </div>
        </div>
      </div>
    );
  }

  const meId = userIdString(context.user);
  const meName = usernameString(context.user);
  const role = resolveRole(context);
  const isModel = role === 'model';
  const isGuest = role === 'guest';
  const isDirector = Boolean(state.isLive && state.director?.id && state.director.id === meId);
  const canControl = isDirector && state.isLive && !isModel && !isGuest;

  const sessionPercent = Math.min(
    100,
    (state.totalSessionTips / Math.max(1, state.preproductionGoal)) * 100,
  );
  const pressurePercent = Math.max(2, state.pressure.percent);
  const current = state.currentPerformance;
  const remaining = current ? Math.max(0, current.endsAt - Date.now()) : 0;

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
  const chairFromZero =
    openChairRace && !isModel
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

  const sendCommand = async (commandId: string) => {
    if (!canControl || cmdBusy || !meId) return;
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
    } catch (_err) {
      pushToast({ tone: 'warn', message: 'Payment cancelled' });
    } finally {
      setCmdBusy('');
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

  return (
      <div class="overlay-shell">
        <div class={`remote${canControl ? ' is-armed' : ' is-locked'}${actFlash ? ' is-activity-flash' : ''}`}>
        <div class="remote-top">
          <span class="remote-brand">Director</span>
          <span class={`remote-rec${state.isLive ? ' is-on' : ''}`}>
            <span class="led" />
            {state.isLive ? 'On air' : 'Standby'}
          </span>
        </div>

        <div class="remote-screen">
          {isModel ? (
            <ModelScreen state={state} />
          ) : current ? (
            <>
              <span class="screen-label">Now playing</span>
              <span class="screen-line">
                <span class="emoji">{current.emoji}</span>
                <span>{current.label}</span>
                <span class="screen-countdown">{formatRemaining(remaining)}</span>
              </span>
              <span class="screen-sub">by {current.issuedByName}</span>
            </>
          ) : state.isLive ? (
            <>
              <span class="screen-label">Stage</span>
              <span class="screen-line">Clear · awaiting call</span>
            </>
          ) : (
            <>
              <span class="screen-label">Pre-show</span>
              <span class="screen-line">
                {state.totalSessionTips}
                <span class="screen-sub">/ {state.preproductionGoal} tk</span>
              </span>
              <span class="screen-sub">Funding the opening shot</span>
            </>
          )}
        </div>

        {!state.isLive && (
          <div class="remote-meter">
            <div class="meter-label">
              <span>{isModel ? 'Opening goal' : 'Opening'}</span>
              <span>{Math.round(sessionPercent)}%</span>
            </div>
            <div class="meter-bar">
              <span style={{ width: `${sessionPercent}%` }} />
            </div>
          </div>
        )}

        {state.isLive && state.director.id && (
          <div class="remote-chair">
            <span class="chair-tag">Lead</span>
            <span class="chair-name">{state.director.name}</span>
            <span class="chair-power">{state.director.total} tk</span>
          </div>
        )}

        {tenureActive && (
          <div class="remote-meter remote-meter--shield">
            <div class="meter-label">
              <span>Lead safe</span>
              <span>{formatRemaining(state.directorTenureLeftMs)}</span>
            </div>
            <div class="meter-bar meter-bar--shield">
              <span style={{ width: `${shieldPct}%` }} />
            </div>
          </div>
        )}

        {openChairRace && (
          <div class="remote-open-seat">
            <div class="open-seat-title">Open challenge</div>
            <p class="open-seat-copy">
              Lead immunity is off. Overtake <strong>{state.director.name}</strong> by{' '}
              <strong>{state.overtakeMargin} tk</strong> in session tips to take Director.
            </p>
            {!isModel && isGuest && chairFromZero > 0 ? (
              <div class="open-seat-actions">
                <p class="guest-banana">
                  From zero: <strong>{chairFromZero} tk</strong> to lead — sign in to tip.
                </p>
                <button type="button" class="bite-btn" onClick={openSignUp}>
                  Sign in
                </button>
              </div>
            ) : !isModel && !isGuest && !isDirector && biteNeed > 0 ? (
              <div class="open-seat-actions">
                <p class="open-seat-you">
                  You need <strong>{biteNeed} tk</strong> more on your session total.
                </p>
                <button
                  type="button"
                  class="bite-btn"
                  disabled={biteBusy}
                  onClick={() => void sendChairBite()}
                >
                  {biteBusy ? '…' : `Take chair · ${biteNeed} tk`}
                </button>
              </div>
            ) : !isModel && isDirector && openChairRace ? (
              <p class="open-seat-foot">You hold the chair — defend your lead.</p>
            ) : isModel && openChairRace ? (
              <p class="open-seat-foot">Immunity off · viewers can flip the lead.</p>
            ) : null}
          </div>
        )}

        {/* ---------- Control pad (hidden for the model) ---------- */}
        {!isModel && (
        <div class="remote-pad">
          <div class="pad-head">
            {canControl ? (
              <>
                <span class="pad-title">Control</span>
                <span class="pad-cost">{state.commandCostTokens} tk / call</span>
              </>
            ) : (
              <>
                <span class="pad-title">
                  <span class="lock">🔒</span> Locked
                </span>
                <span class="pad-cost">
                  {!state.isLive
                    ? 'Unlocks when LIVE'
                    : isModel
                      ? 'Audience-only control'
                      : 'Top tipper unlocks'}
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
                  onClick={() => sendCommand(cmd.id)}
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

        {state.isLive && state.challenger.id ? (
          <div class="remote-meter remote-meter--bottom">
            <div class="meter-label">
              <span>{state.challenger.name}</span>
              <span>
                {state.pressure.isCritical
                  ? `−${state.pressure.neededToOvertake}`
                  : `${state.pressure.neededToOvertake} tk`}
              </span>
            </div>
            <div
              class={`meter-bar is-pressure${state.pressure.isCritical ? ' is-critical' : ''}`}
            >
              <span style={{ width: `${pressurePercent}%` }} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

const ModelScreen = ({ state }: { state: DirectorPublicState }) => {
  if (!state.isLive) {
    return (
      <>
        <span class="screen-label">Pre-show · waiting</span>
        <span class="screen-line">
          {state.totalSessionTips}
          <span class="screen-sub">/ {state.preproductionGoal} tk</span>
        </span>
        <span class="screen-sub">Show opens when viewers fill the goal</span>
      </>
    );
  }
  if (!state.director.id) {
    return (
      <>
        <span class="screen-label">LIVE · no leader</span>
        <span class="screen-line">Waiting…</span>
      </>
    );
  }
  return (
    <>
      <span class="screen-label">LIVE · Director</span>
      <span class="screen-line">
        <span>🎬 {state.director.name}</span>
      </span>
      <span class="screen-sub">
        {state.director.total} tk on chair
        {state.directorTenureLeftMs
          ? ` · ${formatRemaining(state.directorTenureLeftMs)} safe`
          : ' · open challenge'}
      </span>
    </>
  );
};
