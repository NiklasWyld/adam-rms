<?php
declare(strict_types=1);
require_once __DIR__ . '/TaskTickSettings.php';

final class TaskTickTickHttpError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}

/** Official TickTick Open API only. The transport seam is used by isolated contract tests. */
final class TaskTickTick
{
    private $transport;
    private TaskTickSettings $settings;
    public function __construct(private $db, private TaskPlanning $tasks, ?callable $transport = null)
    {
        $this->transport = $transport;
        $this->settings = new TaskTickSettings($db, $tasks->instance, $tasks->user);
    }
    public function configured(): bool { return $this->settings->configured(); }
    private function app(): array
    {
        $app = $this->settings->credentials();
        if (!$app || !TaskPlanningSecrets::ready()) throw new DomainException('Ask a business administrator to configure TickTick in Business Settings before connecting your account.');
        return $app;
    }
    public static function seal(string $token): string
    {
        return TaskPlanningSecrets::encrypt($token, 'AdamRMS Task Planning');
    }
    private static function unseal(string $stored): string
    {
        return TaskPlanningSecrets::decrypt($stored, 'AdamRMS Task Planning');
    }
    private function own(string $table): void { $this->tasks->scope($table, false); $this->db->where('users_userid', $this->tasks->user); }
    public function status(?int $project): array
    {
        $this->own('taskTickConnections'); $c = $this->db->getOne('taskTickConnections');
        $this->own('taskTickTasks'); $maps = $this->db->get('taskTickTasks', null, ['planningTasks_id', 'taskTickTasks_state', 'taskTickTasks_synced', 'taskTickTasks_error']) ?: [];
        // Only disclose mapping metadata for tasks visible in this project/My Tasks view.
        $visible = array_column($this->tasks->tasks($project), 'id');
        $maps = array_values(array_filter($maps, fn($m) => in_array((int)$m['planningTasks_id'], $visible, true)));
        $p = null;
        if ($project) { $this->own('taskTickProjects'); $this->db->where('projects_id', $project); $p = $this->db->getOne('taskTickProjects', ['taskTickProjects_synced', 'taskTickProjects_error']); }
        return ['configured' => $this->configured(), 'connected' => !empty($c['taskTickConnections_token']),
            'expires' => $c['taskTickConnections_expires'] ?? null, 'tasks' => $maps, 'project' => $p];
    }
    public function authorise(?int $project): string
    {
        $app = $this->app();
        $state = bin2hex(random_bytes(32));
        $_SESSION['taskTickOAuth'] = ['hash' => hash('sha256', $state), 'until' => time() + 600,
            'instance' => $this->tasks->instance, 'user' => $this->tasks->user, 'project' => $project,
            'app' => TaskTickSettings::fingerprint($app)];
        return 'https://ticktick.com/oauth/authorize?' . http_build_query(['client_id' => $app['clientId'], 'scope' => 'tasks:read tasks:write', 'state' => $state, 'redirect_uri' => $app['redirect'], 'response_type' => 'code']);
    }
    public function callback(string $state, string $code): ?int
    {
        $o = $_SESSION['taskTickOAuth'] ?? []; unset($_SESSION['taskTickOAuth']);
        $lock = TaskTickSettings::lockName($this->tasks->instance);
        if ((int)$this->db->rawQueryValue('SELECT GET_LOCK(?, 0) LIMIT 1', [$lock]) !== 1) throw new DomainException('TickTick settings are busy. Connect again when the current operation finishes.');
        try {
            $app = $this->app();
            if (!isset($o['hash'], $o['app']) || !hash_equals($o['hash'], hash('sha256', $state)) || $o['until'] < time() ||
                $o['instance'] !== $this->tasks->instance || $o['user'] !== $this->tasks->user ||
                !hash_equals($o['app'], TaskTickSettings::fingerprint($app))) throw new DomainException('The TickTick connection request expired, its app settings changed, or it belongs to another session/business. Connect again.');
            if (!$code || strlen($code) > 2000) throw new InvalidArgumentException('TickTick did not return an authorisation code.');
            $response = $this->http('POST', 'https://ticktick.com/oauth/token', ['code' => $code, 'grant_type' => 'authorization_code', 'scope' => 'tasks:read tasks:write', 'redirect_uri' => $app['redirect']], null, true);
            $token = $response['access_token'] ?? null;
            if (!is_string($token) || !$token || strlen($token) > 16000 || preg_match('/[\r\n\x00]/', $token)) throw new DomainException('TickTick returned no valid access token. Connect again.');
            $row = ['instances_id' => $this->tasks->instance, 'users_userid' => $this->tasks->user, 'taskTickConnections_token' => self::seal($token),
                'taskTickConnections_expires' => isset($response['expires_in']) && is_numeric($response['expires_in']) ? gmdate('Y-m-d H:i:s', time() + (int)$response['expires_in']) : null];
            $this->db->onDuplicate(['taskTickConnections_token', 'taskTickConnections_expires']);
            $this->must($this->db->insert('taskTickConnections', $row));
            return $o['project'];
        } finally { $this->db->rawQueryValue('SELECT RELEASE_LOCK(?) LIMIT 1', [$lock]); }
    }
    private function token(): string
    {
        $this->own('taskTickConnections'); $c = $this->db->getOne('taskTickConnections');
        if (empty($c['taskTickConnections_token'])) throw new DomainException('Connect your TickTick account first.');
        if ($c['taskTickConnections_expires'] && $c['taskTickConnections_expires'] <= gmdate('Y-m-d H:i:s')) throw new DomainException('Your TickTick authorisation expired. Connect again.');
        return self::unseal($c['taskTickConnections_token']);
    }
    public function disconnect(): void
    {
        $this->own('taskTickConnections');
        $this->must($this->db->update('taskTickConnections', ['taskTickConnections_token' => null, 'taskTickConnections_expires' => null]));
        // Local unlink always works. Users can revoke the app in TickTick as well; mappings remain for safe reconnects.
        unset($_SESSION['taskTickOAuth']);
    }
    private function http(string $method, string $url, ?array $body, ?string $token, bool $oauth = false): array
    {
        if ($this->transport) return ($this->transport)($method, $url, $body);
        $ch = curl_init($url);
        $headers = ['Accept: application/json'];
        if ($token) $headers[] = 'Authorization: Bearer ' . $token;
        if ($body !== null) $headers[] = $oauth ? 'Content-Type: application/x-www-form-urlencoded' : 'Content-Type: application/json';
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 25, CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $oauth ? http_build_query($body) : json_encode($body, JSON_THROW_ON_ERROR));
        if ($oauth) { $app = $this->app(); curl_setopt($ch, CURLOPT_USERPWD, $app['clientId'] . ':' . $app['secret']); }
        $raw = curl_exec($ch); $status = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($raw === false) throw new RuntimeException('TickTick could not be reached. An uncertain create will be reconciled before any retry.');
        if ($status === 401 || $status === 403) throw new TaskTickTickHttpError($status, 'TickTick access was denied. Reconnect the same account and check list permissions.');
        if ($status === 429) throw new TaskTickTickHttpError($status, 'TickTick rate limit reached. Wait a moment before synchronising again.');
        if ($status === 404) throw new TaskTickTickHttpError($status, 'The linked TickTick list or task is missing. Restore it in TickTick; it will not be recreated automatically.');
        if ($status < 200 || $status >= 300) throw new TaskTickTickHttpError($status, 'TickTick rejected the request (HTTP ' . $status . '). Your RMS tasks are safe.');
        if ($raw === '') return [];
        $data = json_decode($raw, true);
        if (!is_array($data)) throw new RuntimeException('TickTick returned an invalid response.');
        return $data;
    }
    private function api(string $method, string $path, ?array $body, string $token): array { return $this->http($method, 'https://api.ticktick.com/open/v1' . $path, $body, $token); }
    private function must($ok): void { if ($ok === false) throw new RuntimeException('TickTick mapping could not be saved.'); }
    private function save(string $table, int $id, array $row): void
    {
        $this->own($table); $this->db->where($table . '_id', $id); $this->must($this->db->update($table, $row));
    }
    public static function payload(array $t, string $externalProject, string $zone, int $instance): array
    {
        $marker = '[AdamRMS:' . $instance . ':' . $t['id'] . ']';
        $content = trim($t['description'] . "\n\nCategory: " . ($t['category'] ?: '—') . "\nResponsible: " . ($t['assigneeName'] ?: 'Unassigned') .
            "\nRMS status: " . TaskPlanning::STATUSES[$t['status']] . "\nRMS priority: " . TaskPlanning::PRIORITIES[$t['priority']] .
            "\nPlanned: " . ($t['day'] ?: '—') . ($t['time'] ? ' ' . $t['time'] : '') . "\nDeadline: " . ($t['deadline'] ?: '—') . "\n" . $marker);
        $date = function (?string $v) use ($zone): ?string { return $v ? (new DateTimeImmutable($v, new DateTimeZone($zone)))->format('Y-m-d\TH:i:sO') : null; };
        $items = [];
        foreach ($t['checklist'] as $i => $c) $items[] = ['id' => substr(hash('sha256', $instance . ':' . $t['id'] . ':' . $c['id']), 0, 24),
            'title' => $c['title'], 'status' => $c['done'] ? 1 : 0, 'sortOrder' => $i, 'isAllDay' => true, 'timeZone' => $zone];
        $start = $date($t['day'] ? $t['day'] . 'T' . ($t['time'] ?: '00:00') : null);
        $due = $date($t['deadline'] ?: ($t['day'] ? $t['day'] . 'T' . ($t['time'] ?: '23:59') : null));
        // TickTick uses an interval; RMS deadlines may precede a separate planned day.
        if ($start && $due && new DateTimeImmutable($due) < new DateTimeImmutable($start)) {
            $due = $date($t['day'] . 'T' . ($t['time'] ?: '23:59'));
        }
        return ['projectId' => $externalProject, 'title' => $t['title'], 'content' => $content, 'desc' => $content,
            'priority' => [0, 1, 3, 5][$t['priority']], 'timeZone' => $zone, 'isAllDay' => !$t['time'] && !$t['deadline'],
            'startDate' => $start,
            'dueDate' => $due,
            'items' => $items, 'sortOrder' => $t['order']];
    }
    public function sync(int $project, bool $mine): array
    {
        $p = $this->tasks->project($project, true);
        // Keep app rotation atomic with sync/callback, without holding a SQL transaction over HTTP.
        $configLock = TaskTickSettings::lockName($this->tasks->instance);
        if ((int)$this->db->rawQueryValue('SELECT GET_LOCK(?, 0) LIMIT 1', [$configLock]) !== 1) throw new DomainException('TickTick settings or a sync are busy. Try again when the current operation finishes.');
        $lock = 'tasktick:' . $this->tasks->instance . ':' . $this->tasks->user;
        try {
            $this->app(); $token = $this->token();
            if ((int)$this->db->rawQueryValue('SELECT GET_LOCK(?, 0) LIMIT 1', [$lock]) !== 1) throw new DomainException('A TickTick sync is already running. Try again when it finishes.');
        } catch (Throwable $e) { $this->db->rawQueryValue('SELECT RELEASE_LOCK(?) LIMIT 1', [$configLock]); throw $e; }
        $pm = null; $currentId = null; $done = 0; $skipped = 0; $creating = null;
        try {
            $this->own('taskTickProjects'); $this->db->where('projects_id', $project); $pm = $this->db->getOne('taskTickProjects');
            if (!$pm) {
                $name = mb_substr($p['projects_name'], 0, 170) . ' [RMS ' . $this->tasks->instance . '/' . $project . ']';
                $id = $this->db->insert('taskTickProjects', ['instances_id' => $this->tasks->instance, 'users_userid' => $this->tasks->user, 'projects_id' => $project, 'taskTickProjects_name' => $name]);
                $this->must($id); $pm = ['taskTickProjects_id' => $id, 'taskTickProjects_name' => $name, 'taskTickProjects_external' => null, 'taskTickProjects_state' => 'new'];
            }
            if (!$pm['taskTickProjects_external']) {
                $lists = $this->api('GET', '/project', null, $token);
                $matches = array_values(array_filter($lists, fn($l) => ($l['name'] ?? '') === $pm['taskTickProjects_name']));
                if (count($matches) > 1) throw new DomainException('Multiple matching RMS lists exist in TickTick. Keep a single matching list before syncing.');
                if ($matches) $remote = $matches[0];
                else {
                    if ($pm['taskTickProjects_state'] === 'pending') throw new DomainException('A previous list creation has an uncertain result. Check TickTick; no duplicate list will be created automatically.');
                    $this->save('taskTickProjects', (int)$pm['taskTickProjects_id'], ['taskTickProjects_state' => 'pending']);
                    $creating = ['taskTickProjects', (int)$pm['taskTickProjects_id']];
                    $remote = $this->api('POST', '/project', ['name' => $pm['taskTickProjects_name'], 'viewMode' => 'list', 'kind' => 'TASK'], $token);
                }
                $creating = null;
                if (empty($remote['id'])) throw new RuntimeException('TickTick did not return a list ID. Retry to reconcile the existing list.');
                $pm['taskTickProjects_external'] = $remote['id'];
                $this->save('taskTickProjects', (int)$pm['taskTickProjects_id'], ['taskTickProjects_external' => $remote['id'], 'taskTickProjects_state' => 'ready']);
            }
            $external = $pm['taskTickProjects_external'];
            $remoteData = $this->api('GET', '/project/' . rawurlencode($external) . '/data', null, $token);
            $doc = $this->tasks->document($project); $todo = array_values(array_filter($doc['tasks'], fn($t) => !$mine || $t['assignee'] === $this->tasks->user));
            foreach ($todo as $t) {
                $this->own('taskTickTasks'); $this->db->where('planningTasks_id', $t['id']); $m = $this->db->getOne('taskTickTasks');
                if (!$m) {
                    $id = $this->db->insert('taskTickTasks', ['instances_id' => $this->tasks->instance, 'users_userid' => $this->tasks->user,
                        'planningTasks_id' => $t['id'], 'taskTickTasks_project' => $external]);
                    $this->must($id); $m = ['taskTickTasks_id' => $id, 'taskTickTasks_external' => null, 'taskTickTasks_state' => 'new', 'taskTickTasks_project' => $external];
                }
                $currentId = (int)$m['taskTickTasks_id'];
                if ($m['taskTickTasks_project'] !== $external) {
                    if (!$m['taskTickTasks_external'] && $m['taskTickTasks_state'] === 'pending') {
                        $oldData = $this->api('GET', '/project/' . rawurlencode($m['taskTickTasks_project']) . '/data', null, $token);
                        $marker = '[AdamRMS:' . $this->tasks->instance . ':' . $t['id'] . ']';
                        $matches = array_values(array_filter($oldData['tasks'] ?? [], fn($r) => str_contains(($r['content'] ?? '') . ($r['desc'] ?? ''), $marker)));
                        if (count($matches) !== 1) throw new DomainException('An uncertain create in the original TickTick list must be reconciled before moving this task.');
                        $m['taskTickTasks_external'] = $matches[0]['id'];
                        $this->save('taskTickTasks', $currentId, ['taskTickTasks_external' => $matches[0]['id'], 'taskTickTasks_state' => 'linked']);
                    }
                    if ($m['taskTickTasks_external']) {
                        $alreadyMoved = false;
                        try {
                            $remoteTask = $this->api('GET', '/project/' . rawurlencode($external) . '/task/' . rawurlencode($m['taskTickTasks_external']), null, $token);
                            $alreadyMoved = ($remoteTask['projectId'] ?? '') === $external;
                        } catch (TaskTickTickHttpError $e) { if ($e->status !== 404) throw $e; }
                        if (!$alreadyMoved) $this->api('POST', '/task/move', [['fromProjectId' => $m['taskTickTasks_project'], 'toProjectId' => $external, 'taskId' => $m['taskTickTasks_external']]], $token);
                    }
                    $this->save('taskTickTasks', $currentId, ['taskTickTasks_project' => $external, 'taskTickTasks_hash' => null]);
                    $m['taskTickTasks_project'] = $external; $m['taskTickTasks_hash'] = null;
                }
                $payload = self::payload($t, $external, $doc['timeZone'], $this->tasks->instance);
                $hash = hash('sha256', json_encode([$payload, $t['status']], JSON_THROW_ON_ERROR));
                if (($m['taskTickTasks_state'] ?? '') === 'synced' && ($m['taskTickTasks_hash'] ?? '') === $hash) { $skipped++; $currentId = null; continue; }
                $recovered = false;
                if (!$m['taskTickTasks_external']) {
                    $marker = '[AdamRMS:' . $this->tasks->instance . ':' . $t['id'] . ']';
                    $matches = array_values(array_filter($remoteData['tasks'] ?? [], fn($r) => str_contains(($r['content'] ?? '') . ($r['desc'] ?? ''), $marker)));
                    if (count($matches) > 1) throw new DomainException('Duplicate external RMS markers detected. Resolve these in TickTick before syncing.');
                    if ($matches) { $r = $matches[0]; $recovered = true; }
                    else {
                        if ($m['taskTickTasks_state'] === 'pending') throw new DomainException('The previous create has an uncertain result. Check the TickTick list; automatic recreation is blocked to prevent duplicates.');
                        $this->save('taskTickTasks', $currentId, ['taskTickTasks_state' => 'pending', 'taskTickTasks_error' => null]);
                        $creating = ['taskTickTasks', $currentId];
                        $r = $this->api('POST', '/task', array_filter($payload, fn($v) => $v !== null), $token);
                    }
                    $creating = null;
                    if (empty($r['id'])) throw new RuntimeException('TickTick did not return a task ID. Retry to reconcile the existing task.');
                    $m['taskTickTasks_external'] = $r['id'];
                    // Persist ID before completing: reconciliation must never depend on a completed task appearing in /data.
                    $this->save('taskTickTasks', $currentId, ['taskTickTasks_external' => $r['id'], 'taskTickTasks_state' => 'linked']);
                } else $recovered = true;
                if ($recovered) {
                    // Known IDs are always updated; a missing external task fails instead of silently duplicating it.
                    $payload['id'] = $m['taskTickTasks_external'];
                    $payload['status'] = $t['status'] === 'done' ? 2 : 0;
                    $updated = $this->api('POST', '/task/' . rawurlencode($m['taskTickTasks_external']), $payload, $token);
                    if ($t['status'] !== 'done' && isset($updated['status']) && (int)$updated['status'] === 2) throw new DomainException('TickTick did not reopen the task. Reopen it in TickTick and sync again.');
                    foreach (['startDate', 'dueDate'] as $field) {
                        if ($payload[$field] === null && !empty($updated[$field])) throw new DomainException('TickTick retained an old date. Clear that date in TickTick and sync again.');
                    }
                }
                if ($t['status'] === 'done') $this->api('POST', '/project/' . rawurlencode($external) . '/task/' . rawurlencode($m['taskTickTasks_external']) . '/complete', null, $token);
                $this->save('taskTickTasks', $currentId, ['taskTickTasks_state' => 'synced', 'taskTickTasks_hash' => $hash, 'taskTickTasks_synced' => gmdate('Y-m-d H:i:s'), 'taskTickTasks_error' => null]);
                $done++; $currentId = null;
                // Bound a request; additional presses safely continue a larger plan.
                if ($done >= 100) break;
            }
            $this->save('taskTickProjects', (int)$pm['taskTickProjects_id'], ['taskTickProjects_synced' => gmdate('Y-m-d H:i:s'), 'taskTickProjects_error' => null]);
            return ['count' => $done, 'remaining' => max(0, count($todo) - $done - $skipped)];
        } catch (Throwable $e) {
            if ($creating && $e instanceof TaskTickTickHttpError && in_array($e->status, [400, 401, 403, 404, 409, 422, 429], true)) {
                [$table, $mappingId] = $creating;
                $this->save($table, $mappingId, [$table . '_state' => 'new']);
            }
            $message = $e instanceof DomainException || $e instanceof RuntimeException ? mb_substr($e->getMessage(), 0, 500) : 'TickTick synchronisation failed. Please try again.';
            // Keep pending state so an uncertain HTTP result is never treated as a fresh create.
            if ($currentId) $this->save('taskTickTasks', $currentId, ['taskTickTasks_error' => $message]);
            if ($pm) $this->save('taskTickProjects', (int)$pm['taskTickProjects_id'], ['taskTickProjects_error' => $message]);
            throw new DomainException($done . ' tasks synced. ' . $message);
        } finally { $this->db->rawQueryValue('SELECT RELEASE_LOCK(?) LIMIT 1', [$lock]); $this->db->rawQueryValue('SELECT RELEASE_LOCK(?) LIMIT 1', [$configLock]); }
    }
}
