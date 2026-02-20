import { createExtHelper } from '@platform/ext-helper';
import { COMMAND_GROUPS, formatSeconds } from './shared.js';

const ext = createExtHelper();

const getEl = (id) => document.getElementById(id);

const roleLabelEl = getEl('role-label');
const phasePillEl = getEl('phase-pill');
const liveIndicatorEl = getEl('live-indicator');
const sessionTipsEl = getEl('session-tips');
const directorNameEl = getEl('director-name');
const directorPowerEl = getEl('director-power');
const challengerLineEl = getEl('challenger-line');
const pressureTrackEl = getEl('pressure-track');
const pressureFillEl = getEl('pressure-fill');
const pressureTextEl = getEl('pressure-text');
const tenureTextEl = getEl('tenure-text');

const directorConsoleEl = getEl('director-console');
const consoleGroupsEl = getEl('console-groups');
const goalsListEl = getEl('goals-list');

const tipControlsEl = getEl('tip-controls');
const selectedGoalLabelEl = getEl('selected-goal-label');
const tipAmountEl = getEl('tip-amount');
const tipButtonEl = getEl('tip-button');

const selfAllocationsEl = getEl('self-allocations');
const reallocFromEl = getEl('realloc-from');
const reallocToEl = getEl('realloc-to');
const reallocAmountEl = getEl('realloc-amount');
const reallocButtonEl = getEl('realloc-button');

const currentPerformanceEl = getEl('current-performance');
const queueListEl = getEl('queue-list');
const commandHistoryEl = getEl('command-history');
const activityFeedEl = getEl('activity-feed');

const toastStackEl = getEl('toast-stack');

let ctx = { user: null, model: null };
let currentState = null;
let selectedGoalId = '';
let selfAllocations = [];
let selfTotal = 0;
let tipInFlight = false;

const currentUserId = () => String(ctx.user?.id || '');
const currentUsername = () => String(ctx.user?.username || 'viewer');
const isModelUser = () => Boolean(ctx.user?.isModel);
const isDirectorUser = () => Boolean(currentState?.director?.id && currentState.director.id === currentUserId());

const showToast = (message) => {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = String(message || '').slice(0, 180);
  toastStackEl.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
};

const isTargetedForCurrentUser = (data) => {
  if (!data || typeof data !== 'object') return false;
  const target = String(data.targetUserId || '');
  const me = currentUserId();
  return Boolean(target && me && target === me);
};

const requestState = async () => {
  await ext.makeRequest('v1.ext.whisper', {
    data: {
      type: 'director.state.request'
    }
  });
};

const requestSelfAllocations = async () => {
  if (!currentUserId()) return;

  await ext.makeRequest('v1.ext.whisper', {
    data: {
      type: 'director.self.allocations.request',
      userId: currentUserId()
    }
  });
};

const getGoalMap = () => {
  const map = {};
  (currentState?.menuGoals || []).forEach((goal) => {
    map[goal.id] = goal;
  });
  return map;
};

const renderRoleLayout = () => {
  if (!currentState) return;

  const isModel = isModelUser();
  const isDirector = isDirectorUser();

  if (isModel) {
    roleLabelEl.textContent = 'Роль: модель';
  } else if (isDirector) {
    roleLabelEl.textContent = 'Роль: режиссёр';
  } else {
    roleLabelEl.textContent = 'Роль: зритель';
  }

  directorConsoleEl.classList.toggle('hidden', !isDirector || !currentState.isLive);
  tipControlsEl.classList.toggle('hidden', isModel);
};

const renderPressure = () => {
  const pressure = currentState?.pressure || {};
  const percent = Math.max(0, Math.min(100, Number(pressure.percent || 0)));
  pressureFillEl.style.width = `${percent}%`;

  const isCritical = Boolean(pressure.isCritical && currentState?.challenger?.id);
  pressureTrackEl.classList.toggle('is-critical', isCritical);

  if (!currentState?.director?.id || !currentState?.challenger?.id) {
    pressureTextEl.textContent = 'Ожидаем претендента';
    return;
  }

  if (isCritical) {
    pressureTextEl.textContent = `Критично: разрыв < ${currentState.overtakeMargin} тк`;
    return;
  }

  pressureTextEl.textContent = `До перехвата нужно: ${pressure.neededToOvertake} тк`;
};

