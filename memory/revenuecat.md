# RevenueCat — integrated (2026-02-07)
Persisted so a compacted agent can still edit products without re-running /setup.

## Identifiers (from /setup response)
- rc_project_id: proj58b95f05
- apple_app_id: appd44b05db37
- play_app_id: appb71cb1486d
- entitlement_lookup_key: pro
- offering_lookup_key: default
- Packages:
  - `$rc_monthly` → prod90ba538187 — $19.99 / P1M (CryptoBot Terminal Pro)
  - `walking_grid` → prod3f0762b09b — $4.99 / P1M (Walking Grid add-on)
- Dashboard: https://app.revenuecat.com/projects/proj58b95f05

## Product identity mapping (used in frontend gating)
- Pro subscription is inferred from `customerInfo.entitlements.active["pro"]` where product identifier is `$rc_monthly` (Pro base plan).
- Walking-grid add-on is inferred from `customerInfo.entitlements.active["pro"]` where product identifier is `walking_grid`.
- Both entitlements happen to be routed through the same RC `pro` entitlement lookup key (the setup created only one entitlement); we distinguish by inspecting `entitlement.productIdentifier`.

## Status check
`curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/c1606995-f0de-43cc-8d2d-615f779b3265/status"`

## Later updates (integration proxy ONLY)
- Change price/duration/trial or add a package (upsert):
  POST $INTEGRATION_PROXY_URL/internal/revenuecat/projects/c1606995-f0de-43cc-8d2d-615f779b3265/products
  body: `{"products":[{"package":"$rc_monthly","price":19.99,"currency":"USD","period":"P1M","prices":[{"amount_micros":19990000,"currency":"USD"}]}]}`
- Remove: DELETE .../products/%24rc_monthly

## Store credentials (user must complete before shipping to App Store / Play Store)
See FAQ section of the Payments panel for full walk-through:
1. Upload App Store Connect API `.p8` and Play service-account JSON in RC dashboard.
2. Create matching App Store / Play Store IAP products with the same product IDs.
3. Testflight / Play internal test, then submit for review.
