// ==========================================
// 1. Electron Template / MakerHub Types
// ==========================================
export type ChannelType = 'etsy' | 'amazon' | 'ebay' | 'pinterest' | 'direct';

export interface ChannelStatus {
  id: ChannelType;
  name: string;
  connected: boolean;
  lastSyncedAt: string | null;
  activeListingsCount: number;
  pendingOrdersCount: number;
  health: 'healthy' | 'degraded' | 'disconnected';
  errorMessage?: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  totalStock: number;
  allocatedStock: Record<ChannelType, number>;
  unitCost: number;
  basePrice: number;
  lastUpdated: string;
}

export interface Order {
  id: string;
  channel: ChannelType;
  channelOrderId: string;
  customerName: string;
  items: {
    sku: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }[];
  totalAmount: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: string;
}

export interface SyncLog {
  id: string;
  timestamp: string;
  channel: ChannelType;
  action: string;
  status: 'success' | 'warning' | 'error';
  details: string;
}

export interface MakerHubAPI {
  getAppVersion: () => Promise<string>;
  getChannelStatuses: () => Promise<ChannelStatus[]>;
  toggleChannelConnection: (channelId: ChannelType) => Promise<ChannelStatus>;
  getInventory: () => Promise<InventoryItem[]>;
  updateStock: (sku: string, totalStock: number) => Promise<InventoryItem>;
  getOrders: () => Promise<Order[]>;
  triggerSync: (channelId?: ChannelType) => Promise<SyncLog[]>;
  onSyncUpdate: (callback: (log: SyncLog) => void) => () => void;
}

// ==========================================
// 2. Audio Ingestion & Classifier (AudioVault) Types
// ==========================================
export type PrimaryCategory = 'music' | 'concerts' | 'dictaphone' | 'meeting' | 'ambient' | 'unclassified';

export interface DiscoveredAudioFile {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedTime: string;
  volumePath: string;
  volumeName: string;
  isAlreadyImported: boolean;
  isDeleted?: boolean;
  fingerprint?: string;
}

export interface VolumeDetectedEvent {
  volumePath: string;
  volumeName: string;
  totalFilesCount: number;
  newFilesCount: number;
  deletedFilesCount?: number;
  files: DiscoveredAudioFile[];
}

export interface ImportPlanItem {
  path: string;
  name: string;
  sizeBytes: number;
  status: 'new' | 'duplicate' | 'excluded';
  explanation?: string;
  existingId?: string;
}

export interface ImportPlan {
  sourceDescription: string;
  totalFound: number;
  newFilesCount: number;
  duplicatesCount: number;
  excludedCount: number;
  items: ImportPlanItem[];
  destinationFolder: string;
}

export interface ExecuteImportOptions {
  filePaths: string[];
  targetCollection?: string;
  autoTranscribe?: boolean;
  unmountVolumePath?: string;
}

export interface DeletedFileRecord {
  id: string;
  fingerprint: string;
  contentHash?: string;
  originalFilename: string;
  fileSizeBytes: number;
  deletedAt: string;
  title?: string;
  reason?: string;
}

export interface RawAudioFile {
  id: string;
  fingerprint: string;
  originalFilename: string;
  storagePath: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  fileSizeBytes: number;
  sourceDevice: string;
  importedAt: string;
  waveformPeaks: number[];
}

