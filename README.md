# Director

Director turns a public room into a live cinematic where viewers fund the
opening shot, then bid token-by-token to grab the **Director's chair** and call
the shots on stage. Built with Preact + TypeScript on the Stripchat Extensions
SDK.

## How it plays

1. **Pre-production.** Every tip toward the model's tip-menu items pools into a
   shared "opening shot" goal. Once it's met, the room is officially LIVE.
2. **Director's chair.** The viewer with the highest cumulative tips becomes
   the Director and unlocks the on-screen command console.
3. **Bidding war.** Anyone can climb the leaderboard with more tips. After the
   immunity window expires, a challenger overtaking the Director by a
   configurable margin steals the chair — with a spotlight flash for the room.
4. **Cinema commands.** The Director spends a small token fee per call. Each
   command (Close-up, Turbo, Whisper, Bad-girl, …) hits the stage for a
   configurable duration with a per-command cooldown, queues if one is already
   playing, and is announced via chatbot.
5. **Reallocation.** Viewers can move tokens between menu items they already
   funded for a 1-token fee, so they're never stuck on a goal that stalled.

## Architecture

The room state lives in **one place**: the model's `background` slot. Every
other surface is disposable.

- `background` (model) — the state authority. Loads tip-menu, settings, and
  user context, validates payments, runs leadership, queue, cooldown and
  activity logic, and broadcasts a public `director.state` snapshot via
  `v1.ext.whisper` on every tick / heartbeat.
- `background` (viewer) — payment relay. When a viewer's `v1.payment.tokens.spend`
  succeeds, the viewer background re-broadcasts the intent + `paymentData` so
  the model's background can validate and apply it.
- `mainGameFun` — Preact UI for everyone: leaderboard, pressure bar, goals,
  tip composer, reallocation, command console (Director-only), timeline, and
  activity feed. Renders entirely from the snapshot — never owns state.
- `rightOverlay` — slim overlay that surfaces *who's running the room* and
  *what's on stage right now* with a subtle countdown and pressure indicator.
- `settings.html` — model-facing tuning for the bidding war (pre-prod goal,
  overtake margin, immunity, command duration, cooldown, cost).

The resolver routes per role:

- guest → no `background` (stays read-only via the visual slots)
- model → `backgroundModel`
- viewer → `backgroundViewer`

### Whisper protocol

All cross-frame messages are stamped with a `director.*` `type` field. Public
broadcasts go through `v1.ext.whisper`; payment-bearing intents from viewers
ride the `paymentData` from `v1.payment.tokens.spend.succeeded` (mandatory in
public shows). The model background ignores whispers without a valid payment
amount, dedupes by `transactionId`, and silently drops anything that doesn't
match.

## Project layout

```
public/
  manifest.json          slots + page keys + settings + resolver script
  resolveSlotPage.js     role-aware slot routing (sync, defensive)
  icon.svg
backgroundModel.html     model-only background entry
backgroundViewer.html    viewer-only background entry
mainGameFun.html         in-room game UI
rightOverlay.html        overlay status card
settings.html            model settings page
src/
  shared/
    commands.ts          Director command catalog
    settings.ts          DirectorSettings + normalization
    state.ts             public state types + whisper envelopes
    role.ts              guest/viewer/model resolution
    format.ts            formatters + clamps
    theme.css            shared design tokens + animations
    useDirectorState.ts  Preact hook that subscribes to state whispers
  slots/
    background/
      modelBackground.ts state authority
      viewerBackground.ts payment relay
      modelMain.ts / viewerMain.ts entries
    mainGameFun/         in-room UI
    rightOverlay/        overlay UI
    settings/            settings page UI
```

## Hard rules baked in

- `createExtHelper()` is called exactly once per page.
- Every page key in `manifest.json` resolves to a real root HTML file and an
  entry in `vite.config.ts` `build.rollupOptions.input`.
- The resolver is plain sync JS, returns only valid keys or `null`, and never
  imports app code.
- Visual slots subscribe + unsubscribe with named handlers and never own
  durable state.
- Settings save/cancel buttons are rendered by the platform — never inside
  `settings.html`.

See `AGENTS.md` for the full SDK contract.

## Usage

```bash
npm install
npm run dev
npm run build
```
