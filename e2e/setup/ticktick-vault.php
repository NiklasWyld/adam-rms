<?php
declare(strict_types=1);
if (getenv('DB_DATABASE') !== 'adamrms_e2e' && !(getenv('GITHUB_ACTIONS') === 'true' && getenv('CI') === 'true' && getenv('DB_DATABASE') === 'db' && getenv('DB_HOSTNAME') === '127.0.0.1')) throw new RuntimeException('Only the isolated E2E environment is allowed.');
require __DIR__ . '/../../src/common/libs/TaskPlanningSecrets.php';
function verify(bool $ok): void { if (!$ok) throw new RuntimeException('Vault contract failed.'); }
putenv('TASK_PLANNING_TOKEN_KEY=');
$dir = '/tmp/adamrms-vault-check-' . bin2hex(random_bytes(8));
$file = $dir . '/master.key';
putenv('TASK_PLANNING_TOKEN_KEY_FILE=' . $file);
try {
    TaskPlanningSecrets::provision(false);
    verify(TaskPlanningSecrets::ready());
    verify((fileperms($file) & 0777) === 0600 && (fileperms($dir) & 0777) === 0700);
    $key = TaskPlanningSecrets::key();
    TaskPlanningSecrets::provision(true);
    verify(hash_equals($key, TaskPlanningSecrets::key()));
    $a = TaskPlanningSecrets::encrypt('synthetic-credential', 'instance:1');
    $b = TaskPlanningSecrets::encrypt('synthetic-credential', 'instance:1');
    verify($a !== $b && !str_contains($a, 'synthetic-credential'));
    verify(TaskPlanningSecrets::decrypt($a, 'instance:1') === 'synthetic-credential');
    try { TaskPlanningSecrets::decrypt($a, 'instance:2'); throw new RuntimeException('Cross-business ciphertext accepted.'); } catch (DomainException $expected) {}
    $raw = base64_decode($a); $raw[30] = chr(ord($raw[30]) ^ 1);
    try { TaskPlanningSecrets::decrypt(base64_encode($raw), 'instance:1'); throw new RuntimeException('Tampered ciphertext accepted.'); } catch (DomainException $expected) {}
    symlink($file, $dir . '/link.key');
    putenv('TASK_PLANNING_TOKEN_KEY_FILE=' . $dir . '/link.key');
    verify(!TaskPlanningSecrets::ready());
    $repo = realpath(__DIR__ . '/../..');
    $badPaths = [$repo . '/must-not-create.key', $dir . '/../must-not-create.key'];
    if (is_dir('/workspaces/adam-rms') && stat('/workspaces/adam-rms')['ino'] === stat($repo)['ino']) $badPaths[] = '/workspaces/adam-rms/must-not-create.key';
    foreach ($badPaths as $bad) {
        putenv('TASK_PLANNING_TOKEN_KEY_FILE=' . $bad);
        try { TaskPlanningSecrets::provision(false); throw new RuntimeException('Unsafe key location accepted.'); } catch (DomainException $expected) {}
    }
    echo "PASS vault: fresh protected key, stable reuse, random nonces, authenticated encryption, tenant binding, tamper rejection, unsafe path/symlink rejection\n";
} finally {
    foreach ([$dir . '/link.key', $file, $file . '.lock'] as $path) if (is_link($path) || file_exists($path)) unlink($path);
    if (is_dir($dir)) rmdir($dir);
}
