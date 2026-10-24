<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/RoomPlanning.php';
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
try {
    $id = RoomPlanning::id($_GET['id'] ?? null);
    $type = $_GET['type'] ?? 'plan';
    if (!is_string($type) || !in_array($type, ['plan', 'request'], true)) throw new InvalidArgumentException('Invalid export type.');
    $service = new RoomPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']);
    $PAGEDATA['roomPlan'] = $service->document($id, true, false);
    $PAGEDATA['exportType'] = $type;
} catch (InvalidArgumentException | OutOfBoundsException $error) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
$PAGEDATA['INSTANCELOGO'] = false;
if ($AUTH->data['instance']['instances_logo']) {
    try { $PAGEDATA['INSTANCELOGO'] = $bCMS->s3DataUri($AUTH->data['instance']['instances_logo']); }
    catch (Throwable $error) { error_log('Room planning logo unavailable.'); }
}
header('Cache-Control: no-store');
echo $TWIG->render('rooms/export.twig', $PAGEDATA);
