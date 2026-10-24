import fs from "fs";
import { execFileSync } from "child_process";
import { test, expect, dbQuery, succeeded, newSession, Session } from "../tenants";
import { cacheCdn } from "../cdn";
import { BASE_URL } from "../env";

const endpoint = "/api/projects/channelPlanning.php";
const blank = () => ({ scene: "", label: "", connection: "", notes: "" });
async function read(session: Session, id: number) {
  const response = await session.api(endpoint, { projects_id: id }, "GET");
  expect(response.json?.result, response.body).toBe(true);
  return response.json.response;
}
function configured(current: any, inputs = 32, outputs = 10) {
  return { revision: current.revision, inputCount: inputs, outputCount: outputs, outputLabels: "alphabetic",
    inputs: Array.from({ length: inputs }, () => [blank()]), outputs: Array.from({ length: outputs }, () => [blank()]) };
}
async function save(session: Session, id: number, plan: any, extra: Record<string, any> = {}) {
  const state = await read(session, id);
  return session.api(endpoint, { action: "save", projects_id: id, csrf: state.csrf, plan: JSON.stringify(plan), confirmReduction: "1", ...extra });
}
async function reset(session: Session, id: number, inputs = 32, outputs = 10) {
  const plan = configured((await read(session, id)).plan, inputs, outputs);
  const result = await save(session, id, plan);
  expect(result.json?.result, result.body).toBe(true);
  return result.json.response.plan;
}
async function browser(page: any, session: Session) {
  await page.context().addCookies((await session.request.storageState()).cookies);
  await cacheCdn(page.context());
}

test("channel plans persist settings and multiple uses, and stay independent between projects", async ({ asA, tenants }) => {
  const id = tenants.a.projectId;
  let plan = await reset(asA, id);
  plan.inputs[0] = [
    { scene: "Bigband", label: "Bassgitarre", connection: "DI-Box", notes: "Bühne links ÄÖÜ ß" },
    { scene: "Chor", label: "Mikro Mitte Links", connection: "", notes: "" },
    { scene: "Theater", label: "Headset Schauspieler 1", connection: "Funk", notes: "" }
  ];
  plan.outputs[0][0] = { scene: "", label: "Main L", connection: "PA links", notes: "Prüfen" };
  const before = (await read(asA, tenants.a.subProjectId)).plan;
  expect(succeeded(await save(asA, id, plan))).toBe(true);
  const persisted = (await read(asA, id)).plan;
  expect(persisted.inputCount).toBe(32);
  expect(persisted.outputCount).toBe(10);
  expect(persisted.inputs[0]).toEqual(plan.inputs[0]);
  expect(persisted.outputs[0]).toEqual(plan.outputs[0]);
  expect(persisted.revision).toBe(plan.revision + 1);
  expect((await read(asA, tenants.a.subProjectId)).plan).toEqual(before);
  expect(dbQuery("SELECT * FROM projectChannelPlans WHERE projects_id=? AND instances_id=?", [id, tenants.a.instanceId])).toHaveLength(1);
});

test("reductions require confirmation; stale revisions, malformed counts, arrays and oversized fields cannot overwrite saved data", async ({ asA, tenants }) => {
  const id = tenants.a.projectId;
  let plan = await reset(asA, id, 3, 2);
  plan.inputs[2][0].label = "Keep me";
  expect(succeeded(await save(asA, id, plan))).toBe(true);
  plan = (await read(asA, id)).plan;
  const reduced = { ...plan, inputCount: 1, inputs: plan.inputs.slice(0, 1) };
  const denied = await save(asA, id, reduced, { confirmReduction: "0" });
  expect(denied.json.error.code).toBe("CONFIRM-REDUCTION");
  expect((await read(asA, id)).plan.inputs[2][0].label).toBe("Keep me");
  expect(succeeded(await save(asA, id, reduced))).toBe(true);
  expect((await read(asA, id)).plan.inputCount).toBe(1);
  const stale = await save(asA, id, plan);
  expect(stale.json.error.code).toBe("CONFLICT");
  plan = (await read(asA, id)).plan;
  for (const invalid of [
    { ...plan, inputCount: -1 }, { ...plan, inputCount: 513 }, { ...plan, outputCount: 257 },
    { ...plan, inputCount: "1 OR 1=1" }, { ...plan, outputLabels: "<script>" },
    { ...plan, inputs: [] }, { ...plan, inputs: [[{ label: [] }]] },
    { ...plan, inputs: [[{ label: "x".repeat(4001) }]] },
    { ...plan, inputs: [[{ label: "bad\u0000text" }]] }
  ]) expect(succeeded(await save(asA, id, invalid))).toBe(false);
  expect((await read(asA, id)).plan).toEqual(plan);
});

