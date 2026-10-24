import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { test, expect, dbQuery, succeeded, newSession, type Session } from "../tenants";
import { cacheCdn } from "../cdn";
import { APP_ENV, BASE_URL, PHP_BINARY } from "../env";

const endpoint = "/api/shoppingLists/action.php";
async function token(session: Session) {
  const response = await session.api(endpoint, {}, "GET");
  expect(response.json?.result, response.body).toBe(true);
  return response.json.response.csrf as string;
}
async function mutate(session: Session, action: string, data: Record<string, any> = {}) {
  return session.api(endpoint, { csrf: await token(session), action, ...data });
}
async function create(session: Session, name = "Procurement ÄÖÜ ß", extra: Record<string, any> = {}) {
  const response = await mutate(session, "saveList", { name, status: "draft", ...extra });
  expect(response.json?.result, response.body).toBe(true);
  return response.json.response.id as number;
}
async function document(session: Session, id: number) {
  const response = await session.api(endpoint, { id }, "GET");
  expect(response.json?.result, response.body).toBe(true);
  return response.json.response.data;
}
const item = { name: "Allen & Heath AR2412 Stagebox", quantity: "1", unitPrice: "999.99", priority: "high", status: "planned",
  reason: "Ermöglicht die digitale Signalübertragung zwischen Bühne und Mischpult.", unit: "pcs" };
async function add(session: Session, id: number, extra: Record<string, any> = {}) {
  const response = await mutate(session, "saveItem", { id, ...item, ...extra });
  expect(response.json?.result, response.body).toBe(true);
  return (await document(session, id)).items.at(-1);
}
async function browserSession(page: any, session: Session) {
  await page.context().addCookies((await session.request.storageState()).cookies);
  await cacheCdn(page.context());
}
const inventorySnapshot = () => ["assets", "assetTypes", "assetsAssignments", "projectsFinanceCache"].map(table => dbQuery("SELECT * FROM " + table));

test("shopping lists create, edit, duplicate, archive and soft-delete without touching inventory", async ({ asA }) => {
  const before = inventorySnapshot();
  const id = await create(asA, "Independent procurement", { description: "Description", budget: "1500.00", comment: "Committee comment" });
  const added = await add(asA, id);
  const updated = await mutate(asA, "saveList", { id, name: "Updated procurement", description: "Persisted", status: "active", budget: "2000.00", comment: "Kept comment" });
  expect(succeeded(updated)).toBe(true);
  let saved = await document(asA, id);
  expect(saved).toMatchObject({ shoppingLists_name: "Updated procurement", shoppingLists_description: "Persisted", shoppingLists_status: "active", budgetDecimal: "2000.00" });
  expect(saved.items[0].shoppingListItems_reason).toBe(item.reason);
  const duplicate = await mutate(asA, "duplicateList", { id });
  const copy = await document(asA, duplicate.json.response.id);
  expect(copy.shoppingLists_status).toBe("draft");
  expect(copy.items).toHaveLength(1);
  expect(copy.items[0].shoppingListItems_id).not.toBe(added.shoppingListItems_id);
  expect(copy.items[0].shoppingListItems_reason).toBe(item.reason);
  expect(succeeded(await mutate(asA, "archiveList", { id }))).toBe(true);
  expect((await document(asA, id)).shoppingLists_status).toBe("archived");
  expect(succeeded(await mutate(asA, "deleteList", { id }))).toBe(true);
  expect(succeeded(await asA.api(endpoint, { id }, "GET"))).toBe(false);
  expect(dbQuery<any>("SELECT shoppingLists_deleted FROM shoppingLists WHERE shoppingLists_id=?", [id])[0].shoppingLists_deleted).toBe(1);
  expect(inventorySnapshot()).toEqual(before);
});

test("exact decimals, half-up rounding, zero and unknown prices, rejected items and over-budget totals", async ({ asA }) => {
  const id = await create(asA, "Decimal arithmetic", { budget: "1.00" });
  await add(asA, id, { quantity: "0.5", unitPrice: "0.01" }); // rounds to 1 penny, never 0
  await add(asA, id, { quantity: "3", unitPrice: "0,10" }); // comma accepted, exact 30 pence
  await add(asA, id, { quantity: "2.5", unitPrice: "1.01" }); // 253 pence
  await add(asA, id, { unitPrice: "" });
  await add(asA, id, { unitPrice: "0" });
  await add(asA, id, { unitPrice: "999", status: "rejected" });
  const saved = await document(asA, id);
  expect(saved.totalMinor).toBe("284");
  expect(saved.missingPrices).toBe(1);
  expect(saved.excludedItems).toBe(1);
  expect(saved.overBudget).toBe(true);
  expect(saved.remainingFormatted).toContain("1.84");
  expect(saved.items[3].totalMinor).toBeNull();
  expect(saved.items[4].totalMinor).toBe("0");
});

