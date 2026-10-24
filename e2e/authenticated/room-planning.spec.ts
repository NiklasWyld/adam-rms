import fs from "fs";
import { execFileSync } from "child_process";
import { test, expect, dbQuery, succeeded, Session, newSession } from "../tenants";
import { cacheCdn } from "../cdn";
import { BASE_URL } from "../env";

const endpoint="/api/rooms/action.php";
const unique=(name:string)=>name+" "+Date.now()+" "+Math.random().toString(36).slice(2,7);
async function read(session:Session, project?:number, extra:Record<string,any>={}) {
  const result=await session.api(endpoint,{action:"data",projects_id:project || "",...extra});
  expect(result.json?.result,result.body).toBe(true);
  return result.json.response;
}
async function write(session:Session,action:string,project:number|undefined,fields:Record<string,any>={}) {
  const current=await read(session,project);
  const result=await session.api(endpoint,{action,projects_id:project || "",csrf:current.csrf,...fields});
  expect(result.json?.result,result.body).toBe(true);
  return result.json.response;
}
async function room(session:Session,fields:Record<string,any>={}) {
  const result=await write(session,"saveRoom",undefined,{name:unique("Aula"),building:"Schulhaus Süd",capacity:420,equipment:"Beamer, Lautsprecher, Bestuhlung",active:1,...fields});
  return result.data.rooms.find((r:any)=>r.rooms_id===result.id);
}
async function reserve(session:Session,project:number,roomId:number,fields:Record<string,any>={}) {
  const result=await write(session,"saveBooking",project,{roomId,start:"2027-07-12T08:00",end:"2027-07-12T22:00",purpose:unique("Veranstaltung und Aufbau"),status:"planned",...fields});
  return result.data.bookings.find((r:any)=>r.roomReservations_id===result.id);
}
async function browser(page:any,session:Session) {
  await page.context().addCookies((await session.request.storageState()).cookies);
  await cacheCdn(page.context());
}
const byRoom=(data:any,id:number)=>data.bookings.filter((r:any)=>r.rooms_id===id);

test("room catalogue persists all fields, links existing locations, edits and retires rooms without losing bookings",async({asA,tenants})=>{
  let r=await room(asA,{number:"105",locationId:tenants.a.locationId,description:"Für Generalprobe",notes:"Schlüssel im Sekretariat"});
  const booking=await reserve(asA,tenants.a.projectId,r.rooms_id);
  expect(r).toMatchObject({rooms_number:"105",rooms_capacity:420,locations_id:tenants.a.locationId,rooms_notes:"Schlüssel im Sekretariat"});
  const changed=await write(asA,"saveRoom",undefined,{id:r.rooms_id,revision:r.rooms_revision,name:r.rooms_name+" geändert",number:"106",building:"",locationId:tenants.a.locationId,capacity:"",description:"Neuer Raum",equipment:"Klavier",notes:"",active:0});
  r=changed.data.rooms.find((x:any)=>x.rooms_id===r.rooms_id);
  expect(r.building).toContain(tenants.a.marker);
  expect(r.rooms_capacity).toBeNull();
  expect(r.rooms_revision).toBe(2);
  expect((await read(asA,tenants.a.projectId)).data.bookings.find((x:any)=>x.roomReservations_id===booking.roomReservations_id).rooms_active).toBe(0);
  const current=await read(asA,tenants.a.projectId);
  expect(succeeded(await asA.api(endpoint,{action:"saveBooking",projects_id:tenants.a.projectId,csrf:current.csrf,roomId:r.rooms_id,start:"2027-07-15T08:00",end:"2027-07-15T10:00",purpose:"Inactive room",status:"planned"}))).toBe(false);
  expect(dbQuery("SELECT rooms_created, rooms_updated, users_userid, rooms_updatedBy FROM rooms WHERE rooms_id=?",[r.rooms_id])[0]).toMatchObject({users_userid:tenants.a.users.full.id,rooms_updatedBy:tenants.a.users.full.id});
});

