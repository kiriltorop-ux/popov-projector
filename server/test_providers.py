from unittest.mock import patch

import httpx
import pytest

from server.providers import Provider


def request_with_outcomes(outcomes):
    calls = []
    actual_client = httpx.Client
    def handle(request):
        calls.append(request)
        outcome = outcomes[min(len(calls)-1, len(outcomes)-1)]
        if isinstance(outcome, Exception):
            raise outcome
        return httpx.Response(outcome, json={"ok": True})
    transport = httpx.MockTransport(handle)
    def client(**kwargs):
        return actual_client(transport=transport, **kwargs)
    provider = Provider.__new__(Provider)
    provider.key = "test-only-key"
    provider.base = "https://example.invalid"
    return provider, calls, client


def test_llm_recovers_from_two_abrupt_connection_closures():
    provider, calls, client = request_with_outcomes([
        httpx.RemoteProtocolError("connection closed"), httpx.ReadTimeout("read timed out"), 200])
    with patch("server.providers.httpx.Client", side_effect=client), patch("server.providers.time.sleep"):
        assert provider.post("/chat/completions", json={"messages": []}).status_code == 200
    assert len(calls) == 3


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_llm_recovers_from_transient_http_errors(status):
    provider, calls, client = request_with_outcomes([status, 200])
    with patch("server.providers.httpx.Client", side_effect=client), patch("server.providers.time.sleep"):
        assert provider.post("/chat/completions", json={}).status_code == 200
    assert len(calls) == 2


@pytest.mark.parametrize("status", [400, 401, 402, 403])
def test_llm_does_not_retry_permanent_errors(status):
    provider, calls, client = request_with_outcomes([status])
    with patch("server.providers.httpx.Client", side_effect=client), patch("server.providers.time.sleep"):
        with pytest.raises(httpx.HTTPStatusError):
            provider.post("/chat/completions", json={})
    assert len(calls) == 1


def test_llm_stops_after_three_failed_attempts():
    provider, calls, client = request_with_outcomes([httpx.RemoteProtocolError("connection closed")])
    with patch("server.providers.httpx.Client", side_effect=client), patch("server.providers.time.sleep"):
        with pytest.raises(httpx.RemoteProtocolError):
            provider.post("/chat/completions", json={})
    assert len(calls) == 3
