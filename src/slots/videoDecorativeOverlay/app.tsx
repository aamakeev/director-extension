import { useEffect, useRef, useState } from 'preact/hooks';

import { COMMAND_GROUPS } from '../../shared/commands';
import { chairCatchUpTokens } from '../../shared/chairBite';
import { formatRemaining } from '../../shared/format';
import { resolveRole, userIdString, usernameString, whisperSelfId } from '../../shared/role';
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
            <span class="remote-brand">by Stripchat</span>
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
  const selfWhisperId = whisperSelfId(context.user);
  const meName = usernameString(context.user);
  const role = resolveRole(context);
  const isModel = role === 'model';
  const isGuest = role === 'guest';
  const isDirector = Boolean(
    state.isLive && state.director?.id && String(state.director.id) === String(selfWhisperId),
  );
  const leadIsYou = Boolean(
    state.isLive &&
      state.director.id &&
      selfWhisperId &&
      String(state.director.id) === String(selfWhisperId),
  );
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
    openChairRace && !isGuest && !isDirector && !isModel
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

  const suppressChallengerMeter =
    openChairRace && !isGuest && !isDirector && !isModel && biteNeed > 0;

  const showOpenSeatPanel =
    openChairRace &&
    ((isGuest && chairFromZero > 0) ||
      (!isGuest && !isDirector && biteNeed > 0) ||
      (!isGuest && isDirector));

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

  return (
      <div class="overlay-shell">
        <div class={`remote${canControl ? ' is-armed' : ' is-locked'}${actFlash ? ' is-activity-flash' : ''}`}>
        <div class="remote-top">
          <span class="remote-brand">by Stripchat</span>
          <span
            class={`remote-rec${state.isLive && state.gameAccepting ? ' is-on' : ''}${!state.gameAccepting ? ' is-paused' : ''}`}
          >
            <span class="led" />
            {!state.gameAccepting ? 'Paused' : state.isLive ? 'Live' : 'Not live yet'}
          </span>
        </div>

        <div class="remote-screen">
          {isModel ? (
            <ModelScreen state={state} />
          ) : !state.gameAccepting ? (
            <>
              <span class="screen-label">Paused</span>
              <span class="screen-line">Broadcaster paused Director unlock</span>
              <span class="screen-sub">Tips on menu lines still stack.</span>
            </>
          ) : current ? (
            <>
              <span class="screen-label">Happening now</span>
              <span class="screen-line">
                <span class="emoji">{current.emoji}</span>
                <span>{current.label}</span>
                <span class="screen-countdown">{formatRemaining(remaining)}</span>
              </span>
              <span class="screen-sub">by {current.issuedByName}</span>
            </>
          ) : state.isLive ? (
            isDirector ? (
              <>
                <span class="screen-label">Your turn</span>
                <span class="screen-line">Pick what happens next — tap an action below</span>
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
              <span class="screen-line">
                {state.totalSessionTips}
                <span class="screen-sub">/ {state.preproductionGoal} tk</span>
              </span>
              <span class="screen-sub">Tip the menu until the room hits the goal — then someone becomes Director</span>
            </>
          )}
        </div>

        {!state.isLive && state.gameAccepting && (
          <div class="remote-meter">
            <div class="meter-label">
              <span>{isModel ? 'Unlock target' : 'Unlock'}</span>
              <span>{Math.round(sessionPercent)}%</span>
            </div>
            <div class="meter-bar">
              <span style={{ width: `${sessionPercent}%` }} />
            </div>
          </div>
        )}

        {state.isLive && state.director.id && (
          <div class={`remote-screen remote-screen--director${leadIsYou ? ' remote-screen--director-self' : ''}`}>
            <span class="screen-label">Now steering</span>
            <span class="screen-line">
              <span class="emoji" aria-hidden="true">
                🎬
              </span>
              <span class="screen-director-name">{state.director.name}</span>
              <span>· {state.director.total} tk</span>
            </span>
            {leadIsYou ? (
              <span class="screen-sub">You spent {selfAllocations.total} tk</span>
            ) : null}
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
              <button type="button" class="bite-btn" onClick={openSignUp}>
                Sign in · {chairFromZero} tk
              </button>
            ) : !isGuest && !isDirector && biteNeed > 0 ? (
              <button
                type="button"
                class="bite-btn bite-btn--cta"
                disabled={biteBusy}
                aria-label={`Pay ${biteNeed} tk to become Director`}
                onClick={() => void sendChairBite()}
              >
                  {biteBusy ? '…' : `Become Director · ${biteNeed} tk`}
              </button>
            ) : !isGuest && isDirector ? (
              <p class="open-seat-foot">You have the remote — pick an action below when you&apos;re ready.</p>
            ) : null}
          </div>
        ) : null}

        {/* ---------- Control pad (hidden for the model) ---------- */}
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
                    ? 'Waiting for broadcaster to start'
                    : !state.isLive
                    ? 'Starts when the show goes live'
                    : isModel
                      ? 'Only viewers use this remote'
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
        <span class="screen-label">Unlock Director</span>
        <span class="screen-line">
          {state.totalSessionTips}
          <span class="screen-sub">/ {state.preproductionGoal} tk</span>
        </span>
        <span class="screen-sub">Tips below fill the bar — then the room goes live</span>
      </>
    );
  }
  if (!state.director.id) {
    return (
      <>
        <span class="screen-label">Live — no Director yet</span>
        <span class="screen-line">Waiting for someone to take the seat</span>
      </>
    );
  }
  const tenureLeft = state.directorTenureLeftMs > 0;
  if (tenureLeft) {
    return (
      <>
        <span class="screen-label">Director safe</span>
        <span class="screen-line">{formatRemaining(state.directorTenureLeftMs)}</span>
      </>
    );
  }
  const contestOpen =
    state.isLive && Boolean(state.director.id) && !state.directorTenureLeftMs;
  return (
    <>
      <span class="screen-label">Director remote</span>
      <span class="screen-line">
        {contestOpen
          ? 'Viewer can send new orders'
          : 'Last order still playing'}
      </span>
    </>
  );
};
