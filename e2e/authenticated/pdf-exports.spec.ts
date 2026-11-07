import { execFileSync } from "node:child_process";
import { type Page, type TestInfo } from "@playwright/test";
import { cacheCdn } from "../cdn";
import { test, expect, dbQuery, formData, type Session, type Tenant } from "../tenants";

async function browserSession(page: Page, session: Session) {
  await page.context().addCookies((await session.request.storageState()).cookies);
  await cacheCdn(page.context());
}

async function download(page: Page, url: string, name: string, info: TestInfo) {
  const pending = page.waitForEvent("download", { timeout: 15_000 });
  await page.goto(url);
  const issue = page.locator("#project-pdf-issue");
  if (await issue.count()) await issue.click();
  const file = await pending;
  const path = info.outputPath(name + ".pdf");
  await file.saveAs(path);
  await info.attach(name, { path, contentType: "application/pdf" });
  const metadata = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  expect(metadata).toContain("595.28 x 841.89 pts (A4)");
  return { text: readPdf(path), path, metadata, filename: file.suggestedFilename() };
}

const readPdf = (path: string) => execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" }).replace(/\u200b/g, "");
const exportUrl = (id: number, options: Record<string, string>) =>
  "/project/projectInvoice.php?" + new URLSearchParams({ id: String(id), ...options });

async function invoiceFixture(session: Session, tenant: Tenant) {
  dbQuery("DELETE FROM payments WHERE projects_id = ? AND payments_reference LIKE 'pdf-qa-%'", [tenant.projectId]);
  const settings = await session.api("/api/instances/editInstance.php", { formData: formData({
    instances_address: "Bühnenweg 12\n94315 Straubing",
    instances_pdf_vatId: "DE123456789",
    instances_pdf_bankDetails: "Kontoinhaberin: Bühne Süd GmbH",
  }) });
  expect(settings.json?.result, settings.body).toBe(true);
  dbQuery("UPDATE instances SET instances_config_currency = 'EUR' WHERE instances_id = ?", [tenant.instanceId]);
  dbQuery("UPDATE clients SET clients_address = ? WHERE clients_id = ?", ["Marktstraße 9\n93047 Regensburg", tenant.clientId]);
  dbQuery("UPDATE assetsAssignments SET assetsAssignments_customPrice = 16 WHERE assetsAssignments_id = ?", [tenant.assignmentId]);
  dbQuery("UPDATE payments SET payments_type = 2, payments_amount = 1234, payments_quantity = 1, payments_comment = ? WHERE payments_id = ?",
    ["Bühnentechnik für Schüleraufführung", tenant.paymentId]);
  return { type: "invoice", invoiceNumber: "RE-2025-" + Date.now(), invoiceDate: "2025-06-03",
    serviceStart: "2025-06-01", serviceEnd: "2025-06-02", invoiceDue: "2025-06-17",
    invoiceTaxCase: "standard", invoiceConfirmed: "1" };
}

test("project invoices validate required fields and render German net, VAT and gross totals", async ({ page, asA, tenants }, info) => {
  const id = tenants.a.projectId;
  const foreign = await asA.page(exportUrl(tenants.b.projectId, { type: "invoice" }));
  expect(foreign.body).not.toContain("project-pdf-data");
  await browserSession(page, asA);
  const incomplete = await download(page, exportUrl(id, { type: "invoice", draft: "1", invoiceDate: "2025-02-30" }), "rechnung-fehlende-angaben", info);
  expect(incomplete.text).toContain("Rechnungsnummer");
  expect(incomplete.text).toContain("vollständigem Namen");
  expect(incomplete.text).toContain("gültiges Rechnungsdatum");
  expect(incomplete.text).toContain("Leistungsdatum");
  expect(incomplete.filename).toContain("Entwurf");

  const options = await invoiceFixture(asA, tenants.a);
  const regular = await download(page, exportUrl(id, { ...options, draft: "1" }), "rechnung-19-prozent", info);
  for (const value of ["12,50 €", "2,38 €", "14,88 €", "19 %", "01.06.2025 bis 02.06.2025",
    "17.06.2025", "DE123456789", "Schüleraufführung", "Marktstraße 9", "Bühnenweg 12", "Bühne Süd GmbH"]) {
    expect(regular.text).toContain(value);
  }
  expect(regular.metadata).toContain("Rechnung");
  const reduced = await download(page, exportUrl(id, { ...options, invoiceTaxCase: "reduced", draft: "1" }), "rechnung-7-prozent", info);
  expect(reduced.text).toContain("0,88 €");
  expect(reduced.text).toContain("13,38 €");
  const small = await download(page, exportUrl(id, { ...options, invoiceTaxCase: "smallBusiness", draft: "1" }), "rechnung-kleinunternehmer", info);
  expect(small.text).toContain("§ 19 UStG");
  expect(small.text).not.toContain("Rechnungsbetrag brutto");
  const other = await asA.page(exportUrl(id, { ...options, invoiceTaxCase: "other" }));
  expect(other.body).toContain("Einen unterstützten Steuerfall auswählen.");
  dbQuery("UPDATE payments SET payments_type = 1 WHERE payments_id = ?", [tenants.a.paymentId]);
  expect((await asA.page(exportUrl(id, options))).body).toContain("Bereits abgerechnete Anzahlungen");
});

