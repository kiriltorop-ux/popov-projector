#!/bin/zsh
set -eu
cd "${0:A:h}"
python_bin="${POPOV_PYTHON:-python3.12}"
"$python_bin" -m venv .venv
# Server mode receives PCM; no local Piper/Whisper installation is required.
if [[ ! -f station.env ]]; then
  cp station.env.example station.env
  echo 'Укажите сервер и ключ станции в station.env перед запуском.'
fi
./Исходники/build.command
echo 'Готово. Откройте «Пульт Попова.app». Панель скрыта; для тестов запускайте бинарник с --test-panel.'
