<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

final class ManagedUserAccounts extends AbstractMigration
{
    public function up(): void
    {
        $this->table('users')
            ->addColumn('users_managedByInstance_id', 'integer', ['null' => true])
            ->addForeignKey('users_managedByInstance_id', 'instances', 'instances_id', ['delete' => 'SET_NULL', 'update' => 'CASCADE'])
            ->update();

        // Backfill only accounts that the direct creation form recorded when it created them.
        $this->execute(<<<'SQL'
            UPDATE users
            JOIN auditLog AS provenance ON provenance.auditLog_actionUserid = users.users_userid
                AND provenance.auditLog_actionType = 'CREATE-IN-INSTANCE'
                AND provenance.auditLog_actionTable = 'users'
                AND provenance.auditLog_deleted = 0
            JOIN instances ON instances.instances_id = CAST(JSON_UNQUOTE(JSON_EXTRACT(
                IF(JSON_VALID(provenance.auditLog_actionData), provenance.auditLog_actionData, '{}'), '$.instances_id'
            )) AS UNSIGNED)
            SET users.users_managedByInstance_id = instances.instances_id
            SQL);
    }

    public function down(): void
    {
        $this->table('users')->dropForeignKey('users_managedByInstance_id')->removeColumn('users_managedByInstance_id')->update();
    }
}
