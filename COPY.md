# Director — UI Strings

Single source of truth for every user-visible string in the Director extension. Use this when reviewing tone, translating, or auditing what the platform shows. Tokens like `{username}`, `{amount}`, `{itemTitle}`, `{remaining}` are filled in at runtime.

---

## rightOverlay (slot)

| Key | Text | Notes |
|---|---|---|
| brand | `by Stripchat` | Top-left of remote chrome |
| status.live | `Live` | LED red, pulsing |
| status.active | `Active` | LED green, pulsing — game accepting tips, not yet unlocked |
| status.paused | `Paused` | LED amber, static |
| sync.label | `SYNC` | Connecting / no state yet — replaced by styled loader |
| screen.unlock.label | `Unlock Director` | Pre-unlock LCD heading |
| screen.unlock.value | `{totalSessionTips}` `/ {preproductionGoal} tk` | Two-line tk fraction |
| screen.unlock.sub | `Tip the menu to unlock` | Pre-unlock helper |
| screen.now.label | `Happening now` | LCD when a Director command is playing |
| screen.now.by | `by Stripchat` | Sub-line under the playing command |
| screen.your-turn.label | `Your turn` | When viewer is the Director and pad is idle |
| screen.your-turn.body | `Pick what happens next — tap an action below` | |
| screen.live.label | `Live` | Live with no Director command currently playing |
| screen.live.body | `{name} has the remote — hang tight for their pick` | |
| screen.live.body.empty | `Waiting for someone to take the remote` | When `director.id` is null |
| screen.paused.label | `Paused` | Model paused the game |
| screen.paused.body | `Model paused Director Control` | |
| screen.paused.sub | `Tips Cooperations is still available.` | |
| screen.director.label | `Now controlling` | Strip showing current Director |
| screen.director.value | `{directorName} · {directorTotal} tk` | |
| screen.director.self | `You spent {selfTotal} tk` | When viewer is the Director |
| meter.unlock | `Unlock` / `Unlock target` | Bar label (model variant in parens) |
| meter.shield.label | `Director safe` | Tenure protection countdown |
| meter.pressure.label | `{challengerName}` | Pressure meter, showing challenger name |
| meter.pressure.needed.normal | `{neededToOvertake} tk` | tk to overtake |
| meter.pressure.needed.critical | `−{neededToOvertake}` | within margin |
| pad.title.armed | `Actions` | Director can press buttons |
| pad.cost | `{cost} tk each` | |
| pad.locked.title | `🔒 Locked` | |
| pad.locked.waiting | `Waiting for the model to start` | |
| pad.locked.unlock | `Tip to unlock Director Control` | |
| pad.locked.model | `Only viewers use this remote` | |
| pad.locked.notdirector | `Become Director to give orders` | |
| chair.guest | `Sign in · {tk} tk` | Guest-only CTA |
| chair.cta | `Become Director · {tk} tk` | Logged-in viewer CTA |
| chair.director | `Your move.` | When viewer is the Director |
| model.live.empty | `Live` / `Waiting for a Director` | Model screen when isLive but no director |
| model.live.safe.label | `Director safe` | Model screen, tenure remaining |
| model.live.seat-open.label | `Live` / `Director seat open` | |

### rightOverlay action labels (commands)

| ID | Label | Emoji |
|---|---|---|
| visual_closeup | Close-up | 🔍 |
| visual_eyes | Eyes Contact | 👁 |
| tempo_slow | Slow | 🐌 |
| tempo_freeze | Freeze | 🧊 |
| sound_silence | Quiet | 🤫 |
| mood_bad_girl | Bad Girl | 😈 |

---

## mainGameFun (model)

| Key | Text |
|---|---|
| block.goal.title | `Goal` |
| block.goal.sub | `Unlocks Director Control` |
| block.remote.title | `Remote & Director Seat` |
| status.chip.live | `Live` |
| status.chip.active | `Active` |
| status.chip.paused | `Paused` |
| input.unit.tk | `tk` |
| input.unit.sec | `sec` |
| input.unit.percent | `%` |
| launch.start | `Launch Goal` |
| launch.stop | `Stop Goal` |
| save.button | `Save` |
| validation.required | `Required` |
| validation.integer | `Whole number` |
| validation.min | `Min {n}` |
| validation.max | `Max {n}` |

### Field labels (model + settings.html)

| Field | Label | Hint |
|---|---|---|
| preproductionGoal | `Tokens to unlock Director Control` | `Room tips on menu lines stack until this total unlocks Director Control.` |
| tipMenuMarkupPercent | `Markup on each menu line` | `e.g. 10% on 50 tk → 55 tk shown on stage.` |
| commandCostTokens | `Cost per command press` | `What the Director pays each time they send an action from the remote.` |
| commandDurationSec | `Approximate duration of each command` | `Roughly how long you stay in the requested vibe before moving on.` |
| commandCooldownSec | `Pause before the same command repeats` | `Stops viewers from spamming the same command back-to-back.` |
| overtakeMargin | `Tokens required to overtake the Director` | `A chasing viewer needs this many tokens above the Director's total to take the seat.` |
| minTenureSec | `Director protection` | `After someone becomes Director they cannot be replaced for this long.` |

---

## mainGameFun (viewer)

