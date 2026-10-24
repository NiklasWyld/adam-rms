<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/RoomPlanning.php';
header('Cache-Control: no-store');

$viewProjects = $AUTH->instancePermissionCheck('PROJECTS:VIEW');
$viewRooms = $AUTH->instancePermissionCheck('ROOMS:VIEW');
$manage = $AUTH->instancePermissionCheck('ROOMS:MANAGE');
$edit = $AUTH->instancePermissionCheck('PROJECTS:ROOM_PLANNING:EDIT');
if (!$viewProjects && !$viewRooms) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to view room planning.']);
if (empty($_SESSION['roomPlanningCsrf'])) $_SESSION['roomPlanningCsrf'] = bin2hex(random_bytes(32));
try {
    $input = $_SERVER['REQUEST_METHOD'] === 'GET' ? $_GET : $_POST;
    $action = $input['action'] ?? 'data';
    if (!is_string($action)) throw new InvalidArgumentException('Invalid action.');
    $project = isset($input['projects_id']) && $input['projects_id'] !== '' ? RoomPlanning::id($input['projects_id']) : null;
    if ($project !== null && !$viewProjects) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to view projects.']);
    if ($project === null && !$viewRooms) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to view the room catalogue.']);
    $service = new RoomPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']);
    if ($project !== null) $service->project($project);
    $from = $input['from'] ?? null; $to = $input['to'] ?? null;
    if (($from !== null && !is_string($from)) || ($to !== null && !is_string($to))) throw new InvalidArgumentException('Invalid overview dates.');
    if ($project === null && $viewProjects) $service->overviewRange($from, $to);
    if ($action !== 'data') {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Use POST to change room planning.']);
        if (!is_string($input['csrf'] ?? null) || !hash_equals($_SESSION['roomPlanningCsrf'], $input['csrf'])) finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Your session changed. Reload the page before saving.']);
        if (!in_array($action, ['saveRoom', 'timezone', 'saveBooking', 'setStatus', 'deleteBooking', 'check'], true)) throw new InvalidArgumentException('Unknown room planning action.');
        if (in_array($action, ['saveRoom', 'timezone'], true)) {
            if (!$manage) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to manage rooms.']);
        } elseif (!$viewProjects || !$edit || $project === null) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to edit project room planning.']);
        if ($action === 'check') finish(true, null, ['conflicts' => $service->check($project, $input)]);
        $id = $service->mutate($action, $input, function (int $id) use ($action, $project, $bCMS, $AUTH) {
            $table = $action === 'saveRoom' ? 'rooms' : ($action === 'timezone' ? 'instances' : 'roomReservations');
            $bCMS->auditLog(strtoupper($action), $table, null, $AUTH->data['users_userid'], null, $project, $id);
        });
        // Reload the timezone and current conflicts after committing, including concurrent reservations.
        $service = new RoomPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']);
    }
    $data = $service->document($project, $viewProjects, $manage, $from, $to);
    $data['permissions'] = ['manageRooms' => $manage, 'viewBookings' => $viewProjects,
        'editBookings' => $edit && $viewProjects && $project !== null && !$data['project']['projects_archived']];
    finish(true, null, ['csrf' => $_SESSION['roomPlanningCsrf'], 'id' => $id ?? null, 'data' => $data]);
} catch (InvalidArgumentException $error) {
    finish(false, ['code' => 'PARAM-ERROR', 'message' => $error->getMessage()]);
} catch (OutOfBoundsException $error) {
    finish(false, ['code' => 'NOT-FOUND', 'message' => $error->getMessage()]);
} catch (DomainException $error) {
    finish(false, ['code' => 'CONFLICT', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Room planning: ' . $error->getMessage());
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'Room planning could not be saved. Your input is still on screen. Please try again.']);
}
