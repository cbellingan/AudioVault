# Developer & Agentic Development Guide

## 1. Development Principles
MakerHub is designed for rapid, reliable iteration by human developers and autonomous coding agents.
- **Strict Typing**: TypeScript everywhere (Main, Preload, Renderer, Tests).
- **Test-Driven Operations**: Every new feature or channel adapter requires unit tests (Vitest) and end-to-end integration coverage (Playwright).
- **Zero Raw Node in Renderer**: All native/IPC capabilities must pass through `src/preload/index.ts` and `src/shared/types.ts`.

## 2. Directory Map
```
blissful-hopper/
├── .github/
│   └── workflows/
│       └── ci.yml               # CI/CD GitHub Actions Pipeline
├── docs/                        # Project Specs & Architectural Architecture
│   ├── PRODUCT_SPEC.md
│   ├── ARCHITECTURE.md
│   └── DEVELOPMENT.md
├── e2e/                         # Playwright Electron Integration Specs
│   └── app.spec.ts
├── src/
│   ├── main/                    # Electron Main Process (IPC, Window, Core Logic)
│   │   ├── index.ts
│   │   └── __tests__/
│   ├── preload/                 # Secure Context Bridge
│   │   └── index.ts
│   ├── renderer/                # React Desktop UI (Vite + Vanilla CSS)
│   │   ├── index.html
│   │   ├── index.css
│   │   ├── main.tsx
│   │   └── App.tsx
│   └── shared/                  # Shared Interfaces & Channel Adapters
│       ├── types.ts
│       ├── channel-adapter.ts
│       └── __tests__/
├── package.json
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts
```

## 3. Command Workflows

### Run Application Locally
```bash
npm run dev
```

### Run Unit & Business Logic Tests
```bash
npm test
```

### Run Playwright Integration Tests
```bash
npm run test:e2e
```

### Type Checking & Build
```bash
npm run typecheck
npm run build
```

## 4. How to Add a New Sales Destination Channel
1. Add new channel key to `ChannelType` union in `src/shared/types.ts`.
2. Create a concrete class implementing `ChannelAdapter` in `src/shared/channel-adapter.ts`.
3. Add unit test assertions in `src/shared/__tests__/channel-adapter.test.ts`.
4. Update `src/renderer/App.tsx` channel grid component to display the new channel status card.
