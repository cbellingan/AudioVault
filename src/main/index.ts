import { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import util from 'util';

const execFilePromise = util.promisify(execFile);

function getFfmpegPath(): string {
  if (fs.existsSync('/opt/homebrew/bin/ffmpeg')) {
    return '/opt/homebrew/bin/ffmpeg';
  }
  if (fs.existsSync('/usr/local/bin/ffmpeg')) {
    return '/usr/local/bin/ffmpeg';
  }
  return 'ffmpeg';
}
import { DedupEngine } from './dedup-engine';
import { VolumeWatcher } from './volume-watcher';
import { AudioEngine } from './audio-engine';
import { PipelineOrchestrator } from './pipeline-orchestrator';
import { TitleService } from './title-service';
import { setupApplicationMenu } from './menu';
import {
  IngestResult,
  PipelineStatusEvent,
  PrimaryCategory,
  RawAudioFile,
  VaultSettings,
  VirtualClip,
  VolumeDetectedEvent,
  DeletedFileRecord,
  CollectionRecord,
  ImportBatchRecord,
  SavedViewRecord,
} from '../shared/types';

// Configure isolated test sandbox if running in automated test mode
if (process.env.AUDIOVAULT_USER_DATA_DIR) {
  app.setPath('userData', process.env.AUDIOVAULT_USER_DATA_DIR);
}

// Parse CLI flags for vault directory if provided (e.g. --vault-dir=/path/to/vault)
const customVaultArg = process.argv.find((arg) => arg.startsWith('--vault-dir='));
if (customVaultArg) {
  process.env.AUDIOVAULT_VAULT_DIR = customVaultArg.replace('--vault-dir=', '');
}

let mainWindow: BrowserWindow | null = null;
const dedupEngine = new DedupEngine();
const volumeWatcher = new VolumeWatcher(dedupEngine);
const audioEngine = new AudioEngine();
const titleService = new TitleService();
const pipelineOrchestrator = new PipelineOrchestrator(dedupEngine, volumeWatcher, audioEngine, titleService);
volumeWatcher.setInProgressCheckers(
  (filePath) => pipelineOrchestrator.isFileInProgress(filePath),
  (volumePath) => pipelineOrchestrator.isVolumeInProgress(volumePath)
);

// Register custom protocol for streaming local audio to renderer
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'audiovault',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'AudioVault - Hardware Ingestion & Non-Destructive Classifier',
    backgroundColor: '#070a12',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.warn(`[Renderer Console Warning/Error] ${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[Renderer Process Gone] reason: ${details.reason}, exitCode: ${details.exitCode}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Protocol handler: audiovault://file/<fileId> or audiovault://<fileId>
  protocol.handle('audiovault', (request) => {
    try {
      const url = new URL(request.url);
      let fileId = url.pathname.replace(/^\//, '');
      if (!fileId || fileId === 'file') {
        fileId = url.pathname.replace(/^\/file\//, '') || url.hostname || url.host;
      }
      if (!fileId) {
        fileId = url.hostname || url.host;
      }
      const rawFile = dedupEngine.getRawFile(fileId);
      if (rawFile && fs.existsSync(rawFile.storagePath)) {
        return net.fetch(`file://${rawFile.storagePath}`);
      }
    } catch (e) {
      console.error('AudioVault protocol fetch error:', e);
    }
    return new Response('Not Found', { status: 404 });
  });

  setupIpcHandlers();
  createWindow();
  setupApplicationMenu(() => mainWindow);

  // Forward pipeline progress & job completion to Renderer
  pipelineOrchestrator.on('pipeline-status', (status: PipelineStatusEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault:pipeline-status', status);
    }
  });

  pipelineOrchestrator.on('job-completed', (_job, clip: VirtualClip) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vault:clip-added', clip);
    }
  });


  // Background check for mounted external media
  const volumeInterval = setInterval(async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const events = await volumeWatcher.scanConnectedVolumes();
        if (events.length > 0 && events.some((e) => e.newFilesCount > 0)) {
          for (const ev of events) {
            if (ev.newFilesCount > 0 && !pipelineOrchestrator.isVolumeInProgress(ev.volumePath)) {
              mainWindow.webContents.send('vault:volume-detected', ev);
            }
          }
        }
      } catch (err) {}
    }
  }, 10000);
  volumeInterval.unref();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function setupIpcHandlers() {
  ipcMain.handle('vault:get-settings', async (): Promise<VaultSettings> => {
    return dedupEngine.getSettings();
  });

  ipcMain.handle('vault:update-settings', async (_, settings: Partial<VaultSettings>): Promise<VaultSettings> => {
    return dedupEngine.updateSettings(settings);
  });

  ipcMain.handle('vault:select-directory', async (): Promise<string | null> => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Audio Vault Storage Directory',
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('vault:scan-volumes', async (): Promise<VolumeDetectedEvent[]> => {
    return volumeWatcher.scanConnectedVolumes();
  });

  // Non-blocking batch pipeline enqueue
  ipcMain.handle('vault:enqueue-pipeline-batch', async (_, filePaths: string[], unmountVolumePath?: string) => {
    return pipelineOrchestrator.enqueueBatch(filePaths, unmountVolumePath);
  });

  ipcMain.handle('vault:reconcile-vault', async (): Promise<number> => {
    return pipelineOrchestrator.enqueueUnprocessedRawFiles();
  });

  // Native Open Dialog to import folders, SD cards, or audio files
  ipcMain.handle('vault:select-and-import', async (): Promise<{ batchId: string; count: number } | null> => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'openFile', 'multiSelections'],
      title: 'Select Audio Files or SD Card Directory to Ingest',
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aif', 'aiff'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;

    const filePathsToIngest: string[] = [];
    for (const p of res.filePaths) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          const files = volumeWatcher.scanDirectoryForAudio(p);
          filePathsToIngest.push(...files.map((f) => f.path));
        } else if (stat.isFile()) {
          filePathsToIngest.push(p);
        }
      }
    }

    if (filePathsToIngest.length === 0) return { batchId: '', count: 0 };
    return pipelineOrchestrator.enqueueBatch(filePathsToIngest);
  });

  // Synchronous batch fallback
  ipcMain.handle('vault:import-files', async (_, filePaths: string[], unmountVolumePath?: string): Promise<IngestResult> => {
    const result: IngestResult = {
      importedCount: 0,
      skippedCount: 0,
      unmounted: false,
      clips: [],
      errors: [],
    };

    const rawDir = dedupEngine.getRawDir();
    const settings = dedupEngine.getSettings();

    for (const sourcePath of filePaths) {
      try {
        if (!fs.existsSync(sourcePath)) {
          result.errors.push(`File not found: ${sourcePath}`);
          continue;
        }

        const fingerprint = dedupEngine.computeFileFingerprint(sourcePath);
        if (dedupEngine.isFingerprintImported(fingerprint) || dedupEngine.isDeletedFile(fingerprint, sourcePath)) {
          result.skippedCount++;
          continue;
        }

        const fileName = path.basename(sourcePath);
        const targetFilename = `${Date.now()}_${fileName}`;
        const targetPath = path.join(rawDir, targetFilename);

        // Safe bit-for-bit raw copy to vault
        fs.copyFileSync(sourcePath, targetPath);
        const stats = fs.statSync(targetPath);

        // Analyze acoustics & waveform peaks
        const analysis = audioEngine.analyzeWavFile(targetPath);
        const classification = audioEngine.classifyAcoustics(analysis.features, fileName);

        const rawFileId = `raw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const rawAudioRecord: RawAudioFile = {
          id: rawFileId,
          fingerprint,
          originalFilename: fileName,
          storagePath: targetPath,
          durationSeconds: analysis.features.durationSeconds,
          sampleRate: analysis.features.sampleRate,
          channels: analysis.features.channels,
          fileSizeBytes: stats.size,
          sourceDevice: unmountVolumePath ? path.basename(unmountVolumePath) : 'Manual Import',
          importedAt: new Date().toISOString(),
          waveformPeaks: analysis.peaks,
        };

        dedupEngine.addRawFile(rawAudioRecord);

        const clipId = `clip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const defaultClip: VirtualClip = {
          id: clipId,
          parentFileId: rawFileId,
          title: fileName.replace(/\.[^/.]+$/, ''),
          startTimeSeconds: 0,
          endTimeSeconds: analysis.features.durationSeconds,
          category: classification.category,
          userTags: classification.tags,
          classificationConfidence: classification.confidence,
          classificationSource: 'yamnet_local',
          transcription: classification.transcriptionSnippet,
          isExcluded: false,
          createdAt: analysis.creationTimestamp || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        dedupEngine.addVirtualClip(defaultClip);
        pipelineOrchestrator.enqueueLocalFile(
          targetPath,
          defaultClip.title,
          unmountVolumePath ? path.basename(unmountVolumePath) : 'Manual Import',
          defaultClip.id,
          rawFileId
        );
        result.clips.push(defaultClip);
        result.importedCount++;
      } catch (err: any) {
        result.errors.push(`Failed to import ${sourcePath}: ${err.message || err}`);
      }
    }

    if (unmountVolumePath && settings.autoUnmountAfterIngest) {
      const unmountResult = await volumeWatcher.unmountVolume(unmountVolumePath);
      result.unmounted = unmountResult.success;
      if (!unmountResult.success) {
        result.errors.push(unmountResult.message);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed() && result.importedCount > 0) {
      mainWindow.webContents.send('vault:pipeline-status', {
        stage: 'idle',
        message: `Imported ${result.importedCount} takes`,
        processedFiles: result.importedCount,
        totalFiles: result.importedCount,
        progressPercent: 100,
      });
    }

    return result;
  });

  ipcMain.handle('vault:get-raw-files', async (): Promise<RawAudioFile[]> => {
    return dedupEngine.getAllRawFiles();
  });

  ipcMain.handle('vault:get-virtual-clips', async (): Promise<VirtualClip[]> => {
    return dedupEngine.getVirtualClips();
  });

  ipcMain.handle('vault:create-virtual-clip', async (_, clipData: Omit<VirtualClip, 'id' | 'createdAt' | 'updatedAt'>): Promise<VirtualClip> => {
    const clipId = `clip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newClip: VirtualClip = {
      ...clipData,
      id: clipId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dedupEngine.addVirtualClip(newClip);
    return newClip;
  });

  ipcMain.handle('vault:update-virtual-clip', async (_, id: string, updates: Partial<VirtualClip>): Promise<VirtualClip> => {
    const updated = dedupEngine.updateVirtualClip(id, updates);
    if (!updated) throw new Error(`Clip ${id} not found`);
    return updated;
  });

  ipcMain.handle(
    'vault:delete-virtual-clip',
    async (_, id: string, deleteFromDisk: boolean = true): Promise<boolean> => {
      return dedupEngine.deleteVirtualClip(id, deleteFromDisk);
    }
  );

  ipcMain.handle('vault:reclassify-clip', async (_, clipId: string, category: PrimaryCategory, userTag?: string): Promise<VirtualClip> => {
    const clip = dedupEngine.getVirtualClips().find((c) => c.id === clipId);
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    const tags = new Set(clip.userTags);
    if (userTag && userTag.trim()) {
      tags.add(userTag.trim());
    }

    const updated = dedupEngine.updateVirtualClip(clipId, {
      category,
      userTags: Array.from(tags),
      classificationSource: 'user_manual',
      classificationConfidence: 1.0,
    });
    if (!updated) throw new Error(`Failed to update clip ${clipId}`);
    return updated;
  });

  ipcMain.handle('vault:export-clip', async (_, clipId: string, targetPath?: string): Promise<string> => {
    const clip = dedupEngine.getVirtualClips().find((c) => c.id === clipId);
    if (!clip) throw new Error(`Clip ${clipId} not found`);
    const rawFile = dedupEngine.getRawFile(clip.parentFileId);
    if (!rawFile) throw new Error(`Raw file for clip ${clipId} not found`);

    let destination = targetPath;
    if (!destination && mainWindow) {
      const saveRes = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${clip.title}.wav`,
        title: 'Export Virtual Clip to WAV',
      });
      if (saveRes.canceled || !saveRes.filePath) return '';
      destination = saveRes.filePath;
    }

    if (destination) {
      fs.copyFileSync(rawFile.storagePath, destination);
      return destination;
    }
    return '';
  });

  ipcMain.handle(
    'vault:export-clip-mp3',
    async (
      _,
      clipId: string,
      startSeconds?: number,
      durationSeconds?: number,
      targetPath?: string
    ): Promise<{ filePath: string; clip: VirtualClip }> => {
      const clip = dedupEngine.getVirtualClips().find((c) => c.id === clipId);
      if (!clip) throw new Error(`Clip ${clipId} not found`);
      const rawFile = dedupEngine.getRawFile(clip.parentFileId);
      if (!rawFile || !fs.existsSync(rawFile.storagePath)) {
        throw new Error(`Raw audio file for clip ${clipId} not found`);
      }

      const clipStart = typeof startSeconds === 'number' ? Math.max(0, startSeconds) : clip.startTimeSeconds;
      const clipDur =
        typeof durationSeconds === 'number'
          ? Math.max(0.1, durationSeconds)
          : Math.max(0.1, clip.endTimeSeconds - clipStart);

      const isSubSelection =
        typeof startSeconds === 'number' &&
        typeof durationSeconds === 'number' &&
        (Math.abs(startSeconds - clip.startTimeSeconds) > 0.1 ||
          Math.abs(startSeconds + durationSeconds - clip.endTimeSeconds) > 0.1);

      const cleanTitle = (clip.title || 'Untitled')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();

      const fileName = isSubSelection
        ? `${cleanTitle}_selection_${Math.round(clipStart)}s-${Math.round(clipStart + clipDur)}s.mp3`
        : `${cleanTitle}.mp3`;

      const destination = targetPath || path.join(dedupEngine.getExportsDir(), fileName);

      // Metadata extraction
      const artist = clip.userTags && clip.userTags.length > 0 ? clip.userTags.join(', ') : 'AudioVault';
      const album = `AudioVault - ${clip.category.charAt(0).toUpperCase() + clip.category.slice(1)}`;
      const genre = clip.category;
      const comment = (clip.transcription || clip.notes || '').replace(/"/g, "'");
      const date = clip.createdAt ? clip.createdAt.substring(0, 4) : new Date().getFullYear().toString();

      const args = [
        '-y',
        '-ss',
        clipStart.toFixed(3),
        '-i',
        rawFile.storagePath,
        '-t',
        clipDur.toFixed(3),
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '320k',
        '-id3v2_version',
        '3',
        '-write_id3v1',
        '1',
        '-metadata',
        `title=${clip.title}`,
        '-metadata',
        `artist=${artist}`,
        '-metadata',
        `album=${album}`,
        '-metadata',
        `genre=${genre}`,
        '-metadata',
        `comment=${comment}`,
        '-metadata',
        `date=${date}`,
        destination,
      ];

      await execFilePromise(getFfmpegPath(), args);

      const updated = dedupEngine.updateVirtualClip(clipId, {
        exportedMp3Path: destination,
        exportedAt: new Date().toISOString(),
      });

      return {
        filePath: destination,
        clip: updated || clip,
      };
    }
  );

  ipcMain.handle('vault:show-in-finder', async (_, filePath: string): Promise<boolean> => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    }
    return false;
  });

  ipcMain.handle('vault:transcribe-clip-region', async (_, clipId: string, startSeconds?: number, durationSeconds?: number): Promise<VirtualClip | null> => {
    const clips = dedupEngine.getVirtualClips();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return null;

    const rawFile = dedupEngine.getRawFile(clip.parentFileId);
    if (!rawFile || !fs.existsSync(rawFile.storagePath)) return null;

    const start = typeof startSeconds === 'number' ? Math.max(0, startSeconds) : clip.startTimeSeconds;
    // Transcribe full duration if durationSeconds is not specified
    const dur = typeof durationSeconds === 'number' ? Math.max(1, durationSeconds) : Math.max(1, clip.endTimeSeconds - start);

    const res = await audioEngine.transcribeAudioDetails(rawFile.storagePath, dur, start);
    if (!res || !res.text) return clip;

    const newChunks = res.chunks || [{
      text: res.text,
      timestamp: [start, start + dur] as [number, number],
    }];

    const isFullFile = start === 0 && dur >= (clip.endTimeSeconds - clip.startTimeSeconds - 0.5);
    const existingFull = clip.fullTranscription || (clip.transcription ? clip.transcription.replace(/^\[(?:Local )?Whisper\]:\s*"?/i, '').replace(/"?$/, '').trim() : '');
    const fullText = isFullFile || !existingFull ? res.text.trim() : `${existingFull} ${res.text.trim()}`;

    // Save full transcript to .txt file alongside raw audio file
    const ext = path.extname(rawFile.storagePath);
    const transcriptPath = rawFile.storagePath.slice(0, -ext.length) + '.txt';
    try {
      fs.writeFileSync(transcriptPath, fullText, 'utf-8');
      console.log(`[AudioVault IPC] 📝 Saved full transcript to: ${transcriptPath}`);
    } catch (err) {
      console.warn(`[AudioVault IPC] Failed to write transcript file: ${transcriptPath}`, err);
    }

    const snippet = fullText.length > 220 ? `${fullText.slice(0, 220).trim()}...` : fullText;
    const existingChunks = isFullFile ? [] : (clip.transcriptionChunks || []);
    // Filter out chunks overlapping with this window
    const nonOverlapping = existingChunks.filter((c) => c.timestamp[1] <= start || c.timestamp[0] >= start + dur);
    const combinedChunks = [...nonOverlapping, ...newChunks].sort((a, b) => a.timestamp[0] - b.timestamp[0]);

    const updated = dedupEngine.updateVirtualClip(clipId, {
      transcription: `[Whisper]: "${snippet}"`,
      fullTranscription: fullText,
      transcriptPath,
      transcriptionChunks: combinedChunks,
      updatedAt: new Date().toISOString(),
    });
    return updated || null;
  });

  ipcMain.handle('vault:get-clip-transcript', async (_, clipId: string): Promise<string | null> => {
    const clips = dedupEngine.getVirtualClips();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) return null;

    if (clip.fullTranscription && clip.fullTranscription.trim()) {
      return clip.fullTranscription;
    }

    if (clip.transcriptPath && fs.existsSync(clip.transcriptPath)) {
      try {
        return fs.readFileSync(clip.transcriptPath, 'utf-8');
      } catch {}
    }

    // Check next to raw file
    const rawFile = dedupEngine.getRawFile(clip.parentFileId);
    if (rawFile && rawFile.storagePath) {
      const ext = path.extname(rawFile.storagePath);
      const txtPath = rawFile.storagePath.slice(0, -ext.length) + '.txt';
      if (fs.existsSync(txtPath)) {
        try {
          return fs.readFileSync(txtPath, 'utf-8');
        } catch {}
      }
    }

    if (clip.transcription) {
      return clip.transcription.replace(/^\[(?:Local )?Whisper\]:\s*"?/i, '').replace(/"?$/, '').trim();
    }
    return null;
  });

  ipcMain.handle('vault:reprocess-clip', async (_, clipId: string): Promise<VirtualClip | null> => {
    const job = pipelineOrchestrator.reprocessClip(clipId);
    if (!job) return null;
    return dedupEngine.getVirtualClip(clipId) || null;
  });

  ipcMain.handle('vault:reprocess-all-clips', async (_, onlyMissing = false): Promise<{ count: number }> => {
    const queuedCount = pipelineOrchestrator.reprocessAllClips(onlyMissing);
    return { count: queuedCount };
  });

  ipcMain.handle('vault:generate-ai-title', async (_, clipId: string): Promise<VirtualClip> => {
    const clips = dedupEngine.getVirtualClips();
    const clip = clips.find((c) => c.id === clipId);
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    const transcript = clip.transcription || (clip.transcriptionChunks?.map((c) => c.text).join(' ')) || '';
    if (!transcript.trim()) {
      throw new Error('No transcription available for this clip.');
    }

    const newTitle = await titleService.generateCompositeTitle(clip.title, transcript);
    const updated = dedupEngine.updateVirtualClip(clipId, {
      title: newTitle,
    });
    if (!updated) throw new Error(`Failed to update clip ${clipId}`);
    return updated;
  });

  ipcMain.handle(
    'vault:save-recorded-take',
    async (_, wavBuffer: ArrayBuffer, customTitle?: string, _autoTranscribe = true): Promise<VirtualClip> => {
      const rawDir = dedupEngine.getRawDir();
      if (!fs.existsSync(rawDir)) {
        fs.mkdirSync(rawDir, { recursive: true });
      }

      const timestamp = Date.now();
      const filename = `${timestamp}_recording.WAV`;
      const filePath = path.join(rawDir, filename);

      const buffer = Buffer.from(wavBuffer);
      fs.writeFileSync(filePath, buffer);
      console.log(`[AudioVault Main] 🎙️ In-App take saved: ${filePath} (${buffer.length} bytes)`);

      // Fast synchronous clip creation so renderer gets instant responsiveness
      const analysis = audioEngine.analyzeWavFile(filePath);
      const fingerprint = dedupEngine.computeFileFingerprint(filePath);
      const rawFileId = `raw_${timestamp}_rec`;
      const rawAudioRecord: RawAudioFile = {
        id: rawFileId,
        fingerprint,
        originalFilename: filename,
        storagePath: filePath,
        durationSeconds: analysis.features.durationSeconds,
        sampleRate: analysis.features.sampleRate,
        channels: analysis.features.channels,
        fileSizeBytes: buffer.length,
        sourceDevice: 'In-App Recorder',
        importedAt: new Date().toISOString(),
        waveformPeaks: analysis.peaks,
      };
      dedupEngine.addRawFile(rawAudioRecord);

      const clipId = `clip_${timestamp}_rec`;
      const clipTitle =
        customTitle ||
        `In-App Take · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const defaultClip: VirtualClip = {
        id: clipId,
        parentFileId: rawFileId,
        title: clipTitle,
        startTimeSeconds: 0,
        endTimeSeconds: Math.max(0.5, analysis.features.durationSeconds),
        category: 'dictaphone',
        userTags: ['In-App Take', 'Voice Memo'],
        classificationConfidence: 0.95,
        classificationSource: 'yamnet_local',
        isExcluded: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      dedupEngine.addVirtualClip(defaultClip);

      const finalClip =
        dedupEngine.getVirtualClip(clipId) ||
        dedupEngine.getClipsForRawFile(rawFileId)[0] ||
        defaultClip;
      const finalRawId = finalClip.parentFileId;

      // Enqueue into Pipeline Orchestrator for SSD Whisper analysis & AI categorization
      // Passing finalClip.id and finalRawId so pipeline updates this exact clip in-place!
      pipelineOrchestrator.enqueueLocalFile(
        filePath,
        finalClip.title,
        'In-App Recorder',
        finalClip.id,
        finalRawId
      );

      return finalClip;
    }
  );

  ipcMain.handle('vault:get-deleted-files', async (): Promise<DeletedFileRecord[]> => {
    return dedupEngine.getDeletedFiles();
  });

  ipcMain.handle('vault:clear-deleted-files', async (): Promise<boolean> => {
    dedupEngine.clearDeletedFiles();
    return true;
  });

  ipcMain.handle('vault:forget-deleted-file', async (_, idOrFingerprint: string): Promise<boolean> => {
    return dedupEngine.forgetDeletedFile(idOrFingerprint);
  });

  // Collections IPC Handlers
  ipcMain.handle('vault:get-collections', async (): Promise<CollectionRecord[]> => {
    return dedupEngine.getCollections();
  });

  ipcMain.handle('vault:add-collection', async (_, col: CollectionRecord): Promise<CollectionRecord> => {
    dedupEngine.addCollection(col);
    return col;
  });

  ipcMain.handle('vault:delete-collection', async (_, id: string): Promise<boolean> => {
    return dedupEngine.deleteCollection(id);
  });

  // Import Batches IPC Handlers
  ipcMain.handle('vault:get-import-batches', async (): Promise<ImportBatchRecord[]> => {
    return dedupEngine.getImportBatches();
  });

  // Saved Views IPC Handlers
  ipcMain.handle('vault:get-saved-views', async (): Promise<SavedViewRecord[]> => {
    return dedupEngine.getSavedViews();
  });

  ipcMain.handle('vault:add-saved-view', async (_, view: SavedViewRecord): Promise<SavedViewRecord> => {
    dedupEngine.addSavedView(view);
    return view;
  });

  ipcMain.handle('vault:delete-saved-view', async (_, id: string): Promise<boolean> => {
    return dedupEngine.deleteSavedView(id);
  });

  // Flag & Collection Membership Handlers
  ipcMain.handle('vault:toggle-favorite', async (_, clipId: string): Promise<boolean> => {
    return dedupEngine.toggleFavorite(clipId);
  });

  ipcMain.handle('vault:toggle-reviewed', async (_, clipId: string): Promise<boolean> => {
    return dedupEngine.toggleReviewed(clipId);
  });

  ipcMain.handle('vault:add-clip-to-collection', async (_, clipId: string, collectionName: string): Promise<boolean> => {
    return dedupEngine.addClipToCollection(clipId, collectionName);
  });

  ipcMain.handle('vault:remove-clip-from-collection', async (_, clipId: string, collectionName: string): Promise<boolean> => {
    return dedupEngine.removeClipFromCollection(clipId, collectionName);
  });
}
