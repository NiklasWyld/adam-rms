<?php
declare(strict_types=1);
use Phinx\Migration\AbstractMigration;

final class RoomPlanning extends AbstractMigration
{
    public function change(): void
    {
        $this->table('instances')->addColumn('instances_config_roomPlanningTimezone', 'string', ['limit' => 64, 'default' => 'Europe/Berlin'])->update();
        $this->table('projects')->addIndex(['projects_id', 'instances_id'], ['unique' => true, 'name' => 'projects_room_scope'])->update();
        $this->table('rooms', ['id' => 'rooms_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('instances_id', 'integer')->addColumn('locations_id', 'integer', ['null' => true])
            ->addColumn('rooms_name', 'string', ['limit' => 255])->addColumn('rooms_number', 'string', ['limit' => 64, 'default' => ''])
            ->addColumn('rooms_building', 'string', ['limit' => 255, 'default' => ''])
            ->addColumn('rooms_capacity', 'integer', ['null' => true])->addColumn('rooms_description', 'text', ['null' => true])
            ->addColumn('rooms_equipment', 'text', ['null' => true])->addColumn('rooms_notes', 'text', ['null' => true])
            ->addColumn('rooms_active', 'boolean', ['default' => true])->addColumn('rooms_deleted', 'boolean', ['default' => false])
            ->addColumn('rooms_revision', 'integer', ['default' => 1])
            ->addColumn('rooms_created', 'datetime')->addColumn('rooms_updated', 'datetime')
            ->addColumn('users_userid', 'integer')->addColumn('rooms_updatedBy', 'integer')
            ->addIndex(['instances_id', 'rooms_deleted', 'rooms_active'])
            ->addIndex(['rooms_id', 'instances_id'], ['unique' => true])
            ->addForeignKey('instances_id', 'instances', 'instances_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('locations_id', 'locations', 'locations_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('users_userid', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('rooms_updatedBy', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])->create();
        $this->table('roomReservations', ['id' => 'roomReservations_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('instances_id', 'integer')->addColumn('projects_id', 'integer')->addColumn('rooms_id', 'integer')
            ->addColumn('roomReservations_start', 'datetime')->addColumn('roomReservations_end', 'datetime')
            ->addColumn('roomReservations_purpose', 'string', ['limit' => 1000])
            ->addColumn('roomReservations_notes', 'text', ['null' => true])
            ->addColumn('roomReservations_status', 'string', ['limit' => 16, 'default' => 'planned'])
            ->addColumn('roomReservations_revision', 'integer', ['default' => 1])
            ->addColumn('roomReservations_created', 'datetime')->addColumn('roomReservations_updated', 'datetime')
            ->addColumn('users_userid', 'integer')->addColumn('roomReservations_updatedBy', 'integer')
            ->addColumn('roomReservations_deleted', 'boolean', ['default' => false])
            ->addIndex(['instances_id', 'projects_id', 'roomReservations_deleted'])
            ->addIndex(['instances_id', 'rooms_id', 'roomReservations_start', 'roomReservations_end'], ['name' => 'room_interval'])
            ->addForeignKey(['projects_id', 'instances_id'], 'projects', ['projects_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey(['rooms_id', 'instances_id'], 'rooms', ['rooms_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('users_userid', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('roomReservations_updatedBy', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])->create();
    }
}
