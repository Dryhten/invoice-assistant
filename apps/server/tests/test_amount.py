from app.amount import chinese_amount_to_decimal, decimal_to_chinese_amount


def test_chinese_amount_to_decimal() -> None:
    assert str(chinese_amount_to_decimal("捌拾伍圆捌角陆分")) == "85.86"
    assert str(chinese_amount_to_decimal("壹佰零贰元整")) == "102.00"
    assert str(chinese_amount_to_decimal("壹仟贰佰叁拾肆元伍角陆分")) == "1234.56"


def test_decimal_to_chinese_amount() -> None:
    assert decimal_to_chinese_amount("10.70") == "壹拾圆零柒角整"
    assert decimal_to_chinese_amount("23.57") == "贰拾叁圆伍角柒分"
    assert decimal_to_chinese_amount("85.86") == "捌拾伍圆捌角陆分"
    assert decimal_to_chinese_amount("102.00") == "壹佰零贰圆整"
    assert decimal_to_chinese_amount("1234.56") == "壹仟贰佰叁拾肆圆伍角陆分"
