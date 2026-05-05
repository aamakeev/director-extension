// mainGameFun — таба рядом со стримом (320px со скроллом).
// Контент: Goal stage, мой вклад, leaderboard, stage feed, how-to-strip.

const { useState: useStateMG, useEffect: useEffectMG } = React;

// ===== Mock data =====

const GOAL = {
  tag: "Tonight's Boss Goal",
  name: "Outfit Drop · Latex Pilot",
  current: 4280,
  total: 6000,
  myStake: 1240,           // мой вклад в этот гоал
  myMarkerPct: 0.48,       // где маркер "you" на баре
  etaMin: 12,
};

const QUICK_PUSHES = [25, 50, 100];

const ME = {
  rank: 4,
  totalContrib: 2840,
  rankUpAt: 3120,          // следующий ранг при
  totalRanks: 87,
};

const LEADERBOARD = [
  { rank: 1, nick: "BananaKing",   sub: "in chair · 47s",  amt: 5240, c1: "#ff8a4a", c2: "#c97a3a", top1: true },
  { rank: 2, nick: "MidnightMia",  sub: "shadow director", amt: 4180, c1: "#7c3aed", c2: "#b56a2c" },
  { rank: 3, nick: "VinylVolk",    sub: "raised pressure", amt: 3055, c1: "#3ddc97", c2: "#4a6b8c" },
  { rank: 4, nick: "you",          sub: "your seat",       amt: 2840, c1: "#6a9bd8", c2: "#4a6b8c", me: true },
  { rank: 5, nick: "RetroRiot",    sub: "—",                amt: 2410, c1: "#e25668", c2: "#8a6a35" },
];

const FEED_INIT = [
  { id: 1, icon: "crown",     tone: "fire", html: <><span className="who">BananaKing</span> took the chair · <span className="amt">+200 tk</span></>, t: "now" },
  { id: 2, icon: "spotlight", tone: "",      html: <><span className="who">VinylVolk</span> spent <span className="amt">25 tk</span> on Spotlight</>, t: "12s" },
  { id: 3, icon: "music",     tone: "cool",  html: <><span className="who">MidnightMia</span> dropped the beat <span className="amt">60 tk</span></>, t: "34s" },
  { id: 4, icon: "outfit",    tone: "fire",  html: <><b>OUTFIT GOAL</b> 60% reached</>, t: "1m" },
  { id: 5, icon: "spark",     tone: "",      html: <><span className="who">guest_4912</span> joined as <b>banana</b></>, t: "2m" },
  { id: 6, icon: "flame",     tone: "rec",   html: <><span className="who">you</span> heated up <span className="amt">100 tk</span> · pressure max</>, t: "3m" },
];

// ===== Sub-components =====

const Mark = () => (
  <div className="mgf-mark">
    <div className="mgf-mark-badge">{window.Icons.chair}</div>
    <div className="mgf-mark-text">
      <span className="mgf-mark-name">Director</span>
      <span className="mgf-mark-tag">tonight's stage</span>
    </div>
    <div className="mgf-mark-pill">live</div>
  </div>
);

const HowtoStrip = () => (
  <div className="mgf-sec" style={{padding: 0, background: "transparent", border: "none"}}>
    <div className="howto-strip">
      <div className="howto-tile">
        <div className="howto-num">1</div>
        <div className="howto-name">Tip the goal</div>
        <div className="howto-sub">push bar</div>
      </div>
      <div className="howto-tile">
        <div className="howto-num">2</div>
        <div className="howto-name">Take the chair</div>
        <div className="howto-sub">lock keys</div>
      </div>
      <div className="howto-tile">
        <div className="howto-num">3</div>
        <div className="howto-name">Direct the model</div>
        <div className="howto-sub">spend 60s</div>
      </div>
    </div>
  </div>
);

