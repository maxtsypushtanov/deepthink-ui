"""Tests for tool detection heuristics: python sandbox, web search, image gen, infographic."""

from __future__ import annotations

import pytest

from app.tools.python_sandbox import should_use_python
from app.tools.web_search import needs_web_search
from app.tools.image_gen import needs_image_generation
from app.tools.infographic import needs_infographic


# ── should_use_python ──


class TestShouldUsePython:
    def test_calculate_triggers_python(self):
        assert should_use_python("посчитай 2+2") is True

    def test_build_chart_triggers_python(self):
        assert should_use_python("построй график") is True

    def test_draw_cat_does_not_trigger_python(self):
        """Image generation requests must not trigger Python."""
        assert should_use_python("нарисуй кота") is False

    def test_infographic_request_does_not_trigger_python(self):
        assert should_use_python("создай инфографику") is False

    def test_greeting_does_not_trigger_python(self):
        assert should_use_python("привет") is False

    def test_percentage_calculation_triggers_python(self):
        assert should_use_python("сколько будет 15% от 300") is True

    def test_equation_triggers_python(self):
        assert should_use_python("реши уравнение x^2 + 3x - 4 = 0") is True

    def test_factorial_triggers_python(self):
        assert should_use_python("найди факториал 20") is True

    def test_execute_code_triggers_python(self):
        assert should_use_python("выполни код print(42)") is True

    def test_general_question_does_not_trigger_python(self):
        assert should_use_python("что такое рекурсия") is False

    def test_statistics_triggers_python(self):
        assert should_use_python("найди среднее и медиану") is True


# ── needs_web_search ──


class TestNeedsWebSearch:
    def test_exchange_rate_triggers_search(self):
        assert needs_web_search("курс доллара") is True

    def test_news_triggers_search(self):
        assert needs_web_search("что нового в мире") is True

    def test_factual_question_does_not_trigger_search(self):
        assert needs_web_search("что такое рекурсия") is False

    def test_google_it_triggers_search(self):
        assert needs_web_search("загугли react hooks") is True

    def test_weather_triggers_search(self):
        assert needs_web_search("погода в Москве") is True

    def test_latest_version_triggers_search(self):
        assert needs_web_search("последняя версия Python") is True

    def test_price_triggers_search(self):
        assert needs_web_search("сколько стоит iPhone 15") is True

    def test_greeting_does_not_trigger_search(self):
        assert needs_web_search("привет, как дела") is False

    def test_code_question_does_not_trigger_search(self):
        assert needs_web_search("напиши функцию сортировки") is False

    def test_today_triggers_search(self):
        assert needs_web_search("что произошло сегодня") is True


# ── needs_image_generation ──


class TestNeedsImageGeneration:
    def test_draw_cat_triggers_image(self):
        assert needs_image_generation("нарисуй кота") is True

    def test_create_sunset_picture_triggers_image(self):
        assert needs_image_generation("создай картинку заката") is True

    def test_factual_question_does_not_trigger_image(self):
        assert needs_image_generation("что такое нейросеть") is False

    def test_english_generate_image_triggers(self):
        assert needs_image_generation("generate an image of a dog") is True

    def test_create_illustration_triggers_image(self):
        assert needs_image_generation("создай иллюстрацию леса") is True

    def test_generate_art_triggers_image(self):
        assert needs_image_generation("сгенерируй арт в стиле киберпанк") is True

    def test_draw_me_triggers_image(self):
        assert needs_image_generation("draw me a sunset") is True

    def test_make_photo_triggers_image(self):
        assert needs_image_generation("make a photo of a city") is True

    def test_simple_greeting_does_not_trigger_image(self):
        assert needs_image_generation("привет") is False

    def test_code_request_does_not_trigger_image(self):
        assert needs_image_generation("напиши код на Python") is False


# ── needs_infographic ──


class TestNeedsInfographic:
    def test_infographic_about_ai_triggers(self):
        assert needs_infographic("создай инфографику про AI") is True

    def test_visualize_data_triggers(self):
        assert needs_infographic("визуализируй данные") is True

    def test_show_process_schema_triggers(self):
        assert needs_infographic("покажи схему процесса") is True

    def test_draw_cat_does_not_trigger_infographic(self):
        assert needs_infographic("нарисуй кота") is False

    def test_tell_about_python_does_not_trigger_infographic(self):
        assert needs_infographic("расскажи про Python") is False

    def test_mindmap_triggers_infographic(self):
        assert needs_infographic("создай mind map по теме") is True

    def test_flowchart_triggers_infographic(self):
        assert needs_infographic("нарисуй flowchart") is True

    def test_roadmap_triggers_infographic(self):
        assert needs_infographic("покажи дорожную карту проекта") is True

    def test_diagram_triggers_infographic(self):
        assert needs_infographic("создай диаграмму архитектуры") is True

    def test_explain_visually_triggers_infographic(self):
        assert needs_infographic("объясни визуально как работает DNS") is True


# ── Mutual exclusion ──


class TestMutualExclusion:
    def test_draw_yourself_is_image_not_python_or_infographic(self):
        query = "нарисуй себя"
        assert needs_image_generation(query) is True
        assert should_use_python(query) is False
        assert needs_infographic(query) is False

    def test_architecture_diagram_is_infographic_not_python(self):
        query = "создай диаграмму архитектуры"
        assert needs_infographic(query) is True
        assert should_use_python(query) is False

    def test_calculate_is_python_not_image(self):
        query = "посчитай сумму чисел от 1 до 100"
        assert should_use_python(query) is True
        assert needs_image_generation(query) is False
        assert needs_infographic(query) is False

    def test_search_is_only_search(self):
        query = "загугли последние новости"
        assert needs_web_search(query) is True
        assert needs_image_generation(query) is False
        assert needs_infographic(query) is False
