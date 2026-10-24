<?php
/** Load a quick comment in the current business without exposing other audit history. */
function editableProjectComment($commentId)
{
    global $AUTH, $DBLIB;
    if (!$AUTH->instancePermissionCheck("PROJECTS:VIEW")) {
        finish(false, ["code" => "AUTH-ERROR", "message" => "No auth for action"]);
    }
    if (!is_scalar($commentId) or !ctype_digit((string) $commentId) or (int) $commentId < 1) {
        finish(false, ["code" => "PARAM-ERROR", "message" => "A valid comment ID is required"]);
    }

    $DBLIB->join("projects", "auditLog.projects_id=projects.projects_id", "INNER");
    $DBLIB->where("projects.instances_id", $AUTH->data['instance']['instances_id']);
    $DBLIB->where("projects.projects_deleted", 0);
    $DBLIB->where("auditLog.auditLog_id", (int) $commentId);
    $DBLIB->where("auditLog.auditLog_deleted", 0);
    $DBLIB->where("auditLog.auditLog_actionType", "QUICKCOMMENT");
    $DBLIB->where("auditLog.auditLog_actionTable", "projects");
    $comment = $DBLIB->getOne("auditLog", ["auditLog.*"]);
    if (!$comment) {
        finish(false, ["code" => "NOT-FOUND", "message" => "Comment not found"]);
    }
    if ((int) $comment['users_userid'] !== (int) $AUTH->data['users_userid'] and
        !$AUTH->instancePermissionCheck("PROJECTS:PROJECT_NOTES:EDIT:NOTES")) {
        finish(false, ["code" => "AUTH-ERROR", "message" => "You can only change your own comments"]);
    }
    return $comment;
}
