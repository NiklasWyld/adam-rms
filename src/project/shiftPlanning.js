(() => {
    'use strict';

    const root = document.getElementById('shift-planner');
    const get = name => document.getElementById('shift-' + name);
    const modal = $(get('editor'));
    const form = get('form');
    const picker = $(get('members'));
    const formatDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const formatShortDay = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    const dayDate = day => new Date(day + 'T12:00:00Z');
    const dayOf = date => date.slice(0, 10);
    const timeOf = date => date.slice(11, 16);
    const period = shift => timeOf(shift.start) + ' – ' +
        (dayOf(shift.start) === dayOf(shift.end) ? '' : formatShortDay.format(dayDate(dayOf(shift.end))) + ' ') + timeOf(shift.end);
    let plan, csrf, editing, requestKey, opener;
    let loading = false;
    let saving = false;
    let roster = new Map();
    let selected = new Map();

    function element(tag, content = '', className = '') {
        const node = document.createElement(tag);
        node.textContent = content;
        node.className = className;
        return node;
    }

    async function request(action, shift) {
        const url = new URL(root.dataset.endpoint, location.href);
        url.searchParams.set('projects_id', root.dataset.project);
        const options = { credentials: 'same-origin', cache: 'no-store' };
        if (action !== 'data') {
            url.searchParams.set('action', action);
            options.method = 'POST';
            options.headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Shift-CSRF': csrf };
            options.body = JSON.stringify({ shift });
        }
        const response = await fetch(url, options);
        const result = await response.json().catch(() => null);
        if (!result?.result) throw new Error(result?.error?.message || 'Die Schichtplanung konnte nicht geladen werden.');
        csrf = result.response.csrf;
        plan = result.response.data;
        roster = new Map(plan.members.map(person => [person.id, person]));
        return result.response.id;
    }

    function warning(node, names) {
        node.replaceChildren();
        node.hidden = !names.length;
        if (!names.length) return;
        const icon = element('i', '', 'fas fa-exclamation-triangle mr-1');
        icon.setAttribute('aria-hidden', 'true');
        node.append(icon, 'Überschneidung: ' + names.slice(0, 5).join(', ') + (names.length > 5 ? ' +' + (names.length - 5) : ''));
    }

    function render() {
        const from = get('from').value;
        const to = get('to').value;
        const invalid = from && to && from > to;
        get('all').disabled = !from && !to;
        const groups = new Map();
        if (!invalid) for (const shift of plan.shifts) {
            const startDay = dayOf(shift.start);
            if ((to && startDay > to) || (from && shift.end <= from + 'T00:00')) continue;
            const day = from && startDay < from ? from : startDay;
            if (!groups.has(day)) groups.set(day, []);
            groups.get(day).push(shift);
        }
        const status = get('status');
        status.hidden = groups.size > 0;
        status.textContent = invalid ? 'Das Enddatum liegt vor dem Startdatum.' :
            (plan.shifts.length ? 'Keine Schichten im gewählten Zeitraum.' : 'Noch keine Schichten geplant.');

        const list = document.createDocumentFragment();
        for (const [day, shifts] of groups) {
            const section = element('section', '', 'shift-day');
            section.append(element('h3', formatDay.format(dayDate(day)), 'shift-day-title'));
            for (const shift of shifts) {
                const row = element('button', '', 'shift-entry');
                row.type = 'button';
                row.dataset.shift = shift.id;
                const previous = dayOf(shift.start) < day ? formatShortDay.format(dayDate(dayOf(shift.start))) + ' ' : '';
                const label = element('span');
                label.append(element('strong', shift.title));
                const names = shift.assignments.map(person => person.name);
                const visible = names.slice(0, 5).join(', ') + (names.length > 5 ? ' +' + (names.length - 5) : '');
                label.append(element('span', visible || 'Unbesetzt', 'd-block small text-muted'));
                const overlap = element('span', '', 'shift-warning d-block small');
                warning(overlap, shift.assignments.filter(person => person.overlap).map(person => person.name));
                label.append(overlap);
                row.append(element('span', previous + period(shift), 'shift-time'), label);
                section.append(row);
            }
            list.append(section);
        }
        get('days').replaceChildren(list);
    }

    async function load() {
        if (loading || plan) return;
        loading = true;
        get('load-error').hidden = true;
        get('status').hidden = false;
        try {
            await request('data');
            get('from').disabled = get('to').disabled = false;
            if (get('add')) get('add').disabled = !plan.editable;
            render();
        } catch (error) {
            get('status').hidden = true;
            get('load-error').hidden = false;
            get('load-error').querySelector('span').textContent = error.message;
        } finally {
            loading = false;
        }
    }

    function updateEditorWarning() {
        const { start, end } = form.elements;
        const savedTimes = start.value === editing?.start && end.value === editing?.end;
        const overlapping = new Set(savedTimes ? editing.assignments.filter(person => person.overlap).map(person => person.id) : []);
        if (start.value && end.value > start.value) {
            for (const shift of plan.shifts) {
                if (shift.id !== editing?.id && shift.start < end.value && shift.end > start.value) {
                    for (const person of shift.assignments) overlapping.add(person.id);
                }
            }
        }
        warning(get('editor-warning'), Array.from(selected.values()).filter(person => overlapping.has(person.id)).map(person => person.name));
    }

    function renderRoles() {
        const rows = document.createDocumentFragment();
        for (const [id, person] of selected) {
            const row = element('div', '', 'shift-role');
            const label = element('label', person.name, 'mb-0 font-weight-normal');
            label.htmlFor = 'shift-role-' + id;
            const role = element('input', '', 'form-control form-control-sm');
            role.id = label.htmlFor;
            role.dataset.person = id;
            role.setAttribute('aria-label', 'Aufgabe oder Rolle für ' + person.name);
            role.placeholder = 'Aufgabe oder Rolle';
            role.maxLength = 255;
            role.value = person.role || '';
            role.readOnly = !plan.editable;
            row.append(label, role);
            rows.append(row);
        }
        get('roles').replaceChildren(rows);
        updateEditorWarning();
    }

    function showEditor(shift, copy = false) {
        editing = copy ? null : shift;
        const editable = plan.editable;
        const day = get('from').value || get('to').value || root.dataset.projectStart || root.dataset.today;
        const defaults = { title: '', start: day + 'T09:00', end: day + 'T10:00', meetingPoint: '', tasks: '', notes: '' };
        const values = shift || defaults;
        get('editor-title').textContent = copy ? 'Schicht duplizieren' : (shift ? (editable ? 'Schicht bearbeiten' : 'Schicht') : 'Neue Schicht');
        for (const field of Object.keys(defaults)) {
            form.elements[field].value = values[field];
            form.elements[field].readOnly = !editable;
        }
        get('details').open = Boolean(values.meetingPoint || values.tasks || values.notes);
        get('details').hidden = !editable && !get('details').open;
        get('editor-error').hidden = true;
        get('duplicate').hidden = get('delete').hidden = !editable || !editing;
        get('save').hidden = get('member-picker').hidden = !editable;
        selected = new Map((shift?.assignments || []).filter(person => !copy || roster.has(person.id)).map(person => [person.id, { ...person }]));
        if (editable) {
            const members = new Map(roster);
            for (const [id, person] of selected) if (!members.has(id)) members.set(id, person);
            get('members').replaceChildren(...Array.from(members.values(), person => new Option(person.name, person.id, false, selected.has(person.id))));
            if (!picker.data('select2')) {
                picker.select2({
                    dropdownParent: modal, theme: 'bootstrap4', width: '100%', closeOnSelect: false, placeholder: 'Personen suchen',
                    language: { noResults: () => 'Keine passenden Personen' }
                });
            }
            picker.trigger('change.select2');
            get('member-picker').querySelector('.select2-search__field').setAttribute('aria-label', 'Personen suchen');
        }
        const sources = plan.shifts.filter(item => item.id !== editing?.id && item.assignments.some(person => roster.has(person.id)));
        get('copy-crew').hidden = !editable || !sources.length;
        get('crew-source').replaceChildren(new Option('Schicht auswählen', ''),
            ...sources.map(item => new Option(formatShortDay.format(dayDate(dayOf(item.start))) + ' · ' + period(item) + ' · ' + item.title, item.id)));
        requestKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
        renderRoles();
        modal.modal('show');
    }

    function draft() {
        return Object.fromEntries(['title', 'start', 'end', 'tasks', 'meetingPoint', 'notes'].map(name => [name, form.elements[name].value]));
    }

    async function save(action, payload) {
        if (saving || !plan.editable) return;
        saving = true;
        get('editor-error').hidden = true;
        get('fields').disabled = get('save').disabled = get('duplicate').disabled = get('delete').disabled = true;
        get('save').textContent = 'Speichert …';
        try {
            const id = await request(action, payload);
            const saved = plan.shifts.find(shift => shift.id === id);
            if (saved) {
                const day = dayOf(saved.start);
                if ((get('from').value && day < get('from').value) || (get('to').value && day > get('to').value)) {
                    get('from').value = get('to').value = day;
                }
            }
            render();
            opener = get('days').querySelector('[data-shift="' + id + '"]') || get('add');
            saving = false;
            modal.modal('hide');
        } catch (error) {
            get('editor-error').textContent = error.message;
            get('editor-error').hidden = false;
        } finally {
            saving = false;
            get('fields').disabled = get('save').disabled = get('duplicate').disabled = get('delete').disabled = false;
            get('save').textContent = 'Speichern';
        }
    }

    $(document).on('shown.bs.tab', 'a[href="#shift-planning-view"]', load);
    if (root.closest('.tab-pane').classList.contains('active')) load();
    get('load-error').querySelector('button').addEventListener('click', load);
    get('from').addEventListener('input', render);
    get('to').addEventListener('input', render);
    get('all').addEventListener('click', () => {
        get('from').value = get('to').value = '';
        render();
    });
    get('add')?.addEventListener('click', event => {
        opener = event.currentTarget;
        showEditor(null);
    });
    get('days').addEventListener('click', event => {
        const row = event.target.closest('[data-shift]');
        if (!row) return;
        opener = row;
        showEditor(plan.shifts.find(shift => shift.id === Number(row.dataset.shift)));
    });
    modal.on('shown.bs.modal', () => {
        if (plan.editable) {
            picker.trigger('change.select2');
            get('title').focus();
        } else {
            modal.find('.close')[0].focus();
        }
    });
    modal.on('hide.bs.modal', () => !saving);
    modal.on('hidden.bs.modal', () => opener?.focus());

    picker.on('change', () => {
        const ids = (picker.val() || []).map(Number);
        selected = new Map(ids.map(id => [id, selected.get(id) || { ...(roster.get(id) || editing?.assignments.find(person => person.id === id)), role: '' }]));
        renderRoles();
    });
    get('roles').addEventListener('input', event => {
        const person = selected.get(Number(event.target.dataset.person));
        if (person) person.role = event.target.value;
    });
    get('crew-source').addEventListener('change', event => {
        const source = plan.shifts.find(shift => shift.id === Number(event.target.value));
        if (!source) return;
        for (const person of source.assignments) {
            if (roster.has(person.id) && !selected.has(person.id)) selected.set(person.id, { ...person });
        }
        picker.val(Array.from(selected.keys(), String)).trigger('change.select2');
        event.target.value = '';
        renderRoles();
    });
    get('start').addEventListener('input', updateEditorWarning);
    get('end').addEventListener('input', updateEditorWarning);
    get('duplicate').addEventListener('click', () => {
        picker.select2('close');
        showEditor({ ...draft(), assignments: Array.from(selected.values()) }, true);
        get('title').focus();
    });
    get('delete').addEventListener('click', () => {
        if (editing && window.confirm('Diese Schicht löschen?')) save('delete', { id: editing.id, revision: editing.revision });
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        save('save', {
            ...draft(), id: editing?.id, revision: editing?.revision, requestKey,
            assignments: Array.from(selected.values(), person => ({ id: person.id, role: person.role || '' }))
        });
    });
})();
