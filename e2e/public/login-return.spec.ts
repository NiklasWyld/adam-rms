import { test, expect } from "@playwright/test";
import { BASE_URL, TEST_USER } from "../env";

for (const host of ["localhost:8080", "relay.internal:3000"]) {
  test("login returns to the configured public origin behind proxy host " + host, async ({ request }) => {
    const target="/rooms/?view=timeline&date=2027-07-12";
    await request.get(target,{headers:{Host:host},maxRedirects:0});
    const response=await request.post("/api/login/login.php",{form:{formInput:TEST_USER.email,password:TEST_USER.password}});
    const body=await response.json();
    expect(body.result).toBe(true);
    expect(body.response.redirect).toBe(BASE_URL+target);
  });
}
