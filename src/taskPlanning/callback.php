<?php
// OAuth codes/state must not enter page analytics, return URLs or application error telemetry.
$oauthInput = $_GET;
$_GET = [];
$_REQUEST = [];
$_SERVER['QUERY_STRING'] = '';
$_SERVER['REQUEST_URI'] = strtok($_SERVER['REQUEST_URI'], '?');
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/TaskPlanning.php';
require_once __DIR__ . '/../common/libs/TaskTickTick.php';
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW') || !$AUTH->instancePermissionCheck('PROJECTS:TASK_PLANNING:SYNC')) die($TWIG->render('404.twig', $PAGEDATA));
try {
    $tick = new TaskTickTick($DBLIB, new TaskPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']));
    $project = $tick->callback(TaskPlanning::text($oauthInput['state'] ?? '', 128, true), TaskPlanning::text($oauthInput['code'] ?? '', 2000, true));
    header('Location: ' . $CONFIG['ROOTURL'] . ($project ? '/project/?id=' . $project . '#task-planning-view' : '/taskPlanning/'));
    exit;
} catch (Throwable $e) {
    $PAGEDATA['pageConfig'] = ['TITLE' => 'TickTick-Verbindung', 'BREADCRUMB' => false];
    $PAGEDATA['connectionError'] = $e instanceof DomainException || $e instanceof InvalidArgumentException ? $e->getMessage() : 'TickTick could not be connected. Return to Task Planning and try again.';
    echo $TWIG->render('taskPlanning/callback.twig', $PAGEDATA);
}
