(function () {
    'use strict';
    const root = document.getElementById('tick-settings');
    if (!root) return;
    const el = id => document.getElementById(id);
    let csrf = '', saved, busy = false, editable = false;
    const status = text => { el('tick-settings-status').textContent = text; };
    const error = e => { el('tick-settings-error').textContent = e.message || String(e); el('tick-settings-error').hidden = false; };
    async function request(action, fields) {
        const body = new URLSearchParams({action, csrf, instances_id:root.dataset.instance, ...fields});
        const response = await fetch(root.dataset.endpoint, {method:'POST', credentials:'same-origin', cache:'no-store', body});
        if (!response.ok) throw new Error('The server could not be reached. Your input remains here.');
        const result = await response.json();
        if (!result.result) throw new Error(result.error && result.error.message || 'The settings could not be saved.');
        return result.response;
    }
    function render(r) {
        csrf = r.csrf; saved = r.settings; editable = r.edit;
        el('tick-client-id').value = saved.clientId;
        el('tick-client-secret').value = '';
        el('tick-client-secret').required = !saved.hasSecret;
        el('tick-client-secret').placeholder = saved.hasSecret ? 'Secret stored — leave blank to keep it' : 'Paste the Client Secret from TickTick';
        el('tick-redirect').value = saved.redirect;
        el('tick-settings-fields').disabled = !editable;
        el('tick-settings-remove').hidden = !editable || (!saved.hasSecret && saved.source !== 'environment');
        el('tick-encryption-info').textContent = saved.keyReady ? 'Credentials are encrypted on the server. The server encryption key is stored separately from the database.' :
            saved.source === 'business' && saved.hasSecret ? 'The server encryption key is unavailable. Restore its backup before using the saved credentials.' :
            'Secure storage is set up automatically when you save. No encryption key needs to be entered here.';
        status(!editable ? 'Read-only: business settings edit access is required.' : saved.configured ? 'TickTick is configured. Users can connect their accounts in Task Planning.' :
            saved.source === 'disabled' ? 'TickTick is disabled for this business.' : 'Enter your TickTick app credentials to enable the connection.');
        el('tick-settings-error').hidden = true;
    }
    async function load() {
        if (busy) return;
        busy = true;
        try { render(await request('data')); } catch (e) { error(e); status('Settings could not be loaded.'); }
        finally { busy = false; }
    }
    async function save(remove) {
        if (busy || !editable) return;
        if (remove && !window.confirm('Remove this business’s TickTick app configuration and disconnect its personal connections? Existing external tasks remain.')) return;
        if (!remove && saved.configured && !window.confirm('Save these app settings? Changed credentials require users in this business to reconnect TickTick.')) return;
        busy = true; el('tick-settings-save').disabled = true; el('tick-settings-remove').disabled = true;
        status('Saving settings…'); el('tick-settings-error').hidden = true;
        try {
            const fields = {revision:String(saved.revision)};
            if (!remove) Object.assign(fields,{client_id:el('tick-client-id').value.trim(), client_secret:el('tick-client-secret').value, redirect_uri:el('tick-redirect').value.trim()});
            render(await request(remove ? 'remove' : 'save',fields));
        } catch (e) { error(e); status('Not saved — your input is kept here.'); }
        finally { busy = false; el('tick-settings-save').disabled = false; el('tick-settings-remove').disabled = false; }
    }
    el('tick-settings-form').onsubmit = e => { e.preventDefault(); save(false); };
    el('tick-settings-remove').onclick = () => save(true);
    el('tick-settings-reload').onclick = () => {
        if (el('tick-client-secret').value && !window.confirm('Discard the entered secret and load saved settings?')) return;
        load();
    };
    el('tick-use-default').onclick = () => { if (saved) el('tick-redirect').value = saved.suggestedRedirect; };
    el('tick-copy-redirect').onclick = async () => {
        try { await navigator.clipboard.writeText(el('tick-redirect').value); status('Callback URL copied. Paste it into your TickTick app.'); }
        catch (_) { el('tick-redirect').focus(); el('tick-redirect').select(); status('Select and copy the callback URL.'); }
    };
    load();
}());
