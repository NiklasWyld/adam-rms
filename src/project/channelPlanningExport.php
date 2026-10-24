<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/ChannelPlanning.php';
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
$service = new ChannelPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id']);
try {
    $id = ChannelPlanning::integer($_GET['id'] ?? null, 1, 2147483647);
    $PAGEDATA['project'] = $service->project($id);
    $PAGEDATA['channelPlan'] = $service->document($id);
} catch (InvalidArgumentException | OutOfBoundsException $error) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
$PAGEDATA['INSTANCELOGO'] = false;
if ($AUTH->data['instance']['instances_logo']) {
    try { $PAGEDATA['INSTANCELOGO'] = $bCMS->s3DataUri($AUTH->data['instance']['instances_logo']); }
    catch (Throwable $error) { error_log('Channel planning logo unavailable.'); }
}
header('Cache-Control: no-store');
echo $TWIG->render('project/channelPlanningExport.twig', $PAGEDATA);
