# 🎙️ AudioVault

> **Hardware Ingestion, Local-First AI Classifier, and Non-Destructive Audio Vault for Field Recorders & Creators**

[![Tests](https://img.shields.io/badge/tests-23%20passed-success)](https://github.com/cbellingan/AudioVault)
[![E2E](https://img.shields.io/badge/e2e-7%2F7%20playwright-success)](https://github.com/cbellingan/AudioVault)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)](https://github.com/cbellingan/AudioVault)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

AudioVault is an Electron + React + TypeScript desktop application engineered for musicians, sound designers, podcasters, and field recordists using hardware recorders (Zoom H1essential/H4n/H6, Tascam, Sound Devices, Sony PCM). It automates the raw media lifecycle: lightning-fast hardware ingestion, on-device AI transcription and classification, rich waveform editing, and studio metadata export—completely offline and private.

---

## ⚡ Highlights & Key Features

### 1. 🚀 Non-Blocking Hardware Ingestion Pipeline
- **Strictly Serial SD Card Copy (`concurrency: 1`)**: Protects FAT32/exFAT flash memory from concurrent I/O head contention, maximizing sustained bus transfer speeds.
- **Automated Safe Ejection**: Automatically calls `diskutil unmount` as soon as flash reads complete, allowing you to safely pull the SD card and continue recording while local SSD analysis runs in the background.
- **Parallel Local SSD Worker Pool (`concurrency: 3`)**: Executes acoustic feature extraction, waveform peak generation, and speech detection concurrently on local storage.
- **Throttled Telemetry Stream**: Real-time progress updates (~12 updates/sec) keep the 60fps UI buttery smooth without saturating the Electron IPC bridge.

### 2. 🧠 On-Device AI: Offline Whisper & Local LLM Titling
- **Local Speech-to-Text**: Quantized `whisper-tiny.en` running fully on-device via ONNX (`@xenova/transformers`). Transcribes speech without sending any audio to the cloud.
- **Dialogue Waveform Overlays**: Spoken sections are marked directly on the interactive waveform scrubber with cyan dialogue pill ribbons. Supports on-demand region transcription even on takes classified as music.
- **Synchronized Scrolling Transcript Ribbon**: Mounted below the waveform, maps detected words with timestamps, auto-scrolls to keep current words in view, and enables instant click-to-seek on any word.
- **Local LLM Title Generation**: Quantized `Xenova/LaMini-Flan-T5-77M` runs locally to synthesize concise 2–4 word descriptive titles from spoken content while preserving the original hardware filename prefix (`260831-185613 - Pushing Feel & Rhythm`).

### 3. 🌊 High-DPI Waveform Scrubber & Signal Profile Experiments
- **Retina High-DPI Micro-Bars**: Crisp 2.6px step micro-bars with an asymmetric mirrored DAW amplitude envelope (62% upper amplitude, 38% reflection).
- **Multi-Sub-Slice Peak Extraction for Long Takes**: Analyzes distributed sub-slices across audio blocks in under 15ms, ensuring 20+ minute takes never suffer from decimation dropouts.
- **Interactive Signal Profile Experiments**: Toggle between 4 tuned visualization profiles in real-time via the dock header:
  - **`✨ Dynamic (Recommended)`**: Headroom normalization + `gamma: 0.65` perceptual curve. Lifts quiet speech to 25–45px while keeping peaks unclipped.
  - **`🌿 Balanced`**: Moderate headroom floor + `gamma: 0.76`. Classical natural DAW acoustic depth.
  - **`🔥 Punchy`**: Studio broadcast companding + `gamma: 0.52`. Bolder body for quiet voice memos and low microphone levels.
  - **`📏 Linear`**: Raw unscaled linear PCM amplitude baseline.

### 4. 🎵 High-Fidelity MP3 Export with ID3 Metadata & Finder Reveal
- **Broadcast-Grade MP3 Transcoding**: Encodes via local system `ffmpeg` (`libmp3lame` at 320 kbps) with arbitrary region timestamp slicing (`-ss`, `-t`).
- **macOS Finder Reveal**: Provides "Open in Finder" buttons in the waveform dock toolbar and right-click context menus to instantly reveal any audio take or exported MP3 in Finder via Electron's native `shell.showItemInFolder`.
- **Library MP3 Badge**: Interactive cyan `MP3` pill badge in library table rows.

### 5. 🎙️ In-App Recording & Studio Level Meter (`Option 1.2`)
- **Direct Microphone Capture**: Record directly in the app using Web Audio (`navigator.mediaDevices.getUserMedia`) encoded to uncompressed 16-bit 48kHz WAV without third-party native addons.
- **Collapsible Recording Strip (`recbar`)**: Features an elapsed `MM:SS` timer, live animated level meter reacting to mic input, format metadata (`48 kHz / 16-bit PCM · saving to Memos`), `Auto-transcribe on stop` toggle, Pause/Resume, and Stop.
- **Immediate Pipeline Ingestion**: On stop, takes are automatically persisted to `~/Music/AudioVault/raw/`, cryptographically registered, and queued into the background Whisper transcription & acoustic classification engine.

### 6. 🔍 Global Instant Search & Keyboard Command (`⌘K`)
- **Unified Querying**: Filter across clip titles, transcription text, timestamped chunks, user tags, and original hardware filenames with debounced instant filtering.
- **Keyboard Shortcut**: Press `⌘K` (or `Ctrl+K`) anywhere in the application to instantly focus the global search bar.

### 7. 📁 Sources Sidebar Navigation
- **Unified Input Triage**: Sources section in the sidebar categorizes input origin:
  - `🎙️ In-App Recorder`: Displays active `REC` pulsing badge during live recording and filters down to voice takes.
  - `💾 <SD Cards>`: Detects attached removable hardware storage cards and displays count of new takes ready to ingest.
  - `📁 Import Folder`: Prompts a native directory picker to ingest local sound libraries.

### 8. 🛡️ Non-Destructive Virtual Clips
- Raw audio files in `~/Music/AudioVault/raw/` are **never modified or overwritten**.
- All virtual clips, split regions, metadata edits, custom sub-tags, and category assignments are tracked non-destructively in `~/Music/AudioVault/registry.json`.

---

## 🛠️ Tech Stack & Architecture

- **Runtime**: [Electron](https://www.electronjs.org/) (Context Isolation & Sandboxed IPC)
- **Frontend**: [React 18](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **Styling**: Pure CSS with Custom Properties, dark studio aesthetic, CSS Grid & Flexbox
- **Audio Processing**: Custom RIFF/BWF PCM & 32-bit float header parser, system `ffmpeg` (`libmp3lame`)
- **On-Device AI / ML**: [@xenova/transformers](https://github.com/xenova/transformers.js) (ONNX Runtime Web/Node)
  - `Xenova/whisper-tiny.en`
  - `Xenova/LaMini-Flan-T5-77M`
- **Testing**: [Vitest](https://vitest.dev/) (Unit & logic tests), [Playwright](https://playwright.dev/) (Electron E2E automation)

```
AudioVault/
├── src/
│   ├── main/                       # Electron Main Process
│   │   ├── index.ts                # App lifecycle, IPC handlers, streaming protocol
│   │   ├── audio-engine.ts         # PCM/BWF parser, acoustic features, peak extraction
│   │   ├── pipeline-orchestrator.ts# Serial SD reader queue & parallel worker pool
│   │   ├── dedup-engine.ts         # Cryptographic fingerprinting & registry persistence
│   │   ├── volume-watcher.ts       # SD card & external drive mount detector
│   │   ├── transcription-service.ts# Local on-device Whisper inference
│   │   └── title-service.ts        # Local on-device LLM title synthesizer
│   ├── preload/                    # Secure contextBridge API
│   │   └── index.ts
│   ├── renderer/                   # React Frontend
│   │   ├── App.tsx                 # Studio UI, waveform canvas, dock, library table
│   │   ├── index.css               # Studio dark theme & component styles
│   │   └── main.tsx
│   └── shared/                     # Shared TypeScript contracts & schemas
│       └── types.ts
├── e2e/                            # Playwright Electron Integration Tests
│   └── app.spec.ts
└── docs/                           # Specifications & architectural blueprints
    ├── ARCHITECTURE.md
    └── spec.md
```

---

## 🚦 Getting Started

### Prerequisites
- **Node.js**: v18+ (v20+ recommended)
- **ffmpeg**: Installed and accessible on PATH or `/opt/homebrew/bin/ffmpeg` (e.g. `brew install ffmpeg` on macOS)

### Installation

```bash
# 1. Clone the repository
git clone git@github.com:cbellingan/AudioVault.git
cd AudioVault

# 2. Install dependencies
npm install

# 3. Launch in development mode
npm run dev
```

### Production Build

```bash
npm run build
```
This bundles the Vite renderer into `dist/` and compiles the Electron main and preload processes into `dist-electron/`.

---

## 🧪 Verification & Testing

AudioVault maintains rigorous test coverage spanning unit tests, audio parsing logic, AI title generation, and full end-to-end Electron automation:

```bash
# Typecheck
npm run typecheck

# Run Vitest unit & integration suites (22 tests)
npm test

# Run full Playwright Electron E2E integration test suite (6 tests)
npm run test:e2e
```

---

## 🎹 Keyboard Shortcuts & Interactions

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Play / Pause** | `Spacebar` or click `▶` / `⏸` in transport dock |
| **Step Backward / Forward** | `←` / `→` arrow keys (3-second jump) |
| **Seek to Word** | Click any word pill in the scrolling transcript ribbon |
| **Seek Waveform** | Click anywhere on the waveform canvas |
| **Select Region** | Click and drag across the waveform canvas |
| **Search Library** | `⌘K` or `Ctrl+K` (focuses global search bar) |
| **Clip Options Menu** | Right-click any row in the library table |
| **Waveform Options Menu** | Right-click anywhere on the waveform canvas |
| **Open in Finder** | Click `📂 Open in Finder` in the dock toolbar/context menu, or click the cyan `MP3` badge |

---

## 📄 License

MIT License © 2026 Carl Bellingan
