// mainGameFun — таба рядом со стримом. 320px, без скролла.
// Цели > Лидерборд > Стейдж-фид. Празднование при тратах.

const { useState, useEffect, useRef } = React;

// ── данные ──
const GOALS_INIT = [
  {
    id: "outfit",
    icon: "outfit",
    name: "Сменить наряд",
    target: 200,
    current: 138,
    mine: 75,
    flag: "горячо",
    state: "soon",
    backers: 7,
  },
  {
    id: "lipstick",
    icon: "wink",
    name: "Помада · алая",
    target: 120,
    current: 42,
    mine: 30,
    flag: "ваш фаворит",
    state: "mine",
    backers: 3,
  },
  {
    id: "song",
    icon: "music",
    name: "Cпеть «Bésame»",
    target: 350,
    current: 88,
    mine: 0,
    flag: null,
    state: null,
    backers: 5,
  },
];

const PRESETS = [10, 25, 50, 100];

const LB_INIT = [
  { rank: 1, name: "@kira_v",     tk: 880, spark: [3, 5, 4, 6, 5, 8, 9, 11], me: false, icon: "crown" },
  { rank: 2, name: "вы · @max_sim", tk: 545, spark: [2, 3, 3, 4, 5, 6, 7, 8], me: true, icon: "trophy" },
  { rank: 3, name: "@serafima",   tk: 412, spark: [4, 6, 5, 5, 4, 4, 5, 6], me: false, icon: "trophy" },
  { rank: 4, name: "@lev_v",      tk: 280, spark: [1, 2, 2, 3, 3, 4, 4, 5], me: false, icon: "headset" },
  { rank: 5, name: "@nikola",     tk: 165, spark: [1, 1, 2, 2, 3, 2, 3, 3], me: false, icon: "headset" },
];

const FEED_INIT = [
  { id: 1, kind: "now",     icon: "spotlight", text: "Спотлайт на Анну", by: "вы", time: "0:18" },
  { id: 2, kind: "next",    icon: "outfit",    text: "Смена наряда",     by: "@kira_v", time: "0:42" },
  { id: 3, kind: "next",    icon: "music",     text: "Музыка громче",    by: "@serafima", time: "1:16" },
  { id: 4, kind: "past",    icon: "wink",      text: "Подмиг от Анны",   by: "@lev_v",  time: "1м" },
  { id: 5, kind: "past",    icon: "spark",     text: "Сюрприз получен",  by: "@nikola", time: "3м" },
];