test("repeated and multi-day reservations persist; touching intervals are free; active overlaps update after status, date and removal changes",async({asA,tenants})=>{
  const r=await room(asA),a=tenants.a.projectId,b=tenants.a.subProjectId;
  let first=await reserve(asA,a,r.rooms_id,{start:"2027-07-12T10:00",end:"2027-07-13T18:00",status:"confirmed"});
  let other=await reserve(asA,b,r.rooms_id,{start:"2027-07-13T15:00",end:"2027-07-14T20:00",status:"requested"});
  expect(other.conflicts).toHaveLength(1);
  expect(other.conflicts[0]).toMatchObject({projects_id:a,severity:"confirmed"});
  const touching=await reserve(asA,a,r.rooms_id,{start:"2027-07-14T20:00",end:"2027-07-14T22:00"});
  expect(touching.conflicts).toHaveLength(0);
  expect(byRoom((await read(asA,a)).data,r.rooms_id)).toHaveLength(2);
  for(const status of ["rejected","cancelled"]) {
    const updated=await write(asA,"setStatus",b,{id:other.roomReservations_id,revision:other.roomReservations_revision,status});
    other=updated.data.bookings.find((x:any)=>x.roomReservations_id===other.roomReservations_id);
    expect(other.conflicts).toHaveLength(0);
    expect(byRoom((await read(asA,a)).data,r.rooms_id).every((x:any)=>!x.conflicts.length)).toBe(true);
  }
  other=(await write(asA,"setStatus",b,{id:other.roomReservations_id,revision:other.roomReservations_revision,status:"planned"})).data.bookings.find((x:any)=>x.roomReservations_id===other.roomReservations_id);
  first=(await write(asA,"setStatus",a,{id:first.roomReservations_id,revision:first.roomReservations_revision,status:"requested"})).data.bookings.find((x:any)=>x.roomReservations_id===first.roomReservations_id);
  expect(first.conflicts[0].severity).toBe("potential");
  const check=await write(asA,"check",a,{id:first.roomReservations_id,roomId:r.rooms_id,start:"2027-07-12T10:00",end:"2027-07-13T18:00",status:"requested"});
  expect(check.conflicts).toHaveLength(1);
  first=await reserve(asA,a,r.rooms_id,{id:first.roomReservations_id,revision:first.roomReservations_revision,start:"2027-07-10T08:00",end:"2027-07-10T22:00",status:"requested"});
  expect(first.conflicts).toHaveLength(0);
  expect(byRoom((await read(asA,b)).data,r.rooms_id)[0].conflicts).toHaveLength(0);
  await write(asA,"deleteBooking",a,{id:first.roomReservations_id,revision:first.roomReservations_revision});
  expect(byRoom((await read(asA,a)).data,r.rooms_id)).toHaveLength(1);
  expect(dbQuery<any>("SELECT roomReservations_deleted FROM roomReservations WHERE roomReservations_id=?",[first.roomReservations_id])[0].roomReservations_deleted).toBe(1);
});

test("booking validation, optimistic revisions, UTC storage, DST and timezone changes protect saved data",async({asA,tenants})=>{
  const r=await room(asA),project=tenants.a.projectId;
  let first=await reserve(asA,project,r.rooms_id,{start:"2027-03-27T12:00",end:"2027-03-29T12:00"});
  expect(first.startUtc).toBe("2027-03-27T11:00:00Z");
  expect(first.endUtc).toBe("2027-03-29T10:00:00Z");
  const catalogue=await read(asA),count=catalogue.data.rooms.length;
  for(const range of [{from:"not-a-date",to:"2027-08-01"},{from:"2027-08-01",to:"2027-07-01"},{from:"2027-01-01",to:"2028-01-01"}]){
    expect(succeeded(await asA.api(endpoint,{action:"saveRoom",csrf:catalogue.csrf,name:"Invalid overview must not create me",building:"QA",active:1,...range}))).toBe(false);
  }
  expect((await read(asA)).data.rooms).toHaveLength(count);
  const current=await read(asA,project),base={action:"saveBooking",projects_id:project,csrf:current.csrf,roomId:r.rooms_id,start:"2027-07-12T08:00",end:"2027-07-12T22:00",purpose:"Valid",status:"planned"};
  for(const bad of [
    {start:"2027-03-28T02:30"},{start:"2027-02-30T08:00"},{end:"2027-07-12T08:00"},
    {end:"2027-07-11T22:00"},{start:"bad"},{status:"<script>"},{purpose:""},{purpose:[]},{purpose:"x".repeat(1001)},{notes:"x".repeat(8001)},{roomId:"1 OR 1=1"}
  ]) expect(succeeded(await asA.api(endpoint,{...base,...bad}))).toBe(false);
  await write(asA,"setStatus",project,{id:first.roomReservations_id,revision:first.roomReservations_revision,status:"confirmed"});
  expect((await asA.api(endpoint,{...base,id:first.roomReservations_id,revision:first.roomReservations_revision})).json.error.code).toBe("CONFLICT");
  try {
    await write(asA,"timezone",undefined,{timeZone:"UTC"});
    const changed=(await read(asA,project)).data.bookings.find((x:any)=>x.roomReservations_id===first.roomReservations_id);
    expect(changed.start).toBe("2027-03-27T11:00");expect(changed.startUtc).toBe(first.startUtc);
  }finally{await write(asA,"timezone",undefined,{timeZone:"Europe/Berlin"});}
});

