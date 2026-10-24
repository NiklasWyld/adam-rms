# Keep development on the same PHP minor as production.
FROM node:22-bookworm-slim AS node
FROM composer:2.9 AS composer
FROM php:8.3-cli-bookworm

COPY --from=composer /usr/bin/composer /usr/local/bin/composer
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules

# The optional CA secret is for managed builders with a TLS-inspecting proxy.
# Ordinary Codespaces builds use the image's normal CA store.
RUN --mount=type=secret,id=proxy_ca,mode=0444 \
    set -eu; \
    if [ -s /run/secrets/proxy_ca ]; then \
        printf 'Acquire::https::CaInfo "/run/secrets/proxy_ca";\n' > /etc/apt/apt.conf.d/99-build-ca; \
    fi; \
    rm -f /etc/apt/sources.list.d/yarn.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends git openssh-client sudo procps util-linux unzip mariadb-client libicu-dev libzip-dev libpng-dev libonig-dev libfreetype6-dev libjpeg62-turbo-dev; \
    docker-php-ext-configure gd --with-freetype --with-jpeg; \
    docker-php-ext-install -j4 mysqli pdo_mysql intl zip gd mbstring bcmath; \
    ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm; \
    ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx; \
    groupadd --gid 1000 vscode; \
    useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash vscode; \
    printf 'vscode ALL=(root) NOPASSWD:ALL\n' > /etc/sudoers.d/vscode; \
    chmod 0440 /etc/sudoers.d/vscode; \
    rm -f /etc/apt/apt.conf.d/99-build-ca; \
    rm -rf /var/lib/apt/lists/*

RUN printf 'memory_limit=512M\npost_max_size=64M\nupload_max_filesize=64M\n' > /usr/local/etc/php/conf.d/adamrms-dev.ini
