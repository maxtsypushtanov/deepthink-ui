#!/bin/bash
# DeepThink UI — запуск фронтенда и бэкенда одной командой

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# Цвета
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}━━━ DeepThink UI ━━━${NC}"
echo ""

# Убить зависшие процессы на портах
echo -e "${PURPLE}[1/3] Освобождаю порты 8000 и 5173...${NC}"
lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:5173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Запуск бэкенда
echo -e "${PURPLE}[2/3] Запускаю бэкенд (FastAPI :8000)...${NC}"
cd "$BACKEND_DIR"
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Запуск фронтенда
echo -e "${PURPLE}[3/3] Запускаю фронтенд (Vite :5173)...${NC}"
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}✓ Бэкенд:  http://localhost:8000${NC}"
echo -e "${GREEN}✓ Фронтенд: http://localhost:5173${NC}"
echo ""
echo -e "${CYAN}Нажми Ctrl+C чтобы остановить оба сервера${NC}"

# Остановка обоих процессов по Ctrl+C
cleanup() {
    echo ""
    echo -e "${RED}Останавливаю серверы...${NC}"
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
    echo -e "${GREEN}✓ Готово${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Ждём завершения любого процесса
wait -n $BACKEND_PID $FRONTEND_PID 2>/dev/null
cleanup
