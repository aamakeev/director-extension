import type { TEvents, TV1ExtContext } from '@stripchatdev/ext-helper';
import { createExtHelper } from '@stripchatdev/ext-helper';
import { useEffect, useRef, useState } from 'preact/hooks';

import { isWhisperEnvelope, type DirectorActivityBroadcast, type DirectorPublicState } from './state';
import { resolveRole, whisperSelfId, type DirectorRole } from './role';

export type SelfAllocations = {
  total: number;
  byItem: Record<string, number>;
};

export type DirectorToast = {
  id: number;
  tone: 'success' | 'warn' | 'info';
  message: string;
};

export type DirectorClient = {
  context: TV1ExtContext;
  role: DirectorRole;
  state: DirectorPublicState | null;
  /** Last N cross-slot activity events (`director.activity` whisper + whisper.local). */
  activityInbox: DirectorActivityBroadcast[];
  selfAllocations: SelfAllocations;
  toasts: DirectorToast[];
  dismissToast: (id: number) => void;
  pushToast: (toast: Omit<DirectorToast, 'id'>) => void;
};

const ext = createExtHelper();

let toastSeq = 1;

export const useDirectorClient = (): DirectorClient => {
  const [context, setContext] = useState<TV1ExtContext>({});
  const [state, setState] = useState<DirectorPublicState | null>(null);
  const [selfAllocations, setSelfAllocations] = useState<SelfAllocations>({
    total: 0,
    byItem: {},
  });
  const [activityInbox, setActivityInbox] = useState<DirectorActivityBroadcast[]>([]);
  const [toasts, setToasts] = useState<DirectorToast[]>([]);
  const meRef = useRef<string>('');

  const pushToast = (toast: Omit<DirectorToast, 'id'>) => {
    const id = toastSeq++;
    setToasts((prev) => [...prev, { ...toast, id }].slice(-4));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const dismissToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    let cancelled = false;

    const onWhispered = (data: TEvents['v1.ext.whispered']) => {
      if (!isWhisperEnvelope(data)) return;
      if (data.type === 'director.state') {
        setState(data);
        // Backfill the inbox from recentActivities so a freshly-mounted
        // decorative iframe doesn't sit empty after missing the original
        // broadcast.
        const recent = (data as { recentActivities?: unknown }).recentActivities;
        if (Array.isArray(recent) && recent.length) {
          setActivityInbox((prev) => {
            let next = prev;
            let changed = false;
            for (const raw of recent) {
              if (!raw || typeof raw !== 'object') continue;
              const a = raw as { id?: unknown };
              if (typeof a.id !== 'string') continue;
              const idx = next.findIndex((entry) => entry.id === a.id);
              if (idx >= 0) {
                const merged = { ...next[idx], ...(raw as object) };
                if (!changed) {
                  next = next.slice();
                  changed = true;
                }
                next[idx] = merged as (typeof next)[number];
              } else {
                if (!changed) {
                  next = next.slice();
                  changed = true;
                }
                next.push(raw as (typeof next)[number]);
              }
            }
            return changed ? next.slice(-16) : prev;
          });
        }
        return;
      }
      if (data.type === 'director.activity') {
        setActivityInbox((prev) => {
          // Merge by id so an optimistic local entry (e.g. tipper's own
          // whisper.local with partial info) gets enriched once the model's
          // canonical broadcast arrives.
          const idx = prev.findIndex((a) => a.id === data.id);
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = { ...prev[idx], ...data };
            return next;
          }
          return [...prev, data].slice(-16);
        });
        return;
      }
      const me = meRef.current;
      if (!me) return;
      if (data.type === 'director.toast' && data.targetUserId === me) {
        pushToast({ tone: data.tone, message: data.message });
        return;
      }
      if (data.type === 'director.self.allocations' && data.targetUserId === me) {
        const byItem: Record<string, number> = {};
        data.allocations.forEach((entry) => {
          if (entry.allocated > 0) byItem[entry.itemId] = entry.allocated;
        });
        setSelfAllocations({ total: data.total, byItem });
      }
    };

    const onContextUpdated = (payload: TEvents['v1.ext.context.updated']) => {
      setContext(payload.context);
      meRef.current = whisperSelfId(payload.context.user);
    };

    ext.subscribe('v1.ext.whispered', onWhispered);
    // `v1.ext.whisper.local` doesn't echo back to the sender through the
    // standard whispered channel, so we also listen on the local-only event
    // (e.g. the tipper's own optimistic tip activity from viewerBackground).
    ext.subscribe('v1.ext.whispered.local', onWhispered);
    ext.subscribe('v1.ext.context.updated', onContextUpdated);

    const requestState = () => {
      void ext
        .makeRequest('v1.ext.whisper', {
          data: { type: 'director.state.request' },
        })
        .catch(() => undefined);
    };

    void ext.makeRequest('v1.ext.context.get', null).then((ctx) => {
      if (cancelled) return;
      setContext(ctx);
      meRef.current = whisperSelfId(ctx.user);
      requestState();
    });

    // Retry a few times in case the model background hasn't subscribed yet.
    const retries = [400, 1200, 3000].map((delay) =>
      setTimeout(() => {
        if (cancelled) return;
        requestState();
      }, delay),
    );

    return () => {
      cancelled = true;
      retries.forEach(clearTimeout);
      ext.unsubscribe('v1.ext.whispered', onWhispered);
      ext.unsubscribe('v1.ext.whispered.local', onWhispered);
      ext.unsubscribe('v1.ext.context.updated', onContextUpdated);
    };
  }, []);

  return {
    context,
    role: resolveRole(context),
    state,
    activityInbox,
    selfAllocations,
    toasts,
    dismissToast,
    pushToast,
  };
};

export const directorExt = ext;
