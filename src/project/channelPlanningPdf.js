(function () {
    'use strict';
    var data = JSON.parse(document.getElementById('channel-pdf-data').textContent), plan = data.plan;
    var error = document.getElementById('channel-pdf-error'), status = document.getElementById('channel-pdf-status');
    function wrap(value) { return String(value || '').replace(/(\S{24})(?=\S)/g, '$1\u200b'); }
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
        var headers = kind === 'inputs' ? ['Channel', 'Programme / scene', 'Signal', 'Connection / source', 'Notes'] : ['Output', 'Programme / scene', 'Label', 'Destination / use', 'Notes'];
        var rows = [headers.map(function (text) { return { text: text, bold: true, color: '#fff', fillColor: '#34495e', margin: [0, 4, 0, 4] }; })];
        plan[kind].forEach(function (uses, index) {
            var number = kind === 'inputs' ? 'CH' + (index + 1) : label(index);
            uses.forEach(function (entry, use) {
                var cells = [chunks(entry.scene), chunks(entry.label), chunks(entry.connection), chunks(entry.notes)];
                var length = Math.max.apply(null, cells.map(function (cell) { return cell.length; }));
                for (var part = 0; part < length; part++) {
                    var marker = number + (uses.length > 1 ? '\nUse ' + (use + 1) : '') + (part ? '\n(cont.)' : '');
                    rows.push([{ text: marker, bold: true }].concat(cells.map(function (cell) { return wrap(cell[part] || ''); })));
                }
            });
        });
        if (rows.length === 1) rows.push([{ text: 'No channels configured.', colSpan: 5 }, {}, {}, {}, {}]);
        return { table: { headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1, widths: [48, 110, 150, 140, '*'], body: rows },
            layout: { fillColor: function (row) { return row > 0 && row % 2 === 0 ? '#f3f5f7' : null; },
                hLineColor: function () { return '#dce1e5'; }, vLineWidth: function () { return 0; },
                paddingTop: function () { return 7; }, paddingBottom: function () { return 7; } } };
    }
    function detailedDefinition() {
    var content = [];
    if (data.logo && /^data:\s*image\/(png|jpe?g);base64,/i.test(data.logo)) content.push({ image: data.logo.replace(/^data:\s*/, 'data:'), fit: [140, 55], margin: [0, 0, 0, 12] });
    content.push(
        { text: wrap(data.business), fontSize: 10, color: '#586574', margin: [0, 0, 0, 8] },
        { text: 'Channel Planning', fontSize: 24, bold: true, margin: [0, 0, 0, 8] },
        { text: wrap(data.project), fontSize: 15, margin: [0, 0, 0, 8] },
        { text: 'Exported: ' + data.date + ' | Saved revision: ' + plan.revision, fontSize: 9, color: '#586574', margin: [0, 0, 0, 20] },
        { text: 'Inputs (' + plan.inputCount + ')', fontSize: 15, bold: true, headlineLevel: 1, margin: [0, 0, 0, 10] },
        table('inputs'),
        { text: 'Outputs (' + plan.outputCount + ')', fontSize: 15, bold: true, pageBreak: 'before', margin: [0, 0, 0, 10] },
        table('outputs')
    );
    var definition = {
        pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [32, 36, 32, 44],
        defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.15 },
        info: { title: 'Channel Planning - ' + data.project, author: data.business, subject: 'Channel and cable plan' },
        content: content,
        pageBreakBefore: function (node, following) { return node.headlineLevel === 1 && following.length === 0; },
        footer: function (page, pages) { return { columns: [
            { text: 'AdamRMS | Channel Planning | Project #' + data.projectId },
            { text: page + ' / ' + pages, alignment: 'right', width: 65 }
        ], margin: [32, 14, 32, 0], fontSize: 8, color: '#586574' }; }
    };
    return definition;
    }

    function compactDefinition(fontSize, countPages) {
        function compactTable(kind) {
            var headings = kind === 'inputs' ? ['Channel', 'Programme / scene', 'Signal', 'Connection / source', 'Notes'] : ['Output', 'Programme / scene', 'Label', 'Destination / use', 'Notes'];
            var rows = [headings.map(function (heading) { return { text: heading, fontSize: 7, bold: true, color: '#fff', fillColor: '#34495e' }; })];
            plan[kind].forEach(function (uses, index) {
                var number = kind === 'inputs' ? 'CH' + (index + 1) : label(index);
                uses.forEach(function (entry, use) {
                    rows.push([{ text: number + (uses.length > 1 ? ' /' + (use + 1) : ''), bold: true },
                        wrap(entry.scene), wrap(entry.label), wrap(entry.connection), wrap(entry.notes)]);
                });
            });
            if (rows.length === 1) rows.push([{ text: 'No channels configured.', colSpan: 5 }, {}, {}, {}, {}]);
            return { table: { headerRows: 1, widths: [32, 72, 114, 102, '*'], body: rows },
                layout: {
                    fillColor: function (row) { return row > 0 && row % 2 === 0 ? '#f3f5f7' : null; },
                    hLineColor: function () { return '#dce1e5'; }, hLineWidth: function () { return fontSize * 0.04; },
                    vLineWidth: function () { return 0; },
                    paddingLeft: function () { return 3; }, paddingRight: function () { return 3; },
                    paddingTop: function () { return fontSize * 0.16; }, paddingBottom: function () { return fontSize * 0.16; }
                } };
        }
        var content = [];
        if (data.logo && /^data:\s*image\/(png|jpe?g);base64,/i.test(data.logo)) content.push({ image: data.logo.replace(/^data:\s*/, 'data:'), fit: [90, 30], margin: [0, 0, 0, 5] });
        content.push(
            { text: wrap(data.business), fontSize: 8, color: '#586574', margin: [0, 0, 0, 4] },
            { text: 'Channel Planning', fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
            { text: wrap(data.project), fontSize: 10, margin: [0, 0, 0, 4] },
            { text: 'Exported: ' + data.date + ' | Saved revision: ' + plan.revision, fontSize: 7, color: '#586574', margin: [0, 0, 0, 8] },
            { text: 'Inputs (' + plan.inputCount + ')', fontSize: 10, bold: true, margin: [0, 0, 0, 4] },
            compactTable('inputs'),
            { text: 'Outputs (' + plan.outputCount + ')', fontSize: 10, bold: true, margin: [0, 8, 0, 4] },
            compactTable('outputs')
        );
        return {
            pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [24, 24, 24, 30],
            defaultStyle: { font: 'Roboto', fontSize: fontSize, lineHeight: 1.05 },
            info: { title: 'Channel Planning - ' + data.project, author: data.business, subject: 'Channel and cable plan - one sheet' },
            content: content,
            // The public footer callback reports the actual rendered page count.
            footer: function (page, pages) {
                countPages(pages);
                return { text: 'AdamRMS | Channel Planning | Project #' + data.projectId,
                    margin: [24, 10, 24, 0], fontSize: 7, color: '#586574' };
            }
        };
    }

    var layout = document.getElementById('channel-pdf-layout'), download = document.getElementById('channel-pdf-download');
    var open = document.getElementById('channel-pdf-open'), generation = 0, objectUrl = null;
    layout.value = new URLSearchParams(location.search).get('layout') === 'single' ? 'single' : 'detail';
    function failed(failure) {
        status.textContent = 'PDF unavailable';
        error.textContent = failure.message || 'Unable to generate PDF. Please try again.';
    }
    function generate(autoDownload) {
        var current = ++generation, mode = layout.value;
        download.disabled = true; open.disabled = true; error.textContent = '';
        status.textContent = mode === 'single' ? 'Fitting all channels onto one A4 portrait page…' : 'Preparing your PDF…';
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
        function ready(blob, definition) {
            if (current !== generation) return;
            window.channelPdfDefinition = definition;
            objectUrl = URL.createObjectURL(blob);
            var filename = ('Channel Planning - ' + data.project + (mode === 'single' ? ' - One sheet' : '')).replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) + '.pdf';
            download.onclick = function () { var a = document.createElement('a'); a.href = objectUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); };
            open.onclick = function () { window.open(objectUrl, '_blank', 'noopener'); };
            download.disabled = false; open.disabled = false;
            status.textContent = mode === 'single' ? 'Your one-page A4 portrait PDF is ready.' : 'Your detailed PDF is ready.';
            if (autoDownload) download.click();
        }
        // First find a font size that fits, then refine upwards for readable text.
        // All fields and uses remain in the PDF; nothing is truncated or omitted.
        function fit(fontSize, upper, rounds, best, attempts) {
            if (current !== generation) return;
            if (attempts > 12) {
                if (best) return ready(best.blob, best.definition);
                return failed(new Error('Unable to fit this plan onto one page. Please choose Detail.'));
            }
            var pages = 0, definition = compactDefinition(fontSize, function (count) { pages = count; });
            pdfMake.createPdf(definition).getBlob(function (blob) {
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
            if (!plan.configured) throw new Error('Configure and save the project channel plan before exporting.');
            if (typeof pdfMake === 'undefined' || !pdfMake.vfs || !pdfMake.vfs['Roboto-Regular.ttf']) throw new Error('The PDF library or fonts could not be loaded. Reload the page and try again.');
            if (mode === 'single') fit(7.5, null, 4, null, 0);
            else {
                var definition = detailedDefinition();
                pdfMake.createPdf(definition).getBlob(function (blob) { ready(blob, definition); });
            }
        } catch (failure) { failed(failure); }
    }
    layout.onchange = function () {
        var url = new URL(location.href); url.searchParams.set('layout', layout.value); history.replaceState(null, '', url);
        generate(false);
    };
    generate(true);
}());
