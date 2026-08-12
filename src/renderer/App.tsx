import React, { useEffect, useState } from 'react';
import { ChannelStatus, ChannelType, InventoryItem, Order, SyncLog } from '../shared/types';

// Fallback mock data for web browser preview if window.api is absent
const mockFallbackChannels: ChannelStatus[] = [
  { id: 'etsy', name: 'Etsy Craft Shop', connected: true, lastSyncedAt: new Date().toISOString(), activeListingsCount: 42, pendingOrdersCount: 3, health: 'healthy' },
  { id: 'amazon', name: 'Amazon Handmade', connected: true, lastSyncedAt: new Date().toISOString(), activeListingsCount: 18, pendingOrdersCount: 1, health: 'healthy' },
  { id: 'ebay', name: 'eBay Store', connected: false, lastSyncedAt: null, activeListingsCount: 0, pendingOrdersCount: 0, health: 'disconnected' },
  { id: 'pinterest', name: 'Pinterest Product Pins', connected: true, lastSyncedAt: new Date().toISOString(), activeListingsCount: 31, pendingOrdersCount: 0, health: 'healthy' },
];

const mockFallbackInventory: InventoryItem[] = [
  { id: 'inv_1', sku: 'MK-CER-MUG-01', name: 'Handcrafted Speckled Ceramic Mug (12oz)', category: 'Ceramics', totalStock: 35, allocatedStock: { etsy: 12, amazon: 12, ebay: 0, pinterest: 11, direct: 0 }, unitCost: 6.50, basePrice: 28.00, lastUpdated: new Date().toISOString() },
  { id: 'inv_2', sku: 'MK-WOD-BOARD-02', name: 'Walnut End-Grain Cutting Board', category: 'Woodworking', totalStock: 12, allocatedStock: { etsy: 4, amazon: 4, ebay: 4, pinterest: 0, direct: 0 }, unitCost: 22.00, basePrice: 85.00, lastUpdated: new Date().toISOString() },
  { id: 'inv_3', sku: 'MK-LEATH-JRNL-03', name: 'Full-Grain Leather Bound Journal', category: 'Leathercraft', totalStock: 50, allocatedStock: { etsy: 25, amazon: 0, ebay: 0, pinterest: 25, direct: 0 }, unitCost: 8.00, basePrice: 42.00, lastUpdated: new Date().toISOString() },
];

const mockFallbackOrders: Order[] = [
  { id: 'ord_etsy_001', channel: 'etsy', channelOrderId: 'ETSY-98421', customerName: 'Sarah Connor', items: [{ sku: 'MK-CER-MUG-01', productName: 'Handcrafted Speckled Ceramic Mug (12oz)', quantity: 2, unitPrice: 28.00 }], totalAmount: 56.00, status: 'pending', createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 'ord_amazon_002', channel: 'amazon', channelOrderId: 'AMZ-33019', customerName: 'John Matrix', items: [{ sku: 'MK-WOD-BOARD-02', productName: 'Walnut End-Grain Cutting Board', quantity: 1, unitPrice: 85.00 }], totalAmount: 85.00, status: 'processing', createdAt: new Date(Date.now() - 14400000).toISOString() },
];

