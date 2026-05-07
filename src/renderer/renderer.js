'use strict';

const { ipcRenderer } = require('electron');

// ─── State ────────────────────────────────────────────────────────────────────
let currentStats = {};
let volumeHistory = new Array(50).fill(0);
let isMonitoring = true;
let currentMode = 'relaxed';

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');

    if (tab === 'analytics') renderWeeklyChart();
    if (tab === 'audio') renderVolumeCanvas();
  });
});

// ─── Monitor Toggle ───────────────────────────────────────────────────────────
const monitorToggle = document.getElementById('monitorToggle');
monitorToggle.addEventListener('click', () => {
  isMonitoring = !isMonitoring;
  monitorToggle.classList.toggle('active', isMonitoring);
  if (isMonitoring) {
    ipcRenderer.send('start-monitoring');
  } else {
    ipcRenderer.send('stop-monitoring');
  }
});

// ─── Volume Slider ────────────────────────────────────────────────────────────
const volumeSlider = document.getElementById('volumeSlider');
let sliderDragging = false;

volumeSlider.addEventListener('mousedown', () => sliderDragging = true);
document.addEventListener('mouseup', () => sliderDragging = false);

volumeSlider.addEventListener('input', () => {
  const vol = parseInt(volumeSlider.value);
  ipcRenderer.send('set-volume', vol);
  updateVolumeRing(vol);
  updateSliderGradient(vol);
});

function updateSliderGradient(vol) {
  volumeSlider.style.setProperty('--pct', `${vol}%`);
  volumeSlider.style.background =
    `linear-gradient(to right, var(--accent) ${vol}%, rgba(255,255,255,0.1) ${vol}%)`;
}

// ─── Mute Toggle ──────────────────────────────────────────────────────────────
function toggleMute() {
  ipcRenderer.send('mute-toggle');
}

window.toggleMute = toggleMute;

ipcRenderer.on('mute-state', (_, isMuted) => {
  const btn = document.getElementById('muteBtn');
  btn.classList.toggle('muted', isMuted);
  if (isMuted) {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
    </svg>`;
  } else {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>`;
  }
});

// ─── Volume Ring ──────────────────────────────────────────────────────────────
const SVG_CIRC = 2 * Math.PI * 85; // ~534

function updateVolumeRing(vol) {
  const ring = document.getElementById('volumeRing');
  const offset = SVG_CIRC * (1 - vol / 100);
  ring.style.strokeDashoffset = offset;

  const threshold = currentStats.settings?.volumeThreshold || 75;
  if (vol > threshold) {
    ring.style.stroke = '#FF6B6B';
  } else if (vol > threshold * 0.85) {
    ring.style.stroke = '#FFB347';
  } else {
    ring.style.stroke = 'url(#ringGrad)';
  }
}

function injectSVGDefs() {
  const svg = document.querySelector('.volume-ring');
  if (!svg.querySelector('defs')) {
    svg.insertAdjacentHTML('afterbegin', `
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4FFFB0"/>
          <stop offset="100%" stop-color="#00D4FF"/>
        </linearGradient>
      </defs>
    `);
  }
}

// ─── Stats Update ─────────────────────────────────────────────────────────────
ipcRenderer.on('stats-update', (_, stats) => {
  currentStats = stats;
  applyStats(stats);
});

