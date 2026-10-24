<?php
declare(strict_types=1);

use Money\Currency;
use Money\Money;
use Money\Currencies\ISOCurrencies;
use Money\Parser\DecimalMoneyParser;
use Money\Formatter\DecimalMoneyFormatter;
use Money\Formatter\IntlMoneyFormatter;

/**
 * Planned procurement only. Never creates or updates assets, asset types or assignments.
 * Every record lookup includes the current business, even after checking its parent.
 */
final class ShoppingLists
{
    public const STATUSES = ['draft' => 'Draft', 'active' => 'Active', 'completed' => 'Completed', 'archived' => 'Archived'];
    public const PRIORITIES = ['essential' => 'Essential', 'high' => 'High', 'medium' => 'Medium', 'low' => 'Low', 'optional' => 'Optional'];
    public const ITEM_STATUSES = ['planned' => 'Planned', 'approved' => 'Approved', 'ordered' => 'Ordered', 'purchased' => 'Purchased', 'rejected' => 'Rejected'];

    private ?array $cachedMetadata = null;

    public function __construct(private $db, private int $instance, private int $user, private string $currency) {}

    public static function id($value): int
    {
        if (!is_scalar($value) || !preg_match('/^[1-9][0-9]{0,9}$/D', (string)$value) || (int)$value > 2147483647) {
            throw new InvalidArgumentException('Invalid record ID.');
        }
        return (int)$value;
    }

