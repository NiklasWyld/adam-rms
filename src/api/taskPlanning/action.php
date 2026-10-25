<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/TaskPlanning.php';
require_once __DIR__ . '/../../common/libs/TaskTickTick.php';
header('Cache-Control: no-store');
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW') || empty($AUTH->data['instance']['instances_id'])) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Project viewing permission is required.']);
if (empty($_SESSION['taskPlanningCsrf'])) $_SESSION['taskPlanningCsrf'] = bin2hex(random_bytes(32));
try {
    $input = $_POST;
    $action = $input['action'] ?? 'data';
    if (!is_string($action)) throw new InvalidArgumentException('Invalid action.');
    $project = isset($input['projects_id']) && $input['projects_id'] !== '' ? TaskPlanning::id($input['projects_id']) : null;
    $service = new TaskPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']);
    $tick = new TaskTickTick($DBLIB, $service);
    if ($project !== null) $service->project($project);
    $edit = $AUTH->instancePermissionCheck('PROJECTS:TASK_PLANNING:EDIT');
    $templates = $AUTH->instancePermissionCheck('PROJECTS:TASK_PLANNING:TEMPLATES');
    $sync = $AUTH->instancePermissionCheck('PROJECTS:TASK_PLANNING:SYNC');
    $extra = [];
    if (!in_array($action, ['data', 'preview'], true)) {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Use POST to make changes.']);
        if (!is_string($input['csrf'] ?? null) || !hash_equals($_SESSION['taskPlanningCsrf'], $input['csrf'])) finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Your session changed. Reload before saving. Your unsaved input is still here.']);
        $d = TaskPlanning::json($input['payload'] ?? '{}');
        if (in_array($action, ['connect', 'disconnect', 'sync'], true)) {
            if (!$sync) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'TickTick synchronisation permission is required.']);
            if ($action === 'connect') $extra['url'] = $tick->authorise($project);
            elseif ($action === 'disconnect') $tick->disconnect();
            else {
                if (!$project) throw new InvalidArgumentException('Open a project to sync to TickTick.');
                if (!isset($d['mine']) || !is_bool($d['mine'])) throw new InvalidArgumentException('Choose all tasks or your assigned tasks.');
                $extra['sync'] = $tick->sync($project, $d['mine']);
            }
        } else {
            if (in_array($action, ['saveTemplate', 'deleteTemplate'], true)) {
                if (!$templates) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Task package management permission is required.']);
            } elseif (!in_array($action, ['saveFilter', 'deleteFilter'], true) && !$edit) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Task planning edit permission is required.']);
            $key = $input['request_id'] ?? '';
            if (!is_string($key)) throw new InvalidArgumentException('Invalid save ID.');
            $extra['ids'] = $service->mutate($action, $project, $d, $key, function ($ids) use ($bCMS, $AUTH, $project, $action) {
                $bCMS->auditLog('TASK-PLANNING-' . strtoupper($action), 'projects', 'Record IDs: ' . implode(',', $ids), $AUTH->data['users_userid'], null, $project);
            });
        }
    } elseif ($action === 'preview') {
        if (!$project) throw new InvalidArgumentException('Open a project to preview a package.');
        $extra['preview'] = $service->preview(TaskPlanning::id($input['template_id'] ?? null), $project, $input['base'] ?? null);
    }
    $data = $service->document($project);
    $data['permissions'] = ['edit' => $edit && (!$data['project'] || !$data['project']['projects_archived']), 'templates' => $templates, 'sync' => $sync];
    $data['tick'] = $tick->status($project);
    finish(true, null, ['csrf' => $_SESSION['taskPlanningCsrf'], 'data' => $data] + $extra);
} catch (InvalidArgumentException $e) { finish(false, ['code' => 'PARAM-ERROR', 'message' => $e->getMessage()]);
} catch (OutOfBoundsException $e) { finish(false, ['code' => 'NOT-FOUND', 'message' => $e->getMessage()]);
} catch (DomainException $e) { finish(false, ['code' => 'CONFLICT', 'message' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('Task planning storage/transport failure: ' . get_class($e));
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'The request could not be completed. Your input is kept on screen. Retry, or reload the current version if another tab changed this item.']);
}