function applyStats(stats) {
  const vol = stats.currentVolume || 0;
  const threshold = stats.settings?.volumeThreshold || 75;

  // Volume display
  document.getElementById('volumeValue').textContent = vol;
  if (!sliderDragging) {
    volumeSlider.value = vol;
    updateSliderGradient(vol);
  }
  updateVolumeRing(vol);

  // Volume alert
  const alert = document.getElementById('volumeAlert');
  if (vol > threshold && !stats.isMuted) {
    alert.style.display = 'flex';
  } else {
    alert.style.display = 'none';
  }

  // Safe marker
  document.getElementById('safeMarker').textContent = threshold;

  // Stats cards
  const lisMins = Math.floor(stats.totalListeningTime / 60);
  const hiMins  = Math.floor(stats.highVolumeExposure / 60);
  const scrMins = Math.floor(stats.totalScreenTime / 60);

  document.getElementById('statListening').textContent = lisMins >= 60
    ? `${Math.floor(lisMins/60)}h ${lisMins%60}m` : `${lisMins}m`;
  document.getElementById('statHighVol').textContent   = `${hiMins}m`;
  document.getElementById('statScreen').textContent    = scrMins >= 60
    ? `${Math.floor(scrMins/60)}h ${scrMins%60}m` : `${scrMins}m`;
  document.getElementById('statBreaks').textContent    = stats.breaksTaken || 0;

  // Progress bars (max: 8h of screen time)
  const maxSec = 8 * 3600;
  document.getElementById('statListeningBar').style.width = `${Math.min(100, stats.totalListeningTime / maxSec * 100)}%`;
  document.getElementById('statHighVolBar').style.width   = `${Math.min(100, stats.highVolumeExposure / maxSec * 100)}%`;
  document.getElementById('statScreenBar').style.width    = `${Math.min(100, stats.totalScreenTime / maxSec * 100)}%`;
  document.getElementById('statBreaksBar').style.width    = `${Math.min(100, (stats.breaksTaken || 0) / 10 * 100)}%`;

  // Session clock
  if (stats.sessionDuration !== undefined) {
    document.getElementById('screenTimeCounter').textContent = formatDuration(stats.sessionDuration);
  }

  // Screen break fill (0-20min range)
  const breakIntervalSec = (stats.settings?.screenBreakInterval || 20) * 60;
  const sinceBreak = stats.sessionDuration % breakIntervalSec;
  const fillPct = (sinceBreak / breakIntervalSec) * 100;
  document.getElementById('screenTimeFill').style.width = `${fillPct}%`;
  const remaining = Math.ceil((breakIntervalSec - sinceBreak) / 60);
  document.getElementById('screenTimeHint').textContent = `Break due in ${remaining} minute${remaining !== 1 ? 's' : ''}`;

  // Compliance ring
  const taken = stats.breaksTaken || 0;
  const skipped = stats.breaksSkipped || 0;
  const total = taken + skipped;
  const compliancePct = total > 0 ? Math.round((taken / total) * 100) : 100;
  const complianceOffset = 251 * (1 - compliancePct / 100);
  const cr = document.getElementById('complianceRing');
  if (cr) cr.style.strokeDashoffset = complianceOffset;
  const cp = document.getElementById('compliancePct');
  if (cp) cp.textContent = `${compliancePct}%`;
  const bt = document.getElementById('breaksTakenLabel');
  const bs = document.getElementById('breaksSkippedLabel');
  if (bt) bt.textContent = `✓ ${taken} taken`;
  if (bs) bs.textContent = `✗ ${skipped} skipped`;

  // Analytics summary
  updateAnalyticsSummary(stats);

  // Health score
  const volScore = Math.max(0, 100 - (stats.highVolumeExposure / Math.max(1, stats.totalListeningTime)) * 100);
  const breakScore = compliancePct;
  const screenScore = Math.max(0, 100 - (stats.totalScreenTime / maxSec * 100));
  const healthScore = Math.round((volScore + breakScore + screenScore) / 3);
  const hs = document.getElementById('healthScore');
  if (hs) hs.textContent = healthScore;

  // Volume history for meter bars
  volumeHistory.push(vol);
  if (volumeHistory.length > 50) volumeHistory.shift();
  renderMeterBars(vol, threshold);
  renderVolumeCanvas();
}

