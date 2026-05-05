import type { TEvents } from '@stripchatdev/ext-helper';
import { createExtHelper } from '@stripchatdev/ext-helper';

import { isObject } from '../../shared/format';
import type { WhisperEnvelope } from '../../shared/state';

type SpendKind =
  | 'director.menu.tip'
  | 'director.command.issue'
  | 'director.menu.reallocate'
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
      kind: 'director.menu.reallocate';
      fromItemId: string;
      toItemId: string;
      amount: number;
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
    kind === 'director.menu.reallocate' ||
    kind === 'director.chair.chase'
  );
};

export const startViewerBackground = (): (() => void) => {
  const ext = createExtHelper();

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
    } else if (intent.kind === 'director.menu.reallocate') {
      envelope = {
        type: 'director.menu.reallocate',
        paymentData: payload.paymentData,
        fromItemId: String(intent.fromItemId || ''),
        toItemId: String(intent.toItemId || ''),
        amount: Math.max(0, Math.floor(Number(intent.amount) || 0)),
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
  };

  ext.subscribe('v1.payment.tokens.spend.succeeded', handleSpendSucceeded);

  void ext
    .makeRequest('v1.monitoring.report.log', {
      message: 'director viewer background ready',
      data: null,
    })
    .catch(() => undefined);

  return () => {
    ext.unsubscribe('v1.payment.tokens.spend.succeeded', handleSpendSucceeded);
  };
};
