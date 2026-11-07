<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/TaskPlanning.php';
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
try {
    $project = isset($_GET['projects_id']) && $_GET['projects_id'] !== '' ? TaskPlanning::id($_GET['projects_id']) : null;
    $service = new TaskPlanning($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid']);
    $filters = TaskPlanning::json($_GET['filters'] ?? '{}');
    $filters += ['group' => 'category', 'sort' => 'date'];
    $PAGEDATA['taskPlan'] = $service->document($project);
    $PAGEDATA['taskPlan']['tasks'] = TaskPlanning::filter($PAGEDATA['taskPlan']['tasks'], $filters);
    $PAGEDATA['taskPlan']['group'] = $filters['group'] ?? 'category';
    $PAGEDATA['taskPlan']['includeChecklists'] = ($_GET['checklists'] ?? '1') === '1';
    $PAGEDATA['taskPlan']['title'] = $project ? $PAGEDATA['taskPlan']['project']['projects_name'] : 'Meine Aufgaben';
    $PAGEDATA['taskPlan']['filtered'] = !empty(array_filter(array_intersect_key($filters, array_flip(['search', 'from', 'to', 'categories', 'assignees', 'priorities', 'statuses']))));
} catch (InvalidArgumentException | OutOfBoundsException $e) {
    http_response_code(404); die($TWIG->render('404.twig', $PAGEDATA));
}
$PAGEDATA['INSTANCELOGO'] = PdfFormat::businessLogo($DBLIB, $bCMS, $AUTH->data['instance']);
header('Cache-Control: no-store');
echo $TWIG->render('taskPlanning/export.twig', $PAGEDATA);
