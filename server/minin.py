"""Short museum answers used by the Minin station without a cloud key."""
import re


TOPICS = {
    "commander": r"пожарск|княз|возглав|команд|pozharsky|commander|led the|prince|波扎尔斯基|统帅",
    "moscow": r"москв|освобожд|1612|moscow|liberat|莫斯科|解放",
    "militia": r"ополчен|деньг|средств|собра|пожертв|купец|1611|militia|fund|money|donat|民兵|义勇军|捐",
    "intro": r"кто вы|кто ты|кто такой минин|вас зовут|тебя зовут|здравств|привет|who are you|your name|hello|你是谁|名字|你好",
}
ANSWERS = {
    "ru": {
        "intro": "Я Кузьма Минин. Помог собрать и снарядить народное ополчение в Нижнем Новгороде.",
        "militia": "Осенью 1611 года я предложил нижегородцам собрать средства на ополчение. Горожане помогали кто чем мог, чтобы снарядить и содержать ратников.",
        "commander": "Ополчение возглавил князь Дмитрий Пожарский. Я же занимался сбором средств и снаряжением ратников.",
        "moscow": "В 1612 году наше ополчение пришло к Москве и помогло освободить город.",
        "unknown": "Об этом я не могу ответить уверенно. Спросите, как нижегородцы собрали ополчение или какую роль сыграл князь Пожарский.",
    },
    "en": {
        "intro": "I'm Kuzma Minin. I helped raise and equip the people's militia in Nizhny Novgorod.",
        "militia": "In the autumn of 1611, I asked the people of Nizhny Novgorod to raise funds for the militia. The townspeople gave what they could to equip and support the troops.",
        "commander": "Prince Dmitry Pozharsky led the militia. I helped raise money and equip the troops.",
        "moscow": "In 1612, our militia reached Moscow and helped liberate the city.",
        "unknown": "I can't answer that with confidence. You can ask how Nizhny Novgorod raised the militia or what role Prince Pozharsky played.",
    },
    "zh": {
        "intro": "我是库兹马·米宁。我在下诺夫哥罗德协助筹建义勇军。",
        "militia": "一六一一年秋，我号召下诺夫哥罗德居民为义勇军筹款。市民尽己所能，帮助装备和供养士兵。",
        "commander": "义勇军由德米特里·波扎尔斯基亲王统领。我负责筹措资金和装备。",
        "moscow": "一六一二年，我们的义勇军抵达莫斯科，协助解放了这座城市。",
        "unknown": "这个问题我无法确定。您可以问下诺夫哥罗德如何组建义勇军，或者波扎尔斯基亲王发挥了什么作用。",
    },
}


def local_answer(question, language):
    answers = ANSWERS[language]
    normalized = question.casefold().replace("ё", "е")
    topic = next((name for name, pattern in TOPICS.items() if re.search(pattern, normalized)), "unknown")
    return answers[topic]
