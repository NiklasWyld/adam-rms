/* Shares pdfMake and embedded Roboto fonts with AdamRMS project exports. */
(function () {
    'use strict';
    var data = JSON.parse(document.getElementById('shopping-pdf-data').textContent), list = data.list;
    var meta = data.meta;
    function text(value) { return value == null ? '' : String(value); }
    // Long unbroken article numbers/URLs must wrap inside their table column.
    function wrap(value) { return text(value).replace(/(\S{28})(?=\S)/g, '$1\u200b'); }
    var heading = ['No.', 'Item / manufacturer / model', 'Quantity', 'Unit price', 'Line total', 'Necessity'];
    var body = [heading.map(function (label) { return { text: label, bold: true, color: '#ffffff', fillColor: '#34495e', margin: [0, 4, 0, 4] }; })];
    list.items.forEach(function (item, index) {
        body.push([
            text(index + 1),
            { stack: [
                { text: wrap(item.shoppingListItems_name), bold: true },
                { text: wrap([item.manufacturer, item.shoppingListItems_model].filter(Boolean).join(' / ')), color: '#586574', fontSize: 8 },
                { text: wrap(item.category), color: '#586574', fontSize: 8 },
                { text: wrap(item.shoppingListItems_description), margin: [0, 3, 0, 0] },
                { text: 'Justification: ' + (wrap(item.shoppingListItems_reason) || 'Not specified'), margin: [0, 5, 0, 0] },
                { text: 'Status: ' + meta.itemStatuses[item.shoppingListItems_status] + (item.shoppingListItems_status === 'rejected' ? ' (excluded from estimate)' : ''), fontSize: 8, margin: [0, 5, 0, 0] },
                { text: wrap([item.shoppingListItems_supplier, item.shoppingListItems_sku].filter(Boolean).join(' / ')), fontSize: 8 },
                { text: wrap(item.shoppingListItems_url), link: item.shoppingListItems_url || undefined, color: '#315a85', fontSize: 8 },
                { text: wrap(item.shoppingListItems_notes), fontSize: 8, margin: [0, 3, 0, 0] }
            ] },
            text(item.shoppingListItems_quantity).replace(/\.?0+$/, '') + (item.shoppingListItems_unit ? ' ' + wrap(item.shoppingListItems_unit) : ''),
            text(item.unitPriceFormatted), text(item.totalFormatted), meta.priorities[item.shoppingListItems_priority]
        ]);
    });
    if (!list.items.length) body.push([{ text: 'No items in this list.', colSpan: 6, margin: [0, 8, 0, 8] }, {}, {}, {}, {}, {}]);
    var content = [];
    if (data.logo && /^data:image\/(png|jpeg|jpg);base64,/i.test(data.logo)) content.push({ image: data.logo, fit: [160, 65], margin: [0, 0, 0, 14] });
    content.push(
        { text: data.business, color: '#586574', fontSize: 11, margin: [0, 0, 0, 8] },
        { text: wrap(list.shoppingLists_name), fontSize: 23, bold: true, margin: [0, 0, 0, 8] },
        { text: 'Shopping list / planned purchases', color: '#586574', margin: [0, 0, 0, 10] },
        { text: wrap(list.shoppingLists_description), margin: [0, 0, 0, 10] },
        { text: 'Created: ' + list.shoppingLists_created + ' | By: ' + list.creator + '\nExported: ' + data.exported + '\nStatus: ' + meta.statuses[list.shoppingLists_status] + ' | Currency: ' + list.shoppingLists_currency, fontSize: 9, margin: [0, 0, 0, 12] }
    );
    if (list.budgetFormatted !== null) content.push({ text: 'Budget: ' + list.budgetFormatted, bold: true, margin: [0, 0, 0, 12] });
    content.push({ table: { headerRows: 1, widths: [20, '*', 48, 60, 60, 52], body: body },
        layout: { fillColor: function (row) { return row > 0 && row % 2 === 0 ? '#f3f5f7' : null; },
            hLineColor: function () { return '#dde2e6'; }, vLineWidth: function () { return 0; },
            paddingTop: function () { return 7; }, paddingBottom: function () { return 7; } }, margin: [0, 4, 0, 16] });
    content.push({ unbreakable: true, stack: [
        { text: 'Estimated total: ' + list.totalFormatted, bold: true, fontSize: 14, alignment: 'right', margin: [0, 6, 0, 6] },
        { text: list.budgetFormatted !== null ? 'Budget: ' + list.budgetFormatted + ' | Remaining: ' + list.remainingFormatted : 'No budget specified', alignment: 'right', color: list.overBudget ? '#a32323' : '#586574' },
        { text: list.missingPrices + ' unpriced items; ' + list.excludedItems + ' rejected items excluded.\nEach line is quantity × unit price, rounded half up to the currency subunit. All other statuses are included. Taxes and delivery are included only if entered in the prices or as separate items.', fontSize: 8, color: '#586574', margin: [0, 10, 0, 0] }
    ] });
    if (list.shoppingLists_comment) content.push({ text: 'General comment', bold: true, margin: [0, 18, 0, 5] }, { text: wrap(list.shoppingLists_comment) });
    var definition = {
        pageSize: 'A4', pageMargins: [36, 42, 36, 48], defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.15 },
        info: { title: list.shoppingLists_name, author: data.business, subject: 'Planned procurement - independent of inventory' },
        content: content,
        footer: function (page, pages) { return { columns: [
            { text: 'AdamRMS | Shopping list #' + list.shoppingLists_id, width: '*' },
            { text: page + ' / ' + pages, alignment: 'right', width: 60 }
        ], margin: [36, 16, 36, 0], fontSize: 8, color: '#586574' }; }
    };
    window.shoppingPdfDefinition = definition;
    function createPdf() {
        if (typeof pdfMake === 'undefined') throw new Error('The PDF library could not be loaded. Check your connection and try again.');
        return pdfMake.createPdf(definition);
    }
    function failed(error) { document.getElementById('pdf-error').textContent = error.message || 'Unable to generate PDF. Please reload and try again.'; }
    var filename = list.shoppingLists_name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 100) + '.pdf';
    document.getElementById('download-pdf').onclick = function () { try { createPdf().download(filename); } catch (error) { failed(error); } };
    document.getElementById('open-pdf').onclick = function () { try { createPdf().open(); } catch (error) { failed(error); } };
    try {
        createPdf();
        document.getElementById('download-pdf').disabled = false;
        document.getElementById('open-pdf').disabled = false;
        document.getElementById('pdf-status').textContent = 'Your PDF is ready. If the download does not start, use the button below.';
        createPdf().download(filename);
    } catch (error) { failed(error); }
}());