test("tenant isolation, CSRF, methods, view and edit permissions apply to the API and export", async ({ asA, asLimitedA, tenants, playwright }) => {
  const id = tenants.a.projectId, foreign = tenants.b.projectId;
  const foreignBefore = dbQuery("SELECT * FROM projectChannelPlans WHERE projects_id=?", [foreign]);
  expect(succeeded(await asA.api(endpoint, { projects_id: foreign }, "GET"))).toBe(false);
  expect((await asA.page("/project/channelPlanningExport.php?id=" + foreign)).body).not.toContain("channel-pdf-data");
  const plan = await reset(asA, id, 2, 1);
  expect(succeeded(await asA.api(endpoint, { action: 'save', projects_id: foreign, csrf: (await read(asA, id)).csrf, plan: JSON.stringify(plan) }))).toBe(false);
  expect(succeeded(await asLimitedA.api(endpoint, { action: 'save', projects_id: id, plan: JSON.stringify(plan), csrf: 'forged' }))).toBe(false);
  expect(succeeded(await save(asA, id, plan, { csrf: "forged" }))).toBe(false);
  expect(succeeded(await asA.api(endpoint, { action: "save", projects_id: id, plan: JSON.stringify(plan) }, "GET"))).toBe(false);
  expect(succeeded(await asA.api(endpoint, { projects_id: "1 OR 1=1" }, "GET"))).toBe(false);
  const unauth = await playwright.request.newContext({ baseURL: BASE_URL });
  expect(succeeded(await new Session(unauth).api(endpoint, { projects_id: id }, "GET"))).toBe(false);
  await unauth.dispose();
  expect(dbQuery("SELECT * FROM projectChannelPlans WHERE projects_id=?", [foreign])).toEqual(foreignBefore);
  const role = tenants.a.positions.limited;
  const original = dbQuery<any>("SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?", [role])[0].instancePositions_actions;
  try {
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", ["PROJECTS:VIEW", role]);
    expect(succeeded(await asLimitedA.api(endpoint, { projects_id: id }, "GET"))).toBe(true);
    expect((await asLimitedA.page("/project/channelPlanningExport.php?id=" + id)).body).toContain("channel-pdf-data");
    dbQuery("UPDATE instancePositions SET instancePositions_actions='' WHERE instancePositions_id=?", [role]);
    expect(succeeded(await asLimitedA.api(endpoint, { projects_id: id }, "GET"))).toBe(false);
    expect((await asLimitedA.page("/project/channelPlanningExport.php?id=" + id)).body).not.toContain("channel-pdf-data");
  } finally { dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [original, role]); }
});

test("shared-user instance switching and archived or deleted projects cannot leak or change channel plans", async ({ playwright, tenants, asA }) => {
  const request = await playwright.request.newContext({ baseURL: BASE_URL });
  const shared = await newSession(request, tenants.sharedUser.email, tenants.password);
  try {
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.a.instanceId, projects_id: tenants.a.projectId }, "GET"))).toBe(true);
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.b.instanceId, projects_id: tenants.a.projectId }, "GET"))).toBe(false);
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.b.instanceId, projects_id: tenants.b.projectId }, "GET"))).toBe(true);
  } finally { await request.dispose(); }
  const id = tenants.a.projectId;
  const plan = await reset(asA, id, 1, 1);
  try {
    dbQuery("UPDATE projects SET projects_archived=1 WHERE projects_id=?", [id]);
    expect(succeeded(await save(asA, id, plan))).toBe(false);
    expect(succeeded(await asA.api(endpoint, { projects_id: id }, "GET"))).toBe(true);
    dbQuery("UPDATE projects SET projects_deleted=1 WHERE projects_id=?", [id]);
    expect(succeeded(await asA.api(endpoint, { projects_id: id }, "GET"))).toBe(false);
    expect((await asA.page("/project/channelPlanningExport.php?id=" + id)).body).not.toContain("channel-pdf-data");
  } finally { dbQuery("UPDATE projects SET projects_archived=0,projects_deleted=0 WHERE projects_id=?", [id]); }
});

