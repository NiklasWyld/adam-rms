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
    window.channelPdfDefinition = definition;
    try {
        if (!plan.configured) throw new Error('Configure and save the project channel plan before exporting.');
        if (typeof pdfMake === 'undefined' || !pdfMake.vfs || !pdfMake.vfs['Roboto-Regular.ttf']) throw new Error('The PDF library or fonts could not be loaded. Reload the page and try again.');
        pdfMake.createPdf(definition).getBlob(function (blob) {
            var url = URL.createObjectURL(blob), download = document.getElementById('channel-pdf-download'), open = document.getElementById('channel-pdf-open');
            var filename = ('Channel Planning - ' + data.project).replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) + '.pdf';
            download.onclick = function () { var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); };
            open.onclick = function () { window.open(url, '_blank', 'noopener'); };
            download.disabled = false; open.disabled = false; status.textContent = 'Your PDF is ready.';
            download.click();
        });
    } catch (failure) { status.textContent = 'PDF unavailable'; error.textContent = failure.message || 'Unable to generate PDF.'; }
}());
