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
  fingerprint?: string;
}

export interface VolumeDetectedEvent {
  volumePath: string;
  volumeName: string;
  totalFilesCount: number;
  newFilesCount: number;
  files: DiscoveredAudioFile[];
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
  transcription?: string;
  notes?: string;
  isExcluded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VaultSettings {
  vaultDirectory: string;
  autoUnmountAfterIngest: boolean;
  useLocalModelsDefault: boolean;
  enableCloudFallback: boolean;
  whisperLanguage: string;
}

export interface IngestResult {
  importedCount: number;
  skippedCount: number;
  unmounted: boolean;
  clips: VirtualClip[];
  errors: string[];
}

export interface AudioVaultAPI {
  getVaultSettings: () => Promise<VaultSettings>;
  updateVaultSettings: (settings: Partial<VaultSettings>) => Promise<VaultSettings>;
  selectVaultDirectory: () => Promise<string | null>;
  scanVolumes: () => Promise<VolumeDetectedEvent[]>;
  importFiles: (filePaths: string[], unmountVolumePath?: string) => Promise<IngestResult>;
  onVolumeDetected: (callback: (event: VolumeDetectedEvent) => void) => () => void;
  getRawFiles: () => Promise<RawAudioFile[]>;
  getVirtualClips: () => Promise<VirtualClip[]>;
  createVirtualClip: (clip: Omit<VirtualClip, 'id' | 'createdAt' | 'updatedAt'>) => Promise<VirtualClip>;
  updateVirtualClip: (id: string, updates: Partial<VirtualClip>) => Promise<VirtualClip>;
  deleteVirtualClip: (id: string) => Promise<boolean>;
  reclassifyClip: (clipId: string, category: PrimaryCategory, userTag?: string) => Promise<VirtualClip>;
  exportClip: (clipId: string, targetPath?: string) => Promise<string>;
}

declare global {
  interface Window {
    api?: MakerHubAPI;
    audioVault: AudioVaultAPI;
  }
}
