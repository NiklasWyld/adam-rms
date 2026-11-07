<?php
require_once __DIR__ . '/../common/headSecure.php';

$PAGEDATA['pageConfig'] = ["TITLE" => "Benutzer und Unternehmenseinstellungen", "BREADCRUMB" => false];
echo $TWIG->render('instances/instances_navigation.twig', $PAGEDATA);
