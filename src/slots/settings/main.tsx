import { render } from 'preact';

import { App } from './app';

/**
 * The Stripchat dashboard settings modal does not shrink for narrow devices —
 * it keeps a tablet-sized width even on phones. That makes `@container` and
 * `@media` queries inside this iframe useless for adapting to the actual
 * device, because they only see the (fixed) iframe width.
 *
 * We treat the slot as "narrow" when either:
 *   - the physical device screen is small (`window.screen.width <= 640`),
 *     which catches the case where the host modal stays tablet-sized on a
 *     phone, or
 *   - the iframe itself is below the same threshold (`window.innerWidth`),
 *     which catches genuinely small host containers.
 *
 * A single `html[data-narrow='1']` flag drives all narrow CSS, so we don't
 * need a separate `@container` rule path.
 */
const NARROW_BREAKPOINT_PX = 640;

const applyNarrowFlag = () => {
  const screenW =
    typeof window !== 'undefined' && window.screen && window.screen.width > 0
      ? window.screen.width
      : Infinity;
  const iframeW =
    typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : Infinity;
  const isNarrow = Math.min(screenW, iframeW) <= NARROW_BREAKPOINT_PX;
  document.documentElement.dataset.narrow = isNarrow ? '1' : '0';
};

applyNarrowFlag();
window.addEventListener('resize', applyNarrowFlag);
window.addEventListener('orientationchange', applyNarrowFlag);

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
