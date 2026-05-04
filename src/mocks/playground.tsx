import { useEffect, useMemo, useState } from 'preact/hooks';

import { App as MainApp } from '../slots/mainGameFun/app';
import { App as OverlayApp } from '../slots/rightOverlay/app';
import { App as SettingsApp } from '../slots/settings/app';

import { mockBus } from './extHelperMock';
import { SCENARIOS, type Scenario } from './scenarios';

import '../slots/mainGameFun/main.css';
import '../slots/rightOverlay/main.css';
import '../slots/settings/main.css';
import './playground.css';

type Role = 'guest' | 'viewer' | 'director' | 'model';
type Theme = 'dark' | 'light';
type Slot = 'tab' | 'overlay' | 'settings';

const SELF_USER = {
  guest: { id: 0, isGuest: true, isModel: false, username: 'Guest' },
  viewer: { id: 'u-self', isGuest: false, isModel: false, username: 'me_viewer' },
  director: { id: 'u1', isGuest: false, isModel: false, username: 'rose_taker' },
  model: { id: 'm1', isGuest: false, isModel: true, username: 'the_model' },
};

const buildContext = (role: Role) => ({
  user: SELF_USER[role],
  model: { id: 'm1', username: 'the_model' },
  room: { id: 'r1' },
});

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

  // Apply theme to <html>.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Wire mock request handlers once.
  useEffect(() => {
    mockBus.setRequest('v1.ext.context.get', () => buildContext(role));
    mockBus.setRequest('v1.tipMenu.get', () => ({
      tipMenu: {
        isEnabled: true,
        items: [
          { activity: 'Close-up', price: 25 },
          { activity: 'Dance', price: 40 },
          { activity: 'Look in eyes', price: 30 },
        ],
      },
    }));
    mockBus.setRequest('v1.monitoring.report.error', () => undefined);
    mockBus.setRequest('v1.monitoring.report.log', () => undefined);
    mockBus.setRequest('v1.chat.message.send', () => undefined);
    mockBus.setRequest('v1.ext.signup.open', () => {
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: String(SELF_USER[role].id),
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
    mockBus.setRequest('v1.model.ext.settings.set', (payload) => {
      const p = payload as { settings: typeof savedSettings; isError?: boolean };
      if (!p.isError) savedSettings = p.settings;
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: String(SELF_USER[role].id),
        tone: p.isError ? 'warn' : 'success',
        message: p.isError ? '[mock] save blocked: invalid' : '[mock] settings saved',
      });
      return undefined;
    });

    mockBus.setRequest('v1.ext.whisper', (payload) => {
      const p = payload as { data?: { type?: string } };
      if (!p?.data) return undefined;
      // The viewer mock asks for state — re-broadcast the active scenario.
      if (p.data.type === 'director.state.request') {
        broadcastActive();
      }
      // Surface as a toast so it is visible we received it.
      if (p.data.type === 'director.menu.tip' || p.data.type === 'director.command.issue') {
        mockBus.emit('v1.ext.whispered', {
          type: 'director.toast',
          targetUserId: String(SELF_USER[role].id),
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
        userId: String(SELF_USER[role].id),
      };
      // Notify viewer-bg-style listeners.
      mockBus.emit('v1.payment.tokens.spend.succeeded', {
        tokensAmount: p.tokensAmount,
        tokensSpendData: p.tokensSpendData,
        paymentData: data,
      });
      // And confirm via toast so the user sees something happened.
      mockBus.emit('v1.ext.whispered', {
        type: 'director.toast',
        targetUserId: String(SELF_USER[role].id),
        tone: 'success',
        message: `[mock] spent ${p.tokensAmount} tk`,
      });
      return undefined;
    });
  }, [role]);

  // Re-broadcast scenario state + context every time something changes.
  const broadcastActive = () => {
    mockBus.emit('v1.ext.context.updated', { context: buildContext(role) });
    mockBus.emit('v1.ext.whispered', { ...scenario.state, updatedAt: Date.now() });

    // For non-guest, non-model roles, send a sensible self-allocations snapshot
    // so the goal-card highlights are visible without a manual trigger.
    const me = SELF_USER[role];
    if (!me.isGuest && !me.isModel) {
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
        targetUserId: String(me.id),
        total,
        allocations: allocs,
      });
    }
  };

  useEffect(() => {
    // small delay to let Apps mount their subscribers
    const id = setTimeout(broadcastActive, 50);
    return () => clearTimeout(id);
  }, [scenarioId, role]);

  const fireToast = () => {
    mockBus.emit('v1.ext.whispered', {
      type: 'director.toast',
      targetUserId: String(SELF_USER[role].id),
      tone: 'success',
      message: `Toast #${toastSeq++}`,
    });
  };

  const fireSelfAllocations = () => {
    mockBus.emit('v1.ext.whispered', {
      type: 'director.self.allocations',
      targetUserId: String(SELF_USER[role].id),
      total: 45,
      allocations: [
        { itemId: 'g1', title: 'Close-up', allocated: 25 },
        { itemId: 'g2', title: 'Dance', allocated: 20 },
      ],
    });
  };

  return (
    <div class="pg-shell">
      <aside class="pg-side">
        <h1>Director playground</h1>
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
            {(['guest', 'viewer', 'director', 'model'] as Role[]).map((r) => (
              <button
                type="button"
                key={r}
                class={`pg-pill${role === r ? ' is-on' : ''}`}
                onClick={() => setRole(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div class="pg-tip">
            "director" = signed-in viewer whose id matches the scenario's leader.
          </div>
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
              <span class="pg-row-btn-sub">Show the "Your allocations" block</span>
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
            {slot === 'settings' && <SettingsApp />}
          </div>
        </div>
      </main>
    </div>
  );
};
