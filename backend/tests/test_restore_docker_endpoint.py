"""Local Desktop support verifies the effective Unix endpoint, never its label alone."""

import importlib
import json
import os
import socket
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
drill = importlib.import_module("isolated_restore_drill")


@pytest.fixture()
def engine_context(monkeypatch):
    for key in ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]:
        monkeypatch.delenv(key, raising=False)
    # Darwin limits AF_UNIX paths to 104 bytes; long pytest temp names exceed
    # that before the engine guard runs. Use an owned, short-lived short path.
    with tempfile.TemporaryDirectory(prefix="od-", dir="/tmp") as scratch:
        home = Path(scratch)
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
        endpoint = home / ".docker/run/docker.sock"
        endpoint.parent.mkdir(parents=True)
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(endpoint))
        state = {"context": "desktop-linux", "host": "unix://" + str(endpoint), "calls": []}
        def execute(args, **kwargs):
            state["calls"].append(args)
            assert args[:2] == ["docker", "context"]
            output = state["context"].encode() if args[2] == "show" else json.dumps(state["host"]).encode()
            return SimpleNamespace(returncode=0, stdout=output)
        monkeypatch.setattr(drill, "safe_execute", execute)
        try:
            yield state, endpoint
        finally:
            server.close()


@pytest.mark.parametrize("context", ["default", "desktop-linux"])
def test_local_operator_owned_desktop_socket_is_accepted(engine_context, context):
    state, _ = engine_context
    state["context"] = context
    drill.require_local_docker_engine()
    assert state["calls"][1][:4] == ["docker", "context", "inspect", context]


@pytest.mark.parametrize("host", [
    "tcp://remote.example:2375", "ssh://remote.example", "https://remote.example",
    "npipe:////./pipe/docker_engine", "unix:///tmp/arbitrary-engine.sock",
])
def test_context_label_cannot_hide_remote_or_arbitrary_endpoint(engine_context, host):
    state, _ = engine_context
    state["host"] = host
    with pytest.raises(drill.DrillFailure):
        drill.require_local_docker_engine()


def test_unknown_context_is_rejected_before_endpoint_access(engine_context):
    state, _ = engine_context
    state["context"] = "remote-production"
    with pytest.raises(drill.DrillFailure):
        drill.require_local_docker_engine()
    assert len(state["calls"]) == 1


def test_missing_socket_and_foreign_owner_are_rejected(engine_context, monkeypatch):
    state, endpoint = engine_context
    original = Path.stat
    def foreign_owner(path, *args, **kwargs):
        info = original(path, *args, **kwargs)
        if path == endpoint:
            fields = list(info)
            fields[4] = 123456
            return os.stat_result(fields)
        return info
    monkeypatch.setattr(Path, "stat", foreign_owner)
    with pytest.raises(drill.DrillFailure, match="current operator"):
        drill.require_local_docker_engine()
    monkeypatch.setattr(Path, "stat", original)
    endpoint.unlink()
    with pytest.raises(drill.DrillFailure, match="socket"):
        drill.require_local_docker_engine()
