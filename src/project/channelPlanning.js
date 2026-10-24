(function () {
    'use strict';
    function start() {
        var root = document.getElementById('channel-planning');
        if (!root) return;
        var editable = root.dataset.editable === '1', plan = null, csrf = '', dirty = false, saving = false;
        var timer, generation = 0, blocked = false, confirmReduction = false, loaded = false;
        var status = document.getElementById('channel-save-status'), errorBox = document.getElementById('channel-error');
        var tables = document.getElementById('channel-tables'), form = document.getElementById('channel-config');
        var search = document.getElementById('channel-search'), saveButton = document.getElementById('channel-save');
        var configButton = document.getElementById('channel-configuration'), exportButton = document.getElementById('channel-export');
        var blank = function () { return { scene: '', label: '', connection: '', notes: '' }; };
        function outputLabel(index) {
            if (plan.outputLabels === 'numeric') return 'OUT' + (index + 1);
            var n = index + 1, label = '';
            while (n) { n--; label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26); }
            return label;
        }
        function populated(rows) { return rows.some(function (uses) { return uses.some(function (entry) { return Object.keys(entry).some(function (key) { return entry[key].trim() !== ''; }); }); }); }
        function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
        function state(message) {
            status.textContent = message;
            saveButton.disabled = !editable || !loaded || !dirty || saving || blocked;
            exportButton.disabled = !loaded || !plan || !plan.configured || dirty || saving;
        }
        async function api(fields) {
            var body = new URLSearchParams(Object.assign({ projects_id: root.dataset.project }, fields));
            var response = await fetch(root.dataset.endpoint, { method: 'POST', credentials: 'same-origin', body: body });
            var result = await response.json();
            if (!response.ok || !result.result) {
                var error = new Error(result.error && result.error.message || 'Unable to contact AdamRMS. Your edits have not been saved.');
                error.code = result.error && result.error.code;
                throw error;
            }
            return result.response;
        }
        function changed() {
            generation++; dirty = true;
            clearTimeout(timer);
            state(blocked ? 'Not saved - reload required' : 'Unsaved changes');
            if (!blocked) timer = setTimeout(save, 800);
        }
        async function save() {
            clearTimeout(timer);
            if (!dirty || saving || blocked || !editable) return;
            saving = true; state('Saving…');
            var sent = generation, payload = JSON.stringify(plan), confirmed = confirmReduction;
            errorBox.hidden = true;
            try {
                var response = await api({ action: 'save', csrf: csrf, plan: payload, confirmReduction: confirmed ? '1' : '0' });
                plan.revision = response.plan.revision;
                plan.updated = response.plan.updated;
                plan.configured = true;
                if (sent === generation) {
                    dirty = false; confirmReduction = false;
                }
                state(dirty ? 'Unsaved changes' : 'Saved');
            } catch (error) {
                if (error.code === 'CONFLICT' || error.code === 'CSRF-ERROR') blocked = true;
                showError(error.message); state('Not saved');
                if (error.code === 'CONFIRM-REDUCTION') {
                    var confirm = element('button', 'btn btn-danger btn-sm ml-2', 'Confirm removal of populated channels');
                    confirm.type = 'button';
                    confirm.onclick = function () { confirmReduction = true; save(); };
                    errorBox.appendChild(confirm);
                }
            } finally {
                saving = false;
                state(blocked ? 'Not saved - reload required' : (dirty ? 'Unsaved changes' : 'Saved'));
                if (dirty && sent !== generation && !blocked) timer = setTimeout(save, 800);
            }
        }
        function element(tag, className, text) {
            var el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el;
        }
        function filter() {
            var term = search.value.toLocaleLowerCase().trim(), matches = 0;
            tables.querySelectorAll('tr[data-channel]').forEach(function (row) {
                var uses = plan[row.dataset.kind][Number(row.dataset.channel)];
                var content = row.dataset.label + ' ' + uses.map(function (entry) { return Object.values(entry).join(' '); }).join(' ');
                row.hidden = term !== '' && !content.toLocaleLowerCase().includes(term);
                if (!row.hidden) matches++;
            });
            document.getElementById('channel-no-results').hidden = !plan || !plan.configured || matches > 0;
        }
        function render() {
            tables.replaceChildren();
            ['inputs', 'outputs'].forEach(function (kind) {
                var count = kind === 'inputs' ? plan.inputCount : plan.outputCount;
                while (plan[kind].length < count) plan[kind].push([blank()]);
                if (!plan.configured) return;
                var heading = element('h4', 'mt-4', kind === 'inputs' ? 'Inputs' : 'Outputs');
                heading.appendChild(element('small', 'text-muted ml-2', String(count) + ' channels'));
                tables.appendChild(heading);
                var scroll = element('div', 'table-responsive channel-scroll border rounded mb-4');
                var table = element('table', 'table channel-table mb-0'), thead = element('thead'), header = element('tr');
                var labels = kind === 'inputs' ? ['Channel', 'Programme / scene · Signal · Connection / source · Notes'] : ['Output', 'Programme / scene · Label · Destination / use · Notes'];
                labels.forEach(function (label, i) { var th = element('th', '', label); th.scope = 'col'; if (i === 0) th.style.width = '100px'; header.appendChild(th); });
                thead.appendChild(header); table.appendChild(thead);
                var tbody = element('tbody');
                plan[kind].forEach(function (uses, index) {
                    var row = element('tr'), name = kind === 'inputs' ? 'CH' + (index + 1) : outputLabel(index);
                    row.dataset.kind = kind; row.dataset.channel = String(index); row.dataset.label = name;
                    var number = element('th', 'channel-number', name); number.scope = 'row'; row.appendChild(number);
                    var cell = element('td');
                    uses.forEach(function (entry, useIndex) {
                        var fields = element('div', 'channel-use');
                        ['scene', 'label', 'connection', 'notes'].forEach(function (field, fieldIndex) {
                            var input = element(field === 'notes' ? 'textarea' : 'input', 'form-control form-control-sm');
                            if (field !== 'notes') input.type = 'text'; else input.rows = 1;
                            input.value = entry[field]; input.maxLength = 4000; input.readOnly = !editable;
                            input.placeholder = [ 'Programme / scene (optional)', kind === 'inputs' ? 'Signal' : 'Label', kind === 'inputs' ? 'Connection / source' : 'Destination / use', 'Notes' ][fieldIndex];
                            input.setAttribute('aria-label', name + ' use ' + (useIndex + 1) + ' ' + field);
                            input.addEventListener('input', function () { entry[field] = input.value; changed(); });
                            fields.appendChild(input);
                        });
                        if (editable) {
                            var remove = element('button', 'btn btn-default btn-sm', '×');
                            remove.type = 'button'; remove.title = 'Remove use';
                            remove.setAttribute('aria-label', 'Remove ' + name + ' use ' + (useIndex + 1));
                            remove.onclick = function () {
                                if (populated([[entry]]) && !window.confirm('Remove this populated use from ' + name + '?')) return;
                                uses.splice(useIndex, 1); if (!uses.length) uses.push(blank());
                                changed(); render();
                            };
                            fields.appendChild(remove);
                        }
                        cell.appendChild(fields);
                    });
                    if (editable && uses.length < 20) {
                        var add = element('button', 'btn btn-link btn-sm p-0', '+ Add use');
                        add.type = 'button'; add.setAttribute('aria-label', 'Add use to ' + name);
                        add.onclick = function () {
                            uses.push(blank()); changed(); render();
                            var row = tables.querySelector('tr[data-kind="' + kind + '"][data-channel="' + index + '"]');
                            var fields = row.querySelectorAll('.channel-use input'); fields[fields.length - 3].focus();
                        };
                        cell.appendChild(add);
                    }
                    row.appendChild(cell); tbody.appendChild(row);
                });
                table.appendChild(tbody); scroll.appendChild(table); tables.appendChild(scroll);
            });
            filter();
        }
        function configValues() {
            document.getElementById('channel-input-count').value = plan.inputCount;
            document.getElementById('channel-output-count').value = plan.outputCount;
            document.getElementById('channel-output-labels').value = plan.outputLabels;
        }
        configButton.onclick = function () { configValues(); form.hidden = !form.hidden; if (!form.hidden) document.getElementById('channel-input-count').focus(); };
        form.onsubmit = function (event) {
            event.preventDefault();
            if (!editable || !plan || !form.reportValidity()) return;
            var inputs = Number(document.getElementById('channel-input-count').value), outputs = Number(document.getElementById('channel-output-count').value);
            var removed = populated(plan.inputs.slice(inputs)) || populated(plan.outputs.slice(outputs));
            if (removed && !window.confirm('This removes populated channels beyond the new counts. Remove these channels and their uses?')) return;
            if (removed) confirmReduction = true;
            plan.inputCount = inputs; plan.outputCount = outputs;
            plan.outputLabels = document.getElementById('channel-output-labels').value;
            plan.inputs.length = Math.min(plan.inputs.length, inputs); plan.outputs.length = Math.min(plan.outputs.length, outputs);
            plan.configured = true; form.hidden = true;
            changed(); render();
        };
        search.addEventListener('input', filter);
        saveButton.onclick = save;
        exportButton.onclick = function () { if (!exportButton.disabled) window.open(exportButton.dataset.url, '_blank', 'noopener'); };
        root.addEventListener('keydown', function (event) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); } });
        window.addEventListener('beforeunload', function (event) { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
        async function load() {
            if (loaded) return;
            try {
                var response = await api({ action: 'data' });
                csrf = response.csrf; plan = response.plan; loaded = true;
                search.disabled = false; configButton.disabled = !editable;
                document.getElementById('channel-first-use').hidden = plan.configured;
                if (!editable) document.getElementById('channel-edit-help').textContent = 'This plan is read-only. You can search and export saved channels.';
                configValues(); form.hidden = plan.configured || !editable; render();
                state(plan.configured ? 'Saved' : (editable ? 'Not configured' : 'No saved plan'));
            } catch (error) { showError(error.message); state('Unable to load plan'); }
        }
        // Load only when this tab is opened, keeping the existing project page lightweight.
        if (window.jQuery) window.jQuery('a[href="#channel-planning-view"]').on('shown.bs.tab', load);
        if (location.hash === '#channel-planning-view' || root.closest('.tab-pane').classList.contains('active')) load();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}());