test("items persist all properties, edit status independently, duplicate, reorder and soft-delete", async ({ asA, tenants }) => {
  const id = await create(asA);
  const first = await add(asA, id, { manufacturerId: tenants.a.manufacturerId, categoryId: tenants.a.categoryId,
    model: "AR2412", description: "Description", supplier: "Supplier", sku: "SKU-1", url: "https://example.com/product",
    image: "https://example.com/image.png", notes: "Notes" });
  expect(first).toMatchObject({ shoppingListItems_model: "AR2412", shoppingListItems_supplier: "Supplier",
    shoppingListItems_sku: "SKU-1", shoppingListItems_image: "https://example.com/image.png", shoppingListItems_notes: "Notes" });
  expect(first.manufacturer).toContain(tenants.a.marker);
  for (const status of ["approved", "ordered", "purchased", "rejected"]) {
    expect(succeeded(await mutate(asA, "saveItem", { id, itemId: first.shoppingListItems_id, ...item, status, priority: "essential" }))).toBe(true);
    expect((await document(asA, id)).items[0]).toMatchObject({ shoppingListItems_status: status, shoppingListItems_priority: "essential" });
  }
  expect(succeeded(await mutate(asA, "duplicateItem", { id, itemId: first.shoppingListItems_id }))).toBe(true);
  let rows = (await document(asA, id)).items;
  const order = rows.map((row: any) => row.shoppingListItems_id).reverse();
  expect(succeeded(await mutate(asA, "reorder", { id, order }))).toBe(true);
  expect((await document(asA, id)).items.map((row: any) => row.shoppingListItems_id)).toEqual(order);
  expect(succeeded(await mutate(asA, "reorder", { id, order: [order[0], order[0]] }))).toBe(false);
  expect(succeeded(await mutate(asA, "deleteItem", { id, itemId: order[0] }))).toBe(true);
  expect((await document(asA, id)).items).toHaveLength(1);
  expect(dbQuery<any>("SELECT shoppingListItems_deleted FROM shoppingListItems WHERE shoppingListItems_id=?", [order[0]])[0].shoppingListItems_deleted).toBe(1);
});

test("validation rejects malformed prices, quantities, priorities, URLs and arrays atomically", async ({ asA }) => {
  const id = await create(asA);
  for (const invalid of [
    { quantity: "0" }, { quantity: "-1" }, { quantity: "1e3" }, { quantity: "1.2345" }, { quantity: "1000000" },
    { unitPrice: "-1" }, { unitPrice: "1.001" }, { unitPrice: "NaN" }, { unitPrice: "1e5" }, { unitPrice: "1,000.00" },
    { priority: "" }, { priority: "urgent" }, { status: "high" }, { name: "" }, { name: ["array"] },
    { url: "javascript:alert(1)" }, { image: "http://example.com/a.png" }, { url: "https://name:pass@example.com" },
    { reason: "a".repeat(12001) }, { id: "1 OR 1=1" }
  ]) {
    const response = await mutate(asA, "saveItem", { id, ...item, ...invalid });
    expect(succeeded(response), JSON.stringify(invalid) + response.body).toBe(false);
  }
  expect((await document(asA, id)).items).toHaveLength(0);
  expect(succeeded(await mutate(asA, "saveList", { id, name: "Bypass archive", status: "archived" }))).toBe(false);
});

test("CSRF and HTTP method are enforced for every mutation", async ({ asA }) => {
  const before = dbQuery("SELECT * FROM shoppingLists");
  expect(succeeded(await asA.api(endpoint, { action: "saveList", name: "No token", status: "draft" }))).toBe(false);
  expect(succeeded(await asA.api(endpoint, { action: "saveList", name: "GET write", status: "draft", csrf: await token(asA) }, "GET"))).toBe(false);
  expect(dbQuery("SELECT * FROM shoppingLists")).toEqual(before);
});

