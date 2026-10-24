<?php
// Local devcontainer database only. Never point lifecycle hooks at production.
if (getenv('ADAMRMS_DEVCONTAINER') !== 'true' or getenv('DEV_MODE') !== 'true' or
    getenv('DB_HOSTNAME') !== 'db' or getenv('DB_DATABASE') !== 'db') {
    throw new RuntimeException('Refusing to initialise a database outside the local devcontainer.');
}
for ($attempt = 0; $attempt < 60; $attempt++) {
    try {
        $database = new PDO('mysql:host=db;port=' . (getenv('DB_PORT') ?: 3306) . ';dbname=db', getenv('DB_USERNAME'), getenv('DB_PASSWORD'), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        echo "Development database is reachable.\n";
        return;
    } catch (PDOException $error) {
        if ($attempt === 59) throw new RuntimeException('Development database did not become ready.', 0, $error);
        sleep(1);
    }
}