test("offer and delivery PDF preserve project and material data and repeat table headers", async ({ page, asA, tenants }, info) => {
  const id = tenants.a.projectId;
  dbQuery("DELETE FROM payments WHERE projects_id = ? AND payments_reference LIKE 'pdf-qa-%'", [id]);
  try {
    dbQuery("UPDATE projects SET projects_deliveryNotes = ? WHERE projects_id = ?", ["Übergabe am Bühneneingang", id]);
    for (let i = 1; i <= 45; i++) {
      dbQuery("INSERT INTO payments (projects_id, payments_reference, payments_amount, payments_quantity, payments_type, payments_date, payments_comment, payments_deleted) VALUES (?, ?, 999, 2, 2, '2025-06-01', ?, 0)",
        [id, "pdf-qa-" + info.retry + "-" + i, "Position " + i + " für Bühne und Schüleraufführung"]);
    }
    await browserSession(page, asA);
    const common = { draft: "1", addresses: "on", assets: "on", comments: "on", showAll: "on", masses: "on", venue: "on" };
    const offer = await download(page, exportUrl(id, { ...common, type: "quote", finance: "on", prices: "on", discounts: "on", checkboxes: "on", sales: "on" }), "angebot-mehrseitig", info);
    expect(offer.filename).toContain("Angebot");
    expect(offer.text).toContain("Position 45");
    expect(offer.text).toContain("Materialliste");
    expect(offer.text).toContain("Nach Rabatt");
    expect(offer.text.match(/Position \/ Lieferant/g)?.length).toBeGreaterThan(1);
    const delivery = await download(page, exportUrl(id, { ...common, type: "deliveryNote" }), "lieferschein", info);
    expect(delivery.text).toContain("Übergabe am Bühneneingang");
    expect(delivery.text).toContain(tenants.a.assetTag);
    expect(delivery.text).not.toContain("Einzelpreis");
    expect(delivery.metadata).toMatch(/Pages:\s+1\b/);
  } finally {
    dbQuery("DELETE FROM payments WHERE projects_id = ? AND payments_reference LIKE 'pdf-qa-%'", [id]);
  }
});

test("German print views render notes, location and both material barcode layouts", async ({ page, asA, tenants }, info) => {
  await browserSession(page, asA);
  await page.addInitScript(() => { window.print = () => {}; });
  const queries = "ids=" + tenants.a.assetId + "&groups=&blanks=0&tags=1&typename=1&numStickers=8";
  for (const [name, url, expected] of [
    ["projektnotiz", "/project/noteExport.php?id=" + tenants.a.noteId, tenants.a.marker + " note text"],
    ["standortetikett", "/location/barcode.php?location=" + tenants.a.locationId, tenants.a.marker + " location"],
    ["materialetiketten", "/maintenance/barcodePrint.php?type=printout&" + queries, tenants.a.assetTag],
    ["barcodeliste", "/maintenance/barcodePrint.php?type=table&" + queries, "Barcodetyp"],
  ]) {
    await page.goto(url);
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    const path = info.outputPath(name + ".pdf");
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    expect(readPdf(path)).toContain(expected);
    expect(execFileSync("pdfinfo", [path], { encoding: "utf8" })).toContain("(A4)");
    await info.attach(name, { path, contentType: "application/pdf" });
  }
});