test("browser configuration, autosave, uses, numbering, filtering and reload preserve edits", async ({ page, asA, tenants }) => {
  const id = tenants.a.projectId;
  await reset(asA, id, 2, 28);
  await browser(page, asA);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/project/?id=" + id + "#channel-planning-view");
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await expect(page.locator("#channel-tables tr[data-kind=outputs]")).toHaveCount(28);
  await expect(page.locator("#channel-tables tr[data-kind=outputs]").last()).toContainText("AB");
  await page.getByLabel("CH1 use 1 label", { exact: true }).fill("Bassgitarre");
  await page.getByLabel("CH1 use 1 scene", { exact: true }).fill("Bigband");
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Add use to CH1", exact: true }).click();
  await page.getByLabel("CH1 use 2 scene", { exact: true }).fill("Chor");
  await page.getByLabel("CH1 use 2 label", { exact: true }).fill("Mikro Mitte Links");
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByLabel("CH1 use 2 label", { exact: true })).toHaveValue("Mikro Mitte Links");
  await page.locator("#channel-search").fill("Chor");
  await expect(page.locator("#channel-tables tr[data-channel]:visible")).toHaveCount(1);
  await page.locator("#channel-search").fill("no such channel");
  await expect(page.locator("#channel-no-results")).toBeVisible();
  await page.locator("#channel-search").fill("");
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.locator("#channel-output-labels").selectOption("numeric");
  await page.getByRole("button", { name: "Apply configuration" }).click();
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await expect(page.locator("#channel-tables tr[data-kind=outputs]").last()).toContainText("OUT28");
  await page.screenshot({ path: "test-results/channel-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("browser requires explicit confirmation for populated reductions and handles failed saves and conflicts honestly", async ({ page, asA, tenants }) => {
  const id = tenants.a.projectId;
  let plan = await reset(asA, id, 3, 1);
  plan.inputs[2][0].label = "Do not lose";
  expect(succeeded(await save(asA, id, plan))).toBe(true);
  await browser(page, asA);
  await page.goto("/project/?id=" + id + "#channel-planning-view");
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await page.getByRole("button", { name: "Configuration", exact: true }).click();
  await page.locator("#channel-input-count").fill("1");
  page.once("dialog", d => d.dismiss());
  await page.getByRole("button", { name: "Apply configuration" }).click();
  expect((await read(asA, id)).plan.inputCount).toBe(3);
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Apply configuration" }).click();
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  expect((await read(asA, id)).plan.inputCount).toBe(1);
  await page.route("**/api/projects/channelPlanning.php", route => route.abort());
  await page.getByLabel("CH1 use 1 label", { exact: true }).fill("Keep local");
  await expect(page.locator("#channel-error")).toBeVisible();
  await expect(page.locator("#channel-save-status")).not.toHaveText("Saved");
  await expect(page.locator("#channel-export")).toBeDisabled();
  await expect(page.getByLabel("CH1 use 1 label", { exact: true })).toHaveValue("Keep local");
  await page.unroute("**/api/projects/channelPlanning.php");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  plan = (await read(asA, id)).plan;
  plan.inputs[0][0].label = "Other editor";
  expect(succeeded(await save(asA, id, plan))).toBe(true);
  await page.getByLabel("CH1 use 1 label", { exact: true }).fill("My local edit");
  await expect(page.locator("#channel-error")).toContainText("another tab");
  await expect(page.getByLabel("CH1 use 1 label", { exact: true })).toHaveValue("My local edit");
  expect((await read(asA, id)).plan.inputs[0][0].label).toBe("Other editor");
  // Avoid the intentional beforeunload guard when closing this test's context.
  await page.evaluate(() => { window.onbeforeunload = null; });
});

test("mobile channel editing and untrusted text remain safe in both table and PDF", async ({ page, asA, tenants }) => {
  const id = tenants.a.projectId, payload = '</script><script>window.channelXss=true</script><img src=x onerror="window.channelXss=true">';
  const plan = await reset(asA, id, 1, 1);
  plan.inputs[0][0].label = payload;
  expect(succeeded(await save(asA, id, plan))).toBe(true);
  await browser(page, asA);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/project/?id=" + id + "#channel-planning-view");
  await expect(page.getByLabel("CH1 use 1 label", { exact: true })).toHaveValue(payload);
  expect(await page.evaluate(() => (window as any).channelXss)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/channel-mobile.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.goto("/project/channelPlanningExport.php?id=" + id);
  await download;
  expect(await page.evaluate(() => (window as any).channelXss)).toBeUndefined();
});

test("stage and shift tabs use clear external fallbacks and preserve the normal project file controls", async ({ page, asA, tenants }) => {
  await browser(page, asA);
  await page.goto("/project/?id=" + tenants.a.projectId + "#stage-planning-view");
  await expect(page.locator("#stage-planning-view")).toBeVisible();
  await expect(page.locator("#stage-planning-view")).toContainText("does not allow");
  await expect(page.locator("#stage-planning-view a[target=_blank]").first()).toHaveAttribute("href", "https://ridermaker.com");
  await page.locator('#nav-bar a[href="#shift-planning-view"]').click();
  await expect(page.locator("#shift-planning-view")).toContainText("Pro subscription");
  await expect(page.locator("#shift-planning-view a[target=_blank]").first()).toHaveAttribute("href", "https://www.onlinegantt.com/#/gantt");
  expect(await page.locator('iframe[src*="ridermaker"],iframe[src*="onlinegantt"]').count()).toBe(0);
  await page.screenshot({ path: "test-results/shift-planning.png", fullPage: true });
});

for (const count of [0, 32, 70]) {
  test("real A4 PDF includes all " + count + " channels, multiple uses, Unicode and long text", async ({ page, asA, tenants }, testInfo) => {
    test.setTimeout(120_000);
    const id = tenants.a.projectId;
    let plan = await reset(asA, id, count, 10);
    for (let n = 0; n < count; n++) plan.inputs[n][0] = { scene: "Bigband", label: "Signal " + (n + 1) + " Bühne ÄÖÜ ß", connection: "DI-Box",
      notes: n === 0 ? "Längere Notizen für Bühne und Übertragung. ".repeat(90) : n === 1 ? "X".repeat(3500) : "Notiz" };
    if (count) plan.inputs[0].push({ scene: "Chor", label: "Mikro Mitte Links", connection: "Mikrofon", notes: "Schüler" });
    plan.outputs[9][0] = { scene: "", label: "Monitor 10", connection: "Bühnenmonitor", notes: "Letzter Ausgang" };
    const saved = await save(asA, id, plan);
    expect(saved.json?.result, saved.body).toBe(true);
    await browser(page, asA);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const downloaded = page.waitForEvent("download");
    await page.goto("/project/channelPlanningExport.php?id=" + id);
    const file = testInfo.outputPath("channel-" + count + ".pdf");
    await (await downloaded).saveAs(file);
    expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(page.locator("#channel-pdf-error")).toBeEmpty();
    const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/\u200b/g, "");
    expect(text).toContain("Channel Planning");
    expect(text).toContain("Inputs (" + count + ")");
    expect(text).toContain("Outputs (10)");
    expect(text).toContain("Monitor 10");
    expect(text).toContain("Letzter Ausgang");
    if (count) {
      expect(text).toContain("Bühne ÄÖÜ ß");
      expect(text).toContain("Chor");
      expect(text).toContain("CH" + count);
      expect((text.match(/X/g) || []).length).toBe(3500);
      expect((text.match(/Längere/g) || []).length).toBe(90);
    }
    if (count === 70) expect(text.match(/Connection \/ source/g)!.length).toBeGreaterThan(2);
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    expect(info).toContain("841.89 x 595.28 pts (A4)");
    expect(errors).toEqual([]);
    await testInfo.attach("Channel PDF", { path: file, contentType: "application/pdf" });
  });
}

test("first opening configures a new project and viewers can read without editing", async ({ page, asA, asLimitedA, tenants }) => {
  const created = await asA.api("/api/projects/new.php", { instances_id: tenants.a.instanceId, projects_name: "First channel plan",
    projects_manager: tenants.a.users.full.id, projectsType_id: tenants.a.projectTypeId });
  expect(created.json?.result, created.body).toBe(true);
  const id = created.json.response.projects_id;
  expect((await read(asA, id)).plan.configured).toBe(false);
  await browser(page, asA);
  await page.goto("/project/?id=" + id + "#channel-planning-view");
  await expect(page.locator("#channel-config")).toBeVisible();
  await expect(page.locator("#channel-export")).toBeDisabled();
  await page.locator("#channel-input-count").fill("4");
  await page.locator("#channel-output-count").fill("2");
  await page.getByRole("button", { name: "Apply configuration" }).click();
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await expect(page.locator("#channel-tables tr[data-kind=inputs]")).toHaveCount(4);
  await expect(page.locator("#channel-tables tr[data-kind=outputs]")).toHaveCount(2);
  await page.context().clearCookies();
  await page.context().addCookies((await asLimitedA.request.storageState()).cookies);
  await page.reload();
  await expect(page.locator("#channel-save-status")).toHaveText("Saved");
  await expect(page.locator("#channel-configuration")).toBeDisabled();
  await expect(page.getByLabel("CH1 use 1 label", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.locator("#channel-export")).toBeEnabled();
  expect(await page.getByRole("button", { name: "Add use to CH1", exact: true }).count()).toBe(0);
});

for (const count of [0, 32, 70]) {
  test("one-sheet export fits all " + count + " inputs and outputs onto one portrait A4 page", async ({ page, asA, tenants }, testInfo) => {
    test.setTimeout(120_000);
    const id = tenants.a.projectId, plan = await reset(asA, id, count, 10);
    for (let n = 0; n < count; n++) plan.inputs[n][0] = { scene: "Bigband", label: "Signal " + (n + 1) + " Bühne ÄÖÜ ß",
      connection: "Anschluss-" + (n + 1), notes: count === 70 && n === 0 ? "Längere Notizen für Bühne und Übertragung. ".repeat(90) :
        count === 70 && n === 1 ? "X".repeat(3500) : "Notiz-" + (n + 1) };
    if (count) plan.inputs[0].push({ scene: "Chor", label: "Mikro Mitte Links", connection: "Mikrofon", notes: "Schüler" });
    plan.outputs[0][0] = { scene: "", label: "Main L", connection: "PA links", notes: "Ausgang prüfen" };
    plan.outputs[9][0] = { scene: "Theater", label: "Monitor 10", connection: "Bühnenmonitor", notes: "Letzter Ausgang" };
    const saved = await save(asA, id, plan);
    expect(saved.json?.result, saved.body).toBe(true);
    await browser(page, asA);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const downloaded = page.waitForEvent("download");
    await page.goto("/project/channelPlanningExport.php?id=" + id + "&layout=single");
    const file = testInfo.outputPath("channel-single-" + count + ".pdf");
    await (await downloaded).saveAs(file);
    const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    expect(info).toMatch(/Pages:\s+1\b/);
    expect(info).toContain("595.28 x 841.89 pts (A4)");
    const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/\u200b/g, "");
    expect(text).toContain("Inputs (" + count + ")");
    expect(text).toContain("Outputs (10)");
    expect(text).toContain("Main L");
    expect(text).toContain("Letzter Ausgang");
    if (count) {
      expect(text).toContain("CH" + count);
      expect(text).toContain("Anschluss-" + count);
      expect(text).toContain("Notiz-" + count);
      expect(text).toContain("Chor");
      expect(text).toContain("Schüler");
    }
    if (count === 70) {
      expect((text.match(/X/g) || []).length).toBe(3500);
      expect((text.match(/Längere/g) || []).length).toBe(90);
    }
    await expect(page.locator("#channel-pdf-error")).toBeEmpty();
    expect(errors).toEqual([]);
    await testInfo.attach("One-sheet PDF", { path: file, contentType: "application/pdf" });
    if (count === 32) {
      // Switching layouts must replace the ready download, preserving the detailed export.
      await page.getByLabel("PDF layout", { exact: true }).selectOption("detail");
      await expect(page.locator("#channel-pdf-status")).toHaveText("Your detailed PDF is ready.");
      const detail = page.waitForEvent("download");
      await page.locator("#channel-pdf-download").click();
      const detailFile = testInfo.outputPath("channel-detail-after-single.pdf");
      await (await detail).saveAs(detailFile);
      const detailInfo = execFileSync("pdfinfo", [detailFile], { encoding: "utf8" });
      expect(detailInfo).toContain("841.89 x 595.28 pts (A4)");
      expect(detailInfo).not.toMatch(/Pages:\s+1\b/);
      await testInfo.attach("Detailed PDF", { path: detailFile, contentType: "application/pdf" });
      await page.goto("/project/?id=" + id + "#channel-planning-view");
      await expect(page.locator("#channel-save-status")).toHaveText("Saved");
      await page.getByLabel("PDF layout", { exact: true }).selectOption("single");
      const popupPromise = page.context().waitForEvent("page");
      await page.locator("#channel-export").click();
      const popup = await popupPromise;
      await popup.waitForURL(/layout=single/);
      await expect(popup.locator("#channel-pdf-layout")).toHaveValue("single");
      await expect(popup.locator("#channel-pdf-status")).toHaveText("Your one-page A4 portrait PDF is ready.");
      await popup.close();
    }
  });
}
