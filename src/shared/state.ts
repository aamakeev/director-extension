import type { TV1TipMenu, TV1PaymentData } from '@stripchatdev/ext-helper';

import { slugify, isObject } from './format';

export type DirectorMenuItem = {
  id: string;
  title: string;
  /** Marked-up price viewers see in Director (basePrice * (1 + markup%)). */
  price: number;
  /** Original tip-menu price set by the model in Stripchat. */
  basePrice: number;
};

export type DirectorMenuContributor = {
  userId: string;
  name: string;
  amount: number;
};

export type DirectorMenuGoal = DirectorMenuItem & {
  progress: number;
  tokensLeft: number;
  percent: number;
  /** Who put tokens toward this line (for stacked bar + copy). */
  contributors: DirectorMenuContributor[];
};

export type DirectorUser = {
  id: string;
  name: string;
  total: number;
  allocations: Record<string, number>;
};

export type DirectorLeader = {
  id: string | null;
  name: string;
  total: number;
};

export type DirectorPerformance = {
  id: string;
  commandId: string;
  label: string;
  emoji: string;
  categoryTitle: string;
  issuedById: string;
  issuedByName: string;
  issuedAt: number;
  durationMs: number;
  startedAt: number;
  endsAt: number;
};

export type DirectorQueueEntry = Omit<DirectorPerformance, 'startedAt' | 'endsAt'>;

export type DirectorPressure = {
  gap: number;
  margin: number;
  neededToOvertake: number;
  percent: number;
  isCritical: boolean;
};

export type DirectorActivity = {
  id: string;
  at: number;
  text: string;
  tone: 'info' | 'success' | 'warn' | 'spotlight';
};

/** Lightweight cross-slot activity (also sent over whisper + whisper.local). */
export type DirectorActivityKind = 'menu_goal_complete' | 'control_unlock' | 'command_start';

export type DirectorActivityBroadcast = {
  type: 'director.activity';
  id: string;
  at: number;
  kind: DirectorActivityKind;
  itemId?: string;
  itemTitle?: string;
  price?: number;
  /** Present when `kind === 'menu_goal_complete'`: who funded this line. */
  contributors?: DirectorMenuContributor[];
  commandId?: string;
  label?: string;
  emoji?: string;
  issuedByName?: string;
  directorName?: string;
  preproductionGoal?: number;
};

export type DirectorPublicState = {
  type: 'director.state';
  isLive: boolean;
  totalSessionTips: number;
  preproductionGoal: number;
  overtakeMargin: number;
  minTenureSec: number;
  commandCostTokens: number;
  director: DirectorLeader & { startedAt: number };
  challenger: DirectorLeader;
  pressure: DirectorPressure;
  directorTenureLeftMs: number;
  menuGoals: DirectorMenuGoal[];
  menuSource: 'sdk' | 'fallback';
  currentPerformance: (DirectorPerformance & { remainingMs: number }) | null;
  queue: DirectorQueueEntry[];
  commandHistory: DirectorQueueEntry[];
  commandCooldowns: Record<string, number>;
  flashAt: number;
  activityFeed: DirectorActivity[];
  updatedAt: number;
};

export type WhisperEnvelope =
  | DirectorPublicState
  | {
      type: 'director.menu.tip';
      paymentData: TV1PaymentData;
      itemId: string;
      amount: number;
      userId: string;
      username: string;
    }
  | {
      type: 'director.command.issue';
      paymentData: TV1PaymentData;
      commandId: string;
      userId: string;
      username: string;
    }
  | {
      type: 'director.menu.reallocate';
      paymentData: TV1PaymentData;
      fromItemId: string;
      toItemId: string;
      amount: number;
      userId: string;
      username: string;
    }
  | {
      type: 'director.toast';
      targetUserId: string;
      tone: 'success' | 'warn' | 'info';
      message: string;
    }
  | {
      type: 'director.self.allocations';
      targetUserId: string;
      total: number;
      allocations: Array<{ itemId: string; title: string; allocated: number }>;
    }
  | {
      type: 'director.state.request';
    }
  | {
      type: 'director.settings.updated';
    }
  | {
      type: 'director.show.reset';
      modelId: string;
    }
  | DirectorActivityBroadcast;

export const TIP_MENU_FALLBACK: DirectorMenuItem[] = [
  { id: 'fallback_closeup_25', title: 'Close-up', price: 25, basePrice: 25 },
  { id: 'fallback_dance_40', title: 'Dance', price: 40, basePrice: 40 },
  { id: 'fallback_eyes_30', title: 'Look in eyes', price: 30, basePrice: 30 },
];

/** Apply a percentage markup to each item's price. Markup is rounded to whole tk. */
export const applyMarkupToMenu = (
  items: DirectorMenuItem[],
  markupPercent: number,
): DirectorMenuItem[] => {
  const factor = 1 + Math.max(0, markupPercent) / 100;
  return items.map((item) => ({
    ...item,
    price: Math.max(item.basePrice, Math.round(item.basePrice * factor)),
  }));
};

export const tipMenuToItems = (tipMenu: TV1TipMenu | null | undefined): DirectorMenuItem[] => {
  if (!tipMenu || !tipMenu.isEnabled || !Array.isArray(tipMenu.items)) {
    return [];
  }
  const seen = new Set<string>();
  const items: DirectorMenuItem[] = [];
  tipMenu.items.forEach((item, index) => {
    const activity = String(item?.activity || '').trim();
    const price = Math.max(0, Math.floor(Number(item?.price || 0)));
    if (!activity || !price) return;
    let id = slugify(`${activity}_${price}`, `tip_${index}`);
    let suffix = 0;
    while (seen.has(id)) {
      suffix += 1;
      id = `${id}_${suffix}`;
    }
    seen.add(id);
    items.push({ id, title: activity, price, basePrice: price });
  });
  return items;
};

export const isWhisperEnvelope = (data: unknown): data is WhisperEnvelope => {
  if (!isObject(data)) return false;
  const t = data.type;
  return typeof t === 'string' && t.startsWith('director.');
};
