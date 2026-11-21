"""Exercise the same visitor API state transitions used by the mobile UI."""
import unittest
from unittest.mock import patch

from service import Player
from visitor import Problem, Visitors


class VisitTests(unittest.TestCase):
    def setUp(self):
        self.player = Player()
        self.player.ready = True
        self.web = Visitors(self.player)
        self.one, self.two = [self.web.request("/api/start", "")["token"] for _ in range(2)]

    def ask(self, user, key, text="Как работает приёмник?"):
        return self.web.request("/api/question", user, {"key": key, "text": text})

    def test_queue_identity_and_stop(self):
        first = self.ask(self.one, "request1")
        self.assertEqual(self.ask(self.one, "request1"), first)
        with self.assertRaises(Problem):
            self.ask(self.one, "request2")
        second = self.ask(self.two, "request1", "Кто вы?")
        self.assertEqual(second["turns"][0]["ahead"], 1)
        self.assertEqual(len(second["turns"]), 1)
        self.assertNotIn("answer", second["turns"][0])
        with patch("service.output"):
            self.player.handle({"command": "stop"})
        for user in (self.one, self.two):
            state = self.web.request("/api/session", user)
            self.assertFalse(state["online"])
            self.assertEqual(state["turns"][0]["state"], "cancelled")

    def test_limit_and_idle_expiry(self):
        for i in range(3):
            self.ask(self.one, "question" + str(i))
            key = self.player.tasks.popleft()[0]
            self.player.history[key]["state"] = "finished"
        with self.assertRaises(Problem):
            self.ask(self.one, "question4")
        self.web.sessions[self.one]["until"] = 0
        with self.assertRaises(Problem) as expired:
            self.web.request("/api/session", self.one)
        self.assertEqual(expired.exception.status, 401)


if __name__ == "__main__":
    unittest.main()
