import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import type { Page } from "@playwright/test";
import { cacheCdn } from "../cdn";
import { dbQuery, expect, test as tenantTest, type Session } from "../tenants";
import { releasedStatus } from "../projects";

const endpoint = "/api/projects/shiftPlanning.php";
const projectPage = (project: number) => "/project/?id=" + project + "#shift-planning-view";
const exportPage = (project: number) => "/project/shiftPlanningExport.php?id=" + project;
const key = () => randomBytes(16).toString("hex");

async function browser(page: Page, session: Session) {
  await page.context().addCookies((await session.request.storageState()).cookies);
  await cacheCdn(page.context());
}

const test = tenantTest.extend<{ createProject: (name: string, start?: string, end?: string) => Promise<number> }>({
  createProject: async ({ asA, tenants }, use) => {
    const created: number[] = [];
    try {
      await use(async (name, start, end) => {
        const result = await asA.api("/api/projects/new.php", {
          projects_name: name, projects_manager: tenants.a.users.full.id, projectsType_id: tenants.a.projectTypeId,
          ...(start && end ? { projects_dates_use_start: start, projects_dates_use_end: end } : {}),
        });
        expect(result.json, result.body).toMatchObject({ result: true });
        const id = result.json.response.projects_id as number;
        created.push(id);
        return id;
      });
    } finally {
      if (created.length) dbQuery("UPDATE projects SET projects_deleted=1 WHERE projects_id IN (" + created.map(() => "?").join(",") + ")", created);
    }
  },
});

async function read(session: Session, project: number) {
  const result = await session.api(endpoint, { projects_id: project }, "GET");
  expect(result.json, result.body).toMatchObject({ result: true });
  return result.json.response;
}

async function mutate(session: Session, project: number, csrf: string, shift: object, action = "save") {
  const response = await session.request.post(endpoint, {
    params: { projects_id: project, action },
    headers: { "X-Requested-With": "XMLHttpRequest", "X-Shift-CSRF": csrf },
    data: { shift },
  });
  return response.json();
}

function block(member: number, values: object = {}) {
  return {
    title: "Aufbau Bühne", start: "2030-11-16T08:00", end: "2030-11-16T12:00",
    assignments: [{ id: member, role: "Licht aufbauen" }], requestKey: key(), ...values,
  };
}

test("dashboard shows the next three active events in the current instance without crew assignments", async ({ page, asA, tenants, createProject }, testInfo) => {
  const { a, b } = tenants;
  const [config] = dbQuery<{ config_value: string }>("SELECT config_value FROM config WHERE config_key='TIMEZONE'");
  const formatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: config?.config_value || "Europe/London" });
  const parts = formatter.formatToParts(new Date());
  const today = ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
  const day = (offset: number) => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
  const names = ["Morgen Probe", "In fünf Tagen Aufbau", "Sechster Tag Show", "Vierter Eintrag"];
  const records: number[] = [];
  for (const [index, offset] of [1, 5, 6, 7].entries()) {
    records.push(await createProject(names[index], day(offset) + " 10:00", day(offset) + " 12:00"));
  }
  for (const [name, offset, time] of [["Vergangen", -1, "10:00"], ["Abgesagt", 1, "07:00"], ["Archiviert", 1, "08:00"],
    ["Gelöscht", 1, "09:00"], ["Fremde Instanz", 1, "06:00"]] as const) {
    records.push(await createProject(name, day(offset) + " " + time, day(offset) + " 11:00"));
  }
  const [, cancelled, archived, deleted, foreign] = records.slice(4);
  dbQuery("UPDATE projects SET projectsStatuses_id=? WHERE projects_id=?", [releasedStatus(a), cancelled]);
  dbQuery("UPDATE projects SET projects_archived=1 WHERE projects_id=?", [archived]);
  dbQuery("UPDATE projects SET projects_deleted=1 WHERE projects_id=?", [deleted]);
  dbQuery("UPDATE projects SET instances_id=?, projectsTypes_id=?, projectsStatuses_id=?, projects_manager=? WHERE projects_id=?",
    [b.instanceId, b.projectTypeId, b.projectStatusIds.first, b.users.full.id, foreign]);

  await browser(page, asA);
  await page.goto("/");
  const widget = page.getByRole("region", { name: "Nächste Veranstaltungen" });
  await expect(widget.locator(".list-group-item strong")).toHaveText(names.slice(0, 3));
  await expect(widget.locator(".list-group-item").nth(0)).toContainText("Morgen");
  await expect(widget.locator(".list-group-item").nth(1)).toContainText("In 5 Tagen");
  await expect(widget.locator(".list-group-item").nth(2)).toContainText("10:00");
  await expect(widget.getByRole("link", { name: "Alle Projekte ansehen" })).toHaveAttribute("href", /\/project\/list\.php$/);
  await widget.screenshot({ path: testInfo.outputPath("upcoming-events.png") });
  await widget.locator(".list-group-item").first().click();
  await expect(page).toHaveURL(new RegExp("/project/\\?id=" + records[0] + "$"));
});

