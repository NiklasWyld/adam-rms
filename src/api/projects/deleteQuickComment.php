<?php
require_once __DIR__ . '/../apiHeadSecure.php';

if (
    !$AUTH->instancePermissionCheck("PROJECTS:VIEW") ||
    !isset($_POST['comment_id'])
) {
    finish(false, "missing_permissions_or_id");
}

$DBLIB->where("auditLog.auditLog_id", $_POST['comment_id']);
$DBLIB->where("auditLog.auditLog_deleted", 0);
$comment = $DBLIB->getOne("auditLog");

if (!$comment) {
    finish(false, "comment_not_found");
}

$DBLIB->where("auditLog.auditLog_id", $_POST['comment_id']);
$deleted = $DBLIB->update("auditLog", [
    "auditLog_deleted" => 1
]);

if (!$deleted) {
    finish(false, "delete_failed");
}

finish(true, null, ["deleted_id" => $_POST['comment_id']]);
