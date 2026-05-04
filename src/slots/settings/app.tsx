import type { TEvents } from '@stripchatdev/ext-helper';
import { createExtHelper } from '@stripchatdev/ext-helper';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { COMMAND_GROUPS } from '../../shared/commands';
import { DEFAULT_SETTINGS, normalizeSettings, type DirectorSettings } from '../../shared/settings';
import { applyMarkupToMenu, tipMenuToItems, type DirectorMenuItem } from '../../shared/state';

const ext = createExtHelper();

type FieldKey = keyof DirectorSettings;

type FieldDef = {
  key: FieldKey;
  label: string;
  hint: string;
  min: number;
  /** Optional upper cap. Omit for "no maximum". */
  max?: number;
  unit: 'tk' | 'sec' | '%';
};

type FieldGroup = {
  id: string;
  title: string;
  /** Optional; omit for title-only sections. */
  intro?: string;
  fields: FieldDef[];
  preview?: 'cost' | 'protection';
};

/** Unlock goal + menu markup — one explainer, two fields. */
const UNLOCK_FIELDS: FieldDef[] = [
  {
    key: 'preproductionGoal',
    label: 'Tokens to unlock Director',
    hint: 'Room total across menu tips; no maximum.',
    min: 10,
    unit: 'tk',
  },
  {
    key: 'tipMenuMarkupPercent',
    label: 'Markup on each menu item',
    hint: 'e.g. 10% on 50 tk → 55 tk in Director.',
    min: 0,
    max: 200,
    unit: '%',
  },
];

const GROUPS: FieldGroup[] = [
  {
    id: 'control',
    title: '2 · Director control',
    preview: 'cost',
    fields: [
      {
        key: 'commandCostTokens',
        label: 'Cost per command press',
        hint: 'What the Director pays each time they tap a command on the remote.',
        min: 1,
        max: 100,
        unit: 'tk',
      },
      {
        key: 'commandDurationSec',
        label: 'Approximate duration of each command',
        hint: 'Roughly how long you stay in the requested vibe before moving on.',
        min: 5,
        max: 300,
        unit: 'sec',
      },
      {
        key: 'commandCooldownSec',
        label: 'Pause before the same command repeats',
        hint: 'Stops viewers from spamming the same command back-to-back.',
        min: 1,
        max: 120,
        unit: 'sec',
      },
    ],
  },
  {
    id: 'race',
    title: '3 · Leader race',
    preview: 'protection',
    fields: [
      {
        key: 'overtakeMargin',
        label: 'Tokens required to overtake the leader',
        hint: 'A challenger needs this many tokens above the leader\u2019s total to take the chair.',
        min: 1,
        max: 1_000,
        unit: 'tk',
      },
      {
        key: 'minTenureSec',
        label: 'Lead protection',
        hint: 'After taking the chair the Director is safe for this long. Shown to the Director and viewers as a countdown.',
        min: 5,
        max: 600,
        unit: 'sec',
      },
    ],
  },
];

const ALL_FIELDS: FieldDef[] = [...UNLOCK_FIELDS, ...GROUPS.flatMap((g) => g.fields)];

const toForm = (settings: DirectorSettings): Record<FieldKey, string> => ({
  tipMenuMarkupPercent: String(settings.tipMenuMarkupPercent),
  preproductionGoal: String(settings.preproductionGoal),
  overtakeMargin: String(settings.overtakeMargin),
  minTenureSec: String(settings.minTenureSec),
  commandDurationSec: String(settings.commandDurationSec),
  commandCooldownSec: String(settings.commandCooldownSec),
  commandCostTokens: String(settings.commandCostTokens),
});

