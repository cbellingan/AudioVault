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

declare global {
  interface Window {
    api: MakerHubAPI;
  }
}
