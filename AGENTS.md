# director
Use this file as the primary coding contract for this starter. Use the Stripchat docs to get more details.
- Category: games-and-fun
- Slots: mainGameFun, background, rightOverlay
- Framework: preact
- Language: ts

## Starter Map
- public/manifest.json declares slots, page keys, optional settings entry, and backend actions.
- public/resolveSlotPage.js is the runtime resolver. It returns a page key from views.pages or null.
- Root HTML files like mainGameFun.html and background.html are emitted into the final archive root.
- Visual slot entry modules live in src/slots/<slot>/main.tsx.
- Visual slot page code lives in src/slots/<slot>/app.tsx.
- Background entry module lives in src/slots/background/main.ts.
- Background page code lives in src/slots/background/app.ts.
- If you add settings.html, it is also a root HTML file and must have its own entry module.
- vite.config.ts must include every root HTML file in build.rollupOptions.input.

## Minimal views shape:
```json
{
  "version": "v2.0",
  "views": {
    "slots": ["mainGameFun", "background"],
    "pages": {
      "mainGameFun": "mainGameFun.html",
      "background": "background.html"
    },
    "resolveSlotPageScript": "resolveSlotPage.js"
  }
}
```
## Hard Rules
- Call createExtHelper() exactly once in the first executed module of every page before any other SDK logic.
- In this starter, keep createExtHelper() in each page's app.* file.
- If you add settings.html, call createExtHelper() there too.
- Keep public/resolveSlotPage.js as plain synchronous JS. Do not bundle it, make it async, or import app code into it.
- public/resolveSlotPage.js must return only a key from public/manifest.json views.pages or null.
- settings.html does not go through public/resolveSlotPage.js.
- Every views.pages key must map to a real root HTML file.
- Every root HTML file must be included in vite.config.ts build.rollupOptions.input.
- Non-background slots can unmount at any time. Do not keep durable state, timers, polling, or coordination logic in them.
- Keep durable state, timers, polling, and cross-slot coordination in background.
- If you subscribe to SDK events, DOM events, or timers, clean them up on unmount or teardown.
- Use named handler functions when subscribing so you can unsubscribe the same reference.
- Slots can unmount, so you should always unsubscribe from sdk events and browser apis correctly.
- Use v1.ext.whisper.local for communication between this extension's frames for the current user.
- Use v1.ext.whisper only when every loaded client in the room should receive the message.
- When a user sends v1.ext.whisper during a public show, paymentData is required. Obtain it from v1.payment.tokens.spend.succeeded. The model can whisper without paymentData.
- Broadcast whispers arrive as v1.ext.whispered
- Local whispers arrive as v1.ext.whispered.local
- Always include a stable type field in whisper payloads.
- Use v1.payment.tokens.spend.succeeded to confirm a spend in the paying client's iframe.
- Use v1.tokens.spent in the model/background iframe to react to the room-side tip.
- Do not add Save or Cancel buttons inside settings.html. The platform renders them outside the iframe.
- Do not use viewport @media queries. The iframe viewport is the slot container, not the browser window.
- Do not manage iframe scrolling with overflow: auto or overflow: scroll on html or body.
- Set background styles on <html>, not <body>.
- Use CSS variables with html[data-theme='dark'] and html[data-theme='light'] selectors for theming.
- The SDK sets html[data-theme] when createExtHelper() runs.
- Do not access the parent DOM.
- Do not rely on host cookies.
- Actions are strictly reviewed before publishing. Use it only when necessary (e.g. third-party API calls with secrets). 
- If you use moveableOverlay, define moveableSlot.width and moveableSlot.height in the manifest. Max size is 450x740.
- Do not invent new slot names or slot type constants.
- Do not invent SDK request names, event names, method names, manifest field names, or payload keys. Use only documented names from the Stripchat docs and this starter.
- Prefer extending the generated wiring over replacing it.
- In TypeScript, treat settings and ad-hoc payloads as unknown until narrowed.
- Keep public/manifest.json valid JSON with no trailing commas.
- In TypeScript, import types from @stripchatdev/ext-helper and use them
- ALWAYS USE background slot to handle long-running orchestration logic — timers, polling, state machines, centralized state management, events, whispers
- The flow should be: visual slot -> whisper.local to background -> background handles logic. Background should subscribe to events and coordinate it
- Create background slot for each actor (model, viewer). Do not put model-only and viewer-only logic in the same background.
- Chatbot extensions have no UI — only a background slot handles all logic (receiving messages and sending chatbot messages).
- Do not create visual slots, HTML pages, or resolver entries for chatbot extensions.
- Use v1.chatbot.message.send to send messages as bot or model from background. Messages are delivered locally to each user.
- Use v1.chat.message.received to listen for incoming chat messages in background.
- The message param in v1.chatbot.message.send supports a {username} placeholder, replaced with the receiving user's name (empty string for anonymous, "Guest" for guests).
- Do not call v1.chatbot.message.send unconditionally inside v1.chat.message.received handlers for every message — chat rooms can have hundreds of messages per second. Use event-driven triggers (context changes, timers, tips) instead or add strict filters on message content or sender properties.

