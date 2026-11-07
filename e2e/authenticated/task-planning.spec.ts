import fs from "fs";
import {execFileSync} from "child_process";
import {test, expect, Session, dbQuery, succeeded, newSession} from "../tenants";
import {cacheCdn} from "../cdn";
import {BASE_URL, APP_ENV, PHP_BINARY} from "../env";
import {randomUUID} from "crypto";

const endpoint="/api/taskPlanning/action.php";
const unique=(s:string)=>s+" "+randomUUID().slice(0,8);
async function read(s:Session,p?:number) {
  const r=await s.api(endpoint,{projects_id:p || "",action:"data"});
  expect(r.json?.result,r.body).toBe(true);return r.json.response;
}
async function send(s:Session,p:number|undefined,action:string,payload:any,request_id=randomUUID().replace(/-/g,"")) {
  const current=await read(s,p);
  return s.api(endpoint,{projects_id:p || "",action,payload:JSON.stringify(payload),csrf:current.csrf,request_id});
}
async function write(s:Session,p:number|undefined,action:string,payload:any,request_id?:string) {
  const r=await send(s,p,action,payload,request_id);expect(r.json?.result,r.body).toBe(true);return r.json.response;
}
async function add(s:Session,p:number,items:any[]) {
  const r=await write(s,p,"create",{items});return r.data.tasks.filter((t:any)=>r.ids.includes(t.id));
}
async function patch(s:Session,p:number|undefined,t:any,change:any) {
  const r=await write(s,p,"update",{items:[{id:t.id,revision:t.revision,patch:change}]});return r.data.tasks.find((x:any)=>x.id===t.id);
}
async function browser(page:any,s:Session) {await page.context().addCookies((await s.request.storageState()).cookies);await cacheCdn(page.context());}

test("task CRUD, complete/reopen, checklist, project reassignment and My Tasks persist every property",async({asA,tenants})=>{
  const p=tenants.a.projectId,user=tenants.a.users.full.id;
  let [t]=await add(asA,p,[{title:unique("PA aufbauen"),description:"Plan A\nPlan B",category:"Tontechnik",day:"2027-07-12",time:"08:30",deadline:"2027-07-11T18:00",assignee:user,priority:3,status:"blocked",checklist:[{id:"pa",title:"Strom prüfen",done:false}]}]);
  expect(t).toMatchObject({day:"2027-07-12",time:"08:30",deadline:"2027-07-11T18:00",priority:3,status:"blocked",assignee:user,category:"Tontechnik"});
  expect((await read(asA)).data.tasks.some((x:any)=>x.id===t.id)).toBe(true);
  t=await patch(asA,undefined,t,{status:"done",checklist:[{id:"pa",title:"Strom prüfen",done:true}]});expect(t.status).toBe("done");
  t=await patch(asA,undefined,t,{title:"Updated",description:"",category:"Lichttechnik",day:"",deadline:"",priority:0,status:"open",project:tenants.a.subProjectId});
  expect(t).toMatchObject({title:"Updated",description:"",day:null,time:null,deadline:null,status:"open",priority:0,project:tenants.a.subProjectId});
  expect((await read(asA,p)).data.tasks.some((x:any)=>x.id===t.id)).toBe(false);
  const r=await write(asA,tenants.a.subProjectId,"delete",{items:[{id:t.id,revision:t.revision}]});
  expect(r.data.tasks.some((x:any)=>x.id===t.id)).toBe(false);
  expect(dbQuery<any>("SELECT planningTasks_deleted FROM planningTasks WHERE planningTasks_id=?",[t.id])[0].planningTasks_deleted).toBe(1);
});

test("pasted batches and package insertion are idempotent, atomic and protect optimistic revisions",async({asA,tenants})=>{
  const p=tenants.a.projectId,k=randomUUID().replace(/-/g,""),payload={items:[{title:unique("one")},{title:unique("two")}]};
  const a=await write(asA,p,"create",payload,k),b=await write(asA,p,"create",payload,k);expect(a.ids).toEqual(b.ids);
  expect(succeeded(await send(asA,p,"create",{items:[{title:"different"}]},k))).toBe(false);
  const tasks=a.data.tasks.filter((t:any)=>a.ids.includes(t.id));
  const count=(await read(asA,p)).data.tasks.length;
  expect(succeeded(await send(asA,p,"create",{items:[{title:"Must roll back"},{title:""}]}))).toBe(false);
  expect((await read(asA,p)).data.tasks).toHaveLength(count);
  await patch(asA,p,tasks[0],{title:"Concurrent edit"});
  const result=await send(asA,p,"update",{items:tasks.map((t:any)=>({id:t.id,revision:t.revision,patch:{status:"done"}}))});
  expect(result.json.error.code).toBe("CONFLICT");
  expect((await read(asA,p)).data.tasks.find((t:any)=>t.id===tasks[1].id).status).toBe("open");
});

