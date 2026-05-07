'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, systemPreferences, screen, shell, Notification } = require('electron');
const path = require('path');
const { exec, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow = null;
let breakOverlayWindow = null;
let tray = null;
let monitorInterval = null;
let breakTimer = null;
let screenBreakTimer = null;
let countdownInterval = null;

const state = {
  isMonitoring: false,
  currentVolume: 0,
  sessionStartTime: Date.now(),
  screenStartTime: Date.now(),
  totalListeningTime: 0,
  highVolumeExposure: 0,
  totalScreenTime: 0,
  breaksTaken: 0,
  breaksSkipped: 0,
  lastBreakTime: Date.now(),
  lastScreenBreakTime: Date.now(),
  volumeHistory: [],
  settings: loadSettings(),
  mode: 'relaxed', // relaxed | strict | focus
  focusModeActive: false,
  isMuted: false,
  previousVolume: 50,
  gradualReductionActive: false,
};

// ─── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'soundsafe-settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {}
  return {
    volumeThreshold: 75,
    audioBreakInterval: 30, // minutes
    audioBreakDuration: 5,  // minutes
    screenBreakInterval: 20, // minutes (20-20-20 rule)
    screenBreakDuration: 20, // seconds
    gradualReduction: true,
    mode: 'relaxed',
    darkTheme: true,
    notifications: true,
    startAtLogin: false,
  };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    state.settings = settings;
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// ─── Analytics Storage ────────────────────────────────────────────────────────
const ANALYTICS_PATH = path.join(app.getPath('userData'), 'soundsafe-analytics.json');

function loadAnalytics() {
  try {
    if (fs.existsSync(ANALYTICS_PATH)) {
      return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf8'));
    }
  } catch (e) {}
  return { daily: {}, weekly: {} };
}

function saveAnalyticsSnapshot() {
  try {
    const analytics = loadAnalytics();
    const today = new Date().toISOString().split('T')[0];
    analytics.daily[today] = {
      listeningTime: Math.round(state.totalListeningTime / 60),
      highVolumeExposure: Math.round(state.highVolumeExposure / 60),
      screenTime: Math.round(state.totalScreenTime / 60),
      breaksTaken: state.breaksTaken,
      breaksSkipped: state.breaksSkipped,
    };
    // Keep only last 30 days
    const keys = Object.keys(analytics.daily).sort();
    if (keys.length > 30) {
      keys.slice(0, keys.length - 30).forEach(k => delete analytics.daily[k]);
    }
    fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(analytics, null, 2));
  } catch (e) {}
}

// ─── macOS Volume Control ─────────────────────────────────────────────────────
function getSystemVolume() {
  try {
    const result = execSync(
      `osascript -e 'output volume of (get volume settings)'`,
      { timeout: 1000 }
    ).toString().trim();
    return parseInt(result) || 0;
  } catch (e) {
    return 0;
  }
}

function setSystemVolume(volume) {
  try {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    execSync(`osascript -e 'set volume output volume ${clamped}'`, { timeout: 1000 });
    return clamped;
  } catch (e) {
    return volume;
  }
}

function muteSystem() {
  try {
    state.previousVolume = getSystemVolume();
    execSync(`osascript -e 'set volume output muted true'`, { timeout: 1000 });
    state.isMuted = true;
  } catch (e) {}
}

function unmuteSystem() {
  try {
    execSync(`osascript -e 'set volume output muted false'`, { timeout: 1000 });
    if (state.previousVolume > 0) {
      setSystemVolume(state.previousVolume);
    }
    state.isMuted = false;
  } catch (e) {}
}

function isMuted() {
  try {
    const result = execSync(
      `osascript -e 'output muted of (get volume settings)'`,
      { timeout: 1000 }
    ).toString().trim();
    return result === 'true';
  } catch (e) {
    return false;
  }
}

// ─── Gradual Volume Reduction ─────────────────────────────────────────────────
function startGradualReduction(targetVolume) {
  if (state.gradualReductionActive) return;
  state.gradualReductionActive = true;

  const current = getSystemVolume();
  const steps = Math.ceil((current - targetVolume) / 10);
  let step = 0;

  const interval = setInterval(() => {
    if (step >= steps || !state.gradualReductionActive) {
      clearInterval(interval);
      state.gradualReductionActive = false;
      return;
    }
    const newVol = Math.max(targetVolume, current - (step + 1) * 10);
    setSystemVolume(newVol);
    step++;

    if (mainWindow) {
      mainWindow.webContents.send('volume-reduced', newVol);
    }
  }, 1500);
}

