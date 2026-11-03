import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / 'infra' / 'linux' / 'deploy-release.sh'

class DeployStdinTests(unittest.TestCase):
    def test_streamed_backup_cannot_consume_following_script(self):
        script = SCRIPT.read_text(encoding='utf-8')
        line = next(line for line in script.splitlines() if 'run --rm --no-deps station ' in line)
        self.assertIn('< /dev/null', line)
        simulated = line.replace('compose "$release" run --rm --no-deps station /srv/station/station-server --backup "$station_backup"', 'cat').replace('"$station_backup"', 'backup')
        result = subprocess.run(['bash', '-s'], input=simulated + '\nprintf "reached-after-backup\\n"\n', text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout, 'reached-after-backup\n')
