<?php
require_once __DIR__ . '/common/headSecure.php';

$PAGEDATA['pageConfig'] = ["TITLE" => "Seite nicht gefunden", "BREADCRUMB" => false];

echo $TWIG->render('404.twig', $PAGEDATA);
?>
