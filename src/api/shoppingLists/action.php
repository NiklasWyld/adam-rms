<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/ShoppingLists.php';

// Procurement permissions are deliberately independent of inventory permissions.
if (!$AUTH->instancePermissionCheck('SHOPPING_LISTS:VIEW')) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission to view shopping lists.']);
$service = new ShoppingLists($DBLIB, (int)$AUTH->data['instance']['instances_id'], (int)$AUTH->data['users_userid'], $AUTH->data['instance']['instances_config_currency']);
if (empty($_SESSION['shoppingListsCsrf'])) $_SESSION['shoppingListsCsrf'] = bin2hex(random_bytes(32));
$action = $_POST['action'] ?? 'data';
if (!is_string($action)) finish(false, ['code' => 'PARAM-ERROR', 'message' => 'Invalid action.']);
try {
    if ($action === 'data') {
        $id = $_POST['id'] ?? '';
        finish(true, null, ['csrf' => $_SESSION['shoppingListsCsrf'], 'data' => $id === '' ? $service->overview() : $service->document(ShoppingLists::id($id))]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Use POST to change shopping data.']);
    $token = $_POST['csrf'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['shoppingListsCsrf'], $token)) finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Please reload the page and try again.']);
    $permissions = ['saveList' => empty($_POST['id']) ? 'CREATE' : 'EDIT', 'duplicateList' => 'CREATE',
        'archiveList' => 'ARCHIVE', 'deleteList' => 'DELETE', 'saveItem' => 'EDIT',
        'duplicateItem' => 'EDIT', 'deleteItem' => 'DELETE', 'reorder' => 'EDIT'];
    if (!isset($permissions[$action])) finish(false, ['code' => 'PARAM-ERROR', 'message' => 'Unknown action.']);
    if (!$AUTH->instancePermissionCheck('SHOPPING_LISTS:' . $permissions[$action])) finish(false, ['code' => 'AUTH-ERROR', 'message' => 'No permission for this shopping action.']);
    $id = $service->mutate($action, $_POST);
    $bCMS->auditLog(strtoupper($action), 'shoppingLists', null, $AUTH->data['users_userid'], null, null, $id);
    finish(true, null, ['id' => $id]);
} catch (InvalidArgumentException $error) {
    finish(false, ['code' => 'PARAM-ERROR', 'message' => $error->getMessage()]);
} catch (OutOfBoundsException $error) {
    finish(false, ['code' => 'NOT-FOUND', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Shopping lists: ' . $error->getMessage());
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'Unable to save shopping data. Please try again.']);
}