test("business isolation covers every list/item operation, metadata and PDF pages", async ({ asA, tenants }) => {
  dbQuery<any>("INSERT INTO shoppingLists (instances_id,users_userid,shoppingLists_name,shoppingLists_created,shoppingLists_updated,shoppingLists_currency) VALUES (?,?,'Foreign secret',NOW(),NOW(),'GBP')", [tenants.b.instanceId, tenants.b.users.full.id]);
  const foreign = dbQuery<any>("SELECT shoppingLists_id FROM shoppingLists WHERE instances_id=? ORDER BY shoppingLists_id DESC LIMIT 1", [tenants.b.instanceId])[0].shoppingLists_id;
  const id = await create(asA);
  const own = await add(asA, id);
  for (const action of ["saveList", "archiveList", "deleteList", "duplicateList", "saveItem", "deleteItem", "duplicateItem", "reorder"]) {
    const response = await mutate(asA, action, { id: foreign, name: "Intrusion", status: "draft", itemId: own.shoppingListItems_id, order: [own.shoppingListItems_id], ...item });
    expect(succeeded(response), action + response.body).toBe(false);
  }
  expect(succeeded(await asA.api(endpoint, { id: foreign }, "GET"))).toBe(false);
  expect((await asA.page("/shoppingLists/?id=" + foreign)).body).toContain("Oops! Page not found.");
  expect((await asA.page("/shoppingLists/export.php?id=" + foreign)).body).toContain("Oops! Page not found.");
  const html = (await asA.page("/shoppingLists/")).body;
  expect(html).not.toContain("Foreign secret");
  expect(html).not.toContain(tenants.b.marker);
  for (const reference of [{ manufacturerId: tenants.b.manufacturerId }, { categoryId: tenants.b.categoryId }]) {
    expect(succeeded(await mutate(asA, "saveItem", { id, ...item, ...reference }))).toBe(false);
  }
  const otherList = await create(asA, "Other list");
  for (const action of ["deleteItem", "duplicateItem", "saveItem"]) {
    expect(succeeded(await mutate(asA, action, { id: otherList, itemId: own.shoppingListItems_id, ...item }))).toBe(false);
  }
  // The relational schema also refuses cross-business parent/child links.
  expect(() => dbQuery("INSERT INTO shoppingListItems (shoppingLists_id,instances_id,shoppingListItems_name,shoppingListItems_priority) VALUES (?,?,'Invalid','high')", [foreign, tenants.a.instanceId])).toThrow();
});

test("view, create, edit, archive and delete permissions are independent", async ({ asA, asLimitedA, tenants }) => {
  // Earlier authentication regression tests deliberately revoke this worker session.
  await newSession(asLimitedA.request, tenants.a.users.limited.email, tenants.password);
  const role = tenants.a.positions.limited;
  const original = dbQuery<any>("SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?", [role])[0].instancePositions_actions;
  const id = await create(asA);
  const row = await add(asA, id);
  const operations = [
    ["saveList", "CREATE", { name: "Permitted create", status: "draft" }],
    ["saveList", "EDIT", { id, name: "Permitted edit", status: "draft" }],
    ["duplicateList", "CREATE", { id }],
    ["saveItem", "EDIT", { id, ...item }],
    ["duplicateItem", "EDIT", { id, itemId: row.shoppingListItems_id }],
    ["reorder", "EDIT", { id, order: [row.shoppingListItems_id] }],
    ["archiveList", "ARCHIVE", { id }],
    ["deleteItem", "DELETE", { id, itemId: row.shoppingListItems_id }],
    ["deleteList", "DELETE", { id }],
  ] as const;
  try {
    expect(succeeded(await asLimitedA.api(endpoint, {}, "GET"))).toBe(false);
    expect((await asLimitedA.page("/shoppingLists/")).body).toContain("Oops! Page not found.");
    expect((await asLimitedA.page("/shoppingLists/export.php?id=" + id)).body).toContain("Oops! Page not found.");
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [original + ",SHOPPING_LISTS:VIEW", role]);
    expect(succeeded(await asLimitedA.api(endpoint, {}, "GET"))).toBe(true);
    expect((await asLimitedA.page("/shoppingLists/?id=" + id)).body).not.toContain('id="new-item"');
    for (const [action, , params] of operations) {
      const before = dbQuery("SELECT * FROM shoppingLists");
      expect(succeeded(await mutate(asLimitedA, action, params))).toBe(false);
      expect(dbQuery("SELECT * FROM shoppingLists")).toEqual(before);
    }
    // Positive controls prove that valid requests succeed with precisely the required permission.
    for (const [action, permission, originalParams] of operations) {
      dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [original + ",SHOPPING_LISTS:VIEW,SHOPPING_LISTS:" + permission, role]);
      const params: Record<string, any> = { ...originalParams };
      if (action === "reorder") params.order = (await document(asA, id)).items.map((r: any) => r.shoppingListItems_id);
      expect(succeeded(await mutate(asLimitedA, action, params)), action).toBe(true);
    }
  } finally {
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [original, role]);
  }
});

