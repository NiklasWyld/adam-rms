<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/ChannelPlanning.php';

if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW')) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to view project planning.']);
$service = new ChannelPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id']);
if (empty($_SESSION['channelPlanningCsrf'])) $_SESSION['channelPlanningCsrf'] = bin2hex(random_bytes(32));
try {
    $id = ChannelPlanning::integer($_POST['projects_id'] ?? null, 1, 2147483647);
    $action = $_POST['action'] ?? 'data';
    if ($action === 'data') finish(true, null, ['csrf' => $_SESSION['channelPlanningCsrf'], 'plan' => $service->document($id)]);
    if ($action !== 'save') throw new InvalidArgumentException('Unknown planning action.');
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Use POST to save a plan.']);
    if (!$AUTH->instancePermissionCheck('PROJECTS:CHANNEL_PLANNING:EDIT')) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to edit channel planning.']);
    if (!is_string($_POST['csrf'] ?? null) || !hash_equals($_SESSION['channelPlanningCsrf'], $_POST['csrf'])) {
        finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Your session changed. Reload the page before saving.']);
    }
    $payload = $_POST['plan'] ?? null;
    if (!is_string($payload) || strlen($payload) > 2100000) throw new InvalidArgumentException('Invalid plan payload.');
    $data = json_decode($payload, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($data)) throw new InvalidArgumentException('Invalid plan document.');
    $plan = $service->save($id, $data, ($_POST['confirmReduction'] ?? '') === '1', function () use ($bCMS, $AUTH, $id) {
        $bCMS->auditLog('SAVE-CHANNEL-PLAN', 'projects', null, $AUTH->data['users_userid'], null, $id);
    });
    finish(true, null, ['plan' => $plan]);
} catch (InvalidArgumentException | JsonException $error) {
    finish(false, ['code' => 'PARAM-ERROR', 'message' => $error->getMessage()]);
} catch (OutOfBoundsException $error) {
    finish(false, ['code' => 'NOT-FOUND', 'message' => 'Project not found.']);
} catch (LengthException $error) {
    finish(false, ['code' => 'CONFIRM-REDUCTION', 'message' => $error->getMessage()]);
} catch (DomainException $error) {
    finish(false, ['code' => 'CONFLICT', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Channel planning: ' . $error->getMessage());
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'The plan could not be saved. Your edits are still on screen. Please try again.']);
}
