# Multi-Tenant SaaS Audit

Date: 2026-06-07

This is the first-pass audit for moving the current Loopbase/Dohpe app from a single-business install toward a tenant-aware SaaS model. It is intentionally conservative: keep the current Dohpe workflow working, add company foundations, then migrate operational queries behind shared helpers.

## Current Identity Model

The app already has two useful identity layers:

- Supabase Auth: the logged-in account/email. This should become the SaaS account identity.
- `public.staff_users`: the in-store/operator/PIN identity. This should remain per company/workspace and continue to drive staff permissions, rota, checkout operator tracking, and audit attribution.

The current staff PIN is stored client-side in `active_staff_user` localStorage and cookie. That is acceptable as an operator convenience, but once company switching is live the stored staff record must include and be validated against the active company.

For SaaS launch, real human users should log in with email. PIN should not be the
main account security layer. PIN should answer "who is operating this station
right now?" after the device/user already has company access.

## Existing Company-Like Concepts

`company_key` exists today, but it is mostly rota/reporting-specific:

- `rota_week_finalisations.company_key`
- `staff_holiday_year_rollovers.company_key`
- Rota UI company keys such as `dohpe` and `dlretail`
- Telegram rota routing by company key

This should not become the main SaaS tenant key. Treat it as a legacy rota/trading-entity key for now. The main tenant boundary should be `company_id`.

## Recommended Tenant Model

Use `public.companies` as the main tenant/workspace table.

Use `public.company_memberships` to connect Supabase auth users to companies.

Company membership roles are account-level roles, such as owner/admin/member/billing.
Staff PIN roles are operational roles inside a company, such as checkout/scanner/manager.
Keep both layers because they answer different questions.

Use company-level billing/access state, separate from membership:

- Membership controls whether a user belongs to a company.
- Company subscription/access controls whether that company can use operational features.

The founder/internal "paid up for life" case should be a company billing override, not a staff-user flag:

- `companies.billing_exempt = true`
- `companies.billing_exempt_reason = 'founder_lifetime'`
- `companies.access_state = 'active'`
- `companies.internal_account = true`

## Tables That Should Be Tenant-Owned

These contain business data or company-specific configuration and should gain `company_id`:

- Core stock: `items`, `item_stock_locations`, `item_identifiers`, `generated_skus`, `sku_sequences`, `item_images`
- Processing: `inbound_batches`, `inbound_batch_rfids`, `photo_import_batches`, `photo_import_groups`, `photo_import_images`
- Locations/bins: `locations`, `warehouse_bins`, `item_location_movements`, `stock_location_events`
- Transfers/stock movement: `stock_transfers`, `stock_transfer_items`, `stock_movements`
- POS: `pos_sales`, `pos_sale_lines`, `printed_labels_log`
- Integrations/sync: `integration_settings`, `linnworks_sync_queue`, `linnworks_checked_open_orders`, `linnworks_processed_sales`, `ebay_listing_drafts`, eBay notification/deletion event logs
- Staff/rota/reports: `staff_users`, `staff_working_sessions`, `rota_settings`, `rota_week_finalisations`, `payroll_settings`, `staff_holiday_year_rollovers`, `fixed_costs`, `rota_google_tokens`
- Devices/stations: `company_devices`
- App configuration: `app_settings`
- Loans: `item_loans`

## Tables That Can Remain Global For Now

- Supabase-owned auth/storage tables
- Static extension/vault/realtime tables
- Pure reference/lookup data only if it is not customisable by a company

Most current lookup-like data is actually company-customisable, such as locations, categories, channel mappings, policies, and payroll settings, so it should be tenant-owned.

## High-Risk Existing Constraints

These need review before enabling real tenant isolation:

- `generated_skus.sku` is a primary key. Two companies may want the same SKU.
- `item_identifiers_active_value_unique` is globally unique. RFID TIDs can stay globally unique, but SKUs/barcodes should probably become unique per company and identifier type.
- `warehouse_bins_location_bin_unique` is currently global by location/bin. New tenants will need their own `LOCATION-1 / Default`.
- `integration_settings.channel` may be globally unique depending on the live schema. It should become unique per `company_id, channel`.
- Existing RLS policies are mostly broad `authenticated full access`. Do not rely on these for SaaS isolation until company-aware policies are applied and tested.

## Incremental Migration Plan

1. Add company foundation tables: companies, memberships, preferences, billing/subscription records, invites, and platform admin overrides.
2. Seed one default internal company and backfill existing data to it.
3. Add nullable then backfilled `company_id` columns to tenant-owned tables.
4. Add indexes for common tenant-filtered queries.
5. Add a client-side company provider and AppNav switcher.
6. Extend the existing root `proxy.ts` to validate active company, device/session state, and staff PIN freshness for page access.
7. Add server helpers that resolve active company from logged-in user, membership, and cookie/header context.
8. Move read/write routes gradually behind those helpers, starting with settings/staff/config, then inventory/processing, then POS/Linnworks/transfer routes.
9. Only after query coverage is verified, tighten RLS policies by company membership.

## Staff PIN And Company Switching

The SaaS default should be a separate staff list per company.

Even if the same real person works for two companies, they should normally have
two `staff_users` rows, one under each company. This keeps each company's:

