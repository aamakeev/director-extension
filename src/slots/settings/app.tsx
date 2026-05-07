import type { TEvents, TV1TipMenu } from '@stripchatdev/ext-helper';
import { createExtHelper } from '@stripchatdev/ext-helper';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { COMMAND_GROUPS } from '../../shared/commands';
import { DEFAULT_SETTINGS, normalizeSettings, type DirectorSettings } from '../../shared/settings';
import { UNLOCK_DEMO_NAMES, chipDemoFromTotal } from '../../shared/unlockDemoChips';
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

const PREPRODUCTION_FIELD: FieldDef = {
  key: 'preproductionGoal',
  label: 'Tokens to go live',
  hint: 'Room tips on menu lines stack until this total unlocks the show and Director seat.',
  min: 10,
  unit: 'tk',
};

/** Only when `v1.tipMenu.get` returns enabled lines — models without a tip menu never see this. */
const MARKUP_FIELD: FieldDef = {
  key: 'tipMenuMarkupPercent',
  label: 'Markup on each menu line',
  hint: 'e.g. 10% on 50 tk → 55 tk shown on stage.',
  min: 0,
  max: 200,
  unit: '%',
};

const GROUPS: FieldGroup[] = [
  {
    id: 'control',
    title: '2 · Director remote',
    preview: 'cost',
    fields: [
      {
        key: 'commandCostTokens',
        label: 'Cost per command press',
        hint: 'What the Director pays each time they send an action from the remote.',
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
    title: '3 · Spotlight chase',
    preview: 'protection',
    fields: [
      {
        key: 'overtakeMargin',
        label: 'Tokens required to overtake the Director',
        hint: 'A chasing viewer needs this many tokens above the Director\u2019s total to take the seat.',
        min: 1,
        max: 1_000,
        unit: 'tk',
      },
      {
        key: 'minTenureSec',
        label: 'Director protection',
        hint: 'After someone becomes Director they cannot be replaced for this long. Everyone sees the countdown.',
        min: 5,
        max: 600,
        unit: 'sec',
      },
    ],
  },
];

const ALL_FIELDS: FieldDef[] = [PREPRODUCTION_FIELD, MARKUP_FIELD, ...GROUPS.flatMap((g) => g.fields)];

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
  const tipMenuRef = useRef(tipMenu);
  tipMenuRef.current = tipMenu;

  const hasTipMenu = tipMenu.length > 0;

  const errors = useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {};
    const fields = ALL_FIELDS.filter((field) => hasTipMenu || field.key !== 'tipMenuMarkupPercent');
    fields.forEach((field) => {
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
  }, [form, hasTipMenu]);

  const isError = Object.keys(errors).length > 0;

  const formRef = useRef(form);
  const isErrorRef = useRef(isError);
  formRef.current = form;
  isErrorRef.current = isError;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      ext.makeRequest('v1.model.ext.settings.get', null).catch(() => ({ settings: undefined })),
      ext.makeRequest('v1.tipMenu.get', null).catch(() => ({ tipMenu: null })),
    ]).then(([settingsRes, tipRes]) => {
      if (cancelled) return;
      const items = tipMenuToItems(
        tipRes && typeof tipRes === 'object' && 'tipMenu' in tipRes
          ? (tipRes as { tipMenu?: TV1TipMenu | null }).tipMenu
          : null,
      );
      setTipMenu(items);
      const normalized = normalizeSettings(
        settingsRes && typeof settingsRes === 'object' && 'settings' in settingsRes
          ? (settingsRes as { settings?: unknown }).settings
          : undefined,
      );
      setForm(
        toForm({
          ...normalized,
          tipMenuMarkupPercent: items.length === 0 ? 0 : normalized.tipMenuMarkupPercent,
        }),
      );
      setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onSaveRequested = async (_payload: TEvents['v1.model.ext.settings.set.requested']) => {
      const current = formRef.current;
      const currentIsError = isErrorRef.current;
      const menuEmpty = tipMenuRef.current.length === 0;
      const settings: DirectorSettings = {
        tipMenuMarkupPercent: menuEmpty ? 0 : Number(current.tipMenuMarkupPercent),
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
        hasTipMenu={hasTipMenu}
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

const HowItWorks = ({
  tipMenu,
  hasTipMenu,
  markupPercent,
  form,
  errors,
  onField,
}: {
  tipMenu: DirectorMenuItem[];
  hasTipMenu: boolean;
  markupPercent: number;
  form: Record<FieldKey, string>;
  errors: Partial<Record<FieldKey, string>>;
  onField: (key: FieldKey, value: string) => void;
}) => {
  const baseSlice = tipMenu.slice(0, 1);
  const withMarkup = hasTipMenu ? applyMarkupToMenu(baseSlice, markupPercent) : [];
  const demo = withMarkup[0];
  const menuChips = demo ? chipDemoFromTotal(demo.price) : null;

  const unlockGoalDemo = Math.max(
    PREPRODUCTION_FIELD.min,
    Math.floor(Number(form.preproductionGoal)) || PREPRODUCTION_FIELD.min,
  );
  const unlockChips = chipDemoFromTotal(unlockGoalDemo);

  const preproductionHint = hasTipMenu
    ? PREPRODUCTION_FIELD.hint
    : 'House tally before going live. Viewers fill the bar in the slot.';

  const renderChipBar = (tipA: number, tipB: number, tipC: number) => (
    <div class="pa-bar-wrap">
      <div class="pa-bar">
        <div class="pa-bar-fill" />
      </div>
      <span class="pa-tip pa-tip-a">
        <span class="pa-tip-nick">{UNLOCK_DEMO_NAMES[0]}</span>
        <span class="pa-tip-amt">+{tipA}</span>
      </span>
      {tipB > 0 ? (
        <span class="pa-tip pa-tip-b">
          <span class="pa-tip-nick">{UNLOCK_DEMO_NAMES[1]}</span>
          <span class="pa-tip-amt">+{tipB}</span>
        </span>
      ) : null}
      {tipC > 0 ? (
        <span class="pa-tip pa-tip-c">
          <span class="pa-tip-nick">{UNLOCK_DEMO_NAMES[2]}</span>
          <span class="pa-tip-amt">+{tipC}</span>
        </span>
      ) : null}
    </div>
  );

  return (
    <section class="settings-section">
      <header class="settings-section-head">
        <h2>{hasTipMenu ? '1 · Go live & menu pricing' : '1 · Unlock the show'}</h2>
      </header>

      {hasTipMenu ? (
        <p class="sr-only">
          Different viewers can send partial tips toward the same menu line until the on-stream price
          is met. Markup adds to your menu prices; at 0% prices match your tip menu. When the room
          reaches your token goal, the show goes live and someone becomes Director.
        </p>
      ) : (
        <p class="sr-only">
          Illustration: several viewers send partial tips; each contribution stacks toward the same
          unlock total until the show goes live.
        </p>
      )}

      {hasTipMenu && demo && menuChips ? (
        <div class="pricing-anim" data-pa-chips={String(menuChips.chipSteps)} aria-hidden="true">
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
          {renderChipBar(menuChips.tipA, menuChips.tipB, menuChips.tipC)}
        </div>
      ) : !hasTipMenu ? (
        <div class="pricing-anim" data-pa-chips={String(unlockChips.chipSteps)} aria-hidden="true">
          <div class="pricing-anim-top">
            <span class="pa-item">Room unlock</span>
            <div class="pa-compare">
              <span class="pa-flat">{unlockGoalDemo} tk</span>
            </div>
          </div>
          {renderChipBar(unlockChips.tipA, unlockChips.tipB, unlockChips.tipC)}
        </div>
      ) : null}

      <div class="settings-fields settings-fields-unlock">
        <div class={`field${errors[PREPRODUCTION_FIELD.key] ? ' is-invalid' : ''}`}>
          <label for={`f_${PREPRODUCTION_FIELD.key}`}>{PREPRODUCTION_FIELD.label}</label>
          <div class="input-wrap">
            <input
              id={`f_${PREPRODUCTION_FIELD.key}`}
              type="number"
              min={PREPRODUCTION_FIELD.min}
              step="1"
              value={form[PREPRODUCTION_FIELD.key]}
              onInput={(e) =>
                onField(PREPRODUCTION_FIELD.key, (e.currentTarget as HTMLInputElement).value)
              }
            />
            <span class="unit">{PREPRODUCTION_FIELD.unit}</span>
          </div>
          {errors[PREPRODUCTION_FIELD.key] ? (
            <span class="err">{errors[PREPRODUCTION_FIELD.key]}</span>
          ) : (
            <span class="hint">{preproductionHint}</span>
          )}
        </div>

        {hasTipMenu ? (
          <div class={`field${errors[MARKUP_FIELD.key] ? ' is-invalid' : ''}`}>
            <label for={`f_${MARKUP_FIELD.key}`}>{MARKUP_FIELD.label}</label>
            <div class="input-wrap">
              <input
                id={`f_${MARKUP_FIELD.key}`}
                type="number"
                min={MARKUP_FIELD.min}
                max={MARKUP_FIELD.max}
                step="1"
                value={form[MARKUP_FIELD.key]}
                onInput={(e) =>
                  onField(MARKUP_FIELD.key, (e.currentTarget as HTMLInputElement).value)
                }
              />
              <span class="unit">{MARKUP_FIELD.unit}</span>
            </div>
            {errors[MARKUP_FIELD.key] ? (
              <span class="err">{errors[MARKUP_FIELD.key]}</span>
            ) : (
              <span class="hint">{MARKUP_FIELD.hint}</span>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
};

/* ---------------- Visual previews ---------------- */

const DECK_DEMO_COMMANDS = COMMAND_GROUPS.flatMap((g) => g.commands);

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
            <span class="deck-brand">by Stripchat</span>
            <span class="deck-rec deck-rec--on">
              <span class="deck-led" />
              Live
            </span>
          </div>

          <div class="deck-screen">
            <span class="deck-screen-label">Happening now</span>
            <span class="deck-screen-line">
              <span class="deck-screen-emoji">{demoCmd.emoji}</span>
              <span>{demoCmd.label}</span>
              <span class="deck-screen-timer">{fmtClock(duration)}</span>
            </span>
          </div>

          <div class="deck-pad-head">
            <span class="deck-pad-title">Actions</span>
            <span class="deck-pad-cost">
              {cost || '–'} tk each
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
        Sample spotlight chase: Director versus chase totals, gap to overtake, and Director
        protection countdown.
      </p>
      <div class="race-preview" aria-hidden="true">
        <div class="race-row">
          <div class="race-card race-card--director">
            <span class="race-mini">Director</span>
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
