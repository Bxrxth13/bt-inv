# Project memory

## Product intent & audience

- Internal factory inventory management web app for tracking materials from vendor purchase to staff issuance.
- Primary users: factory inventory staff/admins managing stock, vendors, payments, and bills.
- Core workflows: receive materials from vendors, issue materials to staff/departments, monitor live stock, track vendor payments, scan/extract bill data via OCR.

## Brand personality & voice

- Utility-focused, professional internal tool — clear, dense, operational.
- UI labels and messaging are direct and task-oriented (e.g., "Issue," "Receive," "Mark as Paid").

## Visual design & UX direction

- Dark theme throughout, sidebar navigation layout.
- Lucide React icons used for all iconography and logos.
- Tailwind CSS for styling; JSX + React hooks.
- Dashboard surfaces KPIs (total items, low-stock count, pending/overdue payments) plus recent activity and quick actions.
- Items list supports search and category filter.
- Live Stock pins low-stock items to top with a "low stock only" toggle.
- Vendor cards open detail panels listing purchased materials with last-known rates.
- Payment Reminders highlight overdue items and sort them first; one-click "mark paid."
- Bill Scan: upload image/PDF, OCR extracts vendor/bill number/date/amount into a reviewable, editable entry; re-scan supported.
- Components imported via `@/` path alias (`src/`).

## Decisions, constraints & rationale

- Build must pass typecheck and build steps; deploy after verification.
- No extra UI/icon packages beyond built-in template + Lucide React unless explicitly requested.
- Material entry auto-updates the vendor's material record rate on save.
- Material issue prevents over-issuing with stock-insufficient warning.
- Bill OCR uses a free-tier service — extraction quality varies; user can correct details before saving.
- Vendor records include contact details and GST.

## Open questions & assumptions

- Persistence/backend implementation not specified; assuming client-side or placeholder data layer for now.
- OCR provider choice and rate limits may need revisiting if extraction quality is insufficient.
- Role-based access or auth not yet mentioned; assumed single-user/internal access.
- Currency/locale formatting not specified; assumed default generic numeric display.