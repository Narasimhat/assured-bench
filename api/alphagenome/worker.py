"""Signed internal prediction worker. Access code and API key never leave the server."""
import hashlib
import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools' / 'alphagenome'))


def signed(headers, body, secret, now=None):
    timestamp = headers.get('X-Assured-Timestamp', '')
    if not secret or len(secret) < 32 or not timestamp.isdigit() or abs((now or time.time()) * 1000 - int(timestamp)) > 300000:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b':' + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, headers.get('X-Assured-Signature', ''))


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 2400000:
            self.send_error(413)
            return
        body = self.rfile.read(length)
        if not signed(self.headers, body, os.environ.get('ASSURED_REVIEW_SECRET', '')):
            self.send_error(403)
            return
        try:
            import compare
            import review
            batch = json.loads(body)
            compare.validate_batch(batch)
            key = os.environ.get('ALPHAGENOME_API_KEY', '').strip()
            if not key:
                raise ValueError('Missing API key')
        except Exception:
            self.send_error(400)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

        def event(value):
            self.wfile.write((json.dumps(value, allow_nan=False) + '\n').encode())
            self.wfile.flush()
        try:
            from alphagenome.models import dna_client
            client = dna_client.create(key, model_version=dna_client.ModelVersion.ALL_FOLDS, timeout=60)
            result = compare.run_batch(batch, client, on_progress=lambda completed: event({'type': 'progress', 'completed': completed}))
            event({'type': 'result', 'report': result})
        except Exception:
            event({'type': 'error', 'error': 'Prediction failed; no clean result inferred.'})
