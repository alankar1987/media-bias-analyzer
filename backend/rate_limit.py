import time
from collections import defaultdict

ANON_COOKIE_NAME = "veris_anon"
_WINDOW = 3600  # seconds


class RateLimiter:
    def __init__(self, max_per_hour: int = 5):
        self._max = max_per_hour
        self._hits: dict[str, list[float]] = defaultdict(list)

    def check_ip(self, ip: str) -> bool:
        """Return True if request is allowed, False if rate-limited. Records the hit."""
        now = time.time()
        window_start = now - _WINDOW
        hits = [t for t in self._hits[ip] if t > window_start]
        if len(hits) >= self._max:
            self._hits[ip] = hits
            return False
        hits.append(now)
        self._hits[ip] = hits
        return True


_limiter = RateLimiter()


def get_limiter() -> RateLimiter:
    return _limiter
