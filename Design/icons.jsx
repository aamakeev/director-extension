// Director icon set. Custom-drawn SVGs, designed for 18-22px buttons.
// Each icon respects three render modes set on document root via
// data-icon-style="line|filled|mono" — see tokens.css.

const Icon = ({ d, fillD, viewBox = "0 0 24 24", style = {} }) => {
  // For "filled" mode, prefer fillD if provided (chunkier silhouette).
  const mode = (typeof document !== "undefined"
    && document.documentElement.getAttribute("data-icon-style")) || "line";
  const useD = mode === "line" ? d : (fillD || d);
  return (
    <svg className="d-icon" viewBox={viewBox} style={style} aria-hidden="true">
      <path d={useD} />
    </svg>
  );
};

// Key icons: bold, easy at 18-22px.
const Icons = {
  // Lock (closed padlock)
  lock: (
    <Icon
      d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z"
      fillD="M7 11V8a5 5 0 0 1 10 0v3h2v9H5v-9zM9 8a3 3 0 0 1 6 0v3H9z"
    />
  ),
  // Unlock
  unlock: (
    <Icon
      d="M7 11V8a5 5 0 0 1 9.9-1M5 11h14v9H5z"
      fillD="M5 11h14v9H5zM7 11V8a5 5 0 0 1 9.9-1l-1.9.5A3 3 0 0 0 9 8v3z"
    />
  ),
  // Spotlight beam (theatrical light)
  spotlight: (
    <Icon
      d="M12 3l-5 9h10zM12 14v6M9 20h6"
      fillD="M12 3l-5 9h10zM11 14h2v6h-2zM9 20h6v1H9z"
    />
  ),
  // Mic on
  mic: (
    <Icon
      d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3M9 20h6"
      fillD="M9 7a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM6 11h1.5a4.5 4.5 0 0 0 9 0H18a6 6 0 0 1-5 5.9V20h2v1H9v-1h2v-3.1A6 6 0 0 1 6 11z"
    />
  ),
  // Mic off
  micOff: (
    <Icon
      d="M3 3l18 18M9 9v3a3 3 0 0 0 5.5 1.7M15 11V7a3 3 0 0 0-6 0v.5M6 11a6 6 0 0 0 9.5 4.9M12 17v3M9 20h6"
    />
  ),
  // Camera flip
  camera: (
    <Icon
      d="M4 7h3l2-2h6l2 2h3v12H4zM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      fillD="M9 5l-2 2H4v12h16V7h-3l-2-2zM12 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"
    />
  ),
  // Wardrobe / shirt
  outfit: (
    <Icon
      d="M9 3l3 3 3-3 5 3-2 4-3-1v11H6V9L3 10 1 6z"
      fillD="M9 3l3 3 3-3 5 3-2 4-3-1v11H6V9L3 10 1 6z"
    />
  ),
  // Pose / dance figure
  pose: (
    <Icon
      d="M12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9l-3 5M14 9l4 3M10 9l1 5-2 6M14 9l1 5 2 6"
      fillD="M12 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 9h4l1 5-1 6h-4l1-6 1-5z"
    />
  ),
  // Wink heart
  wink: (
    <Icon
      d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"
      fillD="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"
    />
  ),
  // Sparkle / surprise
  spark: (
    <Icon
      d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"
      fillD="M12 2l1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8z"
    />
  ),
  // Confetti / celebrate
  confetti: (
    <Icon
      d="M3 21l4-12 8 8zM14 3l1 3M19 5l-2 2M21 9l-3 1M16 11l3 3"
      fillD="M3 21l4-12 8 8zM14 3l1 3M19 5l-2 2M21 9l-3 1M16 11l3 3"
    />
  ),
  // Music
  music: (
    <Icon
      d="M9 18V6l11-2v12M9 14a3 3 0 1 1-3-3M20 14a3 3 0 1 1-3-3"
      fillD="M9 18V6l11-2v12M6 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM17 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"
    />
  ),
  // Dice
  dice: (
    <Icon
      d="M5 5h14v14H5zM9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"
      fillD="M5 5h14v14H5zM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM17 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM9 17a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM17 17a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM13 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"
    />
  ),
  // Flame / heat
  flame: (
    <Icon
      d="M12 3s5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7s3 1 3-3z"
      fillD="M12 3s5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7s3 1 3-3z"
    />
  ),
  // Heart pulse
  heartbeat: (
    <Icon
      d="M3 12h4l2-4 4 8 2-5h6"
    />
  ),
  // Banana (mascot for guests — режиссёр banana)
  banana: (
    <Icon
      d="M5 14c0 4 4 6 8 6s7-3 7-7c0-2-1-3-2-3-2 3-7 4-10 1-2-1-3 1-3 3z"
      fillD="M5 14c0 4 4 6 8 6s7-3 7-7c0-2-1-3-2-3-2 3-7 4-10 1-2-1-3 1-3 3z"
    />
  ),
  // Crown (top tipper)
  crown: (
    <Icon
      d="M3 18h18M3 18l2-9 4 4 3-7 3 7 4-4 2 9"
      fillD="M3 18h18l-1-9-4 4-3-7-3 7-4-4z"
    />
  ),
  // Trophy
  trophy: (
    <Icon
      d="M8 4h8v6a4 4 0 0 1-8 0zM5 5h3M16 5h3M9 16h6M9 20h6M12 14v6"
      fillD="M8 4h8v6a4 4 0 0 1-8 0zM5 5h3M16 5h3M9 16h6v4H9zM11 14h2v2h-2z"
    />
  ),
  // Wave (interaction)
  wave: (
    <Icon
      d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"
    />
  ),
  // Director's slate / clapperboard
  slate: (
    <Icon
      d="M3 8h18l-3-4H6zM4 8v12h16V8M3 8l3 4M9 8l3 4M15 8l3 4"
      fillD="M3 8h18l-3-4H6zM4 8v12h16V8zM3 8l3 4 1-1-3-3zM9 8l3 4 1-1-3-3zM15 8l3 4 1-1-3-3z"
    />
  ),
  // Eye (viewer count)
  eye: (
    <Icon
      d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
      fillD="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"
    />
  ),
  // Plus
  plus: (
    <Icon d="M12 5v14M5 12h14" />
  ),
  // Chevron right
  chev: (
    <Icon d="M9 5l7 7-7 7" />
  ),
  // Settings gear
  gear: (
    <Icon
      d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19 12l2 2-1 3-3-1-2 2-3-1-1-3-3 1-1-3 2-2-2-2 1-3 3 1 2-2 3 1 1 3 3-1 1 3z"
    />
  ),
  // Stage / curtain
  curtain: (
    <Icon
      d="M3 3v18h18V3M3 5c4 1 4 14 4 14M21 5c-4 1-4 14-4 14M11 3v18M13 3v18"
    />
  ),
  // Lightning (boost)
  bolt: (
    <Icon
      d="M13 3L4 14h6l-1 7 9-11h-6z"
      fillD="M13 3L4 14h6l-1 7 9-11h-6z"
    />
  ),
  // Coin
  coin: (
    <Icon
      d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 8h3a2 2 0 1 1 0 4h-3v4M10 12h4"
      fillD="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM10 8h3a2 2 0 1 1 0 4h-3v4h-1V8zm1 1v2h2a1 1 0 1 0 0-2z"
    />
  ),
  // Shield
  shield: (
    <Icon
      d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"
      fillD="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"
    />
  ),
  // Hourglass
  hourglass: (
    <Icon d="M6 3h12M6 21h12M7 3v3l5 5-5 5v3M17 3v3l-5 5 5 5v3" />
  ),
  // Headphones
  headset: (
    <Icon d="M4 13a8 8 0 0 1 16 0v4M4 13v4a2 2 0 0 0 2 2h2v-6H6a2 2 0 0 0-2 2zM20 13v4a2 2 0 0 1-2 2h-2v-6h2a2 2 0 0 1 2 2z" />
  ),
  // Director chair (mascot)
  chair: (
    <Icon
      d="M5 4h14M7 4l2 8M17 4l-2 8M9 12h6M5 21l4-9M19 21l-4-9M9 16h6"
      fillD="M5 4h14v2H5zM7 6l2 8h6l2-8h-2l-2 6h-2L9 6z M5 21l4-7h2l-3 7zM19 21l-4-7h-2l3 7z"
    />
  ),
};

window.Icons = Icons;
