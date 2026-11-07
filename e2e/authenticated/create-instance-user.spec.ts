import { randomUUID } from "crypto";
import { cacheCdn } from "../cdn";
import { dbQuery, expect, newSession, test, type Session } from "../tenants";
import { BASE_URL } from "../env";

const pagePath = "/instances/users.php";
const endpoint = "/api/instances/createUser.php";
const password = "E2E-Startpasswort-123!";
const usernameForTest = () => "crew-" + randomUUID().slice(0, 8);

async function csrf(session: Session) {
  const page = await session.page(pagePath);
  const token = page.body.match(/name="csrf_token" value="([a-f0-9]{64})"/)?.[1];
  expect(token).toBeTruthy();
  return token!;
}

test("creates a company account without email and the user can change the initial password", async ({ page, playwright, asA, tenants: { a } }, testInfo) => {
  const username = usernameForTest();
  const settings = dbQuery<{ config_key: string; config_value: string }>(
    "SELECT config_key, config_value FROM config WHERE config_key IN ('EMAILS_ENABLED', 'AUTH_SIGNUP_ENABLED', 'AUTH_NEXTHASH')",
  );
  const login = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    dbQuery("REPLACE INTO config (config_key, config_value) VALUES ('EMAILS_ENABLED', 'Enabled'), ('AUTH_SIGNUP_ENABLED', 'Disabled'), ('AUTH_NEXTHASH', 'sha256')");
    await page.context().addCookies((await asA.request.storageState()).cookies);
    await cacheCdn(page.context());
    await page.goto(pagePath);
    const card = page.getByRole("region", { name: "Neues Benutzerkonto anlegen" });
    await card.screenshot({ path: testInfo.outputPath("account-card-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await card.getByLabel("Vorname").fill("Mira");
    await card.getByLabel("Nachname").fill("König");
    await card.getByLabel("Benutzername").fill(username.toUpperCase());
    await card.getByLabel("Startpasswort").fill(password);
    await card.getByLabel("Rollengruppe").selectOption(String(a.positions.limited));
    await card.screenshot({ path: testInfo.outputPath("account-card-mobile.png") });
    await card.getByRole("button", { name: "Konto anlegen" }).click();
    await expect(page.locator("#userTable")).toContainText(username);
    await expect(page.getByText("Vorhandenen Benutzer hinzufügen", { exact: true })).toBeVisible();

    const [user] = dbQuery<{ users_userid: number; users_email: string | null; users_changepass: number; users_emailVerified: number }>(
      "SELECT users_userid, users_email, users_changepass, users_emailVerified FROM users WHERE users_username = ?", [username],
    );
    expect(user).toMatchObject({ users_email: null, users_changepass: 1, users_emailVerified: 0 });
    expect(dbQuery("SELECT instancePositions_id FROM userInstances WHERE users_userid = ?", [user.users_userid]))
      .toEqual([{ instancePositions_id: a.positions.limited }]);
    expect(dbQuery("SELECT users_userid FROM userPositions WHERE users_userid = ?", [user.users_userid])).toEqual([]);
    expect(dbQuery("SELECT analyticsEvents_id FROM analyticsEvents WHERE analyticsEvents_path = ? AND analyticsEvents_payload LIKE ?",
      [endpoint, "%" + password + "%"])).toEqual([]);

    const duplicate = await asA.api(endpoint, {
      csrf_token: await csrf(asA), company_id: a.instanceId, position: a.positions.limited, name1: "Mira", username, password,
    });
    expect(duplicate.json).toMatchObject({ result: false, error: { message: "Dieser Benutzername ist bereits vergeben." } });

    // The development site's separate access gate needs its fixture permission to reach the first-login form.
    dbQuery("INSERT INTO userPositions (users_userid, positions_id, userPositions_start)" +
      " SELECT ?, positions_id, NOW() FROM positions WHERE positions_displayName = 'E2E tenant user'", [user.users_userid]);
    const account = await newSession(login, username, password);
    expect((await account.page("/")).body).toContain('id="forcechangepass1"');
    dbQuery("UPDATE config SET config_value = 'sha512' WHERE config_key = 'AUTH_NEXTHASH'");
    const ownPassword = "E2E-Eigenes-Passwort-456!";
    expect(await (await login.post("/api/account/forcePasswordChange.php", { form: { pass: ownPassword } })).text()).toBe("1");
    expect((await account.page("/")).body).not.toContain('id="forcechangepass1"');
    await newSession(login, username, ownPassword);

    // A blank string from public signup still requires verification.
    dbQuery("UPDATE users SET users_email = '' WHERE users_userid = ?", [user.users_userid]);
    expect((await account.page("/")).body).toContain("E-Mail-Adresse bestätigen");
  } finally {
    await login.dispose();
    dbQuery("DELETE FROM config WHERE config_key IN ('EMAILS_ENABLED', 'AUTH_SIGNUP_ENABLED', 'AUTH_NEXTHASH')");
    for (const { config_key, config_value } of settings) {
      dbQuery("INSERT INTO config (config_key, config_value) VALUES (?, ?)", [config_key, config_value]);
    }
  }
});

test("rejects account creation with foreign or stronger roles, stale company context, or no capacity", async ({ asA, asLimitedA, tenants: { a, b } }) => {
  const username = usernameForTest();
  const form = { csrf_token: await csrf(asA), company_id: a.instanceId, position: a.positions.limited, name1: "Mira", username, password };
  expect((await asLimitedA.api(endpoint, form)).json).toMatchObject({ result: false, error: { code: "AUTH-ERROR" } });
  expect((await asA.api(endpoint, {}, "GET")).json).toMatchObject({ result: false, error: { code: "METHOD-ERROR" } });
  expect((await asA.api(endpoint, { ...form, company_id: b.instanceId })).json).toMatchObject({ result: false, error: { code: "CSRF-ERROR" } });
  expect((await asA.api(endpoint, { ...form, csrf_token: "invalid" })).json).toMatchObject({ result: false, error: { code: "CSRF-ERROR" } });
  expect((await asA.api(endpoint, { ...form, position: b.positions.limited })).json).toMatchObject({ result: false, error: { code: "INPUT-ERROR" } });
  expect((await asA.api(endpoint, { ...form, password: "kurz" })).json).toMatchObject({ result: false, error: { code: "INPUT-ERROR" } });

  const [{ instancePositions_actions }] = dbQuery<{ instancePositions_actions: string }>(
    "SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id = ?", [a.positions.limited],
  );
  const [{ instances_userLimit }] = dbQuery<{ instances_userLimit: number }>(
    "SELECT instances_userLimit FROM instances WHERE instances_id = ?", [a.instanceId],
  );
  try {
    dbQuery("UPDATE instancePositions SET instancePositions_actions = ? WHERE instancePositions_id = ?", [
      instancePositions_actions + ",BUSINESS:USERS:VIEW:LIST,BUSINESS:USERS:CREATE:ADD_USER_BY_EMAIL", a.positions.limited,
    ]);
    const strong = await asLimitedA.api(endpoint, { ...form, csrf_token: await csrf(asLimitedA), position: a.positions.full });
    expect(strong.json).toMatchObject({ result: false, error: { code: "INPUT-ERROR" } });
    dbQuery("UPDATE instances SET instances_userLimit = 1 WHERE instances_id = ?", [a.instanceId]);
    expect((await asA.api(endpoint, form)).json).toMatchObject({ result: false, error: { message: "Dieses Unternehmen kann keine weiteren Benutzer aufnehmen." } });
  } finally {
    dbQuery("UPDATE instancePositions SET instancePositions_actions = ? WHERE instancePositions_id = ?", [instancePositions_actions, a.positions.limited]);
    dbQuery("UPDATE instances SET instances_userLimit = ? WHERE instances_id = ?", [instances_userLimit, a.instanceId]);
  }
  expect(dbQuery("SELECT users_userid FROM users WHERE users_username = ?", [username])).toEqual([]);
});
