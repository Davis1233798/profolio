#!/usr/bin/env python3
"""Validate and atomically update the centrally managed MES route mode."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import tempfile


ROUTES = {
    'shared': {
        'upstream': 'web:8080',
        'overlay': None,
        'network': None,
    },
    'isolated': {
        'upstream': 'mes-station:8095',
        'overlay': 'linux/compose.mes-public-route.yaml',
        'network': 'business-suite-mes_default',
    },
    'rootless': {
        'upstream': 'unix//run/mes-ingress/upstream.sock',
        'overlay': 'linux/compose.mes-rootless-route.yaml',
        'network': None,
    },
}
KEY = 'MES_PUBLIC_ROUTE'


class RouteConfigError(ValueError):
    pass


def _read_target(path):
    target = Path(path).resolve(strict=True)
    if not target.is_file():
        raise RouteConfigError('Route settings must resolve to a regular file')
    return target


def _parse_value(value):
    value = value.strip()
    if value.startswith(('"', "'")):
        quote = value[0]
        end = value.find(quote, 1)
        if end < 0 or value[end + 1:].strip() and not value[end + 1:].lstrip().startswith('#'):
            raise RouteConfigError('MES_PUBLIC_ROUTE must be a plain enum value')
        value = value[1:end]
    else:
        value = value.split('#', 1)[0].strip()
    if value not in ROUTES:
        raise RouteConfigError('MES_PUBLIC_ROUTE must be shared, isolated or rootless')
    return value


def read_route(path):
    target = _read_target(path)
    text = target.read_text(encoding='utf-8')
    values = []
    for line in text.splitlines():
        match = re.match(r'^\s*MES_PUBLIC_ROUTE\s*=\s*(.*?)\s*$', line)
        if match:
            values.append(_parse_value(match.group(1)))
    if len(values) > 1:
        raise RouteConfigError('MES_PUBLIC_ROUTE is defined more than once')
    return values[0] if values else 'shared'


def route_config(mode):
    if mode not in ROUTES:
        raise RouteConfigError('MES_PUBLIC_ROUTE must be shared, isolated or rootless')
    return {'mode': mode, **ROUTES[mode]}


def set_route(path, mode):
    if mode not in ROUTES:
        raise RouteConfigError('MES_PUBLIC_ROUTE must be shared, isolated or rootless')
    target = _read_target(path)
    original = target.read_bytes()
    try:
        text = original.decode('utf-8')
    except UnicodeDecodeError as error:
        raise RouteConfigError('Route settings must be UTF-8 text') from error
    lines = text.splitlines(keepends=True)
    matches = []
    for index, line in enumerate(lines):
        body = line.rstrip('\r\n')
        match = re.match(r'^(\s*MES_PUBLIC_ROUTE\s*=\s*)(.*)$', body)
        if match:
            matches.append((index, match.group(1), match.group(2), line[len(body):]))
    if len(matches) > 1:
        raise RouteConfigError('MES_PUBLIC_ROUTE is defined more than once')

    if matches:
        index, prefix, old_value, newline = matches[0]
        _parse_value(old_value)
        comment = ''
        if '#' in old_value:
            comment = old_value[old_value.index('#'):]
            if comment:
                comment = ' ' + comment
        if not newline:
            newline = '\r\n' if '\r\n' in text else '\n'
        lines[index] = f'{prefix}{mode}{comment}{newline}'
    else:
        newline = '\r\n' if '\r\n' in text else '\n'
        if lines and not lines[-1].endswith(('\n', '\r')):
            lines[-1] += newline
        lines.append(f'{KEY}={mode}{newline}')

    updated = ''.join(lines).encode('utf-8')
    metadata = target.stat()
    fd, temporary = tempfile.mkstemp(prefix=f'.{target.name}.', dir=target.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(metadata.st_mode))
        if hasattr(os, 'fchown'):
            os.fchown(fd, metadata.st_uid, metadata.st_gid)
        with os.fdopen(fd, 'wb') as output:
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def validate_go_health(payload):
    try:
        document = json.loads(payload)
    except (TypeError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    return (
        isinstance(document, dict)
        and document.get('success') is True
        and isinstance(document.get('data'), dict)
        and document['data'].get('backend') == 'go'
        and document['data'].get('status') == 'ready'
    )


def validate_socket_path(path='/run/mes-ingress/upstream.sock', expected_uid=0, *, require_root_path=True):
    """Validate the fixed root-owned Unix socket boundary without following links."""
    import stat

    expected = Path('/run/mes-ingress/upstream.sock') if require_root_path else Path(path)
    candidate = Path(path)
    if require_root_path and candidate != expected:
        raise ValueError('MES ingress socket path is fixed')
    current = Path('/')
    for part in candidate.parts[1:]:
        current = current / part
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError('MES ingress path must not contain symlinks')
        if current in {Path('/'), Path('/run')} and (info.st_uid != expected_uid or stat.S_IMODE(info.st_mode) & 0o022):
            raise ValueError('MES ingress ancestor ownership or mode is unsafe')
        if current == candidate.parent:
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != expected_uid or stat.S_IMODE(info.st_mode) != 0o755:
                raise ValueError('MES ingress directory ownership or mode is unsafe')
        elif current == candidate:
            if not stat.S_ISSOCK(info.st_mode) or info.st_uid != expected_uid or stat.S_IMODE(info.st_mode) != 0o600:
                raise ValueError('MES ingress socket ownership or mode is unsafe')
    return candidate


def check_unix_health():
    import http.client
    import socket

    class UnixHTTPConnection(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(5)
            self.sock.connect(str(validate_socket_path()))

    connection = UnixHTTPConnection('localhost', timeout=5)
    connection.request('GET', '/api/health', headers={'Host': 'mes.internal'})
    response = connection.getresponse()
    payload = response.read()
    connection.close()
    if response.status != 200 or not validate_go_health(payload):
        raise ValueError('MES Go health through the Unix ingress is not ready')
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    get = commands.add_parser('get')
    get.add_argument('env_file')
    set_command = commands.add_parser('set')
    set_command.add_argument('env_file')
    set_command.add_argument('mode', choices=sorted(ROUTES))
    config = commands.add_parser('config')
    config.add_argument('mode', choices=sorted(ROUTES))
    health = commands.add_parser('check-health')
    health.add_argument('--json', action='store_true')
    commands.add_parser('check-unix-health')
    args = parser.parse_args()

    if args.command == 'get':
        print(read_route(args.env_file))
    elif args.command == 'set':
        set_route(args.env_file, args.mode)
        print(args.mode)
    elif args.command == 'config':
        print(json.dumps(route_config(args.mode), sort_keys=True))
    elif args.command == 'check-health':
        import sys
        payload = sys.stdin.buffer.read()
        if not validate_go_health(payload):
            print('MES Go health response was not ready', file=sys.stderr)
            return 1
        if args.json:
            print(payload.decode('utf-8'))
    elif args.command == 'check-unix-health':
        import sys
        try:
            payload = check_unix_health()
        except (OSError, ValueError) as error:
            print(str(error), file=sys.stderr)
            return 1
        print(payload.decode('utf-8'))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