test("tenant isolation, foreign locations, room and booking IDs, CSRF and permission checks cover every endpoint and both exports",async({asA,asLimitedA,tenants,playwright})=>{
  const anonymous=await playwright.request.newContext({baseURL:BASE_URL});
  try{expect(succeeded(await new Session(anonymous).api(endpoint,{projects_id:tenants.a.projectId}))).toBe(false);}finally{await anonymous.dispose();}
  const otherRequest=await playwright.request.newContext({baseURL:BASE_URL});
  const asB=await newSession(otherRequest,tenants.b.users.full.email,tenants.password);
  try {
    const r=await room(asA),foreign=await room(asB,{name:tenants.b.marker+" Raum"});
    const foreignBooking=await reserve(asB,tenants.b.projectId,foreign.rooms_id);
    const state=await read(asA,tenants.a.projectId),token=state.csrf;
    expect(JSON.stringify(state.data)).not.toContain(tenants.b.marker);
    const base={csrf:token,projects_id:tenants.a.projectId};
    for(const fields of [
      {action:"data",projects_id:tenants.b.projectId},
      {action:"saveRoom",projects_id:"",id:foreign.rooms_id,revision:1,name:"Hijack",active:1},
      {action:"saveRoom",projects_id:"",name:"Foreign location",locationId:tenants.b.locationId,active:1},
      {action:"saveBooking",roomId:foreign.rooms_id,start:"2027-07-12T08:00",end:"2027-07-12T22:00",purpose:"Hijack",status:"planned"},
      {action:"setStatus",id:foreignBooking.roomReservations_id,revision:1,status:"cancelled"},
      {action:"deleteBooking",id:foreignBooking.roomReservations_id,revision:1},
      {action:"check",roomId:foreign.rooms_id,start:"2027-07-12T08:00",end:"2027-07-12T22:00",status:"planned"},
      {action:"saveRoom",projects_id:"",name:"Missing csrf",active:1,csrf:"forged"}
    ]) expect(succeeded(await asA.api(endpoint,{...base,...fields}))).toBe(false);
    expect((await asA.page("/rooms/export.php?id="+tenants.b.projectId+"&type=plan")).body).not.toContain("room-pdf-data");
    expect((await asA.page("/rooms/export.php?id="+tenants.b.projectId+"&type=request")).body).not.toContain("room-pdf-data");
    expect((await asA.page("/rooms/export.php?id="+tenants.a.projectId+"&type[]=plan")).body).not.toContain("room-pdf-data");
    expect(succeeded(await asA.api(endpoint,{...base,action:"saveRoom",name:"GET mutation",active:1},"GET"))).toBe(false);
    const limited=await read(asLimitedA,tenants.a.projectId);
    expect(limited.data.permissions.editBookings).toBe(false);
    expect(succeeded(await asLimitedA.api(endpoint,{action:"saveBooking",projects_id:tenants.a.projectId,csrf:limited.csrf,roomId:r.rooms_id,start:"2027-07-12T08:00",end:"2027-07-12T22:00",purpose:"Denied",status:"planned"}))).toBe(false);
    expect(succeeded(await asLimitedA.api(endpoint,{action:"data"}))).toBe(false);
    const role=tenants.a.positions.limited,original=dbQuery<any>("SELECT instancePositions_actions FROM instancePositions WHERE instancePositions_id=?",[role])[0].instancePositions_actions;
    try {
      dbQuery("UPDATE instancePositions SET instancePositions_actions='ROOMS:VIEW' WHERE instancePositions_id=?",[role]);
      const catalogue=await read(asLimitedA);
      expect(catalogue.data.bookings).toHaveLength(0);
      expect(catalogue.data.locations).toHaveLength(0);
      expect(succeeded(await asLimitedA.api(endpoint,{action:"saveRoom",csrf:catalogue.csrf,name:"Denied",active:1}))).toBe(false);
      expect((await asLimitedA.page("/rooms/export.php?id="+tenants.a.projectId)).body).not.toContain("room-pdf-data");
      dbQuery("UPDATE instancePositions SET instancePositions_actions='' WHERE instancePositions_id=?",[role]);
      expect(succeeded(await asLimitedA.api(endpoint,{action:"data",projects_id:tenants.a.projectId}))).toBe(false);
    }finally{dbQuery("UPDATE instancePositions SET instancePositions_actions=? WHERE instancePositions_id=?",[original,role]);}
    expect(dbQuery<any>("SELECT roomReservations_status FROM roomReservations WHERE roomReservations_id=?",[foreignBooking.roomReservations_id])[0].roomReservations_status).toBe("planned");
  }finally{await otherRequest.dispose();}
});

