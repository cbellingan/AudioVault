# Product Specification: MakerHub Multi-Channel Manager

## 1. Overview & Vision
**MakerHub** is an all-in-one desktop hub engineered specifically for independent makers, craftspeople, and micro-manufacturers. It unifies inventory, listings, orders, and sales analytics across **Etsy, Amazon Marketplace, eBay, Pinterest**, and direct sales channels into a single, high-performance offline-first Electron application.

## 2. Core Capabilities
- **Unified Inventory Matrix**: Real-time cross-channel inventory synchronization with stock safety thresholds to eliminate overselling across platforms.
- **Multi-Channel Order Pipeline**: Consolidated order management feed with automated status tracking, fulfillment labels, and customer notifications.
- **Listing & Channel Synchronization**: Centralized product catalogue with channel-specific mapping rules (e.g. Etsy tags, Amazon ASINs, eBay categories, Pinterest Buyable Pins).
- **Offline-First Resilience**: Local database storage ensuring full desktop availability regardless of internet connectivity, with background sync queues when back online.
- **Channel Adapter Architecture**: Extensible API integration interfaces enabling straightforward addition of new sales destinations (e.g., Shopify, WooCommerce, TikTok Shop).

## 3. Supported Sales Destinations
1. **Etsy**: Handcrafted goods, vintage items, custom craft supplies.
2. **Amazon Marketplace**: Handmade & Professional seller listings.
3. **eBay**: Fixed price and auction listings.
4. **Pinterest**: Product Pins & Catalog integration.
5. **Direct / In-Person (POS)**: Craft fair & studio direct inventory updates.

## 4. Non-Functional Requirements
- **Performance**: Sub-100ms UI responsiveness and low memory footprint.
- **Security**: Local encrypted storage for API keys & OAuth access tokens using native keychain utilities.
- **Testability**: 100% automated test coverage for core business logic, inventory allocation algorithms, and channel status parsing.