test("packages save, edit, preview relative dates, deselect and reuse independently across projects",async({asA,tenants})=>{
  const p=tenants.a.projectId,items=[
    {title:"Räume reservieren",category:"Organisation",priority:2,offset:-14,deadlineOffset:-7,checklist:[{title:"Sekretariat",done:false}]},
    {title:"PA aufbauen",category:"Tontechnik",priority:1,offset:-1,time:"10:00"},
    {title:"Soundcheck",category:"Tontechnik",priority:3,offset:0},
    {title:"Technik abbauen",category:"Abbau",priority:0,offset:1}];
  let r=await write(asA,p,"saveTemplate",{name:unique("Schulkonzert"),items});
  let t=r.data.templates.find((t:any)=>t.taskTemplates_id===r.ids[0]);
  let pre=await asA.api(endpoint,{action:"preview",projects_id:p,template_id:t.taskTemplates_id,base:"2027-07-12"});
  expect(pre.json?.result,pre.body).toBe(true);
  expect(pre.json.response.preview.items.map((x:any)=>x.day)).toEqual(["2027-06-28","2027-07-11","2027-07-12","2027-07-13"]);
  const payload={id:t.taskTemplates_id,revision:t.taskTemplates_revision,base:"2027-07-12",selected:[0,1,3]},k=randomUUID().replace(/-/g,"");
  const applied=await write(asA,p,"applyTemplate",payload,k);expect(applied.ids).toHaveLength(3);
  expect((await write(asA,p,"applyTemplate",payload,k)).ids).toEqual(applied.ids);
  const created=applied.data.tasks.find((x:any)=>x.id===applied.ids[0]);expect(created.deadline).toBe("2027-07-05T23:59");
  expect(created.checklist[0].title).toBe("Sekretariat");
  r=await write(asA,undefined,"saveTemplate",{id:t.taskTemplates_id,revision:t.taskTemplates_revision,name:t.taskTemplates_name,items:[{...items[0],title:"Changed package"}]});
  t=r.data.templates.find((x:any)=>x.taskTemplates_id===t.taskTemplates_id);
  expect((await read(asA,p)).data.tasks.find((x:any)=>x.id===created.id).title).toBe("Räume reservieren");
  expect((await write(asA,tenants.a.subProjectId,"applyTemplate",{id:t.taskTemplates_id,revision:t.taskTemplates_revision,base:"2027-08-12",selected:[0]})).ids).toHaveLength(1);
  await write(asA,p,"deleteTemplate",{id:t.taskTemplates_id,revision:t.taskTemplates_revision});
  expect((await read(asA,p)).data.tasks.some((x:any)=>x.id===created.id)).toBe(true);
});