const renderConsole = () => {
  const state = currentState;
  if (!state) return;

  const isDirector = isDirectorUser();
  const cooldowns = state.commandCooldowns || {};

  consoleGroupsEl.innerHTML = '';

  COMMAND_GROUPS.forEach((group) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'group';

    const titleEl = document.createElement('div');
    titleEl.className = 'group-title';
    titleEl.textContent = group.title;

    const buttonsEl = document.createElement('div');
    buttonsEl.className = 'buttons';

    group.commands.forEach((command) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cmd-btn';

      const cooldownMs = Math.max(0, Number(cooldowns[command.id] || 0));
      const cooldownSec = Math.ceil(cooldownMs / 1000);

      button.textContent = cooldownSec > 0 ? `${command.label} (${cooldownSec}с)` : command.label;
      button.disabled = !isDirector || !state.isLive || cooldownSec > 0;

      button.addEventListener('click', async () => {
        if (!isDirectorUser()) {
          showToast('Пульт доступен только текущему Режиссёру');
          return;
        }

        button.classList.add('is-pressed');
        setTimeout(() => button.classList.remove('is-pressed'), 220);

        await ext.makeRequest('v1.ext.whisper', {
          data: {
            type: 'director.command.issue',
            userId: currentUserId(),
            username: currentUsername(),
            commandId: command.id
          }
        });
      });

      buttonsEl.appendChild(button);
    });

    groupEl.appendChild(titleEl);
    groupEl.appendChild(buttonsEl);
    consoleGroupsEl.appendChild(groupEl);
  });
};

const renderGoalSelection = () => {
  const goals = currentState?.menuGoals || [];
  if (!goals.length) {
    selectedGoalId = '';
    selectedGoalLabelEl.textContent = 'Позиции tip menu пока не доступны.';
    return;
  }

  const selected = goals.find((goal) => goal.id === selectedGoalId) || goals[0];
  selectedGoalId = selected.id;
  selectedGoalLabelEl.textContent = `Выбрано: «${selected.title}»`;
};

const renderGoals = () => {
  const goals = currentState?.menuGoals || [];
  goalsListEl.innerHTML = '';

  if (!goals.length) {
    const fallback = document.createElement('div');
    fallback.className = 'small';
    fallback.textContent = 'Tip menu пуст. Проверьте настройки модели.';
    goalsListEl.appendChild(fallback);
    return;
  }

  if (!goals.some((goal) => goal.id === selectedGoalId)) {
    selectedGoalId = goals[0].id;
  }

  goals.forEach((goal) => {
    const card = document.createElement('div');
    card.className = `goal-card${goal.id === selectedGoalId ? ' is-selected' : ''}`;

    const name = document.createElement('div');
    name.className = 'goal-name';
    name.textContent = goal.title;

    const meta = document.createElement('div');
    meta.className = 'goal-meta';
    meta.textContent = `${goal.progress}/${goal.price} тк · осталось ${goal.tokensLeft}`;

    const progress = document.createElement('div');
    progress.className = 'goal-progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.max(0, Math.min(100, Number(goal.percent || 0)))}%`;
    progress.appendChild(fill);

    card.appendChild(name);
    card.appendChild(meta);
    card.appendChild(progress);

    card.addEventListener('click', () => {
      selectedGoalId = goal.id;
      renderGoals();
      renderGoalSelection();
      renderReallocationControls();
    });

    goalsListEl.appendChild(card);
  });
};

const renderSelfAllocations = () => {
  const allocationByItem = Object.fromEntries(selfAllocations.map((entry) => [entry.itemId, entry.allocated]));
  const goals = currentState?.menuGoals || [];

  selfAllocationsEl.innerHTML = '';

  const nonZero = goals
    .map((goal) => ({
      title: goal.title,
      amount: Math.max(0, Number(allocationByItem[goal.id] || 0))
    }))
    .filter((entry) => entry.amount > 0);

  if (!nonZero.length) {
    const li = document.createElement('li');
    li.textContent = 'Пока нет распределенных токенов';
    selfAllocationsEl.appendChild(li);
  } else {
    nonZero.forEach((entry) => {
      const li = document.createElement('li');
      li.textContent = `${entry.title}: ${entry.amount} тк`;
      selfAllocationsEl.appendChild(li);
    });
  }

  const summary = document.createElement('li');
  summary.textContent = `Всего внесено за сессию: ${selfTotal} тк`;
  summary.style.color = '#ffcb66';
  selfAllocationsEl.appendChild(summary);
};

