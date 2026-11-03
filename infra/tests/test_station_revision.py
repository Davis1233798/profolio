import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'check-station-revision.py'
SHA = 'a' * 40

class StationRevisionCheckTests(unittest.TestCase):
    def check(self, payload):
        return subprocess.run([sys.executable, str(SCRIPT), SHA], input=payload, text=True, capture_output=True).returncode

    def test_ready_matching_revision_is_accepted(self):
        self.assertEqual(self.check(json.dumps({'success': True, 'data': {'backend':'go','status':'ready','revision': SHA}})), 0)

    def test_bad_or_wrong_health_is_rejected(self):
        for payload in ['not json', '{}', json.dumps({'success': True, 'data': {'backend':'go','status':'ready','revision':'b'*40}}), json.dumps({'success': True,'data': {'backend':'go','status':'down','revision':SHA}}), json.dumps({'success': False,'data': {'backend':'go','status':'ready','revision':SHA}})]:
            with self.subTest(payload=payload):
                self.assertNotEqual(self.check(payload), 0)
