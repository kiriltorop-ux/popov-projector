"""Play a prepared narration at real speed and check the final audio counters."""
import argparse
from pathlib import Path
import time
from control import send

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file",type=Path)
    parser.add_argument("--minimum-seconds",type=float,default=600)
    args=parser.parse_args()
    status=send({"command":"status"})
    if not status["ready"] or status["active"] or status["waiting"] or status["stopped"]:
        raise SystemExit("Для проверки нужен свободный готовый пульт.")
    start=time.monotonic()
    response=send({"command":"say","text":args.file.read_text(encoding="utf-8")})
    if "id" not in response: raise SystemExit(str(response))
    deadline=start+max(1800,args.minimum_seconds*2)
    previous=-1
    while time.monotonic()<deadline:
        info=send({"command":"event","id":response["id"]})
        played=info.get("played_chunks",0)
        if played//10!=previous or info["state"]=="finished":
            print(round(time.monotonic()-start,2),info,flush=True)
            previous=played//10
        if info["state"]=="finished":
            seconds=info["samples"]/22050
            if seconds < args.minimum_seconds or played!=info["chunks"] or info["underruns"]:
                raise SystemExit("Неполный прогон или голодание аудиобуфера.")
            print(f"Воспроизведено {seconds:.3f} с, {played} фрагментов, опустошений 0.")
            return
        if info["state"] in {"failed","cancelled","unknown"}: raise SystemExit(str(info))
        time.sleep(.4)
    raise SystemExit("Истёк срок ожидания воспроизведения.")

if __name__=="__main__": main()
