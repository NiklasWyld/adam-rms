<?php
declare(strict_types=1);

/** Server-only key material. Never store or return it through the database, templates or an API. */
final class TaskPlanningSecrets
{
    private static function path(): string
    {
        $path = getenv('TASK_PLANNING_TOKEN_KEY_FILE') ?: ((getenv('ADAMRMS_DEVCONTAINER') === 'true' && is_dir('/workspaces'))
            ? '/workspaces/.adamrms-secrets/task-planning.key' : '/var/lib/adamrms/secrets/task-planning.key');
        if (!is_string($path) || !str_starts_with($path, '/') || str_contains($path, "\0") || array_intersect(explode('/', $path), ['.', '..'])) throw new DomainException('The server encryption-key location is invalid.');
        $repo = realpath(__DIR__ . '/../../..');
        // Resolve existing ancestors as well, so ../ and symlinks cannot put keys into the checkout.
        $parent = dirname($path); $tail = [];
        while (!file_exists($parent) && $parent !== '/') { array_unshift($tail, basename($parent)); $parent = dirname($parent); }
        // Bind mounts may expose the checkout under a second pathname.
        $repoStat = $repo ? @stat($repo) : false;
        for ($ancestor = $parent; $ancestor !== '/'; $ancestor = dirname($ancestor)) {
            $stat = @stat($ancestor);
            if ($stat && $repoStat && $stat['dev'] === $repoStat['dev'] && $stat['ino'] === $repoStat['ino']) throw new DomainException('The encryption key must be outside the repository and web directory.');
        }
        $resolved = realpath($parent);
        if (!$resolved) throw new DomainException('The server encryption-key location is unavailable.');
        $resolved = rtrim($resolved, '/') . ($tail ? '/' . implode('/', $tail) : '') . '/' . basename($path);
        if ($repo && ($resolved === $repo || str_starts_with($resolved, $repo . '/'))) throw new DomainException('The encryption key must be outside the repository and web directory.');
        if (is_link($path)) throw new DomainException('The encryption key must be a regular server-only file.');
        return $path;
    }
    public static function key(): string
    {
        $provided = getenv('TASK_PLANNING_TOKEN_KEY');
        if ($provided !== false && $provided !== '') {
            $key = base64_decode($provided, true);
        } else {
            $path = self::path(); clearstatcache(true, $path); $stat = @lstat($path);
            if (!$stat || !is_file($path) || ($stat['mode'] & 0077) !== 0 || !is_readable($path)) throw new DomainException('The server encryption key is missing or not protected. Restore its backup before using saved TickTick credentials.');
            $key = base64_decode(trim((string)@file_get_contents($path)), true);
        }
        if (!is_string($key) || strlen($key) !== 32) throw new DomainException('The server encryption key is invalid. Restore the existing key; do not replace it while encrypted credentials are saved.');
        return $key;
    }
    public static function ready(): bool
    {
        try { self::key(); return true; } catch (DomainException $e) { return false; }
    }
    public static function provision(bool $encryptedDataExists): void
    {
        if (getenv('TASK_PLANNING_TOKEN_KEY')) { self::key(); return; }
        $path = self::path();
        $oldMask = umask(0077);
        try {
            $parent = dirname($path);
            if (!is_dir($parent) && !@mkdir($parent, 0700, true)) throw new DomainException('The server cannot create its private encryption-key directory. An administrator must provide a persistent writable key location outside the repository.');
            if (is_link($parent)) throw new DomainException('Use a private directory for the encryption key.');
            $stat = @stat($parent);
            if (!$stat || ($stat['mode'] & 0077) !== 0) throw new DomainException('The encryption-key directory must be private (permissions 0700).');
            $lockPath = $path . '.lock';
            if (is_link($lockPath)) throw new DomainException('Invalid encryption-key lock.');
            $lock = @fopen($lockPath, 'c');
            if (!$lock) throw new DomainException('The server encryption-key directory is not writable.');
            try {
                if (!@chmod($lockPath, 0600)) throw new DomainException('The server could not protect its encryption-key lock.');
                if (!flock($lock, LOCK_EX)) throw new DomainException('The server encryption key is busy. Try again.');
                if (file_exists($path)) { self::key(); return; }
                if ($encryptedDataExists) throw new DomainException('Encrypted TickTick data already exists, but its server key is missing. Restore the key from backup before saving.');
                $file = @fopen($path, 'x');
                if (!$file) throw new DomainException('The server could not create its encryption key.');
                try {
                    // A parent default ACL may override umask. Protect the empty file before writing any key bytes.
                    if (!@chmod($path, 0600)) throw new DomainException('The server could not protect its encryption key.');
                    $bytes = base64_encode(random_bytes(32)) . "\n";
                    if (fwrite($file, $bytes) !== strlen($bytes) || !fflush($file)) throw new RuntimeException('Could not persist encryption key.');
                    if (function_exists('fsync') && !fsync($file)) throw new RuntimeException('Could not persist encryption key.');
                } finally { fclose($file); }
                self::key();
            } finally { flock($lock, LOCK_UN); fclose($lock); }
        } finally { umask($oldMask); }
    }
    public static function encrypt(string $plain, string $purpose): string
    {
        $iv = random_bytes(12); $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag, $purpose);
        if ($cipher === false) throw new RuntimeException('Credential encryption failed.');
        return base64_encode($iv . $tag . $cipher);
    }
    public static function decrypt(string $stored, string $purpose): string
    {
        $raw = base64_decode($stored, true);
        if (!is_string($raw) || strlen($raw) < 29) throw new DomainException('The saved TickTick credential is invalid. Re-enter it after restoring the server key if necessary.');
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16), $purpose);
        if ($plain === false) throw new DomainException('The saved TickTick credential could not be decrypted. Restore the server key or enter the app credentials again.');
        return $plain;
    }
}