    private function text(array $data, string $field, int $max = 12000, bool $required = false): string
    {
        $value = $data[$field] ?? '';
        if (!is_scalar($value)) throw new InvalidArgumentException('Invalid ' . $field . '.');
        $value = trim((string)$value);
        if (!mb_check_encoding($value, 'UTF-8') || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value) ||
            mb_strlen($value) > $max || ($required && $value === '')) {
            throw new InvalidArgumentException('Please enter a valid ' . $field . ' (maximum ' . $max . ' characters).');
        }
        return $value;
    }

    private function choice(array $data, string $field, array $choices): string
    {
        $value = $this->text($data, $field, 16, true);
        if (!isset($choices[$value])) throw new InvalidArgumentException('Invalid ' . $field . '.');
        return $value;
    }

    private function url(array $data, string $field): ?string
    {
        $url = $this->text($data, $field, 2048);
        if ($url === '') return null;
        $parts = parse_url($url);
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) ||
            isset($parts['user']) || isset($parts['pass'])) throw new InvalidArgumentException('Enter an HTTP or HTTPS ' . $field . '.');
        if ($field === 'image' && strtolower($parts['scheme']) !== 'https') throw new InvalidArgumentException('Image URLs must use HTTPS.');
        return $url;
    }

    public function price($value, string $currency): ?string
    {
        if ($value === null || $value === '') return null;
        if (!is_scalar($value)) throw new InvalidArgumentException('Invalid price.');
        $value = str_replace(',', '.', trim((string)$value));
        $currencies = new ISOCurrencies();
        $unit = new Currency($currency);
        $digits = $currencies->subunitFor($unit);
        $pattern = $digits ? '/^[0-9]{1,9}(?:\\.[0-9]{1,' . $digits . '})?$/D' : '/^[0-9]{1,9}$/D';
        if (!preg_match($pattern, $value)) throw new InvalidArgumentException('Enter a non-negative price with up to ' . $digits . ' decimal places, without thousands separators.');
        return (new DecimalMoneyParser($currencies))->parse($value, $unit)->getAmount();
    }

    private function quantity($value): string
    {
        if (!is_scalar($value)) throw new InvalidArgumentException('Invalid quantity.');
        $value = str_replace(',', '.', trim((string)$value));
        if (!preg_match('/^[0-9]{1,6}(?:\\.[0-9]{1,3})?$/D', $value) || (float)$value <= 0) {
            throw new InvalidArgumentException('Quantity must be greater than zero, below 1,000,000 and have at most three decimal places.');
        }
        return $value;
    }

    private function scope(string $table): void
    {
        $this->db->where($table . '.instances_id', $this->instance);
        $this->db->where($table . '.' . $table . '_deleted', 0);
    }

    public function get(int $id, bool $lock = false): array
    {
        $this->scope('shoppingLists');
        $this->db->where('shoppingLists_id', $id);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $list = $this->db->getOne('shoppingLists');
        if (!$list) throw new OutOfBoundsException('Shopping list not found.');
        return $list;
    }

    public function items(int $list): array
    {
        $this->scope('shoppingListItems');
        $this->db->where('shoppingLists_id', $list);
        $this->db->orderBy('shoppingListItems_order', 'ASC');
        $this->db->orderBy('shoppingListItems_id', 'ASC');
        return $this->db->get('shoppingListItems') ?: [];
    }

    private function item(int $list, int $id): array
    {
        $this->scope('shoppingListItems');
        $this->db->where('shoppingLists_id', $list);
        $this->db->where('shoppingListItems_id', $id);
        $item = $this->db->getOne('shoppingListItems');
        if (!$item) throw new OutOfBoundsException('Shopping item not found.');
        return $item;
    }

    public function metadata(): array
    {
        if ($this->cachedMetadata !== null) return $this->cachedMetadata;
        $this->db->where('(instances_id IS NULL OR instances_id = ?)', [$this->instance]);
        $this->db->orderBy('manufacturers_name', 'ASC');
        $manufacturers = $this->db->get('manufacturers', null, ['manufacturers_id', 'manufacturers_name']);
        $this->db->where('(assetCategories.instances_id IS NULL OR assetCategories.instances_id = ?)', [$this->instance]);
        $this->db->where('(assetCategoriesGroups.instances_id IS NULL OR assetCategoriesGroups.instances_id = ?)', [$this->instance]);
        $this->db->where('assetCategories_deleted', 0);
        $this->db->where('assetCategoriesGroups_deleted', 0);
        $this->db->join('assetCategoriesGroups', 'assetCategoriesGroups.assetCategoriesGroups_id=assetCategories.assetCategoriesGroups_id', 'INNER');
        $this->db->orderBy('assetCategoriesGroups_order', 'ASC');
        $this->db->orderBy('assetCategories_rank', 'ASC');
        $categories = $this->db->get('assetCategories', null, ['assetCategories_id', 'assetCategories_name', 'assetCategoriesGroups_name']);
        return $this->cachedMetadata = ['manufacturers' => $manufacturers ?: [], 'categories' => $categories ?: [],
            'statuses' => self::STATUSES, 'priorities' => self::PRIORITIES, 'itemStatuses' => self::ITEM_STATUSES];
    }

    private function reference(array $data, string $field, string $table): ?int
    {
        if (!isset($data[$field]) || $data[$field] === '') return null;
        $id = self::id($data[$field]);
        $meta = $this->metadata();
        $key = $table === 'manufacturers' ? 'manufacturers' : 'categories';
        if (!in_array($id, array_map('intval', array_column($meta[$key], $table . '_id')), true)) {
            throw new InvalidArgumentException('Manufacturer or category is unavailable in this business.');
        }
        return $id;
    }

    private function money($amount, string $currency): Money
    {
        return new Money((string)$amount, new Currency($currency));
    }

    private function formatted(Money $money): string
    {
        return (new IntlMoneyFormatter(new NumberFormatter('en_GB', NumberFormatter::CURRENCY), new ISOCurrencies()))->format($money);
    }

    private function decimal(Money $money): string
    {
        return (new DecimalMoneyFormatter(new ISOCurrencies()))->format($money);
    }

    public function document(int $id): array
    {
        $list = $this->get($id);
        return $this->enrich($list, $this->items($id));
    }

    private function enrich(array $list, array $items): array
    {
        $currency = $list['shoppingLists_currency'];
        $total = $this->money('0', $currency);
        $missing = 0;
        $excluded = 0;
        $meta = $this->metadata();
        $manufacturers = array_column($meta['manufacturers'], 'manufacturers_name', 'manufacturers_id');
        $categories = array_column($meta['categories'], 'assetCategories_name', 'assetCategories_id');
        foreach ($items as &$item) {
            $item['manufacturer'] = $manufacturers[$item['manufacturers_id']] ?? '';
            $item['category'] = $categories[$item['assetCategories_id']] ?? '';
            $price = $item['shoppingListItems_unitPrice'];
            $line = $price === null ? null : $this->money($price, $currency)->multiply($item['shoppingListItems_quantity'], Money::ROUND_HALF_UP);
            $item['unitPriceDecimal'] = $price === null ? '' : $this->decimal($this->money($price, $currency));
            $item['unitPriceFormatted'] = $price === null ? 'Not priced' : $this->formatted($this->money($price, $currency));
            $item['totalMinor'] = $line ? $line->getAmount() : null;
            $item['totalFormatted'] = $line ? $this->formatted($line) : 'Not priced';
            if ($item['shoppingListItems_status'] === 'rejected') $excluded++;
            elseif ($line) $total = $total->add($line);
            else $missing++;
        }
        unset($item);
        $budget = $list['shoppingLists_budget'] === null ? null : $this->money($list['shoppingLists_budget'], $currency);
        $list['items'] = $items;
        $list['itemCount'] = count($items);
        $list['missingPrices'] = $missing;
        $list['excludedItems'] = $excluded;
        $list['totalMinor'] = $total->getAmount();
        $list['totalFormatted'] = $this->formatted($total);
        $list['budgetDecimal'] = $budget ? $this->decimal($budget) : '';
        $list['budgetFormatted'] = $budget ? $this->formatted($budget) : null;
        $list['remainingFormatted'] = $budget ? $this->formatted($budget->subtract($total)) : null;
        $list['overBudget'] = $budget ? $total->greaterThan($budget) : false;
        $this->db->where('users_userid', $list['users_userid']);
        $creator = $this->db->getOne('users', ['users_name1', 'users_name2']);
        $list['creator'] = trim(($creator['users_name1'] ?? '') . ' ' . ($creator['users_name2'] ?? ''));
        return $list;
    }

    public function overview(): array
    {
        $this->scope('shoppingLists');
        $this->db->orderBy('shoppingLists_created', 'DESC');
        $this->db->orderBy('shoppingLists_id', 'DESC');
        $lists = $this->db->get('shoppingLists') ?: [];
        // Load child rows once instead of one query per list.
        $this->scope('shoppingListItems');
        $items = $this->db->get('shoppingListItems') ?: [];
        $byList = [];
        foreach ($items as $item) $byList[$item['shoppingLists_id']][] = $item;
        return array_map(fn($list) => $this->enrich($list, $byList[$list['shoppingLists_id']] ?? []), $lists);
    }

    private function insert(string $table, array $row): int
    {
        $id = $this->db->insert($table, $row);
        if (!$id) throw new RuntimeException('Could not save shopping data.');
        return (int)$id;
    }

    private function update(string $table, int $id, array $row): void
    {
        $this->scope($table);
        $this->db->where($table . '_id', $id);
        if (!$this->db->update($table, $row)) throw new RuntimeException('Could not update shopping data.');
    }

    /** Serialise list mutations, duplicate operations and reordering with the parent row lock. */
    public function mutate(string $action, array $data): int
    {
        $this->db->startTransaction();
        try {
            $id = isset($data['id']) && $data['id'] !== '' ? self::id($data['id']) : 0;
            $list = $id ? $this->get($id, true) : null;
            if ($action === 'saveList') {
                $currency = $list['shoppingLists_currency'] ?? $this->currency;
                $status = $this->choice($data, 'status', self::STATUSES);
                // Archiving has its own permission-protected action.
                if ($status === 'archived' && (!$list || $list['shoppingLists_status'] !== 'archived')) throw new InvalidArgumentException('Use Archive to archive a list.');
                $row = [
                    'shoppingLists_name' => $this->text($data, 'name', 255, true),
                    'shoppingLists_description' => $this->text($data, 'description'),
                    'shoppingLists_comment' => $this->text($data, 'comment'),
                    'shoppingLists_budget' => $this->price($data['budget'] ?? '', $currency),
                    'shoppingLists_status' => $status,
                    'shoppingLists_updated' => date('Y-m-d H:i:s'),
                ];
                if ($id) $this->update('shoppingLists', $id, $row);
                else $id = $this->insert('shoppingLists', $row + ['instances_id' => $this->instance, 'users_userid' => $this->user,
                    'shoppingLists_created' => date('Y-m-d H:i:s'), 'shoppingLists_currency' => $currency]);
            } else {
                if (!$list) throw new InvalidArgumentException('A shopping list is required.');
                if ($action === 'archiveList' || $action === 'deleteList') {
                    $this->update('shoppingLists', $id, $action === 'deleteList' ? ['shoppingLists_deleted' => 1] : ['shoppingLists_status' => 'archived']);
                } elseif ($action === 'duplicateList') {
                    $copy = $list;
                    unset($copy['shoppingLists_id']);
                    $copy['shoppingLists_name'] = mb_substr($copy['shoppingLists_name'], 0, 248) . ' (copy)';
                    $copy['shoppingLists_status'] = 'draft';
                    $copy['shoppingLists_created'] = $copy['shoppingLists_updated'] = date('Y-m-d H:i:s');
                    $copy['users_userid'] = $this->user;
                    $newId = $this->insert('shoppingLists', $copy);
                    foreach ($this->items($id) as $item) {
                        unset($item['shoppingListItems_id']);
                        $item['shoppingLists_id'] = $newId;
                        $this->insert('shoppingListItems', $item);
                    }
                    $id = $newId;
                } elseif ($action === 'saveItem') {
                    $itemId = empty($data['itemId']) ? 0 : self::id($data['itemId']);
                    if ($itemId) $this->item($id, $itemId);
                    $row = [
                        'shoppingListItems_name' => $this->text($data, 'name', 255, true),
                        'manufacturers_id' => $this->reference($data, 'manufacturerId', 'manufacturers'),
                        'assetCategories_id' => $this->reference($data, 'categoryId', 'assetCategories'),
                        'shoppingListItems_model' => $this->text($data, 'model', 255),
                        'shoppingListItems_description' => $this->text($data, 'description'),
                        'shoppingListItems_quantity' => $this->quantity($data['quantity'] ?? ''),
                        'shoppingListItems_unit' => $this->text($data, 'unit', 40),
                        'shoppingListItems_unitPrice' => $this->price($data['unitPrice'] ?? '', $list['shoppingLists_currency']),
                        'shoppingListItems_supplier' => $this->text($data, 'supplier', 255),
                        'shoppingListItems_sku' => $this->text($data, 'sku', 255),
                        'shoppingListItems_url' => $this->url($data, 'url'),
                        'shoppingListItems_image' => $this->url($data, 'image'),
                        'shoppingListItems_notes' => $this->text($data, 'notes'),
                        'shoppingListItems_priority' => $this->choice($data, 'priority', self::PRIORITIES),
                        'shoppingListItems_reason' => $this->text($data, 'reason'),
                        'shoppingListItems_status' => $this->choice($data, 'status', self::ITEM_STATUSES),
                    ];
                    if ($itemId) $this->update('shoppingListItems', $itemId, $row);
                    else {
                        $items = $this->items($id);
                        $order = $items ? max(array_column($items, 'shoppingListItems_order')) + 1 : 0;
                        $this->insert('shoppingListItems', $row + ['instances_id' => $this->instance, 'shoppingLists_id' => $id, 'shoppingListItems_order' => $order]);
                    }
                } elseif ($action === 'deleteItem' || $action === 'duplicateItem') {
                    $item = $this->item($id, self::id($data['itemId'] ?? null));
                    if ($action === 'deleteItem') $this->update('shoppingListItems', (int)$item['shoppingListItems_id'], ['shoppingListItems_deleted' => 1]);
                    else {
                        unset($item['shoppingListItems_id']);
                        $items = $this->items($id);
                        $item['shoppingListItems_order'] = max(array_column($items, 'shoppingListItems_order')) + 1;
                        $this->insert('shoppingListItems', $item);
                    }
                } elseif ($action === 'reorder') {
                    $order = $data['order'] ?? null;
                    if (!is_array($order)) throw new InvalidArgumentException('Invalid item order.');
                    $order = array_map([self::class, 'id'], $order);
                    $actual = array_map('intval', array_column($this->items($id), 'shoppingListItems_id'));
                    $sorted = $order;
                    sort($sorted);
                    sort($actual);
                    if ($sorted !== $actual) throw new InvalidArgumentException('Item order must contain each current item exactly once. Reload and try again.');
                    foreach ($order as $position => $itemId) $this->update('shoppingListItems', $itemId, ['shoppingListItems_order' => $position]);
                } else throw new InvalidArgumentException('Unknown shopping action.');
                $this->update('shoppingLists', $id, ['shoppingLists_updated' => date('Y-m-d H:i:s')]);
            }
            $this->db->commit();
            return $id;
        } catch (Throwable $error) {
            $this->db->rollback();
            throw $error;
        }
    }
}
