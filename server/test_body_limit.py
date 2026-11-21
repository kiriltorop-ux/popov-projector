import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.test_app import FakeProvider


@pytest.fixture
def client():
    app=create_app(":memory:",FakeProvider(),"q"*32,"s"*32,"http://127.0.0.1:8000")
    with TestClient(app) as value:
        yield value


@pytest.mark.parametrize("length", [None, "1"])
def test_actual_stream_is_bounded_even_with_missing_or_false_length(client,length):
    def body():
        yield b'{"admission":"'
        yield b'x'*(10*1024*1024+1)
        yield b'","client_id":"a-valid-client-identity"}'
    headers={"Content-Type":"application/json"}
    if length is not None:headers["Content-Length"]=length
    result=client.post('/api/start',content=body(),headers=headers)
    assert result.status_code==413
    assert result.json()['error']=='Слишком большой запрос.'


def test_large_length_header_does_not_crash_integer_conversion(client):
    result=client.post('/api/start',content=b'{}',headers={"Content-Type":"application/json","Content-Length":"9"*5000})
    assert result.status_code==413


def test_short_chunked_json_still_reaches_validation(client):
    result=client.post('/api/start',content=iter([b'{"admission":"bad",',b'"client_id":"a-valid-client-identity"}']),headers={"Content-Type":"application/json"})
    assert result.status_code==401
