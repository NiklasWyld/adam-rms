<?php
require_once __DIR__ . '/../../common/headSecure.php';

$PAGEDATA['pageConfig'] = ["TITLE" => "Firmenlogo", "BREADCRUMB" => false];

if (!$AUTH->instancePermissionCheck("BUSINESS:BUSINESS_SETTINGS:VIEW")) die($TWIG->render('404.twig', $PAGEDATA));

echo $TWIG->render('instances/configuration/instances_configuration_logo.twig', $PAGEDATA);
?>
