# 🔊 SoundSafe — Intelligent Audio & Screen Health Monitor for macOS

A smart desktop app that protects your hearing and eyes while you work.

---

## ✨ Features

- **Live Volume Monitoring** — Real-time tracking with animated ring meter
- **Gradual Volume Reduction** — Smoothly reduces loud audio in steps (90→80→70%)
- **Audio Break System** — Auto-mutes at intervals; restores volume after break
- **Screen Break Overlay** — Full-screen 20-20-20 rule enforcement
- **Smart Recommendations** — Adaptive suggestions based on usage patterns
- **Focus / Strict / Relaxed Modes** — Three enforcement levels
- **Analytics Dashboard** — Daily/weekly usage charts and health score
- **macOS Native** — Vibrancy, menu bar tray, native notifications, `osascript` volume control

---

## 🚀 Quick Start

### Prerequisites
- macOS 12+
- Node.js 18+ — [Download](https://nodejs.org)

### Setup

```bash
# 1. download the the project or zip folder
# 2. open the terminal and type this command
cd ~/(your downloaded path) e.g this is mine "cd ~/Downloads/soundsafe"

# 3. Install dependencies
npm install

# 4. Run in development
npm start
```

### Build a distributable .dmg

```bash
npm run build
# Output: dist/SoundSafe-1.0.0.dmg
```

---

## 🔐 macOS Permissions

On first launch, macOS may ask for:

- **Notifications** — For break reminders and volume alerts  
- **Accessibility** (optional) — For deeper screen monitoring

Volume control uses `osascript` (AppleScript) which works without special permissions.

---

## 🎛 Modes

| Mode | Behavior |
|------|----------|
| **Relaxed** | Reminders only, no forced actions |
| **Strict** | Auto-mute enforced, breaks can't be skipped |
| **Focus** | Same as Strict + focus session tracking |

---

## 📁 Project Structure

```
soundsafe/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron main process
│   │   └── preload.js       # IPC bridge
│   └── renderer/
│       ├── index.html       # Main app UI
│       ├── styles.css       # Full stylesheet
│       ├── renderer.js      # UI logic & IPC
│       └── break-overlay.html  # Eye break fullscreen
├── package.json
└── README.md
```

---

## 🛠 Tech Stack

- **Electron 29** — Cross-platform desktop framework
- **Node.js** — System integration
- **osascript** — macOS volume control (no external libs needed)
- **HTML/CSS/JS** — Pure renderer, no framework
- **Syne + DM Mono** — Typography
- **Canvas API** — Charts and visualizations

---

## ⚙️ Configuration

All settings are stored at:
```
~/Library/Application Support/soundsafe/soundsafe-settings.json
```

Analytics at:
```
~/Library/Application Support/soundsafe/soundsafe-analytics.json
```

---

## 🧠 Safe Volume Guidelines

| Usage | Recommended Max |
|-------|----------------|
| Earbuds / In-ear | 60% |
| Over-ear headphones | 75% |
| Speakers | 85% |

WHO recommends limiting exposure above 85 dB to under 8 hours/day.

---

Built with ❤️ for your hearing and eye health.
