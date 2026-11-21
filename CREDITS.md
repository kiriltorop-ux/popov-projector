# Источники

- Исторический персонаж — Александр Степанович Попов. Проекция и реплики представляют музейную реконструкцию. Текст экскурсии написан для демонстрации. Описание когерера, реле, звонка и возврата прибора в исходное состояние опирается на [карточку Политехнического музея](https://polymus.ru/collection/detail/pribor-dlya-obnaruzheniya-i-registrirovaniya-elektricheskikh-kolebaniy).
- Скульптурный референс портрета — **Alexander Stepanovich Popov**, HackSpace Taganrog. При подготовке сцены бюст адаптировался по масштабу, посадке и материалам. [Оригинальная работа](https://sketchfab.com/3d-models/alexander-stepanovich-popov-74e03ff919db4582af2553bac3c8c768) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Портрет в пульте — художественная 2D-реконструкция с подготовленными положениями губ и век. Референсы образа включают [фотографии из архива Е. Ю. Рыбкиной](https://radi0.ru/foto-i-video/fotografii-iz-lichnogo-arhiva-e-yu-rybkinoj/). Для фасада использованы визуальные материалы исходного проекта «Город говорит».
- Русский мужской голос «Денис» синтезируется локально в Piper с помощью ONNX Runtime. eSpeak NG переводит текст в фонемы. В карточке голоса для обучающего набора указана лицензия CC0. [Модель и карточка голоса](https://huggingface.co/rhasspy/piper-voices/tree/0ca208afc2a2ee102b1e961e72e0a7e4907be3d0/ru/ru_RU/denis/medium) · [Piper](https://github.com/OHF-Voice/piper1-gpl)
- Распознавание коротких записей выполняет whisper.cpp через pywhispercpp с мультиязычной моделью Whisper base Q5. [Сборка модели](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin)

Сюжет Минина «История рядом» включён из пользовательского видеоматериала.
Положения лица и корпуса используют подготовленные для проекта иллюстрации Минина.
