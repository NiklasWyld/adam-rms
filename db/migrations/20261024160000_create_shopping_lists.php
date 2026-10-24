<?php
declare(strict_types=1);
use Phinx\Migration\AbstractMigration;

final class CreateShoppingLists extends AbstractMigration
{
    public function change(): void
    {
        $this->table('shoppingLists', ['id' => 'shoppingLists_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('instances_id', 'integer')
            ->addColumn('users_userid', 'integer')
            ->addColumn('shoppingLists_name', 'string', ['limit' => 255])
            ->addColumn('shoppingLists_description', 'text', ['null' => true])
            ->addColumn('shoppingLists_comment', 'text', ['null' => true])
            ->addColumn('shoppingLists_created', 'datetime')
            ->addColumn('shoppingLists_updated', 'datetime')
            ->addColumn('shoppingLists_currency', 'string', ['limit' => 3])
            ->addColumn('shoppingLists_budget', 'biginteger', ['null' => true])
            ->addColumn('shoppingLists_status', 'string', ['limit' => 16, 'default' => 'draft'])
            ->addColumn('shoppingLists_deleted', 'boolean', ['default' => false])
            ->addIndex(['instances_id', 'shoppingLists_deleted', 'shoppingLists_status'])
            ->addIndex(['shoppingLists_id', 'instances_id'], ['unique' => true])
            ->addForeignKey('instances_id', 'instances', 'instances_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('users_userid', 'users', 'users_userid', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->create();

        $items = $this->table('shoppingListItems', ['id' => 'shoppingListItems_id', 'signed' => true, 'encoding' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci'])
            ->addColumn('shoppingLists_id', 'integer')
            ->addColumn('instances_id', 'integer')
            ->addColumn('manufacturers_id', 'integer', ['null' => true])
            ->addColumn('assetCategories_id', 'integer', ['null' => true])
            ->addColumn('shoppingListItems_name', 'string', ['limit' => 255])
            ->addColumn('shoppingListItems_model', 'string', ['limit' => 255, 'default' => ''])
            ->addColumn('shoppingListItems_description', 'text', ['null' => true])
            ->addColumn('shoppingListItems_quantity', 'decimal', ['precision' => 12, 'scale' => 3, 'default' => '1.000'])
            ->addColumn('shoppingListItems_unit', 'string', ['limit' => 40, 'default' => ''])
            ->addColumn('shoppingListItems_unitPrice', 'biginteger', ['null' => true])
            ->addColumn('shoppingListItems_supplier', 'string', ['limit' => 255, 'default' => ''])
            ->addColumn('shoppingListItems_sku', 'string', ['limit' => 255, 'default' => ''])
            ->addColumn('shoppingListItems_url', 'string', ['limit' => 2048, 'null' => true])
            ->addColumn('shoppingListItems_image', 'string', ['limit' => 2048, 'null' => true])
            ->addColumn('shoppingListItems_notes', 'text', ['null' => true])
            ->addColumn('shoppingListItems_priority', 'string', ['limit' => 16])
            ->addColumn('shoppingListItems_reason', 'text', ['null' => true])
            ->addColumn('shoppingListItems_status', 'string', ['limit' => 16, 'default' => 'planned'])
            ->addColumn('shoppingListItems_order', 'integer', ['default' => 0])
            ->addColumn('shoppingListItems_deleted', 'boolean', ['default' => false])
            ->addIndex(['instances_id', 'shoppingLists_id', 'shoppingListItems_deleted', 'shoppingListItems_order'])
            // This composite FK makes cross-instance parent/child links impossible, including outside the API.
            ->addForeignKey(['shoppingLists_id', 'instances_id'], 'shoppingLists', ['shoppingLists_id', 'instances_id'], ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('manufacturers_id', 'manufacturers', 'manufacturers_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE'])
            ->addForeignKey('assetCategories_id', 'assetCategories', 'assetCategories_id', ['delete' => 'RESTRICT', 'update' => 'CASCADE']);
        $items->create();
    }
}
