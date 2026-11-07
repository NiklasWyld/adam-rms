<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/InstanceUserAccounts.php';

$instance = (int)($AUTH->data['instance']['instances_id'] ?? 0);
if (!$instance || !$AUTH->instancePermissionCheck('BUSINESS:USERS:VIEW:LIST') ||
    !$AUTH->instancePermissionCheck('BUSINESS:USERS:CREATE:ADD_USER_BY_EMAIL')) {
    finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Du darfst in diesem Unternehmen keine Konten anlegen.']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Bitte verwende das Formular zur Kontoanlage.']);
}
$csrf = $_POST['csrf_token'] ?? null;
if (empty($_SESSION['instanceUserAccountsCsrf']) || !is_string($csrf) || !hash_equals($_SESSION['instanceUserAccountsCsrf'], $csrf) ||
    filter_var($_POST['company_id'] ?? null, FILTER_VALIDATE_INT) !== $instance) {
    finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Bitte lade die Benutzerverwaltung neu und versuche es erneut.']);
}

$username = is_string($_POST['username'] ?? null) ? strtolower(trim($_POST['username'])) : '';
$password = $_POST['password'] ?? null;
$positionId = filter_var($_POST['position'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,63}$/D', $username)) {
    finish(false, ['code' => 'INPUT-ERROR', 'message' => 'Bitte gib einen gültigen Benutzernamen ein.']);
}
if (!InstanceUserAccounts::validPassword($password)) {
    finish(false, ['code' => 'INPUT-ERROR', 'message' => 'Das Startpasswort muss 12 bis 1024 Zeichen lang sein.']);
}
$names = [];
foreach (['name1', 'name2'] as $field) {
    $value = $_POST[$field] ?? '';
    if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || preg_match('/[\x00-\x1f\x7f]/', $value)) {
        finish(false, ['code' => 'INPUT-ERROR', 'message' => 'Bitte gib einen gültigen Namen ein.']);
    }
    $name = $bCMS->sanitizeString(trim($value));
    if (mb_strlen($name) > 100 || ($field === 'name1' && $name === '')) {
        finish(false, ['code' => 'INPUT-ERROR', 'message' => 'Bitte gib einen Vornamen ein. Vor- und Nachname dürfen je höchstens 100 Zeichen lang sein.']);
    }
    $names[$field] = $name;
}

$DBLIB->startTransaction();
try {
    $DBLIB->where('instances_id', $instance);
    $DBLIB->where('instances_deleted', 0);
    $DBLIB->where('instances_suspended', 0);
    $DBLIB->setQueryOption('FOR UPDATE');
    if (!$DBLIB->getOne('instances', ['instances_id']) || !$bCMS->instanceHasUserCapacity($instance)) {
        throw new DomainException('Dieses Unternehmen kann keine weiteren Benutzer aufnehmen.');
    }

    $DBLIB->where('instances_id', $instance);
    $DBLIB->where('instancePositions_id', $positionId);
    $DBLIB->where('instancePositions_deleted', 0);
    $DBLIB->setQueryOption('FOR UPDATE');
    $position = $DBLIB->getOne('instancePositions', ['instancePositions_id', 'instancePositions_actions']);
    if (!$position || !$AUTH->canAssignInstancePosition($position)) {
        throw new DomainException('Bitte wähle eine Rollengruppe, die du zuweisen darfst.');
    }
    if ($AUTH->usernameTaken($username)) {
        throw new DomainException('Dieser Benutzername ist bereits vergeben.');
    }

    $user = $DBLIB->insert('users', [
        'users_username' => $username,
        'users_email' => null,
        'users_name1' => $names['name1'],
        'users_name2' => $names['name2'],
        'users_managedByInstance_id' => $instance,
    ] + InstanceUserAccounts::temporaryCredentials($password, $CONFIG['AUTH_NEXTHASH']));
    if (!$user && $DBLIB->getLastErrno() === 1062) throw new DomainException('Dieser Benutzername ist bereits vergeben.');
    if (!$user || !$DBLIB->insert('userInstances', ['users_userid' => $user, 'instancePositions_id' => $position['instancePositions_id']])) {
        throw new RuntimeException('Could not persist account and membership.');
    }
    $bCMS->auditLog('CREATE-IN-INSTANCE', 'users', ['instances_id' => $instance], $AUTH->data['users_userid'], $user);
    if (!$DBLIB->commit()) throw new RuntimeException('Account creation could not be committed.');
} catch (DomainException $error) {
    $DBLIB->rollback();
    finish(false, ['code' => 'INPUT-ERROR', 'message' => $error->getMessage()]);
} catch (Throwable $error) {
    $DBLIB->rollback();
    if ($error instanceof mysqli_sql_exception && $error->getCode() === 1062) {
        finish(false, ['code' => 'INPUT-ERROR', 'message' => 'Dieser Benutzername ist bereits vergeben.']);
    }
    error_log('Instance account creation failed: ' . get_class($error));
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'Das Konto konnte nicht angelegt werden. Bitte versuche es erneut.']);
}

finish(true);
