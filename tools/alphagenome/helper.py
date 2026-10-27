"""Local AlphaGenome helper: lets the Bench page run the candidate comparison with one click.

    python3 tools/alphagenome/rank.py --serve

The page cannot call AlphaGenome itself (the service speaks gRPC to the official client, and the API key
must not enter a browser). This small server runs on your own computer, takes the request the page builds,
runs rank.py's comparison with your key and returns the report. The key never leaves this process; the
sequence windows go from this computer to Google exactly as in a manual rank.py run.

Safeguards, because a web page is talking to a program on your machine:
- listens on 127.0.0.1 only;
- answers only the Bench origins you allow (browsers always send Origin on cross-site requests, so another
  site's page is refused), and only for Host 127.0.0.1 / localhost on this port (no DNS rebinding);
- /rank also needs the session code printed at start-up (X-Assured-Token);
- one comparison at a time, request size capped, no sequence or key in the log, no upstream error text in
  any reply.
"""
import errno
import hashlib
import hmac
import importlib.metadata
import json
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import rank
import review as single

HELPER_SCHEMA = "assured-alphagenome-helper/1"
DEFAULT_PORT = 8765
DEFAULT_ORIGINS = ("https://assured-bench.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173")
MAX_BODY = 4_000_000
NULL_DIR = Path(__file__).resolve().parents[2] / "local-reviews" / "null-cache"


def real_runtime(key):
    """(predict, model name, SDK version) for the hosted model."""
    from alphagenome.models import dna_client
    model_version = dna_client.ModelVersion.ALL_FOLDS
    client = dna_client.create(key, model_version=model_version)
    return rank.Predictor(client), model_version.name, importlib.metadata.version("alphagenome")


class HelperState:
    def __init__(self, token=None, origins=DEFAULT_ORIGINS, null_dir=NULL_DIR, key_loader=single.load_api_key,
                 runtime=real_runtime, context_fetcher=single.fetch_reference, workers=4):
        self.token = token or secrets.token_urlsafe(12)
        self.origins = tuple(origins)
        self.null_dir = Path(null_dir)
        self.key_loader = key_loader
        self.runtime = runtime
        self.context_fetcher = context_fetcher
        self.workers = workers
        self.lock = threading.Lock()
        self.port = None

    def key_configured(self):
        try:
            self.key_loader()
            return True
        except Exception:  # never surface why
            return False

    def sdk_version(self):
        try:
            return importlib.metadata.version("alphagenome")
        except importlib.metadata.PackageNotFoundError:
            return None

    def cached_nulls(self):
        return len(list(self.null_dir.glob("*.json"))) if self.null_dir.is_dir() else 0


