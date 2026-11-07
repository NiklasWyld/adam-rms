(() => {
    'use strict';

    const pdf = window.AdamPdf;
    const { project, shifts } = pdf.read('shift-pdf-data');
    const source = pdf.business();
    const title = project.projects_name;
    const formatDay = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const content = [pdf.cover(source, 'Schichtplanung', title)];
    const eventStart = project.projects_dates_use_start;
    const eventEnd = project.projects_dates_use_end;
    if (eventStart || eventEnd) {
        const sameDay = eventStart && eventEnd && eventStart.slice(0, 10) === eventEnd.slice(0, 10);
        const date = [pdf.date(eventStart), sameDay ? eventEnd.slice(11, 16) : pdf.date(eventEnd)].filter(Boolean).join(' - ');
        content.push({ text: 'Veranstaltungstermin: ' + date, margin: [0, 0, 0, 14] });
    }

    // Keep each crew row together. Split long notes into bounded rows so they can span pages.
    function detailParts(value) {
        const parts = [];
        let remaining = value.replace(/\r\n?/g, '\n');
        while (remaining) {
            const lines = remaining.split('\n', 9);
            const firstLines = lines.slice(0, 8).join('\n');
            const characters = Array.from(firstLines);
            const chunk = characters.slice(0, 600).join('');
            const space = chunk.lastIndexOf(' ');
            const end = characters.length > 600 && space > chunk.length / 2 ? space : chunk.length;
            parts.push(remaining.slice(0, end));
            remaining = remaining.slice(end).trimStart();
        }
        return parts;
    }

    const singleLine = value => pdf.wrap(value.replace(/\s+/g, ' '));
    const days = new Map();
    for (const shift of shifts) {
        const day = shift.start.slice(0, 10);
        if (!days.has(day)) days.set(day, []);
        const rows = days.get(day);
        const end = shift.end.slice(0, 10) === day ? shift.end.slice(11, 16) : pdf.date(shift.end);
        const time = shift.start.slice(11, 16) + ' - ' + end;
        const people = shift.assignments.length ? shift.assignments : [{ name: 'Unbesetzt', role: '' }];
        for (const [index, person] of people.entries()) {
            rows.push([
                { text: time, style: index ? 'muted' : undefined },
                { text: singleLine(shift.title), bold: index === 0, style: index ? 'muted' : undefined },
                singleLine(person.name), singleLine(person.role)
            ]);
        }
        for (const [label, value] of [['Allgemeine Aufgaben', shift.tasks], ['Treffpunkt', shift.meetingPoint], ['Notizen', shift.notes]]) {
            for (const [index, part] of detailParts(value).entries()) {
                const description = index ? label + ' (Fortsetzung)' : label;
                rows.push([
                    { text: time, style: 'muted' },
                    { colSpan: 3, text: [{ text: singleLine(shift.title) + ' · ' + description + ': ', bold: true }, pdf.wrap(part)] }, {}, {}
                ]);
            }
        }
    }
    for (const [day, rows] of days) {
        const table = pdf.table(['Uhrzeit', 'Schicht', 'Person', 'Aufgabe oder Rolle'], [88, '*', 122, 130], rows,
            { headerRows: 2, keepWithHeaderRows: 1, dontBreakRows: true });
        table.table.body.unshift([
            { text: formatDay.format(new Date(day + 'T12:00:00Z')), colSpan: 4, style: 'tableHeader', fontSize: 11 }, {}, {}, {}
        ]);
        content.push(table);
    }
    if (!days.size) content.push({ text: 'Noch keine Schichten geplant.' });

    const document = pdf.definition({ source, title: 'Schichtplanung - ' + title, content, fontSize: 10 });
    pdf.downloadPage(document, pdf.filename('Schichtplanung', title));
})();
