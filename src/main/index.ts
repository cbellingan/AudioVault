import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import {
  EtsyAdapter,
  AmazonAdapter,
  EBayAdapter,
  PinterestAdapter,
  calculateStockAllocations,
} from '../shared/channel-adapter';
import { ChannelStatus, ChannelType, InventoryItem, Order, SyncLog } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

// Initialize mock channel adapters
const adapters = {
  etsy: new EtsyAdapter(),
  amazon: new AmazonAdapter(),
  ebay: new EBayAdapter(),
  pinterest: new PinterestAdapter(),
};

// Initial mock inventory items
let mockInventory: InventoryItem[] = [
  {
    id: 'inv_1',
    sku: 'MK-CER-MUG-01',
    name: 'Handcrafted Speckled Ceramic Mug (12oz)',
    category: 'Ceramics',
    totalStock: 35,
    allocatedStock: calculateStockAllocations(35, ['etsy', 'amazon', 'pinterest']),
    unitCost: 6.50,
    basePrice: 28.00,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'inv_2',
    sku: 'MK-WOD-BOARD-02',
    name: 'Walnut End-Grain Cutting Board',
    category: 'Woodworking',
    totalStock: 12,
    allocatedStock: calculateStockAllocations(12, ['etsy', 'amazon', 'ebay']),
    unitCost: 22.00,
    basePrice: 85.00,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: 'inv_3',
    sku: 'MK-LEATH-JRNL-03',
    name: 'Full-Grain Leather Bound Journal',
    category: 'Leathercraft',
    totalStock: 50,
    allocatedStock: calculateStockAllocations(50, ['etsy', 'pinterest']),
    unitCost: 8.00,
    basePrice: 42.00,
    lastUpdated: new Date().toISOString(),
  },
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    title: 'MakerHub - Multi-Channel Business Manager',
    backgroundColor: '#0f172a',
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
  setupIpcHandlers();
  createWindow();

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
  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('channels:get-statuses', async (): Promise<ChannelStatus[]> => {
    const statuses = await Promise.all([
      adapters.etsy.getStatus(),
      adapters.amazon.getStatus(),
      adapters.ebay.getStatus(),
      adapters.pinterest.getStatus(),
    ]);
    return statuses;
  });

  ipcMain.handle('channels:toggle-connection', async (_, channelId: ChannelType): Promise<ChannelStatus> => {
    const adapter = adapters[channelId as keyof typeof adapters];
    if (!adapter) throw new Error(`Unknown channel: ${channelId}`);

    const status = await adapter.getStatus();
    if (status.connected) {
      await adapter.disconnect();
    } else {
      await adapter.connect();
    }
    return adapter.getStatus();
  });

  ipcMain.handle('inventory:get-items', async (): Promise<InventoryItem[]> => {
    return mockInventory;
  });

  ipcMain.handle('inventory:update-stock', async (_, sku: string, newStock: number): Promise<InventoryItem> => {
    const item = mockInventory.find((i) => i.sku === sku);
    if (!item) throw new Error(`Item with SKU ${sku} not found`);

    item.totalStock = newStock;
    item.allocatedStock = calculateStockAllocations(newStock, ['etsy', 'amazon', 'pinterest']);
    item.lastUpdated = new Date().toISOString();
    return item;
  });

  ipcMain.handle('orders:get-orders', async (): Promise<Order[]> => {
    const allOrders = await Promise.all([
      adapters.etsy.fetchOrders(),
      adapters.amazon.fetchOrders(),
      adapters.ebay.fetchOrders(),
      adapters.pinterest.fetchOrders(),
    ]);
    return allOrders.flat();
  });

  ipcMain.handle('sync:trigger', async (_, channelId?: ChannelType): Promise<SyncLog[]> => {
    const timestamp = new Date().toISOString();
    const logs: SyncLog[] = [];

    const targetChannels = channelId ? [channelId] : (['etsy', 'amazon', 'ebay', 'pinterest'] as ChannelType[]);

    for (const ch of targetChannels) {
      const adapter = adapters[ch as keyof typeof adapters];
      if (!adapter) continue;
      const status = await adapter.getStatus();

      if (status.connected) {
        logs.push({
          id: `log_${Date.now()}_${ch}`,
          timestamp,
          channel: ch,
          action: 'Full Catalogue & Stock Sync',
          status: 'success',
          details: `Successfully synchronized ${status.activeListingsCount} listings and updated inventory buffers.`,
        });
      } else {
        logs.push({
          id: `log_${Date.now()}_${ch}`,
          timestamp,
          channel: ch,
          action: 'Sync Attempted',
          status: 'warning',
          details: `Channel is currently disconnected. Sync skipped.`,
        });
      }
    }

    return logs;
  });
}