## Slot Guardrails
- Generated slot sets for this starter:
- Games & Fun: mainGameFun, background, rightOverlay 
- Sex Toys: mainSexToy, background, moveableOverlay, optional rightOverlay
- Chat Bots: background (no visual slots)
- Resolver slotType constants:
- mainGameFun -> EXTENSION_SLOT_MAIN_GAME_FUN
- mainSexToy -> EXTENSION_SLOT_MAIN_SEX_TOY
- rightOverlay -> EXTENSION_SLOT_RIGHT_OVERLAY
- moveableOverlay -> EXTENSION_SLOT_MOVEABLE_OVERLAY
- background -> EXTENSION_SLOT_BACKGROUND

## Default Runtime Pattern
- background owns long-lived state and coordination.
- Visual slots render UI from current state and forward user actions.
- Load initial context once with v1.ext.context.get.
- Keep context fresh with v1.ext.context.updated. Payload is { context: TV1ExtContext }.
- Send state updates to every frame of the current user with v1.ext.whisper.local.
- If all loaded clients need the event, use v1.ext.whisper.
- Assume every visual slot can mount, unmount, and remount without notice.

## Resolver
- Start from the generated resolver and extend it only when needed.
- Keep resolver logic cheap, synchronous, and defensive.
- context.user may be missing when the visitor is anonymous.
- extSettings may be missing or partial.
- Return null when a slot should not render.
- If you add model, viewer, or guest variants, add new page keys and branch here.
- Every returned string must be a key in manifest.json views.pages.

### Generated resolver for this project:
```
export default function resolveSlotPage(slotType, context) {
  var user = context && context.user;
  var isGuest = Boolean(user && user.isGuest);
  var isModel = Boolean(
    user && !user.isGuest && (user.isModel || (context.model && context.model.id === user.id))
  );

  switch (slotType) {
    case 'EXTENSION_SLOT_MAIN_GAME_FUN':
      return 'mainGameFun';
    case 'EXTENSION_SLOT_RIGHT_OVERLAY':
      if (isModel) return null;
      return 'rightOverlay';
    case 'EXTENSION_SLOT_BACKGROUND':
      if (isGuest) return null;
      if (isModel) return 'backgroundModel';
      return 'backgroundViewer';
    default:
      return null;
  }
}
```

### Example of context-aware branching:

```
export default function resolveSlotPage(slotType, context, extSettings) {
  const isCurrentUserModel = context.user?.id === context.model?.id || context.user?.isModel;
  if (slotType === 'EXTENSION_SLOT_MAIN_GAME_FUN') {
    if (isCurrentUserModel) return 'mainGameFunModel';
    if (context.user?.isGuest) return 'mainGameFunGuest';
    return 'mainGameFunViewer';
  }
  if (slotType === 'EXTENSION_SLOT_BACKGROUND') {
    return 'background';
  }
  return null;
}
```


