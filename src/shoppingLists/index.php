<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/ShoppingLists.php';

if (!$AUTH->instancePermissionCheck('SHOPPING_LISTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
$service = new ShoppingLists($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid'], $AUTH->data['instance']['instances_config_currency']);
if (empty($_SESSION['shoppingListsCsrf'])) $_SESSION['shoppingListsCsrf'] = bin2hex(random_bytes(32));
$PAGEDATA['shoppingCsrf'] = $_SESSION['shoppingListsCsrf'];
$PAGEDATA['shoppingMeta'] = array_replace_recursive($service->metadata(), [
    'statuses' => ['draft' => 'Entwurf', 'active' => 'Aktiv', 'completed' => 'Abgeschlossen', 'archived' => 'Archiviert'],
    'priorities' => ['essential' => 'Unverzichtbar', 'high' => 'Hoch', 'medium' => 'Mittel', 'low' => 'Gering', 'optional' => 'Optional'],
    'itemStatuses' => ['planned' => 'Geplant', 'approved' => 'Freigegeben', 'ordered' => 'Bestellt', 'purchased' => 'Gekauft', 'rejected' => 'Abgelehnt'],
]);
$PAGEDATA['shoppingActive'] = true;
$PAGEDATA['pageConfig'] = ['TITLE' => 'Einkaufslisten', 'BREADCRUMB' => false];
try {
    $PAGEDATA['shoppingList'] = isset($_GET['id']) ? $service->document(ShoppingLists::id($_GET['id'])) : null;
    $PAGEDATA['shoppingLists'] = $PAGEDATA['shoppingList'] ? [] : $service->overview();
} catch (InvalidArgumentException | OutOfBoundsException $error) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
echo $TWIG->render('shoppingLists/index.twig', $PAGEDATA);
