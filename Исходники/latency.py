"""Measure warm, idle-station text-to-AVAudioPlayer start, without clearing the queue."""
import math
import statistics
import time
from control import send

LINES = (
    "Добрый день.", "Посмотрите на этот прибор.", "Слышите звонок?",
    "Меня зовут Александр Попов.", "Мы находимся у радиолаборатории.",
    "Сигнал пришёл.", "Вот мой приёмник.", "Эта история началась давно.",
    "Подойдите немного ближе.", "Рад встрече с вами.",
    "Я занимался электричеством и учил слушателей замечать слабые сигналы.",
    "На столе перед вами стоит прибор, который помогает услышать короткий сигнал.",
    "Посмотрите на катушку. Теперь представьте, что контакт замкнулся.",
    "Давайте начнём с простого опыта и посмотрим, как поведёт себя прибор.",
    "Радиоволна проходит сквозь пространство. Приёмник откликается на неё.",
    "В этой комнате удобно разговаривать. Рядом с нами находится стол с приборами.",
    "Я покажу вам приёмник. Подойдите ближе и рассмотрите его внимательно.",
    "Сначала мы услышим щелчок. После небольшой паузы сигнал повторится.",
    "Когда вы будете готовы, мы снова вернёмся к этому опыту.",
    "Спасибо, что вы заглянули. До новой встречи у нашего приёмника.",
)


def main():
    values = []
    for line in LINES:
        state = send({"command":"status"})
        if not state["ready"] or state["stopped"] or state["active"] or state["waiting"]:
            raise SystemExit("Для измерения нужен готовый свободный пульт.")
        response = send({"command":"say","text":line})
        if "id" not in response: raise SystemExit(str(response))
        deadline = time.monotonic()+35
        while time.monotonic()<deadline:
            event = send({"command":"event","id":response["id"]})
            if event["state"]=="finished": break
            if event["state"] in ("failed","cancelled","unknown"): raise SystemExit(str(event))
            time.sleep(.08)
        else: raise SystemExit("Проигрыватель не подтвердил завершение.")
        values.append(event["started_ms"])
        print(f"{len(values):2d}. {values[-1]:4d} мс  {line}",flush=True)
    print(f"Медиана {statistics.median(values):g} мс, p95 {sorted(values)[math.ceil(.95*len(values))-1]} мс, максимум {max(values)} мс.")


if __name__=="__main__":
    try: main()
    except OSError as exc: raise SystemExit(f"Пульт недоступен: {exc}")
