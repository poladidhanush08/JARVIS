from jarvis.fingerprint import fingerprint


def test_numbers_become_placeholder():
    assert fingerprint("DB timeout after 2000ms on user-db") == "db timeout after <n>ms on user-db"


def test_ids_and_hex_stripped():
    assert fingerprint("request 9f8e7d6c5b4a failed for user 42") == "request <id> failed for user <n>"
    assert fingerprint("trace 123e4567-e89b-12d3-a456-426614174000 lost") == "trace <id> lost"


def test_same_shape_same_fingerprint():
    assert fingerprint("pool at 95% (190/200)") == fingerprint("pool at 97% (194/200)")
