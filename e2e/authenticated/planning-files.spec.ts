import { test, expect, dbQuery, succeeded, type Session } from "../tenants";
import { cacheCdn } from "../cdn";

test.skip(process.env.E2E_PLANNING_S3 !== "1", "Use npm run test:planning to start the disposable S3 integration fixture.");

const storageKeys = ["FILES_ENABLED", "AWS_S3_KEY", "AWS_S3_SECRET", "AWS_S3_BUCKET", "AWS_S3_SERVER_ENDPOINT", "AWS_S3_BROWSER_ENDPOINT", "AWS_S3_ENDPOINT_PATHSTYLE", "AWS_S3_REGION"];
let originalConfig: any[] = [];
test.beforeAll(() => {
  originalConfig = dbQuery("SELECT config_key,config_value FROM config WHERE config_key IN (" + storageKeys.map(() => "?").join(",") + ")", storageKeys);
  const values: Record<string, string> = { FILES_ENABLED: "Enabled", AWS_S3_KEY: "planning-test", AWS_S3_SECRET: "planning-test-secret",
    AWS_S3_BUCKET: "planning-e2e", AWS_S3_SERVER_ENDPOINT: "http://127.0.0.1:19090", AWS_S3_BROWSER_ENDPOINT: "http://127.0.0.1:19090",
    AWS_S3_ENDPOINT_PATHSTYLE: "Enabled", AWS_S3_REGION: "us-east-1" };
  for (const [key, value] of Object.entries(values)) dbQuery("REPLACE INTO config (config_key,config_value) VALUES (?,?)", [key, value]);
});
test.afterAll(() => {
  dbQuery("DELETE FROM config WHERE config_key IN (" + storageKeys.map(() => "?").join(",") + ")", storageKeys);
  for (const row of originalConfig) dbQuery("INSERT INTO config (config_key,config_value) VALUES (?,?)", [row.config_key, row.config_value]);
});
const signing = "/api/s3files/generateSignatureUppy.php", registering = "/api/s3files/uploadSuccess.php";
async function csrf(session: Session, id: number) {
  const response = await session.page("/project/?id=" + id);
  const token = response.body.match(/planningCsrf: "([a-f0-9]+)"/);
  expect(token, response.body.slice(-500)).toBeTruthy();
  return token![1];
}
async function signature(session: Session, id: number, category: string, name: string, extra: any = {}) {
  return session.api(signing, { planningCsrf: await csrf(session, id), planningCategory: category, typeid: 7, subtype: id,
    filename: name, contentType: name.endsWith(".pdf") ? "application/pdf" : "application/json", size: 256, ...extra });
}
test("planning uploads use the real S3 signing, byte transfer and shared project-file records", async ({ page, asA, tenants }) => {
  const id = tenants.a.projectId;
  const storage = dbQuery<any>("SELECT instances_storageEnabled FROM instances WHERE instances_id=?", [tenants.a.instanceId])[0];
  const projectType = dbQuery<any>("SELECT projectsTypes_config_files FROM projectsTypes WHERE projectsTypes_id=?", [tenants.a.projectTypeId])[0];
  try {
    dbQuery("UPDATE instances SET instances_storageEnabled=1 WHERE instances_id=?", [tenants.a.instanceId]);
    dbQuery("UPDATE projectsTypes SET projectsTypes_config_files=1 WHERE projectsTypes_id=?", [tenants.a.projectTypeId]);
    for (const category of ["stage", "shift"]) {
      const ext = category === "stage" ? "pdf" : "gantt", original = "Planning " + category + "." + ext;
      const name = "uploads/PROJECT-FILE/" + Date.now() + "-1234." + ext;
      const signed = await signature(asA, id, category, name);
      expect(signed.json?.method, signed.body).toBe("PUT");
      const bytes = ext === "pdf" ? Buffer.from("%PDF-1.4\nPlanning file test\n%%EOF") : Buffer.from('{"tasks":[{"id":1,"text":"Soundcheck"}]}');
      const stored = await asA.request.put(signed.json.url, { headers: signed.json.headers, data: bytes });
      expect(stored.ok(), await stored.text()).toBe(true);
      const registration = await asA.api(registering, { planningCsrf: await csrf(asA, id), planningCategory: category,
        typeid: 7, subtype: id, name, originalName: original, size: bytes.length, public: 1 });
      expect(registration.json?.result, registration.body).toBe(true);
      const fileId = registration.json.response.id;
      const record = dbQuery<any>("SELECT * FROM s3files WHERE s3files_id=?", [fileId])[0];
      expect(record.instances_id).toBe(tenants.a.instanceId);
      expect(record.s3files_meta_subType).toBe(id);
      expect(record.s3files_meta_type).toBe(7);
      expect(record.s3files_meta_public).toBe(0);
      expect(record.s3files_planningCategory).toBe(category);
      const url = await asA.api("/api/file/", { f: fileId });
      expect(url.json?.result, url.body).toBe(true);
      expect(await (await asA.request.get(url.json.response.url)).body()).toEqual(bytes);
      await page.context().addCookies((await asA.request.storageState()).cookies);
      await cacheCdn(page.context());
      await page.goto("/project/?id=" + id + "&planning-check=" + Date.now() + "#" + category + "-planning-view");
      await expect(page.locator("#" + category + "-planning-files .fileBox[data-s3fileid='" + fileId + "']")).toBeVisible();
      await expect(page.locator("#projectFilesModal .fileBox[data-s3fileid='" + fileId + "']")).toHaveCount(1);
      expect(await page.locator("#" + (category === "stage" ? "shift" : "stage") + "-planning-files .fileBox[data-s3fileid='" + fileId + "']").count()).toBe(0);
      const renamed = await asA.api("/api/file/rename.php", { s3files_id: fileId, s3files_name: "Renamed planning file" });
      expect(succeeded(renamed)).toBe(true);
      const deleted = await asA.api("/api/file/delete.php", { s3files_id: fileId });
      expect(succeeded(deleted)).toBe(true);
      await page.reload();
      expect(await page.locator(".fileBox[data-s3fileid='" + fileId + "']").count()).toBe(0);
    }
  } finally {
    dbQuery("UPDATE instances SET instances_storageEnabled=? WHERE instances_id=?", [storage.instances_storageEnabled, tenants.a.instanceId]);
    dbQuery("UPDATE projectsTypes SET projectsTypes_config_files=? WHERE projectsTypes_id=?", [projectType.projectsTypes_config_files, tenants.a.projectTypeId]);
  }
});

