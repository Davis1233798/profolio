"""Check the public station health response against the intended release."""
import json
import re
import sys


def main() -> int:
    if len(sys.argv) != 2 or not re.fullmatch(r'[0-9a-f]{40}', sys.argv[1]):
        print('Invalid expected release revision', file=sys.stderr)
        return 1
    try:
        payload = json.load(sys.stdin)
        data = payload.get('data') if isinstance(payload, dict) else None
        valid = (payload.get('success') is True and isinstance(data, dict)
                 and data.get('backend') == 'go' and data.get('status') == 'ready'
                 and data.get('revision') == sys.argv[1])
    except (ValueError, AttributeError):
        valid = False
    if not valid:
        print('Station health or release revision did not match', file=sys.stderr)
        return 1
    print('Station health revision verified')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
