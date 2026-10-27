"""Tests for the local helper. Requests are parsed by the real HTTP handler but travel over a socket pair, because opening a
listening socket is not possible in every test environment; whether the server binds to 127.0.0.1 is checked separately.
The prediction client is the fake from test_rank.py: this checks the protocol (origins, hosts, token, cache, error hygiene),
not model behaviour."""
import http.client
import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path

import helper
import rank
from test_rank import FakeClient, toy_request

ORIGIN = "https://assured-bench.vercel.app"


class HelperServer(unittest.TestCase):
    def setUp(self):
        self.request, self.context = toy_request(perk=10, ks=(1, 2))
        self.tmp = tempfile.TemporaryDirectory()
        self.clients = []
        outer = self

        def runtime(key):
            client = FakeClient(outer.request, outer.context)
            outer.clients.append(client)
            return rank.Predictor(client, outputs=list(rank.OUTPUTS), interval_factory=lambda c, s, e: (c, s, e)), "FAKE", "0"
        self.state = helper.HelperState(token="session-code-123", origins=(ORIGIN,), null_dir=Path(self.tmp.name) / "nulls",
                                        key_loader=lambda: "not-a-real-key-SECRET", runtime=runtime,
                                        context_fetcher=lambda chrom, s, e: outer.context, workers=2)
        self.state.port = 50123  # the port the page would have been given

    def tearDown(self):
        self.tmp.cleanup()

    def call(self, method, path, body=None, headers=None, host=None):
        client, server_side = socket.socketpair()
        handler = helper.make_handler(self.state)
        failures = []

        def serve():
            try:
                handler(server_side, ("127.0.0.1", 50999), None)
            except Exception as error:  # surfaced below
                failures.append(error)
            finally:
                server_side.close()
        thread = threading.Thread(target=serve, daemon=True); thread.start()
        payload = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        merged = {"Host": host or f"127.0.0.1:{self.state.port}", "Connection": "close", **(headers or {})}
        if payload is not None:
            merged.setdefault("Content-Type", "application/json"); merged.setdefault("Content-Length", str(len(payload)))
        head = f"{method} {path} HTTP/1.1\r\n" + "".join(f"{k}: {v}\r\n" for k, v in merged.items()) + "\r\n"
        client.sendall(head.encode() + (payload or b""))
        response = http.client.HTTPResponse(client); response.begin()
        data = response.read(); status, response_headers = response.status, dict(response.getheaders())
        thread.join(timeout=30); client.close()
        self.assertEqual(failures, [])
        return status, response_headers, (json.loads(data) if data else None)

    def rank(self, request=None, token="session-code-123", origin=ORIGIN):
        headers = {"X-Assured-Token": token} if token is not None else {}
        if origin:
            headers["Origin"] = origin
        return self.call("POST", "/rank", request or self.request, headers)

    def test_serve_binds_loopback_only(self):
        seen = {}

        class Stub:
            def __init__(self, address, handler):
                seen["address"] = address; self.server_address = address
            def serve_forever(self): raise KeyboardInterrupt
            def server_close(self): pass
        original, helper.ThreadingHTTPServer = helper.ThreadingHTTPServer, Stub
        try:
            helper.serve(port=9999, null_dir=Path(self.tmp.name) / "serve-nulls")
        finally:
            helper.ThreadingHTTPServer = original
        self.assertEqual(seen["address"], ("127.0.0.1", 9999))

    def test_health_for_the_allowed_page_and_nothing_secret_in_it(self):
        status, headers, body = self.call("GET", "/health", headers={"Origin": ORIGIN})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual((body["status"], body["schema"], body["keyConfigured"], body["tokenRequired"]), ("ok", helper.HELPER_SCHEMA, True, True))
        self.assertNotIn("SECRET", json.dumps(body)); self.assertNotIn("session-code", json.dumps(body))

    def test_other_pages_and_other_hosts_are_refused_without_cors_headers(self):
        status, headers, body = self.call("GET", "/health", headers={"Origin": "https://evil.example"})
        self.assertEqual(status, 403); self.assertNotIn("Access-Control-Allow-Origin", headers); self.assertEqual(body["code"], "bad-origin")
        status, headers, body = self.call("GET", "/health", headers={"Origin": ORIGIN}, host="evil.example")
        self.assertEqual((status, body["code"]), (403, "bad-host")); self.assertNotIn("Access-Control-Allow-Origin", headers)
        status, _, body = self.rank(origin="https://evil.example")
        self.assertEqual((status, body["code"]), (403, "bad-origin"))
        self.assertEqual(len(self.clients), 0, "no prediction was made for a refused page")

    def test_preflight_carries_the_private_network_header_chrome_asks_for(self):
        status, headers, _ = self.call("OPTIONS", "/rank", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST",
                                                                     "Access-Control-Request-Headers": "content-type,x-assured-token",
                                                                     "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        self.assertIn("X-Assured-Token", headers["Access-Control-Allow-Headers"]); self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        status, headers, _ = self.call("OPTIONS", "/rank", headers={"Origin": "https://evil.example", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual(status, 403); self.assertNotIn("Access-Control-Allow-Origin", headers)
        status, _, _ = self.call("OPTIONS", "/rank")  # no Origin: not a browser preflight
        self.assertEqual(status, 403)

    def test_token_is_required(self):
        for token in (None, "wrong"):
            status, _, body = self.rank(token=token)
            self.assertEqual((status, body["code"]), (401, "bad-token"))
        self.assertEqual(len(self.clients), 0)

    def test_comparison_runs_and_the_null_is_cached_on_disk(self):
        status, headers, report = self.rank()
        self.assertEqual(status, 200); self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual((report["schema"], report["requestId"], report["status"]), (rank.SCHEMA_REPORT, self.request["requestId"], "complete"))
        self.assertEqual(len(report["null"]["alleles"]), 20)
        self.assertNotIn("SECRET", json.dumps(report))
        cached = list((Path(self.tmp.name) / "nulls").glob("*.json"))
        self.assertEqual(len(cached), 1); self.assertEqual(cached[0].stem, report["nullKey"])
        first_calls = self.clients[0].calls
        status, _, again = self.rank()
        self.assertEqual(status, 200); self.assertEqual(again["null"], report["null"])
        self.assertEqual(self.clients[1].calls, first_calls - 20, "second run reuses the cached null: no null predictions")
        self.assertEqual(self.call("GET", "/health", headers={"Origin": ORIGIN})[2]["nullsCached"], 1)

    def test_a_damaged_cache_file_is_rebuilt_not_trusted(self):
        status, _, report = self.rank(); self.assertEqual(status, 200)
        (cached,) = list((Path(self.tmp.name) / "nulls").glob("*.json"))
        cached.write_text("{not json")
        status, _, again = self.rank()
        self.assertEqual(status, 200); self.assertEqual(again["null"], report["null"], "same seed, same null")
        self.assertEqual(json.loads(cached.read_text())["nullKey"], report["nullKey"], "the damaged file was replaced")
        cached.write_text("{}")  # valid JSON, wrong content
        status, _, third = self.rank(); self.assertEqual(status, 200); self.assertEqual(third["null"], report["null"])
        self.assertEqual(json.loads(cached.read_text())["nullKey"], report["nullKey"])
        self.assertFalse(list((Path(self.tmp.name) / "nulls").glob("*.tmp")), "no half-written file left behind")

    def test_bad_input_gets_a_clear_refusal(self):
        status, _, body = self.rank(request={**self.request, "contexts": ["CL:0000679"]})  # digest no longer matches
        self.assertEqual((status, body["code"]), (400, "invalid-request")); self.assertIn("SHA-256", body["error"])
        status, _, body = self.call("POST", "/rank", b"not json", {"X-Assured-Token": "session-code-123", "Origin": ORIGIN})
        self.assertEqual((status, body["code"]), (400, "bad-json"))
        status, _, body = self.call("POST", "/rank", b"", {"X-Assured-Token": "session-code-123", "Origin": ORIGIN})
        self.assertEqual((status, body["code"]), (413, "too-large"))
        status, _, body = self.call("POST", "/rank", None, {"X-Assured-Token": "session-code-123", "Origin": ORIGIN, "Content-Length": str(helper.MAX_BODY + 1)})
        self.assertEqual((status, body["code"]), (413, "too-large"))
        self.assertEqual(self.call("GET", "/nowhere", headers={"Origin": ORIGIN})[0], 404)

    def test_one_comparison_at_a_time(self):
        self.assertTrue(self.state.lock.acquire(blocking=False))
        try:
            status, _, body = self.rank()
            self.assertEqual((status, body["code"]), (409, "busy"))
            self.assertTrue(self.call("GET", "/health", headers={"Origin": ORIGIN})[2]["busy"])
        finally:
            self.state.lock.release()

    def test_missing_key_is_reported_not_guessed(self):
        def no_key():
            raise ValueError("Configure the key with tools/alphagenome/configure_key.py ...")
        self.state.key_loader = no_key
        self.assertFalse(self.call("GET", "/health", headers={"Origin": ORIGIN})[2]["keyConfigured"])
        status, _, body = self.rank()
        self.assertEqual((status, body["code"]), (412, "no-key"))

    def test_upstream_errors_never_echo_their_text_or_the_key(self):
        def boom(key):
            raise RuntimeError("grpc metadata: authorization=not-a-real-key-SECRET")
        self.state.runtime = boom
        status, _, body = self.rank()
        self.assertEqual((status, body["code"]), (502, "upstream"))
        self.assertIn("RuntimeError", body["error"]); self.assertNotIn("SECRET", json.dumps(body)); self.assertNotIn("grpc", json.dumps(body))

    def test_a_reference_that_disagrees_with_grch38_is_a_422_with_our_own_message(self):
        flipped = list(self.context); index = 9050 - 1 - rank.context_interval(self.request)[0]; flipped[index] = "A" if flipped[index] != "A" else "C"
        self.state.context_fetcher = lambda c, s, e: "".join(flipped)
        status, _, body = self.rank()
        self.assertEqual((status, body["code"]), (422, "unprocessable")); self.assertIn("disagrees", body["error"])

    def test_a_busy_port_is_explained_not_reported_as_a_ranking_failure(self):
        class Taken:
            def __init__(self, address, handler):
                raise OSError(48, "Address already in use")
        original, helper.ThreadingHTTPServer = helper.ThreadingHTTPServer, Taken
        try:
            with self.assertRaises(SystemExit) as raised:
                helper.serve(port=8765, null_dir=Path(self.tmp.name) / "n")
        finally:
            helper.ThreadingHTTPServer = original
        self.assertEqual(raised.exception.code, 1)

    def test_wire_contract_fixture_matches_what_the_helper_sends(self):
        """test/fixtures/alphagenome-helper/wire.json is what the page's tests replay. Regenerate with UPDATE_WIRE_FIXTURE=1."""
        import os
        self.state.sdk_version = lambda: "0.10.0"
        keep = lambda headers: {k: v for k, v in headers.items() if k.lower().startswith("access-control-allow-") and k.lower() != "access-control-allow-methods" or k == "Vary"}
        ok = {"Origin": ORIGIN, "X-Assured-Token": "session-code-123"}
        wire = {"origin": ORIGIN, "token": "session-code-123"}
        status, headers, body = self.call("GET", "/health", headers={"Origin": ORIGIN})
        wire["health"] = {"status": status, "headers": keep(headers), "body": body}
        status, headers, _ = self.call("OPTIONS", "/rank", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-assured-token", "Access-Control-Request-Private-Network": "true"})
        wire["preflight"] = {"status": status, "headers": {k: v for k, v in headers.items() if k.lower().startswith("access-control-")}}
        errors = {}
        def record(name, response):
            errors[name] = {"status": response[0], "code": response[2]["code"], "error": response[2]["error"]}
        record("bad-token", self.rank(token="wrong"))
        record("bad-origin", self.rank(origin="https://evil.example"))
        record("too-large", self.call("POST", "/rank", None, {**ok, "Content-Length": str(helper.MAX_BODY + 1)}))
        record("bad-json", self.call("POST", "/rank", b"nope", ok))
        self.assertTrue(self.state.lock.acquire(blocking=False))
        try:
            record("busy", self.rank())
        finally:
            self.state.lock.release()
        self.state.key_loader = lambda: (_ for _ in ()).throw(ValueError("x"))
        record("no-key", self.rank())
        errors["invalid-request"] = {"status": 400, "code": "invalid-request"}
        wire["errors"] = errors
        path = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "alphagenome-helper" / "wire.json"
        if os.environ.get("UPDATE_WIRE_FIXTURE"):
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(wire, indent=2, sort_keys=True) + "\n")
        self.assertEqual(json.loads(path.read_text()), json.loads(json.dumps(wire)), "wire fixture is stale; rerun with UPDATE_WIRE_FIXTURE=1")


if __name__ == "__main__":
    unittest.main()