export interface CollectionRecord {
  id: string;
  name: string;
  description?: string;
  color?: string;
  isPinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatchRecord {
  id: string;
  sourceName: string;
  sourceType: 'folder' | 'files' | 'sd_card' | 'recorder' | 'in_app';
  importedAt: string;
  totalFiles: number;
  importedCount: number;
  duplicateCount: number;
  excludedCount: number;
  failedCount: number;
  recordingIds: string[];
  targetCollection?: string;
  autoTranscribe: boolean;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface SavedViewRecord {
  id: string;
  name: string;
  scope: 'all' | 'recent' | 'review' | 'favorites' | string;
  groupBy: 'date' | 'month' | 'batch' | 'collection' | 'none';
  statusFilter: 'all' | 'ready' | 'pending' | 'not_transcribed' | 'nospeech' | 'no_speech' | 'failed';
  searchQuery?: string;
  createdAt: string;
}

export interface VirtualClip {
  id: string;
  parentFileId: string;
  title: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  category: PrimaryCategory;
  userTags: string[];
  classificationConfidence: number;
  classificationSource: 'yamnet_local' | 'whisper_local' | 'user_manual' | 'cloud_ai';
  transcription?: string; // UI preview / snippet
  fullTranscription?: string; // Complete unabbreviated transcript
  transcriptPath?: string; // File path to .txt sidecar stored with audio file
  transcriptionChunks?: Array<{ text: string; timestamp: [number, number] }>;
  notes?: string;
  isExcluded: boolean;
  exportedMp3Path?: string;
  exportedAt?: string;
  createdAt: string;
  updatedAt: string;

  // Domain Redesign Extensions
  recordedAt?: string; // Original recording timestamp if known (never fabricated)
  reviewed?: boolean; // User review state (default false)
  favorite?: boolean; // User favorite star
  collections?: string[]; // Many-to-many collection names/IDs
  batchId?: string; // ID of acquisition batch
  transcriptState?: 'not_requested' | 'queued' | 'transcribing' | 'ready' | 'no_speech' | 'failed';
  userTitle?: string; // Explicit user title (protected from auto-titling)
  editedTranscript?: string; // Explicit user edits to transcript
  transcriptVersions?: Array<{ id: string; text: string; source: 'machine' | 'user_edit'; createdAt: string }>;
}

export interface VaultSettings {
  vaultDirectory: string;
  autoUnmountAfterIngest: boolean;
  useLocalModelsDefault: boolean;
  enableCloudFallback: boolean;
  whisperLanguage: string;
  rememberDeleteChoice?: boolean;
}

export interface IngestResult {
  importedCount: number;
  skippedCount: number;
  unmounted: boolean;
  clips: VirtualClip[];
  errors: string[];
}

export interface BatchExportOptions {
  clipIds: string[];
  destinationDir?: string;
  audioFormat: 'wav' | 'mp3' | 'none';
  transcriptFormat: 'txt' | 'srt' | 'none';
}

export interface BatchExportItemResult {
  clipId: string;
  title: string;
  audioPath?: string;
  transcriptPath?: string;
  error?: string;
}

export interface BatchExportResult {
  totalRequested: number;
  succeeded: number;
  failed: number;
  items: BatchExportItemResult[];
  destinationDir: string;
}

export interface VaultStats {
  vaultDirectory: string;
  totalRecordings: number;
  excludedCount: number;
  totalSizeBytes: number;
  rawFilesCount: number;
  exportsCount: number;
}

// ==========================================
// 3. Non-Blocking Pipeline & Queue Types
// ==========================================
export type IngestJobStage = 
  | 'queued_copy' 
  | 'copying' 
  | 'queued_analysis' 
  | 'analyzing' 
  | 'completed' 
  | 'failed';

export interface IngestJobProgress {
  jobId: string;
  sourcePath: string;
  filename: string;
  stage: IngestJobStage;
  bytesCopied: number;
  totalBytes: number;
  copyPercent: number;        // 0 - 100
  analysisPercent: number;    // 0 - 100
  currentTaskDescription: string;
  error?: string;
  targetCollection?: string;
  autoTranscribe?: boolean;
  batchId?: string;
}

export interface PipelineStatusEvent {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeCopyJob?: IngestJobProgress;
  activeAnalysisJobs: IngestJobProgress[];
  isSdCardActive: boolean;
  canUnmountSdCard: boolean;
  unmountMessage?: string;
  cardStatusText?: string;
}

export interface AudioVaultAPI {
  // Vault Settings
  getVaultSettings: () => Promise<VaultSettings>;
  updateVaultSettings: (settings: Partial<VaultSettings>) => Promise<VaultSettings>;
  selectVaultDirectory: () => Promise<string | null>;

  // Volume & Ingestion
  scanVolumes: () => Promise<VolumeDetectedEvent[]>;
  importFiles: (filePaths: string[], unmountVolumePath?: string) => Promise<IngestResult>;
  onVolumeDetected: (callback: (event: VolumeDetectedEvent) => void) => () => void;

  // Pipeline Queue & Non-blocking Stream
  selectAndImport: () => Promise<{ batchId: string; count: number } | null>;
  planImport: (options?: { paths?: string[]; sourceDescription?: string }) => Promise<ImportPlan | null>;
  executeImportPlan: (options: ExecuteImportOptions) => Promise<{ batchId: string; count: number } | null>;
  enqueuePipelineBatch: (filePaths: string[], unmountVolumePath?: string) => Promise<{ batchId: string; count: number }>;
  reconcileVault: () => Promise<number>;
  onPipelineStatus: (callback: (status: PipelineStatusEvent) => void) => () => void;
  onClipAdded?: (callback: (clip: VirtualClip) => void) => () => void;

  // Audio Library & Clips
  getRawFiles: () => Promise<RawAudioFile[]>;
  getVirtualClips: () => Promise<VirtualClip[]>;
  createVirtualClip: (clip: Omit<VirtualClip, 'id' | 'createdAt' | 'updatedAt'>) => Promise<VirtualClip>;
  updateVirtualClip: (id: string, updates: Partial<VirtualClip>) => Promise<VirtualClip>;
  deleteVirtualClip: (id: string, deleteFromDisk?: boolean) => Promise<boolean>;
  reclassifyClip: (clipId: string, category: PrimaryCategory, userTag?: string) => Promise<VirtualClip>;
  exportClip: (clipId: string, targetPath?: string) => Promise<string>;
  exportClipMp3: (clipId: string, startSeconds?: number, durationSeconds?: number, targetPath?: string) => Promise<{ filePath: string; clip: VirtualClip }>;
  showInFinder: (filePath: string) => Promise<boolean>;
  transcribeClipRegion: (clipId: string, startSeconds?: number, durationSeconds?: number) => Promise<VirtualClip | null>;
  getClipTranscript: (clipId: string) => Promise<string | null>;
  reprocessClip: (clipId: string) => Promise<VirtualClip | null>;
  reprocessAllClips: (onlyMissing?: boolean) => Promise<{ count: number }>;
  generateAiTitle: (clipId: string) => Promise<VirtualClip>;
  saveRecordedTake: (wavBuffer: ArrayBuffer, customTitle?: string, autoTranscribe?: boolean) => Promise<VirtualClip>;

  // Tombstones & Sync Exclusion
  getDeletedFiles: () => Promise<DeletedFileRecord[]>;
  clearDeletedFiles: () => Promise<boolean>;
  forgetDeletedFile: (idOrFingerprint: string) => Promise<boolean>;

  // Application Menu & Navigation Actions
  onMenuAction?: (callback: (action: string, ...args: any[]) => void) => () => void;

  // Collections API
  getCollections?: () => Promise<CollectionRecord[]>;
  addCollection?: (col: CollectionRecord) => Promise<CollectionRecord>;
  deleteCollection?: (id: string) => Promise<boolean>;
  renameCollection?: (id: string, newName: string) => Promise<boolean>;
  batchAddClipsToCollection?: (clipIds: string[], collectionName: string) => Promise<number>;
  batchRemoveClipsFromCollection?: (clipIds: string[], collectionName: string) => Promise<number>;

  // Import Batches API
  getImportBatches?: () => Promise<ImportBatchRecord[]>;

  // Saved Views API
  getSavedViews?: () => Promise<SavedViewRecord[]>;
  addSavedView?: (view: SavedViewRecord) => Promise<SavedViewRecord>;
  deleteSavedView?: (id: string) => Promise<boolean>;

  // Flags & Membership
  toggleFavorite?: (clipId: string) => Promise<boolean>;
  toggleReviewed?: (clipId: string) => Promise<boolean>;
  addClipToCollection?: (clipId: string, collectionName: string) => Promise<boolean>;
  removeClipFromCollection?: (clipId: string, collectionName: string) => Promise<boolean>;

  // Unified Batch Export API (F11)
  batchExport?: (options: BatchExportOptions) => Promise<BatchExportResult>;

  // Storage Management & Exclusions (F12)
  moveVault?: (targetDir?: string) => Promise<{ success: boolean; newPath: string }>;
  openVault?: (targetDir?: string) => Promise<{ success: boolean; newPath: string }>;
  restoreExcludedClip?: (clipId: string) => Promise<VirtualClip | null>;
  getVaultStats?: () => Promise<VaultStats>;
}

declare global {
  interface Window {
    api?: MakerHubAPI;
    audioVault: AudioVaultAPI;
  }
}
