import { ChannelType, ChannelStatus, InventoryItem, Order, SyncLog } from './types';

export interface ChannelAdapter {
  id: ChannelType;
  name: string;
  getStatus(): Promise<ChannelStatus>;
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  fetchOrders(): Promise<Order[]>;
  syncStock(sku: string, newQuantity: number): Promise<boolean>;
}

export class BaseChannelAdapter implements ChannelAdapter {
  public id: ChannelType;
  public name: string;
  private isConnected: boolean;
  private listingsCount: number;

  constructor(id: ChannelType, name: string, initialConnected = true, listingsCount = 25) {
    this.id = id;
    this.name = name;
    this.isConnected = initialConnected;
    this.listingsCount = listingsCount;
  }

  async getStatus(): Promise<ChannelStatus> {
    return {
      id: this.id,
      name: this.name,
      connected: this.isConnected,
      lastSyncedAt: this.isConnected ? new Date().toISOString() : null,
      activeListingsCount: this.isConnected ? this.listingsCount : 0,
      pendingOrdersCount: this.isConnected ? Math.floor(Math.random() * 5) + 1 : 0,
      health: this.isConnected ? 'healthy' : 'disconnected',
    };
  }

  async connect(): Promise<boolean> {
    this.isConnected = true;
    return true;
  }

  async disconnect(): Promise<boolean> {
    this.isConnected = false;
    return true;
  }

  async fetchOrders(): Promise<Order[]> {
    if (!this.isConnected) return [];
    return [
      {
        id: `ord_${this.id}_001`,
        channel: this.id,
        channelOrderId: `${this.id.toUpperCase()}-98421`,
        customerName: 'Sarah Connor',
        items: [
          {
            sku: 'MK-CER-MUG-01',
            productName: 'Handcrafted Speckled Ceramic Mug (12oz)',
            quantity: 2,
            unitPrice: 28.00,
          },
        ],
        totalAmount: 56.00,
        status: 'pending',
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
    ];
  }

  async syncStock(sku: string, newQuantity: number): Promise<boolean> {
    if (!this.isConnected) return false;
    return true;
  }
}

export class EtsyAdapter extends BaseChannelAdapter {
  constructor() {
    super('etsy', 'Etsy Craft Shop', true, 42);
  }
}

export class AmazonAdapter extends BaseChannelAdapter {
  constructor() {
    super('amazon', 'Amazon Handmade', true, 18);
  }
}

export class EBayAdapter extends BaseChannelAdapter {
  constructor() {
    super('ebay', 'eBay Store', false, 0);
  }
}

export class PinterestAdapter extends BaseChannelAdapter {
  constructor() {
    super('pinterest', 'Pinterest Product Pins', true, 31);
  }
}

export function calculateStockAllocations(
  totalStock: number,
  channels: ChannelType[]
): Record<ChannelType, number> {
  const result: Record<ChannelType, number> = {
    etsy: 0,
    amazon: 0,
    ebay: 0,
    pinterest: 0,
    direct: 0,
  };

  if (channels.length === 0 || totalStock <= 0) {
    return result;
  }

  const basePerChannel = Math.floor(totalStock / channels.length);
  let remainder = totalStock % channels.length;

  for (const channel of channels) {
    result[channel] = basePerChannel + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }

  return result;
}
