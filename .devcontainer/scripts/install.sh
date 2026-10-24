#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
composer install --no-interaction --prefer-dist --no-progress
composer check-platform-reqs
