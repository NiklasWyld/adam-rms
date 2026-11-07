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
        if (!response.ok) throw new Error('Der Server ist nicht erreichbar. Deine Eingaben bleiben erhalten.');
        const result = await response.json();
        if (!result.result) throw new Error(result.error && adamUiError(result.error.message) || 'Die Einstellungen konnten nicht gespeichert werden.');
        return result.response;
    }
    function render(r) {
        csrf = r.csrf; saved = r.settings; editable = r.edit;
        el('tick-client-id').value = saved.clientId;
        el('tick-client-secret').value = '';
        el('tick-client-secret').required = !saved.hasSecret;
        el('tick-client-secret').placeholder = saved.hasSecret ? 'Schlüssel gespeichert. Zum Beibehalten leer lassen.' : 'Client-Secret aus TickTick einfügen';
        el('tick-redirect').value = saved.redirect;
        el('tick-settings-fields').disabled = !editable;
        el('tick-settings-remove').hidden = !editable || (!saved.hasSecret && saved.source !== 'environment');
        el('tick-encryption-info').textContent = saved.keyReady ? 'Die Zugangsdaten sind serverseitig verschlüsselt. Der Schlüssel wird getrennt von der Datenbank gespeichert.' :
            saved.source === 'business' && saved.hasSecret ? 'Der Verschlüsselungsschlüssel fehlt. Stelle ihn aus einer Sicherung wieder her, um die Zugangsdaten zu nutzen.' :
            'Beim Speichern wird die Verschlüsselung automatisch eingerichtet.';
        status(!editable ? 'Zum Bearbeiten ist die Berechtigung für die Unternehmenseinstellungen erforderlich.' : saved.configured ? 'TickTick ist eingerichtet. Mitglieder können ihr Konto in der Aufgabenplanung verbinden.' :
            saved.source === 'disabled' ? 'TickTick ist für dieses Unternehmen deaktiviert.' : 'Gib die Zugangsdaten deiner TickTick-App ein, um die Verbindung zu aktivieren.');
        el('tick-settings-error').hidden = true;
    }
    async function load() {
        if (busy) return;
        busy = true;
        try { render(await request('data')); } catch (e) { error(e); status('Die Einstellungen konnten nicht geladen werden.'); }
        finally { busy = false; }
    }
    async function save(remove) {
        if (busy || !editable) return;
        if (remove && !window.confirm('TickTick-Einstellungen des Unternehmens löschen und persönliche Verbindungen trennen? Externe Aufgaben bleiben erhalten.')) return;
        if (!remove && saved.configured && !window.confirm('App-Einstellungen speichern? Nach einer Änderung der Zugangsdaten müssen die Mitglieder TickTick erneut verbinden.')) return;
        busy = true; el('tick-settings-save').disabled = true; el('tick-settings-remove').disabled = true;
        status('Einstellungen werden gespeichert …'); el('tick-settings-error').hidden = true;
        try {
            const fields = {revision:String(saved.revision)};
            if (!remove) Object.assign(fields,{client_id:el('tick-client-id').value.trim(), client_secret:el('tick-client-secret').value, redirect_uri:el('tick-redirect').value.trim()});
            render(await request(remove ? 'remove' : 'save',fields));
        } catch (e) { error(e); status('Nicht gespeichert. Deine Eingaben bleiben erhalten.'); }
        finally { busy = false; el('tick-settings-save').disabled = false; el('tick-settings-remove').disabled = false; }
    }
    el('tick-settings-form').onsubmit = e => { e.preventDefault(); save(false); };
    el('tick-settings-remove').onclick = () => save(true);
    el('tick-settings-reload').onclick = () => {
        if (el('tick-client-secret').value && !window.confirm('Eingegebenen Schlüssel verwerfen und gespeicherte Einstellungen laden?')) return;
        load();
    };
    el('tick-use-default').onclick = () => { if (saved) el('tick-redirect').value = saved.suggestedRedirect; };
    el('tick-copy-redirect').onclick = async () => {
        try { await navigator.clipboard.writeText(el('tick-redirect').value); status('Callback-URL kopiert. Füge sie in deiner TickTick-App ein.'); }
        catch (_) { el('tick-redirect').focus(); el('tick-redirect').select(); status('Markiere und kopiere die Callback-URL.'); }
    };
    load();
}());
