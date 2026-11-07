import { randomUUID } from "crypto";
import { cacheCdn } from "../cdn";
import { BASE_URL } from "../env";
import { dbQuery, expect, newSession, test, type Session, type Tenant } from "../tenants";

const usersPage = "/instances/users.php";
const resetEndpoint = "/api/instances/resetUserPassword.php";
const oldPassword = "E2E-Original-Startpasswort-123!";
const newPassword = "E2E-Neues-Startpasswort-456!";

async function csrf(session: Session) {
  const response = await session.page(usersPage);
  const token = response.body.match(/name="csrf_token" value="([a-f0-9]{64})"/)?.[1];
  expect(token).toBeTruthy();
  return token!;
}

async function createManagedAccount(session: Session, tenant: Tenant) {
  const username = "reset-crew-" + randomUUID().slice(0, 8);
  const response = await session.api("/api/instances/createUser.php", {
    username, name1: "Mira", name2: "König", password: oldPassword,
    company_id: tenant.instanceId, position: tenant.positions.limited, csrf_token: await csrf(session),
  });
  expect(response.json).toMatchObject({ result: true });
  const [row] = dbQuery<{ users_userid: number; users_managedByInstance_id: number }>(
    "SELECT users_userid, users_managedByInstance_id FROM users WHERE users_username = ?", [username],
  );
  expect(row.users_managedByInstance_id).toBe(tenant.instanceId);
  return { username, id: row.users_userid };
}

test("resets a managed account from the user list and revokes its previous sessions", async ({ page, playwright, asA, tenants: { a } }, testInfo) => {
  const target = await createManagedAccount(asA, a);
  const memberRequest = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    const member = await newSession(memberRequest, target.username, oldPassword);
    dbQuery("INSERT INTO passwordResetCodes (users_userid, passwordResetCodes_timestamp, passwordResetCodes_code, passwordResetCodes_valid) VALUES (?, NOW(), ?, 1)",
      [target.id, randomUUID()]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.context().addCookies((await asA.request.storageState()).cookies);
    await cacheCdn(page.context());
    await page.goto(usersPage);
    const row = page.getByRole("row").filter({ hasText: target.username });
    await row.getByRole("button", { name: "Passwort zurücksetzen" }).click();
    const modal = page.getByRole("dialog", { name: "Passwort zurücksetzen" });
    await expect(modal).toContainText(target.username);
    await modal.getByLabel("Neues Startpasswort").fill(newPassword);
    await modal.screenshot({ path: testInfo.outputPath("reset-password-mobile.png"), animations: "disabled" });
    const saved = page.waitForResponse(response => response.url().endsWith(resetEndpoint));
    await modal.getByRole("button", { name: "Passwort zurücksetzen" }).click();
    expect(await (await saved).json()).toMatchObject({ result: true });
    await expect(page.getByText("Das Passwort wurde zurückgesetzt.", { exact: true })).toBeVisible();
    expect((await member.page("/")).body).toContain("Token not found in DB");
    expect(dbQuery("SELECT authTokens_id FROM authTokens WHERE users_userid = ? AND authTokens_valid = 1", [target.id])).toEqual([]);
    expect(dbQuery("SELECT passwordResetCodes_valid FROM passwordResetCodes WHERE users_userid = ?", [target.id]))
      .toEqual([{ passwordResetCodes_valid: 0 }]);
    expect(dbQuery("SELECT analyticsEvents_id FROM analyticsEvents WHERE analyticsEvents_path = ? AND analyticsEvents_payload LIKE ?",
      [resetEndpoint, "%" + newPassword + "%"])).toEqual([]);
    const rejected = await memberRequest.post("/api/login/login.php", { form: { formInput: target.username, password: oldPassword } });
    expect(await rejected.json()).toMatchObject({ result: false });
    await newSession(memberRequest, target.username, newPassword);

    // The isolated development site needs its dev fixture role to display the first-login prompt.
    dbQuery("INSERT INTO userPositions (users_userid, positions_id, userPositions_start)" +
      " SELECT ?, positions_id, NOW() FROM positions WHERE positions_displayName = 'E2E tenant user'", [target.id]);
    expect((await member.page("/")).body).toContain('id="forcechangepass1"');
    const ownPassword = "E2E-Nach-Reset-Eigenes-Passwort-789!";
    expect(await (await memberRequest.post("/api/account/forcePasswordChange.php", { form: { pass: ownPassword } })).text()).toBe("1");
    await newSession(memberRequest, target.username, ownPassword);
  } finally {
    await memberRequest.dispose();
  }
});

test("denies resets for shared, unmanaged, foreign and stronger accounts", async ({ asA, asLimitedA, tenants: { a, b } }) => {
  const target = await createManagedAccount(asA, a);
  const form = { company_id: a.instanceId, csrf_token: await csrf(asA), user_id: target.id, password: newPassword };
  const denied = { result: false, error: { code: "AUTH-ERROR" } };
  expect((await asLimitedA.api(resetEndpoint, form)).json).toMatchObject(denied);
  expect((await asA.api(resetEndpoint, { ...form, csrf_token: "invalid" })).json)
    .toMatchObject({ result: false, error: { code: "CSRF-ERROR" } });
  expect((await asA.api(resetEndpoint, { ...form, user_id: b.users.full.id })).json).toMatchObject(denied);
  dbQuery("INSERT INTO userInstances (users_userid, instancePositions_id, userInstances_archived) VALUES (?, ?, NOW() - INTERVAL 1 DAY)",
    [target.id, b.positions.limited]);
  expect((await asA.api(resetEndpoint, form)).json).toMatchObject(denied);
  dbQuery("UPDATE userInstances SET userInstances_deleted = 1 WHERE users_userid = ? AND instancePositions_id = ?",
    [target.id, b.positions.limited]);

  dbQuery("UPDATE users SET users_managedByInstance_id = NULL WHERE users_userid = ?", [target.id]);
  expect((await asA.api(resetEndpoint, form)).json).toMatchObject(denied);
  dbQuery("UPDATE users SET users_managedByInstance_id = ? WHERE users_userid = ?", [a.instanceId, target.id]);
  dbQuery("INSERT INTO userPositions (users_userid, positions_id, userPositions_start)" +
    " SELECT ?, positions_id, NOW() FROM positions WHERE positions_displayName = 'E2E tenant user'", [target.id]);
  expect((await asA.api(resetEndpoint, form)).json).toMatchObject(denied);
  dbQuery("DELETE FROM userPositions WHERE users_userid = ?", [target.id]);

  const [role] = dbQuery<{ instancePositions_actions: string }>(
    "SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id = ?", [a.positions.limited],
  );
  try {
    dbQuery("UPDATE instancePositions SET instancePositions_actions = ? WHERE instancePositions_id = ?", [
      role.instancePositions_actions + ",BUSINESS:USERS:VIEW:LIST,BUSINESS:USERS:CREATE:ADD_USER_BY_EMAIL,BUSINESS:USERS:EDIT:CHANGE_ROLE",
      a.positions.limited,
    ]);
    dbQuery("UPDATE userInstances SET userInstances_extraPermissions = 'BUSINESS:USERS:DELETE:REMOVE_FORM_BUSINESS' WHERE users_userid = ? AND instancePositions_id = ?",
      [target.id, a.positions.limited]);
    expect((await asLimitedA.api(resetEndpoint, { ...form, csrf_token: await csrf(asLimitedA) })).json).toMatchObject(denied);
  } finally {
    dbQuery("UPDATE instancePositions SET instancePositions_actions = ? WHERE instancePositions_id = ?", [role.instancePositions_actions, a.positions.limited]);
  }
});
