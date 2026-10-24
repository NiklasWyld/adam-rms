import { test, expect } from "../tenants";

test("file downloads return a signed redirect without needing the optional S3 service", async ({ asA, tenants }) => {
  const response = await asA.request.post("/api/file/index.php", {
    form: { f: String(tenants.a.fileId), r: "1" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  const location = new URL(response.headers()["location"]);
  expect(location.pathname).toContain("/e2e/e2e-tenant-a-file.pdf");
  expect(location.searchParams.has("X-Amz-Signature")).toBe(true);
  expect(await response.text()).toBe("");
});
