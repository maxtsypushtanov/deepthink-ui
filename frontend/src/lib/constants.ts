export const STRATEGY_LABELS_RU: Record<string, string> = {
  // Strategies
  cot: 'Рассуждение',
  budget_forcing: 'Углублённый анализ',
  best_of_n: 'Сравнение вариантов',
  tree_of_thoughts: 'Исследование подходов',
  persona_council: 'Совет экспертов',
  rubber_duck: 'Объясни и исправь',
  socratic: 'Метод Сократа',
  triz: 'Мастер ТРИЗ',
  none: 'Ответ',
  auto: 'Авто',
  github: 'GitHub Agent',
  calendar: 'Календарь',
  // Tree of Thoughts step types
  tree_init: 'Инициализация дерева',
  tree_explore: 'Исследование ветвей',
  tree_score: 'Оценка ветвей',
  tree_synthesis: 'Формирование ответа',
  branch: 'Ветвь рассуждений',
  synthesis: 'Формирование ответа',
  // Best-of-N step types
  voting: 'Выбор лучшего варианта',
  candidate: 'Вариант ответа',
  vote: 'Выбор лучшего',
  // CoT step types
  cot_activation: 'Пошаговый анализ',
  extracted_thinking: 'Ход мысли',
  // Socratic step types
  socratic_questions: 'Формулировка подвопросов',
  socratic_answering: 'Ответы на подвопросы',
  socratic_answer: 'Ответ на подвопрос',
  socratic_synthesis: 'Синтез ответа',
  // Rubber Duck step types
  rubber_duck_draft: 'Черновик ответа',
  rubber_duck_review: 'Проверка через объяснение',
  rubber_duck_fix: 'Финальный ответ',
  // Persona Council step types
  council_init: 'Созыв совета',
  council_opinion: 'Мнение эксперта',
  council_synthesis: 'Синтез мнений',
  // General
  reasoning: 'Ход мысли',
  // GitHub/tool step types
  tool_call: 'Вызов инструмента',
  tool_result: 'Результат',
  tool_error: 'Ошибка инструмента',
};