export default function App() {
  const [channels, setChannels] = useState<ChannelStatus[]>(mockFallbackChannels);
  const [inventory, setInventory] = useState<InventoryItem[]>(mockFallbackInventory);
  const [orders, setOrders] = useState<Order[]>(mockFallbackOrders);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (window.api) {
      loadInitialData();
    }
  }, []);

  async function loadInitialData() {
    try {
      const [chData, invData, ordData] = await Promise.all([
        window.api.getChannelStatuses(),
        window.api.getInventory(),
        window.api.getOrders(),
      ]);
      setChannels(chData);
      setInventory(invData);
      setOrders(ordData);
    } catch (err) {
      console.error('Failed to load initial Electron data:', err);
    }
  }

  async function handleToggleChannel(channelId: ChannelType) {
    if (window.api) {
      const updatedStatus = await window.api.toggleChannelConnection(channelId);
      setChannels((prev) => prev.map((c) => (c.id === channelId ? updatedStatus : c)));
    } else {
      setChannels((prev) =>
        prev.map((c) => (c.id === channelId ? { ...c, connected: !c.connected, health: !c.connected ? 'healthy' : 'disconnected' } : c))
      );
    }
  }

  async function handleTriggerSync() {
    setIsSyncing(true);
    let newLogs: SyncLog[] = [];
    if (window.api) {
      newLogs = await window.api.triggerSync();
    } else {
      newLogs = [
        {
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          channel: 'etsy',
          action: 'Multi-Channel Catalogue Sync',
          status: 'success',
          details: 'Simulated multi-channel sync completed across connected storefronts.',
        },
      ];
    }
    setLogs((prev) => [...newLogs, ...prev]);
    setIsSyncing(false);
  }

  async function handleStockChange(sku: string, currentStock: number, delta: number) {
    const newStock = Math.max(0, currentStock + delta);
    if (window.api) {
      const updatedItem = await window.api.updateStock(sku, newStock);
      setInventory((prev) => prev.map((i) => (i.sku === sku ? updatedItem : i)));
    } else {
      setInventory((prev) =>
        prev.map((i) =>
          i.sku === sku
            ? {
                ...i,
                totalStock: newStock,
                allocatedStock: {
                  ...i.allocatedStock,
                  etsy: Math.floor(newStock / 2),
                  amazon: Math.ceil(newStock / 2),
                },
                lastUpdated: new Date().toISOString(),
              }
            : i
        )
      );
    }
  }

  return (
    <div>
      {/* Header */}
      <header className="app-header">
        <div className="brand-container">
          <div className="brand-logo">M</div>
          <div>
            <div className="brand-title">MakerHub</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Multi-Channel Sales Manager</div>
          </div>
        </div>
        <div className="header-meta">
          <span className="badge badge-live">CI/CD Connected</span>
          <button className="btn btn-primary" onClick={handleTriggerSync} disabled={isSyncing}>
            {isSyncing ? 'Syncing...' : 'Sync All Channels'}
          </button>
        </div>
      </header>

      {/* App Main Body */}
      <main className="app-container">
        {/* Sales Channels Section */}
        <section>
          <div className="section-header">
            <h2 className="section-title">Connected Sales Destinations</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {channels.filter((c) => c.connected).length} of {channels.length} Channels Active
            </span>
          </div>
          <div className="channels-grid">
            {channels.map((ch) => (
              <div className="channel-card" key={ch.id}>
                <div className="channel-card-top">
                  <div>
                    <div className="channel-name">{ch.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {ch.connected ? 'Live Auto-Sync On' : 'Channel Disconnected'}
                    </div>
                  </div>
                  <span className={`status-dot ${ch.connected ? 'healthy' : 'disconnected'}`} />
                </div>
                <div className="channel-stats">
                  <div>
                    <div className="stat-num">{ch.activeListingsCount}</div>
                    <div className="stat-label">Active Listings</div>
                  </div>
                  <div>
                    <div className="stat-num">{ch.pendingOrdersCount}</div>
                    <div className="stat-label">Pending Orders</div>
                  </div>
                </div>
                <button
                  className={`btn ${ch.connected ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleToggleChannel(ch.id)}
                >
                  {ch.connected ? 'Disconnect Channel' : 'Connect Channel'}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Unified Inventory Section */}
        <section>
          <div className="section-header">
            <h2 className="section-title">Unified Inventory Matrix</h2>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Stock updates automatically balance across connected channels
            </span>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product & SKU</th>
                  <th>Category</th>
                  <th>Unit Cost / Price</th>
                  <th>Channel Allocations</th>
                  <th>Total Stock</th>
                  <th>Stock Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{item.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>SKU: {item.sku}</div>
                    </td>
                    <td>{item.category}</td>
                    <td>
                      <div>${item.basePrice.toFixed(2)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Cost: ${item.unitCost.toFixed(2)}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span className="pill pill-etsy">Etsy: {item.allocatedStock.etsy || 0}</span>
                        <span className="pill pill-amazon">Amazon: {item.allocatedStock.amazon || 0}</span>
                        <span className="pill pill-ebay">eBay: {item.allocatedStock.ebay || 0}</span>
                        <span className="pill pill-pinterest">Pin: {item.allocatedStock.pinterest || 0}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{item.totalStock}</span> units
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem' }}
                          onClick={() => handleStockChange(item.sku, item.totalStock, -1)}
                        >
                          -1
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem' }}
                          onClick={() => handleStockChange(item.sku, item.totalStock, 1)}
                        >
                          +1
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.3rem 0.6rem' }}
                          onClick={() => handleStockChange(item.sku, item.totalStock, 5)}
                        >
                          +5
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Multi-Channel Orders Section */}
        <section>
          <div className="section-header">
            <h2 className="section-title">Recent Cross-Channel Orders</h2>
          </div>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order Reference</th>
                  <th>Channel</th>
                  <th>Customer</th>
                  <th>Items Purchased</th>
                  <th>Total Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord) => (
                  <tr key={ord.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{ord.channelOrderId}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                        {new Date(ord.createdAt).toLocaleTimeString()}
                      </div>
                    </td>
                    <td>
                      <span className={`pill pill-${ord.channel}`}>{ord.channel.toUpperCase()}</span>
                    </td>
                    <td>{ord.customerName}</td>
                    <td>
                      {ord.items.map((i, idx) => (
                        <div key={idx} style={{ fontSize: '0.85rem' }}>
                          {i.quantity}x {i.productName}
                        </div>
                      ))}
                    </td>
                    <td style={{ fontWeight: 600 }}>${ord.totalAmount.toFixed(2)}</td>
                    <td>
                      <span className="badge badge-live">{ord.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Channel Sync Logs Console */}
        <section>
          <div className="section-header">
            <h2 className="section-title">Channel Sync Engine Console</h2>
          </div>
          <div className="console-box">
            <div className="log-entry success">
              <span>[{new Date().toLocaleTimeString()}]</span>
              <span>[SYSTEM] MakerHub Desktop Framework operational. Listening for IPC events.</span>
            </div>
            {logs.map((log) => (
              <div className={`log-entry ${log.status}`} key={log.id}>
                <span>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                <span>[{log.channel.toUpperCase()}] {log.action}: {log.details}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="app-footer">
        MakerHub Multi-Channel Business Manager Framework &bull; Electron + React + Vitest + Playwright CI/CD Architecture
      </footer>
    </div>
  );
}