test("tenant boundaries, personal views, roles, CSRF, archived/deleted projects and malformed values are enforced server-side",async({asA,asLimitedA,tenants,playwright})=>{
  const p=tenants.a.projectId,[t]=await add(asA,p,[{title:unique("Scoped"),assignee:tenants.a.users.full.id}]);
  const ctx=await playwright.request.newContext({baseURL:BASE_URL});
  try {
    const b=await newSession(ctx,tenants.b.users.full.email,tenants.password);
    expect(succeeded(await b.api(endpoint,{projects_id:p}))).toBe(false);
    expect(succeeded(await send(asA,p,"create",{items:[{title:"Foreign assignee",assignee:tenants.b.users.full.id}]}))).toBe(false);
    expect(succeeded(await send(asA,p,"update",{items:[{id:t.id,revision:t.revision,patch:{project:tenants.b.projectId}}]}))).toBe(false);
    expect((await b.page("/taskPlanning/export.php?projects_id="+p)).body).not.toContain("task-pdf-data");
    const foreign=await write(b,tenants.b.projectId,"saveTemplate",{name:"Private B package",items:[{title:"Foreign"}]});
    expect(succeeded(await send(asA,p,"applyTemplate",{id:foreign.ids[0],revision:1,selected:[0]}))).toBe(false);
    expect((await read(asA)).data.templates.some((x:any)=>x.taskTemplates_id===foreign.ids[0])).toBe(false);
  } finally {await ctx.dispose();}
  const current=await read(asA,p);
  expect(succeeded(await asA.api(endpoint,{action:"create",projects_id:p,csrf:"bad",request_id:randomUUID().replace(/-/g,""),payload:'{"items":[{"title":"CSRF"}]}'}))).toBe(false);
  expect(succeeded(await asA.api(endpoint,{action:"create",projects_id:p,csrf:current.csrf,request_id:randomUUID().replace(/-/g,""),payload:'{"items":[{"title":"GET mutation"}]}'},"GET"))).toBe(false);
  for(const bad of [{day:"2027-02-30"},{time:"25:00"},{status:"invalid"},{priority:7},{title:[]},{title:"x".repeat(501)},{checklist:[{id:"same",title:"one"},{id:"same",title:"two"}]},{order:-1},{project:"1 OR 1=1"}]) {
    expect(succeeded(await send(asA,p,"update",{items:[{id:t.id,revision:t.revision,patch:bad}]})),JSON.stringify(bad)).toBe(false);
  }
  const role=tenants.a.positions.limited,original=dbQuery<any>("SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?",[role])[0].instancePositions_actions;
  try {
    dbQuery("UPDATE instancePositions SET instancePositions_actions='PROJECTS:VIEW' WHERE instancePositions_id=?",[role]);
    expect((await read(asLimitedA,p)).data.permissions.edit).toBe(false);
    expect((await read(asLimitedA)).data.tasks.some((x:any)=>x.id===t.id)).toBe(false);
    for(const action of ["create","update","saveTemplate","connect","sync"])expect((await send(asLimitedA,p,action,{items:[{title:"Denied"}]})).json.error.code).toBe("AUTH-ERROR");
    dbQuery("UPDATE instancePositions SET instancePositions_actions='' WHERE instancePositions_id=?",[role]);
    expect(succeeded(await asLimitedA.api(endpoint))).toBe(false);
  }finally{dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?",[original,role]);}
  try{
    dbQuery("UPDATE projects SET projects_archived=1 WHERE projects_id=?",[p]);
    expect(succeeded(await send(asA,p,"update",{items:[{id:t.id,revision:t.revision,patch:{status:"done"}}]}))).toBe(false);
    dbQuery("UPDATE projects SET projects_deleted=1 WHERE projects_id=?",[p]);
    expect(succeeded(await asA.api(endpoint,{projects_id:p}))).toBe(false);
  }finally{dbQuery("UPDATE projects SET projects_archived=0,projects_deleted=0 WHERE projects_id=?",[p]);}
});

test("UI quick add/paste, all inline fields, combined filters, bulk edits, saved filters and global tasks",async({asA,tenants,page})=>{
  test.setTimeout(120000);await browser(page,asA);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const p=tenants.a.projectId,tag=unique("UI"),filterName=unique("Ton am 12. Juli");
  await page.goto("/project/?id="+p+"#task-planning-view");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-quick-title").fill(tag+" PA\n"+tag+" Licht");await page.locator("#tp-quick-title").press("Enter");
  await expect(page.locator("#tp-quick-title")).toHaveValue("");
  await page.locator("#tp-search").fill(tag);
  await expect(page.locator(".tp-row")).toHaveCount(2);
  const row=page.locator(".tp-row").first();
  await row.locator('[data-field="category"]').fill("Tontechnik");await row.locator('[data-field="category"]').press("Enter");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await row.locator('[data-field="day"]').fill("2027-07-12");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await row.locator('[data-field="priority"]').selectOption("3");await row.locator('[data-field="assignee"]').selectOption(String(tenants.a.users.full.id));
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await row.locator('[data-action="expand"]').click();
  await row.locator('[data-field="description"]').fill("Beschreibung ÄÖÜ ß");await row.locator('[data-field="description"]').press("Tab");
  await row.locator('[data-field="deadline"]').fill("2027-07-11T18:00");
  await row.locator('[data-field="addCheck"]').fill("Mikrofone");await row.locator('[data-field="addCheck"]').press("Enter");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await row.locator('[data-action="check"]').check();await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  // Mark both, then use the same inline bulk value control for all fields.
  await page.locator("#tp-select-all").check();
  await page.locator("#tp-bulk-field").selectOption("status");await page.locator("#tp-bulk-input").selectOption("progress");await page.locator("#tp-bulk-apply").click();
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-bulk-field").selectOption("assignee");await page.locator("#tp-bulk-input").selectOption(String(tenants.a.users.full.id));await page.locator("#tp-bulk-apply").click();
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-bulk-clear").click();
  await page.locator("#tp-from").fill("2027-07-12");await page.locator("#tp-to").fill("2027-07-12");
  await page.locator("#tp-categories").selectOption(["Tontechnik"]);
  await page.locator("#tp-statuses").selectOption(["progress"]);await page.locator("#tp-priorities").selectOption(["3"]);
  await page.locator("#tp-assignees").selectOption([String(tenants.a.users.full.id)]);
  await expect(page.locator(".tp-row")).toHaveCount(1);
  await page.locator("#tp-sort").selectOption("priority");await page.locator("#tp-group").selectOption("category");
  await expect(page.locator(".tp-row")).toHaveCount(1);
  await page.locator("#tp-filter-name").fill(filterName);await page.locator("#tp-save-filter").click();
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-reset").click();expect(await page.locator(".tp-row").count()).toBeGreaterThan(1);
  await expect(page.locator("#tp-sort")).toHaveValue("priority");
  const filter=(await read(asA,p)).data.filters.find((f:any)=>f.taskSavedFilters_name===filterName);
  await page.locator("#tp-saved").selectOption(String(filter.taskSavedFilters_id));await expect(page.locator(".tp-row")).toHaveCount(1);
  await page.locator("#task-planner").screenshot({path:"/tmp/task-planning-desktop.png"});
  await row.locator('[data-action="complete"]').check();await expect(page.locator(".tp-row")).toHaveCount(0);
  await page.goto("/taskPlanning/");await expect(page.locator('.main-sidebar a[href$="/taskPlanning/"]')).toBeVisible();await expect(page.locator("#tp-save")).toHaveText("All changes saved");await page.locator("#tp-search").fill(tag);
  await expect(page.locator(".tp-row")).toHaveCount(2);await expect(page.locator(".tp-project-link").first()).toBeVisible();
  await page.reload();await expect(page.locator("#tp-save")).toHaveText("All changes saved");await page.locator("#tp-search").fill(tag);
  await expect(page.locator(".tp-row")).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});await page.locator("#task-planner").screenshot({path:"/tmp/task-planning-mobile.png"});
  expect(errors).toEqual([]);
});

