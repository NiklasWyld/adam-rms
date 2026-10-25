<?php
// Bootstrap auth first, then remove every supplied field before the shared API analytics hook.
// This also covers JSON bodies: app credentials must never enter analytics/audit payloads.
require_once __DIR__ . '/../apiHead.php';
$settingsInput = $_POST;
$_POST = []; $_GET = []; $_REQUEST = [];
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/TaskTickSettings.php';
if (function_exists('\Sentry\configureScope')) {
    \Sentry\configureScope(function (\Sentry\State\Scope $scope): void {
        $scope->addEventProcessor(function (\Sentry\Event $event): \Sentry\Event {
            $request = $event->getRequest();
            unset($request['data'], $request['query_string']);
            $event->setRequest($request);
            return $event;
        });
    });
}
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
if (empty($AUTH->data['instance']['instances_id']) || !$AUTH->instancePermissionCheck('BUSINESS:BUSINESS_SETTINGS:VIEW')) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Business settings access is required.']);
if (empty($_SESSION['taskTickSettingsCsrf'])) $_SESSION['taskTickSettingsCsrf'] = bin2hex(random_bytes(32));
try {
    if (isset($settingsInput['instances_id']) && TaskPlanning::id($settingsInput['instances_id']) !== (int)$AUTH->data['instance']['instances_id']) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'The requested business is not available in this session.']);
    $action = $settingsInput['action'] ?? 'data';
    if (!is_string($action) || !in_array($action, ['data', 'save', 'remove'], true)) throw new InvalidArgumentException('Unknown TickTick settings action.');
    $service = new TaskTickSettings($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']);
    $edit = $AUTH->instancePermissionCheck('BUSINESS:BUSINESS_SETTINGS:EDIT');
    if ($action !== 'data') {
        if (!$CONFIG['DEV'] && !str_starts_with($CONFIG['ROOTURL'], 'https://')) finish(false, ['code' => 'HTTPS-ERROR', 'message' => 'Use an HTTPS RMS address before configuring app credentials.']);
        if (!$edit) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Business settings edit permission is required.']);
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Use POST to change TickTick settings.']);
        if (!is_string($settingsInput['csrf'] ?? null) || !hash_equals($_SESSION['taskTickSettingsCsrf'], $settingsInput['csrf'])) finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Your session changed. Reload the settings before saving.']);
        $service->save($settingsInput, $settingsInput['client_secret'] ?? '', $action === 'remove', function ($event) use ($bCMS, $AUTH) {
            $bCMS->auditLog($event, 'instances', 'TickTick app configuration updated; credentials omitted.', $AUTH->data['users_userid'], null, null, $AUTH->data['instance']['instances_id']);
        });
    }
    unset($settingsInput);
    finish(true, null, ['csrf' => $_SESSION['taskTickSettingsCsrf'], 'settings' => $service->document($CONFIG['ROOTURL']), 'edit' => $edit]);
} catch (InvalidArgumentException $e) { finish(false, ['code' => 'PARAM-ERROR', 'message' => $e->getMessage()]);
} catch (DomainException $e) { finish(false, ['code' => 'CONFIG-ERROR', 'message' => $e->getMessage()]);
} catch (Throwable $e) {
    // Do not log exception text: SQL/HTTP exceptions can contain sensitive bound parameters.
    error_log('TickTick settings failure: ' . get_class($e));
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'TickTick settings could not be saved. Your input remains here. Please try again.']);
}
