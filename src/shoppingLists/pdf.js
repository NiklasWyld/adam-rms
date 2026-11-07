(() => {
    'use strict';
    const pdf = window.AdamPdf;
    const { list, exported } = pdf.read('shopping-pdf-data');
    const source = pdf.business();
    const name = list.shoppingLists_name;
    const content = [
        pdf.cover(source, 'Einkaufsliste', name),
        { text: 'Status: ' + pdf.labels.shopping[list.shoppingLists_status] + '  ·  Währung: ' + list.shoppingLists_currency },
        { text: 'Erstellt: ' + pdf.date(list.shoppingLists_created) + (list.creator ? '  ·  Von: ' + list.creator : '') +
            '\nExportiert: ' + exported, style: 'muted', margin: [0, 4, 0, 10] }
    ];
    if (list.shoppingLists_description) content.push({ text: pdf.wrap(list.shoppingLists_description), margin: [0, 0, 0, 10] });

    const groups = new Map();
    list.items.forEach((item, index) => {
        const category = item.category || 'Ohne Kategorie';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push({ item, index });
    });
    if (!list.items.length) content.push({ text: 'Diese Einkaufsliste enthält keine Artikel.', margin: [0, 6, 0, 12] });
    for (const [category, entries] of groups) {
        content.push(pdf.heading(category));
        const rows = entries.map(({ item, index }) => [
            String(index + 1),
            { stack: [
                { text: pdf.wrap(item.shoppingListItems_name), bold: true },
                { text: pdf.wrap([item.manufacturer, item.shoppingListItems_model].filter(Boolean).join(' / ')), style: 'muted' }
            ] },
            { text: pdf.number(item.shoppingListItems_quantity, { maximumFractionDigits: 3 }) +
                (item.shoppingListItems_unit ? '\n' + pdf.wrap(item.shoppingListItems_unit) : ''), alignment: 'right' },
            { text: item.unitPriceFormatted, alignment: 'right' },
            { text: item.totalFormatted, alignment: 'right' },
            pdf.labels.necessity[item.shoppingListItems_priority] + '\n' + pdf.labels.shoppingItem[item.shoppingListItems_status] +
                (item.shoppingListItems_status === 'rejected' ? ' (ausgenommen)' : '')
        ]);
        content.push(pdf.table(['Pos.', 'Artikel / Hersteller / Modell', 'Menge', 'Einzelpreis', 'Gesamt', 'Bedarf / Status'],
            [22, '*', 46, 69, 69, 73], rows, { dontBreakRows: true, keepWithHeaderRows: 1 }));
    }
    content.push({ unbreakable: true, stack: [
        { text: 'Voraussichtliche Gesamtkosten: ' + list.totalFormatted, fontSize: 13, bold: true, alignment: 'right' },
        { text: list.budgetFormatted === null ? 'Kein Budget hinterlegt' : 'Budget: ' + list.budgetFormatted +
            '  ·  Restbudget: ' + list.remainingFormatted, alignment: 'right', color: list.overBudget ? '#a32323' : '#526171', margin: [0, 4, 0, 0] },
        { text: 'Positionen ohne Preis: ' + list.missingPrices + '. Abgelehnte und ausgenommene Positionen: ' + list.excludedItems +
            '. Positionssummen ergeben sich aus Menge × Einzelpreis, kaufmännisch gerundet. Steuern und Versand sind enthalten, wenn sie im Preis oder als eigene Position erfasst sind.',
            style: 'muted', margin: [0, 8, 0, 0] }
    ] });
    if (list.shoppingLists_comment) content.push(pdf.heading('Allgemeine Anmerkung'), { text: pdf.wrap(list.shoppingLists_comment) });

    const details = list.items.map((item, index) => ({ item, index })).filter(({ item }) =>
        ['reason', 'description', 'supplier', 'sku', 'url', 'notes'].some(key => item['shoppingListItems_' + key]));
    if (details.length) content.push(pdf.heading('Begründungen und Artikeldetails', { pageBreak: 'before' }));
    for (const { item, index } of details) {
        content.push(pdf.heading((index + 1) + '. ' + item.shoppingListItems_name, { fontSize: 10 }));
        const values = { reason: 'Begründung', description: 'Beschreibung', supplier: 'Lieferant', sku: 'Artikelnummer', notes: 'Notizen' };
        for (const [key, label] of Object.entries(values)) {
            const value = item['shoppingListItems_' + key];
            if (value) content.push({ text: [{ text: label + ': ', bold: true }, pdf.wrap(value)], margin: [0, 0, 0, 4] });
        }
        const url = item.shoppingListItems_url;
        if (url) content.push({ text: pdf.wrap(url), link: /^https?:\/\//i.test(url) ? url : undefined, color: '#315a85' });
    }
    const doc = pdf.definition({ source, title: 'Einkaufsliste - ' + name, content });
    window.shoppingPdfDefinition = doc;
    pdf.downloadPage(doc, pdf.filename('Einkaufsliste', name));
})();
