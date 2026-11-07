<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/ShiftPlanning.php';

header('Cache-Control: no-store');
$instance = $AUTH->data['instance']['instances_id'] ?? null;
if (!$instance || !$AUTH->instancePermissionCheck('PROJECTS:VIEW') || !$AUTH->instancePermissionCheck('PROJECTS:PROJECT_CREW:VIEW')) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
try {
    $project = ShiftPlanning::id($_GET['id'] ?? null);
    $service = new ShiftPlanning($DBLIB, (int)$instance);
    $PAGEDATA['shiftPlan'] = $service->document($project, showConflicts: false);
} catch (InvalidArgumentException | OutOfBoundsException $error) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
$PAGEDATA['INSTANCELOGO'] = PdfFormat::businessLogo($DBLIB, $bCMS, $AUTH->data['instance']);
echo $TWIG->render('project/shiftPlanningExport.twig', $PAGEDATA);
