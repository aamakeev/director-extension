import { createExtHelper } from '@platform/ext-helper';
import { formatSeconds } from './shared.js';

const ext = createExtHelper();

const getEl = (id) => document.getElementById(id);

const shellEl = getEl('shell');
const phasePillEl = getEl('phase-pill');
const liveIndicatorEl = getEl('live-indicator');
const directorLineEl = getEl('director-line');
const challengerLineEl = getEl('challenger-line');
const pressureTrackEl = getEl('pressure-track');
const pressureFillEl = getEl('pressure-fill');
const pressureTextEl = getEl('pressure-text');
const currentPerformanceEl = getEl('current-performance');
const queueListEl = getEl('queue-list');
const commandHistoryEl = getEl('command-history');
const activityFeedEl = getEl('activity-feed');
const openMenuBtn = getEl('open-menu');

let lastFlashAt = 0;

const renderList = (element, items, fallbackText, formatter) => {
  element.innerHTML = '';

  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = fallbackText;
    element.appendChild(li);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter(item);
    element.appendChild(li);
  });
};

const flashOverlay = () => {
  shellEl.classList.remove('flash');
  void shellEl.offsetWidth;
  shellEl.classList.add('flash');
  setTimeout(() => shellEl.classList.remove('flash'), 700);
};

const renderState = (state) => {
  phasePillEl.textContent = state.isLive ? 'LIVE' : 'ПРЕДПРОДАКШН';

  if (state.isLive) {
    liveIndicatorEl.style.opacity = '1';
    liveIndicatorEl.lastElementChild.textContent = 'LIVE';
  } else {
    liveIndicatorEl.style.opacity = '0.65';
    liveIndicatorEl.lastElementChild.textContent = 'PRE';
  }

  directorLineEl.textContent = `Режиссёр: ${state.director?.name || 'Casting...'} (${state.director?.total || 0} тк)`;
  challengerLineEl.textContent = `Претендент: ${state.challenger?.name || 'None'} (${state.challenger?.total || 0} тк)`;

  const pressure = state.pressure || {};
  const percent = Math.max(0, Math.min(100, Number(pressure.percent || 0)));
  pressureFillEl.style.width = `${percent}%`;

  pressureTrackEl.classList.toggle('critical', Boolean(pressure.isCritical && state.challenger?.id));

  if (!state.director?.id || !state.challenger?.id) {
    pressureTextEl.textContent = 'Ожидаем соперника';
  } else if (pressure.isCritical) {
    pressureTextEl.textContent = `Критично: разрыв < ${state.overtakeMargin} тк`;
  } else {
    pressureTextEl.textContent = `До перехвата осталось: ${pressure.neededToOvertake} тк`;
  }

  if (!state.currentPerformance) {
    currentPerformanceEl.textContent = 'Ожидание';
  } else {
    currentPerformanceEl.textContent = `${state.currentPerformance.categoryTitle} / ${state.currentPerformance.label} (${formatSeconds(
      state.currentPerformance.remainingMs
    )})`;
  }

  renderList(
    queueListEl,
    (state.queue || []).slice(0, 6),
    'Очередь пуста',
    (item) => `${item.categoryTitle}: ${item.label} (${item.issuedByName})`
  );

  renderList(
    commandHistoryEl,
    (state.commandHistory || []).slice(0, 6),
    'Команд пока нет',
    (item) => `${item.categoryTitle}: ${item.label}`
  );

  renderList(
    activityFeedEl,
    (state.activityFeed || []).slice(0, 8),
    'Активность скоро появится',
    (item) => item.text
  );

  const flashAt = Number(state.overlayFlashAt || 0);
  if (flashAt && flashAt !== lastFlashAt) {
    lastFlashAt = flashAt;
    flashOverlay();
  }
};

openMenuBtn.addEventListener('click', () => {
  void ext.makeRequest('v1.ext.menu.open', null);
});

ext.subscribe('v1.ext.whispered', (data) => {
  if (!data || typeof data !== 'object') return;
  if (data.type !== 'director.state') return;

  renderState(data);
});

const init = async () => {
  await ext.makeRequest('v1.ext.whisper', {
    data: {
      type: 'director.state.request'
    }
  });
};

void init();
