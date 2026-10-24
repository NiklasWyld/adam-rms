/* Uses AdamRMS's existing jQuery, Bootstrap modals and Bootbox. */
$(function () {
    'use strict';
    var state = JSON.parse(document.getElementById('shopping-data').textContent);
    var list = state.list;
    function error(message, form) {
        var target = form ? $(form).find('.form-error') : $('#shopping-error');
        target.text(message).removeClass('d-none');
    }
    function call(action, data) {
        return $.ajax({
            url: state.root + '/api/shoppingLists/action.php', method: 'POST', dataType: 'json',
            data: Object.assign({}, data, { action: action, csrf: state.csrf })
        }).then(function (result) {
            if (!result.result) return $.Deferred().reject(result.error ? result.error.message : 'Unable to save.').promise();
            return result.response;
        }, function () { return $.Deferred().reject('Unable to connect. Please try again.').promise(); });
    }
    function go(id) { window.location.assign(state.root + '/shoppingLists/' + (id ? '?id=' + id : '')); }
    function fields(form, data) {
        form.reset();
        $(form).find('.form-error').addClass('d-none');
        Object.keys(data).forEach(function (key) {
            var input = form.elements.namedItem(key);
            if (input) input.value = data[key] == null ? '' : data[key];
        });
    }
    function itemData(item) {
        var data = { itemId: item.shoppingListItems_id, manufacturerId: item.manufacturers_id, categoryId: item.assetCategories_id, unitPrice: item.unitPriceDecimal };
        ['name', 'model', 'description', 'quantity', 'unit', 'supplier', 'sku', 'url', 'image', 'notes', 'priority', 'reason', 'status'].forEach(function (key) {
            data[key] = item['shoppingListItems_' + key] == null ? '' : item['shoppingListItems_' + key];
        });
        return data;
    }
    function findItem(id) { return list.items.find(function (item) { return String(item.shoppingListItems_id) === String(id); }); }
    $('#new-list').on('click', function () {
        fields(document.getElementById('list-form'), { status: 'draft' });
        $('#list-status option[value=archived]').prop('disabled', true);
        $('#list-modal-title').text('New shopping list');
        $('#list-modal').modal('show');
    });
    $('[data-list-edit]').on('click', function () {
        var id = String(this.dataset.listEdit);
        var current = list || state.lists.find(function (row) { return String(row.shoppingLists_id) === id; });
        fields(document.getElementById('list-form'), {
            id: current.shoppingLists_id, name: current.shoppingLists_name, description: current.shoppingLists_description,
            budget: current.budgetDecimal, status: current.shoppingLists_status, comment: current.shoppingLists_comment
        });
        $('#list-status option[value=archived]').prop('disabled', current.shoppingLists_status !== 'archived');
        $('#list-modal-title').text('Edit shopping list');
        $('#list-modal').modal('show');
    });
    $('#new-item').on('click', function () {
        fields(document.getElementById('item-form'), { quantity: '1', status: 'planned' });
        $('#item-modal-title').text('Add item');
        $('#item-modal').modal('show');
        preview();
    });
    $('[data-item-edit]').on('click', function () {
        fields(document.getElementById('item-form'), itemData(findItem(this.dataset.itemEdit)));
        $('#item-modal-title').text('Edit shopping item');
        $('#item-modal').modal('show');
        preview();
    });
    $('#list-modal, #item-modal').on('shown.bs.modal', function () { $(this).find('input:not([type=hidden])').first().trigger('focus'); });
    $('#list-form, #item-form').on('submit', function (event) {
        event.preventDefault();
        var form = this, data = {};
        $(form).serializeArray().forEach(function (field) { data[field.name] = field.value; });
        var item = form.id === 'item-form';
        if (item) data.id = list.shoppingLists_id;
        var button = $(form).find('[type=submit]').prop('disabled', true);
        call(item ? 'saveItem' : 'saveList', data).done(function (result) { go(result.id); })
            .fail(function (message) { error(message, form); button.prop('disabled', false); });
    });
    $('[data-action]').on('click', function () {
        var button = this, action = button.dataset.action;
        var id = button.dataset.id || (list && list.shoppingLists_id);
        function run() {
            $(button).prop('disabled', true);
            call(action, { id: id, itemId: button.dataset.itemId || '' }).done(function (result) {
                go(action === 'deleteList' ? null : (action === 'archiveList' && !list ? null : result.id));
            }).fail(function (message) { error(message); $(button).prop('disabled', false); });
        }
        if (action === 'deleteList' || action === 'deleteItem' || action === 'archiveList') {
            bootbox.confirm(action === 'archiveList' ? 'Archive this shopping list?' : 'Remove this ' + (action === 'deleteItem' ? 'item' : 'shopping list') + '?', function (confirmed) { if (confirmed) run(); });
        } else run();
    });
    $('.item-status').on('change', function () {
        var select = this;
        var data = Object.assign(itemData(findItem(select.dataset.item)), { id: list.shoppingLists_id, status: select.value });
        $(select).prop('disabled', true);
        call('saveItem', data).done(function (result) { go(result.id); }).fail(function (message) {
            error(message); select.value = findItem(select.dataset.item).shoppingListItems_status; $(select).prop('disabled', false);
        });
    });
    $('[data-move]').on('click', function () {
        var order = list.items.map(function (item) { return String(item.shoppingListItems_id); });
        var index = order.indexOf(this.dataset.itemId), next = index + Number(this.dataset.move);
        if (next < 0 || next >= order.length) return;
        var swapped = order[index]; order[index] = order[next]; order[next] = swapped;
        $('[data-move]').prop('disabled', true);
        call('reorder', { id: list.shoppingLists_id, order: order }).done(function (result) { go(result.id); })
            .fail(function (message) { error(message); window.location.reload(); });
    });
    function filterItems() {
        var search = ($('#item-search').val() || '').toLowerCase(), priority = $('#priority-filter').val(), status = $('#item-status-filter').val(), visible = 0;
        $('#items-table tbody tr[data-item]').each(function () {
            var show = (!search || $(this).find('td').first().text().toLowerCase().includes(search)) &&
                (!priority || this.dataset.priority === priority) && (!status || this.dataset.status === status);
            $(this).toggle(show); if (show) visible++;
        });
        $('#no-matching-items').toggleClass('d-none', visible > 0 || !list.items.length);
    }
    $('#item-search, #priority-filter, #item-status-filter').on('input change', filterItems);
    $('#list-search, #list-status-filter').on('input change', function () {
        var search = ($('#list-search').val() || '').toLowerCase(), status = $('#list-status-filter').val(), visible = 0;
        $('#lists-table tbody tr[data-list]').each(function () {
            var show = (!search || $(this).find('td').first().text().toLowerCase().includes(search)) && (!status || this.dataset.status === status);
            $(this).toggle(show); if (show) visible++;
        });
        $('#no-matching-lists').toggleClass('d-none', visible > 0 || !state.lists.length);
    });
    // This preview is informational; authoritative decimal arithmetic always runs on the server.
    function preview() {
        var priceText = $('#item-price').val().replace(',', '.').trim();
        var quantity = Number($('#item-quantity').val().replace(',', '.'));
        var price = Number(priceText);
        var valid = priceText !== '' && quantity > 0 && price >= 0 && Number.isFinite(quantity * price);
        $('#item-price-preview').text(valid ? 'Estimated line total: ' + new Intl.NumberFormat('en-GB', { style: 'currency', currency: list.shoppingLists_currency }).format(quantity * price) : 'Line total: not priced');
    }
    $('#item-price, #item-quantity').on('input', preview);
});