export const App = () => {
  const [form, setForm] = useState<Record<FieldKey, string>>(toForm(DEFAULT_SETTINGS));
  const [loaded, setLoaded] = useState(false);
  const [tipMenu, setTipMenu] = useState<DirectorMenuItem[]>([]);

  const errors = useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {};
    ALL_FIELDS.forEach((field) => {
      const raw = form[field.key];
      const num = Number(raw);
      if (!raw.trim()) {
        out[field.key] = 'Required';
      } else if (!Number.isFinite(num) || !Number.isInteger(num)) {
        out[field.key] = 'Whole number';
      } else if (num < field.min) {
        out[field.key] = `Min ${field.min}`;
      } else if (field.max !== undefined && num > field.max) {
        out[field.key] = `Max ${field.max}`;
      }
    });
    return out;
  }, [form]);

  const isError = Object.keys(errors).length > 0;

  const formRef = useRef(form);
  const isErrorRef = useRef(isError);
  formRef.current = form;
  isErrorRef.current = isError;

  useEffect(() => {
    let cancelled = false;
    void ext
      .makeRequest('v1.model.ext.settings.get', null)
      .then((res) => {
        if (cancelled) return;
        setForm(toForm(normalizeSettings(res.settings)));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });

    void ext
      .makeRequest('v1.tipMenu.get', null)
      .then((res) => {
        if (cancelled) return;
        setTipMenu(tipMenuToItems(res?.tipMenu ?? null));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onSaveRequested = async (_payload: TEvents['v1.model.ext.settings.set.requested']) => {
      const current = formRef.current;
      const currentIsError = isErrorRef.current;
      const settings: DirectorSettings = {
        tipMenuMarkupPercent: Number(current.tipMenuMarkupPercent),
        preproductionGoal: Number(current.preproductionGoal),
        overtakeMargin: Number(current.overtakeMargin),
        minTenureSec: Number(current.minTenureSec),
        commandDurationSec: Number(current.commandDurationSec),
        commandCooldownSec: Number(current.commandCooldownSec),
        commandCostTokens: Number(current.commandCostTokens),
      };
      await ext.makeRequest('v1.model.ext.settings.set', {
        isError: currentIsError,
        settings: currentIsError ? normalizeSettings(settings) : settings,
      });
      if (!currentIsError) {
        await ext
          .makeRequest('v1.ext.whisper.local', {
            data: { type: 'director.settings.updated' },
          })
          .catch(() => undefined);
      }
    };

    ext.subscribe('v1.model.ext.settings.set.requested', onSaveRequested);
    return () => {
      ext.unsubscribe('v1.model.ext.settings.set.requested', onSaveRequested);
    };
  }, []);

  const updateField = (key: FieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const cost = Number(form.commandCostTokens) || 0;
  const duration = Number(form.commandDurationSec) || 0;
  const cooldown = Number(form.commandCooldownSec) || 0;
  const tenure = Number(form.minTenureSec) || 0;
  const overtake = Number(form.overtakeMargin) || 0;

  const markupPercent = Number(form.tipMenuMarkupPercent) || 0;

  return (
    <div class="settings-shell">
      {!loaded && <div class="banner">Loading…</div>}

      <HowItWorks
        tipMenu={tipMenu}
        markupPercent={markupPercent}
        form={form}
        errors={errors}
        onField={updateField}
      />

      {GROUPS.map((group) => (
        <section class="settings-section" key={group.id}>
          <header class="settings-section-head">
            <h2>{group.title}</h2>
            {group.intro ? <p>{group.intro}</p> : null}
          </header>

          {group.preview === 'cost' && (
            <RemoteControlPreview cost={cost} duration={duration} cooldown={cooldown} />
          )}
          {group.preview === 'protection' && (
            <RaceBoardPreview margin={overtake} tenure={tenure} />
          )}

          <div class="settings-fields">
            {group.fields.map((field) => (
              <div
                class={`field${errors[field.key] ? ' is-invalid' : ''}`}
                key={field.key}
              >
                <label for={`f_${field.key}`}>{field.label}</label>
                <div class="input-wrap">
                  <input
                    id={`f_${field.key}`}
                    type="number"
                    min={field.min}
                    {...(field.max !== undefined ? { max: field.max } : {})}
                    step="1"
                    value={form[field.key]}
                    onInput={(e) =>
                      updateField(field.key, (e.currentTarget as HTMLInputElement).value)
                    }
                  />
                  <span class="unit">{field.unit}</span>
                </div>
                {errors[field.key] ? (
                  <span class="err">{errors[field.key]}</span>
                ) : (
                  <span class="hint">{field.hint}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

/* ---------------- "How it works" intro ---------------- */

const HOWTO_FALLBACK: DirectorMenuItem[] = [
  { id: 'ex1', title: 'Close-up', price: 25, basePrice: 25 },
  { id: 'ex2', title: 'Dance', price: 50, basePrice: 50 },
  { id: 'ex3', title: 'Look in eyes', price: 30, basePrice: 30 },
];

/** Sample viewer names — shows different people tipping part of the same goal. */
const PARTIAL_DEMO_NAMES = ['Luna_Rose', 'M_K', 'Jaxxx17'] as const;

const HowItWorks = ({
  tipMenu,
  markupPercent,
  form,
  errors,
  onField,
}: {
  tipMenu: DirectorMenuItem[];
  markupPercent: number;
  form: Record<FieldKey, string>;
  errors: Partial<Record<FieldKey, string>>;
  onField: (key: FieldKey, value: string) => void;
}) => {
  const baseSlice = tipMenu.length > 0 ? tipMenu.slice(0, 1) : HOWTO_FALLBACK.slice(0, 1);
  const withMarkup = applyMarkupToMenu(baseSlice, markupPercent);
  const demo = withMarkup[0]!;
  const p = demo.price;
  const tipA = p < 3 ? p : Math.max(1, Math.floor(p / 3));
  const tipB = p < 3 ? 0 : Math.max(1, Math.floor((p - tipA) / 2));
  const tipC = p < 3 ? 0 : p - tipA - tipB;
  const chipSteps = tipB > 0 ? (tipC > 0 ? 3 : 2) : 1;

  return (
    <section class="settings-section">
      <header class="settings-section-head">
        <h2>1 · Unlock and menu pricing</h2>
      </header>

      <p class="sr-only">
        Different viewers can send partial tips toward the same menu line until the Director price
        is met. Prices include a markup over your tip menu. When the room reaches your token goal,
        the Director control unlocks.
      </p>

      <div class="pricing-anim" data-pa-chips={String(chipSteps)} aria-hidden="true">
        <div class="pricing-anim-top">
          <span class="pa-item">{demo.title}</span>
          <div class="pa-compare">
            {demo.basePrice < demo.price ? (
              <>
                <span class="pa-base">{demo.basePrice} tk</span>
                <span class="pa-arrow" aria-hidden="true">
                  →
                </span>
                <span class="pa-director">{demo.price} tk</span>
              </>
            ) : (
              <span class="pa-flat">{demo.price} tk</span>
            )}
          </div>
        </div>

        <div class="pa-bar-wrap">
          <div class="pa-bar">
            <div class="pa-bar-fill" />
          </div>
          <span class="pa-tip pa-tip-a">
            <span class="pa-tip-nick">{PARTIAL_DEMO_NAMES[0]}</span>
            <span class="pa-tip-amt">+{tipA}</span>
          </span>
          {tipB > 0 ? (
            <span class="pa-tip pa-tip-b">
              <span class="pa-tip-nick">{PARTIAL_DEMO_NAMES[1]}</span>
              <span class="pa-tip-amt">+{tipB}</span>
            </span>
          ) : null}
          {tipC > 0 ? (
            <span class="pa-tip pa-tip-c">
              <span class="pa-tip-nick">{PARTIAL_DEMO_NAMES[2]}</span>
              <span class="pa-tip-amt">+{tipC}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div class="settings-fields settings-fields-unlock">
        {UNLOCK_FIELDS.map((field) => (
          <div class={`field${errors[field.key] ? ' is-invalid' : ''}`} key={field.key}>
            <label for={`f_${field.key}`}>{field.label}</label>
            <div class="input-wrap">
              <input
                id={`f_${field.key}`}
                type="number"
                min={field.min}
                {...(field.max !== undefined ? { max: field.max } : {})}
                step="1"
                value={form[field.key]}
                onInput={(e) => onField(field.key, (e.currentTarget as HTMLInputElement).value)}
              />
              <span class="unit">{field.unit}</span>
            </div>
            {errors[field.key] ? (
              <span class="err">{errors[field.key]}</span>
            ) : (
              <span class="hint">{field.hint}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

/* ---------------- Visual previews ---------------- */

const DECK_DEMO_COMMANDS = COMMAND_GROUPS.flatMap((g) => g.commands).slice(0, 6);

const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

const RemoteControlPreview = ({
  cost,
  duration,
  cooldown,
}: {
  cost: number;
  duration: number;
  cooldown: number;
}) => {
  const demoCmd = COMMAND_GROUPS.flatMap((g) => g.commands).find((c) => c.id === 'visual_closeup')
    ?? DECK_DEMO_COMMANDS[0]!;
  return (
    <>
      <p class="sr-only">
        Sample on-stream remote: status screen, per-call price, command keys; one key shows a
        cooldown timer.
      </p>
      <div class="deck-preview" aria-hidden="true">
        <div class="deck-remote">
          <div class="deck-top">
            <span class="deck-brand">Director</span>
            <span class="deck-rec deck-rec--on">
              <span class="deck-led" />
              On air
            </span>
          </div>

          <div class="deck-screen">
            <span class="deck-screen-label">Now playing</span>
            <span class="deck-screen-line">
              <span class="deck-screen-emoji">{demoCmd.emoji}</span>
              <span>{demoCmd.label}</span>
              <span class="deck-screen-timer">{fmtClock(duration)}</span>
            </span>
          </div>

          <div class="deck-pad-head">
            <span class="deck-pad-title">Control</span>
            <span class="deck-pad-cost">
              {cost || '–'} tk <span class="deck-pad-slash">/</span> call
            </span>
          </div>

          <div class="deck-grid">
            {DECK_DEMO_COMMANDS.map((cmd) => {
              const onCd = cmd.id === 'sound_whisper';
              return (
                <button
                  type="button"
                  class={`deck-key${onCd ? ' deck-key--cool' : ''}`}
                  disabled
                  key={cmd.id}
                >
                  <span class="deck-key-emoji">{cmd.emoji}</span>
                  <span class="deck-key-label">{cmd.label}</span>
                  {onCd ? <span class="deck-key-cd">{cooldown || '–'}s</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};

const RaceBoardPreview = ({ margin, tenure }: { margin: number; tenure: number }) => {
  const m = Math.max(1, margin);
  const chaseTk = 220;
  const leadTk = chaseTk + m;
  const chasePct = Math.min(100, (chaseTk / Math.max(leadTk, 1)) * 100);
  const shieldPct =
    tenure > 0
      ? Math.min(94, Math.max(30, Math.round(90 - Math.min(tenure, 180) * 0.28)))
      : 58;
  return (
    <>
      <p class="sr-only">
        Sample leader board: lead versus chase totals, gap to overtake, and lead protection
        countdown.
      </p>
      <div class="race-preview" aria-hidden="true">
        <div class="race-row">
          <div class="race-card race-card--lead">
            <span class="race-mini">Lead</span>
            <span class="race-name">River</span>
            <span class="race-tk">{leadTk} tk</span>
          </div>
          <span class="race-vs">vs</span>
          <div class="race-card">
            <span class="race-mini">Chase</span>
            <span class="race-name">Sky</span>
            <span class="race-tk">{chaseTk} tk</span>
          </div>
        </div>
        <div class="race-pressure">
          <div class="race-pressure-track">
            <span style={{ width: `${chasePct}%` }} />
          </div>
          <span class="race-gap-num">+{m} tk</span>
        </div>
        <div class="race-shield">
          <div class="race-shield-track">
            <span style={{ width: `${shieldPct}%` }} />
          </div>
          <span class="race-shield-time">0:{String(Math.max(0, tenure)).padStart(2, '0')}</span>
        </div>
      </div>
    </>
  );
};
