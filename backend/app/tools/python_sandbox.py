"""Python Sandbox — safe code execution tool for the DeepThink agent.

The agent decides when to use Python: calculations, charts, data processing,
table generation, etc. Code runs in a restricted environment with matplotlib,
pandas, numpy available. Charts are returned as base64 PNG.

TRIZ #28 "Mechanics Substitution": replace LLM guessing with actual computation.
"""

from __future__ import annotations

import base64
import io
import logging
import re
import signal
import traceback
from contextlib import redirect_stdout, redirect_stderr

logger = logging.getLogger(__name__)

EXEC_TIMEOUT = 15  # seconds
MAX_OUTPUT = 8000  # chars


def execute_python(code: str) -> dict:
    """Execute Python code in a restricted sandbox.

    Returns:
        {
            "success": bool,
            "output": str,          # stdout text
            "error": str | None,    # error message if failed
            "images": list[str],    # base64-encoded PNG images (charts)
        }
    """
    import pandas as pd
    import numpy as np

    # Capture matplotlib figures
    images: list[str] = []

    try:
        import matplotlib
        matplotlib.use('Agg')  # Non-interactive backend
        import matplotlib.pyplot as plt
        import matplotlib.font_manager as fm
        plt.rcParams['figure.figsize'] = (10, 6)
        plt.rcParams['figure.dpi'] = 150
        plt.rcParams['figure.facecolor'] = '#1c1c1c'
        plt.rcParams['axes.facecolor'] = '#1c1c1c'
        plt.rcParams['text.color'] = '#e0e0e0'
        plt.rcParams['axes.labelcolor'] = '#e0e0e0'
        plt.rcParams['xtick.color'] = '#a0a0a0'
        plt.rcParams['ytick.color'] = '#a0a0a0'
        plt.rcParams['axes.edgecolor'] = '#404040'
        plt.rcParams['grid.color'] = '#303030'
        plt.rcParams['legend.facecolor'] = '#2a2a2a'
        plt.rcParams['legend.edgecolor'] = '#404040'
        has_matplotlib = True
    except ImportError:
        has_matplotlib = False
        plt = None

    _real_import = __import__
    _ALLOWED = {"pandas", "numpy", "math", "statistics", "datetime", "re",
                "io", "collections", "itertools", "functools", "json", "csv",
                "matplotlib", "matplotlib.pyplot", "matplotlib.font_manager"}

    def _safe_import(name, *args, **kwargs):
        root = name.split('.')[0]
        if root not in _ALLOWED and name not in _ALLOWED:
            raise ImportError(f"Модуль '{name}' недоступен в sandbox")
        return _real_import(name, *args, **kwargs)

    safe_globals = {
        "__builtins__": {
            "__import__": _safe_import,
            "print": print, "len": len, "range": range, "enumerate": enumerate,
            "zip": zip, "map": map, "filter": filter, "sorted": sorted,
            "min": min, "max": max, "sum": sum, "abs": abs, "round": round,
            "int": int, "float": float, "str": str, "bool": bool,
            "list": list, "dict": dict, "tuple": tuple, "set": set,
            "isinstance": isinstance, "type": type, "getattr": getattr,
            "hasattr": hasattr, "setattr": setattr,
            "True": True, "False": False, "None": None,
            "ValueError": ValueError, "TypeError": TypeError, "KeyError": KeyError,
            "AttributeError": AttributeError, "IndexError": IndexError,
            "Exception": Exception, "StopIteration": StopIteration,
            "reversed": reversed, "any": any, "all": all,
            "open": None,  # Block file access
        },
        "pd": pd,
        "np": np,
        "plt": plt,
        "DataFrame": pd.DataFrame,
        "Series": pd.Series,
        "StringIO": io.StringIO,
    }

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        old_handler = signal.signal(signal.SIGALRM, lambda s, f: (_ for _ in ()).throw(TimeoutError("Timeout")))
        signal.alarm(EXEC_TIMEOUT)

        try:
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                exec(code, safe_globals)
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)

        output = stdout_capture.getvalue().strip()

        # Capture any matplotlib figures
        if has_matplotlib and plt:
            figs = [plt.figure(i) for i in plt.get_fignums()]
            for fig in figs:
                buf = io.BytesIO()
                fig.savefig(buf, format='png', bbox_inches='tight',
                           facecolor=fig.get_facecolor(), edgecolor='none')
                buf.seek(0)
                img_b64 = base64.b64encode(buf.read()).decode('ascii')
                images.append(img_b64)
                buf.close()
            plt.close('all')

        # Check for result variable
        if not output and "result" in safe_globals and safe_globals["result"] is not None:
            output = str(safe_globals["result"])

        return {
            "success": True,
            "output": output[:MAX_OUTPUT],
            "error": None,
            "images": images,
        }

    except TimeoutError:
        return {"success": False, "output": "", "error": "Таймаут: код выполнялся дольше 15 секунд", "images": []}
    except Exception as e:
        err_lines = traceback.format_exc().split('\n')
        short = "\n".join(err_lines[-4:]).strip()
        return {"success": False, "output": "", "error": short, "images": []}


# ── Code Generation Prompt ──

CODE_GEN_PROMPT = """Ты пишешь Python-код для выполнения задачи пользователя. Код выполнится в sandbox с доступом к:
- pandas (pd), numpy (np), matplotlib.pyplot (plt)
- math, statistics, datetime, re, json, csv, collections, itertools

Правила:
— Выводи результат через print()
— Для графиков: используй plt.figure(), plt.plot/bar/scatter/pie и т.д. — график будет автоматически сохранён как PNG
— Графики в тёмной теме (уже настроено)
— Для таблиц: используй pd.DataFrame и print(df.to_string()) или print(df.to_markdown())
— НЕ используй open(), os, sys, subprocess — они заблокированы
— Код должен быть коротким (10-30 строк)
— Не используй input() — код не интерактивный

Ответь ТОЛЬКО кодом. Без объяснений, без markdown-fence."""


def should_use_python(user_msg: str) -> bool:
    """Detect if the user's request would benefit from Python execution."""
    patterns = [
        # Calculations
        r'(?:рассчитай|посчитай|вычисли|подсчитай|calculate|compute)',
        r'(?:сколько будет|чему равно|найди значение)',
        # Charts/graphs
        r'(?:график|диаграмм|chart|graph|plot|визуализ|нарисуй|построй)',
        r'(?:гистограмм|pie.?chart|scatter|bar.?chart|круговая)',
        # Data analysis
        r'(?:таблиц[аеу]|table|сортиров|фильтр|группиров|pivot)',
        r'(?:статистик|корреляци|распределени|регресси)',
        r'(?:средн|медиан|стандартн|дисперси)',
        # Code execution
        r'(?:выполни код|запусти|run|execute)',
        r'(?:сгенерируй данные|создай таблицу|random)',
        # Math
        r'(?:уравнени|матриц|вектор|интеграл|производн)',
        r'(?:факториал|фибоначчи|простые числа|НОД|НОК)',
    ]
    msg_lower = user_msg.lower()
    return any(re.search(p, msg_lower) for p in patterns)
