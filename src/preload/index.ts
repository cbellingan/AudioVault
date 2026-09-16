import { contextBridge, ipcRenderer } from 'electron';
import {
  AudioVaultAPI,
  VaultSettings,
  VolumeDetectedEvent,
  IngestResult,
  RawAudioFile,
  VirtualClip,
  PrimaryCategory,
  PipelineStatusEvent,
} from '../shared/types';

const audioVaultApi: AudioVaultAPI = {
  getVaultSettings: () => ipcRenderer.invoke('vault:get-settings'),
  updateVaultSettings: (settings: Partial<VaultSettings>) =>
    ipcRenderer.invoke('vault:update-settings', settings),
  selectVaultDirectory: () => ipcRenderer.invoke('vault:select-directory'),
  scanVolumes: () => ipcRenderer.invoke('vault:scan-volumes'),
  importFiles: (filePaths: string[], unmountVolumePath?: string) =>
    ipcRenderer.invoke('vault:import-files', filePaths, unmountVolumePath),
  onVolumeDetected: (callback: (event: VolumeDetectedEvent) => void) => {
    const handler = (_: unknown, event: VolumeDetectedEvent) => callback(event);
    ipcRenderer.on('vault:volume-detected', handler);
    return () => {
      ipcRenderer.removeListener('vault:volume-detected', handler);
    };
  },
  selectAndImport: () => ipcRenderer.invoke('vault:select-and-import'),
  enqueuePipelineBatch: (filePaths: string[], unmountVolumePath?: string) =>
    ipcRenderer.invoke('vault:enqueue-pipeline-batch', filePaths, unmountVolumePath),
  reconcileVault: () => ipcRenderer.invoke('vault:reconcile-vault'),
  onPipelineStatus: (callback: (status: PipelineStatusEvent) => void) => {
    const handler = (_: unknown, status: PipelineStatusEvent) => callback(status);
    ipcRenderer.on('vault:pipeline-status', handler);
    return () => {
      ipcRenderer.removeListener('vault:pipeline-status', handler);
    };
  },
  onClipAdded: (callback: (clip: VirtualClip) => void) => {
    const handler = (_: unknown, clip: VirtualClip) => callback(clip);
    ipcRenderer.on('vault:clip-added', handler);
    return () => {
      ipcRenderer.removeListener('vault:clip-added', handler);
    };
  },
  getRawFiles: () => ipcRenderer.invoke('vault:get-raw-files'),
  getVirtualClips: () => ipcRenderer.invoke('vault:get-virtual-clips'),
  createVirtualClip: (clip: Omit<VirtualClip, 'id' | 'createdAt' | 'updatedAt'>) =>
    ipcRenderer.invoke('vault:create-virtual-clip', clip),
  updateVirtualClip: (id: string, updates: Partial<VirtualClip>) =>
    ipcRenderer.invoke('vault:update-virtual-clip', id, updates),
  deleteVirtualClip: (id: string, deleteFromDisk: boolean = true) =>
    ipcRenderer.invoke('vault:delete-virtual-clip', id, deleteFromDisk),
  reclassifyClip: (clipId: string, category: PrimaryCategory, userTag?: string) =>
    ipcRenderer.invoke('vault:reclassify-clip', clipId, category, userTag),
  exportClip: (clipId: string, targetPath?: string) =>
    ipcRenderer.invoke('vault:export-clip', clipId, targetPath),
  exportClipMp3: (clipId: string, startSeconds?: number, durationSeconds?: number, targetPath?: string) =>
    ipcRenderer.invoke('vault:export-clip-mp3', clipId, startSeconds, durationSeconds, targetPath),
  showInFinder: (filePath: string) =>
    ipcRenderer.invoke('vault:show-in-finder', filePath),
  transcribeClipRegion: (clipId: string, startSeconds?: number, durationSeconds?: number) =>
    ipcRenderer.invoke('vault:transcribe-clip-region', clipId, startSeconds, durationSeconds),
  getClipTranscript: (clipId: string) =>
    ipcRenderer.invoke('vault:get-clip-transcript', clipId),
  reprocessClip: (clipId: string) =>
    ipcRenderer.invoke('vault:reprocess-clip', clipId),
  reprocessAllClips: (onlyMissing: boolean = false) =>
    ipcRenderer.invoke('vault:reprocess-all-clips', onlyMissing),
  generateAiTitle: (clipId: string) =>
    ipcRenderer.invoke('vault:generate-ai-title', clipId),
  saveRecordedTake: (wavBuffer: ArrayBuffer, customTitle?: string, autoTranscribe?: boolean) =>
    ipcRenderer.invoke('vault:save-recorded-take', wavBuffer, customTitle, autoTranscribe),
  getDeletedFiles: () => ipcRenderer.invoke('vault:get-deleted-files'),
  clearDeletedFiles: () => ipcRenderer.invoke('vault:clear-deleted-files'),
  forgetDeletedFile: (idOrFingerprint: string) =>
    ipcRenderer.invoke('vault:forget-deleted-file', idOrFingerprint),

  // Application Menu Actions
  onMenuAction: (callback: (action: string, ...args: any[]) => void) => {
    const handler = (_: unknown, action: string, ...args: any[]) => callback(action, ...args);
    ipcRenderer.on('app:menu-action', handler);
    return () => {
      ipcRenderer.removeListener('app:menu-action', handler);
    };
  },

  // Collections API
  getCollections: () => ipcRenderer.invoke('vault:get-collections'),
  addCollection: (col: any) => ipcRenderer.invoke('vault:add-collection', col),
  deleteCollection: (id: string) => ipcRenderer.invoke('vault:delete-collection', id),

  // Import Batches API
  getImportBatches: () => ipcRenderer.invoke('vault:get-import-batches'),

  // Saved Views API
  getSavedViews: () => ipcRenderer.invoke('vault:get-saved-views'),
  addSavedView: (view: any) => ipcRenderer.invoke('vault:add-saved-view', view),
  deleteSavedView: (id: string) => ipcRenderer.invoke('vault:delete-saved-view', id),

  // Flags & Membership
  toggleFavorite: (clipId: string) => ipcRenderer.invoke('vault:toggle-favorite', clipId),
  toggleReviewed: (clipId: string) => ipcRenderer.invoke('vault:toggle-reviewed', clipId),
  addClipToCollection: (clipId: string, collectionName: string) =>
    ipcRenderer.invoke('vault:add-clip-to-collection', clipId, collectionName),
  removeClipFromCollection: (clipId: string, collectionName: string) =>
    ipcRenderer.invoke('vault:remove-clip-from-collection', clipId, collectionName),
};

contextBridge.exposeInMainWorld('audioVault', audioVaultApi);
