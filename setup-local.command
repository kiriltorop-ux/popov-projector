#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ ! -x .venv/bin/python || -n "${POPOV_PYTHON:-}" ]]; then
  python_bin="${POPOV_PYTHON:-python3.12}"
  "$python_bin" -m venv .venv
fi
.venv/bin/python -m pip install -r server/requirements.lock
.venv/bin/python -m server.install_denis
.venv/bin/python -m server.configure_local
./Исходники/build.command
echo 'Готово. Укажите ключи в .env и откройте «Пульт Попова.app».'
echo 'Компьютер сам запустит сервер, проекцию и QR. Телефон подключите к той же сети.'