function Sparkline({ pts, className }) {
  if (!pts || pts.length < 2) return null;
  const max = Math.max(...pts);
  const w = 38, h = 14;
  const step = w / (pts.length - 1);
  const path = pts.map((p, i) => {
    const x = i * step;
    const y = h - (p / max) * (h - 2) - 1;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className={"lb-spark " + (className || "")} viewBox={`0 0 ${w} ${h}`}>
      <path d={path} />
    </svg>
  );
}

function Celebration({ count = 24 }) {
  const colors = ["#ffb86b", "#e6a04a", "#c97a3a", "#fff4d6", "#ff8a4a"];
  const bursts = Array.from({ length: count }).map((_, i) => {
    const a = (i / count) * Math.PI * 2;
    const r = 60 + Math.random() * 80;
    const dx = Math.cos(a) * r;
    const dy = Math.sin(a) * r;
    return (
      <span
        key={i}
        className="celebrate-burst"
        style={{
          background: colors[i % colors.length],
          transform: `translate(${dx}px, ${dy}px)`,
          left: "50%",
          top: "50%",
          animationDelay: (Math.random() * 0.1) + "s",
        }}
      />
    );
  });
  return <div className="celebrate">{bursts}</div>;
}

function MainGameFun() {
  const [goals, setGoals] = useState(GOALS_INIT);
  const [lb, setLb] = useState(LB_INIT);
  const [feed, setFeed] = useState(FEED_INIT);
  const [tipPick, setTipPick] = useState({}); // id -> amount
  const [celebrate, setCelebrate] = useState(false);

  // имитация чужих ставок
  useEffect(() => {
    const t = setInterval(() => {
      setGoals(prev => prev.map(g => {
        if (Math.random() < 0.32) {
          const inc = 5 + Math.floor(Math.random() * 20);
          return { ...g, current: Math.min(g.target, g.current + inc), backers: g.backers + 1 };
        }
        return g;
      }));
    }, 4200);
    return () => clearInterval(t);
  }, []);

  function tip(g, amt) {
    setGoals(prev => prev.map(x => x.id === g.id
      ? { ...x, current: Math.min(x.target, x.current + amt), mine: x.mine + amt, state: "mine", flag: x.flag || "ваш вклад" }
      : x));
    setLb(prev => prev.map(p => p.me ? { ...p, tk: p.tk + amt } : p));
    setFeed(prev => [
      { id: Date.now(), kind: "past", icon: g.icon, text: `${g.name} +${amt}`, by: "вы", time: "сейчас" },
      ...prev.slice(0, 5)
    ]);
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 1100);
  }

  const myGoals = goals.filter(g => g.mine > 0).length;
  const myTotal = goals.reduce((sum, g) => sum + g.mine, 0);

  return (
    <div className="mgf-shell">
      {celebrate && <Celebration />}

      <div className="mgf-top">
        <div className="mgf-brand">
          <div className="mgf-mark">{Icons.slate}</div>
          <div className="mgf-brand-text">
            <span className="mgf-brand-name">Director</span>
            <span className="mgf-brand-sub">Booth · Анна</span>
          </div>
        </div>
        <div className="mgf-live">Live · 2.4K</div>
      </div>

      {/* Кресло режиссёра */}
      <div className="chair-card">
        <div className="chair-card-top">
          <div className="chair-icon">{Icons.chair}</div>
          <div className="chair-tt">
            <span className="chair-tt-tag">Director's Chair</span>
            <span className="chair-tt-state is-empty">Свободно</span>
          </div>
        </div>
        <div className="chair-card-state">
          Сядь за пульт — действия пойдут от твоего ника, поверх всех. Кресло держится <strong>2 минуты</strong>.
        </div>
        <button className="chair-cta">
          {Icons.chair} Занять за 50 tk
        </button>
        <div className="chair-cta-sub">
          у вас <strong style={{ color: "var(--d-amber-hot)" }}>545 tk</strong> · перебить кресло вдвое дороже
        </div>
      </div>

      {/* Цели */}
      <div className="mgf-sect">
        <div className="mgf-sect-head">
          <div className="mgf-sect-name">Гоалы</div>
          <div className="mgf-sect-aside">{myGoals} ваших · {myTotal} tk</div>
        </div>

        <div className="goals">
          {goals.map(g => {
            const pickedAmt = tipPick[g.id] ?? PRESETS[1];
            const allPct = (g.current / g.target) * 100;
            const minePct = (g.mine / g.target) * 100;
            return (
              <div key={g.id} className={"goal" + (g.state === "mine" ? " is-mine" : g.state === "soon" ? " is-soon" : "")}>
                <div className="goal-top">
                  <div className="goal-name">
                    <div className="goal-name-row">
                      <span className="goal-icon">{Icons[g.icon]}</span>
                      {g.name}
                    </div>
                    {g.flag && (
                      <span className={"goal-flag" +
                        (g.state === "mine" ? " is-mine" : g.state === "soon" ? " is-soon" : "")}>
                        {g.flag}
                      </span>
                    )}
                  </div>
                  <div className="goal-amount">
                    {g.current}<span className="goal-amount-of">/ {g.target}</span>
                  </div>
                </div>

                <div className="goal-bar">
                  <span className="all" style={{ width: allPct + "%" }} />
                  <span className="mine" style={{ width: minePct + "%" }} />
                </div>

                {g.mine > 0 && (
                  <div className="goal-mine-line">
                    {Icons.crown} ваш вклад <strong>{g.mine} tk</strong> · {Math.round(g.mine / g.target * 100)}% от цели
                  </div>
                )}

                <div className="tip-row">
                  <div className="tip-presets-strip">
                    {PRESETS.map(amt => (
                      <button
                        key={amt}
                        className={"tip-preset" + (pickedAmt === amt ? " is-hot" : "")}
                        onClick={() => setTipPick({ ...tipPick, [g.id]: amt })}
                      >
                        {amt}
                      </button>
                    ))}
                  </div>
                  <button className="tip-go" onClick={() => tip(g, pickedAmt)} title="Поставить">
                    {Icons.plus}
                  </button>
                </div>

                <div className="goal-meta">
                  <span>скидывались <strong>{g.backers}</strong></span>
                  <span>осталось <strong>{g.target - g.current} tk</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Лидерборд директоров */}
      <div className="mgf-sect">
        <div className="mgf-sect-head">
          <div className="mgf-sect-name">Топ директоров</div>
          <div className="mgf-sect-aside">за стрим</div>
        </div>
        <div className="lb">
          {lb.map(p => (
            <div key={p.rank} className={"lb-row" + (p.me ? " is-mine" : "")}>
              <span className="lb-rank">{p.rank}</span>
              <span className="lb-icon">{Icons[p.icon]}</span>
              <span className="lb-name">{p.name}</span>
              <Sparkline pts={p.spark} />
              <span className="lb-tk">{p.tk}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Стейдж-фид */}
      <div className="mgf-sect">
        <div className="mgf-sect-head">
          <div className="mgf-sect-name">На сцене</div>
          <div className="mgf-sect-aside">live · очередь</div>
        </div>
        <div className="feed">
          {feed.slice(0, 6).map(f => (
            <div key={f.id} className={"feed-item" + (f.kind === "now" ? " is-now" : "")}>
              <span className="feed-icon">{Icons[f.icon]}</span>
              <div className="feed-text">
                <span className="feed-line">
                  {f.kind === "now" ? <strong>{f.text}</strong> : f.text}
                </span>
                <span className="feed-by">{f.by}</span>
              </div>
              <span className="feed-time">{f.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.MainGameFun = MainGameFun;
