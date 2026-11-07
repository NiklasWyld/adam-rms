<?php
require_once __DIR__ . '/../common/headSecure.php';
require_once __DIR__ . '/../common/libs/ShoppingLists.php';
require_once __DIR__ . '/../common/libs/PdfFormat.php';

if (!$AUTH->instancePermissionCheck('SHOPPING_LISTS:VIEW')) die($TWIG->render('404.twig', $PAGEDATA));
$service = new ShoppingLists($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid'], $AUTH->data['instance']['instances_config_currency']);
try {
    $PAGEDATA['shoppingList'] = $service->document(ShoppingLists::id($_GET['id'] ?? null));
} catch (InvalidArgumentException | OutOfBoundsException $error) {
    http_response_code(404);
    die($TWIG->render('404.twig', $PAGEDATA));
}
$list = &$PAGEDATA['shoppingList'];
$currency = new \Money\Currency($list['shoppingLists_currency']);
$total = new \Money\Money($list['totalMinor'], $currency);
$list['totalFormatted'] = PdfFormat::money($total);
if ($list['shoppingLists_budget'] !== null) {
    $budget = new \Money\Money($list['shoppingLists_budget'], $currency);
    $list['budgetFormatted'] = PdfFormat::money($budget);
    $list['remainingFormatted'] = PdfFormat::money($budget->subtract($total));
}
foreach ($list['items'] as &$item) {
    $item['unitPriceFormatted'] = $item['shoppingListItems_unitPrice'] === null ? 'Ohne Preis' :
        PdfFormat::money(new \Money\Money($item['shoppingListItems_unitPrice'], $currency));
    $item['totalFormatted'] = $item['totalMinor'] === null ? 'Ohne Preis' :
        PdfFormat::money(new \Money\Money($item['totalMinor'], $currency));
}
unset($item, $list);
$PAGEDATA['INSTANCELOGO'] = PdfFormat::businessLogo($DBLIB, $bCMS, $AUTH->data['instance']);
header('Cache-Control: no-store');
echo $TWIG->render('shoppingLists/export.twig', $PAGEDATA);
