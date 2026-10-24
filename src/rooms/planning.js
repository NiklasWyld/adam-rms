/* Room planning uses UTC instants for layout and the business timezone for every label. */
(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', function () {
        const root = document.getElementById('room-planning');
        if (!root) return;
        const $id = id => document.getElementById(id);
        const global = root.dataset.global === '1';
        let data, csrf, anchor, mode = 'list', busy = false, started = false, booking, master, previewTimer, previewSerial = 0;
        const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
        const showError = (id, message) => { const n = $id(id); n.textContent = message || ''; n.hidden = !message; };
        const status = text => { $id('room-status').textContent = text; };
        const roomName = room => room.rooms_name + (room.rooms_number ? ' (' + room.rooms_number + ')' : '');
        const projectUrl = id => root.dataset.projectUrl + '?id=' + encodeURIComponent(id) + '#room-planning-view';
        const exportUrl = type => root.dataset.export + '?id=' + encodeURIComponent(root.dataset.project) + '&type=' + type;
        async function api(action, fields = {}) {
            const period = global && data ? {from:range().from,to:range().to} : {};
            const body = new URLSearchParams({action, projects_id: root.dataset.project, ...period, ...fields});
            if (csrf) body.set('csrf', csrf);
            const response = await fetch(root.dataset.endpoint, {method: 'POST', credentials: 'same-origin', body});
            let result;
            try { result = await response.json(); } catch (_) { throw new Error('The server did not return room planning. Reload the page and sign in if needed.'); }
            if (!response.ok || !result.result) throw new Error(result.error?.message || result.message || 'Room planning could not be loaded.');
            return result.response;
        }
        function localDate(date = new Date()) {
            const p = new Intl.DateTimeFormat('en-CA', {timeZone: data.timeZone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(date);
            return ['year','month','day'].map(k => p.find(x => x.type === k).value).join('-');
        }
        function addDays(day, n) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); }
        function midnight(day) {
            const target = Date.parse(day + 'T00:00:00Z');
            let guess = target;
            const fmt = new Intl.DateTimeFormat('en-GB', {timeZone:data.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
            for (let i = 0; i < 4; i++) {
                const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
                const local = Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
                const correction = target - local;
                guess += correction;
                if (!correction) break;
            }
            return guess;
        }
        function range() {
            const scale = $id('room-timeline-scale').value;
            let from = anchor, to;
            if (scale === 'week') {
                from = addDays(from, -((new Date(from + 'T12:00:00Z').getUTCDay() + 6) % 7));
                to = addDays(from, 7);
            } else if (scale === 'month') {
                from = from.slice(0,7) + '-01';
                const d = new Date(from + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
                to = d.toISOString().slice(0,10);
            } else to = addDays(from, 1);
            return {from, to, start:midnight(from), end:midnight(to), scale};
        }
        async function load() {
            if (busy) return;
            busy = true;
            if (global) ['room-period-previous','room-period-next','room-period-today','room-timeline-date','room-timeline-scale'].forEach(id => $id(id).disabled = true);
            status('Loading room planning…'); showError('room-error', '');
            try {
                const fields = global && data ? {from:range().from,to:range().to} : {};
                accept(await api('data', fields));
                status('Room planning is up to date.');
            } catch (e) { showError('room-error',e.message); status('Could not load room planning.'); }
            finally { busy = false; if (global) ['room-period-previous','room-period-next','room-period-today','room-timeline-date','room-timeline-scale'].forEach(id => $id(id).disabled = false); }
        }
        function accept(result) {
            csrf = result.csrf; data = result.data;
            if (!anchor) anchor = !global && data.bookings?.length ? data.bookings[0].start.slice(0,10) : localDate();
            $id('room-timeline-date').value = anchor;
            render();
        }
        function optionList(select, values, selected) {
            select.replaceChildren(...values.map(([value,label]) => { const o=el('option',label); o.value=value; return o; }));
            select.value = selected || '';
        }
        function render() {
            const p = data.permissions;
            $id('room-zone').textContent = data.timeZone;
            $id('booking-zone').textContent = 'All times: ' + data.timeZone + '. Confirmed is an internal, manually set status.';
            if (!global) {
                $id('room-add-booking').disabled = !p.editBookings || !data.rooms.some(r => +r.rooms_active);
                $id('room-add-booking').title = !p.editBookings ? 'Room planning is read-only for your role or this archived project.' : 'Add a reservation';
                $id('room-generate-request').disabled = false;
                $id('room-export').href = exportUrl('plan');
                $id('room-readonly').hidden = p.editBookings;
                $id('room-empty-rooms').hidden = !p.editBookings || data.rooms.some(r => +r.rooms_active);
                $id('room-readonly').textContent = 'Read-only: your role cannot edit room planning, or this project is archived. Ask a business administrator for Projects: Room Planning: Edit.';
                if (p.editBookings && !data.rooms.some(r => +r.rooms_active)) status('Create an active room in Rooms before adding a reservation.');
            }
            ['rooms','confirmed','open','requested','conflicts'].forEach(k => {
                const id = k === 'rooms' ? 'room-count' : 'room-' + k;
                if ($id(id)) $id(id).textContent = k === 'requested' ? data.summary[k] + ' already requested' : data.summary[k];
            });
            optionList($id('room-filter'), [['','All rooms'],...data.rooms.map(r => [r.rooms_id,roomName(r)])],$id('room-filter').value);
            optionList($id('room-status-filter'), [['','All statuses'],...Object.entries(data.statuses)],$id('room-status-filter').value);
            renderCatalogue();
            renderBookings();
            renderRequest();
        }
        function renderCatalogue() {
            const table = $id('room-catalogue-table');
            if (!table) return;
            const needle = $id('room-catalogue-search').value.toLocaleLowerCase();
            const active = $id('room-active-filter').value;
            const body = table.tBodies[0]; body.replaceChildren();
            data.rooms.filter(r => (active === '' || String(r.rooms_active) === active) && [r.rooms_name,r.rooms_number,r.building,r.rooms_equipment,r.rooms_description].join(' ').toLocaleLowerCase().includes(needle)).forEach(r => {
                const row=el('tr'); row.dataset.room=r.rooms_id;
                [roomName(r),r.building || '—',r.rooms_capacity || '—'].forEach(t => row.append(el('td',t)));
                const details=el('td', [r.rooms_description,r.rooms_equipment && 'Equipment: '+r.rooms_equipment,r.rooms_notes && 'Notes: '+r.rooms_notes].filter(Boolean).join('\n'), 'rp-description');
                row.append(details,el('td',+r.rooms_active ? 'Active' : 'Inactive'));
                const actions=el('td');
                if(data.permissions.manageRooms) { const edit=el('button','Edit','btn btn-sm btn-outline-primary'); edit.type='button'; edit.addEventListener('click',()=>openRoom(r)); actions.append(edit); }
                row.append(actions); body.append(row);
            });
            if(!body.children.length) { const cell=el('td','No rooms match these filters.'); cell.colSpan=6; const row=el('tr');row.append(cell);body.append(row); }
            if ($id('room-timezone')) optionList($id('room-timezone'), (data.timeZones || [data.timeZone]).map(z=>[z,z]),data.timeZone);
        }
        function filtered() {
            const room=$id('room-filter').value, s=$id('room-status-filter').value, from=$id('room-filter-from').value,to=$id('room-filter-to').value;
            const a=from?midnight(from):null, b=to?midnight(addDays(to,1)):null;
            return (data.bookings || []).filter(r => (!room || String(r.rooms_id)===room) && (!s || r.roomReservations_status===s) && (a===null || Date.parse(r.endUtc)>a) && (b===null || Date.parse(r.startUtc)<b));
        }
        function conflictNodes(target, conflicts) {
            if(!conflicts?.length) { target.append(el('span','No active overlap','text-muted')); return; }
            conflicts.forEach(c => {
                const item=el('div',undefined,'mb-2');
                item.append(el('strong',c.severity==='confirmed'?'Confirmed overlap: ':'Potential overlap: '));
                const link=el('a',c.projects_name);link.href=projectUrl(c.projects_id);item.append(link);
                item.append(el('div',c.period+' · '+data.statuses[c.roomReservations_status],'small'));
                target.append(item);
            });
        }
        function renderBookings() {
            const bookings=filtered(), body=$id('room-bookings-table').tBodies[0];body.replaceChildren();
            $id('room-shown').textContent=bookings.length+' of '+(data.bookings?.length || 0)+' reservations'+(global?' · '+range().from+' – '+addDays(range().to,-1):'');
            bookings.forEach(r=>{
                const row=el('tr');row.dataset.booking=r.roomReservations_id;
                const name=el('td');name.append(el('strong',roomName(r)),el('div',r.building || '', 'small text-muted'));row.append(name,el('td',r.period,'rp-interval'));
                const purpose=el('td',r.roomReservations_purpose,'rp-description');if(r.roomReservations_notes)purpose.append(el('div',r.roomReservations_notes,'small text-muted'));row.append(purpose);
                const sc=el('td'), badge=el('span',data.statuses[r.roomReservations_status],'badge rp-'+r.roomReservations_status);
                if(data.permissions.editBookings){
                    const select=el('select',undefined,'form-control form-control-sm rp-status-select');select.setAttribute('aria-label','Status for '+roomName(r)); optionList(select,Object.entries(data.statuses),r.roomReservations_status);
                    select.addEventListener('change',async()=>{
                        select.disabled=true;showError('room-error','');
                        try {accept(await api('setStatus',{id:r.roomReservations_id,revision:r.roomReservations_revision,status:select.value}));status('Reservation status saved.');}
                        catch(e){select.value=r.roomReservations_status;showError('room-error',e.message);}finally{select.disabled=false;}
                    });sc.append(select,badge);
                } else sc.append(badge);
                const overlaps=el('td');conflictNodes(overlaps,r.conflicts);if(r.conflicts?.length)row.classList.add(r.conflicts.some(c=>c.severity==='confirmed')?'rp-conflict-confirmed':'rp-conflict-potential');row.append(sc,overlaps);
                if(global){const cell=el('td'),a=el('a',r.projects_name);a.href=projectUrl(r.projects_id);cell.append(a);row.append(cell);}
                const actions=el('td'), edit=el('button',data.permissions.editBookings?'Edit':'Details','btn btn-sm btn-outline-primary mb-1');edit.type='button';edit.addEventListener('click',()=>openBooking(r));actions.append(edit);
                if(data.permissions.editBookings){const remove=el('button','Remove','btn btn-sm btn-outline-danger ml-1 mb-1');remove.type='button';remove.addEventListener('click',async()=>{
                    if(!window.confirm('Remove this reservation for '+roomName(r)+'?'))return;
                    remove.disabled=true;try{accept(await api('deleteBooking',{id:r.roomReservations_id,revision:r.roomReservations_revision}));status('Reservation removed.');}catch(e){showError('room-error',e.message);remove.disabled=false;}
                });actions.append(remove);}
                row.append(actions);body.append(row);
            });
            if(!bookings.length){const row=el('tr'),cell=el('td','No reservations match this view.');cell.colSpan=global?7:6;row.append(cell);body.append(row);}
            renderTimeline(bookings);
        }
        function renderTimeline(bookings) {
            const view=$id('room-timeline');view.replaceChildren();
            if(!anchor || !data.permissions.viewBookings)return;
            const period=range(), span=period.end-period.start;
            const days=Math.round((Date.parse(period.to)-Date.parse(period.from))/86400000);
            const width=period.scale==='day'?Math.round(span/3600000)*54:days*(period.scale==='week'?145:62);
            $id('room-timeline-range').textContent=period.from+' – '+addDays(period.to,-1)+' · '+data.timeZone;
            const inner=el('div',undefined,'rp-timeline-inner');inner.style.minWidth=(width+180)+'px';
            const head=el('div',undefined,'rp-timeline-row rp-timeline-head'),label=el('div','Room','rp-resource'),track=el('div',undefined,'rp-track');track.style.width=width+'px';head.append(label,track);
            const ticks=[];
            if(period.scale==='day'){for(let ms=period.start;ms<period.end;ms+=3600000)ticks.push(ms);}
            else for(let d=period.from;d<period.to;d=addDays(d,1))ticks.push(midnight(d));
            const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:data.timeZone,...(period.scale==='day'?{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}:{weekday:period.scale==='week'?'short':undefined,day:'2-digit',month:'2-digit'})});
            ticks.forEach((ms,i)=>{const tick=el('div',fmt.format(ms),'rp-tick');tick.style.left=((ms-period.start)/span*width)+'px';tick.style.width=(((ticks[i+1] || period.end)-ms)/span*width)+'px';track.append(tick);});
            inner.append(head);
            const roomFilter=$id('room-filter').value;
            const visible=bookings.filter(r=>Date.parse(r.startUtc)<period.end && Date.parse(r.endUtc)>period.start);
            const rooms=global?data.rooms.filter(r=>(!roomFilter || String(r.rooms_id)===roomFilter) && (+r.rooms_active || visible.some(b=>String(b.rooms_id)===String(r.rooms_id)))):data.rooms.filter(r=>visible.some(b=>String(b.rooms_id)===String(r.rooms_id)));
            rooms.forEach(room=>{
                const row=el('div',undefined,'rp-timeline-row'),resource=el('div',roomName(room),'rp-resource'),lane=el('div',undefined,'rp-track');lane.style.width=width+'px';
                resource.title=[roomName(room),room.building].filter(Boolean).join(' · ');
                ticks.forEach(ms=>{const tick=el('div',undefined,'rp-tick');tick.style.left=((ms-period.start)/span*width)+'px';lane.append(tick);});
                const ends=[];
                visible.filter(r=>String(r.rooms_id)===String(room.rooms_id)).sort((a,b)=>Date.parse(a.startUtc)-Date.parse(b.startUtc)).forEach(r=>{
                    const start=Date.parse(r.startUtc),end=Date.parse(r.endUtc);
                    let index=ends.findIndex(ms=>ms<=start);if(index<0)index=ends.length;ends[index]=end;
                    const overlaps=r.conflicts?.length,confirmed=r.conflicts?.some(c=>c.severity==='confirmed');
                    const bar=el('button',(overlaps?'⚠ ':'')+r.roomReservations_purpose+(global?' · '+r.projects_name:''),'rp-bar rp-'+r.roomReservations_status+(overlaps?(confirmed?' rp-conflict-confirmed':' rp-conflict-potential'):''));
                    bar.type='button';bar.style.left=((Math.max(start,period.start)-period.start)/span*width)+'px';bar.style.width=(Math.max(4,(Math.min(end,period.end)-Math.max(start,period.start))/span*width))+'px';bar.style.top=(8+index*31)+'px';
                    bar.title=roomName(room)+' · '+r.projects_name+'\n'+r.period+'\n'+data.statuses[r.roomReservations_status]+(overlaps?' · Overlap':'');
                    bar.setAttribute('aria-label',bar.title);bar.dataset.booking=r.roomReservations_id;bar.addEventListener('click',()=>openBooking(r));lane.append(bar);
                });
                row.style.height=Math.max(55,ends.length*31+16)+'px';row.append(resource,lane);inner.append(row);
            });
            if(!rooms.length)inner.append(el('p','No reservations in this period. Use the date or arrow buttons to change the period.','p-3'));
            view.append(inner);
            const legend=$id('room-legend');legend.replaceChildren();Object.entries(data.statuses).forEach(([s,t])=>legend.append(el('span',t,'badge rp-'+s+' mr-2')));legend.append(el('span','⚠ Overlap (red: confirmed, amber: potential)','small'));
        }
        function openBooking(record) {
            booking=record || null;showError('room-booking-error','');$id('room-preview').replaceChildren();previewSerial++;
            const editable=data.permissions.editBookings;
            $id('room-booking-title').textContent=record?(editable?'Edit reservation':'Reservation details'):'Add Room';
            optionList($id('booking-room'),[['','Choose a room'],...data.rooms.filter(r=>+r.rooms_active || String(r.rooms_id)===String(record?.rooms_id)).map(r=>[r.rooms_id,roomName(r)+(+r.rooms_active?'':' (inactive)')])],record?.rooms_id);
            const day=data.project?.projects_dates_use_start?.slice(0,10) || anchor || localDate();
            $id('booking-start').value=record?.start || day+'T08:00';
            $id('booking-end').value=record?.end || day+'T22:00';
            $id('booking-purpose').value=record?.roomReservations_purpose || '';
            $id('booking-notes').value=record?.roomReservations_notes || '';
            optionList($id('booking-status'),Object.entries(data.statuses),record?.roomReservations_status || 'planned');
            ['room','start','end','purpose','notes','status'].forEach(k=>$id('booking-'+k).disabled=!editable);
            $id('booking-save').hidden=!editable;
            const link=$id('booking-project-link');link.hidden=!global;link.href=record?projectUrl(record.projects_id):'#';
            roomDetails();if(record)conflictNodes($id('room-preview'),record.conflicts);
            window.jQuery('#room-booking-modal').modal('show');
        }
        function roomDetails() {
            const room=data.rooms.find(r=>String(r.rooms_id)===$id('booking-room').value);
            $id('booking-room-details').textContent=room?[room.building,room.rooms_capacity && 'Capacity: '+room.rooms_capacity,room.rooms_equipment].filter(Boolean).join(' · '):'';
        }
        function bookingFields() {
            const fields={id:booking?.roomReservations_id || '',revision:booking?.roomReservations_revision || ''};
            ['room','start','end','purpose','notes','status'].forEach(k=>fields[k==='room'?'roomId':k]=$id('booking-'+k).value);
            return fields;
        }
        function preview() {
            roomDetails();clearTimeout(previewTimer);const serial=++previewSerial;
            if(!data.permissions.editBookings)return;
            const fields=bookingFields();
            if(!fields.roomId || !fields.start || !fields.end)return;
            $id('room-preview').textContent='Checking overlaps…';
            previewTimer=setTimeout(async()=>{
                try {const result=await api('check',fields);if(serial!==previewSerial)return;$id('room-preview').replaceChildren();conflictNodes($id('room-preview'),result.conflicts);}
                catch(e){if(serial===previewSerial)$id('room-preview').textContent=e.message;}
            },350);
        }
        function openRoom(record) {
            master=record || null;showError('room-master-error','');$id('room-master-title').textContent=record?'Edit room':'Add Room';
            ['name','number','building','capacity','description','equipment','notes'].forEach(k=>$id('master-'+k).value=record?.['rooms_'+k] || '');
            $id('master-active').value=record?String(record.rooms_active):'1';
            optionList($id('master-location'),[['','No linked location'],...(data.locations || []).map(l=>[l.locations_id,l.locations_name+(+l.locations_archived?' (archived)':'')])],record?.locations_id);
            window.jQuery('#room-master-modal').modal('show');
        }
        function renderRequest() {
            if(!data.request)return;
            $id('room-request-subject').value=data.request.subject;
            $id('room-request-body').value=data.request.body;
            $id('room-open-mail').href='mailto:?subject='+encodeURIComponent(data.request.subject)+'&body='+encodeURIComponent(data.request.body);
            $id('room-request-pdf').href=exportUrl('request');
        }
        async function changePeriod() { $id('room-timeline-date').value=anchor;if(global)await load();else renderBookings(); }
        ['room-filter','room-status-filter','room-filter-from','room-filter-to'].forEach(id=>$id(id).addEventListener('change',()=>{if(data)renderBookings();}));
        $id('room-clear-filters').addEventListener('click',()=>{['room-filter','room-status-filter','room-filter-from','room-filter-to'].forEach(id=>$id(id).value='');renderBookings();});
        ['list','timeline'].forEach(view=>$id('room-'+view+'-view').addEventListener('click',()=>{
            mode=view;['list','timeline'].forEach(v=>{$id('room-'+v+'-panel').hidden=v!==mode;$id('room-'+v+'-view').classList.toggle('active',v===mode);$id('room-'+v+'-view').setAttribute('aria-pressed',String(v===mode));$id('room-'+v+'-view').classList.toggle('btn-primary',v===mode);$id('room-'+v+'-view').classList.toggle('btn-default',v!==mode);});if(data)renderBookings();
        }));
        $id('room-refresh').addEventListener('click',load);
        $id('room-timeline-date').addEventListener('change',()=>{const value=$id('room-timeline-date').value;if(/^\d{4}-\d\d-\d\d$/.test(value)){anchor=value;changePeriod();}});
        $id('room-timeline-scale').addEventListener('change',changePeriod);
        ['previous','next'].forEach(dir=>$id('room-period-'+dir).addEventListener('click',()=>{
            const r=range(),sign=dir==='next'?1:-1;
            if(r.scale==='month'){const d=new Date(r.from+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+sign);anchor=d.toISOString().slice(0,10);}
            else anchor=addDays(anchor,sign*(r.scale==='week'?7:1));changePeriod();
        }));
        $id('room-period-today').addEventListener('click',()=>{anchor=localDate();changePeriod();});
        if(!global){
            $id('room-add-booking').addEventListener('click',()=>openBooking());
            $id('room-generate-request').addEventListener('click',()=>{$id('room-copy-status').textContent='';window.jQuery('#room-request-modal').modal('show');});
        }
        ['room','start','end','status'].forEach(k=>$id('booking-'+k).addEventListener('input',preview));
        $id('room-booking-form').addEventListener('submit',async event=>{
            event.preventDefault();if(!data.permissions.editBookings)return;
            const button=$id('booking-save');if(button.disabled)return;button.disabled=true;showError('room-booking-error','');
            try {accept(await api('saveBooking',bookingFields()));window.jQuery('#room-booking-modal').modal('hide');status('Reservation saved. Overlaps have been checked again.');}
            catch(e){showError('room-booking-error',e.message);}finally{button.disabled=false;}
        });
        if($id('room-master-form'))$id('room-master-form').addEventListener('submit',async event=>{
            event.preventDefault();const button=$id('master-save');if(button.disabled)return;button.disabled=true;showError('room-master-error','');
            const fields={id:master?.rooms_id || '',revision:master?.rooms_revision || ''};
            ['name','number','building','capacity','description','equipment','notes','active'].forEach(k=>fields[k]=$id('master-'+k).value);fields.locationId=$id('master-location').value;
            try{accept(await api('saveRoom',fields));window.jQuery('#room-master-modal').modal('hide');status('Room saved.');}
            catch(e){showError('room-master-error',e.message);}finally{button.disabled=false;}
        });
        if($id('room-new'))$id('room-new').addEventListener('click',()=>{if(data)openRoom();});
        ['room-catalogue-search','room-active-filter'].forEach(id=>{if($id(id))$id(id).addEventListener('input',()=>{if(data)renderCatalogue();});});
        if($id('room-timezone-form'))$id('room-timezone-form').addEventListener('submit',async event=>{
            event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
            try{accept(await api('timezone',{timeZone:$id('room-timezone').value}));status('Business timezone saved. Stored reservation instants are unchanged.');}
            catch(e){showError('room-error',e.message);}finally{button.disabled=false;}
        });
        $id('room-copy-request').addEventListener('click',async()=>{
            try{await navigator.clipboard.writeText($id('room-request-body').value);$id('room-copy-status').textContent='Email text copied.';}
            catch(_){$id('room-request-body').focus();$id('room-request-body').select();$id('room-copy-status').textContent=document.execCommand('copy')?'Email text copied.':'Select the text above and copy it.';}
        });
        function start(){if(!started){started=true;if(global)$id('room-timeline-scale').value='month';load();}}
        if(global)start();
        else {
            window.jQuery('a[href="#room-planning-view"]').on('shown.bs.tab',start);
            if(location.hash==='#room-planning-view')start();
        }
    });
})();
