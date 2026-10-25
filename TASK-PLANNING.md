# Task Planning

Project navigation → **Task Planning**; sidebar → **My Tasks** (assigned tasks in the active business).
Viewing/exporting uses Projects: View. Grant the new Task Planning **Edit**, **Templates** and **Sync**
permissions to the appropriate business roles. Existing role grants are preserved.

Enter a title and press Enter; paste several lines to create a batch. All other fields are optional.
Edit fields directly; titles, categories and descriptions save after a short pause or on leaving the field.
Expand a row for description, time, independent deadline, project and checklist. N focuses quick add,
/ focuses search, Enter saves a title, Tab advances. Select rows for batch changes.
Manual sorting supports drag handles and keyboard-accessible Move up/down buttons. Filters and sort
remain independent; Reset filters keeps the selected sort/group. Saved filters belong to the user/business.

Task packages are shared within the business. Create/edit a package inline, paste its task titles,
set categories/priorities and optional relative day/deadline offsets, and expand items for checklists.
“Save project tasks as package” captures all project tasks, independently of list filters; dates become
offsets from the chosen reference/event date, and checklist completion resets. Without a reference,
dates are omitted. Preview computes dates server-side; deselect unwanted tasks before inserting.
Inserted tasks are independent snapshots. Resource limits: 500 titles per paste, 2000 tasks per package,
500 checklist items per task. Larger plans can be built using multiple batches.

## TickTick configuration

Open **Task Planning → TickTick → TickTick Settings**, or **Business Settings → TickTick**.
Business Settings: View is required to view the page; Business Settings: Edit is required to change it.
No Codespaces secrets or shell commands are needed for the app configuration in the existing Codespace.

