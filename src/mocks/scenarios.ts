import { COMMAND_BY_ID } from '../shared/commands';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type { DirectorPublicState } from '../shared/state';

const now = () => Date.now();

const baseState = (): DirectorPublicState => ({
  type: 'director.state',
  isLive: false,
  totalSessionTips: 0,
  preproductionGoal: 50,
  overtakeMargin: DEFAULT_SETTINGS.overtakeMargin,
  minTenureSec: DEFAULT_SETTINGS.minTenureSec,
  commandCostTokens: DEFAULT_SETTINGS.commandCostTokens,
  director: { id: null, name: 'Casting…', total: 0, startedAt: 0 },
  challenger: { id: null, name: 'No challenger', total: 0 },
  pressure: {
    gap: 0,
    margin: DEFAULT_SETTINGS.overtakeMargin,
    neededToOvertake: 0,
    percent: 0,
    isCritical: false,
  },
  directorTenureLeftMs: 0,
  menuGoals: [
    {
      id: 'g1',
      title: 'Close-up',
      price: 25,
      basePrice: 25,
      progress: 0,
      tokensLeft: 25,
      percent: 0,
      contributors: [],
    },
    {
      id: 'g2',
      title: 'Dance',
      price: 40,
      basePrice: 40,
      progress: 0,
      tokensLeft: 40,
      percent: 0,
      contributors: [],
    },
    {
      id: 'g3',
      title: 'Look in eyes',
      price: 30,
      basePrice: 30,
      progress: 0,
      tokensLeft: 30,
      percent: 0,
      contributors: [],
    },
  ],
  menuSource: 'fallback',
  currentPerformance: null,
  queue: [],
  commandHistory: [],
  commandCooldowns: {},
  flashAt: 0,
  activityFeed: [],
  updatedAt: now(),
});

/** Shape returned from `v1.tipMenu.get` for playground mocks */
export type ScenarioSdkTipMenu = {
  isEnabled: boolean;
  items: Array<{ activity: string; price: number }>;
};

export const DEFAULT_SCENARIO_SDK_TIP_MENU: ScenarioSdkTipMenu = {
  isEnabled: true,
  items: [
    { activity: 'Close-up', price: 25 },
    { activity: 'Dance', price: 40 },
    { activity: 'Look in eyes', price: 30 },
  ],
};

export type Scenario = {
  id: string;
  label: string;
  description: string;
  state: DirectorPublicState;
  /** Omit to use {@link DEFAULT_SCENARIO_SDK_TIP_MENU} */
  sdkTipMenu?: ScenarioSdkTipMenu;
};

export const getSdkTipMenuForScenario = (scenario: Scenario): ScenarioSdkTipMenu =>
  scenario.sdkTipMenu ?? DEFAULT_SCENARIO_SDK_TIP_MENU;

