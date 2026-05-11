import type { TEvents, TV1ExtUser } from '@stripchatdev/ext-helper';
import { createExtHelper } from '@stripchatdev/ext-helper';

import { isObject } from '../../shared/format';
import {
  claimHostActivityForEvent,
  createHostActivitySlot,
} from '../../shared/hostExtensionActivity';
import type { DirectorActivityKind, WhisperEnvelope } from '../../shared/state';

type SpendKind =
  | 'director.menu.tip'
  | 'director.command.issue'
  | 'director.chair.chase';

type SpendIntent =
  | {
      kind: 'director.menu.tip';
      itemId: string;
      userId: string;
      username: string;
    }
  | {
      kind: 'director.command.issue';
      commandId: string;
      userId: string;
      username: string;
    }
  | {
      kind: 'director.chair.chase';
      userId: string;
      username: string;
    };

const isSpendIntent = (data: unknown): data is SpendIntent & { kind: SpendKind } => {
  if (!isObject(data)) return false;
  const kind = data.kind;
  return (
    kind === 'director.menu.tip' ||
    kind === 'director.command.issue' ||
    kind === 'director.chair.chase'
  );
};

export const startViewerBackground = (): (() => void) => {
  const ext = createExtHelper();
  const hostActivitySlot = createHostActivitySlot();

  const reportError = (message: string, data: unknown) => {
    void ext
      .makeRequest('v1.monitoring.report.error', { message, data })
      .catch(() => undefined);
  };

  /**
   * Director activity events fan out through several channels (the model's
   * room whisper, an 800ms-delayed replay of that whisper, and — for tips —
   * the viewer's own optimistic local broadcast). Without this guard each
   * channel would re-claim `v1.ext.activity.request` for the same logical
   * event, extending the slot reservation and double-mounting the overlay.
   * We key by the activity `id` (which the model now derives from the
   * payment `transactionId`, matching any optimistic id we generate here)
   * and short-circuit subsequent claims for that id.
   */
  const seenActivityIds = new Set<string>();
  const SEEN_ACTIVITY_CAP = 256;
  const rememberActivityId = (id: string): boolean => {
    if (!id) return false;
    if (seenActivityIds.has(id)) return false;
    seenActivityIds.add(id);
    if (seenActivityIds.size > SEEN_ACTIVITY_CAP) {
      // Set iteration preserves insertion order — drop the oldest half.
      const arr = Array.from(seenActivityIds);
      seenActivityIds.clear();
      arr.slice(arr.length - SEEN_ACTIVITY_CAP / 2).forEach((x) =>
        seenActivityIds.add(x),
      );
    }
    return true;
  };

  /**
   * Reserve the decorative-overlay slot on this viewer's session so the
   * iframe mounts (the host only mounts it while we hold the activity).
   * After the claim is granted, replay the activity locally so the freshly
   * mounted decorative iframe picks it up via `v1.ext.whispered.local`.
   *
   * Called both when the viewer themselves triggers an event (their own
   * spend.succeeded) and when the model broadcasts an event the viewer
   * needs to see (incoming `v1.ext.whispered` for `director.activity`).
   */
  const claimAndReplay = (
    activity: Record<string, unknown>,
    kind: DirectorActivityKind,
    durationMs: number,
  ) => {
    const id = typeof activity.id === 'string' ? activity.id : '';
    if (!rememberActivityId(id)) return;
    const durationSec = Math.max(3, Math.ceil(durationMs / 1000));
    void claimHostActivityForEvent(
      ext,
      hostActivitySlot,
      kind,
      durationSec,
      reportError,
    ).then(() => {
      // Give the host a beat to mount the iframe and run its JS before we
      // re-fire the activity locally; otherwise the freshly mounted overlay
      // would miss the replay.
      setTimeout(() => {
        void ext
          .makeRequest('v1.ext.whisper.local', { data: activity })
          .catch(() => undefined);
      }, 600);
    });
  };

  const asAttributedUser = (actor: { userId: string; username: string } | null): TV1ExtUser | null => {
    if (!actor) return null;
    const idNum = Number(actor.userId);
    if (!Number.isFinite(idNum) || idNum <= 0) return null;
    return {
      isGuest: false,
      id: idNum,
      username: actor.username || 'viewer',
      status: 'public',
      hasTokens: true,
      hasPaidBefore: true,
      hasUltimateSubscription: false,
      isModel: false,
    } as unknown as TV1ExtUser;
  };

  const sendPublicChat = (
    message: string,
    actor?: { userId: string; username: string } | null,
    options?: { anonymous?: boolean },
  ) => {
    const text = message.trim().slice(0, 2000);
    if (!text) return;
    const anonymous = options?.anonymous === true;
    void ext
      .makeRequest('v1.chat.message.send', {
        message: text,
        isAnonymous: anonymous,
        user: anonymous ? null : asAttributedUser(actor ?? null),
      })
      .catch((err: unknown) =>
        void ext.makeRequest('v1.monitoring.report.error', {
          message: 'director viewer public chat failed',
          data: { err: String(err) },
        }),
      );
  };

  const handleSpendSucceeded = (
    payload: TEvents['v1.payment.tokens.spend.succeeded'],
  ) => {
    const intent = payload.tokensSpendData;
    if (!isSpendIntent(intent)) return;

    let envelope: WhisperEnvelope | null = null;
    if (intent.kind === 'director.menu.tip') {
      envelope = {
        type: 'director.menu.tip',
        paymentData: payload.paymentData,
        itemId: String(intent.itemId || ''),
        amount: Math.max(0, Math.floor(Number(payload.paymentData.amount))) || 0,
        userId: String(intent.userId || payload.paymentData.userId || ''),
        username: String(intent.username || ''),
      };
    } else if (intent.kind === 'director.command.issue') {
      envelope = {
        type: 'director.command.issue',
        paymentData: payload.paymentData,
        commandId: String(intent.commandId || ''),
        userId: String(intent.userId || payload.paymentData.userId || ''),
        username: String(intent.username || ''),
      };
    } else if (intent.kind === 'director.chair.chase') {
      envelope = {
        type: 'director.chair.chase',
        paymentData: payload.paymentData,
        amount: Math.max(0, Math.floor(Number(payload.paymentData.amount))) || 0,
        userId: String(intent.userId || payload.paymentData.userId || ''),
        username: String(intent.username || ''),
      };
    }

    if (!envelope) return;

    void ext
      .makeRequest('v1.ext.whisper', {
        data: envelope as Record<string, unknown>,
        paymentData: payload.paymentData,
      })
      .catch((err: unknown) =>
        void ext.makeRequest('v1.monitoring.report.error', {
          message: 'director viewer relay whisper failed',
          data: { err: String(err) },
        }),
      );

    // No optimistic local activity. Every spend kind here (`menu.tip`,
    // `command.issue`, `chair.chase`) has a model-side outcome that depends
    // on the room's *current* state — whether the tip closes the line,
    // whether the command queues or starts immediately, whether the chase
    // actually takes the seat. Firing an optimistic banner from the
    // viewer's side before the model has decided risks showing the wrong
    // event (e.g. "tipped 50 tk → Cum · 0 tk left" right before the
    // canonical "Position bought" banner arrives), which is the
    // double-/triple-notification bug viewers reported. The model is the
    // single source of truth — its room whisper round-trips fast enough.
  };

  const handleWhispered = (data: TEvents['v1.ext.whispered']) => {
    if (!isObject(data)) return;

    // Re-broadcast model-initiated chat lines locally so this viewer's chat
    // feed renders them (server-side chat send is local-only per the SDK).
    if (data.type === 'director.chat.message' && typeof data.message === 'string') {
      const anonymous = (data as { anonymous?: unknown }).anonymous === true;
      const actor =
        !anonymous && typeof data.userId === 'string' && typeof data.username === 'string'
          ? { userId: data.userId, username: data.username }
          : null;
      sendPublicChat(data.message, actor, { anonymous });
      return;
    }

    // Model-broadcast activity events: reserve our own decorative slot so
    // the iframe mounts on this viewer's session, then replay locally so
    // the overlay actually receives it. Without this, viewers who didn't
    // trigger the event (e.g. somebody else tipping) never see the notice
    // because their decorative iframe was unmounted at broadcast time.
    if (data.type === 'director.activity') {
      const kind = (data as { kind?: unknown }).kind;
      if (typeof kind !== 'string') return;
      const durationMs =
        typeof (data as { durationMs?: unknown }).durationMs === 'number'
          ? Math.max(2_000, (data as { durationMs: number }).durationMs)
          : 8_000;
      claimAndReplay(
        data as unknown as Record<string, unknown>,
        kind as DirectorActivityKind,
        durationMs,
      );
      return;
    }
  };

  ext.subscribe('v1.payment.tokens.spend.succeeded', handleSpendSucceeded);
  ext.subscribe('v1.ext.whispered', handleWhispered);

  void ext
    .makeRequest('v1.monitoring.report.log', {
      message: 'director viewer background ready',
      data: null,
    })
    .catch(() => undefined);

  return () => {
    ext.unsubscribe('v1.payment.tokens.spend.succeeded', handleSpendSucceeded);
    ext.unsubscribe('v1.ext.whispered', handleWhispered);
  };
};