class HelperError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def rank_request(state, request):
    """Validate, fetch context, predict (null cached on disk by its key), return the report."""
    try:
        request = rank.validate_request(request)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise HelperError(400, "invalid-request", f"The request was refused: {error}")
    try:
        key = state.key_loader()
    except Exception:
        raise HelperError(412, "no-key", "No AlphaGenome key is configured for the helper. Run tools/alphagenome/configure_key.py or set ALPHAGENOME_API_KEY, then restart it.")
    try:
        predict, model_name, sdk_version = state.runtime(key)
        start0, end0 = rank.context_interval(request)
        context = state.context_fetcher(request["chromosome"], start0, end0).upper()
        rank.validate_context(request, context)
        key_digest = rank.null_key(request, model_name, hashlib.sha256(context.encode()).hexdigest())
        path = state.null_dir / f"{key_digest}.json"
        store = None
        if path.is_file():
            try:
                store = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                store = None
        reusable = isinstance(store, dict) and store.get("nullKey") == key_digest and isinstance(store.get("null"), dict)
        report, new_store = rank.run_ranking(request, predict, context, model_name, sdk_version, store if reusable else None, state.workers)
        if not reusable:  # absent, damaged or built for something else: replace it
            state.null_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(new_store, allow_nan=False))
            os.replace(temporary, path)
        return report
    except ValueError as error:  # context mismatch, stale cache and similar: our own messages
        raise HelperError(422, "unprocessable", f"The comparison could not be run: {error}")
    except HelperError:
        raise
    except Exception as error:  # gRPC and network errors can carry request metadata; name the type only
        raise HelperError(502, "upstream", f"The prediction service did not complete the request ({type(error).__name__}). Check connectivity, ontology coverage and API access, then try again.")


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AssuredAlphaGenomeHelper/1"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # method, path and status only; never a body
            sys.stderr.write(f"[helper] {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}\n")

        def _hosts(self):
            return {f"127.0.0.1:{state.port}", f"localhost:{state.port}", f"[::1]:{state.port}"}

        def _origin(self):
            return self.headers.get("Origin")

        def _send(self, status, payload=None, origin=None, extra=None):
            body = b"" if payload is None else json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Vary", "Origin")
            if status >= 400:  # an unread request body must not leak into the next request on this connection
                self.send_header("Connection", "close")
                self.close_connection = True
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _guard(self):
            """Host and Origin checks shared by every route. Returns the origin to echo, or raises."""
            if (self.headers.get("Host") or "").lower() not in self._hosts():
                raise HelperError(403, "bad-host", "Requests must be addressed to 127.0.0.1 or localhost.")
            origin = self._origin()
            if origin is not None and origin not in state.origins:
                raise HelperError(403, "bad-origin", "This page is not allowed to use the helper.")
            return origin

        def _fail(self, error, origin=None):
            self._send(error.status, {"error": error.message, "code": error.code}, origin if error.status not in (403,) else None)

        def do_OPTIONS(self):
            try:
                origin = self._guard()
                if origin is None or self.path.split("?")[0] not in ("/health", "/rank"):
                    raise HelperError(403, "bad-origin", "Preflight refused.")
                extra = {"Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Assured-Token", "Access-Control-Max-Age": "600"}
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    extra["Access-Control-Allow-Private-Network"] = "true"
                self._send(204, None, origin, extra)
            except HelperError as error:
                self._fail(error)

        def do_GET(self):
            try:
                origin = self._guard()
                if self.path.split("?")[0] != "/health":
                    raise HelperError(404, "not-found", "Unknown route.")
                self._send(200, {"status": "ok", "schema": HELPER_SCHEMA, "keyConfigured": state.key_configured(), "sdkVersion": state.sdk_version(),
                                 "model": "ALL_FOLDS", "tokenRequired": True, "nullsCached": state.cached_nulls(), "busy": state.lock.locked()}, origin,
                           {"Access-Control-Allow-Private-Network": "true"} if origin else None)
            except HelperError as error:
                self._fail(error)

        def do_POST(self):
            origin = None
            try:
                origin = self._guard()
                if self.path.split("?")[0] != "/rank":
                    raise HelperError(404, "not-found", "Unknown route.")
                given = self.headers.get("X-Assured-Token") or ""
                if not hmac.compare_digest(given.encode(), state.token.encode()):
                    raise HelperError(401, "bad-token", "The session code is missing or wrong. Copy it from the helper's terminal.")
                try:
                    length = int(self.headers.get("Content-Length") or "")
                except ValueError:
                    raise HelperError(411, "length-required", "Content-Length is required.")
                if length <= 0 or length > MAX_BODY:
                    raise HelperError(413, "too-large", "The request is empty or larger than the helper accepts.")
                raw = self.rfile.read(length)
                try:
                    request = json.loads(raw)
                except json.JSONDecodeError:
                    raise HelperError(400, "bad-json", "The request body is not valid JSON.")
                if not state.lock.acquire(blocking=False):
                    raise HelperError(409, "busy", "Another comparison is running. Wait for it to finish.")
                started = time.time()
                try:
                    report = rank_request(state, request)
                finally:
                    state.lock.release()
                sys.stderr.write(f"[helper] comparison {str(request.get('requestId'))[:12]} finished in {time.time() - started:.1f}s\n")
                self._send(200, report, origin, {"Access-Control-Allow-Private-Network": "true"})
            except HelperError as error:
                self._fail(error, origin)

    return Handler


def make_server(state, host="127.0.0.1", port=DEFAULT_PORT):
    server = ThreadingHTTPServer((host, port), make_handler(state))
    server.daemon_threads = True
    state.port = server.server_address[1]
    return server


def serve(port=DEFAULT_PORT, origins=(), token=None, null_dir=NULL_DIR):
    state = HelperState(token=token, origins=tuple(DEFAULT_ORIGINS) + tuple(origins), null_dir=null_dir)
    try:
        server = make_server(state, "127.0.0.1", port)
    except OSError as error:
        busy = " Is another helper already running? Choose another port with --port and enter it in the page." if error.errno == errno.EADDRINUSE else ""
        sys.stderr.write(f"Could not listen on 127.0.0.1:{port} ({error.strerror or type(error).__name__}).{busy}\n")
        sys.exit(1)
    sys.stderr.write(
        f"ASSURED AlphaGenome helper listening on http://127.0.0.1:{state.port}\n"
        f"  Session code (paste into Bench): {state.token}\n"
        f"  Allowed pages: {', '.join(state.origins)}\n"
        f"  AlphaGenome key: {'configured' if state.key_configured() else 'NOT configured (run tools/alphagenome/configure_key.py or set ALPHAGENOME_API_KEY, then restart)'}\n"
        f"  Null cache: {state.null_dir}\n"
        "  Sequence windows are sent from this computer to Google for each prediction. Stop with Ctrl-C.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[helper] stopped\n")
    finally:
        server.server_close()