test("shared-user switching, archived and deleted project and room records preserve isolation",async({asA,tenants,playwright})=>{
  const request=await playwright.request.newContext({baseURL:BASE_URL}),shared=await newSession(request,tenants.sharedUser.email,tenants.password);
  try{
    expect(succeeded(await shared.api(endpoint,{projects_id:tenants.a.projectId,instances_id:tenants.a.instanceId}))).toBe(true);
    expect(succeeded(await shared.api(endpoint,{projects_id:tenants.a.projectId,instances_id:tenants.b.instanceId}))).toBe(false);
    expect(succeeded(await shared.api(endpoint,{projects_id:tenants.b.projectId,instances_id:tenants.b.instanceId}))).toBe(true);
  }finally{await request.dispose();}
  const project=tenants.a.projectId,r=await room(asA),b=await reserve(asA,project,r.rooms_id);
  try {
    dbQuery("UPDATE projects SET projects_archived=1 WHERE projects_id=?",[project]);
    const current=await read(asA,project);expect(current.data.permissions.editBookings).toBe(false);
    expect(succeeded(await asA.api(endpoint,{action:"deleteBooking",projects_id:project,csrf:current.csrf,id:b.roomReservations_id,revision:1}))).toBe(false);
    dbQuery("UPDATE projects SET projects_deleted=1 WHERE projects_id=?",[project]);
    expect(succeeded(await asA.api(endpoint,{action:"data",projects_id:project}))).toBe(false);
    expect((await asA.page("/rooms/export.php?id="+project)).body).not.toContain("room-pdf-data");
  }finally{dbQuery("UPDATE projects SET projects_archived=0,projects_deleted=0 WHERE projects_id=?",[project]);}
  dbQuery("UPDATE rooms SET rooms_deleted=1 WHERE rooms_id=?",[r.rooms_id]);
  expect(byRoom((await read(asA,project)).data,r.rooms_id)).toHaveLength(0);
});

