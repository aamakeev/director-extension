// Settings — для модели. Wizard, 4 шага, skeumorphic превью справа.

const { useState: useStateS, useMemo: useMemoS } = React;

const STEPS = [
  { num: 1, name: "Tonight's Goal", tag: "Stage" },
  { num: 2, name: "Action Menu",    tag: "Pulpit" },
  { num: 3, name: "Chair Rules",    tag: "Race" },
  { num: 4, name: "Go Live",        tag: "Curtain" },
];

const ACT_PRESETS = [
  { id: "spotlight", label: "Spotlight",  icon: "spotlight", price: 25,  cool: 0,  on: true  },
  { id: "outfit",    label: "Outfit",     icon: "outfit",    price: 50,  cool: 0,  on: true  },
  { id: "pose",      label: "Pose",       icon: "pose",      price: 30,  cool: 0,  on: true  },
  { id: "wink",      label: "Wink",       icon: "wink",      price: 20,  cool: 0,  on: true  },
  { id: "music",     label: "Drop Beat",  icon: "music",     price: 60,  cool: 30, on: true  },
  { id: "dice",      label: "Dare Roll",  icon: "dice",      price: 80,  cool: 60, on: true  },
  { id: "wave",      label: "Wave Hi",    icon: "wave",      price: 15,  cool: 0,  on: true  },
  { id: "flame",     label: "Heat Up",    icon: "flame",     price: 100, cool: 0,  on: true  },
  { id: "mic",       label: "Mic Cut",    icon: "micOff",    price: 75,  cool: 60, on: false },
];

// =============== Steps ===============

const Step1Goal = () => (
  <>
    <h2>What's tonight's <strong>boss goal</strong>?</h2>
    <p className="lead">
      One big drama beat. The bar fills up — you pay it off, viewers love it.
      Pick something cinematic, not a snooze.
    </p>
    <div className="set-fields">
      <div className="field field-full">
        <label>Goal name</label>
        <div className="input-wrap">
          <input type="text" defaultValue="Outfit Drop · Latex Pilot" />
        </div>
        <span className="hint">Show 'em the headline. "Outfit Drop", "Pole 60s", "Lap Dance" — concrete, dirty, cheeky.</span>
      </div>
      <div className="field">
        <label>Token target</label>
        <div className="input-wrap">
          <input type="number" defaultValue={6000} />
          <span className="unit">tk</span>
        </div>
      </div>
      <div className="field">
        <label>Payoff length</label>
        <div className="input-wrap">
          <input type="number" defaultValue={4} />
          <span className="unit">min</span>
        </div>
      </div>
      <div className="field field-full">
        <label>Top-3 perk</label>
        <div className="input-wrap">
          <input type="text" defaultValue="private wave + name on the screen" />
        </div>
        <span className="hint">Why your big tippers fight to be in top-3. Make it feel exclusive.</span>
      </div>
    </div>
  </>
);

