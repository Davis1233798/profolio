import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / 'infra' / 'linux' / 'compose.stations.yaml'

class ReleaseComposeRevisionTests(unittest.TestCase):
    def test_release_env_file_reaches_station_build_argument(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / 'base.env'
            revision = Path(directory) / 'revision.env'
            base.write_text('GATEWAY_TOKEN=isolated-test-token\n', encoding='utf-8')
            revision.write_text('SUITE_RELEASE_SHA=' + 'a' * 40 + '\n', encoding='utf-8')
            result = subprocess.run(['docker', 'compose', '--env-file', str(base), '--env-file', str(revision), '-f', str(COMPOSE), 'config', '--format', 'json'], cwd=ROOT, check=True, capture_output=True, text=True)
            config = json.loads(result.stdout)
            self.assertEqual(config['services']['station']['build']['args']['SUITE_RELEASE_SHA'], 'a' * 40)
