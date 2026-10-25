<?php
declare(strict_types=1);
use Phinx\Migration\AbstractMigration;

final class TaskPlanningSchema extends AbstractMigration
{
    private function scoped(string $name, string $id)
    {
        return $this->table($name, ['id' => $id, 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('instances_id', 'integer')
            ->addForeignKey('instances_id', 'instances', 'instances_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE']);
    }
    public function change(): void
    {
        $this->scoped('taskCategories', 'taskCategories_id')
            ->addColumn('taskCategories_name', 'string', ['limit' => 120])
            ->addColumn('taskCategories_deleted', 'boolean', ['default' => false])
            ->addIndex(['instances_id', 'taskCategories_name'], ['unique' => true])
            ->addIndex(['taskCategories_id', 'instances_id'], ['unique' => true])->create();
        $this->scoped('planningTasks', 'planningTasks_id')
            ->addColumn('projects_id', 'integer')->addColumn('taskCategories_id', 'integer', ['null' => true])
            ->addColumn('users_userid', 'integer', ['null' => true])
            ->addColumn('planningTasks_title', 'string', ['limit' => 500])
            ->addColumn('planningTasks_description', 'text', ['null' => true])
            ->addColumn('planningTasks_day', 'date', ['null' => true])->addColumn('planningTasks_time', 'time', ['null' => true])
            ->addColumn('planningTasks_deadline', 'datetime', ['null' => true])
            ->addColumn('planningTasks_priority', 'integer', ['default' => 1])
            ->addColumn('planningTasks_status', 'string', ['limit' => 16, 'default' => 'open'])
            ->addColumn('planningTasks_checklist', 'json', ['null' => true])
            ->addColumn('planningTasks_order', 'integer', ['default' => 0])
            ->addColumn('planningTasks_revision', 'integer', ['default' => 1])
            ->addColumn('planningTasks_created', 'datetime')->addColumn('planningTasks_updated', 'datetime')
            ->addColumn('planningTasks_updatedBy', 'integer')
            ->addColumn('planningTasks_deleted', 'boolean', ['default' => false])
            ->addIndex(['instances_id', 'projects_id', 'planningTasks_deleted'])
            ->addIndex(['instances_id', 'users_userid', 'planningTasks_day'])
            ->addIndex(['planningTasks_id', 'instances_id'], ['unique' => true])
            ->addForeignKey(['projects_id', 'instances_id'], 'projects', ['projects_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey(['taskCategories_id', 'instances_id'], 'taskCategories', ['taskCategories_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('users_userid', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])->create();
        $this->scoped('taskTemplates', 'taskTemplates_id')
            ->addColumn('taskTemplates_name', 'string', ['limit' => 160])->addColumn('taskTemplates_items', 'json')
            ->addColumn('taskTemplates_revision', 'integer', ['default' => 1])
            ->addColumn('taskTemplates_deleted', 'boolean', ['default' => false])
            ->addColumn('taskTemplates_updated', 'datetime')->addColumn('users_userid', 'integer')
            ->addIndex(['instances_id', 'taskTemplates_deleted'])->create();
        $this->scoped('taskSavedFilters', 'taskSavedFilters_id')->addColumn('users_userid', 'integer')
            ->addColumn('taskSavedFilters_name', 'string', ['limit' => 120])->addColumn('taskSavedFilters_value', 'json')
            ->addColumn('taskSavedFilters_deleted', 'boolean', ['default' => false])
            ->addIndex(['instances_id', 'users_userid'])->create();
        $this->scoped('taskOperations', 'taskOperations_id')->addColumn('users_userid', 'integer')
            ->addColumn('taskOperations_key', 'string', ['limit' => 64])->addColumn('taskOperations_hash', 'string', ['limit' => 64])
            ->addColumn('taskOperations_result', 'json', ['null' => true])
            ->addIndex(['instances_id', 'users_userid', 'taskOperations_key'], ['unique' => true, 'name' => 'task_request_key'])->create();
        $this->scoped('taskTickConnections', 'taskTickConnections_id')->addColumn('users_userid', 'integer')
            ->addColumn('taskTickConnections_token', 'text', ['null' => true])->addColumn('taskTickConnections_expires', 'datetime', ['null' => true])
            ->addIndex(['instances_id', 'users_userid'], ['unique' => true])->create();
        $this->scoped('taskTickProjects', 'taskTickProjects_id')->addColumn('users_userid', 'integer')->addColumn('projects_id', 'integer')
            ->addColumn('taskTickProjects_external', 'string', ['limit' => 80, 'null' => true])
            ->addColumn('taskTickProjects_name', 'string', ['limit' => 255])
            ->addColumn('taskTickProjects_state', 'string', ['limit' => 16, 'default' => 'new'])
            ->addColumn('taskTickProjects_synced', 'datetime', ['null' => true])
            ->addColumn('taskTickProjects_error', 'string', ['limit' => 500, 'null' => true])
            ->addIndex(['instances_id', 'users_userid', 'projects_id'], ['unique' => true, 'name' => 'task_tick_project'])
            ->addForeignKey(['projects_id', 'instances_id'], 'projects', ['projects_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])->create();
        $this->scoped('taskTickTasks', 'taskTickTasks_id')->addColumn('users_userid', 'integer')->addColumn('planningTasks_id', 'integer')
            ->addColumn('taskTickTasks_project', 'string', ['limit' => 80])
            ->addColumn('taskTickTasks_external', 'string', ['limit' => 80, 'null' => true])
            ->addColumn('taskTickTasks_state', 'string', ['limit' => 16, 'default' => 'new'])
            ->addColumn('taskTickTasks_hash', 'string', ['limit' => 64, 'null' => true])
            ->addColumn('taskTickTasks_synced', 'datetime', ['null' => true])
            ->addColumn('taskTickTasks_error', 'string', ['limit' => 500, 'null' => true])
            ->addIndex(['instances_id', 'users_userid', 'planningTasks_id'], ['unique' => true, 'name' => 'task_tick_task'])
            ->addForeignKey(['planningTasks_id', 'instances_id'], 'planningTasks', ['planningTasks_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])->create();
    }
}
