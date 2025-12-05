<?php
require_once __DIR__ . '/../apiHeadSecure.php';

if (
    !$AUTH->instancePermissionCheck("PROJECTS:VIEW") ||
    !isset($_POST['comment_id']) ||
    !isset($_POST['text'])
) {
    finish(false, "missing_permissions_or_data");
}

// Kommentar laden
$DBLIB->where("auditLog.auditLog_id", $_POST['comment_id']);
$DBLIB->where("auditLog.auditLog_deleted", 0);
$comment = $DBLIB->getOne("auditLog");

if (!$comment) {
    finish(false, "comment_not_found");
}

// Kommentar aktualisieren
$DBLIB->where("auditLog.auditLog_id", $_POST['comment_id']);
$updated = $DBLIB->update("auditLog", [
    "auditLog_actionData" => $bCMS->cleanString($_POST['text'])
]);

if (!$updated) {
    finish(false, "update_failed");
}

finish(true, null, ["updated_id" => $_POST['comment_id']]);