function updateAnalyticsSummary(stats) {
  const lisMins = Math.floor(stats.totalListeningTime / 60);
  const hiMins  = Math.floor(stats.highVolumeExposure / 60);
  const scrMins = Math.floor(stats.totalScreenTime / 60);
  const el = id => document.getElementById(id);
  if (el('s-listening')) el('s-listening').textContent = `${lisMins} min`;
  if (el('s-highvol'))   el('s-highvol').textContent   = `${hiMins} min`;
  if (el('s-screen'))    el('s-screen').textContent    = `${scrMins} min`;
  if (el('s-breaks'))    el('s-breaks').textContent    = stats.breaksTaken || 0;
  if (el('s-skipped'))   el('s-skipped').textContent   = stats.breaksSkipped || 0;
}

// ─── Audio Level Meter Bars ───────────────────────────────────────────────────
function renderMeterBars(vol, threshold) {
  const container = document.getElementById('meterBars');
  if (!container) return;

  const barCount = 40;
  container.innerHTML = '';

  for (let i = 0; i < barCount; i++) {
    const pct = (i / barCount) * 100;
    const bar = document.createElement('div');
    bar.className = 'meter-bar';

    const filled = pct <= vol;
    const height = filled ? Math.max(6, Math.random() * 40 + 20) : Math.random() * 8 + 2;

    bar.style.height = `${height}px`;

    if (filled) {
      if (pct > threshold) {
        bar.style.background = '#FF6B6B';
      } else if (pct > threshold * 0.75) {
        bar.style.background = '#FFB347';
      } else {
        bar.style.background = `linear-gradient(to top, #4FFFB0, #00D4FF)`;
      }
    }

    container.appendChild(bar);
  }

  // Update status indicator
  const status = document.getElementById('meterStatus');
  if (!status) return;
  if (vol > threshold) {
    status.innerHTML = `<span class="status-dot danger"></span> Volume exceeds safe threshold (${threshold}%)`;
  } else if (vol > threshold * 0.85) {
    status.innerHTML = `<span class="status-dot warn"></span> Approaching threshold`;
  } else {
    status.innerHTML = `<span class="status-dot green"></span> Volume in safe range`;
  }
}