## Runtime Context
- context.model is the broadcaster for the current room.
- context.user is the current user running the extension.
- If context.user?.isGuest is true, the current user is a guest (TV1ExtGuestUser). The only field available is isGuest. Fields like id, username, status, hasTokens do not exist on guests.
- If context.user?.id === context.model?.id or context.user?.isModel is true, the current user is the broadcaster.
- Common model statuses: public, private, exclusivePrivate, groupShow, ticketShow, idle, off.
- Common user statuses: public, private, exclusivePrivate, groupShow, ticketShow, spy, off.
- High-value branching fields:
- context.model?.id
- context.model?.status
- context.user?.id
- context.user?.isModel
- context.user?.status
- context.user?.hasTokens

## Entity Shapes

### TV1ExtContext
- model?: TV1ExtModel
- user?: TV1ExtUser

### TV1ExtModel
- id: number
- username: string
- name: string
- avatarUrlThumb: string
- gender: 'male' | 'female' | 'group' | 'tranny'
- status: 'public' | 'private' | 'exclusivePrivate' | 'groupShow' | 'ticketShow' | 'idle' | 'off'
- isPrivateEnabled: boolean
- isSpyEnabled: boolean
- isExclusivePrivateEnabled: boolean
- isNonNude: boolean

### TV1ExtUser
Discriminated union on `isGuest`: TV1ExtGuestUser | TV1ExtLoggedInUser.

TV1ExtGuestUser:
- isGuest: true
- guestHash: string;

TV1ExtLoggedInUser:
- isGuest: false
- id: number
- username: string
- status: 'public' | 'private' | 'exclusivePrivate' | 'groupShow' | 'ticketShow' | 'spy' | 'off'
- hasTokens: boolean
- hasPaidBefore: boolean
- hasUltimateSubscription: boolean
- isModel: boolean
- userRanking?: { league: 'grey' | 'bronze' | 'silver' | 'gold' | 'diamond' | 'royal' | 'legend'; level: number }

### TV1PaymentData
- amount: string
- paymentToken: string
- transactionId: string
- userId: string

### TV1TipData (payload of v1.tokens.spent)
- amount: number
- isAnonymous: boolean
- isFromTheCurrentUser: boolean
- isOriginalSource: boolean
- message: string | undefined
- source: 'console' | 'tipMenu' | 'goal' | 'epicGoal' | 'fullscreen' | 'interactiveToy' | 'publicChat' | 'privateChat' | 'extension' | 'sendTipButton' | 'feed'
- type: 'private' | 'public'
- user: TV1ExtUser | null | undefined


