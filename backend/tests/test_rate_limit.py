import time
from rate_limit import RateLimiter, ANON_COOKIE_NAME

def test_ip_under_limit():
    rl = RateLimiter(max_per_hour=5)
    for _ in range(5):
        assert rl.check_ip("1.2.3.4") is True

def test_ip_over_limit():
    rl = RateLimiter(max_per_hour=5)
    for _ in range(5):
        rl.check_ip("1.2.3.4")
    assert rl.check_ip("1.2.3.4") is False

def test_different_ips_independent():
    rl = RateLimiter(max_per_hour=2)
    rl.check_ip("1.1.1.1")
    rl.check_ip("1.1.1.1")
    assert rl.check_ip("2.2.2.2") is True

def test_cookie_name_constant():
    assert ANON_COOKIE_NAME == "veris_anon"
