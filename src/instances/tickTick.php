<?php
require_once __DIR__ . '/../common/headSecure.php';
if (!$AUTH->instancePermissionCheck('BUSINESS:BUSINESS_SETTINGS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
$PAGEDATA['pageConfig'] = ['TITLE' => 'TickTick Settings', 'BREADCRUMB' => false];
echo $TWIG->render('instances/tickTick.twig', $PAGEDATA);
