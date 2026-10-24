<?php
/** Extra checks for categorised project uploads; storage and downloads remain the existing S3 system. */
function validatePlanningUpload(): void
{
    global $AUTH, $DBLIB, $bCMS;
    $category = $_POST['planningCategory'] ?? '';
    if ($category === '') return;
    if (!is_string($category) || !in_array($category, ['stage', 'shift'], true) ||
        ($_POST['typeid'] ?? '') != 7 || !$AUTH->instancePermissionCheck('PROJECTS:VIEW') ||
        !$AUTH->instancePermissionCheck('PROJECTS:PROJECT_FLIE_ATTACHMENTS:CREATE')) {
        finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to upload project planning files.']);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !is_string($_POST['planningCsrf'] ?? null) ||
        empty($_SESSION['planningFilesCsrf']) || !hash_equals($_SESSION['planningFilesCsrf'], $_POST['planningCsrf'])) {
        finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Please reload the project before uploading.']);
    }
    $id = $_POST['subtype'] ?? '';
    if (!is_scalar($id) || !preg_match('/^[1-9][0-9]{0,9}$/D', (string)$id)) finish(false, ['message' => 'Project not found.']);
    $DBLIB->where('projects.projects_id', $id);
    $DBLIB->where('projects.instances_id', $AUTH->data['instance']['instances_id']);
    $DBLIB->where('projects.projects_deleted', 0);
    $DBLIB->join('projectsTypes', 'projects.projectsTypes_id=projectsTypes.projectsTypes_id', 'LEFT');
    $project = $DBLIB->getOne('projects', ['projects.projects_archived', 'projectsTypes.projectsTypes_config_files']);
    if (!$project || $project['projects_archived'] || !$project['projectsTypes_config_files'] ||
        !$AUTH->data['instance']['instances_storageEnabled']) finish(false, ['message' => 'Project file uploads are unavailable.']);
    $name = $_POST['originalName'] ?? $_POST['filename'] ?? '';
    $extension = is_string($name) ? strtolower(pathinfo($name, PATHINFO_EXTENSION)) : '';
    if (!in_array($extension, ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'gantt'], true)) {
        finish(false, ['message' => 'Use a PDF, image, Office document, text, CSV or .gantt file.']);
    }
    $key = $_POST['name'] ?? $_POST['filename'] ?? '';
    if (!is_string($key) || !preg_match('~^uploads/PROJECT-FILE/[0-9]+-[0-9]+\\.[a-zA-Z0-9]+$~D', $key) ||
        strtolower(pathinfo($key, PATHINFO_EXTENSION)) !== $extension) {
        finish(false, ['message' => 'Invalid planning upload path.']);
    }
    $size = $_POST['size'] ?? '';
    if (!is_scalar($size) || !preg_match('/^[0-9]{1,12}$/D', (string)$size)) finish(false, ['message' => 'Invalid file size.']);
    $DBLIB->where('instances_id', $AUTH->data['instance']['instances_id']);
    $limit = $DBLIB->getValue('instances', 'instances_storageLimit');
    if ($limit > 0 && $bCMS->s3StorageUsed($AUTH->data['instance']['instances_id']) + (float)$size > $limit) {
        finish(false, ['message' => 'This file exceeds the remaining business storage allowance.']);
    }
    // Uploaded planning documents are private, with the same sharing controls as other project files.
    $_POST['public'] = '0';
}
