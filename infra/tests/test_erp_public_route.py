from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1] / "linux"

class ERPPublicRouteTest(unittest.TestCase):
    def test_shared_default_and_private_socket_overlay(self):
        caddy = (ROOT / "Caddyfile.sites").read_text()
        erp = caddy.split("erp.{", 1)[1].split("pos.{", 1)[0]
        self.assertIn("import suite-policy", erp)
        self.assertIn("reverse_proxy {$ERP_PUBLIC_UPSTREAM:web:8080}", erp)
        overlay = (ROOT / "compose.erp-rootless-route.yaml").read_text()
        self.assertIn("ERP_PUBLIC_UPSTREAM: unix//run/erp-ingress/upstream.sock", overlay)
        self.assertIn("/run/erp-ingress:/run/erp-ingress:ro", overlay)

    def test_mode_defaults_and_rejects_ambiguous_values(self):
        cases = [
            ("OTHER=value\n", "shared"),
            ("ERP_PUBLIC_ROUTE=shared\n", "shared"),
            ("ERP_PUBLIC_ROUTE=rootless # enabled\n", "rootless"),
            ("ERP_PUBLIC_ROUTE=unknown\n", None),
            ("ERP_PUBLIC_ROUTE=shared\nERP_PUBLIC_ROUTE=rootless\n", None),
        ]
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            for content, expected in cases:
                with self.subTest(content=content):
                    env.write_text(content, encoding="utf-8")
                    result = subprocess.run(
                        [sys.executable, str(ROOT / "erp_public_route.py"), str(env)],
                        capture_output=True, text=True, check=False,
                    )
                    if expected is None:
                        self.assertNotEqual(result.returncode, 0)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(result.stdout.strip(), expected)