test("UI task package editor previews, deselects, applies and saves project tasks for reuse",async({asA,tenants,page})=>{
  test.setTimeout(90000);await browser(page,asA);
  await page.goto("/project/?id="+tenants.a.subProjectId+"#task-planning-view");await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-packages").click();await page.locator("#tp-package-new").click();const name=unique("Konzert Paket");
  await page.locator("#tp-package-name").fill(name);await page.locator("#tp-package-add").fill("Räume reservieren\nPA aufbauen\nAbbauen");await page.locator("#tp-package-add").press("Enter");
  await page.locator('[data-package-item="0"] [data-prop="category"]').fill("Organisation");
  await page.locator('[data-package-item="0"] [data-prop="offset"]').fill("-14");
  await page.locator('[data-package-item="1"] [data-prop="category"]').fill("Tontechnik");
  await page.locator('[data-package-item="1"] [data-prop="offset"]').fill("0");
  await page.locator("#tp-package-save").click();await expect(page.locator("#tp-package-editor")).not.toBeVisible();
  await page.locator("#tp-reference").fill("2027-07-12");await page.locator("#tp-preview").click();
  await expect(page.locator(".tp-preview-item")).toHaveCount(3);await expect(page.locator(".tp-preview-item").first()).toContainText("2027-06-28");
  await page.locator('[data-preview="2"]').uncheck();const beforeCount=(await read(asA,tenants.a.subProjectId)).data.tasks.length;await page.locator("#tp-apply").dblclick();await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  expect((await read(asA,tenants.a.subProjectId)).data.tasks.length).toBe(beforeCount+2);
  await page.locator("#tp-search").fill("PA aufbauen");await expect(page.locator(".tp-row").last().locator('[data-field="day"]')).toHaveValue("2027-07-12");
  await page.locator("#tp-package-from").click();await page.locator("#tp-package-name").fill(unique("Reused project"));await page.locator("#tp-package-save").click();
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
});