const renderReallocationControls = () => {
  const goals = currentState?.menuGoals || [];
  const allocationByItem = Object.fromEntries(selfAllocations.map((entry) => [entry.itemId, entry.allocated]));

  const fromOptions = goals.filter((goal) => Number(allocationByItem[goal.id] || 0) > 0);

  reallocFromEl.innerHTML = '';
  reallocToEl.innerHTML = '';

  fromOptions.forEach((goal) => {
    const option = document.createElement('option');
    option.value = goal.id;
    option.textContent = `${goal.title} (${allocationByItem[goal.id]} тк)`;
    reallocFromEl.appendChild(option);
  });

  if (!fromOptions.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Нет источника';
    reallocFromEl.appendChild(option);
  }

  const selectedFrom = reallocFromEl.value || fromOptions[0]?.id || '';

  goals
    .filter((goal) => goal.id !== selectedFrom)
    .forEach((goal) => {
      const option = document.createElement('option');
      option.value = goal.id;
      option.textContent = goal.title;
      reallocToEl.appendChild(option);
    });

  if (!reallocToEl.options.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Нет цели';
    reallocToEl.appendChild(option);
  }

  reallocButtonEl.disabled = !fromOptions.length || !reallocToEl.value || isModelUser();
};

const renderPerformance = () => {
  const current = currentState?.currentPerformance;

  if (!current) {
    currentPerformanceEl.textContent = 'Сейчас: ожидание';
  } else {
    currentPerformanceEl.textContent = `Сейчас: ${current.categoryTitle} / ${current.label} (${formatSeconds(
      current.remainingMs
    )})`;
  }

  queueListEl.innerHTML = '';
  (currentState?.queue || []).slice(0, 6).forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.categoryTitle}: ${entry.label} (${entry.issuedByName})`;
    queueListEl.appendChild(li);
  });

  if (!queueListEl.childElementCount) {
    const li = document.createElement('li');
    li.textContent = 'Очередь пуста';
    queueListEl.appendChild(li);
  }

  commandHistoryEl.innerHTML = '';
  (currentState?.commandHistory || []).slice(0, 6).forEach((entry) => {
    const li = document.createElement('li');
    li.textContent = `${entry.categoryTitle}: ${entry.label} (${entry.issuedByName})`;
    commandHistoryEl.appendChild(li);
  });

  if (!commandHistoryEl.childElementCount) {
    const li = document.createElement('li');
    li.textContent = 'Пока нет команд';
    commandHistoryEl.appendChild(li);
  }
};

const renderActivity = () => {
  activityFeedEl.innerHTML = '';

  (currentState?.activityFeed || []).slice(0, 8).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.text;
    activityFeedEl.appendChild(li);
  });

  if (!activityFeedEl.childElementCount) {
    const li = document.createElement('li');
    li.textContent = 'Активность появится после первых действий';
    activityFeedEl.appendChild(li);
  }
};

const renderStatus = () => {
  if (!currentState) return;

  phasePillEl.textContent = currentState.isLive ? 'LIVE' : 'ПРЕДПРОДАКШН';
  sessionTipsEl.textContent = `${currentState.totalSessionTips} / ${currentState.preproductionGoal} тк`;

  if (currentState.isLive) {
    liveIndicatorEl.style.opacity = '1';
    liveIndicatorEl.lastElementChild.textContent = 'LIVE';
  } else {
    liveIndicatorEl.style.opacity = '0.65';
    liveIndicatorEl.lastElementChild.textContent = 'PRE';
  }

  directorNameEl.textContent = `Режиссёр: ${currentState.director?.name || 'Casting...'}`;
  directorPowerEl.textContent = `Сила: ${currentState.director?.total || 0} тк`;
  challengerLineEl.textContent = `Претендент: ${currentState.challenger?.name || 'None'} (${currentState.challenger?.total || 0} тк)`;

  renderPressure();

  const tenureLeft = Math.max(0, Number(currentState.directorTenureLeftMs || 0));
  tenureTextEl.textContent = tenureLeft
    ? `Иммунитет режиссёра: ${formatSeconds(tenureLeft)}`
    : 'Иммунитет не активен';
};

const renderState = () => {
  if (!currentState) return;

  renderRoleLayout();
  renderStatus();
  renderConsole();
  renderGoals();
  renderGoalSelection();
  renderSelfAllocations();
  renderReallocationControls();
  renderPerformance();
  renderActivity();

  tipButtonEl.disabled = isModelUser() || !selectedGoalId || tipInFlight;
};

const sendTipToGoal = async () => {
  if (isModelUser()) {
    showToast('Модель не отправляет типы из этого блока');
    return;
  }

  if (!currentUserId()) {
    showToast('Нужно войти в аккаунт');
    return;
  }

  if (!selectedGoalId) {
    showToast('Выберите позицию меню');
    return;
  }

  const amount = Math.max(0, Math.floor(Number(tipAmountEl.value || 0)));
  if (!amount) {
    showToast('Сумма должна быть больше 0');
    return;
  }

  const goal = getGoalMap()[selectedGoalId];
  if (!goal) {
    showToast('Позиция недоступна');
    return;
  }

  tipInFlight = true;
  tipButtonEl.disabled = true;

  try {
    await ext.makeRequest('v1.payment.tokens.spend', {
      tokensAmount: amount,
      tokensSpendData: {
        action: 'director.menu.tip',
        userId: currentUserId(),
        username: currentUsername(),
        itemId: selectedGoalId
      }
    });
  } catch {
    showToast('Ошибка платежа');
  } finally {
    tipInFlight = false;
    tipButtonEl.disabled = false;
  }
};

const sendReallocation = async () => {
  if (isModelUser()) {
    showToast('Для модели перераспределение отключено');
    return;
  }

  if (!currentUserId()) {
    showToast('Нужно войти в аккаунт');
    return;
  }

  const fromItemId = String(reallocFromEl.value || '').trim();
  const toItemId = String(reallocToEl.value || '').trim();
  const amount = Math.max(0, Math.floor(Number(reallocAmountEl.value || 0)));

  if (!fromItemId || !toItemId || fromItemId === toItemId) {
    showToast('Выберите корректные from/to');
    return;
  }

  if (!amount) {
    showToast('Сумма должна быть больше 0');
    return;
  }

  await ext.makeRequest('v1.ext.whisper', {
    data: {
      type: 'director.menu.reallocate',
      userId: currentUserId(),
      username: currentUsername(),
      fromItemId,
      toItemId,
      amount
    }
  });
};

tipButtonEl.addEventListener('click', () => {
  void sendTipToGoal();
});

reallocFromEl.addEventListener('change', () => {
  renderReallocationControls();
});

reallocButtonEl.addEventListener('click', () => {
  void sendReallocation();
});

ext.subscribe('v1.ext.whispered', (data) => {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'director.state') {
    currentState = data;
    renderState();
    return;
  }

  if (isTargetedForCurrentUser(data) && data.type === 'director.self.allocations') {
    selfAllocations = Array.isArray(data.allocations) ? data.allocations : [];
    selfTotal = Math.max(0, Number(data.total || 0));
    renderSelfAllocations();
    renderReallocationControls();
    return;
  }

  if (isTargetedForCurrentUser(data) && data.type === 'director.command.result') {
    showToast(data.message || 'Команда обработана');
    return;
  }

  if (isTargetedForCurrentUser(data) && data.type === 'director.menu.reallocate.result') {
    showToast(data.message || 'Перераспределение обработано');
    return;
  }

  if (isTargetedForCurrentUser(data) && data.type === 'director.menu.tip.result') {
    showToast(data.message || 'Вклад обработан');
  }
});

ext.subscribe('v1.ext.context.updated', (payload) => {
  if (!payload || typeof payload !== 'object') return;
  ctx = payload.context || ctx;
  renderState();
});

const init = async () => {
  ctx = await ext.makeRequest('v1.ext.context.get', null);
  await requestState();
  await requestSelfAllocations();
};

void init();
