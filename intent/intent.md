# Intent: Hardware Audio Ingestion, Non-Destructive Annotation & Intelligent Classification

Author: User & Agentic Engineering Team. Status: approved.

## Problem
Makers, vocalists, musicians, journalists, and researchers capture large volumes of audio on dedicated external hardware devices (such as Zoom handheld recorders, Tascam units, Sony dictaphones, or SD cards mounted from cameras/recorders like `EOS_DIGITAL`). 

Today, this workflow is fragmented, manual, and prone to friction:
1. **Manual Ingestion Overhead**: The user must plug in the device, locate the mounted volume, manually copy cryptic files (`ZOOM0001.WAV`, `STE-002.WAV`), and manually remember to safely eject the device before pulling the cable or card.
2. **Lack of Ingestion Memory / Deduplication**: Re-inserting an SD card forces the user to manually guess which files are new and which have already been backed up.
3. **Classification Friction**: Long recording sessions contain mixed content—vocal practice clips, multi-speaker meetings, quick voice memos, and ambient sounds. Manually sorting these requires listening through hours of audio.
4. **Heavy Cloud Bottlenecks**: Piping raw, multi-gigabyte uncompressed WAV files through cloud LLMs is slow, expensive, and impossible when working offline in rehearsal spaces or in the field.
5. **Destructive vs. Tedious Editing**: Cropping files in traditional DAWs (Audacity, Logic) often produces disk clutter and alters source files. Users need lightweight, non-destructive virtual clipping and tagging where the raw files remain untouched.

## Proposed Outcome
A native desktop application (macOS Electron first, architected with modular TypeScript data layers for future iOS deployment) that provides an automated, non-destructive ingest and classification pipeline:

1. **Automated Hardware Volume Detection**:
   - Watches for external volume mounts (e.g. `/Volumes/*` on macOS).
   - Scans root directories and audio folders for `.wav` and `.mp3` files upon connection.
   - Automatically prompts the user: *"Audio recorder detected on [Device Name]. Would you like to import X new files?"*
   - Offers an option for manual import from any folder.

2. **Deduplication & Ingestion Cache**:
   - Maintains a local SQLite / JSON index of imported files keyed by cryptographic header hash, file size, modification timestamp, and source volume ID.
   - Accurately identifies only new or un-imported files, skipping redundant copies.

3. **Safe Clean Unmount**:
   - Once copying finishes, prompts the user to cleanly unmount/eject the volume, with a *"Remember my choice and unmount automatically"* preference.

4. **Hybrid Multi-Stage Classification**:
   - **Stage 1 (Local Lightweight Models & Acoustic Heuristics)**: Uses small on-device models (e.g., YAMNet via ONNX / MediaPipe and Silero VAD) combined with FFmpeg acoustic descriptors (RMS dynamic range, spectral centroid, zero-crossing rate) to categorize files into buckets ("Singing / Music", "Meeting / Multi-speaker", "Dictation / Memo", "Ambient / Sound Effect") entirely offline in seconds.
   - **Stage 2 (Cloud Model Connectors)**: Pluggable connectors (Gemini API, OpenAI, Anthropic, Ollama) for optional semantic transcription, speaker diarization, or complex summarization when online.
   - **Stage 3 (Active Learning / Human-in-the-Loop)**: When a file is ambiguous or unclassified, prompts the user with confidence-ranked suggestions; records user corrections to expand and refine classification buckets over time.

5. **Non-Destructive Metadata Vault**:
   - Source raw audio files are stored in an archive directory (defaulting to `~/Music/AudioImports` or a user-selected path) and remain 100% pristine.
   - All classifications, cue points, virtual crops, and tags are stored in non-destructive sidecar metadata.

6. **Interactive Waveform Player & Annotation UI**:
   - Visual waveform scrubbing with responsive playback controls (play, pause, seek, speed).
   - Interactive region selection / cropping on the waveform.
   - Context actions on selection: Right-click -> *"Classify as Meeting"*, *"Tag as Sound"*, *"Split Virtual Clip"*, *"Delete / Exclude Selection"*, *"Export Selection"*.

7. **CI/CD & Automated Verification**:
   - End-to-end automated testing with synthetic programmatic WAV generation (pure tones, silence, speech-like bursts) without bloating git repository with large media binaries.
   - Full GitHub Actions pipeline with type checking, unit tests, and Playwright integration tests.

## Affected Users and Systems
- **Target Users**: Vocalists/musicians organizing rehearsal takes, professionals recording meetings on dictaphones, field sound recordists.
- **Client Application**: Electron desktop app (macOS first), with decoupled core logic to support iOS.
- **Local Systems**:
  - macOS DiskArbitration / Volume mount watcher.
  - Bundled `ffmpeg-static` for transcoding, metadata extraction, and waveform peak generation.
  - Local database (SQLite / JSON) for the ingestion cache and virtual clip metadata.
  - Lightweight local ONNX / MediaPipe runtime for YAMNet audio event classification.
- **External Connectors**: Open-source AI connectors (Google Gen AI SDK, OpenAI, Anthropic, Ollama).

## Constraints
- **Zero Destruction**: Raw audio files must never be modified or overwritten in-place.
- **Offline Reliability**: Ingestion, caching, playback, waveform rendering, and Stage 1 local classification must work with zero internet connectivity.
- **Portable Architecture**: Core business logic (fetcher, ingest cache, metadata models, feature extractor) must not depend directly on Electron/Node GUI internals so they can be ported to iOS.
- **User Agency**: Device auto-unmount and storage destination paths must be explicitly configurable by the user.

## Resolved Architectural Decisions
1. **Taxonomy Structure**:
   - Primary broad categories: `Music`, `Concerts`, `Dictaphone`, `Meeting`.
   - User-extensible tagging: Users can create and assign fine-grained sub-tags (e.g. `Music > Rehearsal`, `Music > Warmup`, `Meeting > Team Standup`, `Concert > Song 1`).
2. **Raw Storage & Export**:
   - Preserved as-is in original format (WAV/MP3). If disk storage becomes an issue in the future, optional downsampling/compression can be evaluated.
3. **Local-First Transcription & Inference**:
   - Attempt local Whisper on-device in all cases: speech presence and transcript text provide high-fidelity features for classification.
   - Out-of-the-box local operation: default strictly to local models (YAMNet + local Whisper / Silero VAD).
   - Cloud connectors (Gemini / OpenAI / Anthropic) serve as optional secondary fallbacks only if local hardware is constrained or if explicitly enabled by the user.

