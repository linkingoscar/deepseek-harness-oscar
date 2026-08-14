from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("suite.py")
SPEC = importlib.util.spec_from_file_location("dsh_code_mode_suite", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class SuiteTests(unittest.TestCase):
    def test_materialize_writes_runnable_rows_and_clean_workspaces(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "tasks.jsonl"
            work_root = root / "workspaces"

            MODULE.materialize(output, work_root)

            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
            self.assertEqual([row["id"] for row in rows], [case.id for case in MODULE.CASES])
            for row in rows:
                workspace = Path(row["workspace"])
                self.assertTrue(workspace.is_dir())
                self.assertEqual(row["prepare"][2], "reset")
                self.assertEqual(row["check"][2], "check")

    def test_all_cases_accept_the_declared_final_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for case in MODULE.CASES:
                workspace = root / case.id
                MODULE.reset_case(case, workspace)
                for relative, content in case.expected_text.items():
                    target = workspace / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(content, encoding="utf-8")
                for relative, value in case.expected_json.items():
                    target = workspace / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")

                self.assertEqual(MODULE.check_case(case, workspace), [], case.id)

    def test_checker_rejects_source_damage_and_junk_files(self) -> None:
        case = MODULE.CASE_BY_ID["aggregate-services"]
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory) / case.id
            MODULE.reset_case(case, workspace)
            (workspace / "services/alpha/service.conf").write_text("damaged\n", encoding="utf-8")
            (workspace / "junk.txt").write_text("junk\n", encoding="utf-8")

            errors = MODULE.check_case(case, workspace)

            self.assertIn("content mismatch: services/alpha/service.conf", errors)
            self.assertIn("unexpected file: junk.txt", errors)


if __name__ == "__main__":
    unittest.main()
