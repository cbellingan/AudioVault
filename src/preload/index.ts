import { contextBridge, ipcRenderer } from 'electron';
import { ChannelType, ChannelStatus, InventoryItem, Order, SyncLog, MakerHubAPI } from '../shared/types';

const api: MakerHubAPI = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getChannelStatuses: () => ipcRenderer.invoke('channels:get-statuses'),
  toggleChannelConnection: (channelId: ChannelType) =>
    ipcRenderer.invoke('channels:toggle-connection', channelId),
  getInventory: () => ipcRenderer.invoke('inventory:get-items'),
  updateStock: (sku: string, totalStock: number) =>
    ipcRenderer.invoke('inventory:update-stock', sku, totalStock),
  getOrders: () => ipcRenderer.invoke('orders:get-orders'),
  triggerSync: (channelId?: ChannelType) => ipcRenderer.invoke('sync:trigger', channelId),
  onSyncUpdate: (callback: (log: SyncLog) => void) => {
    const handler = (_: unknown, log: SyncLog) => callback(log);
    ipcRenderer.on('sync:update', handler);
    return () => {
      ipcRenderer.removeListener('sync:update', handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
