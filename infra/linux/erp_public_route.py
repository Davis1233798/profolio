"""Read the ERP public route mode from the shared release environment."""

import re
import sys
from pathlib import Path


def read_mode(path):
    values = re.findall(r"^\s*ERP_PUBLIC_ROUTE\s*=([^\n]*)", Path(path).read_text(encoding="utf-8"), re.M)
    if not values:
        return "shared"
    if len(values) == 1:
        mode = values[0].partition("#")[0].strip()
        if mode in ("shared", "rootless"):
            return mode
    raise ValueError("ERP_PUBLIC_ROUTE must be defined once as shared or rootless")


if __name__ == "__main__":
    try:
        print(read_mode(sys.argv[1]))
    except (OSError, ValueError) as error:
        sys.exit(str(error))