const Step2Menu = () => {
  const [acts, setActs] = useStateS(ACT_PRESETS);
  const onCount = acts.filter(a => a.on).length;
  return (
    <>
      <h2>Build your <strong>action menu</strong></h2>
      <p className="lead">
        These are the keys on the director's console. Pick 6–9 you'll actually do.
        Set price = how loud they are. Cooldown = how often they can spam it.
      </p>
      <div className="mgf-sec-head" style={{padding: "4px 0"}}>
        <span>{onCount} keys live</span>
        <span className="mgf-sec-head-r">tap to toggle · drag price</span>
      </div>
      <div style={{display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px"}}>
        {acts.map(a => (
          <button
            key={a.id}
            className={`choice ${a.on ? "is-on" : ""}`}
            onClick={() => setActs(p => p.map(x => x.id === a.id ? {...x, on: !x.on} : x))}
          >
            <div className="choice-tt">
              {window.Icons[a.icon]} {a.label}
            </div>
            <div className="choice-sub">
              {a.price} tk{a.cool ? ` · ${a.cool}s cool` : ""}
            </div>
          </button>
        ))}
      </div>
    </>
  );
};

const Step3Race = () => {
  const [seatPrice, setSeatPrice] = useStateS(200);
  const [seatLen, setSeatLen] = useStateS(60);
  const vp = ((seatPrice - 50) / (1000 - 50)) * 100;
  return (
    <>
      <h2>Set the <strong>chair rules</strong></h2>
      <p className="lead">
        The chair is the fight. Whoever pays takes over for a minute and locks
        the keys for everyone else. Price climbs every time someone takes it.
      </p>
      <div className="set-fields">
        <div className="field field-full">
          <label>Starting chair price</label>
          <div className="slider-wrap">
            <input type="range" min={50} max={1000} step={10} value={seatPrice} onChange={e => setSeatPrice(+e.target.value)} style={{"--vp": `${vp}%`}} />
            <span className="slider-val">{seatPrice} tk</span>
          </div>
          <span className="hint">Each take +25%. Climbs hot if the room is loud, drops slow if no one bites for 90s.</span>
        </div>
        <div className="field">
          <label>Chair length</label>
          <div className="input-wrap">
            <input type="number" value={seatLen} onChange={e => setSeatLen(+e.target.value)} />
            <span className="unit">sec</span>
          </div>
        </div>
        <div className="field">
          <label>Pressure cap</label>
          <div className="input-wrap">
            <select defaultValue="auto">
              <option value="soft">Soft · model decides</option>
              <option value="auto">Auto · 90% triggers payoff</option>
              <option value="hard">Hard · always 100%</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
};

const Step4Live = () => (
  <>
    <h2>Curtain up?</h2>
    <p className="lead">
      Quick check before the LED on the console turns red.
    </p>
    <div style={{display: "flex", flexDirection: "column", gap: "8px"}}>
      {[
        { tt: "Tonight's goal", v: "Latex Pilot drop · 6000 tk · 4 min" },
        { tt: "Action menu",    v: "8 keys live · cheapest 15 tk · loudest 100 tk" },
        { tt: "Chair",          v: "200 tk start · 60s · auto pressure" },
        { tt: "Top-3 perk",     v: "private wave + screen name" },
      ].map((row, i) => (
        <div key={i} className="choice is-on" style={{cursor: "default"}}>
          <div className="choice-tt">
            <span style={{color: "var(--d-amber-hot)"}}>{window.Icons.spark}</span> {row.tt}
          </div>
          <div className="choice-sub">{row.v}</div>
        </div>
      ))}
    </div>
  </>
);

// =============== Preview pane ===============

const TipFlowPreview = () => (
  <div className="tip-flow">
    <div className="tip-flow-target">
      <div className="tip-flow-tt">
        <small>boss goal</small>
        Latex Pilot
      </div>
      <div className="tip-flow-amt">→</div>
    </div>
    <div className="tip-bar-track"><div className="tip-bar-fill"></div></div>
    <div className="tip-chip tip-chip-a"><span>vinyl_wolf</span><strong>+25</strong></div>
    <div className="tip-chip tip-chip-b"><span>banana_king</span><strong>+200</strong></div>
    <div className="tip-chip tip-chip-c"><span>midnight_mia</span><strong>+60</strong></div>
    <div className="tip-flow-unlocked">UNLOCKED · curtain up</div>
  </div>
);

const DeckMiniPreview = () => (
  <div className="deck-mini">
    <div className="deck-mini-vfd">
      <div className="deck-mini-vfd-l">Now Directing</div>
      <div className="deck-mini-vfd-line">
        {window.Icons.outfit} Wardrobe Change
        <span className="timer">00:47</span>
      </div>
    </div>
    <div className="deck-mini-grid">
      {["spotlight", "outfit", "pose", "wink", "music", "dice"].map((ic, i) => (
        <div key={i} className={`deck-mini-key ${i > 3 ? "cool" : ""}`}>
          {window.Icons[ic]}
        </div>
      ))}
    </div>
  </div>
);

const RaceMiniPreview = () => (
  <div className="race-mini">
    <div className="race-pair">
      <div className="race-card is-lead">
        <div className="race-tag">in chair</div>
        <div className="race-name">BananaKing</div>
        <div className="race-tk">200 tk · 47s left</div>
      </div>
      <div className="race-vs">vs</div>
      <div className="race-card">
        <div className="race-tag">challenger</div>
        <div className="race-name">vinyl_wolf</div>
        <div className="race-tk">need 250 tk</div>
      </div>
    </div>
    <div className="race-pressure">
      <div className="race-track"><span></span></div>
      <div className="race-gap">62%</div>
    </div>
  </div>
);

const PreviewPane = ({ stepIdx }) => {
  const titles = ["Tip → Goal", "Action Console", "Chair Race", "Curtain Up"];
  return (
    <aside className="preview">
      <div className="preview-title">Preview · {titles[stepIdx]}</div>
      {stepIdx === 0 && <TipFlowPreview />}
      {stepIdx === 1 && <DeckMiniPreview />}
      {stepIdx === 2 && <RaceMiniPreview />}
      {stepIdx === 3 && (
        <div className="video-ph">
          <div className="video-ph-cap">demo · curtain up</div>
        </div>
      )}
      <div className="video-ph" style={{aspectRatio: "16 / 9"}}>
        <div className="video-ph-cap">video tutorial · 30s</div>
      </div>
    </aside>
  );
};

// =============== Main ===============

const Settings = () => {
  const [step, setStep] = useStateS(0);
  const StepBody = [Step1Goal, Step2Menu, Step3Race, Step4Live][step];

  return (
    <div className="set-shell" data-screen-label="Settings (Model)">
      <header className="set-top">
        <div className="set-top-left">
          <div className="set-top-mark">{window.Icons.chair}</div>
          <div className="set-top-text">
            <h1>Director · setup tonight's stage</h1>
            <p>Four steps. Skim it. The console reads from this.</p>
          </div>
        </div>
        <div className="set-time-budget">{window.Icons.hourglass} 60 sec</div>
      </header>

      <div className="set-stepper">
        {STEPS.map((s, i) => (
          <button
            key={s.num}
            className={`set-step-pill ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}
            onClick={() => setStep(i)}
          >
            <div className="set-step-num-row">
              <span className="set-step-num">{i < step ? "✓" : s.num}</span>
              <span className="set-step-tag">{s.tag}</span>
            </div>
            <div className="set-step-name">{s.name}</div>
          </button>
        ))}
      </div>

      <div className="set-step has-preview">
        <div className="set-step-body">
          <StepBody />
          <div className="set-nav">
            <button className="btn btn-ghost" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setStep(s => s + 1)}>
                Next · {STEPS[step + 1].name} {window.Icons.chev}
              </button>
            ) : (
              <button className="btn btn-primary">
                {window.Icons.bolt} Curtain up
              </button>
            )}
          </div>
        </div>
        <PreviewPane stepIdx={step} />
      </div>
    </div>
  );
};

window.Settings = Settings;
