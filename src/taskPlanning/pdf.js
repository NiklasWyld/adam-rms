(() => {
    'use strict';
    const pdf = window.AdamPdf;
    const { plan, exported } = pdf.read('task-pdf-data');
    const source = pdf.business();
    const rows = plan.tasks;
    const completed = rows.filter(task => task.status === 'done').length;
    const checkbox = done => ({ canvas: [
        { type: 'rect', x: 1, y: 2, w: 9, h: 9, lineWidth: .7, lineColor: '#718096' },
        ...(done ? [
            { type: 'line', x1: 2, y1: 6, x2: 5, y2: 9, lineWidth: 1, lineColor: '#275d4d' },
            { type: 'line', x1: 5, y1: 9, x2: 9, y2: 3, lineWidth: 1, lineColor: '#275d4d' }
        ] : [])
    ] });
    const content = [
        pdf.cover(source, 'Aufgabenplan', plan.title),
        { text: completed + ' von ' + rows.length + ' Aufgaben erledigt (' +
            pdf.number(rows.length ? completed / rows.length : 0, { style: 'percent' }) + ')', bold: true },
        { text: (plan.filtered ? 'Gefilterte Aufgabenauswahl' : 'Alle Aufgaben dieser Ansicht') + '  ·  ' +
            plan.timeZone + '  ·  ' + exported, style: 'muted', margin: [0, 5, 0, 10] }
    ];
    if (!rows.length) content.push({ text: 'Keine Aufgaben in dieser Auswahl.' });
    const groups = [];
    for (const task of rows) {
        const name = plan.group === 'day' ? (pdf.date(task.day) || 'Ohne Termin') :
            plan.group === 'category' ? (task.category || 'Ohne Kategorie') : 'Aufgaben';
        if (groups.at(-1)?.name !== name) groups.push({ name, tasks: [] });
        groups.at(-1).tasks.push(task);
    }
    for (const group of groups) {
        content.push(pdf.heading(group.name + '  ·  ' + group.tasks.length));
        const body = group.tasks.map(task => [
            checkbox(task.status === 'done'),
            { stack: [
                { text: pdf.wrap(task.title), bold: true },
                { text: pdf.wrap(task.category || 'Ohne Kategorie'), style: 'muted' },
                ...(!plan.project && task.projectName ? [{ text: pdf.wrap(task.projectName), style: 'muted' }] : []),
                ...(task.description ? [{ text: pdf.wrap(task.description), margin: [0, 4, 0, 0] }] : []),
                ...(plan.includeChecklists ? task.checklist.map(item => ({
                    columns: [{ ...checkbox(item.done), width: 15 }, { text: pdf.wrap(item.title), style: 'muted' }],
                    margin: [0, 3, 0, 0]
                })) : [])
            ] },
            (pdf.date(task.day) || 'Ohne Termin') + (task.time ? ', ' + task.time : '') +
                (task.deadline ? '\nFrist: ' + pdf.date(task.deadline) : ''),
            pdf.wrap(task.assigneeName || 'Nicht zugewiesen'),
            pdf.labels.taskPriority[task.priority] + '\n' + pdf.labels.task[task.status]
        ]);
        content.push(pdf.table(['', 'Aufgabe / Kategorie', 'Termin / Frist', 'Zuständig', 'Priorität / Status'],
            [13, '*', 104, 76, 69], body));
    }
    const doc = pdf.definition({ source, title: 'Aufgabenplan - ' + plan.title, content });
    pdf.downloadPage(doc, pdf.filename('Aufgabenplan', plan.title));
})();
