#!/usr/bin/env bash
# Установка и обновление «Наше имя» на сервере. Запуск: bash install.sh
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(id -u)" != 0 ]; then exec sudo bash "$0" "$@"; fi

say() { printf '\n==> %s\n' "$*"; }
busy() { ss -tln | grep -qE ":$1[[:space:]]"; }

if ! command -v docker >/dev/null 2>&1; then
  say "Ставлю Docker (программа для запуска приложения)"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  say "Проверяю порты"
  if busy 80; then
    echo "Порт 80 занят другой программой. Он нужен, чтобы получить сертификат."
    echo "Покажите этот вывод Claude:"; ss -tlnp | grep -E ':80[[:space:]]' || true
    exit 1
  fi
  HTTPS_PORT=443
  if busy 443; then
    HTTPS_PORT=8443
    echo "Порт 443 занят (скорее всего VPN). Беру порт 8443."
    if busy 8443; then echo "Порт 8443 тоже занят. Покажите этот вывод Claude:"; ss -tlnp | grep -E ':(443|8443)[[:space:]]' || true; exit 1; fi
  fi

  IP=$(curl -4 -fsS https://api.ipify.org || curl -4 -fsS https://ifconfig.me)
  SITE_HOST="${IP//./-}.sslip.io"

  say "Токен бота"
  echo "Вставьте токен от BotFather и нажмите Enter. При вставке он не показывается на экране — это нормально."
  read -rsp "Токен: " BOT_TOKEN </dev/tty; echo
  if ! [[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then echo "Это не похоже на токен бота. Запустите установку ещё раз."; exit 1; fi

  umask 077
  printf 'BOT_TOKEN=%s\nSITE_HOST=%s\nHTTPS_PORT=%s\nMAX_ROOMS=10\n' "$BOT_TOKEN" "$SITE_HOST" "$HTTPS_PORT" > .env

  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; ufw allow "$HTTPS_PORT"/tcp >/dev/null
  fi
fi

say "Собираю и запускаю"
docker compose up -d --build

. ./.env
URL="https://$SITE_HOST"; [ "$HTTPS_PORT" != 443 ] && URL="$URL:$HTTPS_PORT"
say "Готово. Адрес приложения:"
echo "$URL"
echo
echo "Сертификат выдаётся в течение минуты. Проверка: откройте адрес в браузере —"
echo "должна появиться надпись «Откройте приложение через Telegram»."
