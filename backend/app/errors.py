from .models import ErrorInfo


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, *, retryable: bool = False):
        self.status = status
        self.info = ErrorInfo(code=code, message=message, retryable=retryable)
        super().__init__(message)
