"""Local Russian speech and facial dynamics driven by the same PCM clock."""
import argparse
from difflib import SequenceMatcher
import io
import json
from pathlib import Path
import re
from itertools import groupby
import wave

import numpy as np

from narration import phrases, phrase_gap


GROUPS = {
    "rest": ("", "m", "b", "p"), "round": tuple("ouɔʊʉɵœøw"),
    "wide": tuple("ieɪɛɨyj"), "open": tuple("aɑæ"), "reduced": tuple("ɐʌəɘɜ"),
    "teeth": tuple("fvɸβ"), "hush": (*"szʃʂʒʐɕʑʧ", "ts","tʃ","tɕ"),
}
MOUTHS = {p: name for name, phones in GROUPS.items() for p in phones}
FPS = 50
MODEL = Path(__file__).resolve().parents[1] / "Голос" / "ru_RU-denis-medium.onnx"
# Length, acoustic variation, and duration variation in the trained Piper voice.
DELIVERY = {"спокойно": (1.12, .48, .30), "с интересом": (1.05, .58, .39)}
DIRECTION = re.compile(r"^\[(спокойно|с интересом)\]\s*", re.I)
SCIENCE_TOPIC = re.compile(r"\b(?:опыт|физик|эксперимент|при[её]мник|радиоволн|антенн|сигнал)\w*", re.I)


def marked_text(text):
    if not isinstance(text, str) or len(text) > 400:
        raise ValueError("Допускается до 400 знаков.")
    runs = text.strip().split("**")
    if len(runs) % 2 == 0:
        raise ValueError("Закройте выделение второй парой **.")
    plain = "".join(runs)
    if not re.search(r"[^\W_]", plain):
        raise ValueError("Введите произносимый текст.")
    emphasized = [bool(i % 2) for i, run in enumerate(runs) for _ in run]
    return plain, emphasized


def choose_answer(question):
    """Only curated responses enter speech from visitor-question mode."""
    q = " ".join(re.findall(r"[а-яa-z0-9]+", question.lower().replace("ё","е")))
    rules = (
        (r"приемник|на столе|на стол|этот прибор|этот аппарат",
         "Посмотрите на **приёмник**. Его антенна улавливает радиоволну. В ответ срабатывает реле, замыкается электрическая цепь, и мы слышим **звонок**."),
        (r"как вас зовут|кто (вы|ты|такой попов)|как тебя зовут|представь",
         "Меня зовут Александр Степанович **Попов**. Я занимался физикой и опытами с радиоволнами."),
        (r"что такое радио|радиоволн|как работает радио|без провод",
         "Представьте передатчик и приёмник. Между ними нет провода. Сигнал переносит **радиоволна**."),
        (r"привет|здравств|добрый (день|вечер)|доброе утро",
         "Здравствуйте. Меня зовут Александр Попов. Хотите узнать, как работает мой приёмник?"),
        (r"спасибо|благодар", "Благодарю за интерес к моим опытам."),
    )
    return next((answer for pattern, answer in rules if re.search(pattern,q)),
                "Об этом у меня пока нет рассказа. Спросите, как работает **приёмник**, или что такое радиоволна.")


