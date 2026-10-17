"""The chat on the API: what each message costs and the usage log. Run from the project folder:
python -m unittest discover tests"""
import csv
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import coach  # noqa: E402

HAIKU, SONNET = coach.MODELS["haiku"], coach.MODELS["sonnet"]


def response(model, text="Done.", input_tokens=2000, output=300, write=0, read=8000):
    usage = SimpleNamespace(input_tokens=input_tokens, output_tokens=output, cache_creation_input_tokens=write,
                            cache_read_input_tokens=read)
    block = SimpleNamespace(to_dict=lambda: {"type": "text", "text": text})
    return SimpleNamespace(model=model, usage=usage, stop_reason="end_turn", content=[block])


class Cost(unittest.TestCase):
    def test_haiku(self):
        # 2000 in at $0.10, 300 out at $0.50, 1000 written at $0.125, 8000 read at $0.01 per million
        self.assertAlmostEqual(coach.cost(HAIKU, 2000, 300, 1000, 8000), (200 + 150 + 125 + 80) / 1e6)

    def test_sonnet_is_twenty_times_haiku(self):
        self.assertAlmostEqual(coach.cost(SONNET, 2000, 300, 0, 0), 20 * coach.cost(HAIKU, 2000, 300, 0, 0))

    def test_haiku_long_prompt_costs_five_times_more(self):
        self.assertAlmostEqual(coach.cost(HAIKU, 101_000, 100, 0, 0), 5 * (101_000 * 0.10 + 100 * 0.50) / 1e6)

    def test_unknown_model_priced_as_the_chat_model(self):
        self.assertEqual(coach.cost("claude-something", 1000, 0, 0, 0), coach.cost(coach.MODEL, 1000, 0, 0, 0))


class UsageLog(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        for target, value in (("USAGE_LOG", Path(self.dir.name) / "chat_usage.csv"), ("MODEL", HAIKU),
                              ("backend", lambda: "api")):
            patcher = mock.patch.object(coach, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def send(self, *responses):
        client = mock.Mock()
        client.messages.create.side_effect = list(responses)
        chat = {"messages": []}
        with mock.patch.object(coach.anthropic, "Anthropic", return_value=client), \
                mock.patch.object(coach, "state", return_value="note"):
            out = coach._send_api(chat, "Make tomorrow a rest day", lambda: {}, date.today(), None)
        return out, client

    def test_a_message_is_logged_with_its_price(self):
        (reply, error, used), client = self.send(response(HAIKU))
        self.assertEqual((reply, error), ("Done.", None))
        self.assertNotIn("fallbacks", client.messages.create.call_args.kwargs)  # Haiku has no fallback model
        self.assertEqual(used["tokens"], 10_300)
        with open(coach.USAGE_LOG, newline="") as f:
            rows = list(csv.DictReader(f))
        self.assertEqual([(r["model"], r["rounds"], r["input"], r["cache_read"], r["output"]) for r in rows],
                         [(HAIKU, "1", "2000", "8000", "300")])
        self.assertAlmostEqual(float(rows[0]["cost_usd"]), coach.cost(HAIKU, 2000, 300, 0, 8000), places=6)

    def test_month_total(self):
        self.send(response(HAIKU))
        self.send(response(HAIKU))
        self.assertAlmostEqual(coach.usage()["month_cost"], round(2 * coach.cost(HAIKU, 2000, 300, 0, 8000), 4))
        self.assertEqual(coach.usage()["model"], HAIKU)
        self.assertEqual(coach.usage(date(2020, 1, 1))["month_cost"], 0)

    def test_a_message_is_priced_on_both_models(self):
        (_, _, used), _ = self.send(response(HAIKU))
        self.assertAlmostEqual(used["haiku"], used["cost"])
        self.assertAlmostEqual(used["sonnet"], coach.cost(SONNET, 2000, 300, 0, 8000))

    def test_claude_code_is_priced_as_the_api_would(self):
        models = {SONNET: {"inputTokens": 2000, "outputTokens": 300, "cacheCreationInputTokens": 0,
                           "cacheReadInputTokens": 8000}}
        with mock.patch.object(coach, "_run_cli", return_value=({"reply": "Done.", "actions": []}, "s1", models)), \
                mock.patch.object(coach, "state", return_value="note"):
            reply, error, used = coach._send_cli({}, "Hi", lambda: {}, date.today(), None)
        self.assertEqual((reply, error, used["cost"]), ("Done.", None, None))  # the subscription pays
        with open(coach.USAGE_LOG, newline="") as f:
            row = next(csv.DictReader(f))
        self.assertEqual((row["backend"], row["model"], row["cost_usd"]), ("claude_code", SONNET, ""))
        self.assertAlmostEqual(float(row["haiku_usd"]), coach.cost(HAIKU, 2000, 300, 0, 8000), places=6)
        self.assertAlmostEqual(float(row["sonnet_usd"]), coach.cost(SONNET, 2000, 300, 0, 8000), places=6)
        with mock.patch.object(coach, "backend", lambda: "claude_code"):
            month = coach.usage()
        self.assertEqual((month["backend"], month["model"], month["month_cost"]), ("claude_code", None, 0))
        self.assertAlmostEqual(month["month_sonnet"], round(coach.cost(SONNET, 2000, 300, 0, 8000), 4))

    def test_no_log_without_an_answer(self):
        (_, error, used), _ = self.send(coach.anthropic.APIConnectionError(request=mock.Mock()))
        self.assertIsNone(used)
        self.assertTrue(error)
        self.assertFalse(coach.USAGE_LOG.exists())


if __name__ == "__main__":
    unittest.main()
