import fs from "fs";
import path from "path";
import {randomUUID} from "crypto";
import {test, expect, Session, dbQuery, newSession, succeeded} from "../tenants";
import {APP_ENV, BASE_URL} from "../env";
import {cacheCdn} from "../cdn";

const endpoint="/api/taskPlanning/settings.php";
const unique=(s:string)=>s+"-"+randomUUID();
const callback="https://rms.example.test/taskPlanning/callback.php";
async function read(s:Session, extra:any={}) {
  const r=await s.api(endpoint,{action:"data",...extra});expect(r.json?.result,r.body).toBe(true);return r.json.response;
}
async function save(s:Session, fields:any={}, extra:any={}) {
  const current=await read(s);
  return s.api(endpoint,{action:"save",csrf:current.csrf,revision:String(current.settings.revision),...fields,...extra});
}
async function configured(s:Session, id=unique("client"), secret=unique("secret")) {
  const result=await save(s,{client_id:id,client_secret:secret,redirect_uri:callback});
  expect(result.json?.result,result.body).toBe(true);return {id,secret,result:result.json.response};
}
async function remove(s:Session) {
  const r=await read(s);
  const result=await s.api(endpoint,{action:"remove",csrf:r.csrf,revision:String(r.settings.revision)});
  expect(result.json?.result,result.body).toBe(true);
}
test.afterEach(async({asA})=>{await remove(asA);});

test("business app settings encrypt the secret, preserve blank secrets, never return/log them and work without environment setup",async({asA,tenants})=>{
  const {id,secret,result}=await configured(asA);
  expect(result.settings).toMatchObject({clientId:id,hasSecret:true,source:"business",configured:true,keyReady:true});
  const db=dbQuery<any>("SELECT * FROM taskTickSettings WHERE instances_id=?",[tenants.a.instanceId])[0];
  expect(db.taskTickSettings_secret).not.toContain(secret);expect(db.taskTickSettings_secret).not.toBe(secret);
  const before=db.taskTickSettings_secret;
  const updated=await save(asA,{client_id:id,client_secret:"",redirect_uri:callback});
  expect(updated.json?.result,updated.body).toBe(true);expect(updated.body).not.toContain(secret);
  expect((await read(asA)).settings.hasSecret).toBe(true);
  expect((await asA.page("/instances/tickTick.php")).body).not.toContain(secret);
  const task=await asA.api("/api/taskPlanning/action.php");expect(task.json.response.data.tick.configured).toBe(true);
  const logs=dbQuery<any>("SELECT analyticsEvents_payload FROM analyticsEvents WHERE analyticsEvents_path=? AND instances_id=?",[endpoint,tenants.a.instanceId]);
  expect(logs.every((r:any)=>!String(r.analyticsEvents_payload).includes(secret))).toBe(true);
  const audit=dbQuery<any>("SELECT auditLog_actionData FROM auditLog WHERE auditLog_actionType='TICKTICK-APP-SETTINGS'");
  expect(audit.every((r:any)=>!String(r.auditLog_actionData).includes(secret))).toBe(true);
  const key=APP_ENV.TASK_PLANNING_TOKEN_KEY_FILE;
  expect(fs.statSync(key).mode&0o777).toBe(0o600);expect(fs.statSync(path.dirname(key)).mode&0o777).toBe(0o700);
  expect(fs.realpathSync(key).startsWith("/workspace/")).toBe(false);
  expect(fs.readFileSync(key,"utf8").trim()).not.toBe(before);
});