// ─── Monitoring Engine ────────────────────────────────────────────────────────
function startMonitoring() {
  if (monitorInterval) clearInterval(monitorInterval);
  state.isMonitoring = true;
  state.sessionStartTime = Date.now();
  state.screenStartTime = Date.now();

  // Volume polling every 2 seconds
  monitorInterval = setInterval(() => {
    const vol = getSystemVolume();
    const muted = isMuted();
    state.currentVolume = vol;

    if (!muted && vol > 0) {
      state.totalListeningTime += 2;
      if (vol > state.settings.volumeThreshold) {
        state.highVolumeExposure += 2;
      }
    }
    state.totalScreenTime += 2;

    // Volume threshold alert
    if (vol > state.settings.volumeThreshold && !muted) {
      if (state.settings.gradualReduction && state.settings.mode === 'strict') {
        startGradualReduction(state.settings.volumeThreshold - 5);
      }
      if (mainWindow) {
        mainWindow.webContents.send('volume-alert', {
          volume: vol,
          threshold: state.settings.volumeThreshold,
        });
      }
      showNotification('🔊 High Volume Alert', `Volume at ${vol}% — safe threshold is ${state.settings.volumeThreshold}%`);
    }

    // Emit live stats
    if (mainWindow) {
      mainWindow.webContents.send('stats-update', getStats());
    }

    // Update tray tooltip
    if (tray) {
      tray.setToolTip(`SoundSafe — Vol: ${vol}%`);
    }

    // Save analytics every 5 minutes
    if (state.totalScreenTime % 300 === 0) {
      saveAnalyticsSnapshot();
    }
  }, 2000);

  // Audio break timer
  scheduleAudioBreak();
  scheduleScreenBreak();
}

function stopMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  if (breakTimer) clearTimeout(breakTimer);
  if (screenBreakTimer) clearTimeout(screenBreakTimer);
  state.isMonitoring = false;
  saveAnalyticsSnapshot();
}

function scheduleAudioBreak() {
  if (breakTimer) clearTimeout(breakTimer);
  const ms = state.settings.audioBreakInterval * 60 * 1000;
  breakTimer = setTimeout(() => {
    triggerAudioBreak();
  }, ms);
}

function triggerAudioBreak() {
  showNotification(
    '🎧 Audio Break Time',
    `You've been listening for ${state.settings.audioBreakInterval} minutes. Resting your ears now.`
  );

  if (state.settings.mode === 'strict' || state.settings.focusModeActive) {
    muteSystem();
    if (mainWindow) mainWindow.webContents.send('audio-break-start', state.settings.audioBreakDuration);

    setTimeout(() => {
      unmuteSystem();
      state.breaksTaken++;
      if (mainWindow) mainWindow.webContents.send('audio-break-end');
      scheduleAudioBreak();
    }, state.settings.audioBreakDuration * 60 * 1000);
  } else {
    if (mainWindow) mainWindow.webContents.send('audio-break-reminder', state.settings.audioBreakDuration);
    scheduleAudioBreak();
  }
}

function scheduleScreenBreak() {
  if (screenBreakTimer) clearTimeout(screenBreakTimer);
  const ms = state.settings.screenBreakInterval * 60 * 1000;
  screenBreakTimer = setTimeout(() => {
    triggerScreenBreak();
  }, ms);
}

function triggerScreenBreak() {
  state.lastScreenBreakTime = Date.now();
  showBreakOverlay();
}

function getStats() {
  return {
    currentVolume: state.currentVolume,
    isMonitoring: state.isMonitoring,
    isMuted: state.isMuted,
    totalListeningTime: state.totalListeningTime,
    highVolumeExposure: state.highVolumeExposure,
    totalScreenTime: state.totalScreenTime,
    breaksTaken: state.breaksTaken,
    breaksSkipped: state.breaksSkipped,
    sessionDuration: Math.floor((Date.now() - state.sessionStartTime) / 1000),
    nextAudioBreak: state.settings.audioBreakInterval,
    nextScreenBreak: state.settings.screenBreakInterval,
    mode: state.settings.mode,
    settings: state.settings,
    analytics: loadAnalytics(),
  };
}

// ─── Smart Break Recommendations ─────────────────────────────────────────────
function getSmartRecommendation() {
  const listeningMins = Math.floor(state.totalListeningTime / 60);
  const screenMins = Math.floor(state.totalScreenTime / 60);
  const highVolMins = Math.floor(state.highVolumeExposure / 60);

  const recs = [];

  if (listeningMins > 60) {
    recs.push(`You've been listening for ${listeningMins} minutes. Give your ears a proper 10-min rest.`);
  }
  if (highVolMins > 15) {
    recs.push(`${highVolMins} minutes at high volume detected. Reduce to below ${state.settings.volumeThreshold}%.`);
  }
  if (screenMins > 45) {
    recs.push(`${screenMins} minutes of screen time. Try the 20-20-20 rule: look 20ft away for 20 seconds.`);
  }
  if (state.breaksSkipped > 2) {
    recs.push(`You've skipped ${state.breaksSkipped} breaks. Enable Strict Mode for better health protection.`);
  }

  return recs.length > 0 ? recs : ['All healthy! Great digital habits today. 🌿'];
}