// ─── Volume Canvas (exposure chart) ──────────────────────────────────────────
function renderVolumeCanvas() {
  const canvas = document.getElementById('volumeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const threshold = currentStats.settings?.volumeThreshold || 75;
  const thresholdY = h - (threshold / 100 * h);

  // Threshold line
  ctx.strokeStyle = 'rgba(255,107,107,0.3)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, thresholdY);
  ctx.lineTo(w, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (volumeHistory.length < 2) return;

  const step = w / (volumeHistory.length - 1);

  // Fill area
  ctx.beginPath();
  ctx.moveTo(0, h);
  volumeHistory.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / 100 * h);
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(79,255,176,0.2)');
  grad.addColorStop(1, 'rgba(79,255,176,0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#4FFFB0';
  ctx.lineWidth = 2;
  volumeHistory.forEach((v, i) => {
    const x = i * step;
    const y = h - (v / 100 * h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ─── Weekly Chart ─────────────────────────────────────────────────────────────
function renderWeeklyChart() {
  const canvas = document.getElementById('weeklyCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ipcRenderer.invoke('get-analytics').then(analytics => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      days.push({ label: d.toLocaleDateString('en', { weekday: 'short' }), data: analytics.daily[key] || {} });
    }

    const maxVal = Math.max(120,
      ...days.map(d => Math.max(d.data.listeningTime || 0, d.data.screenTime || 0, d.data.highVolumeExposure || 0))
    );

    const barW = 16;
    const gap = (w - days.length * barW * 3 - days.length * 12) / (days.length + 1);
    const padding = { top: 20, bottom: 30 };
    const chartH = h - padding.top - padding.bottom;

    days.forEach((day, idx) => {
      const xBase = gap + idx * (barW * 3 + gap + 12);

      const bars = [
        { val: day.data.listeningTime || 0, color: '#A78BFA' },
        { val: day.data.screenTime || 0, color: '#38BDF8' },
        { val: day.data.highVolumeExposure || 0, color: '#FF6B6B' },
      ];

      bars.forEach((bar, bi) => {
        const barH = (bar.val / maxVal) * chartH;
        const x = xBase + bi * barW;
        const y = padding.top + chartH - barH;

        ctx.fillStyle = bar.color;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.roundRect(x, y, barW - 2, Math.max(2, barH), 3);
        ctx.fill();
      });

      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(day.label, xBase + barW * 1.5, h - 8);
    });
  });
}

// ─── Recommendations ──────────────────────────────────────────────────────────
async function refreshRecommendations() {
  const recs = await ipcRenderer.invoke('get-recommendations');
  const list = document.getElementById('recList');
  list.innerHTML = recs.map(r => `<div class="rec-item">${r}</div>`).join('');
}

window.refreshRecommendations = refreshRecommendations;

// ─── Mode Selection ───────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  ipcRenderer.send('set-mode', mode);

  document.querySelectorAll('.mode-badge').forEach(b => b.classList.remove('active'));
  const badge = document.getElementById(`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
  if (badge) badge.classList.add('active');

  const subtitles = {
    relaxed: 'Monitoring with gentle reminders',
    strict: 'Strict mode — auto-enforcement active',
    focus: 'Focus mode — distractions blocked',
  };
  document.getElementById('dashSubtitle').textContent = subtitles[mode] || '';
}

window.setMode = setMode;

// ─── Audio Settings ───────────────────────────────────────────────────────────
function applyAudioSettings() {
  const interval = parseInt(document.getElementById('audioBreakInterval').value);
  const duration = parseInt(document.getElementById('audioBreakDuration').value);

  const settings = { ...(currentStats.settings || {}), audioBreakInterval: interval, audioBreakDuration: duration };
  ipcRenderer.send('save-settings', settings);
  document.getElementById('nextAudioBreak').innerHTML =
    `Next break in <strong>${interval} min</strong>`;
}

window.applyAudioSettings = applyAudioSettings;

// ─── Screen Settings ──────────────────────────────────────────────────────────
function applyScreenSettings() {
  const interval = parseInt(document.getElementById('screenBreakInterval').value);
  const duration = parseInt(document.getElementById('screenBreakDuration').value);

  const settings = { ...(currentStats.settings || {}), screenBreakInterval: interval, screenBreakDuration: duration };
  ipcRenderer.send('save-settings', settings);
}

window.applyScreenSettings = applyScreenSettings;

// ─── Manual Break Trigger ─────────────────────────────────────────────────────
function triggerManualBreak() {
  ipcRenderer.send('trigger-screen-break');
}

window.triggerManualBreak = triggerManualBreak;

// ─── Settings Tab ─────────────────────────────────────────────────────────────
// Sync sliders
const volThreshSlider = document.getElementById('s-volumeThreshold');
if (volThreshSlider) {
  volThreshSlider.addEventListener('input', () => {
    document.getElementById('s-volumeThresholdVal').textContent = `${volThreshSlider.value}%`;
  });
}

function saveAllSettings() {
  const settings = {
    volumeThreshold: parseInt(document.getElementById('s-volumeThreshold').value),
    gradualReduction: document.getElementById('s-gradualReduction').checked,
    audioBreakInterval: parseInt(document.getElementById('s-audioBreakInterval').value),
    screenBreakInterval: parseInt(document.getElementById('s-screenBreakInterval').value),
    screenBreakDuration: parseInt(document.getElementById('s-screenBreakDuration').value),
    notifications: document.getElementById('s-notifications').checked,
    startAtLogin: document.getElementById('s-startAtLogin').checked,
    darkTheme: document.getElementById('s-darkTheme').checked,
    mode: currentMode,
  };

  ipcRenderer.send('save-settings', settings);

  // Visual feedback
  const btn = document.querySelector('.save-settings-btn');
  btn.textContent = 'Saved ✓';
  setTimeout(() => btn.textContent = 'Save Settings', 2000);
}

window.saveAllSettings = saveAllSettings;

function loadSettingsIntoUI(settings) {
  if (!settings) return;
  const id = s => document.getElementById(s);
  if (id('s-volumeThreshold')) {
    id('s-volumeThreshold').value = settings.volumeThreshold || 75;
    id('s-volumeThresholdVal').textContent = `${settings.volumeThreshold || 75}%`;
  }
  if (id('s-gradualReduction')) id('s-gradualReduction').checked = settings.gradualReduction !== false;
  if (id('s-audioBreakInterval')) id('s-audioBreakInterval').value = settings.audioBreakInterval || 30;
  if (id('s-screenBreakInterval')) id('s-screenBreakInterval').value = settings.screenBreakInterval || 20;
  if (id('s-screenBreakDuration')) id('s-screenBreakDuration').value = settings.screenBreakDuration || 20;
  if (id('s-notifications')) id('s-notifications').checked = settings.notifications !== false;
  if (id('s-startAtLogin')) id('s-startAtLogin').checked = !!settings.startAtLogin;
  if (id('s-darkTheme')) id('s-darkTheme').checked = settings.darkTheme !== false;

  // Also sync audio tab inputs
  if (id('audioBreakInterval')) id('audioBreakInterval').value = settings.audioBreakInterval || 30;
  if (id('audioBreakDuration')) id('audioBreakDuration').value = settings.audioBreakDuration || 5;
  if (id('screenBreakInterval')) id('screenBreakInterval').value = settings.screenBreakInterval || 20;
  if (id('screenBreakDuration')) id('screenBreakDuration').value = settings.screenBreakDuration || 20;
}

// ─── Audio Break Events ───────────────────────────────────────────────────────
ipcRenderer.on('audio-break-start', (_, durationMins) => {
  const banner = document.getElementById('breakBanner');
  const text   = document.getElementById('bannerText');
  const countdown = document.getElementById('bannerCountdown');
  banner.style.display = 'flex';
  text.textContent = `Audio break — ears resting for ${durationMins} minutes`;

  let remaining = durationMins * 60;
  const interval = setInterval(() => {
    remaining--;
    countdown.textContent = formatDuration(remaining);
    if (remaining <= 0) clearInterval(interval);
  }, 1000);
});

ipcRenderer.on('audio-break-end', () => {
  document.getElementById('breakBanner').style.display = 'none';
  document.getElementById('bannerCountdown').textContent = '';
});

ipcRenderer.on('audio-break-reminder', (_, durationMins) => {
  const banner = document.getElementById('breakBanner');
  const text   = document.getElementById('bannerText');
  banner.style.display = 'flex';
  text.textContent = `💡 Reminder: Rest your ears for ${durationMins} minutes`;
  setTimeout(() => { banner.style.display = 'none'; }, 8000);
});

ipcRenderer.on('volume-alert', (_, { volume, threshold }) => {
  document.getElementById('volumeAlert').style.display = 'flex';
});

ipcRenderer.on('volume-reduced', (_, newVol) => {
  document.getElementById('volumeValue').textContent = newVol;
  updateVolumeRing(newVol);
  volumeSlider.value = newVol;
  updateSliderGradient(newVol);
});

ipcRenderer.on('screen-break-end', () => {
  // No special UI needed — overlay closes itself
});

ipcRenderer.on('settings-saved', (_, settings) => {
  loadSettingsIntoUI(settings);
});

// ─── Analytics Reset ──────────────────────────────────────────────────────────
function resetAnalytics() {
  if (confirm('Reset today\'s analytics?')) {
    ipcRenderer.send('reset-analytics');
  }
}
window.resetAnalytics = resetAnalytics;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  injectSVGDefs();

  const stats = await ipcRenderer.invoke('get-stats');
  currentStats = stats;
  applyStats(stats);
  loadSettingsIntoUI(stats.settings);

  if (stats.settings?.mode) {
    setMode(stats.settings.mode);
  }

  await refreshRecommendations();

  // Poll recommendations every 5 minutes
  setInterval(refreshRecommendations, 5 * 60 * 1000);
}

init();
