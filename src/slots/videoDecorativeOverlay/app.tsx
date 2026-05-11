import { useEffect, useMemo, useState } from 'preact/hooks';

import { formatRemaining } from '../../shared/format';
import { resolveRole } from '../../shared/role';
import { useDirectorClient } from '../../shared/useDirectorState';
import type { DirectorActivityBroadcast } from '../../shared/state';

/**
 * Two overlay surfaces:
 *   - HERO (model only): full-width spotlight in the top 1/3 for milestone
 *     events that demand attention or a physical response.
 *   - NOTICE (everyone): compact pill in the top-right corner for everything
 *     else — and the only surface viewers ever see.
 */
const MODEL_HERO_KINDS = new Set<DirectorActivityBroadcast['kind']>([
  'control_unlock',
  'command_start',
  'menu_goal_complete',
  'chair_chase_takeover',
]);
const MODEL_NOTICE_KINDS = new Set<DirectorActivityBroadcast['kind']>([
  'tip_received',
]);

/** Hero kinds that carry a meaningful countdown (the cue / performance window). */
const HERO_TIMER_KINDS = new Set<DirectorActivityBroadcast['kind']>([
  'command_start',
  'menu_goal_complete',
]);

/** Viewers see everything as a compact corner notice. */
const VIEWER_NOTICE_KINDS = new Set<DirectorActivityBroadcast['kind']>([
  'menu_goal_complete',
  'command_start',
  'chair_chase_takeover',
  'tip_received',
  'control_unlock',
  'game_started',
  'game_paused',
]);

const DURATION_MS: Partial<Record<DirectorActivityBroadcast['kind'], number>> = {
  tip_received: 4_500,
  chair_chase_takeover: 6_000,
  command_start: 10_000,
  menu_goal_complete: 12_000,
  control_unlock: 10_000,
  game_started: 6_000,
  game_paused: 6_000,
};
const DEFAULT_DURATION_MS = 6_000;

const durationFor = (a: DirectorActivityBroadcast): number =>
  a.durationMs ?? DURATION_MS[a.kind] ?? DEFAULT_DURATION_MS;

export const App = () => {
  const { activityInbox, context } = useDirectorClient();
  const isModel = resolveRole(context) === 'model';
  return isModel ? (
    <ModelOverlay activityInbox={activityInbox} />
  ) : (
    <ViewerOverlay activityInbox={activityInbox} />
  );
};

/* ---------- Viewer overlay: single compact notice for every kind ---------- */

const ViewerOverlay = ({
  activityInbox,
}: {
  activityInbox: DirectorActivityBroadcast[];
}) => {
  const [now, setNow] = useState(() => Date.now());

  const active = useMemo(() => {
    for (let i = activityInbox.length - 1; i >= 0; i -= 1) {
      const a = activityInbox[i]!;
      if (!VIEWER_NOTICE_KINDS.has(a.kind)) continue;
      if (a.at + durationFor(a) > now) return a;
    }
    return null;
  }, [activityInbox, now]);

  useEffect(() => {
    if (!active) return undefined;
    // 250ms tick so the notice countdown ticks smoothly.
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    setNow(Date.now());
  }, [activityInbox]);

  if (!active) return null;
  return (
    <div class="overlay-shell overlay-shell--notice">
      <ActivityNoticePill a={active} now={now} />
    </div>
  );
};

/* ---------- Model overlay: hero + notice, can co-exist ---------- */

