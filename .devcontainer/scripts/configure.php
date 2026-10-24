<?php
require __DIR__ . '/database.php';
require __DIR__ . '/../../vendor/autoload.php';
require __DIR__ . '/../../src/common/libs/Config/Config.php';
$rootUrl = getenv('CONFIG_ROOTURL') ?: 'http://localhost:8080';
$_SERVER['HTTP_HOST'] = parse_url($rootUrl, PHP_URL_HOST);
$DBLIB = new MysqliDb(['host' => 'db', 'username' => getenv('DB_USERNAME'), 'password' => getenv('DB_PASSWORD'), 'db' => 'db', 'port' => getenv('DB_PORT') ?: 3306, 'charset' => 'utf8mb4']);
$config = new Config();
$input = ['ROOTURL' => $rootUrl];
foreach ($config->CONFIG_STRUCTURE as $key => $spec) {
    if ($key === 'ROOTURL') continue;
    if (in_array($key, $config->CONFIG_MISSING_VALUES, true)) {
        $input[$key] = $key === 'AUTH_JWTKey' ? strtoupper(bin2hex(random_bytes(32))) : $spec['form']['default']();
        if ($key === 'EMAILS_FROM_EMAIL') $input[$key] = 'adamrms@devcontainer.local';
    } elseif ($spec['form']['required'] ?? false) {
        $input[$key] = $config->get($key);
    }
}
$result = $config->formArrayProcess($input);
if ($result !== true) throw new RuntimeException('Invalid development settings: ' . implode(', ', array_keys($result)));
echo "Local configuration is complete; existing signing keys and user data were preserved.\n";
