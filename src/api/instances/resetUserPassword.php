<?php
require_once __DIR__ . '/../apiHeadSecure.php';
require_once __DIR__ . '/../../common/libs/InstanceUserAccounts.php';

$instance = (int)($AUTH->data['instance']['instances_id'] ?? 0);
if (!$instance || !empty($AUTH->data['instance']['instances_suspended']) || !InstanceUserAccounts::canResetPasswords($AUTH)) {
    finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Du darfst in diesem Unternehmen keine Passwörter zurücksetzen.']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    finish(false, ['code' => 'METHOD-ERROR', 'message' => 'Bitte verwende das Formular zum Zurücksetzen des Passworts.']);
}
$csrf = $_POST['csrf_token'] ?? null;
if (empty($_SESSION['instanceUserAccountsCsrf']) || !is_string($csrf) || !hash_equals($_SESSION['instanceUserAccountsCsrf'], $csrf) ||
    filter_var($_POST['company_id'] ?? null, FILTER_VALIDATE_INT) !== $instance) {
    finish(false, ['code' => 'CSRF-ERROR', 'message' => 'Bitte lade die Benutzerverwaltung neu und versuche es erneut.']);
}
$target = filter_var($_POST['user_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$password = $_POST['password'] ?? null;
if ($target === false || !InstanceUserAccounts::validPassword($password)) {
    finish(false, ['code' => 'INPUT-ERROR', 'message' => 'Wähle ein Konto und gib ein Startpasswort mit 12 bis 1024 Zeichen ein.']);
}

$DBLIB->startTransaction();
try {
    $DBLIB->where('users_userid', $target);
    $DBLIB->where('users_managedByInstance_id', $instance);
    $DBLIB->setQueryOption('FOR UPDATE');
    if (!$DBLIB->getOne('users', ['users_userid']) || !InstanceUserAccounts::resettableUsers($DBLIB, $AUTH, $target)) {
        $DBLIB->rollback();
        finish(false, ['code' => 'AUTH-ERROR', 'message' => 'Für dieses Konto kannst du das Passwort hier nicht zurücksetzen.']);
    }

    $DBLIB->where('users_userid', $target);
    if (!$DBLIB->update('users', InstanceUserAccounts::temporaryCredentials($password, $CONFIG['AUTH_NEXTHASH'])) ||
        !$AUTH->destroyTokens($target)) {
        throw new RuntimeException('Could not update credentials and revoke sessions.');
    }
    $DBLIB->where('users_userid', $target);
    $DBLIB->where('passwordResetCodes_valid', 1);
    if (!$DBLIB->update('passwordResetCodes', ['passwordResetCodes_valid' => 0])) {
        throw new RuntimeException('Could not invalidate password reset codes.');
    }
    $bCMS->auditLog('RESET-PASSWORD-IN-INSTANCE', 'users', ['instances_id' => $instance], $AUTH->data['users_userid'], $target);
    if (!$DBLIB->commit()) throw new RuntimeException('Password reset could not be committed.');
} catch (Throwable $error) {
    $DBLIB->rollback();
    error_log('Instance password reset failed: ' . get_class($error));
    finish(false, ['code' => 'SAVE-ERROR', 'message' => 'Das Passwort konnte nicht zurückgesetzt werden. Bitte versuche es erneut.']);
}
finish(true);
