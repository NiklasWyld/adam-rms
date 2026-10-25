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

Verified against the [official Open API documentation](https://developer.ticktick.com/docs/openapi.md)
on 25 October 2026. Only official HTTPS OAuth/Open API endpoints are used.

Register an app in the [TickTick developer centre](https://developer.ticktick.com/manage).
Set these environment variables on the PHP web process (never commit actual values):

- TICKTICK_CLIENT_ID
- TICKTICK_CLIENT_SECRET
- TICKTICK_REDIRECT_URI — the exact registered HTTPS URL, e.g. your RMS origin followed by
  /taskPlanning/callback.php
- TASK_PLANNING_TOKEN_KEY — a stable base64-encoded random 32-byte key, generated once with
  php -r 'echo base64_encode(random_bytes(32)), PHP_EOL;'

Keep the key in the deployment secret store and back it up separately from the database.
The web process must inherit these variables; restart only that process after changing its environment.
Changing/losing the key requires reconnecting. Never expose secrets through Twig, browser storage or logs.

Open TickTick in the planner, connect once via OAuth (tasks:read tasks:write), then
**Sync to TickTick**. Choose all project tasks or only tasks assigned to you. Each user/business has
its own encrypted connection and mappings. RMS projects become marked TickTick lists.
Disconnect removes the locally stored token; mappings and existing external tasks remain.
Revoke the authorisation in TickTick settings as well if required. Reconnect the same account;
missing external lists/tasks fail visibly and are never silently recreated. Expired tokens require
reauthorisation; automatic refresh is not assumed by the documented authorization_code flow.

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
