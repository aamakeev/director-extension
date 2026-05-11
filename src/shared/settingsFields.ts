import type { DirectorSettings } from './settings';

export type SettingsFieldKey = keyof DirectorSettings;

export type SettingsFieldDef = {
  key: SettingsFieldKey;
  label: string;
  hint: string;
  min: number;
  max?: number;
  unit: 'tk' | 'sec' | '%';
};

export const GOAL_FIELD: SettingsFieldDef = {
  key: 'preproductionGoal',
  label: 'Tokens to unlock Director Control',
  hint: 'Room tips on menu lines stack until this total unlocks Director Control.',
  min: 10,
  unit: 'tk',
};

/** Shown only when the model has a tip menu enabled. */
export const MARKUP_FIELD: SettingsFieldDef = {
  key: 'tipMenuMarkupPercent',
  label: 'Markup on each menu line',
  hint: 'e.g. 10% on 50 tk → 55 tk shown on stage.',
  min: 0,
  max: 1000,
  unit: '%',
};

export const REMOTE_FIELDS: SettingsFieldDef[] = [
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
    label: 'Activity Duration',
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
];

export const SPOTLIGHT_FIELDS: SettingsFieldDef[] = [
  {
    key: 'overtakeMargin',
    label: 'Tokens required to overtake the Director',
    hint: 'A chasing viewer needs this many tokens above the Director’s total to take the seat.',
    min: 1,
    max: 1_000,
    unit: 'tk',
  },
  {
    key: 'minTenureSec',
    label: 'Director protection',
    hint: 'After someone becomes Director they cannot be replaced for this long.',
    min: 5,
    max: 600,
    unit: 'sec',
  },
];

export const ALL_SETTINGS_FIELDS: SettingsFieldDef[] = [
  GOAL_FIELD,
  MARKUP_FIELD,
  ...REMOTE_FIELDS,
  ...SPOTLIGHT_FIELDS,
];