test("autosave recovers a dropped response without duplication and keeps concurrent drafts on conflict",async({asA,tenants,page})=>{
  test.setTimeout(90000);await browser(page,asA);await page.goto("/project/?id="+tenants.a.projectId+"#task-planning-view");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  let drop=true;
  await page.route("**/api/taskPlanning/action.php",async route=>{
    if(drop && new URLSearchParams(route.request().postData() || "").get("action")==="create"){
      drop=false;await route.fetch();await route.abort("failed");
    }else await route.continue();
  });
  const title=unique("Dropped response");await page.locator("#tp-quick-title").fill(title);await page.locator("#tp-quick-title").press("Enter");
  await expect(page.locator("#tp-retry")).toBeVisible();await page.locator("#tp-retry").click();await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  expect((await read(asA,tenants.a.projectId)).data.tasks.filter((x:any)=>x.title===title)).toHaveLength(1);
  await page.locator("#tp-search").fill(title);
  const t=(await read(asA,tenants.a.projectId)).data.tasks.find((x:any)=>x.title===title);
  await patch(asA,tenants.a.projectId,t,{title:"Server changed"});
  await page.locator(".tp-title").fill("My unsaved edit");await page.locator(".tp-title").press("Enter");
  await expect(page.locator("#tp-error")).toContainText("another tab");
  await expect(page.locator(".tp-title")).toHaveValue("My unsaved edit");
  page.once("dialog",d=>d.accept());await page.locator("#tp-reload").click();await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  expect((await read(asA,tenants.a.projectId)).data.tasks.find((x:any)=>x.id===t.id).title).toBe("My unsaved edit");
  const current=(await read(asA,tenants.a.projectId)).data.tasks.find((x:any)=>x.id===t.id);
  await page.locator("#tp-search").fill("My unsaved edit");
  await patch(asA,tenants.a.projectId,current,{title:"Server version retained"});
  await page.locator('[data-task="'+t.id+'"] .tp-title').fill("Discard me");await page.locator('[data-task="'+t.id+'"] .tp-title').press("Enter");
  await expect(page.locator("#tp-discard")).toBeVisible();
  page.once("dialog",d=>d.accept());await page.locator("#tp-discard").click();
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  expect((await read(asA,tenants.a.projectId)).data.tasks.find((x:any)=>x.id===t.id).title).toBe("Server version retained");
  await page.locator("#tp-search").fill("Server version retained");
  await page.evaluate(()=>document.body.classList.add("dark-mode"));
  await expect(page.locator('[data-task="'+t.id+'"]')).toHaveCSS("background-color","rgb(52, 58, 64)");
  await expect(page.locator("#task-planner")).toHaveCSS("color","rgb(225, 230, 237)");
  await page.screenshot({path:"/tmp/task-planning-dark.png",fullPage:true});
});

test("PDF downloads A4, filtered/all, empty and multiple pages with checklists and long Unicode text",async({asA,tenants,page})=>{
  test.setTimeout(120000);await browser(page,asA);
  const p=tenants.a.subProjectId,tag=unique("PDF");
  await add(asA,p,[{title:tag+" Ton",description:"Schlüssel beim Hausmeister abholen. ÄÖÜ ß",category:"PDF Ton",day:"2027-07-12",deadline:"2027-07-11T18:00",assignee:tenants.a.users.full.id,priority:3,status:"done",checklist:[{title:"Mikrofone verkabeln",done:true}]},
    {title:tag+" Licht",category:"PDF Licht",day:"2027-07-13",priority:2}]);
  const exportUrl=(filters:any)=>"/taskPlanning/export.php?"+new URLSearchParams({projects_id:String(p),filters:JSON.stringify(filters),checklists:"1"});
  for(const [type,filters] of [["filtered",{search:tag,categories:["PDF Ton"],sort:"date",group:"day"}],["all",{sort:"date",group:"category"}],["empty",{search:"no-such-task-"+tag,group:"category"}]] as const) {
    const download=page.waitForEvent("download");await page.goto(exportUrl(filters));await (await download).saveAs("/tmp/task-plan-"+type+".pdf");
    const info=execFileSync("pdfinfo",["/tmp/task-plan-"+type+".pdf"],{encoding:"utf8"});expect(info).toMatch(/595.28 x 841.89 pts \(A4\)/);
    const text=execFileSync("pdftotext",["-layout","/tmp/task-plan-"+type+".pdf","-"],{encoding:"utf8"});
    if(type!=="empty"){expect(text).toContain(tag+" Ton");expect(text).toContain("Mikrofone verkabeln");expect(text).toContain("Dringend");}
    if(type==="filtered")expect(text).not.toContain(tag+" Licht");
    if(type==="all")expect(text).toContain(tag+" Licht");
    if(type==="empty")expect(text).toContain("Keine Aufgaben in dieser Auswahl");
    await expect(page.locator("#pdf-error")).toBeEmpty();
  }
  await add(asA,p,Array.from({length:18},(_,i)=>({title:tag+" Long PDF "+i,category:"Long",description:"Ausführlicher Aufgabenplan mit Platz für Details. ".repeat(12),day:"2027-07-12"})));
  const download=page.waitForEvent("download");await page.goto(exportUrl({search:tag+" Long PDF",sort:"date",group:"category"}));await (await download).saveAs("/tmp/task-plan-multipage.pdf");
  expect(Number(execFileSync("pdfinfo",["/tmp/task-plan-multipage.pdf"],{encoding:"utf8"}).match(/Pages:\s+(\d+)/)?.[1])).toBeGreaterThan(1);
  expect(execFileSync("pdftotext",["/tmp/task-plan-multipage.pdf","-"],{encoding:"utf8"})).toContain("Long PDF 17");
});