Register an app in the [TickTick developer centre](https://developer.ticktick.com/manage), enter its
Client ID and Client Secret in RMS, and register the displayed HTTPS callback URL in TickTick.
The suggested callback uses the configured public RMS origin plus /taskPlanning/callback.php.
Save, then return to Task Planning and connect the personal TickTick account. App settings belong
to the active business; each user's OAuth connection remains personal.

Secrets use AES-256-GCM authenticated encryption. The UI/API returns only whether a secret exists;
the stored secret is never displayed. Leave the field blank to retain it. Secret-bearing requests
are excluded from API analytics payloads and Sentry request bodies; audit entries omit credentials.
Changing the effective app credentials invalidates personal tokens in this business while preserving
all external task/project mappings. Saving unchanged credentials retains connections.
Removing the app explicitly disables business sync instead of falling back to environment credentials.
Pending OAuth consent is bound to the app settings; stale consent cannot restore old credentials.
Configuration changes, callbacks and sync share a per-business database lock.

The server automatically creates a private encryption key outside the checkout and web directory.
In this Codespace it is /workspaces/.adamrms-secrets/task-planning.key, on the persistent /workspaces
mount, with a 0700 directory and a 0600 key file. No key material is committed or sent to the browser.
**Back up this file separately from the database.** Losing it makes existing encrypted credentials
unreadable. RMS refuses to silently generate a replacement while encrypted data exists.

Other deployments use /var/lib/adamrms/secrets/task-planning.key by default. Mount a persistent private
directory writable by the PHP runtime user, or set TASK_PLANNING_TOKEN_KEY_FILE to an absolute
private path outside the repository. An existing TASK_PLANNING_TOKEN_KEY (base64, 32 bytes) still
takes precedence; do not change it without migrating/reconnecting encrypted credentials.
Legacy TICKTICK_CLIENT_ID / TICKTICK_CLIENT_SECRET / TICKTICK_REDIRECT_URI remain a fallback
only until this business saves or explicitly removes its app configuration.

Official API details were checked against the [Open API documentation](https://developer.ticktick.com/docs/openapi.md).
Scopes remain tasks:read tasks:write. Expired OAuth tokens require reconnection; automatic refresh
is not assumed. Disconnecting a personal account removes its local token; revoke the app in TickTick
settings as well if required. Live OAuth consent still needs actual app credentials and user consent.

Mapping:

- Title and description are retained; checklist items retain their IDs and completion.
- Planned day/time maps to startDate. Deadline maps to dueDate; without a deadline, the planned day
  also supplies dueDate. Original planned/deadline values are always included in the description.
  TickTick represents these as a start/end interval, so it cannot represent every independent-date
  combination exactly as RMS does. If a deadline precedes the planned start, TickTick uses the planned date as its due date; the earlier independent RMS deadline remains in the description.
- Four ascending RMS priorities map to TickTick 0/1/3/5 (None/Low/Medium/High). RMS labels remain
  in the description.
- Done completes the external task. Open/in progress/blocked map to active; the precise RMS state
  is retained in the description. Reopening uses status 0 on the update.
- Category and responsible RMS user are included in the description. No automatic TickTick member
  assignment is attempted: RMS accounts do not supply a verified TickTick shared-project username.
- A project change moves the existing external task using the official task/move endpoint.
- RMS task deletion does not delete the personal external copy. No background/bidirectional sync.

Mappings are saved before completion. An interrupted create is reconciled by a stable RMS marker
before any retry. An uncertain create with no matching remote result is deliberately blocked:
check the remote list and resolve the mapping rather than risk duplicates. Definitive HTTP
validation/auth/rate-limit refusals can be retried. Deleted/missing remote objects are not recreated.
A per-user database lock serialises sync across sessions. Unchanged tasks are skipped; larger
plans continue in batches of up to 100 changed tasks per request.

The HTTP adapter is covered with a fake TickTick server at the transport boundary and real
isolated MySQL persistence. Live OAuth consent/API behaviour still requires actual app credentials
and the user's consent. No live token is bundled. In particular, date clearing/reopening and all
provider-specific constraints must be verified when connecting the real account.

## PDF and storage

Export all tasks in the current view or the current filters, grouped by category/day, optionally
with checklists. My Tasks exports never include tasks outside the personal view.
The existing pdfMake/fonts and optional business-logo infrastructure produces A4 plans,
checkboxes, progress, dates, priorities, statuses and responsible users.

Phinx migration 20261025090000 is additive and reversible. No existing feature table is removed.
Task/category/project foreign keys enforce business ownership. Task/package deletion is soft.
Writes use CSRF, field validation, transactions, optimistic revisions and idempotent request IDs.
A lost response can be retried without creating another task/package copy. On conflict, drafts stay
visible; “Reload current version” explicitly rebases field edits onto current revisions.

Focused verification:
cd e2e
E2E_PORT=8085 E2E_DB_DATABASE=adamrms_e2e npm test -- --project=static --project=authenticated static/code.spec.ts authenticated/task-planning.spec.ts

Use only the disposable test database. The normal Codespace database, port 8080 and existing
Room Planning/Channel Planning/Shopping Lists are retained.

Verification on the existing Codespace (25 October 2026): 13 focused Task Planning tests and
43 existing static/Room Planning/Channel Planning/Shopping Lists regression tests passed.
Migration rollback/reapply on adamrms_e2e preserved every unrelated table and the normal database.
Actual filtered/all/empty/multipage PDF downloads were verified and rendered for visual review.
The normal port-8080 My Tasks page, project tab and task API were checked with the development login.
Live TickTick OAuth/API verification remains pending app credentials.

TickTick settings follow-up: 23 targeted static, task-planning and app-settings tests passed
across focused runs, including masked browser editing, API/log redaction, business permissions,
key loss/permissions, authenticated encryption, pending OAuth invalidation and real SQL locks.
The settings migration was rolled back/reapplied only on adamrms_e2e; unrelated records and
the normal database were fingerprinted and preserved. Normal port-8080 settings/API and
automatically provisioned persistent encryption storage were verified without live credentials.
