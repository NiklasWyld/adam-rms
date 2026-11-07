/* Form B letterhead for the project business documents. Dimensions are in millimetres. */
window.AdamBusinessLetter = (() => {
    'use strict';

    const pdf = window.AdamPdf;
    const mm = pdf.mm;
    const margins = [mm(25), mm(15), mm(20), mm(24)];
    const lines = value => pdf.text(value).split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
    const flat = value => lines(value).join(', ');
    const zero = () => 0;
    const borderless = {
        hLineWidth: zero, vLineWidth: zero, paddingLeft: zero, paddingRight: zero,
        paddingTop: zero, paddingBottom: zero
    };

    // These are minimum heights. An unusually long address or reference can grow without covering other content.
    function frame(height, cell) {
        return {
            table: { widths: ['*'], heights: mm(height), body: [[cell]] },
            layout: borderless
        };
    }

    function references(rows, widths) {
        return {
            table: {
                widths,
                body: rows.map(([label, value]) => [
                    { text: label, bold: true, margin: [0, 0, 5, 2] },
                    { text: pdf.wrap(value), margin: [0, 0, 0, 2] }
                ])
            },
            layout: borderless
        };
    }

    function returnLine(name, address) {
        const measure = document.createElement('canvas').getContext('2d');
        measure.font = '8pt Arial';
        const width = mm(79) * 96 / 72;
        const full = [name, address].filter(Boolean).join(' · ');
        const spacing = (width - measure.measureText(full).width) * 72 / 96 / Math.max(1, full.length);
        if (spacing >= -.35) return { text: full, characterSpacing: Math.min(0, spacing) };
        if (address && measure.measureText(address).width <= width) return { text: address };
        const characters = Array.from(address || name || '');
        while (measure.measureText(characters.join('') + '…').width > width) characters.pop();
        return { text: characters.join('').trimEnd() + '…' };
    }

    function front(source, data, info) {
        const logo = pdf.logo(source, [mm(46), mm(19)]);
        const sender = returnLine(source.name, data.address ? flat(source.address) : '');
        const recipient = [data.recipient.name, ...lines(data.recipient.address)].filter(Boolean);
        return [
            frame(30, { columns: [
                { text: pdf.wrap(source.name), fontSize: 16, bold: true, width: '*' },
                ...(logo ? [{ ...logo, width: mm(46) }] : [])
            ], columnGap: mm(6) }),
            frame(45, {
                columns: [
                    { width: mm(80), stack: [
                        frame(17.7, { ...sender, style: 'muted', noWrap: true, decoration: sender.text ? 'underline' : undefined }),
                        { text: pdf.wrap(recipient.join('\n')) }
                    ] },
                    { width: '*', stack: [references(info, [mm(27), '*'])], fontSize: 9, margin: [0, mm(5), 0, 0] }
                ],
                columnGap: mm(20)
            }),
            { text: pdf.wrap(data.title), style: 'title', headlineLevel: 1, margin: [0, mm(8.46), 0, 4] },
            { text: pdf.wrap(data.project), fontSize: 11, bold: true, margin: [0, 0, 0, mm(5)] }
        ];
    }

    function details(rows) {
        const compact = rows.filter(([, value]) => !value.includes('\n') && value.length <= 22);
        const wide = rows.filter(row => !compact.includes(row));
        const label = mm(39);
        const result = wide.length ? [references(wide, [label, '*'])] : [];
        for (let i = 0; i < compact.length; i += 2) {
            result.push({
                columns: [
                    { width: '*', stack: [references([compact[i]], [label, '*'])] },
                    compact[i + 1] ? { width: '*', stack: [references([compact[i + 1]], [label, '*'])] } : { width: '*', text: '' }
                ],
                columnGap: mm(5)
            });
        }
        return { stack: result, margin: [0, 0, 0, 8] };
    }

    function section(title, value) {
        return {
            stack: [pdf.heading(title), { text: pdf.wrap(value) }],
            unbreakable: value.length <= 480 && lines(value).length <= 8
        };
    }

    function materialTable(title, labels, widths, rows) {
        // Exceptionally long notes and custom fields need to be able to break across pages.
        const firstItemIsCompact = rows[1] && JSON.stringify(rows[1]).length <= 480;
        const result = pdf.table(labels, widths, rows, {
            headerRows: 2,
            keepWithHeaderRows: firstItemIsCompact ? 2 : Math.min(1, rows.length)
        });
        result.table.body.unshift([
            { text: pdf.wrap(title), style: 'section', colSpan: widths.length, margin: [0, 4, 0, 0] },
            ...widths.slice(1).map(() => ({}))
        ]);
        const fillColor = result.layout.fillColor;
        result.layout.fillColor = row => row === 0 ? null : fillColor(row - 1);
        result.layout.hLineWidth = line => line === 0 ? 0 : .5;
        result.layout.paddingLeft = () => 4;
        result.layout.paddingRight = () => 4;
        return result;
    }

    function definition(source, data, content) {
        const title = data.title + ' - ' + data.project;
        const doc = pdf.definition({ source, title, content, margins, fontSize: 10 });
        doc.styles.title.fontSize = 14;
        doc.styles.section.fontSize = 11;
        doc.background = page => page === 1 ? {
            canvas: [105, 148.5, 210].map((y, i) => ({
                type: 'line', x1: mm(5), x2: mm(i === 1 ? 10 : 8),
                y1: mm(y), y2: mm(y), lineWidth: .35, lineColor: '#6b7178'
            }))
        } : null;
        const address = data.address ? flat(source.address) : '';
        doc.footer = (page, pages) => ({
            stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: mm(165), y2: 0, lineWidth: .5, lineColor: '#c5cbd0' }] },
                { columns: [
                    { width: '*', stack: [
                        { text: pdf.wrap([source.name, address].filter(Boolean).join(' · ')), bold: true },
                        { text: pdf.wrap([source.phone, source.email, source.website].filter(Boolean).join(' · ')) }
                    ] },
                    { text: 'Seite ' + page + ' von ' + pages, width: 'auto', alignment: 'right' }
                ], columnGap: 10, margin: [0, 5, 0, 0] }
            ],
            style: 'muted',
            margin: [margins[0], 5, margins[2], 0]
        });
        return doc;
    }

    return { front, details, section, materialTable, definition };
})();