test("currency exponent and captured list currency survive business settings changes", async ({ asA, tenants }) => {
  const original = dbQuery<any>("SELECT instances_config_currency FROM instances WHERE instances_id=?", [tenants.a.instanceId])[0].instances_config_currency;
  try {
    for (const [currency, price, total] of [["JPY", "123", "123"], ["KWD", "1.234", "1234"]]) {
      dbQuery("UPDATE instances SET instances_config_currency=? WHERE instances_id=?", [currency, tenants.a.instanceId]);
      const id = await create(asA, currency);
      await add(asA, id, { unitPrice: price });
      expect((await document(asA, id)).totalMinor).toBe(total);
      dbQuery("UPDATE instances SET instances_config_currency='EUR' WHERE instances_id=?", [tenants.a.instanceId]);
      expect((await document(asA, id)).shoppingLists_currency).toBe(currency);
    }
  } finally {
    dbQuery("UPDATE instances SET instances_config_currency=? WHERE instances_id=?", [original, tenants.a.instanceId]);
  }
});

test("desktop UI creates and edits a list and item, persists, filters, sorts, archives and shows active navigation", async ({ page, asA }) => {
  await browserSession(page, asA);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/shoppingLists/");
  await expect(page.locator('.nav-sidebar a[href$="/shoppingLists/"]')).toHaveClass(/active/);
  await page.getByRole("button", { name: "New shopping list", exact: true }).click();
  await page.locator("#list-name").fill("UI Einkauf Bühne");
  await page.locator("#list-description").fill("Beschaffungsplanung");
  await page.locator("#list-budget").fill("2000.00");
  await page.locator("#list-status").selectOption("active");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await page.waitForURL(/shoppingLists\/\?id=/);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator("#item-name").fill(item.name);
  await page.locator("#item-quantity").fill("2");
  await page.locator("#item-price").fill("500.25");
  await page.locator("#item-priority").selectOption("high");
  await page.locator("#item-reason").fill(item.reason);
  await page.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(page.locator("#items-table tbody tr[data-item]")).toHaveCount(1);
  await expect(page.locator("#estimated-total")).toContainText("1,000.50");
  await expect(page.locator("#remaining-budget")).toContainText("999.50");
  await page.reload();
  await expect(page.locator("#items-table")).toContainText(item.reason);
  await page.locator("#items-table").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("#item-priority")).toHaveValue("high");
  await page.locator("#item-price").fill("600");
  await page.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(page.locator("#estimated-total")).toContainText("1,200.00");
  await page.locator(".item-status").selectOption("ordered");
  await expect(page.locator(".item-status")).toHaveValue("ordered");
  await page.locator("#items-table").getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator("#items-table tbody tr[data-item]")).toHaveCount(2);
  const ids = await page.locator("#items-table tbody tr[data-item]").evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.item));
  await page.getByRole("button", { name: "Move down", exact: true }).first().click();
  await expect.poll(async () => page.locator("#items-table tbody tr[data-item]").first().getAttribute("data-item")).toBe(ids[1]);
  await page.locator("#priority-filter").selectOption("optional");
  await expect(page.locator("#no-matching-items")).toBeVisible();
  await page.locator("#priority-filter").selectOption("");
  await page.locator("#items-table").getByRole("button", { name: "Remove", exact: true }).first().click();
  await page.locator(".bootbox").getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator("#items-table tbody tr[data-item]")).toHaveCount(1);
  await page.getByRole("button", { name: "Archive list", exact: true }).click();
  await page.locator(".bootbox").getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.locator(".badge").filter({ hasText: /^Archived$/ })).toBeVisible();
  await page.screenshot({ path: "test-results/shopping-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("mobile forms work, malicious text remains inert in page and PDF, filters leave totals intact", async ({ page, asA }) => {
  const payload = '</script><script>window.shoppingXss=true</script><img src=x onerror="window.shoppingXss=true">';
  const id = await create(asA, "Mobile procurement");
  await add(asA, id, { name: payload, reason: payload, description: payload, notes: payload });
  await browserSession(page, asA);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/shoppingLists/?id=" + id);
  await expect(page.locator("#items-table")).toContainText(payload);
  expect(await page.evaluate(() => (window as any).shoppingXss)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.locator("#item-name").fill("Mobile item");
  await page.locator("#item-priority").selectOption("optional");
  await page.locator("#item-reason").fill("Optional spare");
  await page.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(page.locator("#items-table tbody tr[data-item]")).toHaveCount(2);
  const total = await page.locator("#estimated-total").innerText();
  await page.locator("#item-status-filter").selectOption("purchased");
  await expect(page.locator("#no-matching-items")).toBeVisible();
  await expect(page.locator("#estimated-total")).toHaveText(total);
  await page.locator("#item-status-filter").selectOption("");
  await page.screenshot({ path: "test-results/shopping-mobile.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.goto("/shoppingLists/export.php?id=" + id);
  await download;
  expect(await page.evaluate(() => (window as any).shoppingXss)).toBeUndefined();
});

for (const count of [0, 2, 65]) {
  test("actual A4 PDF export with " + count + " items, Unicode, long text and repeated headers", async ({ page, asA }, testInfo) => {
    test.setTimeout(120_000);
    const id = await create(asA, "Beschaffung Bühne ÄÖÜ ß " + count, { description: "Schülerveranstaltung: Licht & Ton", budget: "100000", comment: "Allgemeiner Kommentar: Rücksprache mit der Schulleitung." });
    for (let n = 0; n < count; n++) {
      await add(asA, id, { name: "Artikel " + (n + 1) + " Bühnenzubehör", quantity: "2.5", unitPrice: "1.01",
        reason: n === 0 ? ("Längere Begründung für zuverlässige Übertragung zwischen Bühne und Mischpult. ".repeat(45)) : item.reason,
        description: n === 1 ? "X".repeat(300) : "Beschreibung mit Umlauten: äöü ÄÖÜ ß" });
    }
    await browserSession(page, asA);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const downloaded = page.waitForEvent("download");
    await page.goto("/shoppingLists/export.php?id=" + id);
    const pdf = await downloaded;
    const file = testInfo.outputPath("shopping-" + count + ".pdf");
    await pdf.saveAs(file);
    expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(page.locator("#pdf-error")).toBeEmpty();
    expect(errors).toEqual([]);
    // No optional parser dependency needed: inspect the real generated file when Poppler is installed.
    if (fs.existsSync("/usr/bin/pdftotext")) {
      const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/\u200b/g, "");
      expect(text).toContain("Beschaffung Bühne ÄÖÜ ß");
      expect(text).toContain("Allgemeiner Kommentar");
      expect(text).toContain("Estimated total");
      if (count) expect(text).toContain("Ermöglicht");
      if (count === 65) {
        expect(text).toContain("Artikel 65");
        expect(text.match(/Item \/ manufacturer \/ model/g)!.length).toBeGreaterThan(2);
      }
      const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
      expect(info).toContain("595.28 x 841.89 pts (A4)");
    }
    await testInfo.attach("Export PDF", { path: file, contentType: "application/pdf" });
  });
}


test("a shared user's shopping permissions follow the selected business on each request", async ({ playwright, tenants }) => {
  const request = await playwright.request.newContext({ baseURL: BASE_URL });
  const shared = await newSession(request, tenants.sharedUser.email, tenants.password);
  const role = tenants.b.positions.full;
  const original = dbQuery<any>("SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?", [role])[0].instancePositions_actions;
  try {
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.a.instanceId, id: tenants.a.shoppingListId }, "GET"))).toBe(true);
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.b.instanceId, id: tenants.a.shoppingListId }, "GET"))).toBe(false);
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.b.instanceId, id: tenants.b.shoppingListId }, "GET"))).toBe(true);
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [original.split(",").filter((key: string) => !key.startsWith("SHOPPING_LISTS:")).join(","), role]);
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.b.instanceId, id: tenants.b.shoppingListId }, "GET"))).toBe(false);
    expect(succeeded(await shared.api(endpoint, { instances_id: tenants.a.instanceId, id: tenants.a.shoppingListId }, "GET"))).toBe(true);
  } finally {
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [original, role]);
    await request.dispose();
  }
});
