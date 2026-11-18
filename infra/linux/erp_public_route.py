"""Read the ERP public route mode from the shared release environment."""

import re
import sys
from pathlib import Path

VALID_MODES = ("shared", "rootless")


def _parse_value(value):
    value = value.strip()
    if value.startswith(('"', "'")):
        quote = value[0]
        end = value.find(quote, 1)
        if end < 0 or (value[end + 1:].strip() and not value[end + 1:].lstrip().startswith('#')):
            raise ValueError("ERP_PUBLIC_ROUTE must be a plain enum value")
        value = value[1:end]
    else:
        value = value.split('#', 1)[0].strip()
    if value not in VALID_MODES:
        raise ValueError("ERP_PUBLIC_ROUTE must be defined once as shared or rootless")
    return value


def read_mode(path):
    target = Path(path).resolve(strict=True)
    if not target.is_file():
        raise ValueError("Route settings must resolve to a regular file")
    text = target.read_text(encoding="utf-8")
    values = []
    for line in text.splitlines():
        match = re.match(r"^\s*ERP_PUBLIC_ROUTE\s*=\s*(.*?)\s*$", line)
        if match:
            values.append(_parse_value(match.group(1)))
    if len(values) > 1:
        raise ValueError("ERP_PUBLIC_ROUTE must be defined once as shared or rootless")
    return values[0] if values else "shared"


if __name__ == "__main__":
    try:
        print(read_mode(sys.argv[1]))
    except (OSError, ValueError) as error:
        sys.exit(str(error))