test("final invoice with business logo archives once in local S3 and reserves its number", async ({ page, asA, tenants }, info) => {
  test.skip(process.env.E2E_PDF_ARCHIVE !== "1", "requires the local S3 emulator");
  const keys = ["FILES_ENABLED", "AWS_S3_BROWSER_ENDPOINT"];
  const values = dbQuery<{ config_key: string; config_value: string }>(
    "SELECT config_key, config_value FROM config WHERE config_key IN (?, ?)", keys);
  const logoKey = "logo-" + Date.now();
  dbQuery("REPLACE INTO config (config_key, config_value) VALUES ('FILES_ENABLED', 'Enabled'), ('AWS_S3_BROWSER_ENDPOINT', ?)",
    [process.env.CONFIG_AWS_S3_SERVER_ENDPOINT]);
  try {
    execFileSync("php", ["-r", [
      "require '../vendor/autoload.php';",
      "$client = new Aws\\S3\\S3Client(['version'=>'latest', 'region'=>getenv('CONFIG_AWS_S3_REGION'),",
      "'endpoint'=>getenv('CONFIG_AWS_S3_SERVER_ENDPOINT'), 'use_path_style_endpoint'=>true,",
      "'credentials'=>['key'=>getenv('CONFIG_AWS_S3_KEY'), 'secret'=>getenv('CONFIG_AWS_S3_SECRET')]]);",
      "$image = imagecreatetruecolor(160, 48);",
      "imagefill($image, 0, 0, imagecolorallocate($image, 32, 49, 63));",
      "imagestring($image, 5, 28, 15, 'BUEHNE SUED', imagecolorallocate($image, 255, 255, 255));",
      "ob_start(); imagepng($image); $body = ob_get_clean();",
      "$client->putObject(['Bucket'=>getenv('CONFIG_AWS_S3_BUCKET'),'Key'=>'uploads/INSTANCE-THUMBNAIL/'.$argv[1].'.png','Body'=>$body,'ContentType'=>'image/png']);",
    ].join(" "), logoKey]);
    dbQuery("INSERT INTO s3files (instances_id, users_userid, s3files_extension, s3files_path, s3files_filename, s3files_original_name, s3files_name, s3files_meta_type, s3files_meta_subType, s3files_meta_size, s3files_meta_public) VALUES (?, ?, 'png', 'uploads/INSTANCE-THUMBNAIL', ?, 'logo.png', 'logo', 5, ?, 1024, 1)",
      [tenants.a.instanceId, tenants.a.users.full.id, logoKey, tenants.a.instanceId]);
    dbQuery("UPDATE instances SET instances_logo = (SELECT s3files_id FROM s3files WHERE s3files_filename = ?) WHERE instances_id = ?",
      [logoKey, tenants.a.instanceId]);
    const options = await invoiceFixture(asA, tenants.a);
    const id = tenants.a.projectId;
    await browserSession(page, asA);
    const final = await download(page, exportUrl(id, { ...options, instancelogo: "1" }), "rechnung-archiviert", info);
    expect(execFileSync("pdfimages", ["-list", final.path], { encoding: "utf8" })).toMatch(/image\s+160\s+48\b/);
    expect(final.filename).not.toContain("Entwurf");
    expect(final.text).not.toContain("ENTWURF");
    expect(dbQuery("SELECT s3files_original_name FROM s3files WHERE instances_id = ? AND s3files_invoice_number = ?", [tenants.a.instanceId, options.invoiceNumber]))
      .toEqual([{ s3files_original_name: "rechnung.pdf" }]);
    const duplicate = await asA.page(exportUrl(id, options));
    expect(duplicate.body).toContain("Diese Rechnungsnummer wurde bereits verwendet.");
    expect(duplicate.body).toContain('"token":null');
  } finally {
    dbQuery("UPDATE instances SET instances_logo = NULL WHERE instances_id = ?", [tenants.a.instanceId]);
    dbQuery("DELETE FROM s3files WHERE s3files_filename = ?", [logoKey]);
    dbQuery("DELETE FROM config WHERE config_key IN (?, ?)", keys);
    for (const row of values) dbQuery("INSERT INTO config (config_key, config_value) VALUES (?, ?)", [row.config_key, row.config_value]);
  }
});
