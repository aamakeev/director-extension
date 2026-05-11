import type { DirectorActivityKind } from './state';

/** In-memory handle for the single host “extension activity” slot we may hold at a time. */
export type HostActivitySlot = {
  meta: { id: string; kind: DirectorActivityKind } | null;
};

type ExtLike = {
  makeRequest(method: string, params: unknown): Promise<unknown>;
};

export const createHostActivitySlot = (): HostActivitySlot => ({ meta: null });

/**
 * Durations aligned with the on-stream notice display time. We keep them
 * tight so the decorative-overlay iframe doesn't stay mounted past the
 * visible notice — otherwise host activity persists silently for tens of
 * seconds (especially on the long control_unlock window) and viewers see
 * the slot consumed without anything visible there.
 */
export const durationMsForDirectorActivity = (
  kind: DirectorActivityKind,
  commandDurationSec: number,
): number => {
  switch (kind) {
    case 'menu_goal_complete':
      return 12_000;
    case 'control_unlock':
      return 10_000;
    case 'command_start': {
      // Cue duration = how long the model performs the command on stream;
      // the slot stays granted for the entirety of that window.
      const sec = Math.max(3, Math.min(300, Math.floor(commandDurationSec)));
      return sec * 1000;
    }
    case 'chair_chase_takeover':
      return 7_000;
    case 'tip_received':
      return 4_500;
    case 'game_started':
    case 'game_paused':
      return 6_000;
    default:
      return 8_000;
  }
};

export const clearHostActivity = async (ext: ExtLike, slot: HostActivitySlot): Promise<void> => {
  if (!slot.meta) return;
  const { id } = slot.meta;
  slot.meta = null;
  try {
    await ext.makeRequest('v1.ext.activity.cancel', { activityId: id });
  } catch {
    /* Slot may have already expired on the host. */
  }
};

/**
 * Reserves the platform extension-activity channel (see SDK `v1.ext.activity.request`).
 * Cancels any prior Director-held activity first so we never leak overlapping claims.
 */
export const claimHostActivityForEvent = async (
  ext: ExtLike,
  slot: HostActivitySlot,
  kind: DirectorActivityKind,
  commandDurationSec: number,
  reportError: (message: string, data: unknown) => void,
): Promise<void> => {
  // Per-tip pulses must not preempt a live command segment — keep the larger event on screen.
  if (kind === 'tip_received' && slot.meta && slot.meta.kind !== 'tip_received') return;
  await clearHostActivity(ext, slot);
  const durationMs = durationMsForDirectorActivity(kind, commandDurationSec);
  try {
    const res = (await ext.makeRequest('v1.ext.activity.request', {
      durationMs,
    })) as { activityId: string };
    slot.meta = { id: res.activityId, kind };
  } catch (err: unknown) {
    reportError('director v1.ext.activity.request failed', {
      err: String(err),
      kind,
      durationMs,
    });
  }
};

/** Release host activity when a Director command segment ends (queue or clear). */
export const releaseCommandHostActivity = async (
  ext: ExtLike,
  slot: HostActivitySlot,
): Promise<void> => {
  if (slot.meta?.kind !== 'command_start') return;
  await clearHostActivity(ext, slot);
};
