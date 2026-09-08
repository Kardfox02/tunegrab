import time
from collections import defaultdict, deque
from threading import Lock


class InMemoryRateLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._attempts: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            attempts = self._attempts[key]
            while attempts and now - attempts[0] >= self.window_seconds:
                attempts.popleft()
            if len(attempts) >= self.limit:
                return False
            attempts.append(now)
            return True
