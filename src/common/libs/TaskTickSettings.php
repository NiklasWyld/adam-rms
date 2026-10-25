<?php
declare(strict_types=1);
require_once __DIR__ . '/TaskPlanningSecrets.php';
require_once __DIR__ . '/TaskPlanning.php';

/** Business-owned app credentials. Personal OAuth tokens stay in taskTickConnections. */
final class TaskTickSettings
{
    public function __construct(private $db, private int $instance, private int $user) {}
    public static function lockName(int $instance): string { return 'tasktickconfig:' . $instance; }
    private function row(): ?array
    {
        $this->db->where('instances_id', $this->instance);
        return $this->db->getOne('taskTickSettings') ?: null;
    }
    public static function redirect($uri): string
    {
        if (!is_string($uri) || strlen($uri) > 2048 || preg_match('/[\x00-\x20\x7f]/', $uri) || !filter_var($uri, FILTER_VALIDATE_URL)) throw new InvalidArgumentException('Enter a valid HTTPS callback URL.');
        $parts = parse_url($uri);
        if (($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment']) ||
            !str_ends_with($parts['path'] ?? '', '/taskPlanning/callback.php')) throw new InvalidArgumentException('Use an HTTPS RMS URL ending in /taskPlanning/callback.php, without a query or fragment.');
        return $uri;
    }
    /** This method is server-internal. Never pass its result into a view or API response. */
    public function credentials(): ?array
    {
        $row = $this->row();
        if ($row) {
            if (!$row['taskTickSettings_enabled']) return null;
            return ['clientId' => $row['taskTickSettings_clientId'], 'secret' => TaskPlanningSecrets::decrypt($row['taskTickSettings_secret'], 'AdamRMS TickTick app:' . $this->instance),
                'redirect' => self::redirect($row['taskTickSettings_redirect'])];
        }
        $id = getenv('TICKTICK_CLIENT_ID'); $secret = getenv('TICKTICK_CLIENT_SECRET'); $redirect = getenv('TICKTICK_REDIRECT_URI');
        if (!$id || !$secret || !$redirect) return null;
        return ['clientId' => $id, 'secret' => $secret, 'redirect' => self::redirect($redirect)];
    }
    public function configured(): bool
    {
        try { return $this->credentials() !== null && TaskPlanningSecrets::ready(); } catch (DomainException | InvalidArgumentException $e) { return false; }
    }
    public static function fingerprint(array $app): string { return hash('sha256', json_encode($app, JSON_THROW_ON_ERROR)); }
    public function document(string $root): array
    {
        $row = $this->row(); $configured = $this->configured();
        $suggested = preg_replace('/^http:/', 'https:', rtrim($root, '/')) . '/taskPlanning/callback.php';
        return ['clientId' => $row ? $row['taskTickSettings_clientId'] : (getenv('TICKTICK_CLIENT_ID') ?: ''),
            'redirect' => ($row ? $row['taskTickSettings_redirect'] : (getenv('TICKTICK_REDIRECT_URI') ?: '')) ?: $suggested,
            'suggestedRedirect' => $suggested, 'hasSecret' => $row ? !empty($row['taskTickSettings_secret']) : (bool)getenv('TICKTICK_CLIENT_SECRET'),
            'revision' => $row ? (int)$row['taskTickSettings_revision'] : 0,
            'source' => $row ? ($row['taskTickSettings_enabled'] ? 'business' : 'disabled') : (getenv('TICKTICK_CLIENT_ID') ? 'environment' : 'none'),
            'configured' => $configured, 'keyReady' => TaskPlanningSecrets::ready(),
            'updated' => $row['taskTickSettings_updated'] ?? null];
    }
    /** On identity/secret changes, invalidate tokens but retain external IDs to prevent duplicate tasks. */
    public function save(array $input, $secret, bool $remove, callable $audit): void
    {
        $lock = self::lockName($this->instance);
        if ((int)$this->db->rawQueryValue('SELECT GET_LOCK(?, 0) LIMIT 1', [$lock]) !== 1) throw new DomainException('TickTick is currently syncing or changing settings. Try again when it finishes.');
        $this->db->startTransaction();
        try {
            $old = $this->row(); $revision = $old ? (int)$old['taskTickSettings_revision'] : 0;
            if (!isset($input['revision']) || !is_string($input['revision']) || !ctype_digit($input['revision']) || (int)$input['revision'] !== $revision) throw new DomainException('These settings changed in another tab. Reload before saving.');
            if ($remove) {
                $row = ['taskTickSettings_clientId' => '', 'taskTickSettings_secret' => null, 'taskTickSettings_redirect' => '', 'taskTickSettings_enabled' => 0];
                $changed = true;
            } else {
                $id = TaskPlanning::text($input['client_id'] ?? '', 255, true);
                if (!preg_match('/^[a-zA-Z0-9._~-]+$/D', $id)) throw new InvalidArgumentException('Enter a valid TickTick client ID.');
                $redirect = self::redirect($input['redirect_uri'] ?? '');
                if (!is_string($secret) || strlen($secret) > 4096 || preg_match('/[\x00-\x20\x7f]/', $secret)) throw new InvalidArgumentException('Enter a valid client secret without whitespace.');
                $previous = null;
                try { $previous = $this->credentials(); } catch (DomainException | InvalidArgumentException $e) { /* A replacement still requires the original encryption key. */ }
                $plain = $secret !== '' ? $secret : ($previous['secret'] ?? '');
                if ($plain === '') throw new InvalidArgumentException('Enter the client secret when configuring TickTick for the first time.');
                $this->db->where('taskTickSettings_secret IS NOT NULL');
                $hasEncrypted = (int)$this->db->getValue('taskTickSettings', 'COUNT(*)') > 0;
                $this->db->where('taskTickConnections_token IS NOT NULL');
                $hasTokens = (int)$this->db->getValue('taskTickConnections', 'COUNT(*)') > 0;
                $hasEncrypted = $hasEncrypted || $hasTokens;
                TaskPlanningSecrets::provision($hasEncrypted);
                $next = ['clientId' => $id, 'secret' => $plain, 'redirect' => $redirect];
                $changed = $previous === null || !hash_equals(self::fingerprint($previous), self::fingerprint($next));
                $row = ['taskTickSettings_clientId' => $id, 'taskTickSettings_secret' => TaskPlanningSecrets::encrypt($plain, 'AdamRMS TickTick app:' . $this->instance),
                    'taskTickSettings_redirect' => $redirect, 'taskTickSettings_enabled' => 1];
                unset($plain, $previous, $next);
            }
            $row += ['taskTickSettings_revision' => $revision + 1, 'taskTickSettings_updated' => gmdate('Y-m-d H:i:s'), 'taskTickSettings_updatedBy' => $this->user];
            if ($old) { $this->db->where('instances_id', $this->instance); $ok = $this->db->update('taskTickSettings', $row); }
            else $ok = $this->db->insert('taskTickSettings', $row + ['instances_id' => $this->instance]);
            if ($ok === false) throw new RuntimeException('TickTick settings storage failed.');
            if ($changed) {
                $this->db->where('instances_id', $this->instance);
                if ($this->db->update('taskTickConnections', ['taskTickConnections_token' => null, 'taskTickConnections_expires' => null]) === false) throw new RuntimeException('Could not invalidate old connections.');
            }
            $audit($remove ? 'TICKTICK-APP-REMOVED' : 'TICKTICK-APP-SETTINGS');
            $this->db->commit();
        } catch (Throwable $e) { $this->db->rollback(); throw $e;
        } finally { $this->db->rawQueryValue('SELECT RELEASE_LOCK(?) LIMIT 1', [$lock]); }
    }
}
