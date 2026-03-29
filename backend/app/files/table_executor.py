"""Table Executor — safe Python/pandas execution on uploaded table data.

The LLM sees a statistical profile of the table and writes pandas code
to answer precise questions. The code runs in a restricted sandbox
with only pandas/numpy available. Results are returned as text.

TRIZ #28 "Mechanics Substitution": replace LLM guessing with actual computation.
"""

from __future__ import annotations

import logging
import io
import re
import threading
import traceback
from contextlib import redirect_stdout, redirect_stderr

logger = logging.getLogger(__name__)

# Max execution time (seconds)
EXEC_TIMEOUT = 10
# Max output length (chars)
MAX_OUTPUT = 5000


def execute_table_code(code: str, table_text: str, file_type: str) -> dict:
    """Execute pandas code on table data in a restricted environment.

    Args:
        code: Python/pandas code to execute
        table_text: raw table text (pipe-separated or CSV)
        file_type: "xlsx", "csv", "text"

    Returns:
        {"success": bool, "output": str, "error": str | None}
    """
    # Build the DataFrame loading preamble
    preamble = _build_preamble(table_text, file_type)

    full_code = preamble + "\n" + code

    # Restricted globals — allow imports for pandas/numpy/io only
    import pandas as pd
    import numpy as np
    from io import StringIO as _StringIO

    _ALLOWED_MODULES = {"pandas", "numpy", "io", "math", "statistics", "datetime", "re"}
    _real_import = __import__

    def _safe_import(name, *args, **kwargs):
        if name.split('.')[0] not in _ALLOWED_MODULES:
            raise ImportError(f"Import of '{name}' is not allowed")
        return _real_import(name, *args, **kwargs)

    safe_globals = {
        "__builtins__": {
            "__import__": _safe_import,
            "print": print, "len": len, "range": range, "enumerate": enumerate,
            "zip": zip, "map": map, "filter": filter, "sorted": sorted,
            "min": min, "max": max, "sum": sum, "abs": abs, "round": round,
            "int": int, "float": float, "str": str, "bool": bool,
            "list": list, "dict": dict, "tuple": tuple, "set": set,
            "isinstance": isinstance, "type": type,
            "True": True, "False": False, "None": None,
            "ValueError": ValueError, "TypeError": TypeError, "KeyError": KeyError,
            "AttributeError": AttributeError, "IndexError": IndexError, "Exception": Exception,
        },
        "pd": pd,
        "np": np,
        "StringIO": _StringIO,
        "DataFrame": pd.DataFrame,
        "Series": pd.Series,
    }

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        exec_error: list[str] = []

        def _target():
            try:
                with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                    exec(full_code, safe_globals)
            except Exception as e:
                exec_error.append(str(e))

        thread = threading.Thread(target=_target, daemon=True)
        thread.start()
        thread.join(timeout=EXEC_TIMEOUT)

        if thread.is_alive():
            raise TimeoutError("Execution timed out")

        if exec_error:
            raise RuntimeError(exec_error[0])

        output = stdout_capture.getvalue().strip()
        if not output:
            # Check if last expression produced a result
            # Try to get 'result' variable if set
            if "result" in safe_globals:
                output = str(safe_globals["result"])
            elif "df" in safe_globals and isinstance(safe_globals["df"], pd.DataFrame):
                output = "(DataFrame loaded, no print output)"

        return {
            "success": True,
            "output": output[:MAX_OUTPUT],
            "error": None,
        }

    except TimeoutError:
        return {"success": False, "output": "", "error": "Таймаут: код выполнялся дольше 10 секунд"}
    except Exception as e:
        err_msg = traceback.format_exc().split('\n')
        # Show only the last few lines of traceback (user code, not preamble)
        short_err = "\n".join(err_msg[-4:]).strip()
        return {"success": False, "output": "", "error": short_err}


def _build_preamble(table_text: str, file_type: str) -> str:
    """Generate code that loads the table into a DataFrame called `df`."""
    # Detect separator
    first_line = table_text.split('\n')[0] if table_text else ""
    if '|' in first_line:
        sep = '|'
    elif '\t' in first_line:
        sep = '\\t'
    else:
        sep = ','

    # Handle sheet markers for Excel
    if file_type in ("xlsx", "xls") and '[Лист:' in table_text:
        # Use first sheet only for code execution
        import re as _re
        sheets = _re.split(r'^\[Лист:\s*.+?\]', table_text, flags=_re.MULTILINE)
        # First non-empty chunk after split
        sheet_text = ""
        for chunk in sheets:
            if chunk.strip():
                sheet_text = chunk.strip()
                break
        if sheet_text:
            table_text = sheet_text

    # Escape the text for embedding in code
    escaped = table_text.replace('\\', '\\\\').replace("'''", "\\'\\'\\'")

    return f"""import pandas as pd
import numpy as np
from io import StringIO

_raw_text = '''{escaped}'''
df = pd.read_csv(StringIO(_raw_text), sep='{sep}', skipinitialspace=True, engine='python')
# Clean column names
df.columns = [c.strip().strip('"') for c in df.columns]
# Try to convert numeric columns
for col in df.columns:
    df[col] = df[col].apply(lambda x: str(x).strip() if isinstance(x, str) else x)
    try:
        df[col] = pd.to_numeric(df[col].str.replace(',', '.').str.replace(' ', '').str.replace('\\xa0', ''))
    except (ValueError, AttributeError):
        pass
"""


def generate_code_prompt(query: str, profile_text: str) -> str:
    """Generate a prompt asking the LLM to write pandas code for the query."""
    return f"""У тебя есть таблица, загруженная в pandas DataFrame `df`. Вот её профиль:

{profile_text}

Вопрос пользователя: {query}

Напиши ТОЛЬКО Python-код (pandas), который отвечает на вопрос.
Правила:
- DataFrame уже загружен в переменную `df` — НЕ загружай файл
- Выводи результат через print()
- Код должен быть коротким (5-15 строк)
- Используй df.groupby(), df.query(), df.describe() и т.д.
- Для числовых вычислений используй pandas/numpy, НЕ угадывай
- Не используй matplotlib/seaborn/графики
- Оберни вывод в понятное описание: print(f"Средняя зарплата: {{result}}")

Ответь ТОЛЬКО кодом, без объяснений. Начинай с первой строки кода."""
