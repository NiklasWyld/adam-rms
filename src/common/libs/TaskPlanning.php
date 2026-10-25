<?php
declare(strict_types=1);

/** Business-scoped task planning. Dates are wall-clock values in the business planning timezone. */
final class TaskPlanning
{
    public const STATUSES = ['open' => 'Open', 'progress' => 'In progress', 'blocked' => 'Blocked', 'done' => 'Done'];
    public const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
    public function __construct(private $db, public readonly int $instance, public readonly int $user) {}
    public static function id($value): int
    {
        if ((!is_string($value) && !is_int($value)) || !preg_match('/^[1-9][0-9]{0,9}$/D', (string)$value) || (int)$value > 2147483647) throw new InvalidArgumentException('Invalid record ID.');
        return (int)$value;
    }
    public static function text($value, int $limit, bool $required = false): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $limit ||
            preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value) || ($required && trim($value) === '')) throw new InvalidArgumentException('Enter valid text (maximum ' . $limit . ' characters).');
        return trim($value);
    }
    public static function json($value): array
    {
        if (!is_string($value) || strlen($value) > 2000000) throw new InvalidArgumentException('Invalid task data.');
        try { $data = json_decode($value, true, 32, JSON_THROW_ON_ERROR); } catch (JsonException $e) { throw new InvalidArgumentException('Invalid task data.'); }
        if (!is_array($data)) throw new InvalidArgumentException('Expected task data.');
        return $data;
    }
    public static function date($value, string $format = 'Y-m-d'): ?string
    {
        if ($value === '' || $value === null) return null;
        if (!is_string($value)) throw new InvalidArgumentException('Invalid date.');
        $d = DateTimeImmutable::createFromFormat('!' . $format, $value);
        if (!$d || $d->format($format) !== $value || ($format !== 'H:i' && ($d->format('Y') < '2000' || $d->format('Y') > '2200'))) throw new InvalidArgumentException('Enter a valid date between 2000 and 2200.');
        return $value;
    }
    public function scope(string $table, bool $deleted = true): void
    {
        $this->db->where($table . '.instances_id', $this->instance);
        if ($deleted) $this->db->where($table . '.' . $table . '_deleted', 0);
    }
    public function project(int $id, bool $edit = false, bool $lock = false): array
    {
        $this->scope('projects'); $this->db->where('projects_id', $id);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $row = $this->db->getOne('projects', ['projects_id', 'projects_name', 'projects_archived', 'projects_dates_use_start']);
        if (!$row) throw new OutOfBoundsException('Project not found in this business.');
        if ($edit && $row['projects_archived']) throw new DomainException('Archived projects are read-only.');
        return $row;
    }
    public function members(): array
    {
        $this->db->join('instancePositions', 'instancePositions.instancePositions_id=userInstances.instancePositions_id', 'INNER');
        $this->db->where('instancePositions.instances_id', $this->instance); $this->db->where('userInstances_deleted', 0);
        $this->db->where('(userInstances_archived IS NULL OR userInstances_archived >= ?)', [date('Y-m-d H:i:s')]);
        $this->db->where('users_deleted', 0);
        $this->db->join('users', 'users.users_userid=userInstances.users_userid', 'INNER');
        $this->db->orderBy('users_name1', 'ASC');
        return $this->db->get('userInstances', null, ['users.users_userid AS id', "CONCAT(users_name1, ' ', users_name2) AS name"]) ?: [];
    }
    private function category(string $name): ?int
    {
        if ($name === '') return null;
        // The unique key also protects category creation from concurrent requests in different projects.
        $this->db->onDuplicate(['taskCategories_name']);
        if ($this->db->insert('taskCategories', ['instances_id' => $this->instance, 'taskCategories_name' => $name]) === false) throw new RuntimeException('Category save failed.');
        $this->scope('taskCategories'); $this->db->where('taskCategories_name', $name);
        return (int)$this->db->getValue('taskCategories', 'taskCategories_id');
    }
    public static function checklist($items): array
    {
        if (!is_array($items) || !array_is_list($items) || count($items) > 500) throw new InvalidArgumentException('Use up to 500 checklist items.');
        $result = []; $seen = [];
        foreach ($items as $item) {
            if (!is_array($item)) throw new InvalidArgumentException('Invalid checklist item.');
            $id = $item['id'] ?? bin2hex(random_bytes(12));
            if (!is_string($id) || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $id) || isset($seen[$id])) throw new InvalidArgumentException('Invalid checklist ID.');
            if (isset($item['done']) && !is_bool($item['done'])) throw new InvalidArgumentException('Invalid checklist completion.');
            $seen[$id] = true;
            $result[] = ['id' => $id, 'title' => self::text($item['title'] ?? '', 500, true), 'done' => ($item['done'] ?? false)];
        }
        return $result;
    }
    public function normalise(array $d): array
    {
        $allowed = ['title', 'description', 'category', 'day', 'time', 'deadline', 'assignee', 'priority', 'status', 'checklist', 'project', 'order'];
        if (array_diff(array_keys($d), $allowed)) throw new InvalidArgumentException('Unknown task property.');
        $out = [];
        foreach ($d as $key => $v) {
            switch ($key) {
                case 'title': $v = self::text($v, 500, true); break;
                case 'description': $v = self::text($v, 12000); break;
                case 'category': $key = 'taskCategories_id'; $v = $this->category(self::text($v, 120)); break;
                case 'day': $v = self::date($v); break;
                case 'time': $v = self::date($v, 'H:i'); break;
                case 'deadline': $v = self::date($v, 'Y-m-d\TH:i'); if ($v) $v = str_replace('T', ' ', $v) . ':00'; break;
                case 'assignee':
                    $key = 'users_userid'; $v = $v === '' || $v === null ? null : self::id($v);
                    if ($v !== null && !in_array($v, array_map('intval', array_column($this->members(), 'id')), true)) throw new InvalidArgumentException('Choose an active user in this business.');
                    break;
                case 'priority': if (!in_array($v, [0, 1, 2, 3], true)) throw new InvalidArgumentException('Invalid priority.'); break;
                case 'status': if (!is_string($v) || !isset(self::STATUSES[$v])) throw new InvalidArgumentException('Invalid status.'); break;
                case 'checklist': $v = json_encode(self::checklist($v), JSON_THROW_ON_ERROR); break;
                case 'project': $key = 'projects_id'; $v = self::id($v); $this->project($v, true); break;
                case 'order': if (!is_int($v) || $v < 0 || $v > 2147480000) throw new InvalidArgumentException('Invalid task order.'); break;
            }
            $out[in_array($key, ['taskCategories_id', 'users_userid', 'projects_id'], true) ? $key : 'planningTasks_' . $key] = $v;
        }
        return $out;
    }
    private function describe(array $r): array
    {
        return ['id' => (int)$r['planningTasks_id'], 'project' => (int)$r['projects_id'], 'projectName' => $r['projects_name'],
            'archived' => (bool)$r['projects_archived'], 'title' => $r['planningTasks_title'], 'description' => $r['planningTasks_description'] ?? '',
            'category' => $r['taskCategories_name'] ?? '', 'day' => $r['planningTasks_day'],
            'time' => $r['planningTasks_time'] ? substr($r['planningTasks_time'], 0, 5) : null,
            'deadline' => $r['planningTasks_deadline'] ? str_replace(' ', 'T', substr($r['planningTasks_deadline'], 0, 16)) : null,
            'assignee' => $r['users_userid'] ? (int)$r['users_userid'] : null, 'assigneeName' => trim(($r['users_name1'] ?? '') . ' ' . ($r['users_name2'] ?? '')),
            'priority' => (int)$r['planningTasks_priority'], 'status' => $r['planningTasks_status'],
            'checklist' => json_decode($r['planningTasks_checklist'] ?: '[]', true), 'order' => (int)$r['planningTasks_order'],
            'revision' => (int)$r['planningTasks_revision']];
    }
    public function tasks(?int $project): array
    {
        if ($project !== null) $this->project($project);
        $this->scope('planningTasks');
        $this->db->join('projects', 'projects.projects_id=planningTasks.projects_id AND projects.instances_id=planningTasks.instances_id AND projects.projects_deleted=0', 'INNER');
        $this->db->join('taskCategories', 'taskCategories.taskCategories_id=planningTasks.taskCategories_id AND taskCategories.instances_id=planningTasks.instances_id', 'LEFT');
        $this->db->join('users', 'users.users_userid=planningTasks.users_userid', 'LEFT');
        if ($project !== null) $this->db->where('planningTasks.projects_id', $project);
        else $this->db->where('planningTasks.users_userid', $this->user);
        $this->db->orderBy('planningTasks_order', 'ASC'); $this->db->orderBy('planningTasks_id', 'ASC');
        return array_map(fn($r) => $this->describe($r), $this->db->get('planningTasks', null, ['planningTasks.*', 'projects.projects_name', 'projects.projects_archived', 'taskCategories.taskCategories_name', 'users.users_name1', 'users.users_name2']) ?: []);
    }
    public static function filter(array $tasks, array $f): array
    {
        $from = self::date($f['from'] ?? ''); $to = self::date($f['to'] ?? '');
        if ($from && $to && $from > $to) throw new InvalidArgumentException('The end date must be on or after the start date.');
        $q = mb_strtolower(self::text($f['search'] ?? '', 500));
        foreach (['categories', 'priorities', 'statuses', 'assignees'] as $key) {
            if (isset($f[$key]) && (!is_array($f[$key]) || count($f[$key]) > 500 || count(array_filter($f[$key], fn($v) => !is_scalar($v))) > 0)) throw new InvalidArgumentException('Invalid filters.');
        }
        $rows = array_values(array_filter($tasks, function ($t) use ($f, $from, $to, $q) {
            if ($from && (!$t['day'] || $t['day'] < $from)) return false;
            if ($to && (!$t['day'] || $t['day'] > $to)) return false;
            foreach (['categories' => 'category', 'priorities' => 'priority', 'statuses' => 'status', 'assignees' => 'assignee'] as $filter => $key) {
                if (!empty($f[$filter]) && !in_array((string)($t[$key] ?? ''), array_map('strval', $f[$filter]), true)) return false;
            }
            return !$q || str_contains(mb_strtolower(implode(' ', [$t['title'], $t['description'], $t['category'], $t['projectName'], $t['assigneeName'], implode(' ', array_column($t['checklist'], 'title'))])), $q);
        }));
        $sort = $f['sort'] ?? 'manual'; $group = $f['group'] ?? '';
        if (!in_array($sort, ['manual', 'date', 'priority', 'category'], true) || !in_array($group, ['', 'day', 'category'], true)) throw new InvalidArgumentException('Invalid sorting or grouping.');
        usort($rows, function ($a, $b) use ($sort, $group) {
            $cmp = $group ? strcmp($a[$group] ?: "\xFF", $b[$group] ?: "\xFF") : 0;
            if ($cmp) return $cmp;
            $cmp = match ($sort) { 'date' => strcmp(($a['day'] ?: '9999') . ($a['time'] ?: ''), ($b['day'] ?: '9999') . ($b['time'] ?: '')),
                'priority' => $b['priority'] <=> $a['priority'], 'category' => strnatcasecmp($a['category'], $b['category']), default => $a['order'] <=> $b['order'] };
            return $cmp ?: $a['id'] <=> $b['id'];
        });
        return $rows;
    }
    public function document(?int $project): array
    {
        $this->scope('taskCategories'); $this->db->orderBy('taskCategories_name', 'ASC');
        $categories = $this->db->get('taskCategories') ?: [];
        $this->scope('taskTemplates'); $this->db->orderBy('taskTemplates_name', 'ASC');
        $templates = $this->db->get('taskTemplates') ?: [];
        foreach ($templates as &$t) $t['items'] = json_decode($t['taskTemplates_items'], true);
        $this->scope('taskSavedFilters'); $this->db->where('users_userid', $this->user);
        $filters = $this->db->get('taskSavedFilters') ?: [];
        foreach ($filters as &$f) $f['value'] = json_decode($f['taskSavedFilters_value'], true);
        $this->scope('projects'); $this->db->where('projects_archived', 0); $this->db->orderBy('projects_name', 'ASC');
        $projects = $this->db->get('projects', null, ['projects_id AS id', 'projects_name AS name']) ?: [];
        $this->db->where('instances_id', $this->instance);
        $zone = $this->db->getValue('instances', 'instances_config_roomPlanningTimezone') ?: 'Europe/Berlin';
        return ['project' => $project ? $this->project($project) : null, 'tasks' => $this->tasks($project), 'members' => $this->members(),
            'categories' => array_column($categories, 'taskCategories_name'), 'templates' => $templates, 'filters' => $filters,
            'projects' => $projects, 'statuses' => self::STATUSES, 'priorities' => self::PRIORITIES, 'user' => $this->user, 'timeZone' => $zone];
    }
    private function task(int $id, ?int $project): array
    {
        $this->scope('planningTasks'); $this->db->where('planningTasks_id', $id);
        if ($project !== null) $this->db->where('projects_id', $project); else $this->db->where('users_userid', $this->user);
        $this->db->setQueryOption('FOR UPDATE'); $row = $this->db->getOne('planningTasks');
        if (!$row) throw new OutOfBoundsException('Task not found in this view.');
        $this->project((int)$row['projects_id'], true);
        return $row;
    }
    private function revision(array $row, $revision, string $table): void
    {
        if (!is_int($revision) || $revision !== (int)$row[$table . '_revision']) throw new DomainException('This item changed in another tab. Your edits are kept here. Reload the current version before trying again.');
    }
    private function validateSchedule(array $row): void
    {
        $this->db->where('instances_id', $this->instance);
        $zone = new DateTimeZone($this->db->getValue('instances', 'instances_config_roomPlanningTimezone') ?: 'Europe/Berlin');
        $scheduled = !empty($row['planningTasks_day']) && !empty($row['planningTasks_time']) ? $row['planningTasks_day'] . 'T' . substr($row['planningTasks_time'], 0, 5) : null;
        $deadline = !empty($row['planningTasks_deadline']) ? str_replace(' ', 'T', substr($row['planningTasks_deadline'], 0, 16)) : null;
        foreach (array_filter([$scheduled, $deadline]) as $value) {
            $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $value, $zone);
            if (!$date || $date->format('Y-m-d\TH:i') !== $value) throw new InvalidArgumentException('This time does not exist in ' . $zone->getName() . ' because the clocks change. Choose another time.');
        }
    }
    private function insert(int $project, array $data): int
    {
        $data['title'] = $data['title'] ?? ''; $data['project'] = $project;
        $row = $this->normalise($data);
        if (!empty($row['planningTasks_time']) && empty($row['planningTasks_day'])) throw new InvalidArgumentException('Choose a planned day before adding a time.');
        $this->validateSchedule($row);
        $row += ['instances_id' => $this->instance, 'planningTasks_created' => gmdate('Y-m-d H:i:s'), 'planningTasks_updated' => gmdate('Y-m-d H:i:s'), 'planningTasks_updatedBy' => $this->user];
        $id = $this->db->insert('planningTasks', $row);
        if (!$id) throw new RuntimeException('Task insert failed.');
        // Stable default ordering without reading MAX() in concurrent quick-add requests.
        if (!isset($data['order'])) { $this->scope('planningTasks'); $this->db->where('planningTasks_id', $id); $this->must($this->db->update('planningTasks', ['planningTasks_order' => (int)$id])); }
        return (int)$id;
    }
    private function must($ok): void { if ($ok === false) throw new RuntimeException('Task storage failed.'); }
    public function template(int $id, bool $lock = false): array
    {
        $this->scope('taskTemplates'); $this->db->where('taskTemplates_id', $id);
        if ($lock) $this->db->setQueryOption('FOR UPDATE');
        $t = $this->db->getOne('taskTemplates');
        if (!$t) throw new OutOfBoundsException('Task package not found.');
        return $t;
    }
    public static function templateItems($items): array
    {
        if (!is_array($items) || !array_is_list($items) || !$items || count($items) > 2000) throw new InvalidArgumentException('A package needs 1–2000 tasks.');
        $result = [];
        foreach ($items as $i) {
            if (!is_array($i)) throw new InvalidArgumentException('Invalid package task.');
            $r = ['title' => self::text($i['title'] ?? '', 500, true), 'description' => self::text($i['description'] ?? '', 12000),
                'category' => self::text($i['category'] ?? '', 120), 'priority' => $i['priority'] ?? 1, 'checklist' => self::checklist($i['checklist'] ?? [])];
            if (!in_array($r['priority'], [0, 1, 2, 3], true)) throw new InvalidArgumentException('Invalid package priority.');
            foreach (['offset', 'deadlineOffset'] as $key) {
                $v = $i[$key] ?? null;
                if ($v !== null && (!is_int($v) || abs($v) > 3650)) throw new InvalidArgumentException('Relative days must be between -3650 and 3650.');
                $r[$key] = $v;
            }
            $r['time'] = self::date($i['time'] ?? null, 'H:i');
            if ($r['time'] && $r['offset'] === null) throw new InvalidArgumentException('A package time needs relative days.');
            $result[] = $r;
        }
        return $result;
    }
    public function preview(int $id, int $project, ?string $base): array
    {
        $p = $this->project($project); $t = $this->template($id);
        $items = json_decode($t['taskTemplates_items'], true);
        $base = self::date($base ?: ($p['projects_dates_use_start'] ? substr($p['projects_dates_use_start'], 0, 10) : null));
        if (!$base && array_filter($items, fn($i) => $i['offset'] !== null || $i['deadlineOffset'] !== null)) throw new InvalidArgumentException('Choose a reference date for this package.');
        foreach ($items as $index => &$i) {
            $i['index'] = $index;
            foreach (['offset' => 'day', 'deadlineOffset' => 'deadline'] as $key => $dest) {
                $i[$dest] = $i[$key] !== null ? (new DateTimeImmutable($base))->modify(sprintf('%+d days', $i[$key]))->format('Y-m-d') : null;
                if ($i[$dest]) self::date($i[$dest]);
            }
            if ($i['deadline']) $i['deadline'] .= 'T23:59';
        }
        return ['items' => $items, 'revision' => (int)$t['taskTemplates_revision'], 'base' => $base];
    }
    /** Atomic mutations and idempotent retries: a dropped response cannot duplicate pasted tasks/packages. */
    public function mutate(string $action, ?int $project, array $d, string $key, callable $audit): array
    {
        if (!preg_match('/^[a-zA-Z0-9_-]{16,64}$/D', $key)) throw new InvalidArgumentException('Missing save request ID.');
        $hash = hash('sha256', json_encode([$action, $project, $d], JSON_THROW_ON_ERROR));
        $this->db->startTransaction();
        try {
            // Serialises writes by the same actor and safely handles repeated request IDs.
            $this->db->where('users_userid', $this->user); $this->db->setQueryOption('FOR UPDATE'); $this->db->getOne('users', ['users_userid']);
            $this->scope('taskOperations', false); $this->db->where('users_userid', $this->user); $this->db->where('taskOperations_key', $key);
            $op = $this->db->getOne('taskOperations');
            if ($op) {
                if (!hash_equals($op['taskOperations_hash'], $hash)) throw new DomainException('This save ID was already used for a different edit.');
                $this->db->commit(); return json_decode($op['taskOperations_result'], true);
            }
            $ids = [];
            if ($project !== null) $this->project($project, !in_array($action, ['saveFilter', 'deleteFilter', 'saveTemplate', 'deleteTemplate'], true), true);
            if ($action === 'create') {
                $target = $project ?? self::id($d['project'] ?? null); $this->project($target, true, true);
                $items = $d['items'] ?? [];
                if (!is_array($items) || !array_is_list($items) || !$items || count($items) > 500) throw new InvalidArgumentException('Paste 1–500 task titles at a time.');
                foreach ($items as $item) {
                    if (!is_array($item)) throw new InvalidArgumentException('Invalid task.');
                    if ($project === null) $item['assignee'] = $this->user;
                    $ids[] = $this->insert($target, $item);
                }
            } elseif (in_array($action, ['update', 'delete', 'reorder'], true)) {
                $items = $d['items'] ?? [];
                if (!is_array($items) || !array_is_list($items) || !$items || count($items) > 2000) throw new InvalidArgumentException('Select tasks to change.');
                $seen = [];
                foreach ($items as $item) {
                    if (!is_array($item)) throw new InvalidArgumentException('Invalid task edit.');
                    $id = self::id($item['id'] ?? null); if (isset($seen[$id])) throw new InvalidArgumentException('A task was selected twice.'); $seen[$id] = true;
                    $old = $this->task($id, $project); $this->revision($old, $item['revision'] ?? null, 'planningTasks');
                    $patch = $action === 'delete' ? ['planningTasks_deleted' => 1] : $this->normalise($item['patch'] ?? []);
                    if ($action === 'reorder' && array_keys($patch) !== ['planningTasks_order']) throw new InvalidArgumentException('Invalid reorder.');
                    $day = $patch['planningTasks_day'] ?? $old['planningTasks_day'];
                    $time = array_key_exists('planningTasks_time', $patch) ? $patch['planningTasks_time'] : $old['planningTasks_time'];
                    if (array_key_exists('planningTasks_day', $patch) && !$patch['planningTasks_day']) { $patch['planningTasks_time'] = null; $time = null; }
                    if ($time && !$day) throw new InvalidArgumentException('Choose a day before adding a time.');
                    $this->validateSchedule(array_replace($old, $patch));
                    $patch += ['planningTasks_revision' => (int)$old['planningTasks_revision'] + 1, 'planningTasks_updated' => gmdate('Y-m-d H:i:s'), 'planningTasks_updatedBy' => $this->user];
                    $this->scope('planningTasks'); $this->db->where('planningTasks_id', $id); $this->must($this->db->update('planningTasks', $patch)); $ids[] = $id;
                }
            } elseif ($action === 'saveTemplate' || $action === 'deleteTemplate') {
                $id = empty($d['id']) ? null : self::id($d['id']);
                if ($id) { $old = $this->template($id, true); $this->revision($old, $d['revision'] ?? null, 'taskTemplates'); }
                if ($action === 'deleteTemplate') {
                    if (!$id) throw new InvalidArgumentException('Select a package.');
                    $row = ['taskTemplates_deleted' => 1];
                } else {
                    $row = ['taskTemplates_name' => self::text($d['name'] ?? '', 160, true),
                        'taskTemplates_items' => json_encode(self::templateItems($d['items'] ?? []), JSON_THROW_ON_ERROR)];
                }
                $row += ['taskTemplates_updated' => gmdate('Y-m-d H:i:s'), 'users_userid' => $this->user, 'taskTemplates_revision' => $id ? (int)$old['taskTemplates_revision'] + 1 : 1];
                if ($id) { $this->scope('taskTemplates'); $this->db->where('taskTemplates_id', $id); $this->must($this->db->update('taskTemplates', $row)); }
                else { $id = $this->db->insert('taskTemplates', $row + ['instances_id' => $this->instance]); if (!$id) throw new RuntimeException('Package save failed.'); }
                $ids[] = (int)$id;
            } elseif ($action === 'applyTemplate') {
                if ($project === null) throw new InvalidArgumentException('Open a project to add a task package.');
                $preview = $this->preview(self::id($d['id'] ?? null), $project, $d['base'] ?? null);
                if ($preview['revision'] !== ($d['revision'] ?? null)) throw new DomainException('The package changed. Preview it again.');
                $selected = $d['selected'] ?? [];
                if (!is_array($selected) || !array_is_list($selected) || !$selected || count($selected) !== count(array_unique($selected))) throw new InvalidArgumentException('Select tasks to insert.');
                foreach ($selected as $index) {
                    if (!is_int($index) || !isset($preview['items'][$index])) throw new InvalidArgumentException('Invalid package selection.');
                    $item = $preview['items'][$index]; unset($item['index'], $item['offset'], $item['deadlineOffset']);
                    $ids[] = $this->insert($project, $item);
                }
            } elseif ($action === 'saveFilter' || $action === 'deleteFilter') {
                if ($action === 'saveFilter') {
                    $value = $d['value'] ?? []; if (!is_array($value)) throw new InvalidArgumentException('Invalid filter.');
                    self::filter([], $value);
                    $id = $this->db->insert('taskSavedFilters', ['instances_id' => $this->instance, 'users_userid' => $this->user, 'taskSavedFilters_name' => self::text($d['name'] ?? '', 120, true), 'taskSavedFilters_value' => json_encode($value, JSON_THROW_ON_ERROR)]);
                    if (!$id) throw new RuntimeException('Filter save failed.'); $ids[] = (int)$id;
                } else {
                    $this->scope('taskSavedFilters'); $this->db->where('users_userid', $this->user); $this->db->where('taskSavedFilters_id', self::id($d['id'] ?? null));
                    $this->must($this->db->update('taskSavedFilters', ['taskSavedFilters_deleted' => 1]));
                }
            } else throw new InvalidArgumentException('Unknown task action.');
            $audit($ids);
            $this->must($this->db->insert('taskOperations', ['instances_id' => $this->instance, 'users_userid' => $this->user,
                'taskOperations_key' => $key, 'taskOperations_hash' => $hash, 'taskOperations_result' => json_encode($ids, JSON_THROW_ON_ERROR)]));
            $this->db->commit(); return $ids;
        } catch (Throwable $e) { $this->db->rollback(); throw $e; }
    }
}