test("settings enforce roles, methods, CSRF, revisions, field validation and isolate businesses",async({asA,asLimitedA,tenants,playwright})=>{
  const {secret}=await configured(asA),r=await read(asA),before=dbQuery("SELECT * FROM taskTickSettings WHERE instances_id=?",[tenants.a.instanceId]);
  const base={action:"save",csrf:r.csrf,revision:String(r.settings.revision),client_id:"client",client_secret:secret,redirect_uri:callback};
  expect(succeeded(await asA.api(endpoint,{...base,csrf:"bad"}))).toBe(false);
  expect(succeeded(await asA.api(endpoint,base,"GET"))).toBe(false);
  for(const bad of [{client_id:"x\r\nInjected"},{redirect_uri:"http://rms.example.test/taskPlanning/callback.php"},{redirect_uri:"https://rms.example.test/other"},{redirect_uri:callback+"?code=bad"},{redirect_uri:"https://user:pass@rms.example.test/taskPlanning/callback.php"},{client_secret:["bad"]},{client_secret:"x\nbad"},{revision:"0"}]) {
    expect(succeeded(await asA.api(endpoint,{...base,...bad})),JSON.stringify(bad)).toBe(false);
  }
  expect(dbQuery("SELECT * FROM taskTickSettings WHERE instances_id=?",[tenants.a.instanceId])).toEqual(before);
  const role=tenants.a.positions.limited,old=dbQuery<any>("SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?",[role])[0].instancePositions_actions;
  try{
    dbQuery("UPDATE instancePositions SET instancePositions_actions='' WHERE instancePositions_id=?",[role]);
    expect(succeeded(await asLimitedA.api(endpoint))).toBe(false);
    expect((await asLimitedA.page("/instances/tickTick.php")).body).not.toContain('id="tick-settings-form"');
    dbQuery("UPDATE instancePositions SET instancePositions_actions='BUSINESS:BUSINESS_SETTINGS:VIEW' WHERE instancePositions_id=?",[role]);
    const view=await read(asLimitedA);expect(view.edit).toBe(false);expect(JSON.stringify(view)).not.toContain(secret);
    expect((await asLimitedA.api(endpoint,{...base,csrf:view.csrf})).json.error.code).toBe("AUTH-ERROR");
  }finally{dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?",[old,role]);}
  const ctx=await playwright.request.newContext({baseURL:BASE_URL});
  try{
    const b=await newSession(ctx,tenants.b.users.full.email,tenants.password);
    const other=await configured(b);
    const bd=await read(b);expect(bd.settings.clientId).toBe(other.id);expect(JSON.stringify(bd)).not.toContain(secret);
    expect(succeeded(await asA.api(endpoint,{...base,instances_id:tenants.b.instanceId}))).toBe(false);
    expect((await read(b)).settings.clientId).toBe(other.id);
    await remove(b);
  }finally{await ctx.dispose();}
});

test("JSON request bodies are redacted and OAuth uses the saved business app with masked UI editing",async({asA,tenants,page})=>{
  const secret=unique("json-secret"),id=unique("json-client"),current=await read(asA);
  const response=await asA.request.post(endpoint,{data:{action:"save",csrf:current.csrf,revision:String(current.settings.revision),client_id:id,client_secret:secret,redirect_uri:callback}});
  const json=await response.json();expect(json.result).toBe(true);expect(JSON.stringify(json)).not.toContain(secret);
  const planning=(await asA.api("/api/taskPlanning/action.php")).json.response;
  const connect=await asA.api("/api/taskPlanning/action.php",{action:"connect",csrf:planning.csrf,payload:"{}"});
  expect(connect.json?.result,connect.body).toBe(true);
  const url=new URL(connect.json.response.url);expect(url.hostname).toBe("ticktick.com");expect(url.searchParams.get("client_id")).toBe(id);expect(url.searchParams.get("redirect_uri")).toBe(callback);
  await page.context().addCookies((await asA.request.storageState()).cookies);await cacheCdn(page.context());
  await page.goto("/instances/navigation.php");await expect(page.getByRole("link",{name:"TickTick Settings"})).toBeVisible();
  await page.getByRole("link",{name:"TickTick Settings"}).click();await expect(page.locator("#tick-settings-status")).toContainText("configured");
  await expect(page.locator("#tick-client-id")).toHaveValue(id);await expect(page.locator("#tick-client-secret")).toHaveValue("");
  await expect(page.locator("#tick-client-secret")).toHaveAttribute("type","password");
  await page.locator("#tick-client-id").fill(id+"-edited");
  page.once("dialog",d=>d.accept());await page.locator("#tick-settings-save").click();await expect(page.locator("#tick-settings-status")).toContainText("configured");
  await expect(page.locator("#tick-client-secret")).toHaveValue("");expect((await read(asA)).settings.clientId).toBe(id+"-edited");
  await page.reload();await expect(page.locator("#tick-client-id")).toHaveValue(id+"-edited");
  await page.locator("#tick-settings").screenshot({path:"/tmp/ticktick-settings-ui.png"});
  const logs=dbQuery<any>("SELECT analyticsEvents_payload FROM analyticsEvents WHERE analyticsEvents_path=?",[endpoint]);
  expect(logs.every((r:any)=>!String(r.analyticsEvents_payload).includes(secret))).toBe(true);
});

test("changing app settings invalidates only this business's personal tokens and retains external mappings",async({asA,tenants})=>{
  const {id}=await configured(asA);
  for(const tenant of [tenants.a,tenants.b])dbQuery("INSERT INTO taskTickConnections (instances_id,users_userid,taskTickConnections_token) VALUES (?,?,?) ON DUPLICATE KEY UPDATE taskTickConnections_token=VALUES(taskTickConnections_token)",[tenant.instanceId,tenant.users.full.id,"synthetic-encrypted-token"]);
  const before=dbQuery("SELECT * FROM taskTickTasks");
  try{
    const result=await save(asA,{client_id:id,client_secret:unique("rotated"),redirect_uri:callback});
    expect(result.json?.result,result.body).toBe(true);
    expect(dbQuery<any>("SELECT taskTickConnections_token FROM taskTickConnections WHERE instances_id=? AND users_userid=?",[tenants.a.instanceId,tenants.a.users.full.id])[0].taskTickConnections_token).toBeNull();
    expect(dbQuery<any>("SELECT taskTickConnections_token FROM taskTickConnections WHERE instances_id=? AND users_userid=?",[tenants.b.instanceId,tenants.b.users.full.id])[0].taskTickConnections_token).toBe("synthetic-encrypted-token");
    expect(dbQuery("SELECT * FROM taskTickTasks")).toEqual(before);
  }finally{dbQuery("UPDATE taskTickConnections SET taskTickConnections_token=NULL WHERE instances_id=?",[tenants.b.instanceId]);}
});

test("missing or permissive encryption keys fail closed without generating a replacement or overwriting saved credentials",async({asA,tenants})=>{
  const {id}=await configured(asA),key=APP_ENV.TASK_PLANNING_TOKEN_KEY_FILE,before=dbQuery("SELECT * FROM taskTickSettings WHERE instances_id=?",[tenants.a.instanceId]);
  fs.renameSync(key,key+".held");
  try{
    expect((await read(asA)).settings.configured).toBe(false);
    const response=await save(asA,{client_id:id,client_secret:unique("replacement"),redirect_uri:callback});
    expect(response.json.result).toBe(false);expect(response.json.error.message).toContain("Restore");
    expect(fs.existsSync(key)).toBe(false);expect(dbQuery("SELECT * FROM taskTickSettings WHERE instances_id=?",[tenants.a.instanceId])).toEqual(before);
  }finally{fs.renameSync(key+".held",key);}
  fs.chmodSync(key,0o644);
  try{
    expect((await read(asA)).settings.configured).toBe(false);
    const response=await save(asA,{client_id:id,client_secret:unique("replacement"),redirect_uri:callback});
    expect(response.json.result).toBe(false);expect(dbQuery("SELECT * FROM taskTickSettings WHERE instances_id=?",[tenants.a.instanceId])).toEqual(before);
  }finally{fs.chmodSync(key,0o600);}
});

test("vault provisions protected persistent keys and rejects swapped or tampered credentials and unsafe paths",async({})=>{
  const {execFileSync}=await import("child_process");
  const output=execFileSync("php",["e2e/setup/ticktick-vault.php"],{cwd:"..",env:{...process.env,...APP_ENV},encoding:"utf8"});
  expect(output).toContain("PASS vault");
});
