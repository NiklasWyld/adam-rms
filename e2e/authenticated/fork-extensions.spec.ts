import { test, expect, dbQuery, formData, succeeded, type Session } from "../tenants";

async function comment(session: Session, projectId: number, instanceId: number, text = "<p>Fork comment</p>") {
  const added = await session.api("/api/projects/newQuickComment.php", { projects_id: projectId, instances_id: instanceId, text });
  expect(added.json).toMatchObject({ result: true });
  return dbQuery<{ auditLog_id: number }>("SELECT auditLog_id FROM auditLog WHERE projects_id = ? AND auditLog_actionType = 'QUICKCOMMENT' ORDER BY auditLog_id DESC LIMIT 1", [projectId])[0].auditLog_id;
}
function row(id: number) {
  return dbQuery("SELECT * FROM auditLog WHERE auditLog_id = ?", [id])[0];
}
function config(id: number) {
  return JSON.parse(dbQuery<{ instances_calendarConfig: string }>("SELECT instances_calendarConfig FROM instances WHERE instances_id = ?", [id])[0].instances_calendarConfig);
}

test("comment authors can edit rich text and soft-delete their own comments", async ({ asLimitedA, tenants: { a } }) => {
  const id = await comment(asLimitedA, a.projectId, a.instanceId);
  expect(succeeded(await asLimitedA.api("/api/projects/editQuickComment.php", { instances_id: a.instanceId, comment_id: id, text: '<p><strong>Changed</strong><script>alert(1)</script></p>' }))).toBe(true);
  expect(row(id).auditLog_actionData).toContain("<strong>Changed</strong>");
  expect(row(id).auditLog_actionData).not.toContain("<script");
  expect(succeeded(await asLimitedA.api("/api/projects/deleteQuickComment.php", { instances_id: a.instanceId, comment_id: id }))).toBe(true);
  expect(Number(row(id).auditLog_deleted)).toBe(1);
  expect(succeeded(await asLimitedA.api("/api/projects/editQuickComment.php", { instances_id: a.instanceId, comment_id: id, text: "Restore" }))).toBe(false);
});

for (const endpoint of ["editQuickComment.php", "deleteQuickComment.php"]) {
  test(`${endpoint} refuses another business's comment`, async ({ asA, tenants: { a, b } }) => {
    dbQuery("INSERT INTO auditLog (auditLog_actionType, auditLog_actionTable, auditLog_actionData, projects_id, users_userid, auditLog_timestamp) VALUES ('QUICKCOMMENT', 'projects', 'Other business', ?, ?, NOW())", [b.projectId, b.users.full.id]);
    const id = dbQuery<{ id: number }>("SELECT MAX(auditLog_id) id FROM auditLog WHERE projects_id = ?", [b.projectId])[0].id;
    const before = row(id);
    const result = await asA.api(`/api/projects/${endpoint}`, { instances_id: a.instanceId, comment_id: id, text: "Unauthorised" });
    expect(succeeded(result)).toBe(false);
    expect(row(id)).toEqual(before);
  });
  test(`${endpoint} cannot change a non-comment audit event`, async ({ asA, tenants: { a } }) => {
    dbQuery("INSERT INTO auditLog (auditLog_actionType, auditLog_actionTable, auditLog_actionData, projects_id, users_userid, auditLog_timestamp) VALUES ('EDIT', 'projects', 'Protected history', ?, ?, NOW())", [a.projectId, a.users.full.id]);
    const id = dbQuery<{ id: number }>("SELECT MAX(auditLog_id) id FROM auditLog WHERE projects_id = ?", [a.projectId])[0].id;
    const before = row(id);
    expect(succeeded(await asA.api(`/api/projects/${endpoint}`, { instances_id: a.instanceId, comment_id: id, text: "Unauthorised" }))).toBe(false);
    expect(row(id)).toEqual(before);
  });
  test(`${endpoint} refuses a viewer editing another author's comment`, async ({ asA, asLimitedA, tenants: { a } }) => {
    const id = await comment(asA, a.projectId, a.instanceId);
    const before = row(id);
    expect(succeeded(await asLimitedA.api(`/api/projects/${endpoint}`, { instances_id: a.instanceId, comment_id: id, text: "Unauthorised" }))).toBe(false);
    expect(row(id)).toEqual(before);
    expect(succeeded(await asA.api(`/api/projects/${endpoint}`, { instances_id: a.instanceId, comment_id: id, text: "Author change" }))).toBe(true);
  });
}