test("UI creates and edits a room and multi-day booking, previews cross-project conflicts, filters, switches timeline scales and persists changes",async({asA,tenants,page})=>{
  test.setTimeout(120000);await browser(page,asA);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  const name=unique("Musiksaal UI");
  await page.goto("/rooms/");await expect(page.locator("#room-status")).toContainText("up to date");
  await page.locator("#room-new").click();await page.locator("#master-name").fill(name);
  await page.locator("#master-number").fill("105");await page.locator("#master-building").fill("Hauptgebäude");
  await page.locator("#master-capacity").fill("35");await page.locator("#master-equipment").fill("Klavier, Beamer");
  await page.locator("#master-save").click();await expect(page.locator("#room-master-modal")).not.toBeVisible();
  await page.locator("#room-catalogue-search").fill(name);
  await expect(page.locator("#room-catalogue-table tbody")).toContainText("Klavier, Beamer");
  await page.locator("#room-catalogue-table button").click();await page.locator("#master-notes").fill("Schlüssel abholen");await page.locator("#master-save").click();
  await expect(page.locator("#room-master-modal")).not.toBeVisible();
  const r=(await read(asA)).data.rooms.find((x:any)=>x.rooms_name===name);
  await reserve(asA,tenants.a.subProjectId,r.rooms_id,{start:"2027-07-12T10:00",end:"2027-07-13T18:00",status:"confirmed"});
  await page.goto("/project/?id="+tenants.a.projectId+"#room-planning-view");
  await expect(page.locator("#room-add-booking")).toBeEnabled();
  await page.locator("#room-add-booking").click();await page.locator("#booking-room").selectOption(String(r.rooms_id));
  await page.locator("#booking-start").fill("2027-07-12T08:00");await page.locator("#booking-end").fill("2027-07-13T22:00");
  await page.locator("#booking-purpose").fill("Umkleide UI");await page.locator("#booking-notes").fill("Mehrtägig, ÄÖÜ ß");
  await expect(page.locator("#room-preview")).toContainText("Confirmed overlap");
  await page.locator("#booking-save").click();await expect(page.locator("#room-booking-modal")).not.toBeVisible();
  await page.locator("#room-filter").selectOption(String(r.rooms_id));
  await expect(page.locator("#room-bookings-table tbody tr[data-booking]")).toHaveCount(1);
  await expect(page.locator("#room-bookings-table tbody")).toContainText("Confirmed overlap");
  await page.locator("#room-timeline-view").click();await page.locator("#room-timeline-date").fill("2027-07-12");
  for(const scale of ["day","week","month"]){await page.locator("#room-timeline-scale").selectOption(scale);await expect(page.locator("#room-timeline .rp-bar")).toHaveCount(1);}
  await page.locator("#room-planning").screenshot({path:"/tmp/room-project-ui.png"});
  await page.locator("#room-timeline .rp-bar").click();await expect(page.locator("#booking-purpose")).toHaveValue("Umkleide UI");
  await page.locator("#booking-end").fill("2027-07-12T09:00");await page.locator("#booking-save").click();
  await expect(page.locator("#room-booking-modal")).not.toBeVisible();await page.locator("#room-list-view").click();
  await expect(page.locator("#room-bookings-table tbody")).toContainText("No active overlap");
  await page.locator("#room-bookings-table .rp-status-select").selectOption("requested");
  await expect(page.locator("#room-status")).toContainText("status saved");
  await page.reload();await expect(page.locator("#room-add-booking")).toBeEnabled();
  await page.locator("#room-filter").selectOption(String(r.rooms_id));
  await expect(page.locator("#room-bookings-table .rp-status-select")).toHaveValue("requested");
  await page.locator("#room-status-filter").selectOption("confirmed");await expect(page.locator("#room-bookings-table tbody")).toContainText("No reservations");
  await page.locator("#room-clear-filters").click();await page.locator("#room-filter").selectOption(String(r.rooms_id));
  await page.locator("#room-generate-request").click();await expect(page.locator("#room-request-body")).toHaveValue(new RegExp(name));
  await expect(page.locator("#room-open-mail")).toHaveAttribute("href",/^mailto:\?subject=/);
  await page.locator("#room-request-modal [data-dismiss=modal]").last().click();
  page.once("dialog",dialog=>dialog.accept());await page.locator("#room-bookings-table button",{}).filter({hasText:"Remove"}).click();
  await expect(page.locator("#room-bookings-table tbody")).toContainText("No reservations");
  await page.goto("/rooms/");await expect(page.locator("#room-status")).toContainText("up to date");
  await page.locator("#room-timeline-view").click();await page.locator("#room-timeline-date").fill("2027-07-12");
  await expect(page.locator("#room-timeline .rp-bar").filter({hasText:"Veranstaltung"}).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("read-only UI explains access and hides editing; date filters and business overview do not leak foreign rooms",async({asLimitedA,asA,tenants,page})=>{
  const r=await room(asA);await reserve(asA,tenants.a.projectId,r.rooms_id);
  await browser(page,asLimitedA);
  await page.goto("/project/?id="+tenants.a.projectId+"#room-planning-view");
  await expect(page.locator("#room-readonly")).toBeVisible();
  await expect(page.locator("#room-add-booking")).toBeDisabled();
  await page.locator("#room-filter").selectOption(String(r.rooms_id));
  await expect(page.locator("#room-bookings-table select")).toHaveCount(0);
  await page.locator("#room-filter-from").fill("2027-07-13");await expect(page.locator("#room-bookings-table tbody")).toContainText("No reservations");
  await page.locator("#room-clear-filters").click();await page.locator("#room-filter").selectOption(String(r.rooms_id));
  await page.locator("#room-bookings-table button").click();await expect(page.locator("#booking-save")).not.toBeVisible();
});

test("German email and both A4 PDF exports include the correct saved records, preserve statuses and support multi-page text",async({asA,tenants,page})=>{
  test.setTimeout(120000);
  const created=await asA.api("/api/projects/new.php",{projects_name:unique("Room PDF QA"),projects_manager:tenants.a.users.full.id,projectsType_id:tenants.a.projectTypeId,projects_dates_use_start:"2027-07-12 08:00",projects_dates_use_end:"2027-07-13 22:00"});
  expect(created.json?.result,created.body).toBe(true);
  const project=created.json.response.projects_id,r=await room(asA,{name:unique("PDF Aula ÄÖÜ ß")}),tag="PDF"+Math.random().toString(36).slice(2,8);
  const pending=await reserve(asA,project,r.rooms_id,{purpose:tag+" geplant",notes:"Schlüssel beim Hausmeister abholen."});
  await reserve(asA,project,r.rooms_id,{start:"2027-07-15T10:00",end:"2027-07-15T18:00",purpose:tag+" angefragt",status:"requested"});
  for(const status of ["confirmed","rejected","cancelled"])await reserve(asA,project,r.rooms_id,{start:"2027-07-16T10:00",end:"2027-07-16T18:00",purpose:tag+" "+status,status});
  const before=(await read(asA,project)).data;
  expect(before.request.body).toContain(tag+" geplant");expect(before.request.body).toContain(tag+" angefragt");expect(before.request.body).toContain("Schlüssel beim Hausmeister");
  for(const status of ["confirmed","rejected","cancelled"])expect(before.request.body).not.toContain(tag+" "+status);
  await browser(page,asA);
  for(const type of ["request","plan"]){
    await page.goto("/rooms/export.php?id="+project+"&type="+type);
    await expect(page.locator("#room-pdf-download")).toBeEnabled();
    const buffer=await page.evaluate(async()=>await new Promise<number[]>((resolve,reject)=>{
      try{(window as any).pdfMake.createPdf((window as any).roomPdfDefinition).getBuffer((bytes:Uint8Array)=>resolve(Array.from(bytes)));}catch(e){reject(e);}
    }));
    const path="/tmp/adam-room-"+type+".pdf";fs.writeFileSync(path,Buffer.from(buffer));
    const info=execFileSync("pdfinfo",[path],{encoding:"utf8"});expect(info).toMatch(/595\.28 x 841\.89 pts \(A4\)/);
    const text=execFileSync("pdftotext",["-layout",path,"-"],{encoding:"utf8"});expect(text).toContain(tag+" geplant");expect(text).toContain("Aula ÄÖÜ ß");expect(text).toContain("Schlüssel beim Hausmeister");
    for(const status of ["confirmed","rejected","cancelled"])expect(text.includes(tag+" "+status)).toBe(type==="plan");
  }
  const after=(await read(asA,project)).data;
  expect(after.bookings.map((x:any)=>[x.roomReservations_id,x.roomReservations_status,x.roomReservations_revision])).toEqual(before.bookings.map((x:any)=>[x.roomReservations_id,x.roomReservations_status,x.roomReservations_revision]));
  // A real download is verified separately from getBuffer, using exactly the visible button.
  const download=page.waitForEvent("download");await page.locator("#room-pdf-download").click();await (await download).saveAs("/tmp/adam-room-downloaded.pdf");
  expect(fs.statSync("/tmp/adam-room-downloaded.pdf").size).toBeGreaterThan(1000);
  for(let i=0;i<14;i++)await reserve(asA,project,r.rooms_id,{start:"2027-08-12T08:00",end:"2027-08-12T22:00",purpose:"Mehrseitige Anfrage "+i,notes:("Details zur Bestuhlung und zum Aufbau. ").repeat(45)});
  await page.goto("/rooms/export.php?id="+project+"&type=request");await expect(page.locator("#room-pdf-download")).toBeEnabled();
  const bytes=await page.evaluate(async()=>await new Promise<number[]>(resolve=>(window as any).pdfMake.createPdf((window as any).roomPdfDefinition).getBuffer((b:Uint8Array)=>resolve(Array.from(b)))));
  fs.writeFileSync("/tmp/adam-room-multipage.pdf",Buffer.from(bytes));
  const info=execFileSync("pdfinfo",["/tmp/adam-room-multipage.pdf"],{encoding:"utf8"});expect(Number(info.match(/Pages:\s+(\d+)/)?.[1])).toBeGreaterThan(1);
  const text=execFileSync("pdftotext",["/tmp/adam-room-multipage.pdf","-"],{encoding:"utf8"});expect(text).toContain("Mehrseitige Anfrage 13");expect(text).toContain("Vielen Dank");
});

test("timeline keeps business-local dates across browser zones and 23/25-hour DST days; saved text is never interpreted as markup",async({asA,tenants,browser})=>{
  test.setTimeout(120000);
  const r=await room(asA,{name:unique("DST <img src=x onerror=alert(1)>"),notes:"<script>alert('room')</script>"});
  await reserve(asA,tenants.a.projectId,r.rooms_id,{start:"2027-03-28T00:00",end:"2027-03-29T00:00",purpose:"<img src=x onerror=alert(2)>",notes:"<script>alert('booking')</script>"});
  await reserve(asA,tenants.a.projectId,r.rooms_id,{start:"2027-10-31T00:00",end:"2027-11-01T00:00",purpose:"DST autumn"});
  const context=await browser.newContext({baseURL:BASE_URL,timezoneId:"America/New_York"});
  try{
    await context.addCookies((await asA.request.storageState()).cookies);await cacheCdn(context);
    const page=await context.newPage(),dialogs:string[]=[];page.on("dialog",async d=>{dialogs.push(d.message());await d.dismiss();});
    await page.goto("/project/?id="+tenants.a.projectId+"#room-planning-view");await expect(page.locator("#room-add-booking")).toBeEnabled();
    await page.locator("#room-filter").selectOption(String(r.rooms_id));await page.locator("#room-timeline-view").click();await page.locator("#room-timeline-scale").selectOption("day");
    for(const [day,hours] of [["2027-03-28",23],["2027-10-31",25]] as const){
      await page.locator("#room-timeline-date").fill(day);await expect(page.locator("#room-timeline .rp-timeline-head .rp-tick")).toHaveCount(hours);
      await expect(page.locator("#room-timeline .rp-bar")).toHaveCount(1);
      const box=await page.locator("#room-timeline .rp-bar").boundingBox(),track=await page.locator("#room-timeline .rp-timeline-head .rp-track").boundingBox();expect(box!.width).toBeCloseTo(track!.width,0);
    }
    await page.locator("#room-list-view").click();await expect(page.locator("#room-bookings-table")).toContainText("<script>alert('booking')</script>");
    expect(await page.locator("#room-bookings-table img,#room-bookings-table script").count()).toBe(0);
    await page.goto("/rooms/export.php?id="+tenants.a.projectId);await expect(page.locator("#room-pdf-download")).toBeEnabled();
    expect(dialogs).toEqual([]);
  }finally{await context.close();}
});