test("shift writes are atomic, tenant scoped and revision checked, and overlaps are advisory", async ({ asA, asLimitedA, tenants, createProject }) => {
  const { a, b } = tenants;
  const project = await createProject("Schicht API");
  const otherProject = await createProject("Vertrauliches Parallelprojekt");
  const person = a.users.full.id;
  const { csrf, data } = await read(asA, project);
  expect(data.members.map((member: { id: number }) => member.id)).toContain(person);
  expect(data.members.map((member: { id: number }) => member.id)).not.toContain(a.users.deleted.id);
  expect(data.members.map((member: { id: number }) => member.id)).not.toContain(b.users.full.id);
  const first = block(person, { assignments: [{ id: person, role: "Licht aufbauen" }, { id: a.users.limited.id, role: "" }] });
  const created = await mutate(asA, project, csrf, first);
  expect(created).toMatchObject({ result: true, response: { data: { shifts: [{ title: first.title, revision: 1 }] } } });
  const id = created.response.id;
  expect(await mutate(asA, project, csrf, first)).toMatchObject({ result: true, response: { id } });
  const parallel = await mutate(asA, project, csrf, block(person, { title: "Technikprobe", start: "2030-11-16T10:00", end: "2030-11-16T11:00" }));
  expect(parallel).toMatchObject({ result: true, response: { data: { shifts: [
    { assignments: expect.arrayContaining([{ id: person, name: expect.any(String), role: "Licht aufbauen", overlap: true }]) },
    { title: "Technikprobe", assignments: [{ id: person, name: expect.any(String), role: "Licht aufbauen", overlap: true }] },
  ] } } });
  const backToBack = await mutate(asA, project, csrf, block(person, { title: "Abbau", start: "2030-11-16T12:00", end: "2030-11-16T13:00" }));
  expect(backToBack.response.data.shifts.at(-1).assignments[0].overlap).toBe(false);
  const other = await mutate(asA, otherProject, csrf, block(person, { title: "Geheime Schicht", start: "2030-11-16T12:30", end: "2030-11-16T13:30" }));
  expect(other.result).toBe(true);
  const refreshed = await read(asA, project);
  expect(refreshed.data.shifts.at(-1).assignments[0].overlap).toBe(true);
  expect(JSON.stringify(refreshed.data)).not.toContain("Geheime Schicht");

  const edited = await mutate(asA, project, csrf, {
    ...first, id, revision: 1, title: "Aufbau aktualisiert", end: "2030-11-17T01:00",
    assignments: [{ id: person, role: "FOH Ton" }], notes: "Am Seiteneingang", meetingPoint: "Bühne",
  });
  expect(edited).toMatchObject({ result: true, response: { data: { shifts: expect.arrayContaining([expect.objectContaining({
    id, revision: 2, end: "2030-11-17T01:00", title: "Aufbau aktualisiert",
    assignments: [{ id: person, name: expect.any(String), role: "FOH Ton", overlap: true }],
  })]) } } });
  expect(await mutate(asA, project, csrf, { ...first, id, revision: 1 })).toMatchObject({ error: { code: "CONFLICT" } });
  expect(await mutate(asA, otherProject, csrf, { ...first, id, revision: 2 })).toMatchObject({ error: { code: "NOT-FOUND" } });
  expect(await mutate(asA, b.projectId, csrf, first)).toMatchObject({ error: { code: "NOT-FOUND" } });
  expect((await asA.page(exportPage(b.projectId))).status).toBe(404);
  expect(await mutate(asA, project, "", first)).toMatchObject({ error: { code: "CSRF-ERROR" } });

  expect((await asLimitedA.api(endpoint, { projects_id: project })).json).toMatchObject({ error: { code: "AUTH-ERROR" } });
  expect((await asLimitedA.page(exportPage(project))).status).toBe(404);
  const [{ instancePositions_actions: permissions }] = dbQuery<{ instancePositions_actions: string }>(
    "SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?", [a.positions.limited]);
  try {
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?",
      [permissions + ",PROJECTS:PROJECT_CREW:VIEW", a.positions.limited]);
    const limited = await read(asLimitedA, project);
    expect(limited.data).toMatchObject({ editable: false, members: [], shifts: expect.arrayContaining([expect.objectContaining({ id })]) });
    expect(await mutate(asLimitedA, project, limited.csrf, first)).toMatchObject({ error: { code: "AUTH-ERROR" } });
  } finally {
    dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?", [permissions, a.positions.limited]);
  }
  for (const invalid of [
    block(b.users.full.id), block(a.users.deleted.id),
    block(person, { start: "2030-02-30T08:00" }),
    block(person, { end: "2030-11-16T08:00" }),
    block(person, { assignments: [{ id: person }, { id: person }] }),
  ]) {
    expect(await mutate(asA, project, csrf, invalid)).toMatchObject({ error: { code: "PARAM-ERROR" } });
  }
  expect((await read(asA, project)).data.shifts).toHaveLength(3);
  expect(await mutate(asA, project, csrf, { id, revision: 2 }, "delete")).toMatchObject({ result: true });
  expect((await read(asA, project)).data.shifts.map((shift: { id: number }) => shift.id)).not.toContain(id);
  dbQuery("UPDATE projects SET projects_archived=1 WHERE projects_id=?", [project]);
  expect((await read(asA, project)).data.editable).toBe(false);
  expect(await mutate(asA, project, csrf, block(person))).toMatchObject({ error: { code: "CONFLICT" } });
});