test("TickTick OAuth/encryption and sync contract reconcile failures, update IDs and isolate connections",async({asA,tenants})=>{
  const p=tenants.a.projectId,user=tenants.a.users.full.id;
  const out=execFileSync(PHP_BINARY,["e2e/setup/task-ticktick.php",String(tenants.a.instanceId),String(user),String(p)],{cwd:"..",env:{...process.env,...APP_ENV},encoding:"utf8"});
  expect(out).toContain("PASS TickTick contract");
  const r=await read(asA,p);expect(r.data.tick.connected).toBe(false);
  expect((await send(asA,p,"connect",{})).json.error.message).toContain("configure");
});

test("manual ordering, invalid input correction, multiple categories and XSS-safe rendering work in the browser",async({asA,tenants,page})=>{
  test.setTimeout(90000);await browser(page,asA);
  const p=tenants.a.projectId,tag=unique("Order");
  const rows=await add(asA,p,[{title:tag+" A",category:"Order Ton",day:"2027-07-12"},{title:tag+" B",category:"Order Licht",day:"2027-07-12"},{title:tag+" C",category:"Order Logistik",day:"2027-07-13"}]);
  await page.goto("/project/?id="+p+"#task-planning-view");await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-search").fill(tag);await page.locator(".tp-row").nth(1).locator('[data-action="expand"]').click();
  await page.locator(".tp-row").nth(1).locator('[data-action="up"]').click();await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await expect(page.locator(".tp-title").first()).toHaveValue(tag+" B");
  await page.reload();await expect(page.locator("#tp-save")).toHaveText("All changes saved");await page.locator("#tp-search").fill(tag);
  await expect(page.locator(".tp-title").first()).toHaveValue(tag+" B");
  await page.locator("#tp-categories").selectOption(["Order Ton","Order Licht"]);await expect(page.locator(".tp-row")).toHaveCount(2);
  await page.locator("#tp-from").fill("2027-07-12");await page.locator("#tp-to").fill("2027-07-12");await expect(page.locator(".tp-row")).toHaveCount(2);
  const row=page.locator(".tp-row").first();await row.locator(".tp-title").fill("");await row.locator(".tp-title").press("Enter");
  await expect(page.locator("#tp-error")).toContainText("valid text");await row.locator(".tp-title").fill(tag+" Corrected");await row.locator(".tp-title").press("Enter");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  // Drag operates on the same stored manual ordering, while field edits never enable markup.
  await page.locator("#tp-reset").click();await page.locator("#tp-search").fill(tag);
  const before=await page.locator(".tp-title").evaluateAll(els=>els.map(el=>(el as HTMLInputElement).value));
  await page.locator(".tp-row").nth(2).locator('[data-action="drag"]').dragTo(page.locator(".tp-row").first());
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");await expect(page.locator(".tp-title").first()).toHaveValue(before[2]);
  const xss='</textarea><script>window.taskXss=1</script><img src=x onerror="window.taskXss=2">';
  await add(asA,p,[{title:tag+" "+xss,description:xss,category:xss,checklist:[{title:xss}]}]);
  const r=await write(asA,p,"saveTemplate",{name:xss,items:[{title:xss,category:xss,description:xss}]});
  await page.reload();await expect(page.locator("#tp-save")).toHaveText("All changes saved");await page.locator("#tp-search").fill(tag);
  await expect(page.locator(".tp-row")).toHaveCount(4);
  expect(await page.evaluate(()=>(window as any).taskXss)).toBeUndefined();
  await page.locator("#tp-packages").click();await page.locator("#tp-package-select").selectOption(String(r.ids[0]));await page.locator("#tp-package-edit").click();
  await expect(page.locator("#tp-package-name")).toHaveValue(xss);expect(await page.evaluate(()=>(window as any).taskXss)).toBeUndefined();
  const layout=await page.locator("#task-planner").evaluate(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
  expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
  await page.locator("#tp-package-cancel").click();await page.locator("#tp-packages").click();await page.locator("#tp-reset").click();await page.locator("#tp-search").fill(tag);
  await page.screenshot({path:"/tmp/task-planning-full-desktop.png",fullPage:true});
});

test("OAuth callback strips codes from analytics and rejects stale state without exposing credentials",async({asA,tenants})=>{
  const marker="callback-sensitive-"+randomUUID();
  const r=await asA.page("/taskPlanning/callback.php?state="+marker+"&code="+marker);
  expect(r.body).not.toContain(marker);
  const logs=dbQuery<any>("SELECT analyticsEvents_payload FROM analyticsEvents WHERE users_userid=? AND analyticsEvents_path='/taskPlanning/callback.php' ORDER BY analyticsEvents_timestamp DESC LIMIT 10",[tenants.a.users.full.id]);
  expect(logs.every((l:any)=>!String(l.analyticsEvents_payload).includes(marker))).toBe(true);
});

test("missing reference dates, DST gaps and invalid saved filters refuse changes atomically",async({asA,tenants})=>{
  const p=tenants.a.projectId,r=await write(asA,p,"saveTemplate",{name:unique("Relative only"),items:[{title:"Before",offset:-14}]});
  const dates=dbQuery<any>("SELECT projects_dates_use_start FROM projects WHERE projects_id=?",[p])[0];
  try{
    dbQuery("UPDATE projects SET projects_dates_use_start=NULL WHERE projects_id=?",[p]);
    const preview=await asA.api(endpoint,{action:"preview",projects_id:p,template_id:r.ids[0]});
    expect(preview.json.result).toBe(false);expect(preview.json.error.message).toContain("reference date");
  }finally{dbQuery("UPDATE projects SET projects_dates_use_start=? WHERE projects_id=?",[dates.projects_dates_use_start,p]);}
  expect(succeeded(await send(asA,p,"create",{items:[{title:"Nonexistent time",day:"2027-03-28",time:"02:30"}]}))).toBe(false);
  expect(succeeded(await send(asA,p,"saveFilter",{name:"Bad filter",value:{from:"2027-07-13",to:"2027-07-12"}}))).toBe(false);
  expect(succeeded(await send(asA,p,"saveFilter",{name:"Bad sort",value:{sort:"sql injection"}}))).toBe(false);
});

test("typing continues while a previous autosave response arrives without losing the active field",async({asA,tenants,page})=>{
  test.setTimeout(60000);await browser(page,asA);
  const p=tenants.a.projectId,title=unique("Fast typing"),[t]=await add(asA,p,[{title}]);
  await page.goto("/project/?id="+p+"#task-planning-view");await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  await page.locator("#tp-search").fill(title);
  let delayed=false;
  await page.route("**/api/taskPlanning/action.php",async route=>{
    if(!delayed && new URLSearchParams(route.request().postData() || "").get("action")==="update"){
      delayed=true;const response=await route.fetch();await new Promise(r=>setTimeout(r,400));await route.fulfill({response});
    }else await route.continue();
  });
  const row=page.locator('[data-task="'+t.id+'"]');
  await row.locator('[data-field="category"]').fill("Fast category");await row.locator('[data-field="category"]').press("Enter");
  await row.locator(".tp-title").fill(title+" edited while saving");
  await expect(page.locator("#tp-save")).toHaveText("All changes saved");
  const saved=(await read(asA,p)).data.tasks.find((x:any)=>x.id===t.id);
  expect(saved).toMatchObject({title:title+" edited while saving",category:"Fast category"});
});
