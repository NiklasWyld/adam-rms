import { test, expect, dbQuery } from "../tenants";

const embeddingOrigin = "https://technikteam.tailc962db.ts.net:8443";
function sources(policy: string, name: string) {
  return policy.split(";").map(value => value.trim().split(/\s+/)).find(parts => parts[0] === name)?.slice(1) ?? [];
}

test.describe("approved RMS embedding origin", () => {
  let previous: { config_value: string }[];
  test.beforeEach(() => {
    previous = dbQuery("SELECT config_value FROM config WHERE config_key = ?", ["CSP_ENABLED"]);
    dbQuery("REPLACE INTO config (config_key, config_value) VALUES (?, ?)", ["CSP_ENABLED", "Enabled"]);
  });
  test.afterEach(() => {
    dbQuery("DELETE FROM config WHERE config_key = ?", ["CSP_ENABLED"]);
    if (previous.length) dbQuery("INSERT INTO config (config_key, config_value) VALUES (?, ?)", ["CSP_ENABLED", previous[0].config_value]);
  });

  test("RMS pages allow only self and the exact approved HTTPS origin to frame them", async ({ asA, tenants }) => {
    for (const url of ["/", "/shoppingLists/?id=" + tenants.a.shoppingListId]) {
      const response = await asA.request.get(url);
      expect(response.status()).toBe(200);
      expect(sources(response.headers()["content-security-policy"], "frame-ancestors")).toEqual(["'self'", embeddingOrigin]);
      expect(response.headers()["x-frame-options"]).toBeUndefined();
    }
  });

  test("a configured calendar is a frame source only on the personal calendar page", async ({ asA, tenants }) => {
    const id = tenants.a.instanceId;
    const original = dbQuery<{ instances_calendarConfig: string }>("SELECT instances_calendarConfig FROM instances WHERE instances_id = ?", [id])[0].instances_calendarConfig;
    const config = JSON.parse(original || "{}");
    config.googleCalendarEmbedUrl = "https://calendar.example.test/embed";
    try {
      dbQuery("UPDATE instances SET instances_calendarConfig = ? WHERE instances_id = ?", [JSON.stringify(config), id]);
      const response = await asA.request.get("/personal_calendar.php");
      const policy = response.headers()["content-security-policy"];
      expect(sources(policy, "frame-src")).toContain("https://calendar.example.test");
      expect(sources(policy, "frame-ancestors")).toEqual(["'self'", embeddingOrigin]);
      const dashboard = await asA.request.get("/");
      expect(sources(dashboard.headers()["content-security-policy"], "frame-src")).not.toContain("https://calendar.example.test");
    } finally {
      dbQuery("UPDATE instances SET instances_calendarConfig = ? WHERE instances_id = ?", [original, id]);
    }
  });
});
