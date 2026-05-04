/**
 * Runtime stand-in for `@stripchatdev/ext-helper` used by the playground.
 * Vite swaps the real package for this module when run with `--mode mocks`.
 *
 * The playground drives the bus directly via `mockBus.*` to broadcast
 * whispers, context updates, and request-handler responses.
 */

type Listener = (payload: unknown) => void;
type RequestHandler = (payload: unknown) => Promise<unknown> | unknown;

const listeners: Record<string, Set<Listener>> = {};
const requestHandlers: Record<string, RequestHandler> = {};
const requestLog: Array<{ at: number; event: string; payload: unknown }> = [];

const subscribe = (event: string, handler: Listener) => {
  (listeners[event] ??= new Set()).add(handler);
};

const unsubscribe = (event: string, handler: Listener) => {
  listeners[event]?.delete(handler);
};

const makeRequest = async (event: string, payload: unknown) => {
  requestLog.push({ at: Date.now(), event, payload });
  if (requestLog.length > 200) requestLog.splice(0, requestLog.length - 200);
  const handler = requestHandlers[event];
  if (!handler) return undefined;
  return handler(payload);
};

export const createExtHelper = () => ({
  subscribe,
  unsubscribe,
  makeRequest,
});

export const mockBus = {
  emit(event: string, payload: unknown) {
    listeners[event]?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.error('mockBus listener error for', event, err);
      }
    });
  },
  setRequest(event: string, handler: RequestHandler) {
    requestHandlers[event] = handler;
  },
  clearRequest(event: string) {
    delete requestHandlers[event];
  },
  hasListeners(event: string): boolean {
    return Boolean(listeners[event]?.size);
  },
  recentRequests(limit = 30) {
    return requestLog.slice(-limit).reverse();
  },
  reset() {
    Object.keys(listeners).forEach((k) => listeners[k]!.clear());
    Object.keys(requestHandlers).forEach((k) => delete requestHandlers[k]);
    requestLog.length = 0;
  },
};

// Re-export type aliases as `any` so any code importing from
// '@stripchatdev/ext-helper' for types still resolves at build time
// (TS uses the real package; Vite uses this file at runtime).
export type TEvents = Record<string, unknown>;
export type TV1ExtContext = Record<string, unknown>;
export type TV1ExtUser = Record<string, unknown>;
export type TV1TipMenu = Record<string, unknown>;
export type TV1PaymentData = Record<string, unknown>;
