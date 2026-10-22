<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/projectComment.php';

if (!isset($_POST['comment_id'])) {
    finish(false, ["code" => "PARAM-ERROR", "message" => "Comment ID is required"]);
}
$comment = editableProjectComment($_POST['comment_id']);
$DBLIB->where("auditLog_id", $comment['auditLog_id']);
$DBLIB->where("auditLog_deleted", 0);
if (!$DBLIB->update("auditLog", ["auditLog_deleted" => 1])) {
    finish(false, ["code" => "UPDATE-FAIL", "message" => "Could not delete comment"]);
}
$bCMS->auditLog("DELETE-QUICKCOMMENT", "projects", json_encode(["comment_id" => $comment['auditLog_id']]), $AUTH->data['users_userid'], null, $comment['projects_id']);
finish(true, null, ["deleted_id" => (int) $comment['auditLog_id']]);

/**
 * @OA\Post(path="/projects/deleteQuickComment.php", summary="Soft-delete a project quick comment", operationId="deleteQuickComment", tags={"projects"},
 *   description="Authors or users with PROJECTS:PROJECT_NOTES:EDIT:NOTES may delete comments in the current business. Requires PROJECTS:VIEW.",
 *   @OA\Parameter(name="comment_id", in="query", required=true, @OA\Schema(type="integer")),
 *   @OA\Response(response="200", description="Result", @OA\JsonContent(ref="#/components/schemas/SimpleResponse"))
 * )
 */
