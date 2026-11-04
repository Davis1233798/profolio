import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'linux' / 'configure-google-oauth.py'
ORIGIN = 'https://portfolio.example.test'
SECRET = 'synthetic$NOT_EXPANDED#quote\'"\\opaque'

class GooglePrivateConfigTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.target = self.root / 'infra.env'
        self.original = 'BASE_DOMAIN=portfolio.example.test\nBETTER_AUTH_URL='+ORIGIN+'\nBETTER_AUTH_SECRET=keep-private-auth-secret\n'
        self.target.write_text(self.original)
        self.target.chmod(0o600)

    def payload(self):
        return {'web': {'client_id': '123-test.apps.googleusercontent.com', 'client_secret': SECRET, 'redirect_uris': [ORIGIN+'/api/workspace-auth/callback/google']}}

    def run_cli(self, payload=None, flags=(), raw=None):
        return subprocess.run([sys.executable, str(SCRIPT), '--env-file', str(self.target), *flags], input=raw if raw is not None else json.dumps(payload if payload is not None else self.payload()), text=True, capture_output=True)

    def test_import_roundtrips_through_real_compose_without_secret_output(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(SECRET, result.stdout+result.stderr)
        self.assertIn('BETTER_AUTH_SECRET=keep-private-auth-secret', self.target.read_text())
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)
        compose = self.root / 'compose.yaml'
        compose.write_text('services:\n  config-check:\n    image: alpine:3.21\n    environment:\n      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}\n      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}\n')
        env = {k:v for k,v in os.environ.items() if k not in ('GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET')}
        parsed = subprocess.run(['docker','compose','--env-file',str(self.target),'-f',str(compose),'config','--format','json'],capture_output=True,text=True,env=env)
        self.assertEqual(parsed.returncode,0,'Compose must accept the private file')
        values = json.loads(parsed.stdout)['services']['config-check']['environment']
        self.assertIn('GOOGLE_CLIENT_SECRET',values)
        # config output is serialized for reapplication and may escape literal dollars.
        # Verify the real container value rather than treating serialized text as runtime.
        project='google-oauth-'+os.urandom(6).hex()
        command=['docker','compose','--project-name',project,'--env-file',str(self.target),'-f',str(compose)]
        self.addCleanup(lambda: subprocess.run([*command,'down','--remove-orphans'],capture_output=True,text=True,env=env))
        runtime=subprocess.run([*command,'run','--rm','--no-deps','config-check','sh','-c','printf "%s" "$GOOGLE_CLIENT_SECRET"'],capture_output=True,text=True,env=env)
        self.assertEqual(runtime.returncode,0,'Synthetic config container must run')
        self.assertEqual(runtime.stdout,SECRET)
        prior = self.target.read_bytes()
        self.assertNotEqual(self.run_cli().returncode,0)
        self.assertEqual(self.target.read_bytes(),prior)
        self.assertEqual(self.run_cli(flags=('--replace',)).returncode,0)

    def test_invalid_clients_do_not_change_the_file(self):
        bad = [ {'installed':self.payload()['web']}, {'web':{**self.payload()['web'],'redirect_uris':['https://attacker.example.test/callback']}}, {'web':{**self.payload()['web'],'client_secret':'bad\nINJECTED=value'}} ]
        for payload in bad:
            with self.subTest(payload_kind=list(payload)):
                result=self.run_cli(payload)
                self.assertNotEqual(result.returncode,0)
                self.assertEqual(self.target.read_text(),self.original)
                self.assertNotIn(SECRET,result.stdout+result.stderr)
        self.assertNotEqual(self.run_cli(raw='x'*65537).returncode,0)
        self.assertEqual(self.target.read_text(),self.original)

    def test_unsafe_targets_are_rejected(self):
        self.target.chmod(0o644)
        self.assertNotEqual(self.run_cli().returncode,0)
        self.target.chmod(0o600)
        actual=self.root/'actual.env'
        self.target.rename(actual)
        self.target.symlink_to(actual)
        self.assertNotEqual(self.run_cli().returncode,0)
        self.assertEqual(actual.read_text(),self.original)