## Common SDK Calls
- v1.ext.context.get -> load initial room context.
- v1.ext.context.updated -> react to context changes. Event payload is { context: TV1ExtContext }.
- v1.ext.whisper.local -> send a message to every frame of the current user.
- v1.ext.whisper -> broadcast to all loaded clients in the room. Users in public shows must include paymentData from v1.payment.tokens.spend.succeeded.
- v1.ext.whispered -> receives whispers from v1.ext.whisper.
- v1.ext.whispered.local -> receives whisper.local messages.
- v1.chat.message.send -> send a chat message on behalf of the extension.
- v1.chatbot.message.send -> send a chat message as bot or model. Message is delivered locally to each user. Supports {username} placeholder in message text. Params: from ('bot' | 'model'), message (string).
- v1.chat.message.received -> triggered on every new chat message. Payload: messageText (string), sender (TV1ExtUser), type ('private' | 'public').
- v1.ext.settings.get -> read saved settings in slot pages and background.
- v1.model.ext.settings.get -> load saved settings inside settings.html.
- v1.model.ext.settings.set.requested -> platform save event for settings.html.
- v1.model.ext.settings.set -> persist settings from settings.html.
- v1.ext.actions.call -> call backend actions declared in the manifest.
- v1.payment.tokens.spend -> request token spend from the current user. Result is null; confirmation arrives via event.
- v1.payment.tokens.spend.succeeded -> confirm successful token spend on the paying client. Payload includes paymentData (TV1PaymentData) needed for v1.ext.whisper in public shows.
- v1.tokens.spent -> receive room-side tip events. Should be used in background to react on tips (e.g. for toys)
- v1.private.request -> request a private show with the broadcaster.
- v1.ext.signup.open -> open sign-up for anonymous users.
- v1.ext.activity.request -> reserve exclusive access to shared activity slots (rightOverlay, videoDecorativeOverlay) for durationMs ms. Call blocks until slot is free. Returns { activityId: string }. Cancel early with v1.ext.activity.cancel.
- v1.ext.movableOverlay.update -> update moveableOverlay status pill (status + message). Sex Toys only.
- v1.monitoring.report.error -> report meaningful failures.
- v1.monitoring.report.log -> report important lifecycle events or fallback decisions.
- v1.storage.string.set -> store a string value by key. Optional ttlSeconds for auto-expiry.
- v1.storage.string.get -> read a string value by key.
- v1.storage.string.append -> append text to a string value. If key does not exist, behaves like set.
- v1.storage.int.get -> read an integer counter value by key.
- v1.storage.int.increment -> add delta to an integer counter. Negative delta subtracts.
- v1.storage.int.reset -> reset an integer counter to 0.
- v1.storage.mutex.lock -> acquire an exclusive lock. Optional ttlSeconds for auto-release.
- v1.storage.mutex.unlock -> release a previously acquired mutex.
- v1.storage.mutex.getState -> check whether a mutex is currently locked.
- v1.storage.top.get -> read a top counter: top-N users by total within a sliding window.
- v1.storage.top.increment -> append an increment to a top counter for a user.
- v1.storage.top.reset -> clear all increments for a top counter key.

## Canonical Examples and Practices

### Settings save flow in settings.html
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();

const DEFAULT_SETTINGS = {
  isEnabled: true,
  viewerMessage: 'Welcome to the game',
};

const toSettings = (value) => {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SETTINGS;
  }
  const input = /** @type {Record<string, unknown>} */ (value);
  return {
    isEnabled:
      typeof input.isEnabled === 'boolean' ? input.isEnabled : DEFAULT_SETTINGS.isEnabled,
    viewerMessage:
      typeof input.viewerMessage === 'string'
        ? input.viewerMessage
        : DEFAULT_SETTINGS.viewerMessage,
  };
};
const init = async () => {
  const res = await ext.makeRequest('v1.model.ext.settings.get', null);
  const savedSettings = toSettings(res.settings);
  // populate form fields from savedSettings here
  const onSettingsSaveRequested = async () => {
    // read current values from your form fields here
    const settings = {
      isEnabled: true,
      viewerMessage: 'Hello',
    };
    const isError =
      typeof settings.viewerMessage !== 'string' ||
      settings.viewerMessage.trim().length === 0;
    await ext.makeRequest('v1.model.ext.settings.set', {
      settings,
      isError,
    });
  };
  ext.subscribe('v1.model.ext.settings.set.requested', onSettingsSaveRequested);
  const cleanup = () => {
    ext.unsubscribe('v1.model.ext.settings.set.requested', onSettingsSaveRequested);
  };
};
void init();
```

### Backend action manifest and call
Manifest snippet:
```
{
  "actions": [
    {
      "name": "createToken",
      "type": "externalCall",
      "config": {
        "action": "https://example.com/api/token",
        "method": "POST"
      }
    }
  ]
}
```

Call from extension code
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();
const init = async () => {
  const result = await ext.makeRequest('v1.ext.actions.call', {
    actionName: 'createToken',
    params: {},
  });
  if (result.code !== 200) {
    await ext.makeRequest('v1.monitoring.report.error', {
      message: 'createToken action failed',
      data: { code: result.code, body: result.body },
    });
    return;
  }
  if (!result.body || typeof result.body !== 'object') {
    await ext.makeRequest('v1.monitoring.report.error', {
      message: 'createToken returned invalid body',
      data: { body: result.body },
    });
    return;
  }
  const body = /** @type {Record<string, unknown>} */ (result.body);
  if (typeof body.token !== 'string') {
    await ext.makeRequest('v1.monitoring.report.error', {
      message: 'createToken returned invalid token',
      data: { body: result.body },
    });
    return;
  }
  const token = body.token;
  console.log('Received token:', token);
};
void init();
```

