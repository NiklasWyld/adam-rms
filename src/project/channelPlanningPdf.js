(function () {
    'use strict';
    var pdf = window.AdamPdf, data = pdf.read('channel-pdf-data'), plan = data.plan, source = pdf.business();
    var error = document.getElementById('channel-pdf-error'), status = document.getElementById('channel-pdf-status');
    var wrap = pdf.wrap;
    function label(index) {
        if (plan.outputLabels === 'numeric') return 'OUT' + (index + 1);
        var result = '', n = index + 1;
        while (n) { n--; result = String.fromCharCode(65 + n % 26) + result; n = Math.floor(n / 26); }
        return result;
    }
    // Bound each row so it can stay together, including cells with thousands of characters/newlines.
    function chunks(value) {
        var remaining = String(value || ''), parts = [];
        while (remaining.length) {
            var limit = Math.min(320, remaining.length), lines = 0;
            for (var i = 0; i < limit; i++) if (remaining[i] === '\n' && ++lines === 6) { limit = i + 1; break; }
            if (limit < remaining.length && remaining[limit - 1] !== '\n') {
                var space = remaining.slice(0, limit).lastIndexOf(' ');
                if (space > limit / 2) limit = space + 1;
            }
            parts.push(remaining.slice(0, limit)); remaining = remaining.slice(limit);
        }
        return parts.length ? parts : [''];
    }
    function table(kind) {
        var headers = columns(kind);
        var rows = [];
        plan[kind].forEach(function (uses, index) {
            var number = kind === 'inputs' ? 'CH' + (index + 1) : label(index);
            uses.forEach(function (entry, use) {
                var cells = [chunks(entry.scene), chunks(entry.label), chunks(entry.connection), chunks(entry.notes)];
                var length = Math.max.apply(null, cells.map(function (cell) { return cell.length; }));
                for (var part = 0; part < length; part++) {
                    var marker = number + (uses.length > 1 ? '\nBelegung ' + (use + 1) : '') + (part ? '\n(Forts.)' : '');
                    rows.push([{ text: marker, bold: true }].concat(cells.map(function (cell) { return wrap(cell[part] || ''); })));
                }
            });
        });
        if (!rows.length) rows.push([{ text: 'Keine Kanäle eingerichtet.', colSpan: 5 }, {}, {}, {}, {}]);
        return pdf.table(headers, [56, 110, 150, 140, '*'], rows, { dontBreakRows: true, keepWithHeaderRows: 1 });
    }
    function columns(kind) {
        return kind === 'inputs' ? ['Kanal', 'Programm / Szene', 'Signal', 'Anschluss / Quelle', 'Notizen'] :
            ['Ausgang', 'Programm / Szene', 'Bezeichnung', 'Ziel / Verwendung', 'Notizen'];
    }
    function detailedDefinition() {
        const content = [
            pdf.cover(source, 'Kanalplan', data.project),
            { text: 'Exportiert: ' + data.date + '  ·  Gespeicherter Stand: ' + plan.revision, style: 'muted' },
            pdf.heading('Eingänge (' + plan.inputCount + ')'),
            table('inputs'),
            pdf.heading('Ausgänge (' + plan.outputCount + ')', { pageBreak: 'before' }),
            table('outputs')
        ];
        return pdf.definition({ source, title: 'Kanalplan - ' + data.project, subject: 'Kanalbelegung und Verkabelung',
            content, orientation: 'landscape' });
    }

    function compactDefinition(fontSize, countPages) {
        function compactTable(kind) {
            var rows = [];
            plan[kind].forEach(function (uses, index) {
                var number = kind === 'inputs' ? 'CH' + (index + 1) : label(index);
                uses.forEach(function (entry, use) {
                    rows.push([{ text: number + (uses.length > 1 ? ' /' + (use + 1) : ''), bold: true },
                        wrap(entry.scene), wrap(entry.label), wrap(entry.connection), wrap(entry.notes)]);
                });
            });
            if (!rows.length) rows.push([{ text: 'Keine Kanäle eingerichtet.', colSpan: 5 }, {}, {}, {}, {}]);
            var result = pdf.table(columns(kind), [33, 74, 110, 105, '*'], rows);
            result.layout = pdf.tableLayout(fontSize * .16);
            result.margin = [0, 0, 0, 4];
            return result;
        }
        var content = [
            pdf.cover(source, 'Kanalplan', data.project, true),
            { text: 'Exportiert: ' + data.date + '  ·  Gespeicherter Stand: ' + plan.revision, style: 'muted' },
            pdf.heading('Eingänge (' + plan.inputCount + ')', { fontSize: 9, margin: [0, 4, 0, 3] }),
            compactTable('inputs'),
            pdf.heading('Ausgänge (' + plan.outputCount + ')', { fontSize: 9, margin: [0, 4, 0, 3] }),
            compactTable('outputs')
        ];
        return pdf.definition({ source, title: 'Kanalplan - ' + data.project, subject: 'Kanalbelegung und Verkabelung (Einblattansicht)',
            content, compact: true, fontSize, onPages: countPages });
    }

    var layout = document.getElementById('channel-pdf-layout'), download = document.getElementById('channel-pdf-download');
    var open = document.getElementById('channel-pdf-open'), generation = 0, objectUrl = null;
    layout.value = new URLSearchParams(location.search).get('layout') === 'single' ? 'single' : 'detail';
    function failed(failure) {
        status.textContent = 'PDF nicht verfügbar';
        error.textContent = failure.message || 'Das PDF konnte nicht erstellt werden. Bitte versuche es erneut.';
    }
    function generate(autoDownload) {
        var current = ++generation, mode = layout.value;
        download.disabled = true; open.disabled = true; error.textContent = '';
        status.textContent = mode === 'single' ? 'Kanalplan wird an eine A4-Seite angepasst …' : 'PDF wird erstellt …';
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        function ready(blob, definition) {
            if (current !== generation) return;
            window.channelPdfDefinition = definition;
            objectUrl = URL.createObjectURL(blob);
            var filename = pdf.filename('Kanalplan', data.project, mode === 'single' ? 'Einblattansicht' : '');
            download.onclick = function () { var a = document.createElement('a'); a.href = objectUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); };
            open.onclick = function () { window.open(objectUrl, '_blank', 'noopener'); };
            download.disabled = false; open.disabled = false;
            status.textContent = mode === 'single'
                ? (definition.defaultStyle.fontSize < 5 ? 'Die Einblattansicht ist bereit. Für besser lesbare Schrift wähle die Detailansicht.' : 'Die Einblattansicht ist bereit.')
                : 'Die Detailansicht ist bereit.';
            if (autoDownload) download.click();
        }
        // First find a font size that fits, then refine upwards for readable text.
        // All fields and uses remain in the PDF; nothing is truncated or omitted.
        function fit(fontSize, upper, rounds, best, attempts) {
            if (current !== generation) return;
            if (attempts > 12) {
                if (best) return ready(best.blob, best.definition);
                return failed(new Error('Der Plan passt in lesbarer Schrift nicht auf eine Seite. Bitte wähle die Detailansicht.'));
            }
            var pages = 0, definition = compactDefinition(fontSize, function (count) { pages = count; });
            pdf.create(definition).getBlob(function (blob) {
                if (current !== generation) return;
                if (pages === 1) {
                    best = { blob: blob, definition: definition, fontSize: fontSize };
                    if (!upper || rounds === 0) return ready(blob, definition);
                    return fit((fontSize + upper) / 2, upper, rounds - 1, best, attempts + 1);
                }
                if (best) {
                    if (rounds === 0) return ready(best.blob, best.definition);
                    return fit((best.fontSize + fontSize) / 2, fontSize, rounds - 1, best, attempts + 1);
                }
                fit(Math.max(0.0001, fontSize * Math.min(0.8, 0.9 / Math.max(2, pages))), fontSize, 4, null, attempts + 1);
            });
        }
        try {
            if (!plan.configured) throw new Error('Bitte richte den Kanalplan ein und speichere ihn vor dem Export.');
            if (mode === 'single') fit(7.5, null, 4, null, 0);
            else {
                var definition = detailedDefinition();
                pdf.create(definition).getBlob(function (blob) { ready(blob, definition); });
            }
        } catch (failure) { failed(failure); }
    }
    layout.onchange = function () {
        var url = new URL(location.href); url.searchParams.set('layout', layout.value); history.replaceState(null, '', url);
        generate(false);
    };
    generate(true);
}());
