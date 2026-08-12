import { describe, it, expect } from 'vitest';
import { calculateStockAllocations } from '../../shared/channel-adapter';

describe('Inventory Engine Integration Logic', () => {
  it('re-allocates stock dynamically when channels are connected or disconnected', () => {
    const activeChannelsTwo = ['etsy', 'amazon'] as const;
    const activeChannelsThree = ['etsy', 'amazon', 'ebay'] as const;

    const initialAlloc = calculateStockAllocations(100, [...activeChannelsTwo]);
    expect(initialAlloc.etsy).toBe(50);
    expect(initialAlloc.amazon).toBe(50);
    expect(initialAlloc.ebay).toBe(0);

    const reallocated = calculateStockAllocations(100, [...activeChannelsThree]);
    expect(reallocated.etsy).toBe(34);
    expect(reallocated.amazon).toBe(33);
    expect(reallocated.ebay).toBe(33);
    expect(reallocated.etsy + reallocated.amazon + reallocated.ebay).toBe(100);
  });
});
