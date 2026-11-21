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
@pytest.mark.parametrize(("language", "question", "expected"), [
    ("ru", "Кто возглавлял войска ополчения?", "Дмитрий Пожарский"),
    ("en", "How did you raise money?", "autumn of 1611"),
    ("zh", "你们何时解放莫斯科？", "一六一二年"),
    ("ru", "Какая погода на Венере?", "не могу ответить"),
])
def test_minin_can_answer_without_cloud_credentials(monkeypatch, language, question, expected):
    monkeypatch.setenv("LLM_API_KEY", "replace-with-deepseek-key")
    provider = Provider(guide="minin")
    with patch.object(provider, "post") as cloud:
        assert expected in provider.answer(question, [], language)
    cloud.assert_not_called()




def test_minin_uses_prepared_answer_if_live_provider_fails(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    provider = Provider(guide="minin")
    with patch.object(provider, "post", side_effect=httpx.ReadTimeout("timed out")) as cloud:
        assert "Дмитрий Пожарский" in provider.answer("Кто возглавлял ополчение?", [], "ru")
    messages = cloud.call_args.kwargs["json"]["messages"]
    assert "Kuzma Minin" in messages[0]["content"]
    assert "restates the visitor's latest question" in messages[0]["content"]
