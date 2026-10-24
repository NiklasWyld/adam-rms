# Project planning

Implemented in the existing project view, beside Assets and Files.

## Channel Planning

The first visit asks for input/output counts (defaults 32/10). Configuration supports 0–512 inputs, 0–256 outputs, alphabetic outputs (A…Z, AA…) or OUT1… numbering. Each channel can have up to 20 uses; programme/scene, signal, source/destination and notes are optional. Each text field accepts up to 4,000 characters; a saved document may contain up to 2 MB of UTF-8 data.

Changes autosave after a short pause. Save and Ctrl/Cmd+S retry explicitly. Unsaved changes block PDF export and trigger the browser's leave-page warning. A failed save stays visibly unsaved. Revision checks reject stale writes from other tabs; copy any local edits before reloading after a conflict. Reducing populated channels requires explicit confirmation in the UI and at the API.

PROJECTS:VIEW permits reading/searching and exporting a plan. Grant the new PROJECTS:CHANNEL_PLANNING:EDIT permission to roles that should configure/edit it. Existing roles are not silently upgraded. Archived projects are read-only; deleted projects are unavailable.

projectChannelPlans stores the canonical document as validated JSON plus typed configuration, revision, project and business fields. A unique project index enforces one main plan. Every lookup and mutation checks the current business and a non-deleted project. Mutations lock the project and commit the plan and audit record in one transaction.

Export PDF downloads an A4 landscape PDF using AdamRMS's existing pdfMake 0.2.6 and embedded Roboto fonts. It includes every channel/use, saved revision, project, business, export date and optional business logo. Tables repeat their headers. Long cells are split into bounded continuation rows, so each row and its channel/use label stay together across page breaks. The PDF is generated from the saved database document and is not automatically stored as a project file.

## Stage Planning and Shift Planning

Both tabs have their own view of ordinary project attachments (s3files_meta_type = 7). s3files_planningCategory is stage, shift or NULL. The same file ID and object appear in the planning tab and normal Files view; renaming, sharing and soft deletion use AdamRMS's existing controls and permissions. No independent file store is created.

Uploads use the existing Uppy → signed S3 PUT → uploadSuccess pipeline, with additional checks for project/business ownership, PROJECTS:VIEW, PROJECTS:PROJECT_FLIE_ATTACHMENTS:CREATE (existing spelling), CSRF, archive state, enabled storage, allowed extension and remaining business storage allowance. Planning uploads start private. PDF, common images, Office documents, text, CSV and native .gantt files are accepted. Uploading several files waits for all registrations before refreshing. Existing ASSETS:FILE_ATTACHMENTS:EDIT and :DELETE permissions govern file management.

Opening PDFs uses the existing S3 file link and browser PDF viewer. File management remains available even though external editors cannot be embedded by default. External editor changes are not automatically synchronised; export/save there and upload the resulting files.

## External integration checks (24 October 2026)

Checked HTTP response headers and loaded both applications and cross-origin iframes in real Chromium:

- Ridermaker: X-Frame-Options: DENY and CSP frame-ancestors 'none'. Chromium blocked the iframe with a CSP error. No supported editor embed was found in the public help pages. Use the direct link; no proxy, stripped security headers or copied editor.
- Online Gantt: the public app returned no X-Frame-Options or restrictive frame-ancestors, and its editor rendered in an iframe. The provider explicitly offers official domain/branded embeds with a Pro subscription. No paid entitlement or official embed URL was supplied, so the tab uses a direct-link fallback instead of treating technical frameability as permission. The editor itself confirms Open/Save As .gantt.
- Ridermaker has its own session and optional analytics/advertising consent. Online Gantt's local editor works without sign-up; cloud/sharing features require its own account. AdamRMS does not transfer login cookies, credentials or project data to either service. Third-party cookie restrictions may affect future official authenticated embeds.

Sources: [Ridermaker](https://ridermaker.com), [Ridermaker help](https://ridermaker.com/help), [Ridermaker privacy](https://ridermaker.com/privacy), [Online Gantt](https://www.onlinegantt.com/#/gantt), [Online Gantt terms](https://www.onlinegantt.com/terms.html), [Online Gantt privacy](https://www.onlinegantt.com/privacy.html).

## Installation and development

Run the normal migration before serving the changed PHP/templates:

```sh
php vendor/bin/phinx migrate -e development
```

The migration creates projectChannelPlans and adds the nullable category/index to s3files. It is reversible through Phinx. Existing attachments remain uncategorised and visible as before. Back up the database before rolling back because rollback removes saved channel plans and planning categories. No new production dependency is required.

The running Codespace currently starts only app and db (see .devcontainer/devcontainer.json runServices), and s3filestore is not resolvable. This is a pre-existing environment configuration, not a different storage implementation. For live uploads, start the existing s3filestore service from the Docker/Compose host or include it in runServices and rebuild the devcontainer. Set file storage to Enabled in server configuration, enable business/project-type storage, and make the S3 browser endpoint reachable from the user's browser. The current localhost:9090 browser endpoint requires a suitable Codespaces port forward. Never point a browser at its own localhost in a remotely hosted setup.

## Verification

Tests use the separate adamrms_e2e database in the devcontainer. Never run them against a database whose fixtures must be preserved.

```sh
cd e2e
E2E_PORT=8081 npm test -- --project=static
E2E_PORT=8081 npm run test:planning
```

test:planning starts a disposable, in-memory S3 HTTP fixture bound to 127.0.0.1:19090 and closes it after Playwright exits. It changes only test-database storage configuration and restores the original keys. It exercises the real AWS signing endpoint, Uppy PUTs, byte downloads, file registration, shared views and management; it does not implement or verify AWS signature cryptography. Normal tests skip these three storage-fixture cases unless started through this runner. It does not replace or configure the development/production S3 service.

Channel tests cover first use, persistence, project/business isolation, view/edit permissions, CSRF, archived/deleted projects, invalid payloads, conflict detection, safe reductions, autosave failure/retry, multiple uses, filtering, mobile layout, XSS and actual multi-page PDFs with Unicode and long text.

The referenced MC Verkablung.docx was not present among the supplied attachments; the numbering and multiple-use model follow the examples in the supplied requirements.

## Results in the existing Codespace

- Migration applied successfully to the development database.
- 19 planning/static checks passed (12 channel cases, 3 S3 HTTP fixture cases, 4 PHP/Twig checks).
- All 20 existing project-page render checks passed.
- The three actual PDF-download cases were rerun after the page-break refinement and passed, including exact preservation of all 3,500 unbroken test characters and all 90 repeated Unicode phrases.
- Rendered and visually checked every final PDF page (2, 8 and 11 pages for the 0-, 32- and 70-input stress cases). No clipped/overlapping text or orphaned channel/use labels remained.
- Existing production dependencies and the development S3 configuration were not changed; no test service remains running after the fixture runner exits.
