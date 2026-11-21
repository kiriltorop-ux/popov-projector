#!/bin/zsh
set -eu
cd "${0:A:h}"
git submodule update --init -- mobile
python_bin="${POPOV_PYTHON:-python3.12}"
if ! command -v "$python_bin" >/dev/null; then
  echo "Нужен Python 3.12. Укажите путь в POPOV_PYTHON." >&2
  exit 1
fi
"$python_bin" -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: -r requirements.txt
.venv/bin/python Исходники/install_voice.py
.venv/bin/python -c 'import sys; sys.path.insert(0,"Исходники"); from speech_core import SpeechCore; SpeechCore().synthesize("Проверка.")'
./Исходники/build.command
