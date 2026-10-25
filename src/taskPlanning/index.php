<?php
require_once __DIR__ . '/../common/headSecure.php';
if (!$AUTH->instancePermissionCheck('PROJECTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
$PAGEDATA['myTasksActive'] = true;
$PAGEDATA['pageConfig'] = ['TITLE' => 'My Tasks', 'BREADCRUMB' => false];
echo $TWIG->render('taskPlanning/index.twig', $PAGEDATA);
