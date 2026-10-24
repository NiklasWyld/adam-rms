# Room Planning

Room Planning is integrated into the project navigation and the existing business sidebar. It uses the fork's PHP/Twig, Bootstrap and permission infrastructure. Existing Shopping Lists, Stage Planning, Shift Planning and Channel Planning are retained.

## Using it

1. Give the appropriate business roles the new permissions described below.
2. Open **Rooms** beside Locations in the sidebar. Add rooms, their building or optional existing Location, number, capacity, equipment, description and notes. Inactive rooms remain in existing plans but cannot be selected for new reservations.
3. Open a project and choose **Room Planning**. Add any number of reservations, including repeated reservations for the same room and reservations spanning multiple days.
4. Change statuses directly in the table, or open a booking to edit its dates, room, purpose and notes. Removal is a soft delete.
5. Filter by room, status and inclusive calendar-date range. Switch to the timeline and choose Day, Week or Month. Click a bar to open its details. Overlapping reservations occupy separate lanes.
6. **Generate Room Request** produces a German email subject/body, a copy button, a mailto link and a PDF link. It includes only Planned and Requested reservations. **Export PDF** includes the whole saved project plan and current conflict warnings.

Both PDF exports use portrait A4, repeating table headings, business identity and an optional existing business logo. Long text continues onto additional pages. No email is sent by AdamRMS and neither export changes reservation statuses. The mailto handoff is optional; mail clients impose their own URL length limits, so the copyable text is also provided.

**Confirmed is an internal, manually assigned status. It does not book a room in an external school administration system.**

## Permissions

| Action | Required business permission |
| --- | --- |
| View project room planning, its conflicts, request draft and PDF exports | PROJECTS:VIEW |
| Create, edit, remove or change the status of project reservations | PROJECTS:VIEW and PROJECTS:ROOM_PLANNING:EDIT |
| Open the central room catalogue | ROOMS:VIEW |
| Create/edit/deactivate rooms and change the planning timezone | ROOMS:MANAGE (depends on ROOMS:VIEW) |
| View the business-wide booking table/timeline in Rooms | ROOMS:VIEW and PROJECTS:VIEW |

Existing roles are not silently granted new permissions. A business administrator can assign them in the existing role editor. A project viewer sees an explicit read-only explanation; archived projects are also read-only. Project room selection works without permission to manage the central catalogue.

## Storage and isolation

Migration 20261024220000 adds rooms, roomReservations and the business planning timezone setting. Existing Locations represent sites/storage hierarchies, so a room can optionally link to one without changing that data model.

Each master record and reservation belongs to one business. Project/room references on reservations use composite foreign keys including the business ID. The service scopes every lookup, join, edit, export and conflict query to the selected business and ignores deleted records. A linked Location must also belong to that business.

Reservation dates are stored as UTC instants. Input fields, date filters, labels and timeline positions use the explicitly displayed business timezone (initially Europe/Berlin), independently of the browser timezone. Changing the business timezone preserves stored instants. Invalid calendar dates, missing hours at the spring DST change and non-positive periods are rejected.

Updates use transactions, audit events, creator/editor IDs, UTC timestamps and optimistic revision checks. Stale edits are refused with a reload message. Changing endpoints requires POST, a session CSRF token and the relevant permission. Browser rendering uses text nodes and export JSON uses escaped script-safe encoding.

## Conflicts and summary

An overlap exists when the same room has start < other end and end > other start. Back-to-back bookings therefore do not conflict. Planned, Requested and Confirmed bookings are active; Rejected, Cancelled and removed bookings are excluded. Deactivating a room does not erase its existing reservations.

Conflicts include other projects in the same business and overlapping bookings within the current project. They show the affected project, exact period and status. An overlap involving a Confirmed booking is marked red; other active overlaps are amber. Warnings do not block saving.

The server calculates conflicts for form previews and again from committed records after every save/status change/removal. Refresh reloads changes made in another tab or project. The summary counts distinct active rooms, confirmed bookings, all pending bookings (with the Requested subset), and unique conflict pairs.

The central catalogue also offers a business-wide, read-only booking overview for the selected timeline period. It initially loads the current calendar month. Changing its Day/Week/Month period fetches the corresponding records. A direct overview API request is bounded to 93 days; individual project plans are not restricted to that window. Open a booking's project to edit it.

The timeline uses native DOM/CSS and standard Intl date formatting; no paid scheduler or new runtime dependency is introduced. PDF generation reuses the fork's existing pdfMake/Roboto CDN approach and SRI hashes.

## Validation

Run only against the disposable test database, with the live development server left on port 8080:

    cd /workspace/e2e
    E2E_PORT=8081 npm test -- --project=static --project=authenticated static/code.spec.ts authenticated/room-planning.spec.ts authenticated/project-planning.spec.ts authenticated/shopping-lists.spec.ts

The combined run passed 42 tests on 24 October 2026. Follow-up runs passed all 13 static/room checks, all four new page-render cases and five additional entries in the existing permission/tenant-isolation tables. The Room Planning specification covers catalogue editing and deactivation, repeated/multi-day reservations, server previews, touching intervals, cross-project conflicts, severity changes, all statuses, date edits, soft removal, persistence, UTC/DST validation, stale revisions, foreign IDs, roles, CSRF, business switching, archived/deleted records, browser CRUD/filtering/timeline, read-only UI, safe text rendering, actual A4 PDF generation/download and unchanged statuses after request generation. A browser set to America/New_York verifies the Europe/Berlin 23/25-hour timeline days.

PDF text extraction checks Unicode and the last entry in a multi-page request. Rendered pages were also inspected visually. New catalogue, project-tab and export pages are registered in e2e/pages.ts.

The existing port-8080 application also passed a read-only check: login, project Room Planning API, project tab HTML and both export source pages. The migration is applied to its development database.

After explicit owner approval, the existing development administrator in Codespace Entwicklung received ROOMS:VIEW, ROOMS:MANAGE and PROJECTS:ROOM_PLANNING:EDIT through the application's permission API. The live port-8080 API and UI checks then passed against the existing development database. They created only clearly labelled QA data: projects 2 and 3, room 1 and five booking records (two subsequently soft-removed while testing removal). Existing project 1 and its plans were not edited.

The live Playwright check exercised catalogue editing, reservation creation, confirmed-conflict previews, all timeline scales, clicking details, multi-day date edits, clearing conflicts after edits, inline status changes, request text and clipboard copy, actual request/plan PDF downloads, persistence after reload, repeated reservations, UI removal, the business-wide timeline and mobile layout. There were no JavaScript errors. Both downloaded live PDFs were verified as portrait A4 and their extracted contents checked; generating them left statuses unchanged.

This live UI test transported requests for the approved application origin directly to the existing server on 127.0.0.1:8080 inside the Codespace. It used the real PHP pages, JavaScript, API, permissions and saved development data; it did not run the fixture-resetting test setup. Application configuration, TLS checks and SRI hashes were not changed.

The external forwarded-browser path remains unverified. After the owner approved the Codespace origins, GitHub redirected to github.com, and automatic review refused that additional account origin. No GitHub account content was accessed. A separate approval for the GitHub sign-in page is needed to finish that external routing check. The application itself is running and the live module permissions are enabled.
