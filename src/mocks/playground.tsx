import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { TV1ExtUser } from '@stripchatdev/ext-helper';

import { App as MainApp } from '../slots/mainGameFun/app';
import { App as OverlayApp } from '../slots/rightOverlay/app';
import { App as SettingsApp } from '../slots/settings/app';

import { whisperSelfId } from '../shared/role';

import { mockBus } from './extHelperMock';
import { getSdkTipMenuForScenario, SCENARIOS, type Scenario } from './scenarios';

import '../slots/mainGameFun/main.css';
import '../slots/rightOverlay/main.css';
import '../slots/settings/main.css';
import './playground.css';

type Role = 'guest' | 'viewer' | 'director' | 'model';
type Theme = 'dark' | 'light';
type Slot = 'tab' | 'overlay' | 'settings';
type RoleAvailability = Record<Role, { enabled: boolean; reason?: string }>;

const SELF_USER = {
  guest: { isGuest: true, guestHash: 'mock_guest' },
  viewer: { id: 'u-self', isGuest: false, isModel: false, username: 'me_viewer' },
  director: { id: 'u1', isGuest: false, isModel: false, username: 'rose_taker' },
  model: { id: 'm1', isGuest: false, isModel: true, username: 'the_model' },
} as unknown as Record<Role, TV1ExtUser>;

const selfWhisperTarget = (role: Role) => whisperSelfId(SELF_USER[role]);

const buildContext = (role: Role) => ({
  user: SELF_USER[role],
  model: { id: 'm1', username: 'the_model' },
  room: { id: 'r1' },
});

const getRoleAvailability = (scenario: Scenario): RoleAvailability => {
  const hasDirector = Boolean(scenario.state.isLive && scenario.state.director.id);
  return {
    guest: { enabled: true },
    viewer: { enabled: true },
    model: { enabled: true },
    director: hasDirector
      ? { enabled: true }
      : {
          enabled: false,
          reason: scenario.state.isLive
            ? 'No director in this snapshot'
            : 'Director seat does not exist before we are LIVE',
        },
  };
};

const pickFallbackRole = (availability: RoleAvailability): Role => {
  const order: Role[] = ['viewer', 'guest', 'model', 'director'];
  return order.find((r) => availability[r].enabled) ?? 'viewer';
};

let toastSeq = 1;

