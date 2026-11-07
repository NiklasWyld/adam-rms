/* Presentation only: keep API responses and saved values unchanged. */
(function () {
    'use strict';

    const errors = new Map([
        ['Username, email or password incorrect', 'Benutzername, E-Mail-Adresse oder Passwort ist falsch.'],
        ["Sorry - you've tried too many times to login - please try again in 5 minutes", 'Zu viele Anmeldeversuche. Versuche es in fünf Minuten erneut.'],
        ['User account is suspended', 'Dieses Benutzerkonto ist gesperrt.'],
        ['Sorry that username is taken, please try another', 'Dieser Benutzername ist bereits vergeben. Wähle einen anderen.'],
        ['Sorry, you already have an account with that email address', 'Zu dieser E-Mail-Adresse gibt es bereits ein Konto.'],
        ['Sorry this email is in use for another account', 'Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.'],
        ['Sorry this username is in use for another account, please pick another', 'Dieser Benutzername ist bereits vergeben. Wähle einen anderen.'],
        ['Current Password Incorrect', 'Das aktuelle Passwort ist falsch.'],
        ['Could not update account details', 'Die Kontodaten konnten nicht gespeichert werden.'],
        ['Your session changed. Reload the page before saving.', 'Deine Sitzung hat sich geändert. Lade die Seite vor dem Speichern neu.'],
        ['Reducing these counts removes populated channels. Confirm the reduction first.', 'Beim Verringern der Kanalanzahl entfallen belegte Kanäle. Bestätige zuerst das Entfernen.'],
        ['The plan could not be saved. Your edits are still on screen. Please try again.', 'Der Plan konnte nicht gespeichert werden. Deine Änderungen bleiben sichtbar. Versuche es erneut.'],
        ['No data specified', 'Fülle die erforderlichen Felder aus.'],
        ['Sorry - Your password is too short - please choose a password of at least 12 characters', 'Das Passwort muss mindestens 12 Zeichen lang sein.'],
        ['Sorry that username is invalid, please try another', 'Dieser Benutzername ist ungültig. Wähle einen anderen.'],
        ['Project not found.', 'Projekt nicht gefunden.'],
        ['Archived projects are read-only.', 'Archivierte Projekte sind schreibgeschützt.'],
        ['Invalid status.', 'Ungültiger Status.'],
        ['Invalid priority.', 'Ungültige Priorität.'],
        ['The end date must be on or after the start date.', 'Das Enddatum muss am oder nach dem Startdatum liegen.'],
        ['Enter a valid date between 2000 and 2200.', 'Gib ein gültiges Datum zwischen 2000 und 2200 ein.'],
        ['The end must be after the start.', 'Das Ende muss nach dem Beginn liegen.'],
        ['Choose a valid time zone.', 'Wähle eine gültige Zeitzone.'],
        ['Choose a valid booking status.', 'Wähle einen gültigen Reservierungsstatus.'],
        ['Choose an active room for a new booking.', 'Wähle für die neue Reservierung einen aktiven Raum.'],
        ['This record changed in another tab. Reload the current data before saving your edits.', 'Der Eintrag wurde in einem anderen Tab geändert. Lade den aktuellen Stand vor dem Speichern neu.'],
        ['This item changed in another tab. Your edits are kept here. Reload the current version before trying again.', 'Der Eintrag wurde in einem anderen Tab geändert. Deine Eingaben bleiben erhalten. Lade den aktuellen Stand und versuche es erneut.'],
        ['This plan changed in another tab. Your edits have been kept on screen. Reload the saved plan before editing again.', 'Der Plan wurde in einem anderen Tab geändert. Deine Eingaben sind noch sichtbar. Lade den gespeicherten Plan vor der weiteren Bearbeitung neu.'],
        ['Each field must be valid text with at most 4,000 characters.', 'Jedes Feld darf höchstens 4.000 Zeichen enthalten.'],
        ['Each channel needs between 1 and 20 uses.', 'Jeder Kanal braucht zwischen einer und 20 Belegungen.'],
        ['This plan exceeds the 2 MB limit.', 'Dieser Plan überschreitet die maximale Größe von 2 MB.'],
        ['Choose an active user in this business.', 'Wähle ein aktives Mitglied dieses Unternehmens.'],
        ['Choose a planned day before adding a time.', 'Wähle ein Datum, bevor du eine Uhrzeit hinzufügst.'],
        ['Choose a day before adding a time.', 'Wähle ein Datum, bevor du eine Uhrzeit hinzufügst.'],
        ['Choose a reference date for this package.', 'Wähle ein Bezugsdatum für dieses Aufgabenpaket.'],
        ['Task not found in this view.', 'Aufgabe in dieser Ansicht nicht gefunden.'],
        ['Task package not found.', 'Aufgabenpaket nicht gefunden.'],
        ['Shopping list not found.', 'Einkaufsliste nicht gefunden.'],
        ['Shopping item not found.', 'Artikel nicht gefunden.'],
        ['Quantity must be greater than zero, below 1,000,000 and have at most three decimal places.', 'Die Menge muss größer als 0 und kleiner als 1.000.000 sein. Maximal drei Nachkommastellen sind zulässig.'],
        ['Image URLs must use HTTPS.', 'Bildadressen müssen mit https:// beginnen.'],
        ['Manufacturer or category is unavailable in this business.', 'Der Hersteller oder die Kategorie ist in diesem Unternehmen nicht verfügbar.'],
        ['Item order must contain each current item exactly once. Reload and try again.', 'Die Reihenfolge muss jeden Artikel genau einmal enthalten. Lade die Seite neu und versuche es erneut.']
    ]);

    window.adamUiError = message => {
        const price = /^Enter a non-negative price with up to (\d+) decimal places, without thousands separators\.$/.exec(message);
        if (price) return 'Gib einen Preis ab 0 mit maximal ' + price[1] + ' Nachkommastellen ohne Tausendertrennzeichen ein.';
        const length = /^Enter valid text \(maximum (\d+) characters\)\.$/.exec(message);
        if (length) return 'Gib einen gültigen Text mit maximal ' + length[1] + ' Zeichen ein.';
        return errors.get(message) ?? message;
    };

    if (window.bootbox) {
        window.bootbox.addLocale('de', { OK: 'OK', CANCEL: 'Abbrechen', CONFIRM: 'Bestätigen' });
        window.bootbox.setLocale('de');
    }

    if (window.jQuery?.fn.select2) {
        window.jQuery.fn.select2.defaults.set('language', {
            errorLoading: () => 'Die Ergebnisse konnten nicht geladen werden.',
            inputTooLong: ({ input, maximum }) => 'Kürze die Eingabe um ' + (input.length - maximum) + ' Zeichen.',
            inputTooShort: ({ input, minimum }) => 'Gib noch mindestens ' + (minimum - input.length) + ' Zeichen ein.',
            loadingMore: () => 'Weitere Ergebnisse werden geladen …',
            maximumSelected: ({ maximum }) => 'Du kannst höchstens ' + maximum + ' Einträge auswählen.',
            noResults: () => 'Keine Ergebnisse',
            searching: () => 'Suche läuft …',
            removeAllItems: () => 'Alle Einträge entfernen',
            removeItem: () => 'Eintrag entfernen'
        });
    }

    window.adamDatePickerLabels = {
        applyLabel: 'Übernehmen',
        cancelLabel: 'Abbrechen',
        weekLabel: 'KW',
        customRangeLabel: 'Eigener Zeitraum',
        daysOfWeek: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
        monthNames: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
        firstDay: 1
    };
}());

