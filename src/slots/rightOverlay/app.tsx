import { useEffect, useRef, useState } from 'preact/hooks';

import { COMMAND_GROUPS } from '../../shared/commands';
import { formatRemaining } from '../../shared/format';
import { resolveRole, userIdString, usernameString } from '../../shared/role';
import { directorExt, useDirectorClient } from '../../shared/useDirectorState';
import type { DirectorPublicState } from '../../shared/state';

export const App = () => {
  const { context, state, pushToast, activityInbox } = useDirectorClient();
  const [, setTick] = useState(0);
  const [cmdBusy, setCmdBusy] = useState<string>('');
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
  const isDirector = Boolean(state.director?.id && state.director.id === meId);
  const canControl = isDirector && state.isLive && !isModel && !isGuest;

  const sessionPercent = Math.min(
    100,
    (state.totalSessionTips / Math.max(1, state.preproductionGoal)) * 100,
  );
  const pressurePercent = Math.max(2, state.pressure.percent);
  const current = state.currentPerformance;
  const remaining = current ? Math.max(0, current.endsAt - Date.now()) : 0;

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

        {state.isLive && (
          <div class="remote-chair">
            <span class="chair-tag">Lead</span>
            <span class="chair-name">{state.director.name}</span>
            <span class="chair-power">{state.director.total} tk</span>
          </div>
        )}

        {isModel && state.isLive && (
          <div class="remote-meter">
            <div class="meter-label">
              <span>Lead protection</span>
              <span>
                {state.directorTenureLeftMs
                  ? formatRemaining(state.directorTenureLeftMs)
                  : 'open challenge'}
              </span>
            </div>
            <div class="meter-bar">
              <span
                style={{
                  width: `${Math.max(2, state.directorTenureLeftMs ? Math.min(100, (state.directorTenureLeftMs / Math.max(1, state.minTenureSec * 1000)) * 100) : 0)}%`,
                }}
              />
            </div>
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
