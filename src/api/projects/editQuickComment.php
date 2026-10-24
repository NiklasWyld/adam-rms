<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/projectComment.php';

if (!isset($_POST['comment_id'], $_POST['text']) or !is_string($_POST['text'])) {
    finish(false, ["code" => "PARAM-ERROR", "message" => "Comment ID and text are required"]);
}
$comment = editableProjectComment($_POST['comment_id']);
$text = $bCMS->cleanString($_POST['text']);
if (trim(strip_tags($text)) === '' or strlen($text) > 65535) {
    finish(false, ["code" => "PARAM-ERROR", "message" => "Comment text must be between 1 and 65535 bytes"]);
}
$DBLIB->where("auditLog_id", $comment['auditLog_id']);
$DBLIB->where("auditLog_deleted", 0);
if (!$DBLIB->update("auditLog", ["auditLog_actionData" => $text])) {
    finish(false, ["code" => "UPDATE-FAIL", "message" => "Could not update comment"]);
}
$bCMS->auditLog("EDIT-QUICKCOMMENT", "projects", json_encode(["comment_id" => $comment['auditLog_id']]), $AUTH->data['users_userid'], null, $comment['projects_id']);
finish(true, null, ["updated_id" => (int) $comment['auditLog_id']]);

/**
 * @OA\Post(path="/projects/editQuickComment.php", summary="Edit a project quick comment", operationId="editQuickComment", tags={"projects"},
 *   description="Authors or users with PROJECTS:PROJECT_NOTES:EDIT:NOTES may edit comments in the current business. Requires PROJECTS:VIEW.",
 *   @OA\Parameter(name="comment_id", in="query", required=true, @OA\Schema(type="integer")),
 *   @OA\Parameter(name="text", in="query", required=true, @OA\Schema(type="string")),
 *   @OA\Response(response="200", description="Result", @OA\JsonContent(ref="#/components/schemas/SimpleResponse"))
 * )
 */
