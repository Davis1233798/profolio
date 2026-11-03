import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'infra' / 'linux'))
from mes_public_route import (  # noqa: E402
    RouteConfigError,
    route_config,
    read_route,
    set_route,
    validate_go_health,
)


class MesPublicRouteTests(unittest.TestCase):
    def env_file(self, content='BASE_DOMAIN=example.test\n'):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'infra.env'
        path.write_text(content, encoding='utf-8')
        return path

    def test_missing_route_defaults_to_existing_shared_web(self):
        path = self.env_file()
        self.assertEqual(read_route(path), 'shared')
        config = route_config(read_route(path))
        self.assertEqual(config['upstream'], 'web:8080')
        self.assertIsNone(config['overlay'])

    def test_isolated_mode_has_fixed_go_upstream_and_external_network_overlay(self):
        config = route_config('isolated')
        self.assertEqual(config['upstream'], 'mes-station:8095')
        self.assertEqual(config['overlay'], 'linux/compose.mes-public-route.yaml')
        self.assertEqual(config['network'], 'business-suite-mes_default')

    def test_unknown_mode_cannot_choose_an_arbitrary_upstream(self):
        for mode in ('localhost:18095', 'https://other.example', '', 'SHARED'):
            with self.subTest(mode=mode):
                with self.assertRaises(RouteConfigError):
                    route_config(mode)

    def test_invalid_or_duplicate_route_is_rejected(self):
        for content in (
            'MES_PUBLIC_ROUTE=https://attacker.example\n',
            'MES_PUBLIC_ROUTE=host.docker.internal:18095\n',
            'MES_PUBLIC_ROUTE=isolated\nMES_PUBLIC_ROUTE=shared\n',
        ):
            with self.subTest(content=content):
                path = self.env_file(content)
                with self.assertRaises(RouteConfigError):
                    read_route(path)

    def test_switch_preserves_unrelated_environment_lines_and_resolves_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'shared.env'
            target.write_text('BASE_DOMAIN=example.test\nGATEWAY_TOKEN=do-not-change\n', encoding='utf-8')
            link = root / '.env'
            link.symlink_to(target)
            set_route(link, 'isolated')
            self.assertTrue(link.is_symlink())
            self.assertEqual(read_route(link), 'isolated')
            self.assertIn('GATEWAY_TOKEN=do-not-change\n', target.read_text(encoding='utf-8'))
            set_route(link, 'shared')
            self.assertEqual(read_route(link), 'shared')
            self.assertIn('BASE_DOMAIN=example.test\n', target.read_text(encoding='utf-8'))

    def test_go_health_requires_exact_backend_and_ready_document(self):
        ready = {'success': True, 'data': {'backend': 'go', 'status': 'ready'}}
        self.assertTrue(validate_go_health(json.dumps(ready).encode('utf-8')))
        for payload in (
            b'not-json',
            json.dumps({'success': True, 'data': {'database': 'connected'}}).encode(),
            json.dumps({'success': True, 'data': {'backend': 'go', 'status': 'down'}}).encode(),
            json.dumps({'success': False, 'data': {'backend': 'go', 'status': 'ready'}}).encode(),
        ):
            with self.subTest(payload=payload):
                self.assertFalse(validate_go_health(payload))

    def test_public_edge_routes_only_mes_to_configured_upstream(self):
        caddy = (ROOT / 'infra' / 'linux' / 'Caddyfile.sites').read_text(encoding='utf-8')
        compose = (ROOT / 'infra' / 'linux' / 'compose.public-sites.yaml').read_text(encoding='utf-8')
        isolated_overlay = (ROOT / 'infra' / 'linux' / 'compose.mes-public-route.yaml').read_text(encoding='utf-8')
        self.assertIn('reverse_proxy {$MES_PUBLIC_UPSTREAM}', caddy)
        self.assertIn('MES_PUBLIC_UPSTREAM: ${MES_PUBLIC_UPSTREAM:?route upstream must come from the allowlisted IaC mode}', compose)
        mes_block = caddy.split('mes.{$BASE_DOMAIN} {', 1)[1].split('\n}', 1)[0]
        self.assertIn('reverse_proxy {$MES_PUBLIC_UPSTREAM}', mes_block)
        self.assertIn('import suite-proxy', caddy.split('erp.{$BASE_DOMAIN} {', 1)[1].split('\n}', 1)[0])
        self.assertIn('external: true', isolated_overlay)
        self.assertIn('name: business-suite-mes_default', isolated_overlay)
        self.assertNotIn('business-suite-mes_default', compose)
        self.assertNotIn('mes-station:', isolated_overlay)
        self.assertNotIn('volumes:', isolated_overlay)
        self.assertNotIn('ports:', isolated_overlay)

    def test_operator_cutover_checks_health_and_has_a_route_only_rollback(self):
        script = (ROOT / 'infra' / 'linux' / 'cutover-mes-public-route.sh').read_text(encoding='utf-8')
        self.assertIn('verify_isolated_service', script)
        self.assertIn('verify_current_edge', script)
        self.assertIn('check-health', script)
        self.assertIn('python3 "$route_tool" set "$env_file" "$old_mode"', script)
        self.assertIn('up -d --no-deps --force-recreate --wait --wait-timeout 180 edge', script)
        self.assertNotIn('down --volumes', script)


if __name__ == '__main__':
    unittest.main()
