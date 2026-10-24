# Shopping lists

This module manages planned procurement independently of inventory. It does not insert into or update assets, asset types, assignments, reservations or inventory statistics. Marking an item Purchased records its procurement status only.

## Installation and permissions

Run the normal Phinx migration workflow: `php vendor/bin/phinx migrate -e development` in the Codespace (production follows the existing deployment workflow). Migration `20261024160000` adds only `shoppingLists` and `shoppingListItems`. Its composite foreign key ensures an item and its list belong to the same business.

Under **Business → Roles & Permissions**, assign the following **Assets - Shopping Lists** permissions to the intended roles:

| Permission | Access |
| --- | --- |
| `SHOPPING_LISTS:VIEW` | Navigation, overview, details, API reads and PDF export |
| `SHOPPING_LISTS:CREATE` | Create and duplicate lists |
| `SHOPPING_LISTS:EDIT` | Edit lists; add, edit, duplicate and reorder items |
| `SHOPPING_LISTS:ARCHIVE` | Archive lists |
| `SHOPPING_LISTS:DELETE` | Soft-delete lists or remove items |

Write permissions depend on VIEW. Existing roles are deliberately not granted new permissions by migration. A newly created business's Administrator receives them through the existing all-permissions creation mechanism.

The **Shopping Lists** navigation entry is directly below **Maintenance**. Procurement permissions do not grant asset or project access.

## Behaviour

Lists support Draft, Active, Completed and Archived statuses; optional description, budget and general comment; creator and timestamps. Search and status filters operate on the overview. Lists and their active items can be duplicated.

Items reuse manufacturers and asset categories available to the selected business, including global records. They also store model, description, positive quantity (up to three decimal places), unit, optional estimated unit price, supplier, article number, product URL, optional HTTPS image URL, notes, necessity, justification and procurement status. Images are linked by URL and do not require an S3 upload service.

Necessity is Essential, High, Medium, Low or Optional. Item status is independently Planned, Approved, Ordered, Purchased or Rejected. The item modal edits all properties. Status can also be changed directly in the table. Arrow buttons persist the item's order; necessity and status filters never change the totals.

Prices and budgets accept a decimal point or comma without thousands separators. MoneyPHP parses values using the ISO currency's actual subunit count, multiplies by the decimal quantity, and rounds each line half up to that subunit. Stored prices are integer minor units; floats are never used for stored currency arithmetic. A blank price means unknown; zero means free. The estimate adds priced, non-rejected lines. Unknown prices and excluded rejected items are counted explicitly. Purchased lines remain included.

Each list captures the current business currency on creation, so changing the business currency cannot reinterpret existing prices. Budget and remaining amount use that same currency. Taxes, delivery and discounts are included only when entered in prices or represented by separate items; this is an estimate, not an invoice.

All removals are soft deletes. List mutations, duplication and reordering use database transactions and a parent-row lock. Every read and write is scoped to the selected business; item lookups also check the parent list. Reference IDs from another business, invalid IDs, negative or excessive-precision prices, invalid enum values, unsafe URLs, and malformed arrays are rejected.

## PDF

**Export PDF** exports the entire saved list, independently of UI filters, through the existing pdfMake 0.2.6 and embedded Roboto fonts used by project documents. It downloads automatically, with explicit Download PDF and Open PDF buttons available.

A4 portrait output includes business name and optional existing business logo, list title/description, creation and export dates, creator, list status, currency/budget, ordered articles, manufacturers/models, quantities, unit/line prices, necessity and readable justifications. Descriptions, suppliers, article numbers, product links, notes and item statuses are also included. Totals, missing-price/exclusion information, budget comparison, general comment, repeated table headings and page numbers complete the document. Price-table rows stay together. Long descriptions and justifications flow across pages in a separate full-width details section, numbered to match the price table.

The CDN requirements match the existing project PDF exporter. Logo embedding needs the existing S3 configuration only when a business logo is configured. External image URLs are displayed in the application; product images are not embedded in the PDF.

## API

`/api/shoppingLists/action.php` uses the existing authenticated API bootstrap and `finish()` response structure. Supported token type is `web-session`.

