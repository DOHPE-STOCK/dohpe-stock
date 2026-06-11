# SaaS Readiness Checklist

## Current Foundation

- Company switching is active through `CompanyContext`.
- Company creation is available from Company Settings.
- New companies seed:
  - owner membership
  - trial subscription row
  - default department
  - default locations
  - blank integration rows
- Device locking exists for operational pages.
- Staff PIN sessions expire after 30 minutes.
- Billing-restricted companies are blocked from operational pages and can still reach settings.
- Linnworks crons run across all active/trial companies with Linnworks enabled.

## Run Before Enabling Operational RLS

1. Switch to DOHPE.
2. Confirm inventory only shows DOHPE items.
3. Confirm SKU search/edit can create and save a DOHPE item.
4. Confirm checkout can complete a cash/offline sale.
5. Confirm transfer creation, receive, and allocation still work.
6. Confirm processing: inbound, receiving, working, review, finalised.
7. Confirm reports/rota show only DOHPE.
8. Switch to DL Retail and repeat read-only checks.
9. Create a test company from Company Settings.
10. Confirm it starts empty and cannot see DOHPE/DL Retail data.
11. Confirm default locations and integrations exist for the test company.
12. Confirm a user with no company membership cannot access the company by changing local storage/cookies.

## SQL Order

Run these only after the main tenant foundation SQL has already succeeded:

1. Existing company/staff/location/integration backfill SQL files already used during the migration.
2. `sql/2026-06-10_operational_tenant_rls_policies.sql`

## SaaS Items Still To Finish

- Real email delivery for company invites.
- Invite acceptance route that creates membership for the logged-in email.
- Stripe Checkout and Stripe webhook connection.
- Session takeover UI backed by `user_app_sessions`.
- Server-side staff PIN session records backed by `staff_pin_sessions`.
- Company usage counters and plan-limit enforcement.
- Super-admin dashboard for manual billing exemptions and support access.
- Company data export and account closure workflows.
