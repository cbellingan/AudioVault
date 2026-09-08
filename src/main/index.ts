import { app, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { DedupEngine } from './dedup-engine';
import { VolumeWatcher } from './volume-watcher';
import { AudioEngine } from './audio-engine';
import { PipelineOrchestrator } from './pipeline-orchestrator';
import {
  IngestResult,
  PipelineStatusEvent,
  PrimaryCategory,
  RawAudioFile,
  VaultSettings,
  VirtualClip,
  VolumeDetectedEvent,
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
const dedupEngine = new DedupEngine();
const volumeWatcher = new VolumeWatcher(dedupEngine);
const audioEngine = new AudioEngine();
const pipelineOrchestrator = new PipelineOrchestrator(dedupEngine, volumeWatcher, audioEngine);

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

  // Reconcile and process any unprocessed takes on startup
  setTimeout(() => {
    pipelineOrchestrator.enqueueUnprocessedRawFiles();
  }, 1000);

  // Background check for mounted external media
  const volumeInterval = setInterval(async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const events = await volumeWatcher.scanConnectedVolumes();
        if (events.length > 0 && events.some((e) => e.newFilesCount > 0)) {
          for (const ev of events) {
            if (ev.newFilesCount > 0) {
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
        if (dedupEngine.isFingerprintImported(fingerprint)) {
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        dedupEngine.addVirtualClip(defaultClip);
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

  ipcMain.handle('vault:delete-virtual-clip', async (_, id: string): Promise<boolean> => {
    return dedupEngine.deleteVirtualClip(id);
  });

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
}