const ModelOverlay = ({
  activityInbox,
}: {
  activityInbox: DirectorActivityBroadcast[];
}) => {
  const [now, setNow] = useState(() => Date.now());

  const activeHero = useMemo(() => {
    for (let i = activityInbox.length - 1; i >= 0; i -= 1) {
      const a = activityInbox[i]!;
      if (!MODEL_HERO_KINDS.has(a.kind)) continue;
      if (a.at + durationFor(a) > now) return a;
    }
    return null;
  }, [activityInbox, now]);

  const activeNotice = useMemo(() => {
    for (let i = activityInbox.length - 1; i >= 0; i -= 1) {
      const a = activityInbox[i]!;
      if (!MODEL_NOTICE_KINDS.has(a.kind)) continue;
      if (a.at + durationFor(a) > now) return a;
    }
    return null;
  }, [activityInbox, now]);

  // The tip that fills a menu line fires both `tip_received` and
  // `menu_goal_complete` back-to-back. Suppress the tip notice so the model
  // only sees the actionable hero ("Perform Cum") instead of two stacked
  // banners about the same event.
  const suppressNotice =
    activeHero?.kind === 'menu_goal_complete' && activeNotice?.kind === 'tip_received';
  const noticeToRender = suppressNotice ? null : activeNotice;

  useEffect(() => {
    if (!activeHero && !activeNotice) return undefined;
    // 250ms tick — both the hero countdown and the notice countdown need it.
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [activeHero, activeNotice]);

  useEffect(() => {
    setNow(Date.now());
  }, [activityInbox]);

  if (!activeHero && !noticeToRender) return null;

  return (
    <div class={`overlay-shell overlay-shell--hero${activeHero ? ' has-hero' : ''}`}>
      {activeHero ? <HeroPanel a={activeHero} now={now} /> : null}
      {noticeToRender ? <ActivityNoticePill a={noticeToRender} now={now} /> : null}
    </div>
  );
};

const HeroPanel = ({ a, now }: { a: DirectorActivityBroadcast; now: number }) => {
  const { kicker, kickerName, action, sub, emoji } = formatModelHero(a);
  const showTimer = HERO_TIMER_KINDS.has(a.kind);
  const remainingMs = showTimer ? Math.max(0, a.at + durationFor(a) - now) : 0;
  const solo = a.kind === 'menu_goal_complete' && isSoloBuyer(a);
  return (
    <div
      class={`model-hero model-hero--${a.kind}${solo ? ' model-hero--solo' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div class="model-hero-top">
        <div class="model-hero-kicker">
          <span class="model-hero-dot" aria-hidden="true" />
          <span class="model-hero-kicker-text">{kicker}</span>
          {kickerName ? (
            <>
              <span class="model-hero-kicker-sep" aria-hidden="true">·</span>
              <span class="model-hero-kicker-name">{kickerName}</span>
            </>
          ) : null}
        </div>
        {showTimer ? (
          <div class="model-hero-timer" aria-label="Time remaining">
            <span class="model-hero-timer-num">{formatRemaining(remainingMs)}</span>
            <span class="model-hero-timer-label">left</span>
          </div>
        ) : null}
      </div>
      <div class="model-hero-action">
        <span class="model-hero-emoji" aria-hidden="true">{emoji}</span>
        <span class="model-hero-text">{action}</span>
      </div>
      {sub ? <div class="model-hero-sub">{sub}</div> : null}
    </div>
  );
};

const ActivityNoticePill = ({
  a,
  now,
}: {
  a: DirectorActivityBroadcast;
  now: number;
}) => {
  const { emoji, primary, secondary } = formatNotice(a);
  const solo = a.kind === 'menu_goal_complete' && isSoloBuyer(a);
  // Timer only matters when the notice represents an in-progress on-stream
  // window the viewer might want to track (cue countdown, menu line payoff).
  // Tips, chair takeovers and lifecycle pings are point-in-time events — no
  // countdown adds value, just clutter.
  const showTimer = HERO_TIMER_KINDS.has(a.kind);
  const remainingMs = showTimer ? Math.max(0, a.at + durationFor(a) - now) : 0;
  return (
    <div
      class={`activity-notice activity-notice--${a.kind}${solo ? ' activity-notice--solo' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span class="activity-notice-emoji" aria-hidden="true">{emoji}</span>
      <div class="activity-notice-body">
        <span class="activity-notice-primary">{primary}</span>
        {secondary ? <span class="activity-notice-sub">{secondary}</span> : null}
      </div>
      {showTimer ? (
        <span class="activity-notice-timer" aria-label="Time remaining">
          {formatRemaining(remainingMs)}
        </span>
      ) : null}
    </div>
  );
};

/**
 * `kickerName` is rendered in a separate span that opts out of the parent's
 * `text-transform: uppercase`, so usernames keep their original case
 * (e.g. "DIRECTOR CUE · rose_taker" instead of "DIRECTOR CUE · ROSE_TAKER").
 */
const formatModelHero = (
  a: DirectorActivityBroadcast,
): {
  kicker: string;
  kickerName: string | null;
  action: string;
  sub: string | null;
  emoji: string;
} => {
  if (a.kind === 'command_start') {
    return {
      kicker: 'Director cue',
      kickerName: a.issuedByName || null,
      action: a.label || 'Cue',
      sub: null,
      emoji: a.emoji || '🎬',
    };
  }
  if (a.kind === 'menu_goal_complete') {
    const solo = isSoloBuyer(a);
    if (solo) {
      return {
        kicker: 'Bought',
        kickerName: solo.name,
        action: a.itemTitle || 'Perform',
        sub: a.price ? `${a.price} tk · solo buy` : 'solo buy',
        emoji: '🏆',
      };
    }
    return {
      kicker: 'Room filled',
      kickerName: null,
      action: a.itemTitle || 'Perform',
      sub: a.price ? `${a.price} tk paid` : null,
      emoji: '✓',
    };
  }
  if (a.kind === 'control_unlock') {
    return {
      kicker: 'Director Control unlocked',
      kickerName: null,
      action: a.directorName ? `Director · ${a.directorName}` : 'Director seat live',
      sub: null,
      emoji: '🔓',
    };
  }
  if (a.kind === 'chair_chase_takeover') {
    return {
      kicker: 'New Director',
      kickerName: null,
      action: a.issuedByName || 'Seat changed',
      sub: 'Took the Director seat',
      emoji: '🪑',
    };
  }
  return { kicker: 'Activity', kickerName: null, action: '', sub: null, emoji: '•' };
};

const isSoloBuyer = (
  a: DirectorActivityBroadcast,
): { name: string } | null => {
  if (a.kind !== 'menu_goal_complete') return null;
  const contributors = a.contributors ?? [];
  if (contributors.length !== 1) return null;
  const c = contributors[0]!;
  if (a.price && c.amount < a.price) return null;
  return { name: c.name || 'Buyer' };
};

const formatNotice = (
  a: DirectorActivityBroadcast,
): { emoji: string; primary: string; secondary: string | null } => {
  if (a.kind === 'menu_goal_complete') {
    const solo = isSoloBuyer(a);
    if (solo) {
      return {
        emoji: '🏆',
        primary: `${solo.name} bought ${a.itemTitle ?? 'a menu line'}`,
        secondary: a.price ? `${a.price} tk · Tip Menu` : 'Tip Menu',
      };
    }
    return {
      emoji: '✓',
      primary: a.itemTitle ? `Room filled · ${a.itemTitle}` : 'Tip Menu filled',
      secondary: a.price ? `${a.price} tk` : null,
    };
  }
  if (a.kind === 'command_start') {
    return {
      emoji: a.emoji || '🎬',
      primary: a.label || 'Director cue',
      secondary: a.issuedByName ? `by ${a.issuedByName}` : null,
    };
  }
  if (a.kind === 'chair_chase_takeover') {
    return {
      emoji: '🪑',
      primary: a.issuedByName ? `${a.issuedByName} → Director` : 'New Director',
      secondary: 'Seat changed',
    };
  }
  if (a.kind === 'tip_received') {
    const who = a.issuedByName || 'Viewer';
    const amount = typeof a.amount === 'number' && a.amount > 0 ? `${a.amount} tk` : '';
    const target = a.itemTitle ? ` → ${a.itemTitle}` : '';
    const secondary = amount
      ? `tipped ${amount}${target}`
      : target
        ? `tipped${target}`
        : 'tipped';
    return {
      emoji: '💸',
      primary: who,
      secondary,
    };
  }
  if (a.kind === 'control_unlock') {
    return {
      emoji: '🔓',
      primary: 'Director Control unlocked',
      secondary: a.directorName ? `Director: ${a.directorName}` : null,
    };
  }
  if (a.kind === 'game_started') {
    return {
      emoji: '▶️',
      primary: 'Director game started',
      secondary: a.preproductionGoal
        ? `Goal: ${a.preproductionGoal} tk`
        : 'Tip the menu to unlock',
    };
  }
  if (a.kind === 'game_paused') {
    return {
      emoji: '⏸️',
      primary: 'Director game paused',
      secondary: 'Tips still stack on each line',
    };
  }
  return { emoji: '•', primary: 'Activity', secondary: null };
};
