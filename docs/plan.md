# Plan: Audio Ingestion, Non-Destructive Annotation & Local-First Classifier

**Artifact**: `docs/plan.md` (Stage 3: Build)  
**Derived From**: [`docs/spec.md`](file:///Users/cb/Documents/antigravity/blissful-hopper/docs/spec.md) and [`intent/intent.md`](file:///Users/cb/Documents/antigravity/blissful-hopper/intent/intent.md)  
**Status**: Ready for Execution

---

## 1. Files That Change

### Core Data & Shared Types
- `src/shared/types.ts` [MODIFY]: Define `PrimaryCategory` (`music`, `concerts`, `dictaphone`, `meeting`, `ambient`), `RawAudioFile`, `VirtualClip`, `VolumeDetectedEvent`, `VaultSettings`, and `AudioVaultAPI`.

### Main Process (Electron & Audio Engine)
- `src/main/volume-watcher.ts` [NEW]: macOS `/Volumes` scanner, file discovery, and clean `diskutil unmount` execution.
- `src/main/dedup-engine.ts` [NEW]: Fingerprint computation (header hash + size + mtime) and persistent ingestion registry.
- `src/main/audio-engine.ts` [NEW]: Peak extraction, acoustic feature heuristics, local YAMNet / Silero VAD classifier, and local Whisper transcript integration.
- `src/main/index.ts` [MODIFY]: Electron window setup, protocol streaming for local audio files (`audiovault://`), and IPC handlers for all `AudioVaultAPI` calls.

### Preload Context Bridge
- `src/preload/index.ts` [MODIFY]: Secure `contextBridge.exposeInMainWorld('audioVault', api)` implementation.

### Renderer UI (React + Modern Vanilla CSS)
- `src/renderer/index.html` [MODIFY]: Title and audio-specific viewport configuration.
- `src/renderer/index.css` [MODIFY]: Audio workstation styling (dark glassmorphism, track lists, active tags, waveform scrub bar, context popovers).
- `src/renderer/App.tsx` [MODIFY]: Comprehensive UI with:
  - Hardware Ingest Banner (detected volumes, auto-unmount checkbox, one-click ingest).
  - Taxonomy Sidebar (`Music`, `Concerts`, `Dictaphone`, `Meeting`, custom tags).
  - Virtual Clip library table.
  - Interactive scrubbable Waveform Player (play/pause, loop, speed).
  - Region selection tool with right-click context menu (Classify, Add Tag, Create Virtual Clip, Exclude, Export).

### Test Fixtures & Automated Test Suites
- `src/test/audio-fixture.ts` [NEW]: In-memory programmatic RIFF WAV generator (pure sine waves for music, pulsed tone bursts for speech, silence intervals) to avoid checking binary files into git.
- `src/shared/__tests__/dedup-and-classifier.test.ts` [NEW]: Vitest unit tests verifying fingerprinting, deduplication logic, and acoustic classification rules.
- `src/main/__tests__/virtual-clip-engine.test.ts` [NEW]: Vitest tests for non-destructive region math, cue points, and tag assignments.
- `e2e/audiovault.spec.ts` [NEW]: Playwright Electron integration test verifying app startup, mock volume detection, ingest, waveform scrubbing, and region tagging.

---

## 2. Order of Work

1. **Step 1: Update Data Contracts**
   - Update `src/shared/types.ts` with domain models (`RawAudioFile`, `VirtualClip`, `PrimaryCategory`, `VolumeDetectedEvent`, `AudioVaultAPI`).
2. **Step 2: Build Audio Fixture Generator & Unit Test Suites**
   - Create `src/test/audio-fixture.ts` to programmatically generate valid WAV files in-memory.
   - Implement `src/shared/__tests__/dedup-and-classifier.test.ts` and `src/main/__tests__/virtual-clip-engine.test.ts`.
3. **Step 3: Implement Main Process Services**
   - Implement `src/main/dedup-engine.ts` for fingerprinting and database indexing.
   - Implement `src/main/volume-watcher.ts` for volume auto-detection and diskutil unmount.
   - Implement `src/main/audio-engine.ts` for waveform peak calculation, acoustic feature extraction, and local classification.
   - Wire services into `src/main/index.ts` and `src/preload/index.ts`.
4. **Step 4: Implement Renderer UI & Waveform Workstation**
   - Build responsive dual-pane layout in `src/renderer/App.tsx` and `src/renderer/index.css`.
   - Implement waveform canvas renderer with scrubbing, region dragging, and context actions.
5. **Step 5: Automated Verification & CI/CD**
   - Run `npm run typecheck`.
   - Run `npm test` (Vitest unit tests).
   - Run `npm run build` (Vite build for main, preload, renderer).
   - Run `npm run test:e2e` (Playwright Electron integration test).
   - Commit changes cleanly to git.
