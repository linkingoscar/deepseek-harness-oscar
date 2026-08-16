from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from benchmarks.dsh_bench.tests.test_benchmark import *  # noqa: F401,F403


if __name__ == "__main__":
    unittest.main()
