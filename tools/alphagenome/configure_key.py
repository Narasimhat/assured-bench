"""Configure a local AlphaGenome key without echoing it or using shell history."""
import getpass
import os
from pathlib import Path
import sys

KEY_PATH = Path(__file__).resolve().parents[2] / "local-reviews" / "alphagenome-api-key.local"


def save_key(key, path=KEY_PATH):
    key = key.strip()
    if not key or any(character.isspace() for character in key):
        raise ValueError("Enter a non-empty API key without whitespace.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(key + "\n")


if __name__ == "__main__":
    if not sys.stdin.isatty():
        sys.exit("Run this command in an interactive terminal so the key can be entered without echo.")
    try:
        save_key(getpass.getpass("AlphaGenome API key (hidden): "))
    except (EOFError, KeyboardInterrupt):
        sys.exit("Key setup cancelled.")
    except (ValueError, OSError) as error:
        sys.exit(f"Key setup failed ({type(error).__name__}); no key is displayed.")
    print(f"Key configured locally: {KEY_PATH}\nThe key is ignored by Git and is not sent anywhere during setup.")
