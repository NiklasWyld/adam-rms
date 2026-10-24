# Fork update and Codespaces recovery — 23 October 2026

## Source and backup

- Fork: `NiklasWyld/adam-rms`, original `main` at `64b753e5631e04b94e709caf468d06bceac54f61`.
- Immutable backup, also pushed to the fork: [`backup/pre-upstream-update-2026-10-23-64b753e`](https://github.com/NiklasWyld/adam-rms/tree/backup/pre-upstream-update-2026-10-23-64b753e). Do not move, rewrite or delete it.
- Working branch: `repair/upstream-codespaces-2026-10-23`.
- Latest stable upstream release at inspection: **v1.205.6**, `2e76a3da99e8f075778a18b1c1e2b0733fb8a8b7` (21 October 2026).
- Integrated upstream `main`: `cf65a6cc2576b50544e425f0aa8e1d7368ec32c7`. Its only difference from that release is the upstream Docker base-image unpinning correction. Both the release and upstream main are ancestors of this branch.

The last fork commit reverted the earlier upstream merge across **274 files**. Git still considered that upstream history merged, so simply merging upstream again would have left many fixes reverted. The update first reapplies that reverted merge, then merges current upstream. The only textual merge conflict was generated OpenAPI documentation, which was regenerated from the final PHP source rather than choosing one outdated generated copy.

No force pushes, hard resets, branch deletions or production database operations were used. The backup branch is unchanged. Changes are proposed through a pull request; `main` is not modified directly.

## Customisations found in the history

All **20 original fork branch heads**, all reachable commits, and upstream branches/tags were inspected. The fork's PR history was also checked. Custom commits unique to the fork are already reachable from its main history; no extra Niklas-authored feature was found only on an unmerged branch.

| Feature | Relevant history | Treatment |
| --- | --- | --- |
| Project comment editing and deletion | `7f43614f`, `ab9d2b7d`, `762e4d5d`, `85132497`; fork PRs #4–#5 | Retained and repaired. The UI now actually calls the edit/delete APIs. Rich text is purified. Changes are limited to live project quick comments in the current business, by the author or a user with `PROJECTS:PROJECT_NOTES:EDIT:NOTES`. Deletion remains a soft delete and editing/deletion create audit events. |
| Personal embedded calendar | `2c467488` | Retained, including the navigation link and existing `googleCalendarEmbedUrl` JSON. Calendar checkbox saves now clear unchecked options while preserving extension keys. Embed URLs require HTTPS without embedded credentials; invalid legacy URLs are not rendered. The configured frame origin is permitted on the calendar page when CSP is enabled. |
| Manufacturer editing | `1988d417`, fork PR #1 | Restored the empty API file and missing editor controls, using upstream's current implementation and its business/permission checks. |
| Client and location creation from a project | `a12f9b3a`, fork PR #3 | Restored project quick-create controls and the empty location modal. Kept the current upstream project layout. |
| Custom/whitelabel logos | `4fe13d0f`, `5b086c2f`, fork PR #2 | Retained across login, navigation and configuration. Fixed saving the logo property when its config row does not yet exist. |
| Devcontainer adjustment | `8a812035` | Replaced obsolete image/startup settings with the tested lifecycle below. |
| Other retained presentation changes | Includes `src/maintenance/individualBarcode.twig` | Preserved rather than dropping files just because upstream differs. |

The other fork branches were retained unchanged. `83-google-drive`, `84-slack`, `file-browser`, `imperial-units-mass`, `laravel`, `laravel-postgres`, `static`, `v2-heroku` and `feat-aws-ses-provider` contain old experiments by upstream contributors/bots, not additional Niklas-authored customisations. Their unmerged rewrites/integrations were not silently introduced into the stable application. `755-manufacturer-crud`, `769-whitelabel-icon`, `827-project-create-client`, `comment-editing` and `sync-upstream-resolved` have their relevant work in main history. The three old Dependabot branches were examined; dependencies were resolved against this update rather than merging the obsolete PHP 8.4 proposal. `api-example` and `cloudformation` add no unique commits beyond main/upstream.

## Dependencies and database

Development and production target **PHP 8.3**. Composer's lockfile is committed, and startup uses `composer install`, never `composer update`. Compatible dependencies and transitive packages were refreshed; notable versions are Twig 3.30, PhpSpreadsheet 5.10 and firebase/php-jwt 7. The old `audit.block-insecure: false` exception was removed. `composer validate --strict --no-check-publish` succeeds and `composer audit --locked` reports no known vulnerability advisories.

The three previously reverted upstream migrations are restored: bigint financial columns, per-instance trial tracking, and keeping S3 references on instance deletion. The complete schema now has **53 migrations**. Fork comments already live in `auditLog`; calendar settings live in `instances.instances_calendarConfig`; logos use `config` and existing S3 metadata. They do not need new tables or destructive conversion migrations.

An upgrade test uses a copy of the earlier synthetic development database at migration 50. A project comment, calendar URL/extension JSON and logo setting are populated before migration. Migration to 53 preserves those values exactly. The source development database is mounted read-only for copying; no production database is contacted.

The existing Stripe webhook's `continue` inside `switch` generated a PHP compile warning before response headers, and its error bodies preceded HTTP status selection. Those small errors are fixed so missing secrets, bad signatures and malformed payloads return HTTP 400 even without PHP output buffering. Billing behaviour otherwise remains upstream's; no real payment API calls are made by the tests.

## Starting a new GitHub Codespace

1. After merging the pull request, select this fork's `main` branch (or select the working branch to try the proposed update).
2. Use **Code → Codespaces → Create codespace**. For an existing Codespace, use **Dev Containers: Rebuild Container** after checking that its uncommitted work is saved.
3. Wait for `AdamRMS is ready on port 8080.` in the lifecycle output, then open port **8080** from the Codespaces **Ports** panel. Keep the port private.
4. On a new database, sign in with the repository's development account: **`username` / `password!`**. Create a local test business in the application. Existing users, passwords, businesses and signing keys are preserved on later starts.

The shipped configuration builds PHP 8.3, Composer 2.9 and Node 22, starts a healthy MySQL 8 service, installs locked dependencies, waits for database readiness, migrates/seeds the local development database, fills only missing application settings, and starts the PHP server automatically. Codespaces' `CODESPACE_NAME` and forwarding domain determine the HTTPS root URL, preventing localhost redirects and mixed-content asset URLs. The server log is `/tmp/adamrms-dev/server.log`. Re-running `bash .devcontainer/scripts/start.sh` is safe and reuses a running server.

Lifecycle database scripts refuse to run unless the devcontainer flag, development mode, database host `db` and database name `db` match the supplied local setup. Do not change those scripts to point at production. Persistent MySQL data stays in the Compose `db_data` volume. Do not use `docker compose down -v` to troubleshoot a Codespace whose data should be kept.

Only `app` and `db` are required and started by default. The original optional S3 mock, Mailpit and phpMyAdmin services remain available in Compose. To enable them, add their service names to `runServices` in `.devcontainer/devcontainer.json`, add the corresponding service ports to `forwardPorts`, and rebuild. The service ports are `s3filestore:9090`, `mailpit:8025` and `phpmyadmin:80`. The S3 server endpoint is corrected to `http://s3filestore:9090`; configure its browser endpoint for the forwarded HTTPS port before enabling browser uploads. Email and file uploads remain disabled until explicitly configured; live S3/email/OAuth/payment credentials are not required to start or test comments and calendars.

## Tests and validation

Inside a new Codespace:

```bash
cd /workspace/e2e
npm ci
npx playwright install --with-deps chromium
npm test
```

Tests automatically use the separate **`adamrms_e2e`** database inside the devcontainer, created by `.devcontainer/db-init/01-e2e.sql`. This keeps Playwright's fixture resets separate from normal development data. `E2E_DB_DATABASE` can override the test database explicitly. On an existing database volume created before this change, a local database administrator must create/grant that disposable database using the supplied SQL; initialisation scripts only run for a new volume. Never run the suite against production or valuable development data.

Validation includes:

- Regression tests first reproduced ten comment/calendar failures; the repaired API/permission/tenant checks pass.
- Browser tests exercise comment creation/editing/deletion, calendar settings and iframe/CSP output, manufacturer editing, and client/location quick-create.
- The complete upstream Playwright suite, including source/Twig checks, public pages, all authenticated pages, business rules, multi-tenant isolation, SQL injection and XSS sweeps. The calendar control now uses two distinct values so an idempotent second save does not falsely look like a rejected write.
- A Docker build of the shipped devcontainer image and a Dev Containers CLI lifecycle run against a clean source copy without `vendor` and a fresh database. Login, HTTPS root URL construction, business creation and authenticated rendering are checked. A repeated lifecycle run preserves users and the signing key. Container recreation and recovery from a stale PID file are also checked.
- The migration-50-to-53 data preservation test described above.

The final complete Playwright run passed **845 tests**, with no failed or skipped tests. An additional XLSX export/read-back compatibility test passed separately after that full run. The first GitHub run also passed (845 immediate passes and one retry), exposing a pre-existing role-deletion test that assumed an old fixture manager ID. That test now establishes its manager explicitly, checks the API refusal and always restores its fixtures; it is also repeated locally. No test is disabled to make the update pass. TLS validation and frontend SRI checks remain enabled; managed builders can supply a CA secret rather than disable verification.

## Remaining limits

- Creating a hosted GitHub Codespace was attempted for the repair branch, but GitHub returned `403 Resource not accessible by integration`. No hosted Codespace was created. The container image, lifecycle and forwarded-address generation were tested locally through the Dev Containers CLI; GitHub's hosted port routing was subsequently verified in the existing Codespace on 24 October 2026; see the recovery record below.
- External calendar providers may require access/login and may restrict iframe embedding. The application validates and renders the configured URL; tests do not authenticate to a real Google account.
- Real S3 uploads, outgoing mail, OAuth providers and live Stripe subscriptions need their respective configuration and were not exercised against external accounts. Optional sidecars are not required by the default workflow.
- Composer still reports `doctrine/annotations` and `php-http/message-factory` as abandoned. They remain compatibility dependencies of the existing OpenAPI/email stack; the current locked versions have no reported vulnerability advisory. The unmodified `composer audit --locked` command therefore exits with status 2 for the two abandoned packages, not for security advisories. Replacing that stack is a separate change.

## Existing Codespace recovery — 24 October 2026

The existing Codespace `stunning-space-carnival-rxjrxxv7r4xcpgjr` was repaired in place through its configured SSH connection. No new Codespace was created.

The hosted relay returned HTTP 502 / SSH forwarding "Connection refused" while the application's local login returned HTTP 200. Removing and recreating the forwarded port temporarily restored browser access, but the next stop/start reproduced the failure. The app service now publishes `127.0.0.1:8080:8080` on the Docker host as a stable relay target. The port remains private in Codespaces. The existing devcontainer was recreated with the build cache to activate this Compose change; the named database volume was retained.

A separate start-script defect was reproduced with a non-login SSH command: Codespaces' injected name and forwarding domain were absent, causing localhost asset URLs and login redirects. The script now re-enters a login shell once to load the platform's normal environment, and refuses to start with missing forwarding metadata.

Verification on this hosted Codespace covered MySQL 8.0.46, PHP 8.3, locked Composer dependencies, all 53 migrations, HTTP login/dashboard, Chromium rendering without JavaScript errors, and Safari login/dashboard through the actual private HTTPS URL. After the Compose repair, a complete stop/start automatically ran `postStartCommand` and restored SSH and port 8080 without manually recreating the forwarding entry. The original development user and database survived. A local test business named "Codespace Entwicklung" was added for dashboard testing.

The focused HTTP end-to-end regression uses Playwright's request client and deliberately restarts the development server. It requires the seeded development account and an existing local business; it does not run the application's fixture-resetting test setup:

```bash
cd /workspace
EXPECTED_ROOTURL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}" node .devcontainer/tests/startup.cjs
```

Run that maintenance check from a Codespaces login shell after `npm ci --prefix e2e`. It first reproduced the localhost URL failure, then passed with the fix, including login, dashboard and reuse of the running server. Normal Codespace starts require no terminal command.
