"""Transport abstractions."""

from __future__ import annotations

from abc import ABC, abstractmethod


class Transport(ABC):
    @abstractmethod
    def open(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def send(self, payload: bytes, *, expected_reply_length: int = 0) -> int:
        raise NotImplementedError

    @abstractmethod
    def recv(self, length: int) -> bytes:
        raise NotImplementedError

    def transact(self, payload: bytes, *, reply_length: int = 0) -> bytes:
        self.send(payload, expected_reply_length=reply_length)
        if reply_length <= 0:
            return b""
        return self.recv(reply_length)

