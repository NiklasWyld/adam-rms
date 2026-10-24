<?php
// Explicitly destructive schema test. Refuses the normal development database.
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('ADAMRMS_DEVCONTAINER') !== 'true' ||
    getenv('DEV_MODE') !== 'true' || getenv('DB_HOSTNAME') !== 'db' || getenv('DB_DATABASE') !== 'adamrms_e2e') {
    fwrite(STDERR, "Only run against adamrms_e2e in the development container.\n");
    exit(1);
}
$root = dirname(__DIR__, 2);
$db = new PDO('mysql:host=db;dbname=adamrms_e2e', getenv('DB_USERNAME'), getenv('DB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
if ((string)$db->query('SELECT MAX(version) FROM phinxlog')->fetchColumn() !== '20261024160000') {
    exit("Refusing to roll back an unexpected migration version.\n");
}
function counts(PDO $db): array {
    $counts = [];
    foreach (['users', 'instances', 'assets', 'assetTypes', 'assetsAssignments', 'projects'] as $table) {
        $counts[$table] = $db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
    }
    return $counts;
}
function phinx(string $arguments): void {
    global $root;
    passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/vendor/bin/phinx') . ' ' . $arguments . ' -c ' . escapeshellarg($root . '/phinx.php') . ' -e development', $code);
    if ($code !== 0) throw new RuntimeException('Migration command failed.');
}
$before = counts($db);
try {
    phinx('rollback -t 20260419113000');
    if ($db->query("SHOW TABLES LIKE 'shoppingLists'")->fetchAll() || $db->query("SHOW TABLES LIKE 'shoppingListItems'")->fetchAll()) {
        throw new RuntimeException('Shopping tables remain after rollback.');
    }
} finally {
    phinx('migrate');
}
if ($before !== counts($db)) throw new RuntimeException('An unrelated table changed during rollback/migrate.');
echo "PASS: reversible shopping migration; existing users, businesses, assets, assignments and projects preserved.\n";