### Token spend in user iframe, model background reacts via v1.tokens.spent
User mainGameFun slot:
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();
const spendForRound = async () => {
  await ext.makeRequest('v1.payment.tokens.spend', {
    tokensAmount: 10,
    tokensSpendData: {
      type: 'ROUND_JOIN',
      roundId: 'round-1',
    },
  });
};
const onTokensSpendSucceeded = (data) => {
  console.log('Spend confirmed:', data.paymentData.amount, data.tokensSpendData);
};
ext.subscribe('v1.payment.tokens.spend.succeeded', onTokensSpendSucceeded);
const cleanup = () => {
  ext.unsubscribe('v1.payment.tokens.spend.succeeded', onTokensSpendSucceeded);
};

void spendForRound();
```

Model background slot (reacts to tip with an API call):
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();
const onTokensSpent = async ({ tipData }) => {
  if (!tipData.isOriginalSource) {
    return;
  }
  const result = await ext.makeRequest('v1.ext.actions.call', {
    actionName: 'recordPayment',
    params: {
      amount: tipData.amount,
      userId: tipData.user?.id,
    },
  });
  if (result.code !== 200) {
    await ext.makeRequest('v1.monitoring.report.error', {
      message: 'recordPayment action failed',
      data: { code: result.code, body: result.body },
    });
  }
};
ext.subscribe('v1.tokens.spent', onTokensSpent);
const cleanup = () => {
  ext.unsubscribe('v1.tokens.spent', onTokensSpent);
};
```

### User-initiated whisper with payment token (full flow)
When a user needs to broadcast a whisper during a public show, paymentData is required.
Flow: visual slot calls v1.payment.tokens.spend -> user background listens to v1.payment.tokens.spend.succeeded -> user background sends v1.ext.whisper with paymentData.

User visual slot (initiates spend on user action):
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();

const spinWheel = async () => {
  await ext.makeRequest('v1.payment.tokens.spend', {
    tokensAmount: 10,
    tokensSpendData: { action: 'spin_wheel' },
  });
};
```

User background slot (listens for payment confirmation, whispers with paymentData):
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();

const onSpendSucceeded = async (data) => {
  await ext.makeRequest('v1.ext.whisper', {
    data: { type: 'SPIN_RESULT', value: 7 },
    paymentData: data.paymentData,
  });
};
ext.subscribe('v1.payment.tokens.spend.succeeded', onSpendSucceeded);
const cleanup = () => {
  ext.unsubscribe('v1.payment.tokens.spend.succeeded', onSpendSucceeded);
};
```

All clients receiving the broadcast:
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();
const onWhispered = (data) => {
  if (data.type !== 'SPIN_RESULT') {
    return;
  }
  showResult(data.value);
};
ext.subscribe('v1.ext.whispered', onWhispered);
const cleanup = () => {
  ext.unsubscribe('v1.ext.whispered', onWhispered);
};
```

### Welcome bot (chatbot background slot)
Loads context, subscribes to updates, and sends a welcome message after 30 seconds only to Ultimate subscribers in background slot.
```
import { createExtHelper } from '@stripchatdev/ext-helper';
const ext = createExtHelper();

