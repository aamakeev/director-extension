// Right Overlay — режиссёрский пульт ДУ.
// Вертикальный, нависает над стримом, полупрозрачный.

// =============== Mock data ===============

const ROOM = {
  modelName: "Sasha Director",
  viewers: 1247,
  isLive: true,
  // активная сцена
  scene: {
    name: "Wardrobe Change",
    lockedBy: null,
    lockedAvatar: "BK",
    timerSec: 47,                // осталось
    pressure: 0.74,              // 0..1 — как сильно зрители "давят"
    shield: 0.32,                // 0..1 — щит модели
  },
  // ценник входа в кресло
  seatCost: 200,
  seatNextBump: 250,             // через сколько подскочит
  // время до апдейта
  seatNextBumpIn: 18,            // sec
};

// Действия пульта
const ACTS = [
  { id: "spotlight", label: "Spotlight", icon: "spotlight", cost: 25, cd: null,  hot: true  },
  { id: "outfit",    label: "Outfit",    icon: "outfit",    cost: 50, cd: null,  hot: false },
  { id: "pose",      label: "Pose",      icon: "pose",      cost: 30, cd: null,  hot: false },
  { id: "wink",      label: "Wink",      icon: "wink",      cost: 20, cd: null,  hot: false },
  { id: "mic",       label: "Mic Cut",   icon: "micOff",    cost: 75, cd: 9,     hot: false },
  { id: "music",     label: "Drop Beat", icon: "music",     cost: 60, cd: null,  hot: false },
  { id: "dice",      label: "Dare Roll", icon: "dice",      cost: 80, cd: null,  hot: false },
  { id: "wave",      label: "Wave Hi",   icon: "wave",      cost: 15, cd: null,  hot: false },
  { id: "flame",     label: "Heat Up",   icon: "flame",     cost: 100, cd: null, hot: true  },
];

// =============== Sub-components ===============

const ConsoleHead = () => (
  <header className="console-head">
    <div className="console-mark">
      <div className="console-mark-name">Director</div>
      <div className="console-mark-tag">Master Console · v3</div>
    </div>
    <div className="console-head-right">
      <span className="console-viewer-count">
        {window.Icons.eye}
        {ROOM.viewers.toLocaleString()}
      </span>
      <span className={`live-led ${ROOM.isLive ? "is-on" : ""}`}>Live</span>
    </div>
  </header>
);

const VFD = () => {
  const { scene } = ROOM;
  const mm = String(Math.floor(scene.timerSec / 60)).padStart(2, "0");
  const ss = String(scene.timerSec % 60).padStart(2, "0");
  const isSoon = scene.timerSec < 60;

  return (
    <div className="vfd">
      <span className="vfd-corner tl"></span>
      <span className="vfd-corner tr"></span>
      <span className="vfd-corner bl"></span>
      <span className="vfd-corner br"></span>

      <div className="vfd-label">
        <span>Now Directing</span>
      </div>
      <div className="vfd-line">
        {window.Icons.slate}
        <span className="vfd-text">{scene.name}</span>
        <span className={`vfd-timer ${isSoon ? "is-soon" : ""}`}>{mm}:{ss}</span>
      </div>
      <div className="vfd-sub">
        chair: <strong>{scene.lockedBy ?? "vacant"}</strong>
        {scene.lockedBy ? " · ends scene" : " · take it below"}
      </div>
    </div>
  );
};

const Meters = () => {
  const { scene } = ROOM;
  const isCritical = scene.pressure > 0.9;
  return (
    <div className="meters">
      <div className="meter">
        <div className="meter-row">
          <span className="meter-name">{window.Icons.flame} Pressure</span>
          <span className="meter-val">{Math.round(scene.pressure * 100)}%</span>
        </div>
        <div className={`meter-track ${isCritical ? "is-critical" : ""}`}>
          <div className="meter-fill" style={{ width: `${scene.pressure * 100}%` }} />
          <div className="meter-peak" style={{ left: "82%" }} />
        </div>
      </div>
      <div className="meter">
        <div className="meter-row">
          <span className="meter-name">{window.Icons.shield} Shield</span>
          <span className="meter-val">{Math.round(scene.shield * 100)}%</span>
        </div>
        <div className="meter-track meter--shield">
          <div className="meter-fill" style={{ width: `${scene.shield * 100}%` }} />
        </div>
      </div>
    </div>
  );
};

const ChairRow = () => {
  const who = ROOM.scene.lockedBy;
  return (
    <div className="chair-row">
      {window.Icons.chair}
      <div>
        <div className="chair-tag">{who ? "In the chair" : "Chair open"}</div>
      </div>
      <div className="chair-name">
        {who || "Your move"}
        <small>{who ? `locked · ${ROOM.scene.timerSec}s left` : "snag it before price bumps"}</small>
      </div>
    </div>
  );
};

const PadKey = ({ act, locked }) => (
  <button className={`key ${act.hot ? "is-hot" : ""}`} disabled={locked || !!act.cd}>
    {act.cd && <span className="key-cd">{act.cd}s</span>}
    <span className="key-icon">{window.Icons[act.icon]}</span>
    <span className="key-label">{act.label}</span>
    <span className="key-cost">{act.cost}</span>
  </button>
);

const Pad = ({ locked }) => (
  <>
    <div className="section-plate">
      <span className="section-plate-name">Direct-Act</span>
      <span className="section-plate-cost">
        from <b>15</b> tk
      </span>
    </div>
    <div className={`pad ${locked ? "is-locked" : ""}`}>
      <div className="pad-grid">
        {ACTS.map(a => <PadKey key={a.id} act={a} locked={locked} />)}
      </div>
    </div>
  </>
);

const OpenSeat = () => (
  <div className="open-seat">
    <div className="open-seat-title">
      {window.Icons.chair} Take The Chair
    </div>
    <div className="open-seat-copy">
      You become <strong>director</strong> for 60 sec.<br/>
      Lock all keys. Run the scene.
    </div>
    <button className="bite-btn">
      {window.Icons.bolt}
      Take · {ROOM.seatCost} tk
    </button>
    <div className="open-seat-foot">
      Price climbs to <b style={{color: 'var(--d-amber-hot)'}}>{ROOM.seatNextBump}</b> in {ROOM.seatNextBumpIn}s
    </div>
  </div>
);

// =============== Main ===============

const RightOverlay = () => {
  const locked = !!ROOM.scene.lockedBy;
  return (
    <div className="ro-shell" data-screen-label="Right Overlay">
      <div className="console">
        <ConsoleHead />
        <VFD />
        <Meters />
        <ChairRow />
        <Pad locked={locked} />
        <OpenSeat />
        <div className="console-bottom-screws">
          <span></span><span></span>
        </div>
      </div>
    </div>
  );
};

window.RightOverlay = RightOverlay;