| Key | Text |
|---|---|
| menu.tip.preset.10 | `+10` |
| menu.tip.preset.25 | `+25` |
| menu.tip.preset.50 | `+50` |
| menu.tip.preset.100 | `+100` |
| menu.tip.custom.placeholder | `other` |
| menu.tip.button | `Tip` |
| menu.move.label | `Move {amount} tk to:` |
| menu.move.button | `Move` |
| menu.move.fee | `1 tk fee` |
| menu.you-pill | `you · {amount} tk` |
| menu.target | `target {price} tk` |
| menu.left | `{tokensLeft} left` |
| stage.title | `Stage` |
| stage.idle.viewer | `Tips and Director orders show here once you're live.` |
| stage.empty.gamepaused | `Model paused Director Control — your menu tips still count on each line.` |
| stage.empty.live | `Nothing queued · Director picks actions on the remote.` |
| stage.empty.preunlock | `Shows here once Director Control unlocks.` |
| self.summary | `You've put {total} tk on the table this round.` |
| viewer.status.unlock | `{totalSessionTips} / {preproductionGoal} tk to unlock` |

---

## settings.html

| Key | Text |
|---|---|
| header.brand.name | `Director` |
| header.brand.tag | `by Stripchat` |
| section.goal.title | `Goal` |
| section.remote.title | `Remote` |
| section.seat.title | `Director Seat` |
| banner.loading | `Loading…` |

(Field labels and hints reuse the entries above.)

---

## Loaders

| Key | Text |
|---|---|
| loader.text | `Connecting…` |

---

## Toasts (model + viewer)

| Key | Text |
|---|---|
| toast.payment.cancelled | `Payment cancelled` |
| toast.tip.counted | `Counted: {amount}tk → "{itemTitle}"` |
| toast.move.success | `Reallocated {amount}tk` |
| toast.move.invalid | `Invalid reallocation request` |
| toast.move.balance | `Not enough balance in "{itemTitle}"` |
| toast.move.gone | `One of the menu positions is no longer available` |
| toast.tip.no-menu | `No tip menu items available right now` |
| toast.chair.tenure | `Wait until the Director safe window ends` |
| toast.chair.already | `You are already the Director` |
| toast.chair.queued | `You already qualify—syncing…` |
| toast.chair.amount | `Tip exactly {amount} tk to become Director` |
| toast.chair.toward | `{amount}tk toward the Director seat` |
| toast.command.unknown | `Unknown command` |
| toast.command.notlive | `Commands unlock once we are LIVE` |
| toast.command.notdirector | `Only the Director can send commands` |
| toast.command.cooldown | `Command on cooldown: {sec}s` |
| toast.command.sent | `"{label}" sent` |
| toast.settings.saved | `Settings updated` |
| toast.settings.failed | `Could not save settings` |
| toast.game.start | `Game on — viewers can unlock Director mode` |
| toast.game.stop | `Game paused` |
| toast.game.failed | `Could not update game` |

---

## Chat templates (sent via `v1.chat.message.send`)

> Author = the **tipper's** user object for tip / chair / command messages, the **model's** `context.user` for system messages.

| Key | Author | Template |
|---|---|---|
| chat.tip.preunlock | tipper | `{user} +{amount} tk → {itemTitle} · {remaining} tk to unlock` |
| chat.tip.unlocked | tipper | `{user} +{amount} tk → {itemTitle} · Director unlocked!` |
| chat.tip.routine | tipper | `{user} +{amount} tk → {itemTitle}` |
| chat.chair.takeover | tipper | `{user} +{amount} tk → took the Director seat` |
| chat.command | tipper (Director) | `Director called: {emoji} {label}` |
| chat.goal.complete.solo | model | `Stage — room filled "{itemTitle}" ({price} tk). {contributorName} contributed {amount} tk. Thank you for "{itemTitle}".` |
| chat.goal.complete.multi | model | `Stage — room filled "{itemTitle}" ({price} tk). {n} viewers contributed (...). Thank you for "{itemTitle}".` |
| chat.goal.complete.room | model | `Stage — room filled "{itemTitle}" ({price} tk). Room funded this tip menu line. Thank you for "{itemTitle}".` |
| chat.live.unlock | model | `We're LIVE! Tip goal met — {directorName} is Director and calls the shots.` |
| chat.director.new | model | `{name} is now Director.` |
| chat.game.start | model | `Director game started. Once the unlock goal is reached, top spender becomes Director.` |
| chat.game.stop | model | `Director game paused. Menu tips still stack toward each tip-menu line.` |

---

## Activity feed (in-tab text shown to viewers)

| Key | Template |
|---|---|
| feed.live.unlock | `We're LIVE — Director: {name}` |
| feed.director.new | `New Director: {name}` |
| feed.tip | `{name} +{amount}tk → "{itemTitle}"{ · {remaining} tk to unlock | · Director unlocked!}` |
| feed.chair | `{name} +{amount}tk → Director chase` |
| feed.move | `{name} moved {amount}tk: "{from}" → "{to}"` |
| feed.command | `Director: {emoji} {label}` |
| feed.goal | `Room collected for "{itemTitle}" ({contributorList}) for "{itemTitle}".` |
| feed.game.start | `Model started Director game` |
| feed.game.stop | `Model paused Director game` |

---

## Monitoring (stable error/log identifiers — sent to host monitoring, not user-facing)

- `director v1.chat.message.send failed`
- `director model whisper failed`
- `director activity whisper (room) failed`
- `director activity whisper.local failed`
- `director v1.ext.activity.request failed`