const init = async () => {
  const { context } = await ext.makeRequest('v1.ext.context.get', null);
  let currentContext = context;

  const onContextUpdated = (data) => {
    currentContext = data.context;
  };
  ext.subscribe('v1.ext.context.updated', onContextUpdated);

  const welcomeTimer = setTimeout(async () => {
    if (!currentContext.user?.hasUltimateSubscription) {
      return;
    }
    await ext.makeRequest('v1.chatbot.message.send', {
      from: 'bot',
      message: 'Welcome to the room, {username}!',
    });
  }, 30_000);

  const cleanup = () => {
    clearTimeout(welcomeTimer);
    ext.unsubscribe('v1.ext.context.updated', onContextUpdated);
  };
};
void init();
```


## Layout And Theme
- Width is controlled by the parent slot container.
- Build layouts with flexbox, grid, %, fr, min(), max(), and clamp().
- Set html { height: 100% }.
- Let body grow naturally with content.
- Put the page background on <html>.
- Do not rely on viewport-based responsive logic.
- Assume slot width can change at any time.
- Use html[data-theme='dark'] and html[data-theme='light'] for theme-specific tokens.
- Read [design guidelines](https://extensions.stripchat.com/docs/style-guide/guidelines) for recommended UI patterns and practices. Use recommended colors and fonts.

## Monitoring
- Use monitoring for meaningful failures and important lifecycle events.
- Keep monitoring messages short and stable.
- Put variable details in data.
- Do not spam monitoring for routine events.

## Common Changes

### Add a page variant
1. Create a new root HTML file at the project root.
2. Add its page key to public/manifest.json views.pages.
3. Update public/resolveSlotPage.js to return that page key or null.
4. Add the new HTML file to vite.config.ts input.
5. Create or reuse the page entry module and page code.
6. Keep manifest, resolver, HTML, and Vite input in sync.
### Add model, viewer, or guest variants
1. Keep the slot name the same.
2. Add separate page keys in views.pages.
3. Branch in public/resolveSlotPage.js using context.user, context.model, context.user.isGuest, and context.user?.isModel.
4. Return null when that actor should not render the slot.
5. Keep shared state in background.
### Add a settings page
1. Create settings.html as a root HTML file.
2. Create a page entry module for it and call createExtHelper() there.
3. Add views.settings to public/manifest.json.
4. Add settings.html to vite.config.ts input.
5. Load with v1.model.ext.settings.get.
6. Save in response to v1.model.ext.settings.set.requested.
7. Persist with v1.model.ext.settings.set.
### Add a backend action
1. Declare the action in public/manifest.json actions[].
2. Use externalCall for HTTP requests. Use delayedEvent only for deferred follow-up work.
3. Call the action with v1.ext.actions.call, passing all required params.
4. Handle non-success result.code explicitly.
5. Do not hardcode secrets in slot code.
### Add moveableOverlay
1. Add moveableOverlay to the slot configuration.
2. Add a page key and root HTML file for it.
3. Add moveableSlot to the manifest with width and height. Max size is 450x740.
4. Keep public/icon.svg in the archive root.
5. Add the HTML file to Vite input.
6. Update the resolver to return the page key only when appropriate.
### Final Check Before Finishing
- createExtHelper() is called once per page.
- public/resolveSlotPage.js is sync and returns only valid page keys or null.
- Every page key in views.pages points to a real root HTML file.
- Every root HTML file is included in Vite input.
- Subscriptions, timers, and DOM listeners are cleaned up.
- Durable logic lives in background.
- Theme styles are based on html[data-theme].
- Layout uses flexible CSS without viewport @media queries.
- manifest.json is valid JSON.

### References
- Overview: https://extensions.stripchat.com/docs/overview/how-extensions-work
- Manifest: https://extensions.stripchat.com/docs/getting-started/manifest
- Resolve slot page: https://extensions.stripchat.com/docs/getting-started/resolve-slot-page
- Slots: https://extensions.stripchat.com/docs/getting-started/slots
- Slots communication: https://extensions.stripchat.com/docs/getting-started/slots-communication
- Slots layout: https://extensions.stripchat.com/docs/getting-started/slots-layout
- Theming: https://extensions.stripchat.com/docs/getting-started/theming
- Settings: https://extensions.stripchat.com/docs/getting-started/settings
- Backend actions: https://extensions.stripchat.com/docs/getting-started/backend-actions
- Monitoring: https://extensions.stripchat.com/docs/getting-started/monitoring
- Requests: https://extensions.stripchat.com/docs/api/requests
- Events: https://extensions.stripchat.com/docs/api/events
- Entities: https://extensions.stripchat.com/docs/api/entities
