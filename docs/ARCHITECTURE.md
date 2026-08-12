# Architecture Specification: MakerHub Electron Framework

## 1. System Topology
MakerHub follows a security-hardened multi-process Electron architecture separating system-level capabilities (Main Process) from web-based presentation (Renderer Process) using isolated Preload context bridges.

```
+-------------------------------------------------------------------+
|                        ELECTRON MAIN PROCESS                       |
|  - Window Management      - Secure Storage      - IPC Dispatch    |
|  - Channel Adapter Sync   - Background Queue    - SQLite Database |
+-------------------------------------------------------------------+
                                  ^
                                  | (Secure IPC invoke/on)
                                  v
+-------------------------------------------------------------------+
|                       PRELOAD CONTEXT BRIDGE                      |
|  - Isolated Context       - Typed API Surface  - Sanitized Payload|
+-------------------------------------------------------------------+
                                  ^
                                  | (window.api)
                                  v
+-------------------------------------------------------------------+
|                       RENDERER PROCESS (React)                    |
|  - Modern Dark Mode Glass UI   - State Management                 |
|  - Live Channel Monitors       - Order & Inventory Views          |
+-------------------------------------------------------------------+
```

## 2. Process Responsibilities

### Main Process (`src/main/`)
- Manages application lifecycle and native window frame.
- Initializes IPC handlers (`ipcMain.handle`, `ipcMain.on`).
- Runs the background channel sync engine and polling adapters.
- Manages encrypted token vaults and local SQLite persistence.

### Preload Script (`src/preload/`)
- Sets `contextIsolation: true` and `sandbox: true`.
- Exposes `window.api` using `contextBridge.exposeInMainWorld`.
- Ensures no raw Node.js modules (`fs`, `child_process`, `net`) bleed into the Renderer.

### Renderer Process (`src/renderer/`)
- Built with React 18, Vite, and Vanilla CSS design tokens.
- Invokes native actions exclusively via `window.api`.
- Features real-time responsive updates for channel statuses, inventory adjustments, and order queues.

## 3. Extensible Channel Adapter Interface
Each sales destination implements the `ChannelAdapter` abstraction:
```ts
export interface ChannelAdapter {
  id: ChannelType;
  name: string;
  connect(): Promise<boolean>;
  disconnect(): Promise<boolean>;
  getStatus(): Promise<ChannelStatus>;
  fetchOrders(): Promise<Order[]>;
  syncInventory(itemId: string, stock: number): Promise<boolean>;
}
```

Implementations:
- `EtsyAdapter` (`src/shared/channel-adapter.ts`)
- `AmazonAdapter` (`src/shared/channel-adapter.ts`)
- `EBayAdapter` (`src/shared/channel-adapter.ts`)
- `PinterestAdapter` (`src/shared/channel-adapter.ts`)
