/* Shared layout for pdfMake exports. Domain data is supplied by the export route. */
window.AdamPdf = (() => {
    'use strict';

    const ink = '#20313f';
    const muted = '#526171';
    const pale = '#eef3f6';
    const mm = value => value * 72 / 25.4;
    const number = (value, options) => new Intl.NumberFormat('de-DE', options).format(value);
    const text = value => String(value ?? '');
    // Break machine identifiers and URLs without replacing their characters.
    const wrap = value => text(value).replace(/(\S{24})(?=\S)/gu, '$1\u200b');
    const date = value => text(value).replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?/g,
        (_, year, month, day, time) => day + '.' + month + '.' + year + (time ? ', ' + time : ''));
    const filename = (...parts) => parts.filter(Boolean).join(' - ').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 140) + '.pdf';
    const read = id => JSON.parse(document.getElementById(id).textContent);
    const business = () => read('pdf-business');
    const logo = (source, fit = [100, 48]) => {
        const image = text(source.logo).replace(/^data:\s*/, 'data:');
        return /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/]+=*$/i.test(image) ? { image, fit, alignment: 'right' } : null;
    };
    const shorten = (value, limit) => text(value).length > limit ? text(value).slice(0, limit - 1) + '…' : text(value);
    const contacts = source => [source.address, source.phone, source.email, source.website].filter(Boolean);
    const heading = (label, extra = {}) => ({ text: wrap(label), style: 'section', headlineLevel: 1, ...extra });
    const headerCells = labels => labels.map(label => ({ text: label, style: 'tableHeader' }));
    const tableLayout = (padding = 5) => ({
        fillColor: row => row === 0 ? pale : row % 2 === 0 ? '#f8fafb' : null,
        hLineWidth: () => .5,
        hLineColor: () => '#dce4e9',
        vLineWidth: () => 0,
        paddingLeft: () => 5,
        paddingRight: () => 5,
        paddingTop: () => padding,
        paddingBottom: () => padding
    });
    const table = (labels, widths, rows, options = {}) => ({
        table: { headerRows: 1, widths, body: [headerCells(labels), ...rows], ...options },
        layout: tableLayout(),
        margin: [0, 0, 0, 12]
    });
    const cover = (source, title, subtitle = '', compact = false) => {
        const mark = logo(source, compact ? [80, 28] : undefined);
        return {
            columns: [{
                width: '*',
                stack: [
                    { text: wrap(source.name), style: 'muted', bold: true, margin: [0, 0, 0, compact ? 2 : 5] },
                    { text: wrap(title), style: 'title', fontSize: compact ? 15 : 23 },
                    ...(subtitle ? [{ text: wrap(subtitle), fontSize: compact ? 8 : 13, margin: [0, 3, 0, 0] }] : []),
                    ...(!compact && contacts(source).length ? [{
                        text: wrap(contacts(source).join('  ·  ').replace(/\r?\n/g, ', ')), style: 'muted', margin: [0, 5, 0, 0]
                    }] : [])
                ]
            }, ...(mark ? [{ ...mark, width: compact ? 84 : 106 }] : [])],
            columnGap: 12,
            margin: [0, 0, 0, compact ? 5 : 13]
        };
    };
    function definition({ source, title, subject, content, orientation = 'portrait', margins, fontSize = 9, compact = false, onPages }) {
        const pageMargins = margins || (compact ? [24, 24, 24, 36] : [40, 42, 40, 51]);
        return {
            pageSize: 'A4', pageOrientation: orientation, pageMargins,
            defaultStyle: { font: 'Roboto', fontSize, lineHeight: compact ? 1.05 : 1.13, color: ink },
            styles: {
                title: { bold: true, fontSize: 23, color: ink },
                section: { bold: true, fontSize: 13, color: ink, margin: [0, 9, 0, 6] },
                tableHeader: { bold: true, color: ink },
                muted: { color: muted, fontSize: 8 }
            },
            info: { title, subject: subject || title, author: text(source.name), keywords: 'AdamRMS', creator: 'AdamRMS' },
            content,
            pageBreakBefore: (node, following) => node.headlineLevel === 1 && following.length === 0,
            header: page => page === 1 ? null : {
                text: wrap(shorten(source.name, 44)) + '  ·  ' + wrap(shorten(title, 68)), style: 'muted',
                margin: [pageMargins[0], 15, pageMargins[2], 0]
            },
            footer: (page, pages) => {
                if (onPages) onPages(pages);
                return {
                    columns: [
                        { text: wrap([source.name, source.phone, source.email, source.website].filter(Boolean).map(value => shorten(value, 34)).join('  ·  ')), width: '*' },
                        { text: 'Seite ' + page + ' von ' + pages, width: 'auto', alignment: 'right' }
                    ],
                    columnGap: 12, style: 'muted', margin: [pageMargins[0], 10, pageMargins[2], 0]
                };
            }
        };
    }
    function create(doc) {
        if (!window.pdfMake?.vfs?.['Roboto-Regular.ttf']) {
            throw new Error('Die PDF-Bibliothek oder die Schrift konnte nicht geladen werden. Bitte lade die Seite erneut.');
        }
        return window.pdfMake.createPdf(doc);
    }
    function showDownload(blob, name, prefix, autoDownload) {
        const status = document.getElementById(prefix + 'pdf-status');
        const download = document.getElementById(prefix + 'pdf-download') || document.getElementById('download-pdf');
        const open = document.getElementById(prefix + 'pdf-open') || document.getElementById('open-pdf');
        const url = URL.createObjectURL(blob);
        window.addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true });
        download.onclick = () => {
            const link = document.createElement('a');
            link.href = url;
            link.download = name;
            link.click();
        };
        open.onclick = () => window.open(url, '_blank', 'noopener');
        download.disabled = open.disabled = false;
        status.textContent = 'Das PDF ist bereit.';
        if (autoDownload) download.click();
    }
    function downloadPage(doc, name, prefix = '', autoDownload = true) {
        try {
            create(doc).getBlob(blob => showDownload(blob, name, prefix, autoDownload));
        } catch (failure) {
            document.getElementById(prefix + 'pdf-status').textContent = '';
            document.getElementById(prefix + 'pdf-error').textContent = failure.message;
        }
    }
    const labels = {
        shopping: { draft: 'Entwurf', active: 'Aktiv', completed: 'Abgeschlossen', archived: 'Archiviert' },
        shoppingItem: { planned: 'Geplant', approved: 'Freigegeben', ordered: 'Bestellt', purchased: 'Gekauft', rejected: 'Abgelehnt' },
        necessity: { essential: 'Unverzichtbar', high: 'Hoch', medium: 'Mittel', low: 'Niedrig', optional: 'Optional' },
        task: { open: 'Offen', progress: 'In Arbeit', blocked: 'Blockiert', done: 'Erledigt' },
        taskPriority: { 0: 'Niedrig', 1: 'Normal', 2: 'Hoch', 3: 'Dringend' },
        room: { planned: 'Geplant', requested: 'Angefragt', confirmed: 'Bestätigt', rejected: 'Abgelehnt', cancelled: 'Storniert' }
    };
    return { mm, text, wrap, date, number, filename, read, business, logo, contacts, heading, headerCells, tableLayout, table, cover, definition, create, showDownload, downloadPage, labels };
})();
