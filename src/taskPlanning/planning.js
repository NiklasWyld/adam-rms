/* AdamRMS task planning: DOM-only rendering, serial saves and optimistic revisions. */
(function () {
    'use strict';
    const root = document.getElementById('task-planner');
    if (!root) return;
    const $id = id => document.getElementById(id);
    const project = root.dataset.project;
    let data, csrf, queue = [], saving = false, failed = false, selected = new Set(), expanded = new Set(), drafts = new Map();
    let shown = [], preview = null, editing = null, dragged = null, busyQuick = false, syncing = false;
    const key = () => window.crypto.randomUUID().replace(/-/g, '');
    const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const options = (list, current, empty) => (empty !== undefined ? '<option value="">' + esc(empty) + '</option>' : '') + list.map(([v,n]) => '<option value="' + esc(v) + '"' + (String(v) === String(current) ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
    const priorities = () => data.priorities.map((n,i) => [i,n]);
    const statuses = () => Object.entries(data.statuses);
    const members = () => data.members.map(m => [m.id,m.name]);
    const projects = () => data.projects.map(p => [p.id,p.name]);
    const value = id => $id(id).value;
    const setStatus = text => { $id('tp-save').textContent = text; };
    function error(e) { $id('tp-error').textContent = e.message || String(e); $id('tp-error').hidden = false; }
    function clearError() { $id('tp-error').hidden = true; }
    async function request(action, payload, id, extra) {
        const form = new URLSearchParams({action, projects_id:project, csrf:csrf || '', payload:JSON.stringify(payload || {}), request_id:id || key(), ...extra});
        const response = await fetch(root.dataset.endpoint, {method:'POST', credentials:'same-origin', body:form, cache:'no-store'});
        if (!response.ok) throw new Error('The server could not be reached (HTTP ' + response.status + '). Your edits remain here.');
        let body;
        try { body = await response.json(); } catch (_) { throw new Error('The server returned an unexpected response. Your edits remain here.'); }
        if (!body.result) {
            const e = new Error(body.error && body.error.message || 'The task could not be saved.');
            e.code = body.error && body.error.code; throw e;
        }
        csrf = body.response.csrf;
        return body.response;
    }
    function receive(response, initialise) {
        data = response.data;
        if (initialise) initControls(); else refreshChoices();
        render();
        tickStatus();
    }
    function enqueue(job) {
        if (job.busy && $id(job.busy).disabled) return;
        if (job.busy) $id(job.busy).disabled = true;
        job.key = job.key || key(); queue.push(job); pump();
    }
    async function pump() {
        if (saving || failed || !queue.length) return;
        saving = true; setStatus('Saving…'); clearError();
        const job = queue[0];
        try {
            if (!job.payload) job.payload = job.build ? job.build() : {};
            const r = await request(job.action, job.payload, job.key);
            queue.shift();
            if (job.edits) job.edits.forEach(({id,patch}) => {
                const local = drafts.get(id) || {};
                Object.keys(patch).forEach(k => { if (same(local[k],patch[k])) delete local[k]; });
                if (!Object.keys(local).length) drafts.delete(id); else drafts.set(id,local);
            });
            receive(r, false);
            if (job.after) job.after(r);
            if (job.busy) $id(job.busy).disabled = false;
            setStatus(queue.length ? 'Saving…' : ((drafts.size || editTimers.size) ? 'Unsaved edits remain — correct the input or reload current versions' : 'All changes saved'));
        } catch (e) {
            error(e);
            if (e.code === 'PARAM-ERROR' || e.code === 'AUTH-ERROR' || e.code === 'NOT-FOUND') {
                // A definitive validation refusal committed nothing; let the user correct the visible input.
                queue.shift(); failed = false;
                if (job.busy) $id(job.busy).disabled = false;
                if (job.action === 'create') { busyQuick = false; $id('tp-add').disabled = false; }
                setStatus('Not saved — correct your input and try again');
                $id('tp-retry').hidden = true; $id('tp-reload').hidden = !drafts.size;
            } else {
                failed = true; setStatus('Not saved — your input is kept here');
                $id('tp-retry').hidden = false; $id('tp-reload').hidden = false; $id('tp-discard').hidden = false;
            }
        } finally { saving = false; if (!failed && queue.length) pump(); }
    }
    function editMany(edits, action) {
        edits.forEach(e => drafts.set(e.id, {...drafts.get(e.id), ...e.patch}));
        enqueue({action:action || 'update', edits, build:() => ({items:edits.map(e => {
            const t = data.tasks.find(t => t.id === e.id);
            if (!t) throw new Error('This task is no longer visible. Reload the current version.');
            return {id:e.id, revision:t.revision, patch:e.patch};
        })})});
    }
    function edit(id, patch) { editMany([{id,patch:{...drafts.get(id),...patch}}]); }
    function displayedTasks() { return data.tasks.map(t => ({...t, ...drafts.get(t.id)})); }
    function filters() {
        const mult = id => Array.from($id(id).selectedOptions).map(o => o.value);
        return {search:value('tp-search'), from:value('tp-from'), to:value('tp-to'), categories:mult('tp-categories'),
            assignees:mult('tp-assignees'), priorities:mult('tp-priorities'), statuses:mult('tp-statuses'),
            sort:value('tp-sort'), group:value('tp-group')};
    }
    function applyFilters(f) {
        ['search','from','to','sort','group'].forEach(k => { $id('tp-'+k).value = f[k] || (k === 'sort' ? 'manual' : ''); });
        ['categories','assignees','priorities','statuses'].forEach(k => {
            Array.from($id('tp-'+k).options).forEach(o => o.selected = (f[k] || []).map(String).includes(o.value));
            if (window.jQuery) window.jQuery($id('tp-'+k)).trigger('change.select2');
        });
        render();
    }
    function filtered() {
        const f = filters(), q = f.search.trim().toLocaleLowerCase();
        if (f.from && f.to && f.from > f.to) { error(new Error('Choose an end date on or after the start date.')); return []; }
        const rows = displayedTasks().filter(t => {
            if (f.from && (!t.day || t.day < f.from) || f.to && (!t.day || t.day > f.to)) return false;
            for (const [k,p] of [['categories','category'],['assignees','assignee'],['priorities','priority'],['statuses','status']]) {
                if (f[k].length && !f[k].includes(String(t[p] == null ? '' : t[p]))) return false;
            }
            return !q || [t.title,t.description,t.category,t.projectName,t.assigneeName,...t.checklist.map(c => c.title)].join(' ').toLocaleLowerCase().includes(q);
        });
        const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
        return rows.sort((a,b) => {
            const group = f.group && cmp(a[f.group] || '\uffff', b[f.group] || '\uffff');
            if (group) return group;
            let order = 0;
            if (f.sort === 'date') order = cmp((a.day || '9999')+(a.time || ''),(b.day || '9999')+(b.time || ''));
            else if (f.sort === 'priority') order = b.priority-a.priority;
            else if (f.sort === 'category') order = cmp(a.category.toLocaleLowerCase(),b.category.toLocaleLowerCase());
            else order = a.order-b.order;
            return order || a.id-b.id;
        });
    }
    function replaceOptions(id, list, empty) {
        const el = $id(id), old = Array.from(el.selectedOptions).map(o => o.value);
        el.innerHTML = options(list, '', empty);
        Array.from(el.options).forEach(o => o.selected = old.includes(o.value));
        if (!el.multiple && !el.value) el.value = '';
        if (window.jQuery) window.jQuery(el).trigger('change.select2');
    }
    function refreshChoices() {
        replaceOptions('tp-categories', data.categories.map(c => [c,c]));
        $id('tp-category-list').innerHTML = data.categories.map(c => '<option value="'+esc(c)+'"></option>').join('');
        replaceOptions('tp-saved', data.filters.map(f => [f.taskSavedFilters_id,f.taskSavedFilters_name]), 'Saved filters…');
        replaceOptions('tp-package-select', data.templates.map(t => [t.taskTemplates_id,t.taskTemplates_name]), 'Choose a package…');
        $id('tp-delete-filter').hidden = !value('tp-saved');
    }
    function initControls() {
        refreshChoices();
        $id('tp-assignees').innerHTML = options(members(), null);
        $id('tp-priorities').innerHTML = options(priorities(), null);
        $id('tp-statuses').innerHTML = options(statuses(), null);
        for (const id of ['tp-categories','tp-assignees','tp-priorities','tp-statuses']) {
            Array.from($id(id).options).forEach(o => o.selected = false);
            if (window.jQuery && window.jQuery.fn.select2) window.jQuery($id(id)).select2({placeholder:$id(id).dataset.placeholder, width:'150px', closeOnSelect:false}).on('change', render);
        }
        $id('tp-quick').hidden = !data.permissions.edit;
        if (!project) $id('tp-quick-project').innerHTML = options(projects(), '', 'Choose project…');
        if (data.project && data.project.projects_dates_use_start) $id('tp-reference').value = data.project.projects_dates_use_start.slice(0,10);
        $id('tp-package-from').hidden = !project || !data.permissions.templates;
        $id('tp-package-new').hidden = !data.permissions.templates;
        $id('tp-package-edit').hidden = !data.permissions.templates;
        $id('tp-package-apply-controls').hidden = !project || !data.permissions.edit;
        renderBulkControl();
        const message = new URLSearchParams(location.search).get('ticktick');
        if (message) $id('tp-tick-panel').hidden = false;
    }
    function focusSnapshot() {
        const el = document.activeElement, row = el && el.closest('[data-task]');
        if (!row || !root.contains(row)) return null;
        return {id:row.dataset.task, field:el.dataset.field, check:el.dataset.check || '', action:el.dataset.action, value:el.value,
            start:el.selectionStart, end:el.selectionEnd};
    }
    function restoreFocus(s) {
        if (!s) return;
        const row = $id('tp-list').querySelector('[data-task="'+s.id+'"]');
        if (!row) return;
        const el = Array.from(row.querySelectorAll('input,textarea,select,button')).find(el =>
            s.field ? el.dataset.field === s.field && (el.dataset.check || '') === s.check : s.action && el.dataset.action === s.action);
        if (!el) return;
        if (el.type !== 'checkbox' && el.tagName !== 'BUTTON') el.value = s.value;
        el.focus({preventScroll:true});
        if (s.start != null && el.setSelectionRange && ['text','search','textarea'].includes(el.type)) el.setSelectionRange(s.start,s.end);
    }
    function render() {
        if (!data) return;
        const focus = focusSnapshot(), f = filters();
        shown = filtered();
        const visibleIds = new Set(data.tasks.map(t => t.id));
        selected = new Set([...selected].filter(id => visibleIds.has(id)));
        let last = null, html = '';
        for (const t of shown) {
            const group = f.group ? t[f.group] || (f.group === 'day' ? 'Unscheduled' : 'Uncategorised') : '';
            if (f.group && group !== last) { html += '<div class="tp-group-heading">'+esc(group)+'</div>'; last = group; }
            html += rowHtml(t);
        }
        $id('tp-list').innerHTML = html;
        const done = data.tasks.filter(t => t.status === 'done').length;
        $id('tp-progress').textContent = done+' of '+data.tasks.length+' completed'+(data.timeZone ? ' · '+data.timeZone : '');
        $id('tp-shown').textContent = shown.length+' shown';
        $id('tp-empty').hidden = !!shown.length;
        $id('tp-bulk').hidden = !selected.size || !data.permissions.edit;
        $id('tp-selected').textContent = selected.size+' selected';
        $id('tp-select-all').checked = !!shown.length && shown.every(t => selected.has(t.id));
        $id('tp-select-all').indeterminate = shown.some(t => selected.has(t.id)) && !shown.every(t => selected.has(t.id));
        restoreFocus(focus);
    }
    function rowHtml(t) {
        const editable = data.permissions.edit && !t.archived, disabled = editable ? '' : ' disabled';
        const input = (field,type,extra) => '<input class="tp-inline" data-field="'+field+'" type="'+type+'" aria-label="'+esc(field)+'" value="'+esc(t[field])+'"'+disabled+(extra || '')+'>';
        const select = (field, list, empty) => '<select class="tp-inline" data-field="'+field+'" aria-label="'+field+'"'+disabled+'>'+options(list,t[field],empty)+'</select>';
        const sync = (data.tick.tasks || []).find(m => +m.planningTasks_id === t.id);
        const detail = expanded.has(t.id);
        return '<article class="tp-row'+(t.status === 'done' ? ' tp-done' : '')+(selected.has(t.id) ? ' tp-selected' : '')+'" data-task="'+t.id+'" data-priority="'+t.priority+'">'+
            '<div class="tp-main"><input type="checkbox" data-action="select" aria-label="Select task"'+(selected.has(t.id) ? ' checked' : '')+'>'+
            '<input class="tp-complete" type="checkbox" data-action="complete" aria-label="Complete task"'+(t.status === 'done' ? ' checked' : '')+disabled+'>'+
            '<input class="tp-inline tp-title" data-field="title" aria-label="Task title" maxlength="500" value="'+esc(t.title)+'"'+disabled+'>'+
            (sync ? '<span class="tp-mini" title="'+esc(sync.taskTickTasks_error || sync.taskTickTasks_synced || 'Not yet synced')+'">'+esc(sync.taskTickTasks_error ? 'Sync error' : sync.taskTickTasks_state)+'</span>' : '')+
            '<button class="tp-more" data-action="expand" aria-label="Task details" aria-expanded="'+detail+'">'+(detail ? '⌃' : '⌄')+'</button>'+
            '<button class="tp-more tp-drag" data-action="drag" aria-label="Drag to reorder" title="Drag to reorder in Manual / No grouping" draggable="'+(editable && value('tp-sort') === 'manual' && !value('tp-group'))+'"'+disabled+'>⠿</button></div>'+
            '<div class="tp-meta"><label>Category '+input('category','text',' list="tp-category-list" placeholder="Add category" maxlength="120"')+'</label>'+
            '<label>Day '+input('day','date',' min="2000-01-01" max="2200-12-31"')+'</label>'+
            '<label>Priority '+select('priority',priorities())+'</label><label>Responsible '+select('assignee',members(),'Unassigned')+'</label>'+
            '<label>Status '+select('status',statuses())+'</label>'+
            (!project ? '<a class="tp-project-link" href="'+esc(root.dataset.projectUrl)+'?id='+t.project+'#task-planning-view">'+esc(t.projectName)+'</a>' : '')+
            (t.deadline ? '<span title="Independent deadline">Due '+esc(t.deadline.replace('T',' '))+'</span>' : '')+
            (t.checklist.length ? '<span>'+t.checklist.filter(c => c.done).length+'/'+t.checklist.length+' checklist</span>' : '')+'</div>'+
            (detail ? '<div class="tp-detail"><label>Description<textarea class="form-control" data-field="description" aria-label="Description" maxlength="12000"'+disabled+'>'+esc(t.description)+'</textarea></label>'+
                '<div class="tp-detail-grid"><label>Optional time '+input('time','time','')+'</label><label>Independent deadline '+input('deadline','datetime-local',' min="2000-01-01T00:00" max="2200-12-31T23:59"')+'</label>'+
                '<label>Project '+select('project',projects())+'</label></div>'+
                '<div class="tp-checklist">'+t.checklist.map(c => '<div class="tp-check-item"><input type="checkbox" data-action="check" data-check="'+esc(c.id)+'" aria-label="Complete checklist item"'+(c.done ? ' checked' : '')+disabled+'>'+
                '<input type="text" class="tp-inline" data-field="checkTitle" data-check="'+esc(c.id)+'" aria-label="Checklist title" maxlength="500" value="'+esc(c.title)+'"'+disabled+'>'+
                '<button class="tp-more" data-action="removeCheck" data-check="'+esc(c.id)+'" aria-label="Remove checklist item"'+disabled+'>×</button></div>').join('')+'</div>'+
                (editable ? '<input class="form-control form-control-sm tp-check-add" data-field="addCheck" aria-label="Add checklist item" placeholder="Add checklist item — Enter" maxlength="500"><div class="tp-actions mt-2"><button class="btn btn-default btn-sm" data-action="up">Move up</button><button class="btn btn-default btn-sm" data-action="down">Move down</button><button class="btn btn-link btn-sm text-danger" data-action="delete">Delete task</button></div>' : '<p class="text-muted">Read-only task.</p>')+'</div>' : '')+'</article>';
    }
    function taskFor(el) { const row = el.closest('[data-task]'); return row ? displayedTasks().find(t => t.id === +row.dataset.task) : null; }
    const editTimers = new Map();
    $id('tp-list').addEventListener('input', e => {
        const el = e.target, field = el.dataset.field, t = taskFor(el);
        if (!t || !['title','description','category','checkTitle'].includes(field)) return;
        const id = t.id+':'+field+':'+(el.dataset.check || '');
        setStatus('Unsaved changes…');
        clearTimeout(editTimers.get(id));
        editTimers.set(id,setTimeout(() => {
            editTimers.delete(id);
            // change uses the latest draft/server revision and also handles validation errors.
            const row = root.querySelector('[data-task="'+t.id+'"]');
            const current = row && Array.from(row.querySelectorAll('[data-field]')).find(input => input.dataset.field === field && (input.dataset.check || '') === (el.dataset.check || ''));
            if (current && (current.value !== '' || ['description','category'].includes(field))) current.dispatchEvent(new Event('change',{bubbles:true}));
        },700));
    });
    $id('tp-list').addEventListener('change', e => {
        const el = e.target, t = taskFor(el); if (!t) return;
        const timerId = t.id+':'+(el.dataset.field || '')+':'+(el.dataset.check || '');
        clearTimeout(editTimers.get(timerId)); editTimers.delete(timerId);
        if (el.dataset.action === 'select') { el.checked ? selected.add(t.id) : selected.delete(t.id); render(); return; }
        if (el.dataset.action === 'complete') { edit(t.id,{status:el.checked ? 'done' : 'open'}); return; }
        if (el.dataset.action === 'check') { edit(t.id,{checklist:t.checklist.map(c => c.id === el.dataset.check ? {...c,done:el.checked} : c)}); return; }
        const field = el.dataset.field;
        if (!field || field === 'addCheck') return;
        if (field === 'checkTitle') { edit(t.id,{checklist:t.checklist.map(c => c.id === el.dataset.check ? {...c,title:el.value} : c)}); return; }
        let v = el.value;
        if (field === 'priority' || field === 'project') v = +v;
        if (field === 'assignee') v = v ? +v : null;
        const patch = {[field]:v}; if (field === 'day' && !v) patch.time = null;
        if (!same(v,t[field]) && !(v === '' && t[field] === null)) edit(t.id,patch);
        else if (!saving && !queue.length && !drafts.size && !editTimers.size) setStatus('All changes saved');
    });
    $id('tp-list').addEventListener('click', e => {
        const el = e.target.closest('button'), t = el && taskFor(el); if (!t) return;
        const action = el.dataset.action;
        if (action === 'expand') { expanded.has(t.id) ? expanded.delete(t.id) : expanded.add(t.id); render(); }
        if (action === 'removeCheck') edit(t.id,{checklist:t.checklist.filter(c => c.id !== el.dataset.check)});
        if (action === 'delete' && window.confirm('Delete this task from RMS? Existing TickTick copies are retained.')) {
            enqueue({action:'delete',build:() => ({items:[{id:t.id,revision:data.tasks.find(x => x.id === t.id).revision}]})});
        }
        if (action === 'up' || action === 'down') move(t.id,action === 'up' ? -1 : 1);
    });
    $id('tp-list').addEventListener('keydown', e => {
        if (e.key !== 'Enter' || e.isComposing) return;
        if (e.target.dataset.field === 'addCheck') {
            e.preventDefault(); const t = taskFor(e.target), title = e.target.value.trim();
            if (title) { edit(t.id,{checklist:[...t.checklist,{id:key(),title,done:false}]}); e.target.value = ''; }
        } else if (e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); e.target.blur(); }
    });
    function orderTasks(ids) {
        const slots = shown.map(t => t.order).sort((a,b) => a-b);
        editMany(ids.map((id,i) => ({id,patch:{order:slots[i]}})), 'reorder');
    }
    function move(id, direction) {
        if (value('tp-sort') !== 'manual' || value('tp-group')) { error(new Error('Choose Manual sorting and No grouping to reorder tasks.')); return; }
        const ids = shown.map(t => t.id), at = ids.indexOf(id), next = at+direction;
        if (next < 0 || next >= ids.length) return;
        [ids[at],ids[next]] = [ids[next],ids[at]]; orderTasks(ids);
    }
    $id('tp-list').addEventListener('dragstart', e => {
        const el = e.target.closest('[data-action="drag"]');
        if (!el || el.draggable !== true) { e.preventDefault(); return; }
        dragged = taskFor(el).id; e.dataTransfer.setData('text/plain',String(dragged)); e.dataTransfer.effectAllowed = 'move';
    });
    $id('tp-list').addEventListener('dragover', e => { if (dragged) e.preventDefault(); });
    $id('tp-list').addEventListener('drop', e => {
        if (!dragged) return; e.preventDefault(); const target = taskFor(e.target);
        if (target && target.id !== dragged) { const ids = shown.map(t => t.id).filter(id => id !== dragged); ids.splice(ids.indexOf(target.id),0,dragged); orderTasks(ids); }
        dragged = null;
    });
    $id('tp-list').addEventListener('dragend', () => { dragged = null; });
    function quickAdd() {
        if (busyQuick || !data || !data.permissions.edit) return;
        const original = value('tp-quick-title'), lines = original.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (!lines.length) return;
        const target = project || value('tp-quick-project');
        if (!target) { error(new Error('Choose the project for these tasks.')); $id('tp-quick-project').focus(); return; }
        busyQuick = true; $id('tp-add').disabled = true;
        enqueue({action:'create',payload:{project:+target,items:lines.map(title => ({title}))},after:() => {
            busyQuick = false; $id('tp-add').disabled = false;
            if (value('tp-quick-title') === original) $id('tp-quick-title').value = '';
            $id('tp-quick-title').focus();
        }});
    }
    $id('tp-add').onclick = quickAdd;
    $id('tp-quick-title').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); quickAdd(); } });
    // A multi-line paste remains visible for review; Enter saves the whole batch atomically.
    ['tp-search','tp-from','tp-to','tp-sort','tp-group'].forEach(id => $id(id).addEventListener(id === 'tp-search' ? 'input' : 'change', render));
    ['tp-categories','tp-assignees','tp-priorities','tp-statuses'].forEach(id => $id(id).addEventListener('change',render));
    $id('tp-reset').onclick = () => { const f = filters(); applyFilters({sort:f.sort,group:f.group}); };
    $id('tp-select-all').onchange = e => { shown.forEach(t => e.target.checked ? selected.add(t.id) : selected.delete(t.id)); render(); };
    $id('tp-bulk-clear').onclick = () => { selected.clear(); render(); };
    function renderBulkControl() {
        if (!data) return;
        const field = value('tp-bulk-field');
        let html = '';
        if (field === 'category') html = '<input id="tp-bulk-input" list="tp-category-list" maxlength="120" class="form-control form-control-sm" aria-label="Bulk category" placeholder="Category or blank to clear">';
        else if (field === 'day') html = '<input id="tp-bulk-input" type="date" min="2000-01-01" max="2200-12-31" class="form-control form-control-sm" aria-label="Bulk day">';
        else html = '<select id="tp-bulk-input" class="form-control form-control-sm" aria-label="Bulk value">'+options(field === 'priority' ? priorities() : field === 'assignee' ? members() : statuses(), '', field === 'assignee' ? 'Unassigned' : undefined)+'</select>';
        $id('tp-bulk-value').innerHTML = html;
    }
    $id('tp-bulk-field').onchange = renderBulkControl;
    $id('tp-bulk-apply').onclick = () => {
        const field = value('tp-bulk-field'); let v = value('tp-bulk-input');
        if (field === 'priority') v = +v; if (field === 'assignee') v = v ? +v : null;
        editMany([...selected].map(id => ({id,patch:{[field]:v}})));
    };
    $id('tp-save-filter').onclick = () => {
        const name = value('tp-filter-name').trim(); if (!name) { $id('tp-filter-name').focus(); return; }
        enqueue({action:'saveFilter',busy:'tp-save-filter',payload:{name,value:filters()},after:() => $id('tp-filter-name').value = ''});
    };
    $id('tp-saved').onchange = () => {
        const f = data.filters.find(f => String(f.taskSavedFilters_id) === value('tp-saved'));
        $id('tp-delete-filter').hidden = !f; if (f) applyFilters(f.value);
    };
    $id('tp-delete-filter').onclick = () => { if (value('tp-saved')) enqueue({action:'deleteFilter',payload:{id:+value('tp-saved')}}); };
    $id('tp-retry').onclick = () => { failed = false; $id('tp-retry').hidden = true; $id('tp-reload').hidden = true; $id('tp-discard').hidden = true; pump(); };
    $id('tp-discard').onclick = async () => {
        if (saving || !window.confirm('Discard pending saves and load server data? Already saved changes remain; unsaved edits will be lost.')) return;
        try {
            const r = await request('data');
            queue.forEach(job => { if (job.busy) $id(job.busy).disabled = false; });
            queue = []; drafts.clear(); editTimers.forEach(clearTimeout); editTimers.clear();
            failed = false; busyQuick = false; editing = null; preview = null;
            $id('tp-add').disabled = false; $id('tp-quick-title').value = '';
            $id('tp-package-editor').hidden = true; $id('tp-apply').hidden = true; $id('tp-preview-list').textContent = '';
            $id('tp-retry').hidden = true; $id('tp-reload').hidden = true; $id('tp-discard').hidden = true;
            receive(r,false); clearError(); setStatus('All changes saved');
        } catch (e) { error(e); }
    };
    $id('tp-reload').onclick = async () => {
        if (!window.confirm('Load current server versions? Unsaved field edits will stay visible. Pending new-task/package requests are retained for a safe retry.')) return;
        try {
            const r = await request('data');
            const pending = queue.filter(j => !j.edits);
            queue = pending; failed = false; saving = false; receive(r,false);
            $id('tp-retry').hidden = true; $id('tp-reload').hidden = true; $id('tp-discard').hidden = true;
            const edits = [...drafts].filter(([id]) => data.tasks.some(t => t.id === id)).map(([id,patch]) => ({id,patch}));
            drafts = new Map(edits.map(e => [e.id,e.patch]));
            if (edits.length) editMany(edits);
            else if (queue.length) pump();
            else setStatus('Current version loaded');
        } catch (e) { error(e); }
    };
    for (const [button,panel] of [['tp-packages','tp-package-panel'],['tp-export-toggle','tp-export-panel'],['tp-tick-toggle','tp-tick-panel']]) {
        $id(button).onclick = () => { $id(panel).hidden = !$id(panel).hidden; };
    }
    function tickStatus() {
        const tick = data.tick, permission = data.permissions.sync;
        $id('tp-connect').hidden = !permission;
        $id('tp-connect').textContent = tick.connected ? 'Reconnect TickTick' : 'Connect TickTick';
        $id('tp-connect').disabled = !tick.configured || !permission;
        $id('tp-disconnect').hidden = !tick.connected || !permission;
        if ($id('tp-sync')) $id('tp-sync').disabled = !tick.connected || !permission || syncing;
        $id('tp-tick-status').textContent = !permission ? 'Your role has no TickTick sync permission.' : !tick.configured ?
            'TickTick is not configured yet. Open TickTick Settings in Business Settings, or ask a business administrator.' :
            tick.connected ? 'Connected'+(tick.expires ? ' · expires '+tick.expires+' UTC' : '')+(tick.project && tick.project.taskTickProjects_synced ? ' · last sync '+tick.project.taskTickProjects_synced+' UTC' : '') : 'Connect your personal TickTick account once.';
        if (tick.project && tick.project.taskTickProjects_error) $id('tp-tick-status').textContent += ' · '+tick.project.taskTickProjects_error;
    }
    $id('tp-connect').onclick = async () => { try { const r = await request('connect'); location.assign(r.url); } catch (e) { error(e); } };
    $id('tp-disconnect').onclick = async () => {
        if (!window.confirm('Disconnect TickTick? Existing external tasks and their links are retained. Revoke the app in TickTick settings if you also want to revoke its authorisation.')) return;
        try { receive(await request('disconnect'),false); } catch (e) { error(e); }
    };
    if ($id('tp-sync')) $id('tp-sync').onclick = async () => {
        if (saving || queue.length) { error(new Error('Wait until your edits are saved before syncing.')); return; }
        syncing = true; tickStatus(); setStatus('Synchronising to TickTick…');
        try {
            let remaining;
            do {
                const r = await request('sync',{mine:value('tp-sync-scope') === 'mine'}); receive(r,false);
                remaining = r.sync.remaining; setStatus(r.sync.count+' tasks synchronised'+(remaining ? ' · continuing…' : ''));
            } while (remaining > 0);
        } catch (e) { error(e); setStatus('TickTick sync stopped — saved RMS tasks are safe'); }
        finally { syncing = false; tickStatus(); }
    };
    $id('tp-export').onclick = () => {
        if (saving || queue.length) { error(new Error('Save your edits before exporting the current plan.')); return; }
        const f = value('tp-export-scope') === 'filtered' ? filters() : {sort:'date'};
        f.group = value('tp-export-group'); f.sort = 'date';
        const q = new URLSearchParams({projects_id:project,filters:JSON.stringify(f),checklists:$id('tp-export-checklist').checked ? '1' : '0'});
        window.open(root.dataset.export+'?'+q.toString(),'_blank','noopener');
    };
    function packageSelected() { return data.templates.find(t => String(t.taskTemplates_id) === value('tp-package-select')); }
    function parseChecklist(text) {
        return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((s,i) => ({id:'line'+i,title:s.replace(/^\[[ xX]\]\s*/,''),done:/^\[[xX]\]/.test(s)}));
    }
    function startEditor(t, items) {
        editing = {id:t ? +t.taskTemplates_id : null,revision:t ? +t.taskTemplates_revision : null,items:items || (t ? structuredClone(t.items) : [])};
        $id('tp-package-editor').hidden = false; $id('tp-package-name').value = t ? t.taskTemplates_name : '';
        $id('tp-package-delete').hidden = !t; renderEditor(); $id('tp-package-name').focus();
    }
    function renderEditor() {
        $id('tp-package-items').innerHTML = editing.items.map((t,i) => '<div class="tp-package-row" data-package-item="'+i+'"><div class="tp-package-grid">'+
            '<label>Title<input class="form-control form-control-sm" data-prop="title" maxlength="500" value="'+esc(t.title)+'"></label>'+
            '<label>Category<input class="form-control form-control-sm" data-prop="category" maxlength="120" list="tp-category-list" value="'+esc(t.category)+'"></label>'+
            '<label>Priority<select class="form-control form-control-sm" data-prop="priority">'+options(priorities(),t.priority)+'</select></label>'+
            '<label>Relative day<input type="number" min="-3650" max="3650" class="form-control form-control-sm" data-prop="offset" value="'+esc(t.offset)+'"></label>'+
            '<label>Deadline day<input type="number" min="-3650" max="3650" class="form-control form-control-sm" data-prop="deadlineOffset" value="'+esc(t.deadlineOffset)+'"></label>'+
            '<label>Time<input type="time" class="form-control form-control-sm" data-prop="time" value="'+esc(t.time)+'"></label><button class="tp-more" data-package-remove="'+i+'" aria-label="Remove package task">×</button></div>'+
            '<details class="mt-2"><summary>Description / checklist</summary><label class="d-block">Description<textarea data-prop="description" class="form-control form-control-sm" maxlength="12000">'+esc(t.description)+'</textarea></label>'+
            '<label class="d-block">Checklist, one line each<textarea data-prop="checklist" class="form-control form-control-sm">'+esc((t.checklist || []).map(c => (c.done ? '[x] ' : '[ ] ')+c.title).join('\n'))+'</textarea></label></details></div>').join('');
    }
    $id('tp-package-items').addEventListener('input', e => {
        const row = e.target.closest('[data-package-item]'), prop = e.target.dataset.prop;
        if (!row || !prop) return;
        let v = e.target.value;
        if (prop === 'priority') v = +v;
        if (prop === 'offset' || prop === 'deadlineOffset') v = v === '' ? null : +v;
        if (prop === 'checklist') v = parseChecklist(v);
        editing.items[+row.dataset.packageItem][prop] = v;
    });
    $id('tp-package-items').addEventListener('click', e => {
        if (e.target.dataset.packageRemove !== undefined) { editing.items.splice(+e.target.dataset.packageRemove,1); renderEditor(); }
    });
    $id('tp-package-new').onclick = () => startEditor(null);
    $id('tp-package-edit').onclick = () => { const t = packageSelected(); if (t) startEditor(t); };
    function addPackageTitles() {
        const lines = value('tp-package-add').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        editing.items.push(...lines.map(title => ({title,description:'',category:'',priority:1,offset:null,deadlineOffset:null,time:null,checklist:[]})));
        $id('tp-package-add').value = ''; renderEditor(); $id('tp-package-add').focus();
    }
    $id('tp-package-add-button').onclick = addPackageTitles;
    $id('tp-package-add').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addPackageTitles(); } };
    $id('tp-package-save').onclick = () => {
        if (!editing) return;
        const payload = {...editing,name:value('tp-package-name')};
        enqueue({action:'saveTemplate',busy:'tp-package-save',payload,after:r => {
            $id('tp-package-editor').hidden = true; editing = null; $id('tp-package-select').value = String(r.ids[0]); preview = null;
        }});
    };
    $id('tp-package-delete').onclick = () => {
        if (editing && window.confirm('Delete this reusable package? Project tasks are kept.')) enqueue({action:'deleteTemplate',payload:{id:editing.id,revision:editing.revision},after:() => { editing = null; $id('tp-package-editor').hidden = true; }});
    };
    $id('tp-package-cancel').onclick = () => { editing = null; $id('tp-package-editor').hidden = true; };
    $id('tp-package-from').onclick = () => {
        const base = value('tp-reference');
        const delta = day => base && day ? Math.round((Date.parse(day.slice(0,10)+'T00:00:00Z')-Date.parse(base+'T00:00:00Z'))/86400000) : null;
        startEditor(null, displayedTasks().map(t => ({title:t.title,description:t.description,category:t.category,priority:t.priority,offset:delta(t.day),deadlineOffset:delta(t.deadline),
            time:base && t.day ? t.time : null,checklist:t.checklist.map(c => ({...c,done:false}))})));
        $id('tp-package-name').value = (data.project ? data.project.projects_name : '')+' package';
    };
    $id('tp-preview').onclick = async () => {
        const t = packageSelected(); if (!t) return;
        try {
            const r = await request('preview',null,null,{template_id:t.taskTemplates_id,base:value('tp-reference')});
            preview = {...r.preview,id:+t.taskTemplates_id};
            $id('tp-preview-list').innerHTML = preview.items.map(t => '<label class="tp-preview-item"><input type="checkbox" data-preview="'+t.index+'" checked><span>'+esc(t.title)+'<small class="d-block">'+esc(t.category || 'Uncategorised')+' · '+esc(data.priorities[t.priority])+(t.checklist.length ? ' · '+t.checklist.length+' checklist items' : '')+'</small></span><small>'+esc(t.day || 'Unscheduled')+(t.time ? ' '+esc(t.time) : '')+(t.deadline ? '<br>Due '+esc(t.deadline.replace('T',' ')) : '')+'</small></label>').join('');
            $id('tp-apply').hidden = false;
        } catch (e) { error(e); }
    };
    for (const id of ['tp-reference','tp-package-select']) $id(id).addEventListener('change', () => {
        preview = null; $id('tp-preview-list').textContent = ''; $id('tp-apply').hidden = true;
    });
    $id('tp-apply').onclick = () => {
        if (!preview) return;
        const selectedItems = Array.from($id('tp-preview-list').querySelectorAll('input:checked')).map(el => +el.dataset.preview);
        enqueue({action:'applyTemplate',busy:'tp-apply',payload:{id:preview.id,revision:preview.revision,base:preview.base,selected:selectedItems},after:() => {
            preview = null; $id('tp-preview-list').textContent = ''; $id('tp-apply').hidden = true;
        }});
    };
    document.addEventListener('keydown', e => {
        if (!data || e.ctrlKey || e.altKey || e.metaKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || !root.getClientRects().length) return;
        if (e.key === 'n' && data.permissions.edit) { e.preventDefault(); $id('tp-quick-title').focus(); }
        if (e.key === '/') { e.preventDefault(); $id('tp-search').focus(); }
    });
    window.addEventListener('beforeunload', e => { if (queue.length || saving || drafts.size || editTimers.size) { e.preventDefault(); e.returnValue = ''; } });
    request('data').then(r => { receive(r,true); setStatus('All changes saved'); }).catch(e => { error(e); setStatus('Tasks could not be loaded'); });
}());
