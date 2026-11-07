<?php

final class InstanceUserAccounts
{
    public static function canResetPasswords(bID $auth): bool
    {
        return $auth->instancePermissionCheck('BUSINESS:USERS:VIEW:LIST') &&
            $auth->instancePermissionCheck('BUSINESS:USERS:CREATE:ADD_USER_BY_EMAIL') &&
            $auth->instancePermissionCheck('BUSINESS:USERS:EDIT:CHANGE_ROLE');
    }

    public static function validPassword($password): bool
    {
        if (!is_string($password) || strlen($password) > 4096 || !mb_check_encoding($password, 'UTF-8')) return false;
        $length = mb_strlen($password);
        return $length >= 12 && $length <= 1024;
    }

    public static function temporaryCredentials(string $password, string $algorithm): array
    {
        $salt1 = bin2hex(random_bytes(8));
        $salt2 = bin2hex(random_bytes(8));
        return [
            'users_salty1' => $salt1,
            'users_salty2' => $salt2,
            'users_hash' => $algorithm,
            'users_password' => hash($algorithm, $salt1 . $password . $salt2),
            'users_changepass' => 1,
        ];
    }

    /** Recheck active roles and the account's scope in the transaction before changing credentials. */
    public static function resettableUsers($db, bID $auth, ?int $target = null): array
    {
        $instance = (int)$auth->data['instance']['instances_id'];
        $db->join('userInstances', 'userInstances.users_userid = users.users_userid', 'INNER');
        $db->join('instancePositions', 'instancePositions.instancePositions_id = userInstances.instancePositions_id', 'INNER');
        $db->where('users_managedByInstance_id', $instance);
        $db->where('instancePositions.instances_id', $instance);
        $db->where('users.users_userid', $auth->data['users_userid'], '!=');
        $db->where('users_deleted', 0);
        $db->where('users_suspended', 0);
        $db->where('users_password', null, 'IS NOT');
        $db->where('userInstances_deleted', 0);
        $db->where('(userInstances_archived IS NULL OR userInstances_archived > ?)', [date('Y-m-d H:i:s')]);
        $db->where('NOT EXISTS (SELECT 1 FROM userPositions WHERE userPositions.users_userid = users.users_userid)');
        $db->where('NOT EXISTS (SELECT 1 FROM userInstances AS otherMembership
            JOIN instancePositions AS otherRole ON otherRole.instancePositions_id = otherMembership.instancePositions_id
            WHERE otherMembership.users_userid = users.users_userid AND otherMembership.userInstances_deleted = 0
                AND otherRole.instances_id <> users.users_managedByInstance_id)');
        if ($target !== null) {
            $db->where('users.users_userid', $target);
            $db->setQueryOption('FOR UPDATE');
        }
        $rows = $db->get('users', null, ['users.users_userid', 'instancePositions_deleted', 'instancePositions_actions', 'userInstances_extraPermissions']);
        $eligible = [];
        foreach ($rows as $row) {
            $id = $row['users_userid'];
            $row['instancePositions_actions'] .= ',' . $row['userInstances_extraPermissions'];
            $eligible[$id] = ($eligible[$id] ?? true) && !$row['instancePositions_deleted'] && $auth->canAssignInstancePosition($row);
        }
        return array_filter($eligible);
    }
}
