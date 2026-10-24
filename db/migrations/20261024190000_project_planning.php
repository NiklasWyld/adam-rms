<?php
declare(strict_types=1);
use Phinx\Migration\AbstractMigration;

final class ProjectPlanning extends AbstractMigration
{
    public function change(): void
    {
        $this->table('projectChannelPlans', ['id' => 'projectChannelPlans_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('projects_id', 'integer')
            ->addColumn('instances_id', 'integer')
            ->addColumn('projectChannelPlans_inputs', 'integer')
            ->addColumn('projectChannelPlans_outputs', 'integer')
            ->addColumn('projectChannelPlans_outputLabels', 'string', ['limit' => 16, 'default' => 'alphabetic'])
            ->addColumn('projectChannelPlans_data', 'json')
            ->addColumn('projectChannelPlans_revision', 'integer', ['default' => 1])
            ->addColumn('projectChannelPlans_updated', 'datetime')
            ->addColumn('projectChannelPlans_deleted', 'boolean', ['default' => false])
            ->addIndex(['projects_id'], ['unique' => true])
            ->addIndex(['instances_id', 'projects_id', 'projectChannelPlans_deleted'])
            ->addForeignKey('projects_id', 'projects', 'projects_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('instances_id', 'instances', 'instances_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->create();
        $this->table('s3files')
            ->addColumn('s3files_planningCategory', 'string', ['limit' => 8, 'null' => true])
            ->addIndex(['instances_id', 's3files_planningCategory', 's3files_meta_subType'], ['name' => 's3files_planning_project'])
            ->update();
    }
}
