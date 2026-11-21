"""One local request per connection. No extra dependencies."""
import argparse
import json
import socket
from pathlib import Path
from service import SOCKET

def send(msg):
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(4)
        conn.connect(str(SOCKET))
        conn.sendall(json.dumps(msg,ensure_ascii=False).encode()+b"\n")
        return json.loads(conn.makefile("rb").readline())

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["say","ask","status","event","stop","resume","visitors"])
    p.add_argument("text", nargs="?")
    p.add_argument("--file",type=Path,help="Прочитать UTF-8 текст из файла")
    p.add_argument("--interrupt",action="store_true",help="Прервать текущий рассказ и сразу ответить")
    p.add_argument("--id")
    p.add_argument("--expiry",type=float)
    args = p.parse_args()
    path = vars(args).pop("file")
    if path is not None:
        if args.text is not None: p.error("Выберите файл или текст.")
        args.text = path.read_text(encoding="utf-8")
    try: result = send({k:v for k,v in vars(args).items() if v is not None})
    except OSError as exc: p.exit(1, f"Проигрыватель недоступен: {exc}\n")
    print(json.dumps(result,ensure_ascii=False))
    raise SystemExit(int(bool(result.get("error"))))
