from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP

CN_DIGITS = {
    "零": 0,
    "〇": 0,
    "壹": 1,
    "一": 1,
    "贰": 2,
    "貳": 2,
    "二": 2,
    "两": 2,
    "兩": 2,
    "叁": 3,
    "參": 3,
    "三": 3,
    "肆": 4,
    "四": 4,
    "伍": 5,
    "五": 5,
    "陆": 6,
    "陸": 6,
    "六": 6,
    "柒": 7,
    "七": 7,
    "捌": 8,
    "八": 8,
    "玖": 9,
    "九": 9,
}

SMALL_UNITS = {"拾": 10, "十": 10, "佰": 100, "百": 100, "仟": 1000, "千": 1000}
SECTION_UNITS = {"万": 10_000, "萬": 10_000, "亿": 100_000_000, "億": 100_000_000}
UPPER_DIGITS = "零壹贰叁肆伍陆柒捌玖"
UPPER_UNITS = ["", "拾", "佰", "仟"]
UPPER_SECTIONS = ["", "万", "亿", "兆"]
AMOUNT_CHARS = "零〇壹一贰貳二两兩叁參三肆四伍五陆陸六柒七捌八玖九拾十佰百仟千万萬亿億元圆角分整正"


def clean_amount_text(text: str) -> str:
    value = (
        text.strip()
        .replace("人民币", "")
        .replace("（", "")
        .replace("）", "")
        .replace("(", "")
        .replace(")", "")
        .replace("：", "")
        .replace(":", "")
        .replace(" ", "")
        .replace("\u3000", "")
    )
    value = value.replace("圓", "圆").replace("圜", "圆").replace("块", "元")
    return value


def _parse_integer_section(section: str) -> int:
    total = 0
    number = 0
    for char in section:
        if char in CN_DIGITS:
            number = CN_DIGITS[char]
        elif char in SMALL_UNITS:
            unit = SMALL_UNITS[char]
            total += (number or 1) * unit
            number = 0
        elif char in ("零", "〇"):
            number = 0
    return total + number


def parse_chinese_integer(text: str) -> int:
    total = 0
    section = ""
    for char in text:
        if char in SECTION_UNITS:
            total += _parse_integer_section(section) * SECTION_UNITS[char]
            section = ""
        else:
            section += char
    return total + _parse_integer_section(section)


def chinese_amount_to_decimal(text: str) -> Decimal:
    value = clean_amount_text(text)
    if not value:
        raise ValueError("empty amount text")

    yuan_match = re.search(r"[元圆]", value)
    if yuan_match:
        integer_part = value[: yuan_match.start()]
        fraction_part = value[yuan_match.end() :]
    else:
        jiao_index = value.find("角")
        fen_index = value.find("分")
        split_at = min([i for i in [jiao_index, fen_index] if i >= 0], default=len(value))
        integer_part = value[:split_at]
        fraction_part = value[split_at:]

    integer = parse_chinese_integer(integer_part) if integer_part else 0
    cents = 0

    jiao_match = re.search(rf"([{AMOUNT_CHARS}])角", fraction_part)
    fen_match = re.search(rf"([{AMOUNT_CHARS}])分", fraction_part)
    if jiao_match:
        cents += CN_DIGITS.get(jiao_match.group(1), 0) * 10
    if fen_match:
        cents += CN_DIGITS.get(fen_match.group(1), 0)

    return (Decimal(integer) + Decimal(cents) / Decimal(100)).quantize(Decimal("0.01"))


def normalize_amount_string(amount: Decimal | str | int | float) -> str:
    decimal = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{decimal:.2f}"


def amount_to_cents(amount: Decimal | str | int | float) -> int:
    decimal = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(decimal * 100)


def cents_to_amount(cents: int) -> str:
    return normalize_amount_string(Decimal(cents) / Decimal(100))


def _integer_to_upper(value: int) -> str:
    if value == 0:
        return "零"

    sections: list[int] = []
    while value:
        sections.append(value % 10_000)
        value //= 10_000

    parts: list[str] = []
    need_zero = False
    for index in range(len(sections) - 1, -1, -1):
        section = sections[index]
        if section == 0:
            need_zero = True
            continue
        section_text = _section_to_upper(section)
        if need_zero and parts and not parts[-1].endswith("零"):
            parts.append("零")
        parts.append(section_text + UPPER_SECTIONS[index])
        need_zero = section < 1000
    return "".join(parts).rstrip("零")


def _section_to_upper(section: int) -> str:
    result = ""
    zero = False
    digits = [section // 1000, section // 100 % 10, section // 10 % 10, section % 10]
    for pos, digit in enumerate(digits):
        unit_index = 3 - pos
        if digit == 0:
            zero = bool(result)
            continue
        if zero:
            result += "零"
            zero = False
        result += UPPER_DIGITS[digit] + UPPER_UNITS[unit_index]
    return result


def decimal_to_chinese_amount(amount: Decimal | str | int | float) -> str:
    cents = amount_to_cents(amount)
    if cents < 0:
        raise ValueError("amount must not be negative")

    integer = cents // 100
    fraction = cents % 100
    jiao = fraction // 10
    fen = fraction % 10

    result = _integer_to_upper(integer) + "圆"
    if fraction == 0:
        return result + "整"
    if jiao:
        if integer > 0 and integer % 10 == 0:
            result += "零"
        result += UPPER_DIGITS[jiao] + "角"
        if fen == 0:
            result += "整"
    elif integer and fen:
        result += "零"
    if fen:
        result += UPPER_DIGITS[fen] + "分"
    return result
