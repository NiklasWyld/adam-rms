<?php
require_once __DIR__ . '/../common/headSecure.php';
if (!$AUTH->instancePermissionCheck('ROOMS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
$PAGEDATA['roomsActive'] = true;
$PAGEDATA['pageConfig'] = ['TITLE' => 'Rooms', 'BREADCRUMB' => false];
echo $TWIG->render('rooms/index.twig', $PAGEDATA);
