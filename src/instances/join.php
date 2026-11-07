<?php
require_once __DIR__ . '/../common/headSecure.php';

$PAGEDATA['pageConfig'] = ["TITLE" => "Unternehmen beitreten", "BREADCRUMB" => false];

echo $TWIG->render('instances/instances_join.twig', $PAGEDATA);
?>