def dynamics(samples, rate, phones, marked):
    """Fixed-reference RMS, and separate stress pulses on the same PCM clock."""
    seconds = len(samples) / rate
    centers = np.arange(int(np.ceil(seconds * FPS)) + 1) / FPS
    accent = np.zeros(len(centers))
    gain = np.ones(len(centers))
    cues = []
    timeline = [(0.0, "", False)] + phones
    for i, (start, phone, highlight) in enumerate(timeline):
        end = min(seconds, timeline[i+1][0] if i+1 < len(timeline) else seconds)
        if end <= start: continue
        bare = re.sub("[ˈˌʲː̪͡ʰ]", "", phone)
        # Palatalization may arrive as a standalone IPA event.
        pose = cues[-1][2] if phone in ("ʲ","ː") and cues else MOUTHS.get(bare,"soft")
        if cues and cues[-1][2] == pose:
            cues[-1][1] = end
        else:
            cues.append([start,end,pose])
        if "ˈ" in phone or ("ˌ" in phone and highlight):
            center = start + .45*(end-start)
            width = .11 if highlight else .08
            beat = np.exp(-.5*((centers-center)/width)**2)
            accent = np.maximum(accent, beat * (.95 if highlight else .30))
        if highlight and bare:
            # Ramp the word gain at either end to avoid clicks.
            gain = np.maximum(gain,1+.12*np.clip(np.minimum(
                (centers-start+.035)/.035,(end+.045-centers)/.045),0,1))
    signal = samples.astype(np.float64)
    if any(marked):
        signal *= np.interp(np.arange(len(signal))/rate, centers, gain)
    signal = np.clip(signal,-32767,32767).astype("<i2")
    power = np.r_[0, np.cumsum(np.square(signal.astype(np.float64)/32768))]
    idx = (centers*rate).round().astype(int)
    left = np.clip(idx-int(rate*.014),0,len(signal))
    right = np.clip(idx+int(rate*.014),0,len(signal))
    rms = np.sqrt((power[right]-power[left])/np.maximum(1,right-left))
    db = 20*np.log10(np.maximum(rms,1e-6))
    target = np.clip((db+48)/31,0,1)
    energy = np.zeros_like(target)
    level = 0.
    for i,value in enumerate(target):
        level += (.76 if value>level else .50)*(value-level)
        energy[i] = level
    return signal, dict(cues=cues, fps=FPS, energy=energy.round(4).tolist(),
                        accent=accent.round(4).tolist(), seconds=seconds)


