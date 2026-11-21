from unittest.mock import patch

import pytest

from server.test_app import running, start, ask


@pytest.mark.parametrize("route", ["question", "session"])
def test_finished_playback_between_authentication_and_quota_read(route):
    with running() as client:
        user=start(client)
        store=client.app.state.store
        store.db.execute("UPDATE sessions SET spent=2")
        original=store.rows
        advanced=False

        def rows(sql,args=()):
            nonlocal advanced
            result=original(sql,args)
            if not advanced and sql=="SELECT * FROM sessions WHERE id=?":
                # The station finishes the third reply after authentication,
                # before the visitor's endpoint checks its remaining quota.
                advanced=True
                store.db.execute("UPDATE sessions SET spent=3")
            return result

        with patch.object(store,"rows",side_effect=rows):
            response=ask(client,user) if route=="question" else client.get("/api/session",headers=user)
        assert advanced
        if route=="question":
            assert response.status_code==409
            assert not original("SELECT id FROM jobs")
        else:
            assert response.status_code==200
            assert response.json()["remaining"]==0
            assert response.json()["can_send"] is False