export const Playground = () => {
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0]!.id);
  const [role, setRole] = useState<Role>('viewer');
  const [theme, setTheme] = useState<Theme>('dark');
  const [slot, setSlot] = useState<Slot>('tab');
  const [overlayBg, setOverlayBg] = useState<'stream' | 'dark' | 'light'>('stream');

  const scenario = useMemo<Scenario>(
    () => SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!,
    [scenarioId],
  );
  const roleAvailability = useMemo(() => getRoleAvailability(scenario), [scenario]);

  useEffect(() => {
    if (roleAvailability[role].enabled) return;
    setRole(pickFallbackRole(roleAvailability));
  }, [role, roleAvailability]);

  useEffect(() => {
    if (role === 'model' && slot === 'overlay') setSlot('tab');
  }, [role, slot]);

  // Apply theme to <html>.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const broadcastActive = useCallback(() => {
    mockBus.emit('v1.ext.context.updated', { context: buildContext(role) });
    mockBus.emit('v1.ext.whispered', { ...scenario.state, updatedAt: Date.now() });

    if (role === 'viewer' || role === 'director' || role === 'model') {
      const goals = scenario.state.menuGoals;
      const allocs: Array<{ itemId: string; title: string; allocated: number }> = [];
      let total = 0;
      if (goals[0]) {
        const a = Math.min(25, goals[0].progress || 25);
        allocs.push({ itemId: goals[0].id, title: goals[0].title, allocated: a });
        total += a;
      }
      if (goals[1]) {
        const a = Math.min(15, goals[1].progress || 15);
        allocs.push({ itemId: goals[1].id, title: goals[1].title, allocated: a });
        total += a;
      }
      mockBus.emit('v1.ext.whispered', {
        type: 'director.self.allocations',
        targetUserId: selfWhisperTarget(role),
        total,
        allocations: allocs,
      });
    }
  }, [scenario, role]);

  // Wire mock handlers (re-run when scenario or role changes so closures never go stale).
  useEffect(() => {
    mockBus.setRequest('v1.ext.context.get', () => buildContext(role));
    mockBus.setRequest('v1.tipMenu.get', () => ({
      tipMenu: getSdkTipMenuForScenario(scenario),
    }));
    mockBus.setRequest('v1.monitoring.report.error', () => undefined);
    mockBus.setRequest('v1.monitoring.report.log', () => undefined);
    mockBus.setRequest('v1.chat.message.send', () => undefined);
    mockBus.setRequest('v1.ext.signup.open', () => {
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: selfWhisperTarget(role),
        tone: 'info',
        message: '[mock] sign-up modal would open',
      });
      return undefined;
    });

    let savedSettings = {
      tipMenuMarkupPercent: 10,
      preproductionGoal: scenario.state.preproductionGoal,
      overtakeMargin: scenario.state.overtakeMargin,
      minTenureSec: scenario.state.minTenureSec,
      commandDurationSec: 20,
      commandCooldownSec: 6,
      commandCostTokens: scenario.state.commandCostTokens,
    };
    mockBus.setRequest('v1.model.ext.settings.get', () => ({ settings: savedSettings }));
    mockBus.setRequest('v1.ext.settings.get', () => ({ settings: savedSettings }));
    mockBus.setRequest('v1.model.ext.settings.set', (payload) => {
      const p = payload as { settings: typeof savedSettings; isError?: boolean };
      if (!p.isError) savedSettings = p.settings;
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: selfWhisperTarget(role),
        tone: p.isError ? 'warn' : 'success',
        message: p.isError ? '[mock] save blocked: invalid' : '[mock] settings saved',
      });
      return undefined;
    });

    mockBus.setRequest('v1.ext.whisper', (payload) => {
      const p = payload as { data?: { type?: string } };
      if (!p?.data) return undefined;
      if (p.data.type === 'director.state.request') {
        broadcastActive();
      }
      if (
        p.data.type === 'director.menu.tip' ||
        p.data.type === 'director.command.issue' ||
        p.data.type === 'director.chair.chase'
      ) {
        mockBus.emit('v1.ext.whispered', {
          type: 'director.toast',
          targetUserId: selfWhisperTarget(role),
          tone: 'info',
          message: `[mock] sent ${p.data.type}`,
        });
      }
      return undefined;
    });

    mockBus.setRequest('v1.ext.whisper.local', (payload) => {
      const p = payload as { data?: unknown };
      if (p?.data) mockBus.emit('v1.ext.whispered', p.data);
      return undefined;
    });

    mockBus.setRequest('v1.payment.tokens.spend', (payload) => {
      const p = payload as { tokensAmount: number; tokensSpendData: Record<string, unknown> };
      const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const data = {
        amount: String(p.tokensAmount),
        paymentToken: 'mock_token',
        transactionId: txId,
        userId: selfWhisperTarget(role),
      };
      mockBus.emit('v1.payment.tokens.spend.succeeded', {
        tokensAmount: p.tokensAmount,
        tokensSpendData: p.tokensSpendData,
        paymentData: data,
      });
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: selfWhisperTarget(role),
        tone: 'success',
        message: `[mock] spent ${p.tokensAmount} tk`,
      });
      return undefined;
    });
  }, [role, scenario, scenarioId, broadcastActive]);

  useEffect(() => {
    const id = setTimeout(broadcastActive, 50);
    return () => clearTimeout(id);
  }, [scenarioId, role, broadcastActive]);

  const fireToast = () => {
    mockBus.emit('v1.ext.whispered', {
      type: 'director.toast',
      targetUserId: selfWhisperTarget(role),
      tone: 'success',
      message: `Toast #${toastSeq++}`,
    });
  };

  const fireSelfAllocations = () => {
    const goals = scenario.state.menuGoals;
    if (goals.length === 0) {
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: selfWhisperTarget(role),
        tone: 'warn',
        message: '[mock] No tip menu in this scenario',
      });
      return;
    }
    const g0 = goals[0]!;
    const g1 = goals[1];
    const allocations = g1
      ? [
          { itemId: g0.id, title: g0.title, allocated: Math.min(25, g0.progress || 15) },
          { itemId: g1.id, title: g1.title, allocated: Math.min(15, g1.progress || 10) },
        ]
      : [{ itemId: g0.id, title: g0.title, allocated: Math.min(40, g0.progress || 20) }];
    const total = allocations.reduce((s, x) => s + x.allocated, 0);
    mockBus.emit('v1.ext.whispered', {
      type: 'director.self.allocations',
      targetUserId: selfWhisperTarget(role),
      total,
      allocations,
    });
  };

  return (
    <div class="pg-shell">
      <aside class="pg-side">
        <h1>Stage playground</h1>
        <p class="pg-hint">Mock-only. No Stripchat. Each section drives the slots below.</p>

        <section>
          <div class="pg-label">Slot</div>
          <div class="pg-row">
            {(['tab', 'overlay', 'settings'] as Slot[]).map((s) => (
              <button
                type="button"
                key={s}
                class={`pg-pill${slot === s ? ' is-on' : ''}`}
                onClick={() => setSlot(s)}
              >
                {s === 'tab' ? 'Tab' : s === 'overlay' ? 'Right overlay' : 'Settings'}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div class="pg-label">Role</div>
          <div class="pg-row">
            {(['guest', 'viewer', 'director', 'model'] as Role[]).map((r) => {
              const availability = roleAvailability[r];
              return (
                <button
                  type="button"
                  key={r}
                  class={`pg-pill${role === r ? ' is-on' : ''}`}
                  disabled={!availability.enabled}
                  title={availability.enabled ? undefined : availability.reason}
                  onClick={() => setRole(r)}
                >
                  {r}
                </button>
              );
            })}
          </div>
          <div class="pg-tip">
            "director" = signed-in viewer whose id matches the scenario's Director.
          </div>
          {!roleAvailability.director.enabled && (
            <div class="pg-tip">Director remote is idle in this snapshot — go LIVE with a Director seat.</div>
          )}
        </section>

        <section>
          <div class="pg-label">Scenario</div>
          <div class="pg-col">
            {SCENARIOS.map((s) => (
              <button
                type="button"
                key={s.id}
                class={`pg-row-btn${scenarioId === s.id ? ' is-on' : ''}`}
                onClick={() => setScenarioId(s.id)}
              >
                <span class="pg-row-btn-title">{s.label}</span>
                <span class="pg-row-btn-sub">{s.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div class="pg-label">Theme</div>
          <div class="pg-row">
            {(['dark', 'light'] as Theme[]).map((t) => (
              <button
                type="button"
                key={t}
                class={`pg-pill${theme === t ? ' is-on' : ''}`}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {slot === 'overlay' && (
          <section>
            <div class="pg-label">Overlay backdrop</div>
            <div class="pg-row">
              {(['stream', 'dark', 'light'] as const).map((b) => (
                <button
                  type="button"
                  key={b}
                  class={`pg-pill${overlayBg === b ? ' is-on' : ''}`}
                  onClick={() => setOverlayBg(b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <div class="pg-label">Manual triggers</div>
          <div class="pg-col">
            <button class="pg-row-btn" onClick={broadcastActive}>
              <span class="pg-row-btn-title">Re-broadcast state</span>
              <span class="pg-row-btn-sub">Same as a model heartbeat</span>
            </button>
            <button class="pg-row-btn" onClick={fireToast}>
              <span class="pg-row-btn-title">Push a toast</span>
              <span class="pg-row-btn-sub">Targeted at the current self user</span>
            </button>
            <button class="pg-row-btn" onClick={fireSelfAllocations}>
              <span class="pg-row-btn-title">Set self allocations</span>
              <span class="pg-row-btn-sub">Uses current scenario menu goals (if any)</span>
            </button>
          </div>
        </section>

        <p class="pg-tip">
          "Send tip" / commands / save will fire mock requests and surface confirmation toasts.
        </p>
      </aside>

      <main class="pg-main">
        <div class={`pg-stage pg-stage--${slot} pg-stage--bg-${overlayBg}`}>
          <div class="pg-stage-frame">
            {slot === 'tab' && <MainApp />}
            {slot === 'overlay' && <OverlayApp />}
            {slot === 'settings' && <SettingsApp key={scenarioId} />}
          </div>
        </div>
      </main>
    </div>
  );
};
