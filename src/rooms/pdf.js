(() => {
    'use strict';
    const pdf = window.AdamPdf;
    const data = pdf.read('room-pdf-data');
    const source = pdf.business();
    const plan = data.plan;
    const request = data.type === 'request';
    const title = request ? 'Raumanfrage' : 'Raumplanung';
    const project = plan.project.projects_name;
    const reservations = request ? plan.request.bookings : plan.bookings;
    const statuses = pdf.labels.room;
    const content = [pdf.cover(source, title, project)];
    if (plan.request.eventDates) content.push({ text: 'Veranstaltungsdatum: ' + pdf.date(plan.request.eventDates) });
    content.push({ text: 'Zeitzone: ' + plan.timeZone + '  ·  Exportiert: ' + data.date, style: 'muted', margin: [0, 3, 0, 10] });
    if (request) content.push({ text: 'Für die Veranstaltung werden folgende Räume benötigt. Bitte prüfen Sie die Verfügbarkeit und bestätigen Sie die Reservierung.', margin: [0, 0, 0, 12] });
    else content.push({ text: plan.summary.rooms + (plan.summary.rooms === 1 ? ' Raum' : ' Räume') + '  ·  ' +
        plan.summary.confirmed + ' bestätigt  ·  ' + plan.summary.open + ' offen  ·  ' + plan.summary.conflicts +
        (plan.summary.conflicts === 1 ? ' Überschneidung' : ' Überschneidungen'), margin: [0, 0, 0, 12] });

    if (reservations.length) {
        const rows = reservations.map(room => {
            const purpose = [{ text: pdf.wrap(room.roomReservations_purpose), bold: true }];
            if (room.roomReservations_notes) purpose.push({ text: pdf.wrap(room.roomReservations_notes), margin: [0, 4, 0, 0] });
            if (!request) for (const conflict of room.conflicts || []) purpose.push({
                text: (conflict.severity === 'confirmed' ? 'Bestätigte Überschneidung: ' : 'Mögliche Überschneidung: ') +
                    pdf.wrap(conflict.projects_name) + '  ·  ' + conflict.period, color: '#9a3412', fontSize: 8, margin: [0, 4, 0, 0]
            });
            return [
                { stack: [
                    { text: pdf.wrap(room.rooms_name + (room.rooms_number ? ' (' + room.rooms_number + ')' : '')), bold: true },
                    { text: pdf.wrap(room.building), style: 'muted' }
                ] },
                room.period,
                { stack: purpose },
                statuses[room.roomReservations_status]
            ];
        });
        content.push(pdf.table(['Raum', 'Zeitraum', 'Verwendung / Bemerkungen', 'Status'], [95, 112, '*', 59], rows));
    } else content.push({ text: request ? 'Keine offenen Raumbelegungen vorhanden.' : 'Keine Raumbelegungen vorhanden.' });
    content.push({ text: request
        ? 'Vielen Dank für Ihre Rückmeldung. Dieser Entwurf enthält geplante und angefragte Belegungen. Der Export ändert keinen Reservierungsstatus.'
        : 'Die interne Bestätigung ersetzt keine Reservierung im offiziellen Schulverwaltungssystem. Abgelehnte und stornierte Belegungen zählen nicht als aktive Konflikte.',
        style: 'muted', margin: [0, 9, 0, 0] });
    const doc = pdf.definition({ source, title: title + ' - ' + project, content });
    window.roomPdfDefinition = doc;
    pdf.downloadPage(doc, pdf.filename(title, project), 'room-', false);
})();
