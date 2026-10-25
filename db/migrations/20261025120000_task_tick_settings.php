<?php
declare(strict_types=1);
use Phinx\Migration\AbstractMigration;

final class TaskTickSettings extends AbstractMigration
{
    public function change(): void
    {
        $this->table('taskTickSettings', ['id' => 'taskTickSettings_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('instances_id', 'integer')
            ->addColumn('taskTickSettings_clientId', 'string', ['limit' => 255, 'default' => ''])
            ->addColumn('taskTickSettings_secret', 'text', ['null' => true])
            ->addColumn('taskTickSettings_redirect', 'string', ['limit' => 2048, 'default' => ''])
            ->addColumn('taskTickSettings_enabled', 'boolean', ['default' => true])
            ->addColumn('taskTickSettings_revision', 'integer', ['default' => 1])
            ->addColumn('taskTickSettings_updated', 'datetime')
            ->addColumn('taskTickSettings_updatedBy', 'integer')
            ->addIndex(['instances_id'], ['unique' => true])
            ->addForeignKey('instances_id', 'instances', 'instances_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('taskTickSettings_updatedBy', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])->create();
    }
}