- PINs
- role/permissions
- pay rate
- holiday/payroll settings
- rota/reporting history

cleanly separated.

If a staff member also has a Supabase login account, that can be linked later with
an optional `auth_user_id` on the staff row. That link should not replace company
memberships; it only says "this staff profile belongs to this logged-in account."

When active company changes:

- Clear active staff if that staff user does not belong to the selected company.
- Staff PIN dropdown should only show active staff for the active company.
- Server routes that use `active_staff_user` must verify that the staff row belongs to the active company.

Do not merge Supabase Auth users and `staff_users`. They solve different problems.

## Email Login, Device Login, And PIN

The clean model is three layers:

- Email login: a real SaaS user account with company memberships and subscription user-count billing.
- Device profile: a non-human station/device identity for checkout screens, scanners, receiving stations, and tablets.
- Staff PIN: the active staff member using that device/session for audit, permissions, rota time, checkout operator, and activity tracking.

Human users should normally have email logins and count toward the subscription user limit.

Device profiles should not be normal paid human users. They should be limited to a company,
given a narrow device type, and restricted to specific allowed areas, such as checkout,
allocate, receiving, transfers, or loan. A device profile still requires a staff PIN for
actions that need operator attribution.

Example:

- `checkout-till-1` device can open checkout only.
- `scanner-warehouse-1` device can open allocate/receiving/transfers.
- Staff member enters PIN on that device before operational actions.

This gives clean security without paying for fake human accounts and without leaving
shop-floor devices logged in as the owner.

The current app already has `proxy.ts`, which forces email login and staff PIN for
normal pages. Future work should extend that existing proxy rather than creating a
separate middleware file.

For device logins, PIN freshness should be time-window based, not inactivity based.
A sensible default is every 30 minutes on checkout/scanner/receiving devices, with
per-company or per-device overrides later. Every staff PIN session should store:

- company ID
- staff ID
- device ID when available
- last activity timestamp
- expires-at timestamp
- optional current route/area

For checkout/scanner devices, the UI can keep the screen open but require PIN re-entry
before actions once the 30-minute window has expired. This avoids interrupting the
till display while still keeping operator attribution honest.

## Session Takeover

For human email logins, support one active browser/device session per user by default.
If the same user logs in elsewhere, show:

`This account is already active on another device. Log out the previous session and continue here?`

If confirmed:

- mark the old session as revoked/ended
- clear its active device/staff state next time it checks in
- start a new session for the current browser/device

This should use an application-level session table because Supabase auth sessions alone
are not enough for friendly takeover UI, device naming, and audit history.

For the current internal setup:

- DOHPE staff list can include you, Lily, Ned, Meghan, and Sophie.
- DL Retail staff list can include you, Lily, Ned, and Meghan.
- The rows should be separate even where names match.
- Reports should default to the active company and only show staff from that company.

## Departments And Fulfilment Cost Centres

Some companies may fulfil orders for departments, brands, clients, or other businesses.
This should be modelled inside a company, not as extra tenants.

Recommended model:

- `company_departments`: company-owned departments/cost centres.
- Department type: internal department or 3PL/client.
- Optional Royal Mail department ID/code on each department.
- Postage billing/recharge settings placeholder only until Royal Mail data is confirmed.
- `items.department_id`: item-level department attribution.
- Future order/shipping rows can store the department used at dispatch time.

This lets one company produce departmental postage/spend reports without leaking
data between tenants.

The UI should live in Settings -> Company as a Departments / 3PL Clients card.

## Billing Access States

Suggested company access states:

- `active`
- `trial`
- `payment_required`
- `past_due`
- `cancelled`
- `suspended`
- `archived`

Operational routes should eventually block `payment_required`, `past_due`, `cancelled`, and `suspended`, while preserving read-only/account recovery access where appropriate.

## Human Review Needed

- DOHPE and DL Retail should be separate companies under the same logged-in account.
- Which existing Supabase auth users should be owners of DOHPE and DL Retail. The first migration keeps existing access by assigning existing auth users to both internal companies.
- SKUs should be unique only inside a company. Different companies can use the same SKU.
- RFID TID uniqueness should remain global. A TID is chip-level identity and should not be reused by another tenant.
- Stripe is the likely payment provider, but the schema should keep `billing_provider` generic so a manual/custom plan or another provider can still be used later.
- Plan limits should be editable/customisable instead of hard-coded into routes.

## Billing Plans And Limits

Use reusable plan records plus company subscriptions:

- `billing_plans`: plan templates such as Starter, Growth, Pro, Enterprise, and Custom.
- `billing_plan_versions`: versioned limits/prices so changing a plan later does not rewrite old subscriptions.
- `company_subscriptions`: the active company subscription, linked to a provider such as Stripe or `manual`.

Useful plan-limit variables should be flexible and editable, not limited to one fixed
set. Current useful examples include:

- SKU/item limit
- active SaaS user/email-login limit
- active staff/PIN profile limit
- active device/station limit
- company/location limit
- channel integration count
- marketplace listing/export limit
- monthly POS transaction count
- monthly AI generation count
- storage allowance
- RFID workflow access
- advanced reports access
- API/cron frequency
- priority support flag
- department/cost-centre count, if needed on lower tiers
