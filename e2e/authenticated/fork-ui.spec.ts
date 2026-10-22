import { cacheCdn } from "../cdn";
import { login } from "../fixtures";
import { dbQuery, expect, formData, test } from "../tenants";

test.beforeEach(async ({ page, tenants: { a, password } }) => {
  await cacheCdn(page.context());
  await login(page, a.users.full.email, password);
});

test("project comments can be added, edited and deleted in the browser", async ({ page, tenants: { a } }) => {
  const commentText = `Comment from the browser ${Date.now()}`;
  await page.goto(`/project/?id=${a.projectId}`);
  await page.getByRole("button", { name: "New Comment", exact: true }).click();
  await page.locator('.bootbox .note-editable').fill(commentText);
  await page.locator('.bootbox').getByRole('button', { name: 'Save', exact: true }).click();
  const body = page.locator('#details-view .timeline-body').filter({ hasText: commentText });
  await expect(body).toBeVisible();
  const item = body.locator('..');
  const id = await item.getAttribute('data-comment-id');
  await item.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.bootbox .note-editable')).toHaveText(commentText);
  await page.locator('.bootbox .note-editable').fill('Changed in the browser');
  await page.locator('.bootbox').getByRole('button', { name: 'Save', exact: true }).click();
  const updated = page.locator(`.timeline-item[data-comment-id="${id}"]`);
  await expect(updated.locator('.timeline-body')).toHaveText('Changed in the browser');
  await updated.getByRole('link', { name: 'Delete', exact: true }).click();
  await page.locator('.bootbox').getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator(`.timeline-item[data-comment-id="${id}"]`)).toHaveCount(0);
  expect(dbQuery('SELECT auditLog_deleted FROM auditLog WHERE auditLog_id = ?', [Number(id)])).toEqual([{ auditLog_deleted: 1 }]);
});

test("calendar settings persist unchecked flags and render the personal calendar", async ({ page, tenants: { a } }) => {
  const before = dbQuery<{ instances_calendarConfig: string }>('SELECT instances_calendarConfig FROM instances WHERE instances_id = ?', [a.instanceId])[0].instances_calendarConfig;
  const url = 'https://calendar.google.com/calendar/embed?src=example%40gmail.com&ctz=Europe%2FBerlin';
  const csp = dbQuery('SELECT config_value FROM config WHERE config_key = ?', ['CSP_ENABLED']);
  try {
    await page.goto('/instances/calendarSettings.php');
    await page.locator('[name="showProjectStatus"]').uncheck();
    await page.locator('[name="showSubProjects"]').uncheck();
    await page.locator('[name="useCustomWeekNumbers"]').uncheck();
    await page.locator('#googleCalendarEmbedUrl').fill(url);
    const saved = page.waitForResponse(response => response.url().includes('/api/instances/editCalendarSettings.php'));
    await page.locator('#calendarSettings .save').click();
    expect((await (await saved).json()).result).toBe(true);
    await page.reload();
    await expect(page.locator('[name="showProjectStatus"]')).not.toBeChecked();
    await expect(page.locator('#googleCalendarEmbedUrl')).toHaveValue(url);
    dbQuery("REPLACE INTO config (config_key, config_value) VALUES ('CSP_ENABLED', 'Enabled')");
    const response = await page.goto('/personal_calendar.php');
    await expect(page.getByTitle('Personal Calendar', { exact: true })).toHaveAttribute('src', url);
    expect(response?.headers()['content-security-policy']).toMatch(/frame-src[^;]*https:\/\/calendar\.google\.com/);
  } finally {
    dbQuery('UPDATE instances SET instances_calendarConfig = ? WHERE instances_id = ?', [before, a.instanceId]);
    dbQuery('DELETE FROM config WHERE config_key = ?', ['CSP_ENABLED']);
    if (csp.length) dbQuery('INSERT INTO config (config_key, config_value) VALUES (?, ?)', ['CSP_ENABLED', csp[0].config_value]);
  }
});

test("project quick-create restores client and location forms", async ({ page, tenants: { a } }) => {
  await page.goto(`/project/?id=${a.projectId}`);
  await page.locator('#newClientButton').click();
  const clientName = `Fork client ${Date.now()}`;
  await page.locator('.bootbox input').fill(clientName);
  await page.locator('.bootbox').getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('#editProjectClient')).toContainText(clientName);
  await page.locator('[data-target="#createLocationModal"]').click();
  const locationName = `Fork venue ${Date.now()}`;
  await page.locator('#createLocationModal [name="locations_name"]').fill(locationName);
  const saved = page.waitForResponse(response => response.url().includes('/api/locations/new.php'));
  await page.locator('#saveNewLocation').click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('#editProjectAddress')).toContainText(locationName);
});

test("manufacturer editing is available for the business's own records", async ({ page, tenants: { a } }) => {
  const name = dbQuery<{ manufacturers_name: string }>('SELECT manufacturers_name FROM manufacturers WHERE manufacturers_id = ?', [a.manufacturerId])[0].manufacturers_name;
  try {
    await page.goto('/manufacturers.php');
    await page.locator(`[data-target="#editManufacturer-${a.manufacturerId}"]`).click();
    await page.locator(`#editManufacturer-${a.manufacturerId} [name="manufacturers_name"]`).fill('Restored manufacturer editor');
    const saved = page.waitForResponse(response => response.url().includes('/api/manufacturer/edit.php'));
    await page.locator(`#editManufacturer-${a.manufacturerId} .saveManufacturerEdit-button`).click();
    expect((await saved).status()).toBe(200);
    await expect.poll(() => dbQuery('SELECT manufacturers_name FROM manufacturers WHERE manufacturers_id = ?', [a.manufacturerId])).toEqual([{ manufacturers_name: 'Restored manufacturer editor' }]);
  } finally {
    dbQuery('UPDATE manufacturers SET manufacturers_name = ? WHERE manufacturers_id = ?', [name, a.manufacturerId]);
  }
});