test("planning uploads reject other businesses, permissions, forged CSRF, unknown categories and unsupported extensions", async ({ asA, asLimitedA, tenants }) => {
  const id = tenants.a.projectId, name = "uploads/PROJECT-FILE/123-456.pdf";
  for (const extra of [
    { planningCsrf: "forged" }, { planningCategory: "unknown" }, { typeid: 4 },
    { subtype: tenants.b.projectId }, { filename: "uploads/PROJECT-FILE/123-456.exe" }
  ]) {
    const response = await signature(asA, id, "stage", name, extra);
    expect(response.json?.result, response.body).toBe(false);
    expect(response.json?.url).toBeUndefined();
  }
  const token = await csrf(asA, id);
  const denied = await asLimitedA.api(signing, { planningCsrf: token, planningCategory: "stage", typeid: 7, subtype: id, filename: name, contentType: "application/pdf" });
  expect(denied.json?.result).toBe(false);
  expect(denied.json.error.code).toBe("AUTH-ERROR");
});

test("multiple files uploaded through Uppy are all registered before the tab refreshes", async ({ page, asA, tenants }) => {
  const id = tenants.a.projectId, instance = tenants.a.instanceId;
  const old = dbQuery<any>("SELECT instances_storageEnabled FROM instances WHERE instances_id=?", [instance])[0].instances_storageEnabled;
  const oldType = dbQuery<any>("SELECT projectsTypes_config_files FROM projectsTypes WHERE projectsTypes_id=?", [tenants.a.projectTypeId])[0].projectsTypes_config_files;
  try {
    dbQuery("UPDATE instances SET instances_storageEnabled=1 WHERE instances_id=?", [instance]);
    dbQuery("UPDATE projectsTypes SET projectsTypes_config_files=1 WHERE projectsTypes_id=?", [tenants.a.projectTypeId]);
    await page.context().addCookies((await asA.request.storageState()).cookies);
    await cacheCdn(page.context());
    await page.route("http://127.0.0.1:19090/**", route => route.continue());
    const suffix = Date.now().toString();
    await page.goto("/project/?id=" + id + "#shift-planning-view");
    const panel = page.locator("#shift-planning-files");
    await panel.locator('input[type=file]').first().setInputFiles([
      { name: "First-" + suffix + ".gantt", mimeType: "application/json", buffer: Buffer.from('{"data":[]}') },
      { name: "Second-" + suffix + ".gantt", mimeType: "application/json", buffer: Buffer.from('{"data":[]}') }
    ]);
    await panel.getByRole("button", { name: /Upload 2 files/ }).click();
    await page.waitForEvent("load");
    await expect(panel).toContainText("First-" + suffix);
    await expect(panel).toContainText("Second-" + suffix);
    const files = dbQuery<any>("SELECT s3files_id FROM s3files WHERE instances_id=? AND s3files_original_name IN (?,?)",
      [instance, "First-" + suffix + ".gantt", "Second-" + suffix + ".gantt"]);
    expect(files).toHaveLength(2);
    for (const file of files) {
      await expect(page.locator("#projectFilesModal .fileBox[data-s3fileid='" + file.s3files_id + "']")).toHaveCount(1);
      await asA.api("/api/file/delete.php", { s3files_id: file.s3files_id });
    }
  } finally {
    dbQuery("UPDATE instances SET instances_storageEnabled=? WHERE instances_id=?", [old, instance]);
    dbQuery("UPDATE projectsTypes SET projectsTypes_config_files=? WHERE projectsTypes_id=?", [oldType, tenants.a.projectTypeId]);
  }
});
