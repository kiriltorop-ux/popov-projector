"""Break a narration at natural boundaries and preserve cross-boundary emphasis."""
import re

MAX_TEXT = 32_000
MAX_WIRE = 256 * 1024


def phrases(text):
    if len(text) > MAX_TEXT or not re.search(r"[^\W_]", text):
        raise ValueError("Нужен рассказ до 32 000 знаков.")
    if text.count("**") % 2:
        raise ValueError("Закройте выделение второй парой **.")
    # Keep a small first buffer. Later chunks may contain longer clauses.
    runs = re.split(r"(\*\*)", text.strip())
    flagged = []
    emph = False
    for run in runs:
        if run == "**":
            emph = not emph
        else:
            flagged.extend((ch, emph) for ch in run)
    plain = "".join(c for c, _ in flagged)
    start = 0
    result = []
    while start < len(plain):
        ceiling = min(len(plain), start + (88 if not result else 180))
        part = plain[start:ceiling]
        cut = re.search(r'[.!?…]+[»”"]*(?=\s|$)|\n+',part)
        if cut:
            end = start + cut.end()
        elif ceiling < len(plain):
            breaks = list(re.finditer(r"[,;:—]\s+|\s+", part))
            end = start+breaks[-1].end() if breaks else ceiling
        else:
            end = ceiling
        segment = []
        active = False
        for ch, marked in flagged[start:end]:
            if marked != active:
                segment.append("**")
                active = marked
            segment.append(ch)
        if active: segment.append("**")
        if re.search(r"[^\W_]",plain[start:end]):
            result.append("".join(segment).strip())
        start = end
    return result


def phrase_gap(phrase, rate=22050):
    # eSpeak omits sentence-final silence in synchronous retrieval mode.
    end = phrase.rstrip('*»”" ').rstrip()
    if end.endswith((".", "!", "?", "…")): return round(rate * .36)
    if end.endswith((",", ";", ":", "—")): return round(rate * .10)
    return round(rate * .025)
