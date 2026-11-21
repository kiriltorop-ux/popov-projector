import os
from pathlib import Path
import time

import httpx
import pytest

from server.configure_local import configure
from server.local import LocalServer, valid_public_url
from server.test_app import FakeProvider


def test_installer_keeps_existing_credentials_and_enables_local_mode(tmp_path):
    (tmp_path / ".env").write_text("LLM_API_KEY=existing-llm\nASR_API_KEY=existing-asr\n", encoding="utf-8")
    configure(tmp_path)
    first = (tmp_path / ".env").read_text(encoding="utf-8")
    assert "LLM_API_KEY=existing-llm\n" in first
    assert "ASR_API_KEY=existing-asr\n" in first
    assert "replace-with" not in first
    assert "QR_SECRET=" in first
    assert (tmp_path / "station.env").read_text() == "POPOV_LOCAL_SERVER=1\n"
    configure(tmp_path)
    assert (tmp_path / ".env").read_text(encoding="utf-8") == first


def test_installer_replaces_public_example_secrets_without_changing_api_key(tmp_path):
    (tmp_path / ".env").write_text("LLM_API_KEY=existing-api-key\nQR_SECRET=replace-with-secret\nSTATION_KEY=\n", encoding="utf-8")
    configure(tmp_path)
    values = dict(line.split("=", 1) for line in (tmp_path / ".env").read_text().splitlines() if "=" in line)
    assert values["LLM_API_KEY"] == "existing-api-key"
    assert len(values["QR_SECRET"]) == 64
    assert len(values["STATION_KEY"]) == 64
    assert values["QR_SECRET"] != values["STATION_KEY"]


@pytest.mark.parametrize("url,expected", [
    ("http://192.168.1.10:18776", True),
    ("http://10.0.0.2:18776", True),
    ("http://popov.local:18776", True),
    ("http://127.0.0.1:8000", True),
    ("https://popov.example.org", True),
    ("http://8.8.8.8:8000", False),
    ("http://0.0.0.0:18776", False),
    ("http://192.168.1.10:18776/path", False),
    ("http://user:password@192.168.1.10:18776", False),
    ("file:///etc/passwd", False),
])
def test_local_url_policy(url, expected):
    assert valid_public_url(url) is expected


def test_same_computer_real_http_and_projector_bridge(monkeypatch, tmp_path):
    monkeypatch.setenv("QR_SECRET", "q"*32)
    monkeypatch.setenv("STATION_KEY", "s"*32)
    monkeypatch.setenv("POPOV_LAN_HOST", "127.0.0.1")
    monkeypatch.setenv("DATABASE", str(tmp_path / "queue.sqlite3"))
    monkeypatch.delenv("POPOV_LOCAL_PUBLIC_URL", raising=False)
    monkeypatch.setenv("POPOV_SERVER_URL", "unused-before-local-launch")
    monkeypatch.setenv("POPOV_STATION_KEY", "unused-before-local-launch")
    provider = FakeProvider()
    api = LocalServer(tmp_path, port=0, provider=provider)
    try:
        assert os.environ["POPOV_SERVER_URL"] == api.bridge_url
        with httpx.Client(base_url=api.bridge_url, timeout=3, trust_env=False) as client:
            station = {"Authorization": "Bearer " + "s"*32}
            poll = client.post("/station/poll", headers=station, json={"ready": True}).json()
            assert poll["url"].startswith(api.public_url + "/popov.html#join=")
            assert client.get("/popov.html").status_code == 200
            assert client.get("/.env").status_code == 404
            code = poll["url"].split("#join=")[1]
            joined = client.post("/api/start", json={"admission": code, "client_id": "local-phone-identity", "language": "fr", "voice": "nova"})
            assert joined.status_code == 200
            visitor = {"Authorization": "Bearer " + joined.json()["token"]}
            result = client.post("/api/question", headers=visitor, json={"key": "local-question-1", "text": "Comment fonctionne la radio?"})
            assert result.status_code == 200
            deadline = time.monotonic()+4
            job = None
            while time.monotonic() < deadline:
                poll = client.post("/station/poll", headers=station, json={"ready": True}).json()
                if poll.get("job"):
                    job = poll["job"]
                    break
                time.sleep(.03)
            assert job and job["pcm"] and job["sample_rate"] == 22050
            assert provider.calls[1] == ("fr", "nova")
            assert client.post("/station/jobs/"+job["id"], headers=station, json={"state": "finished"}).status_code == 200
            assert client.get("/api/session", headers=visitor).json()["turns"][0]["state"] == "finished"
    finally:
        api.close()
    assert not api.thread.is_alive()


def test_local_server_restarts_on_the_same_port(monkeypatch, tmp_path):
    monkeypatch.setenv("QR_SECRET", "q"*32)
    monkeypatch.setenv("STATION_KEY", "s"*32)
    monkeypatch.setenv("POPOV_LAN_HOST", "127.0.0.1")
    monkeypatch.setenv("DATABASE", ":memory:")
    monkeypatch.delenv("POPOV_LOCAL_PUBLIC_URL", raising=False)
    api = LocalServer(tmp_path, port=0, provider=FakeProvider())
    port = api.socket.getsockname()[1]
    with httpx.Client(trust_env=False) as client:
        try:
            assert client.get(api.bridge_url + "/health").is_success
        finally:
            api.close()
    restarted = LocalServer(tmp_path, port=port, provider=FakeProvider())
    try:
        assert restarted.bridge_url == f"http://127.0.0.1:{port}"
    finally:
        restarted.close()