- `GET action=data`: list overview; supply `id` for a complete document. Includes a session-bound `csrf` token.
- `POST action=saveList`: `name`, `description`, `comment`, `budget`, `status`; include `id` to edit. Archiving uses its dedicated action.
- `POST action=duplicateList|archiveList|deleteList`: `id`.
- `POST action=saveItem`: `id` (list), optional `itemId`, `name`, `manufacturerId`, `categoryId`, `model`, `description`, `quantity`, `unit`, `unitPrice`, `supplier`, `sku`, `url`, `image`, `notes`, `priority`, `reason`, `status`. This is a full item form, not a partial patch.
- `POST action=duplicateItem|deleteItem`: `id`, `itemId`.
- `POST action=reorder`: `id`, `order[]` containing every current item ID exactly once.

Every mutation requires `csrf`. Successful writes return `response.id` for the resulting list. All action and input values are allowlisted. Text is stored as plain UTF-8, escaped by Twig on display, and JSON encoded with HTML-sensitive characters escaped before inclusion in scripts. Links are limited to HTTP(S), without embedded credentials; image links require HTTPS.

## Validation in the existing Codespace

Never run the fixture-resetting suite against the normal `db` database or reuse its running port 8080:

```sh
cd /workspace/e2e
E2E_PORT=8090 E2E_DB_DATABASE=adamrms_e2e npx playwright test authenticated/shopping-lists.spec.ts
E2E_PORT=8090 E2E_DB_DATABASE=adamrms_e2e npx playwright test
```

Focused tests cover list/item lifecycles, exact decimal arithmetic, unknown/zero prices, budgets, currency exponents, independent necessity/status, sorting, persistence, soft deletion, unchanged inventory, CSRF/method checks, invalid inputs, foreign references, every mutation's permission, and shared-user business switching. Chromium exercises desktop/mobile forms and downloads actual PDFs with empty, short and 65-item lists, including very long justification text and Unicode. When Poppler is available, tests also extract text and check A4 dimensions and repeated headings. General page-rendering, tenant-isolation, SQL-injection and stored-XSS sweeps include the new routes and fixtures.

For an explicitly destructive rollback/reapply check on the disposable test database only (run while the suite is stopped):

```sh
cd /workspace
DB_DATABASE=adamrms_e2e php e2e/setup/shopping-migration.php
```

This script refuses other database names or unexpected migration versions and verifies unrelated table counts remain unchanged. Run the normal suite afterwards to restore test fixtures.

## Verification record - 24 October 2026

- PHP syntax, relative includes, Twig compilation and template references pass; the feature adds no Composer or frontend dependencies.
- The final targeted run passes **24 tests**, including the 14 procurement-specific scenarios and the existing general page, SQL-injection, tenant and XSS cases for the module.
- The full existing suite ran **869 tests: 867 passed, 2 failed**. One failure was the new permission test reusing a session revoked by an earlier authentication test; it now logs in again and passes in the final targeted run. The other is the unchanged file-download SQL-injection test following a redirect to the optional S3 mock at localhost:9090, which is not running in this Codespace. No test was skipped or weakened.
- Migration rollback/reapply passes on adamrms_e2e, preserving unrelated table counts.
- Chromium generates real PDFs for 0, 2 and 65 items. Poppler confirms A4 dimensions, Unicode text and repeated headers; the final long document spans 13 pages, with intact price rows and a separate justification section. Desktop/mobile screenshots and PDF pages were reviewed.
- The normal development database received the additive shopping schema migration. Following explicit user approval, the five shopping permissions were added through the existing permission API only to the existing Administrator role in Codespace Entwicklung, and one labelled three-item example list was saved. Existing devcontainer recovery edits and FORK-UPGRADE.md changes are preserved outside this feature's commits.
- The complete live workflow passes through the actual private HTTPS forwarding of port 8080 in the existing Codespace: browser login, sidebar navigation, new list creation, three items with quantities/prices/necessities/justifications, reload and a fresh login proving persistence, active navigation, and an actual PDF download. The example is Modultest: Einkaufsplanung (24.10.2026), list ID 1. In EUR the saved estimate is 1,070.99, with a 5,000.00 budget, 3,929.01 remaining and one explicitly unpriced item. Inventory still contains zero actual assets. Chromium reports no page errors; both pages of the generated A4 PDF were rendered and visually inspected.
