import { describe, it, expect } from 'vitest';
import {
  EtsyAdapter,
  AmazonAdapter,
  EBayAdapter,
  PinterestAdapter,
  calculateStockAllocations,
} from '../channel-adapter';

describe('Channel Adapters Unit Tests', () => {
  it('EtsyAdapter returns healthy status when connected', async () => {
    const adapter = new EtsyAdapter();
    const status = await adapter.getStatus();
    expect(status.id).toBe('etsy');
    expect(status.connected).toBe(true);
    expect(status.health).toBe('healthy');
    expect(status.activeListingsCount).toBe(42);
  });

  it('EBayAdapter handles connect and disconnect toggles', async () => {
    const adapter = new EBayAdapter();
    let status = await adapter.getStatus();
    expect(status.connected).toBe(false);

    await adapter.connect();
    status = await adapter.getStatus();
    expect(status.connected).toBe(true);

    await adapter.disconnect();
    status = await adapter.getStatus();
    expect(status.connected).toBe(false);
  });

  it('BaseChannelAdapter returns mock orders when connected', async () => {
    const adapter = new AmazonAdapter();
    const orders = await adapter.fetchOrders();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].channel).toBe('amazon');
    expect(orders[0].items[0].sku).toBe('MK-CER-MUG-01');
  });
});

describe('Inventory Stock Allocation Rules', () => {
  it('splits stock evenly across active channels', () => {
    const allocation = calculateStockAllocations(30, ['etsy', 'amazon', 'pinterest']);
    expect(allocation.etsy).toBe(10);
    expect(allocation.amazon).toBe(10);
    expect(allocation.pinterest).toBe(10);
    expect(allocation.ebay).toBe(0);
  });

  it('distributes remainder stock to front-runner channels', () => {
    const allocation = calculateStockAllocations(10, ['etsy', 'amazon', 'ebay']);
    expect(allocation.etsy).toBe(4);
    expect(allocation.amazon).toBe(3);
    expect(allocation.ebay).toBe(3);
  });

  it('handles zero or negative stock gracefully', () => {
    const allocation = calculateStockAllocations(0, ['etsy', 'amazon']);
    expect(allocation.etsy).toBe(0);
    expect(allocation.amazon).toBe(0);
  });
});
