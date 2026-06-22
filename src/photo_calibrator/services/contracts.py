from __future__ import annotations


class ServiceError(RuntimeError):
    """A plugin or provider failed while executing a supported hook."""


class HookNotSupportedError(ServiceError):
    """No plugin matched the requested hook or format."""
