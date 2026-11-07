<?php
declare(strict_types=1);

use Phinx\Migration\AbstractMigration;

final class ProjectShiftPlanning extends AbstractMigration
{
    public function change(): void
    {
        $this->table('projectShifts', ['id' => 'projectShifts_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('instances_id', 'integer', ['null' => false])
            ->addColumn('projects_id', 'integer', ['null' => false])
            ->addColumn('projectShifts_start', 'datetime', ['null' => false])
            ->addColumn('projectShifts_end', 'datetime', ['null' => false])
            ->addColumn('projectShifts_title', 'string', ['null' => false, 'limit' => 180])
            ->addColumn('projectShifts_tasks', 'text', ['null' => false])
            ->addColumn('projectShifts_meetingPoint', 'string', ['null' => false, 'limit' => 255])
            ->addColumn('projectShifts_notes', 'text', ['null' => false])
            ->addColumn('projectShifts_requestKey', 'string', ['null' => false, 'limit' => 32])
            ->addColumn('projectShifts_revision', 'integer', ['null' => false, 'default' => 1])
            ->addColumn('projectShifts_deleted', 'boolean', ['null' => false, 'default' => false])
            ->addIndex(['projects_id', 'instances_id', 'projectShifts_deleted', 'projectShifts_start'])
            ->addIndex(['projects_id', 'projectShifts_requestKey'], ['unique' => true])
            ->addForeignKey(['projects_id', 'instances_id'], 'projects', ['projects_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->create();

        $this->table('projectShiftAssignments', [
            'id' => false, 'primary_key' => ['projectShifts_id', 'users_userid'],
            'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci',
        ])
            ->addColumn('projectShifts_id', 'integer', ['null' => false])
            ->addColumn('users_userid', 'integer', ['null' => false])
            ->addColumn('projectShiftAssignments_role', 'string', ['null' => false, 'limit' => 255])
            ->addColumn('projectShiftAssignments_deleted', 'boolean', ['null' => false, 'default' => false])
            ->addIndex(['users_userid', 'projectShiftAssignments_deleted', 'projectShifts_id'])
            ->addForeignKey('projectShifts_id', 'projectShifts', 'projectShifts_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('users_userid', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->create();
    }
}