export const SCENARIOS: Scenario[] = [
  {
    id: 'preshow_empty',
    label: '1 · Pre-show, empty',
    description: 'No tips yet, casting in progress.',
    state: baseState(),
  },
  {
    id: 'preshow_partial',
    label: '2 · Pre-show, partial funding',
    description: 'Halfway to opening shot, leaderboard forming.',
    state: {
      ...baseState(),
      totalSessionTips: 28,
      director: { id: null, name: 'Casting…', total: 0, startedAt: 0 },
      challenger: { id: 'u2', name: 'velvet_42', total: 18 },
      menuGoals: [
        {
          id: 'g1',
          title: 'Close-up',
          price: 25,
          basePrice: 25,
          progress: 18,
          tokensLeft: 7,
          percent: 72,
          contributors: [
            { userId: 'u2', name: 'velvet_42', amount: 10 },
            { userId: 'u3', name: 'flame_lover', amount: 8 },
          ],
        },
        {
          id: 'g2',
          title: 'Dance',
          price: 40,
          basePrice: 40,
          progress: 8,
          tokensLeft: 32,
          percent: 20,
          contributors: [{ userId: 'u3', name: 'flame_lover', amount: 8 }],
        },
        {
          id: 'g3',
          title: 'Look in eyes',
          price: 30,
          basePrice: 30,
          progress: 2,
          tokensLeft: 28,
          percent: 7,
          contributors: [{ userId: 'u4', name: 'sky_01', amount: 2 }],
        },
      ],
      activityFeed: [
        { id: 'a1', at: now(), text: 'velvet_42 +18tk → "Close-up"', tone: 'success' },
        { id: 'a2', at: now() - 4000, text: 'flame_lover +8tk → "Dance"', tone: 'success' },
      ],
    },
  },
  {
    id: 'live_calm',
    label: '3 · LIVE, calm leader',
    description: 'Show is live, director comfortably ahead.',
    state: {
      ...baseState(),
      isLive: true,
      totalSessionTips: 220,
      director: { id: 'u1', name: 'rose_taker', total: 145, startedAt: now() - 22_000 },
      challenger: { id: 'u2', name: 'velvet_42', total: 60 },
      pressure: { gap: 85, margin: 10, neededToOvertake: 95, percent: 39, isCritical: false },
      directorTenureLeftMs: 8_000,
      menuGoals: [
        {
          id: 'g1',
          title: 'Close-up',
          price: 25,
          basePrice: 25,
          progress: 25,
          tokensLeft: 0,
          percent: 100,
          contributors: [
            { userId: 'u1', name: 'rose_taker', amount: 15 },
            { userId: 'u2', name: 'velvet_42', amount: 10 },
          ],
        },
        {
          id: 'g2',
          title: 'Dance',
          price: 40,
          basePrice: 40,
          progress: 32,
          tokensLeft: 8,
          percent: 80,
          contributors: [
            { userId: 'u1', name: 'rose_taker', amount: 20 },
            { userId: 'u2', name: 'velvet_42', amount: 12 },
          ],
        },
        {
          id: 'g3',
          title: 'Look in eyes',
          price: 30,
          basePrice: 30,
          progress: 18,
          tokensLeft: 12,
          percent: 60,
          contributors: [{ userId: 'u2', name: 'velvet_42', amount: 18 }],
        },
      ],
      activityFeed: [
        { id: 'a1', at: now(), text: 'We are LIVE. Director: rose_taker', tone: 'spotlight' },
        { id: 'a2', at: now() - 1500, text: 'rose_taker +50tk → "Dance"', tone: 'success' },
      ],
    },
  },
  {
    id: 'live_critical',
    label: '4 · LIVE, critical pressure',
    description: 'Challenger is breathing down the leader\u2019s neck.',
    state: {
      ...baseState(),
      isLive: true,
      totalSessionTips: 410,
      director: { id: 'u1', name: 'rose_taker', total: 200, startedAt: now() - 90_000 },
      challenger: { id: 'u2', name: 'velvet_42', total: 196 },
      pressure: { gap: 4, margin: 10, neededToOvertake: 14, percent: 93, isCritical: true },
      directorTenureLeftMs: 0,
      menuGoals: [
        {
          id: 'g1',
          title: 'Close-up',
          price: 25,
          basePrice: 25,
          progress: 25,
          tokensLeft: 0,
          percent: 100,
          contributors: [{ userId: 'u2', name: 'velvet_42', amount: 25 }],
        },
        {
          id: 'g2',
          title: 'Dance',
          price: 40,
          basePrice: 40,
          progress: 40,
          tokensLeft: 0,
          percent: 100,
          contributors: [
            { userId: 'u1', name: 'rose_taker', amount: 22 },
            { userId: 'u2', name: 'velvet_42', amount: 18 },
          ],
        },
        {
          id: 'g3',
          title: 'Look in eyes',
          price: 30,
          basePrice: 30,
          progress: 30,
          tokensLeft: 0,
          percent: 100,
          contributors: [
            { userId: 'u1', name: 'rose_taker', amount: 10 },
            { userId: 'u2', name: 'velvet_42', amount: 10 },
            { userId: 'u3', name: 'flame_lover', amount: 10 },
          ],
        },
      ],
      activityFeed: [
        { id: 'a1', at: now(), text: 'velvet_42 +40tk → "Close-up"', tone: 'success' },
        { id: 'a2', at: now() - 2000, text: 'Power pressure rising', tone: 'warn' },
      ],
    },
  },
  {
    id: 'live_now_playing',
    label: '5 · LIVE, command on stage',
    description: 'Whisper command playing, queue + cooldown.',
    state: {
      ...baseState(),
      isLive: true,
      totalSessionTips: 350,
      director: { id: 'u1', name: 'rose_taker', total: 180, startedAt: now() - 30_000 },
      challenger: { id: 'u2', name: 'velvet_42', total: 110 },
      pressure: { gap: 70, margin: 10, neededToOvertake: 80, percent: 50, isCritical: false },
      directorTenureLeftMs: 0,
      menuGoals: [
        {
          id: 'g1',
          title: 'Close-up',
          price: 25,
          basePrice: 25,
          progress: 25,
          tokensLeft: 0,
          percent: 100,
          contributors: [{ userId: 'u1', name: 'rose_taker', amount: 25 }],
        },
        {
          id: 'g2',
          title: 'Dance',
          price: 40,
          basePrice: 40,
          progress: 32,
          tokensLeft: 8,
          percent: 80,
          contributors: [
            { userId: 'u1', name: 'rose_taker', amount: 20 },
            { userId: 'u2', name: 'velvet_42', amount: 12 },
          ],
        },
        {
          id: 'g3',
          title: 'Look in eyes',
          price: 30,
          basePrice: 30,
          progress: 12,
          tokensLeft: 18,
          percent: 40,
          contributors: [{ userId: 'u1', name: 'rose_taker', amount: 12 }],
        },
      ],
      currentPerformance: {
        id: 'p1',
        commandId: 'sound_whisper',
        label: COMMAND_BY_ID.sound_whisper!.label,
        emoji: COMMAND_BY_ID.sound_whisper!.emoji,
        categoryTitle: 'Sound',
        issuedById: 'u1',
        issuedByName: 'rose_taker',
        issuedAt: now() - 6_000,
        durationMs: 20_000,
        startedAt: now() - 6_000,
        endsAt: now() + 14_000,
        remainingMs: 14_000,
      },
      queue: [
        {
          id: 'p2',
          commandId: 'tempo_turbo',
          label: 'Turbo',
          emoji: '\u26A1',
          categoryTitle: 'Tempo',
          issuedById: 'u1',
          issuedByName: 'rose_taker',
          issuedAt: now(),
          durationMs: 20_000,
        },
      ],
      commandHistory: [
        {
          id: 'h1',
          commandId: 'visual_closeup',
          label: 'Close-up',
          emoji: '\u{1F50D}',
          categoryTitle: 'Visual',
          issuedById: 'u1',
          issuedByName: 'rose_taker',
          issuedAt: now() - 30_000,
          durationMs: 20_000,
        },
      ],
      commandCooldowns: {
        sound_whisper: 6_000,
        visual_closeup: 2_000,
      },
      activityFeed: [
        { id: 'a1', at: now(), text: 'Director call: \u{1F910} Whisper', tone: 'spotlight' },
        { id: 'a2', at: now() - 4000, text: 'rose_taker +30tk \u2192 "Look in eyes"', tone: 'success' },
      ],
    },
  },
  {
    id: 'no_menu',
    label: '6 · LIVE, empty tip menu',
    description: 'Edge case: model removed all tip menu items.',
    sdkTipMenu: { isEnabled: true, items: [] },
    state: {
      ...baseState(),
      isLive: true,
      totalSessionTips: 60,
      director: { id: 'u1', name: 'rose_taker', total: 60, startedAt: now() - 10_000 },
      menuGoals: [],
      activityFeed: [],
    },
  },
];

export const SCENARIO_BY_ID: Record<string, Scenario> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
);
