<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/ShiftPlanning.php';

$instance = $AUTH->data['instance']['instances_id'] ?? null;
if (!$instance || !$AUTH->instancePermissionCheck('PROJECTS:VIEW') || !$AUTH->instancePermissionCheck('PROJECTS:PROJECT_CREW:VIEW')) {
    finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Keine Berechtigung für die Schichtplanung.']);
}
$editable = $AUTH->instancePermissionCheck('PROJECTS:PROJECT_CREW:CREATE') && $AUTH->instancePermissionCheck('PROJECTS:PROJECT_CREW:EDIT');
$_SESSION['shiftPlanningCsrf'] ??= bin2hex(random_bytes(32));
try {
    $project = ShiftPlanning::id($_POST['projects_id'] ?? null);
    $service = new ShiftPlanning($DBLIB, (int)$instance);
    $action = $_POST['action'] ?? 'data';
    $id = null;
    if ($action !== 'data') {
        if (!in_array($action, ['save', 'delete'], true)) throw new InvalidArgumentException('Unbekannte Aktion.');
        if (!$editable) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Keine Berechtigung zum Bearbeiten der Schichtplanung.']);
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Änderungen erfordern POST.']);
        $csrf = ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'XMLHttpRequest' ? ($_SERVER['HTTP_X_SHIFT_CSRF'] ?? '') : '';
        if (!hash_equals($_SESSION['shiftPlanningCsrf'], $csrf)) {
            finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Die Sitzung hat sich geändert. Bitte lade das Projekt neu.']);
        }
        // Keep roles and notes out of the shared API request analytics, which log scalar POST fields.
        $body = file_get_contents('php://input');
        if (strlen($body) > 4000000) throw new InvalidArgumentException('Die Schichtdaten sind zu groß.');
        $input = json_decode($body, true, 16)['shift'] ?? null;
        if (!is_array($input)) throw new InvalidArgumentException('Ungültige Schichtdaten.');
        $id = $service->mutate($project, $action, $input, function (int $id) use ($bCMS, $AUTH, $project, $action) {
            $bCMS->auditLog('SHIFT-PLANNING-' . strtoupper($action), 'projectShifts', null, $AUTH->data['users_userid'], null, $project, $id);
        });
    }
    finish(true, null, ['csrf' => $_SESSION['shiftPlanningCsrf'], 'id' => $id, 'data' => $service->document($project, $editable)]);
} catch (InvalidArgumentException $error) {
    finish(false, ['code' => 'PARAM-ERROR', 'message' => $error->getMessage()]);
} catch (OutOfBoundsException $error) {
    finish(false, ['code' => 'NOT-FOUND', 'message' => $error->getMessage()]);
} catch (DomainException $error) {
    finish(false, ['code' => 'CONFLICT', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Shift planning: ' . $error->getMessage());
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'Die Schichtplanung konnte nicht verarbeitet werden. Bitte versuche es erneut.']);
}