// ─── Notifications ────────────────────────────────────────────────────────────
function showNotification(title, body) {
  if (!state.settings.notifications) return;
  if (Notification.isSupported()) {
    new Notification({ title, body, silent: false }).show();
  }
}

// ─── Break Overlay Window ─────────────────────────────────────────────────────
function showBreakOverlay() {
  if (breakOverlayWindow) {
    breakOverlayWindow.close();
  }

  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  breakOverlayWindow = new BrowserWindow({
    width,
    height,
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    focusable: state.settings.mode !== 'strict',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  breakOverlayWindow.loadFile(path.join(__dirname, '../renderer/break-overlay.html'));

  breakOverlayWindow.webContents.on('did-finish-load', () => {
    breakOverlayWindow.webContents.send('break-start', {
      duration: state.settings.screenBreakDuration,
      mode: state.settings.mode,
    });
  });

  if (state.settings.mode === 'strict' || state.settings.focusModeActive) {
    breakOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
    breakOverlayWindow.setVisibleOnAllWorkspaces(true);
  }

  // Auto-close after break duration
  setTimeout(() => {
    if (breakOverlayWindow && !breakOverlayWindow.isDestroyed()) {
      breakOverlayWindow.close();
      breakOverlayWindow = null;
      state.breaksTaken++;
      if (mainWindow) mainWindow.webContents.send('screen-break-end');
    }
    scheduleScreenBreak();
  }, state.settings.screenBreakDuration * 1000);
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  // Create a simple 16x16 tray icon programmatically
  const trayIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('SoundSafe');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'SoundSafe', enabled: false },
    { type: 'separator' },
    {
      label: state.isMonitoring ? '⏹ Stop Monitoring' : '▶ Start Monitoring',
      click: () => {
        if (state.isMonitoring) stopMonitoring();
        else startMonitoring();
        if (mainWindow) mainWindow.webContents.send('monitoring-state', state.isMonitoring);
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    { label: '🖥 Open Dashboard', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit SoundSafe', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}

// ─── Main Window ──────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startMonitoring();
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
    showNotification('SoundSafe is still running', 'Click the menu bar icon to reopen.');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-stats', () => getStats());
ipcMain.handle('get-recommendations', () => getSmartRecommendation());
ipcMain.handle('get-analytics', () => loadAnalytics());

ipcMain.on('start-monitoring', () => {
  startMonitoring();
  updateTrayMenu();
});

ipcMain.on('stop-monitoring', () => {
  stopMonitoring();
  updateTrayMenu();
});

ipcMain.on('set-volume', (_, vol) => {
  setSystemVolume(vol);
});

ipcMain.on('mute-toggle', () => {
  if (state.isMuted) unmuteSystem();
  else muteSystem();
  mainWindow.webContents.send('mute-state', state.isMuted);
});

ipcMain.on('save-settings', (_, settings) => {
  saveSettings(settings);
  // Reschedule timers with new settings
  if (state.isMonitoring) {
    scheduleAudioBreak();
    scheduleScreenBreak();
  }
  mainWindow.webContents.send('settings-saved', state.settings);
});

ipcMain.on('set-mode', (_, mode) => {
  state.settings.mode = mode;
  state.focusModeActive = mode === 'focus';
  saveSettings(state.settings);
  mainWindow.webContents.send('mode-changed', mode);
});

ipcMain.on('trigger-screen-break', () => {
  triggerScreenBreak();
});

ipcMain.on('skip-break', () => {
  if (state.settings.mode !== 'strict' && !state.focusModeActive) {
    state.breaksSkipped++;
    if (breakOverlayWindow && !breakOverlayWindow.isDestroyed()) {
      breakOverlayWindow.close();
      breakOverlayWindow = null;
    }
    scheduleScreenBreak();
  }
});

ipcMain.on('close-overlay', () => {
  if (breakOverlayWindow && !breakOverlayWindow.isDestroyed()) {
    breakOverlayWindow.close();
    breakOverlayWindow = null;
  }
  state.breaksTaken++;
  scheduleScreenBreak();
});

ipcMain.on('reset-analytics', () => {
  state.totalListeningTime = 0;
  state.highVolumeExposure = 0;
  state.totalScreenTime = 0;
  state.breaksTaken = 0;
  state.breaksSkipped = 0;
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Request macOS accessibility permissions for volume control
  if (process.platform === 'darwin') {
    app.dock.setIcon(nativeImage.createEmpty());
  }

  createMainWindow();
  createTray();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // Keep app alive in tray
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  stopMonitoring();
  mainWindow?.removeAllListeners('close');
});
