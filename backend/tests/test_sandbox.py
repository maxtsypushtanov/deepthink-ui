"""Tests for Python sandbox code execution."""

from __future__ import annotations

import pytest

try:
    import pandas  # noqa: F401
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

if HAS_PANDAS:
    from app.tools.python_sandbox import execute_python


@pytest.mark.skipif(not HAS_PANDAS, reason="pandas not installed")
class TestExecutePython:
    def test_simple_print_hello(self):
        result = execute_python("print('hello')")
        assert result["success"] is True
        assert result["output"] == "hello"
        assert result["error"] is None

    def test_arithmetic_output(self):
        result = execute_python("print(2 + 2)")
        assert result["success"] is True
        assert "4" in result["output"]

    def test_division_by_zero_fails(self):
        result = execute_python("1/0")
        assert result["success"] is False
        assert "division" in result["error"].lower() or "ZeroDivision" in result["error"]

    def test_import_os_blocked(self):
        result = execute_python("import os")
        assert result["success"] is False
        assert "os" in result["error"].lower() or "недоступен" in result["error"]

    def test_import_subprocess_blocked(self):
        result = execute_python("import subprocess")
        assert result["success"] is False

    def test_import_sys_blocked(self):
        result = execute_python("import sys")
        assert result["success"] is False

    def test_open_file_blocked(self):
        result = execute_python("f = open('/etc/passwd')")
        assert result["success"] is False

    def test_pandas_available(self):
        result = execute_python("import pandas as pd\nprint(pd.DataFrame({'a': [1]}).shape)")
        assert result["success"] is True
        assert "(1, 1)" in result["output"]

    def test_numpy_available(self):
        result = execute_python("import numpy as np\nprint(np.sum([1, 2, 3]))")
        assert result["success"] is True
        assert "6" in result["output"]

    def test_math_module_available(self):
        result = execute_python("import math\nprint(math.factorial(5))")
        assert result["success"] is True
        assert "120" in result["output"]

    def test_result_variable_returned(self):
        result = execute_python("result = 42")
        assert result["success"] is True
        assert "42" in result["output"]

    def test_syntax_error_fails(self):
        result = execute_python("def foo(:\n  pass")
        assert result["success"] is False

    def test_output_truncated_at_max(self):
        result = execute_python("print('x' * 20000)")
        assert result["success"] is True
        assert len(result["output"]) <= 8000

    def test_images_list_exists(self):
        result = execute_python("print('test')")
        assert "images" in result
        assert isinstance(result["images"], list)

    def test_multiline_code_works(self):
        code = "x = 10\ny = 20\nprint(x + y)"
        result = execute_python(code)
        assert result["success"] is True
        assert "30" in result["output"]

    def test_list_comprehension_works(self):
        result = execute_python("print([x**2 for x in range(5)])")
        assert result["success"] is True
        assert "[0, 1, 4, 9, 16]" in result["output"]

    def test_json_module_available(self):
        result = execute_python("import json\nprint(json.dumps({'a': 1}))")
        assert result["success"] is True
        assert '"a"' in result["output"]

    def test_timeout_on_infinite_loop(self):
        result = execute_python("while True: pass")
        assert result["success"] is False
        assert "аймаут" in result["error"] or "Timeout" in result["error"]
