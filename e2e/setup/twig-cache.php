<?php
// Exercise the real production Twig setup without connecting to the database.
require __DIR__ . '/../../vendor/autoload.php';
use Twig\Extra\String\StringExtension;

$src = realpath(__DIR__ . '/../../src');
$head = file_get_contents($src . '/common/head.php');
$start = strpos($head, '$TWIGLOADER =');
$endMarker = '$TWIG->addExtension(new StringExtension());';
$end = strpos($head, $endMarker, $start);
if ($start === false || $end === false) throw new RuntimeException('Cannot locate application Twig setup');
$setup = substr($head, $start, $end - $start + strlen($endMarker));
// Resolve __DIR__ as it would be resolved inside common/head.php.
$setup = str_replace('__DIR__', var_export($src . '/common', true), $setup);
$cache = sys_get_temp_dir() . '/adamrms-twig-cache-' . bin2hex(random_bytes(8));
mkdir($cache, 0700);
$cwd = getcwd();
$dev = getenv('DEV_MODE');
putenv('DEV_MODE=false');
$results = [];
$keys = [];
try {
    foreach (['taskPlanning', 'rooms', 'shoppingLists', 'taskPlanning'] as $module) {
        // Apache executes each directory index from its own directory.
        chdir($src . '/' . $module);
        eval('use Twig\\Extra\\String\\StringExtension;' . $setup);
        $TWIG->setCache($cache);
        require $src . '/common/libs/twigExtensions.php';
        $name = $module . '/index.twig';
        $key = $TWIGLOADER->getCacheKey($name);
        $template = $TWIG->load($name);
        if ($template->getTemplateName() !== $name) {
            throw new RuntimeException($name . ' loaded ' . $template->getTemplateName());
        }
        if (isset($keys[$key]) && $keys[$key] !== $name) {
            throw new RuntimeException('Shared cache key: ' . $key);
        }
        $keys[$key] = $name;
        $results[$name] = $template->getTemplateName();
    }
    // A template must also keep its key when another page loads it.
    $expected = $TWIGLOADER->getCacheKey('rooms/index.twig');
    chdir($src . '/rooms');
    eval('use Twig\\Extra\\String\\StringExtension;' . $setup);
    if ($TWIGLOADER->getCacheKey('rooms/index.twig') !== $expected) {
        throw new RuntimeException('Template cache key depends on the page working directory');
    }
    echo json_encode($results) . PHP_EOL;
} finally {
    chdir($cwd);
    putenv($dev === false ? 'DEV_MODE' : 'DEV_MODE=' . $dev);
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($cache, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $file) {
        $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($cache);
}
