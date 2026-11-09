import re

_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
_HEX = re.compile(r"\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b")
_NUM = re.compile(r"\d+(?:\.\d+)?")
_WS = re.compile(r"\s+")


def fingerprint(message: str) -> str:
    """Normalize a message so messages of the same shape share a fingerprint."""
    text = message.lower()
    text = _UUID.sub("<id>", text)
    text = _HEX.sub("<id>", text)
    text = _NUM.sub("<n>", text)
    return _WS.sub(" ", text).strip()
