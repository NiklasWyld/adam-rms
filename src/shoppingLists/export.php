<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/ShoppingLists.php';

if (!$AUTH->instancePermissionCheck('SHOPPING_LISTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
$service = new ShoppingLists($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid'], $AUTH->data['instance']['instances_config_currency']);
try {
    $PAGEDATA['shoppingList'] = $service->document(ShoppingLists::id($_GET['id'] ?? null));
} catch (InvalidArgumentException | OutOfBoundsException $error) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
$PAGEDATA['shoppingMeta'] = $service->metadata();
$PAGEDATA['INSTANCELOGO'] = false;
if ($AUTH->data['instance']['instances_logo']) {
    try {
        $PAGEDATA['INSTANCELOGO'] = $bCMS->s3DataUri($AUTH->data['instance']['instances_logo']);
    } catch (Throwable $error) {
        error_log('Shopping list logo unavailable.');
    }
}
header('Cache-Control: no-store');
echo $TWIG->render('shoppingLists/export.twig', $PAGEDATA);