const GoalStage = () => {
  const pct = GOAL.current / GOAL.total;
  return (
    <div className="goal-stage">
      <div className="goal-tag">{window.Icons.bolt} {GOAL.tag}</div>
      <div className="goal-name">
        Make her drop the <em>Latex Pilot</em>
      </div>

      <div className="goal-bar-wrap">
        <div className="goal-bar">
          <div className="goal-bar-fill" style={{width: `${pct * 100}%`}}></div>
        </div>
        <div className="goal-mine-marker" style={{left: `${GOAL.myMarkerPct * 100}%`}}></div>
      </div>

      <div className="goal-row">
        <span>
          <span className="goal-num">{GOAL.current.toLocaleString()}</span>
          <span className="goal-num-total"> / {GOAL.total.toLocaleString()} tk</span>
        </span>
        <span className="goal-eta">{window.Icons.hourglass} ~{GOAL.etaMin} min at this pace</span>
      </div>

      <div className="goal-payoff">
        {window.Icons.outfit}
        <span>Goal hits → she walks the stage in the <strong>Pilot fit</strong> for 4 minutes. Top 3 tippers get a <strong>private wave</strong>.</span>
      </div>

      <div className="goal-push">
        {QUICK_PUSHES.map((amt, i) => (
          <button key={amt} className={`push-chip ${i === QUICK_PUSHES.length - 1 ? "is-hot" : ""}`}>
            <span className="push-chip-amt">+{amt}</span>
            <span className="push-chip-tag">push</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const Contribute = () => {
  const pct = ME.totalContrib / ME.rankUpAt;
  const need = ME.rankUpAt - ME.totalContrib;
  return (
    <div className="mgf-sec">
      <div className="mgf-sec-head">
        <span>Your stake</span>
        <span className="mgf-sec-head-r">rank <b>#{ME.rank}</b> of {ME.totalRanks}</span>
      </div>
      <div className="contribute">
        <div className="contribute-row">
          <div className="contribute-amt">
            {ME.totalContrib.toLocaleString()}<small>tk tonight</small>
          </div>
          <div className="contribute-rank">
            <div className="contribute-rank-tag">to #{ME.rank - 1}</div>
            <div className="contribute-rank-num">+{need}<small>tk</small></div>
          </div>
        </div>
        <div className="contribute-strip">
          <span style={{width: `${pct * 100}%`}}></span>
        </div>
        <div className="contribute-foot">
          <span>+<b>{GOAL.myStake} tk</b> on tonight's goal</span>
          <span>You move <b>2 ranks</b> if you push <b>{need}</b></span>
        </div>
      </div>
    </div>
  );
};

const Leaderboard = () => (
  <div className="mgf-sec">
    <div className="mgf-sec-head">
      <span>Tonight's Crew</span>
      <span className="mgf-sec-head-r">resets in <b>3h 12m</b></span>
    </div>
    <div className="lb">
      {LEADERBOARD.slice(0, 3).map(r => <LbRow key={r.rank} r={r} />)}
      <div className="lb-divider">— You —</div>
      {LEADERBOARD.filter(r => r.me).map(r => <LbRow key={r.rank} r={r} />)}
      {LEADERBOARD.filter(r => !r.me && r.rank > 3).map(r => <LbRow key={r.rank} r={r} />)}
    </div>
  </div>
);

const LbRow = ({ r }) => (
  <div className={`lb-row ${r.me ? "is-me" : ""} ${r.top1 ? "is-top1" : ""}`}>
    <div className="lb-rank">
      {r.top1 ? <span className="lb-rank-medal">{window.Icons.crown}</span> : `#${r.rank}`}
    </div>
    <div className="lb-name">
      <div className="lb-avatar" style={{ "--d-c1": r.c1, "--d-c2": r.c2 }}>
        {r.nick === "you" ? "ME" : r.nick.slice(0, 2).toUpperCase()}
      </div>
      <div className="lb-nick">
        {r.nick}
        <small>{r.sub}</small>
      </div>
    </div>
    <div className="lb-tk">{r.amt.toLocaleString()}<small>tk</small></div>
  </div>
);

const StageFeed = () => {
  const [tab, setTab] = useStateMG("all");
  return (
    <div className="mgf-sec">
      <div className="mgf-sec-head">
        <span>Stage Feed</span>
        <span className="mgf-sec-head-r">live · <b>{FEED_INIT.length} events</b></span>
      </div>
      <div className="feed-tabs">
        {["all", "tips", "chairs", "goals"].map(t => (
          <button key={t} className={`feed-tab ${tab === t ? "is-on" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="feed">
        {FEED_INIT.map((f, i) => (
          <div key={f.id} className={`feed-row ${i === 0 ? "is-fresh" : ""}`}>
            <div className={`feed-icon tone-${f.tone}`}>{window.Icons[f.icon]}</div>
            <div className="feed-body">
              <div className="feed-line">{f.html}</div>
              <div className="feed-time">{f.t}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Confetti на тапе по push-chip — лёгкий celebrations
const Celebrations = ({ trigger }) => {
  const [pieces, setPieces] = useStateMG([]);
  useEffectMG(() => {
    if (!trigger) return;
    const N = 36;
    const cols = ["#ffb86b", "#c97a3a", "#f4f1ea", "#6a9bd8", "#e25668"];
    const newPieces = Array.from({length: N}).map((_, i) => ({
      id: trigger + "_" + i,
      left: Math.random() * 100,
      dx: (Math.random() - 0.5) * 240,
      dur: 1.6 + Math.random() * 1.2,
      delay: Math.random() * 0.3,
      color: cols[i % cols.length],
      rot: Math.random() * 360,
    }));
    setPieces(newPieces);
    const t = setTimeout(() => setPieces([]), 3200);
    return () => clearTimeout(t);
  }, [trigger]);
  if (!pieces.length) return null;
  return (
    <div className="celebrate">
      <div className="celebrate-banner">+100 tk · GOAL GO!</div>
      {pieces.map(p => (
        <div key={p.id} className="confetti" style={{
          left: `${p.left}%`,
          top: 0,
          background: p.color,
          transform: `rotate(${p.rot}deg)`,
          animation: `confetti-fall ${p.dur}s ease-in ${p.delay}s forwards`,
          "--dx": `${p.dx}px`,
        }} />
      ))}
    </div>
  );
};

// ===== Main =====

const MainGameFun = () => {
  const [celebrate, setCelebrate] = useStateMG(0);
  return (
    <div className="mgf-shell" data-screen-label="Main Game Fun">
      <Mark />
      <HowtoStrip />
      <GoalStage />
      <Contribute />
      <Leaderboard />
      <StageFeed />
      {/* trigger button hidden — для демо в canvas: */}
      <Celebrations trigger={celebrate} />
    </div>
  );
};

window.MainGameFun = MainGameFun;
