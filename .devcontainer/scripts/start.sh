#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
php .devcontainer/scripts/database.php
if [[ ! -f vendor/autoload.php ]]; then
    bash .devcontainer/scripts/install.sh
fi
# Codespaces uses HTTPS forwarding; localhost redirects and mixed-content assets fail there.
if [[ ${CODESPACES:-false} == true && -n ${CODESPACE_NAME:-} && -n ${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-} ]]; then
    export CONFIG_ROOTURL="https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi
php vendor/bin/phinx migrate -e development
php vendor/bin/phinx seed:run -e development
php .devcontainer/scripts/configure.php

cloud_dev_state=/tmp/adamrms-dev
mkdir -p "$cloud_dev_state"
exec 9>"$cloud_dev_state/server.lock"
flock 9
# A restarted container can reuse a stale PID for a different process.
if [[ -f "$cloud_dev_state/server.pid" ]] && pgrep -F "$cloud_dev_state/server.pid" -f '(^|/)php -S 0[.]0[.]0[.]0:8080 -t src$' > /dev/null 2>&1; then
    echo "Development web server is already running."
else
    nohup php -S 0.0.0.0:8080 -t src >"$cloud_dev_state/server.log" 2>&1 < /dev/null 9>&- &
    echo "$!" >"$cloud_dev_state/server.pid"
fi
# A successful request must render the login form, not just open a TCP port.
for ((cloud_attempt=0; cloud_attempt<30; cloud_attempt++)); do
    if curl --noproxy '*' --silent --fail http://127.0.0.1:8080/login/ | grep 'id="passwordInput"' > /dev/null; then
        echo "AdamRMS is ready on port 8080."
        exit 0
    fi
    if ! kill -0 "$(cat "$cloud_dev_state/server.pid")" 2>/dev/null; then
        cat "$cloud_dev_state/server.log" >&2
        exit 1
    fi
    sleep 1
done
echo "The login page did not become ready; see $cloud_dev_state/server.log" >&2
exit 1