class SpeechCore:
    """One instance per process, called serially from the synthesis worker."""
    def __init__(self, model=MODEL, pace=1.):
        from piper import PiperVoice
        from piper.config import SynthesisConfig

        if not model.is_file():
            raise RuntimeError("Установите русский голос с помощью setup.command.")
        voice_options = {}
        import sys
        if sys.platform == "win32":
            import ctypes
            from piper.phonemize_espeak import ESPEAK_DATA_DIR
            # The native eSpeak bridge cannot open Unicode Windows paths.
            short_path = ctypes.create_unicode_buffer(32768)
            if ctypes.windll.kernel32.GetShortPathNameW(
                str(ESPEAK_DATA_DIR), short_path, len(short_path)
            ):
                voice_options["espeak_data_dir"] = short_path.value
        self.voice = PiperVoice.load(str(model), include_alignments=True, **voice_options)
        self.rate = self.voice.config.sample_rate
        if self.rate != 22050:
            raise RuntimeError("Для пульта требуется голос с частотой 22 050 Гц.")
        self.profiles = {
            name: SynthesisConfig(length_scale=length*pace, noise_scale=noise,
                                  noise_w_scale=width, volume=.82)
            for name, (length, noise, width) in DELIVERY.items()
        }

    def _highlights(self, plain, marked, symbols):
        # Align phonemes of marked text runs to the actual contextual reading.
        flags = [False] * len(symbols)
        if not any(marked):
            return flags
        reference, emphasis = [], []
        for selected, group in groupby(zip(plain, marked), key=lambda item: item[1]):
            run = "".join(char for char, _ in group).strip()
            if run:
                phones = [p for sentence in self.voice.phonemize(run) for p in sentence]
                reference.extend(phones)
                emphasis.extend([selected] * len(phones))
        matcher = SequenceMatcher(None, reference, symbols, autojunk=False)
        for source, target, count in matcher.get_matching_blocks():
            flags[target:target + count] = emphasis[source:source + count]
        return flags

    def synthesize_pcm(self, text):
        direction = DIRECTION.match(text.strip())
        if direction:
            text = text.strip()[direction.end():]
        plain, marked = marked_text(text)
        style = direction[1].lower() if direction else (
            "с интересом" if SCIENCE_TOPIC.search(plain) else "спокойно")
        blocks, symbols, starts = [], [], []
        cursor = 0
        for chunk in self.voice.synthesize(plain, self.profiles[style], include_alignments=True):
            align = chunk.phoneme_alignments
            if not align:
                raise RuntimeError("Модель голоса не вернула длительности фонем.")
            signal = np.frombuffer(chunk.audio_int16_bytes, dtype="<i2")
            # Leave breathing room around speech and remove the model's variable
            # silent padding. All phoneme offsets use the same crop as the waveform.
            audible = np.flatnonzero(np.abs(signal.astype(np.int32)) > 70)
            if not len(audible):
                continue
            start = max(0, int(audible[0]) - round(.035 * self.rate))
            end = min(len(signal), int(audible[-1]) + round(.075 * self.rate))
            lengths = np.array([p.num_samples for p in align], dtype=np.int64)
            if lengths.sum() <= 0:
                raise RuntimeError("Пустая разметка голоса.")
            bounds = np.rint(np.r_[0, lengths.cumsum()] * len(signal) / lengths.sum()).astype(int)
            for item, left, right in zip(align, bounds, bounds[1:]):
                if min(end, right) > max(start, left):
                    starts.append((cursor + max(0, left - start)) / self.rate)
                    symbols.append(item.phoneme)
            blocks.append(signal[start:end])
            cursor += end - start
        if not blocks:
            raise ValueError("В тексте нет произносимых слов.")
        highlights = self._highlights(plain, marked, symbols)
        phones = []
        for i, symbol in enumerate(symbols):
            if symbol in ("ˈ", "ˌ") and i+1 < len(symbols):
                symbol += symbols[i+1]
            elif symbol in ("^", "$", " ") or symbol in ".,!?—:;-…":
                symbol = ""
            phones.append((starts[i], symbol, highlights[i]))
        signal, track = dynamics(np.concatenate(blocks), self.rate, phones, marked)
        return signal.tobytes(), track

    def synthesize(self, text):
        # Offline takes follow the same phrase boundaries and pauses as the player.
        marked_text(text)
        chunks = phrases(text)
        pcm = bytearray()
        cues = []
        segments = []
        for index, phrase in enumerate(chunks):
            audio, local = self.synthesize_pcm(phrase)
            offset = len(pcm) / (2 * self.rate)
            pcm.extend(audio)
            end = len(pcm) / (2 * self.rate)
            segments.append((offset, end, local))
            cues.extend([offset + a, offset + b, pose] for a, b, pose in local["cues"])
            if index + 1 < len(chunks):
                pcm.extend(bytes(2 * phrase_gap(phrase, self.rate)))
                cues.append([end, len(pcm) / (2 * self.rate), "rest"])
        seconds = len(pcm) / (2 * self.rate)
        frames = np.arange(int(np.ceil(seconds * FPS)) + 1) / FPS
        track = dict(cues=cues, fps=FPS, seconds=seconds)
        for key in ("energy", "accent"):
            curve = np.zeros(len(frames))
            for start, end, local in segments:
                active = (frames >= start) & (frames < end)
                curve[active] = np.interp((frames[active] - start) * FPS,
                                          np.arange(len(local[key])), local[key])
            track[key] = curve.round(4).tolist()
        stream = io.BytesIO()
        with wave.open(stream,"wb") as out:
            out.setparams((1,2,self.rate,0,"NONE","PCM"))
            out.writeframes(pcm)
        return stream.getvalue(), track


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text")
    parser.add_argument("--ask",action="store_true",help="Подобрать ответ на вопрос из сценария")
    parser.add_argument("--out",type=Path,required=True,help="Путь без расширения для WAV и JSON")
    args = parser.parse_args()
    wav,track = SpeechCore().synthesize(choose_answer(args.text) if args.ask else args.text)
    args.out.with_suffix(".wav").write_bytes(wav)
    args.out.with_suffix(".json").write_text(json.dumps(track,ensure_ascii=False))
