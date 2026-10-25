import { execFileSync } from "child_process";
import path from "path";
import { expect, test } from "@playwright/test";
import { PHP_BINARY } from "../env";

test("production Twig cache keeps directory index templates distinct across page working directories", () => {
  const rendered = JSON.parse(execFileSync(PHP_BINARY, [path.join(__dirname, "../setup/twig-cache.php")], { encoding: "utf8" }));
  expect(rendered).toEqual({
    "taskPlanning/index.twig": "taskPlanning/index.twig",
    "rooms/index.twig": "rooms/index.twig",
    "shoppingLists/index.twig": "shoppingLists/index.twig",
  });
});
