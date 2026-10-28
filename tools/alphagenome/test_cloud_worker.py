import hashlib
import hmac
import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('cloud_worker', Path(__file__).resolve().parents[2] / 'api' / 'alphagenome' / 'worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class CloudWorkerTests(unittest.TestCase):
    def test_signed_internal_requests_are_bound_to_body_and_time(self):
        secret = 's' * 48
        body = b'{"test":1}'
        timestamp = '1000000'
        signature = hmac.new(secret.encode(), timestamp.encode() + b':' + body, hashlib.sha256).hexdigest()
        headers = {'X-Assured-Timestamp': timestamp, 'X-Assured-Signature': signature}
        self.assertTrue(worker.signed(headers, body, secret, now=1000))
        self.assertFalse(worker.signed(headers, body+b' ', secret, now=1000))
        self.assertFalse(worker.signed(headers, body, secret, now=2000))
        self.assertFalse(worker.signed(headers, body, '', now=1000))
        self.assertFalse(worker.signed({}, body, secret, now=1000))

    def test_review_secret_falls_back_to_derived_secret(self):
        env = {'ALPHAGENOME_API_KEY': 'test-only', 'ASSURED_REVIEW_ACCESS_HASH': 'a' * 64}
        derived = worker.review_secret(env)
        self.assertEqual(len(derived), 64)
        self.assertEqual(worker.review_secret({**env, 'ASSURED_REVIEW_SECRET': 'short'}), derived)
        self.assertEqual(worker.review_secret({**env, 'ASSURED_REVIEW_SECRET': 'x' * 48}), 'x' * 48)
        self.assertEqual(worker.review_secret({'ALPHAGENOME_API_KEY': 'test-only'}), '')