/* Uppy Core passes this locale on to Dashboard, Status Bar and Webcam. */
window.adamUppyLocale = {
    strings: {
        youCanOnlyUploadX: { 0: 'Du kannst nur eine Datei hochladen.', 1: 'Du kannst höchstens %{smart_count} Dateien hochladen.' },
        youHaveToAtLeastSelectX: { 0: 'Wähle mindestens eine Datei aus.', 1: 'Wähle mindestens %{smart_count} Dateien aus.' },
        youCanOnlyUploadFileTypes: 'Erlaubte Dateitypen: %{types}',
        exceedsSize: 'Die Datei überschreitet die maximale Größe von',
        inferiorSize: 'Die Datei ist kleiner als die Mindestgröße von %{size}.',
        noDuplicates: 'Die Datei „%{fileName}“ wurde bereits hinzugefügt.',
        noNewAlreadyUploading: 'Während des Uploads können keine Dateien hinzugefügt werden.',
        failedToUpload: '„%{file}“ konnte nicht hochgeladen werden.',
        noInternetConnection: 'Keine Internetverbindung',
        connectedToInternet: 'Internetverbindung wiederhergestellt',
        closeModal: 'Fenster schließen',
        importFrom: 'Aus %{name} importieren',
        addingMoreFiles: 'Weitere Dateien werden hinzugefügt …',
        addMoreFiles: 'Weitere Dateien hinzufügen',
        dashboardWindowTitle: 'Datei-Upload (mit Esc schließen)',
        dashboardTitle: 'Datei-Upload',
        copyLinkToClipboardSuccess: 'Link in die Zwischenablage kopiert',
        copyLinkToClipboardFallback: 'Kopiere den Link unten.',
        copyLink: 'Link kopieren',
        fileSource: 'Dateiquelle: %{name}',
        done: 'Fertig',
        back: 'Zurück',
        addMore: 'Weitere hinzufügen',
        removeFile: 'Datei entfernen',
        editFile: 'Datei bearbeiten',
        editing: '„%{file}“ bearbeiten',
        finishEditingFile: 'Bearbeitung abschließen',
        saveChanges: 'Änderungen speichern',
        cancel: 'Abbrechen',
        myDevice: 'Mein Gerät',
        dropPasteFiles: 'Dateien hier ablegen, einfügen oder %{browseFiles}',
        dropPasteFolders: 'Dateien hier ablegen, einfügen oder %{browseFolders}',
        dropPasteBoth: 'Dateien hier ablegen, einfügen, %{browseFiles} oder %{browseFolders}',
        dropPasteImportFiles: 'Dateien hier ablegen, einfügen, %{browseFiles} oder importieren von:',
        dropPasteImportFolders: 'Dateien hier ablegen, einfügen, %{browseFolders} oder importieren von:',
        dropPasteImportBoth: 'Dateien hier ablegen, einfügen, %{browseFiles}, %{browseFolders} oder importieren von:',
        dropHint: 'Dateien hier ablegen',
        browseFiles: 'Dateien auswählen',
        browseFolders: 'Ordner auswählen',
        uploadComplete: 'Upload abgeschlossen',
        uploadPaused: 'Upload pausiert',
        resumeUpload: 'Upload fortsetzen',
        pauseUpload: 'Upload pausieren',
        retryUpload: 'Upload wiederholen',
        cancelUpload: 'Upload abbrechen',
        xFilesSelected: { 0: 'Eine Datei ausgewählt', 1: '%{smart_count} Dateien ausgewählt' },
        uploadingXFiles: { 0: 'Eine Datei wird hochgeladen', 1: '%{smart_count} Dateien werden hochgeladen' },
        processingXFiles: { 0: 'Eine Datei wird verarbeitet', 1: '%{smart_count} Dateien werden verarbeitet' },
        uploading: 'Wird hochgeladen …',
        upload: 'Hochladen',
        complete: 'Abgeschlossen',
        uploadFailed: 'Upload fehlgeschlagen',
        paused: 'Pausiert',
        retry: 'Erneut versuchen',
        pause: 'Pausieren',
        resume: 'Fortsetzen',
        filesUploadedOfTotal: { 0: '%{complete} von einer Datei hochgeladen', 1: '%{complete} von %{smart_count} Dateien hochgeladen' },
        dataUploadedOfTotal: '%{complete} von %{total}',
        xTimeLeft: 'Noch %{time}',
        uploadXFiles: { 0: 'Eine Datei hochladen', 1: '%{smart_count} Dateien hochladen' },
        uploadXNewFiles: { 0: 'Eine weitere Datei hochladen', 1: '%{smart_count} weitere Dateien hochladen' },
        xMoreFilesAdded: { 0: 'Eine weitere Datei hinzugefügt', 1: '%{smart_count} weitere Dateien hinzugefügt' },
        smile: 'Bitte lächeln!',
        takePicture: 'Foto aufnehmen',
        startRecording: 'Videoaufnahme starten',
        stopRecording: 'Videoaufnahme stoppen',
        allowAccessTitle: 'Kamerazugriff erlauben',
        allowAccessDescription: 'Erlaube den Kamerazugriff für diese Seite, um Fotos oder Videos aufzunehmen.',
        noCameraTitle: 'Keine Kamera verfügbar',
        noCameraDescription: 'Schließe eine Kamera an, um Fotos oder Videos aufzunehmen.',
        recordingStoppedMaxSize: 'Die Aufnahme wurde beendet, weil die maximale Dateigröße fast erreicht ist.',
        recordingLength: 'Aufnahmedauer: %{recording_length}'
    }
};
