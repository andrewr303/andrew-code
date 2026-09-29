"""Entrypoint to allow `python -m fusion_swarm` from the plugin root directory."""
import sys
from pathlib import Path

_python_dir = Path(__file__).resolve().parent / "python"
if str(_python_dir) not in sys.path:
    sys.path.insert(0, str(_python_dir))

from fusion_swarm.__main__ import main

if __name__ == "__main__":
    main()