test("calendar saves unchecked options, preserves extension data, and can clear the embed URL", async ({ asA, tenants: { a } }) => {
  const original = config(a.instanceId);
  const url = "https://calendar.google.com/calendar/embed?src=example%40gmail.com&ctz=Europe%2FBerlin";
  dbQuery("UPDATE instances SET instances_calendarConfig = ? WHERE instances_id = ?", [JSON.stringify({ ...original, showProjectStatus: true, showSubProjects: true, useCustomWeekNumbers: true, googleCalendarEmbedUrl: url, futureOption: "keep me" }), a.instanceId]);
  try {
    expect(succeeded(await asA.api("/api/instances/editCalendarSettings.php", { instances_id: a.instanceId, formData: formData({ defaultView: "timeGridWeek" }) }))).toBe(true);
    expect(config(a.instanceId)).toMatchObject({ showProjectStatus: false, showSubProjects: false, useCustomWeekNumbers: false, defaultView: "timeGridWeek", googleCalendarEmbedUrl: url, futureOption: "keep me" });
    expect(succeeded(await asA.api("/api/instances/editCalendarSettings.php", { instances_id: a.instanceId, formData: formData({ googleCalendarEmbedUrl: "" }) }))).toBe(true);
    expect(config(a.instanceId).googleCalendarEmbedUrl).toBeNull();
  } finally {
    dbQuery("UPDATE instances SET instances_calendarConfig = ? WHERE instances_id = ?", [JSON.stringify(original), a.instanceId]);
  }
});

for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "https://user:pass@example.com/calendar"]) {
  test(`calendar refuses unsafe embed URL: ${url.split(':')[0]}`, async ({ asA, tenants: { a } }) => {
    const before = config(a.instanceId);
    try {
      expect(succeeded(await asA.api("/api/instances/editCalendarSettings.php", { instances_id: a.instanceId, formData: formData({ googleCalendarEmbedUrl: url }) }))).toBe(false);
      expect(config(a.instanceId)).toEqual(before);
    } finally {
      dbQuery("UPDATE instances SET instances_calendarConfig = ? WHERE instances_id = ?", [JSON.stringify(before), a.instanceId]);
    }
  });
}

test("custom logo setting can be created on a fresh database", async ({ playwright }) => {
  const { BASE_URL, TEST_USER } = await import("../env");
  const { newSession } = await import("../tenants");
  const request = await playwright.request.newContext({ baseURL: BASE_URL });
  const session = await newSession(request, TEST_USER.email, TEST_USER.password);
  const existing = dbQuery("SELECT * FROM config WHERE config_key = 'PROJECT_LOGO_CUSTOM'");
  dbQuery("DELETE FROM config WHERE config_key = 'PROJECT_LOGO_CUSTOM'");
  try {
    expect(succeeded(await session.api("/api/server/configPropertyValue.php", { property_key: "PROJECT_LOGO_CUSTOM", property_value: "42" }))).toBe(true);
    expect(dbQuery("SELECT config_value FROM config WHERE config_key = 'PROJECT_LOGO_CUSTOM'")).toEqual([{ config_value: "42" }]);
  } finally {
    dbQuery("DELETE FROM config WHERE config_key = 'PROJECT_LOGO_CUSTOM'");
    if (existing.length) dbQuery("INSERT INTO config (config_key, config_value) VALUES ('PROJECT_LOGO_CUSTOM', ?)", [existing[0].config_value]);
    await request.dispose();
  }
});

test("updated spreadsheet dependency exports a readable tenant-scoped XLSX workbook", async ({ asA, tenants: { a, b } }) => {
  const { execFileSync } = await import("child_process");
  const { PHP_BINARY, APP_ENV } = await import("../env");
  const path = await import("path");
  const response = await asA.request.post('/api/assets/export.php', { form: { xlsx: '1', instances_id: String(a.instanceId) } });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('spreadsheetml.sheet');
  const workbook = await response.body();
  expect(workbook.subarray(0, 2).toString()).toBe('PK');
  const cells = execFileSync(PHP_BINARY, ['-r', `
    require 'vendor/autoload.php';
    $file = tempnam(sys_get_temp_dir(), 'adamrms-xlsx-');
    try {
      file_put_contents($file, file_get_contents('php://stdin'));
      $workbook = \\PhpOffice\\PhpSpreadsheet\\IOFactory::load($file);
      echo json_encode($workbook->getActiveSheet()->toArray());
    } finally { unlink($file); }
  `], { cwd: path.resolve(__dirname, '../..'), input: workbook, env: { ...process.env, ...APP_ENV }, encoding: 'utf8' });
  expect(cells).toContain('Asset Code');
  expect(cells).toContain(a.marker);
  expect(cells).not.toContain(b.marker);
});
