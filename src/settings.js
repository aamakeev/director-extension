import { createExtHelper } from '@platform/ext-helper';
import { DEFAULT_SETTINGS, normalizeSettings } from './shared.js';

const ext = createExtHelper();

const getEl = (id) => document.getElementById(id);

const fields = {
  preproductionGoal: getEl('preproduction-goal'),
  overtakeMargin: getEl('overtake-margin'),
  minTenureSec: getEl('min-tenure-sec'),
  commandDurationSec: getEl('command-duration-sec'),
  commandCooldownSec: getEl('command-cooldown-sec'),
  tipMenuRefreshSec: getEl('tipmenu-refresh-sec'),
  fallbackTipMenu: getEl('fallback-tip-menu'),
  backendUrl: getEl('backend-url'),
  backendApiKey: getEl('backend-api-key')
};

const previewGoalEl = getEl('preview-goal');
const previewMarginEl = getEl('preview-margin');
const previewTenureEl = getEl('preview-tenure');
const previewCommandEl = getEl('preview-command');
const statusEl = getEl('status');

const readForm = () => ({
  preproductionGoal: Number(fields.preproductionGoal.value),
  overtakeMargin: Number(fields.overtakeMargin.value),
  minTenureSec: Number(fields.minTenureSec.value),
  commandDurationSec: Number(fields.commandDurationSec.value),
  commandCooldownSec: Number(fields.commandCooldownSec.value),
  tipMenuRefreshSec: Number(fields.tipMenuRefreshSec.value),
  fallbackTipMenu: String(fields.fallbackTipMenu.value || ''),
  backendUrl: String(fields.backendUrl.value || '').trim(),
  backendApiKey: String(fields.backendApiKey.value || '').trim()
});

const writeForm = (settings) => {
  fields.preproductionGoal.value = String(settings.preproductionGoal);
  fields.overtakeMargin.value = String(settings.overtakeMargin);
  fields.minTenureSec.value = String(settings.minTenureSec);
  fields.commandDurationSec.value = String(settings.commandDurationSec);
  fields.commandCooldownSec.value = String(settings.commandCooldownSec);
  fields.tipMenuRefreshSec.value = String(settings.tipMenuRefreshSec);
  fields.fallbackTipMenu.value = settings.fallbackTipMenu;
  fields.backendUrl.value = settings.backendUrl;
  fields.backendApiKey.value = settings.backendApiKey;
};

const renderPreview = () => {
  const settings = normalizeSettings(readForm());

  previewGoalEl.textContent = `Goal ${settings.preproductionGoal}`;
  previewMarginEl.textContent = `Margin ${settings.overtakeMargin}`;
  previewTenureEl.textContent = `Tenure ${settings.minTenureSec}s`;
  previewCommandEl.textContent = `Command ${settings.commandDurationSec}s / ${settings.commandCooldownSec}s cd`;
};

const loadSettings = async () => {
  try {
    const { settings: raw } = await ext.makeRequest('v1.model.ext.settings.get', null);
    const normalized = normalizeSettings(raw || DEFAULT_SETTINGS);
    writeForm(normalized);
    renderPreview();
  } catch {
    const normalized = normalizeSettings(DEFAULT_SETTINGS);
    writeForm(normalized);
    renderPreview();
  }
};

ext.subscribe('v1.model.ext.settings.set.requested', async () => {
  const normalized = normalizeSettings(readForm());

  await ext.makeRequest('v1.model.ext.settings.set', {
    settings: normalized,
    isError: false
  });

  await ext.makeRequest('v1.ext.whisper', {
    data: {
      type: 'director.settings.updated'
    }
  });

  statusEl.textContent = 'Сохранено. Background получил обновления.';
});

Object.values(fields).forEach((field) => {
  field.addEventListener('input', renderPreview);
});

void loadSettings();