test("project editor searches, copies, changes and saves assignments across days on a phone", async ({ page, asA, tenants, createProject }, testInfo) => {
  const project = await createProject("Schichten am Handy", "2030-11-16 09:00", "2030-11-18 21:00");
  const { data } = await read(asA, project);
  const member = data.members.find((person: { id: number }) => person.id === tenants.a.users.full.id);
  await browser(page, asA);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(projectPage(project));
  await page.getByRole("button", { name: "Neue Schicht", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Neue Schicht" });
  await editor.getByLabel("Bezeichnung").fill("Aufbau");
  await editor.getByRole("searchbox", { name: "Personen suchen" }).fill(member.name);
  await editor.getByRole("option", { name: member.name, exact: true }).click();
  await editor.getByLabel("Bezeichnung").click();
  await editor.getByLabel("Aufgabe oder Rolle für " + member.name).fill("Licht aufbauen");
  await editor.getByText("Aufgaben, Treffpunkt und Notizen").click();
  await editor.getByLabel("Treffpunkt").fill("Bühnentür");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  const schedule = page.getByRole("region", { name: "Schichtplanung", exact: true });
  await schedule.getByRole("button", { name: /09:00.*Aufbau/ }).click();
  await page.getByRole("button", { name: "Duplizieren", exact: true }).click();
  const duplicate = page.getByRole("dialog", { name: "Schicht duplizieren" });
  await expect(duplicate.getByText(/Überschneidung:/)).toBeVisible();
  await expect(duplicate.getByLabel("Aufgabe oder Rolle für " + member.name)).toHaveValue("Licht aufbauen");
  await duplicate.getByLabel("Bezeichnung").fill("Generalprobe");
  await duplicate.getByLabel("Beginn").fill("2030-11-17T14:00");
  await duplicate.getByLabel("Ende").fill("2030-11-17T16:00");
  await duplicate.getByLabel("Aufgabe oder Rolle für " + member.name).fill("FOH Ton");
  await duplicate.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(schedule.getByRole("heading", { name: /17. November 2030/ })).toBeVisible();
  await page.reload();
  await expect(schedule.getByRole("heading", { name: /16. November 2030/ })).toBeVisible();
  await expect(schedule.getByRole("heading", { name: /17. November 2030/ })).toBeVisible();
  await schedule.getByLabel("Von", { exact: true }).fill("2030-11-17");
  await schedule.getByLabel("Bis", { exact: true }).fill("2030-11-17");
  await expect(schedule.getByRole("button", { name: /Aufbau/ })).toHaveCount(0);
  await expect(schedule.getByRole("button", { name: /Generalprobe/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await schedule.getByRole("button", { name: "Alle Tage" }).click();
  await page.screenshot({ path: testInfo.outputPath("shift-mobile.png"), fullPage: true });
  await schedule.getByRole("button", { name: /Generalprobe/ }).click();
  await expect(page.getByLabel("Aufgabe oder Rolle für " + member.name)).toHaveValue("FOH Ton");
  await expect(page.getByLabel("Treffpunkt")).toHaveValue("Bühnentür");
  await expect(page.getByLabel("Bezeichnung")).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("shift-editor-mobile.png") });
  await page.getByRole("button", { name: "Schließen", exact: true }).last().click();

  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("shift-desktop.png"), fullPage: true });
  await schedule.getByRole("button", { name: "Neue Schicht" }).click();
  await editor.getByLabel("Bezeichnung").fill("Abbau");
  const source = (await read(asA, project)).data.shifts[1].id;
  await editor.getByLabel("Besetzung übernehmen").selectOption(String(source));
  await expect(editor.getByLabel("Aufgabe oder Rolle für " + member.name)).toHaveValue("FOH Ton");
  await editor.getByRole("button", { name: "Speichern", exact: true }).click();
  await schedule.getByRole("button", { name: /Abbau/ }).click();
  await page.getByRole("dialog").locator(".select2-selection__choice__remove").click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(schedule.getByRole("button", { name: /Abbau.*Unbesetzt/ })).toBeVisible();
  await schedule.getByRole("button", { name: /Abbau/ }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(schedule.getByRole("button", { name: /Abbau/ })).toHaveCount(0);
});

test("German A4 export includes all days and repeats table heads across page breaks", async ({ page, asA, tenants, createProject }, testInfo) => {
  const { a } = tenants;
  const project = await createProject("Mehrtageseinsatz Bühne", "2030-11-16 08:00", "2030-11-18 23:00");
  const shifts = Array.from({ length: 42 }, (_, index) => {
    const day = "2030-11-" + (index < 40 ? 16 : index - 23);
    return [a.instanceId, project, day + " 08:00", day + " 12:00", "Technikblock " + String(index + 1).padStart(2, "0"),
      index ? "" : "Mikrofone prüfen", index ? "" : "Haupteingang",
      index ? "" : "Übertragung prüfen und Übergabe vorbereiten. ".repeat(78) + "Ende der Notiz.", key()];
  });
  dbQuery("INSERT INTO projectShifts (instances_id, projects_id, projectShifts_start, projectShifts_end, projectShifts_title," +
    " projectShifts_tasks, projectShifts_meetingPoint, projectShifts_notes, projectShifts_requestKey) VALUES " +
    shifts.map(() => "(?,?,?,?,?,?,?,?,?)").join(","), shifts.flat());
  dbQuery("INSERT INTO projectShiftAssignments (projectShifts_id, users_userid, projectShiftAssignments_role)" +
    " SELECT projectShifts_id, ?, 'FOH Ton – Schülerbühne' FROM projectShifts WHERE projects_id=?", [a.users.full.id, project]);
  await browser(page, asA);
  const downloaded = page.waitForEvent("download");
  await page.goto(exportPage(project));
  const file = testInfo.outputPath("schichtplanung-a4.pdf");
  await (await downloaded).saveAs(file);
  await expect(page.locator("#pdf-error")).toBeEmpty();
  const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  expect(info).toContain("595.28 x 841.89 pts (A4)");
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/\u200b/g, "");
  const unwrapped = text.replace(/\s+/g, " ");
  for (const phrase of ["Schichtplanung", "Mehrtageseinsatz Bühne", "16.11.2030, 08:00", "18.11.2030, 23:00",
    "16. November 2030", "17. November 2030", "18. November 2030", "Technikblock 42", "FOH Ton", "Schülerbühne",
    "Haupteingang", "Mikrofone prüfen", "Ende der Notiz."]) {
    expect(unwrapped).toContain(phrase);
  }
  expect(text.match(/Aufgabe oder Rolle/g)!.length).toBeGreaterThan(3);
  expect(text.match(/Übertragung/g)).toHaveLength(78);
  expect(text.indexOf("Technikblock 01")).toBeLessThan(text.indexOf("Technikblock 42"));
  await testInfo.attach("Schichtplanung", { path: file, contentType: "application/pdf" });
});
