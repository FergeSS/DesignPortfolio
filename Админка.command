#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Не найден Node.js. Установи Node.js 22 или новее и запусти админку снова.'
  read -r '?Нажми Enter, чтобы закрыть окно.'
  exit 1
fi
print 'Локальная админка: http://127.0.0.1:4317'
print 'Оставь это окно открытым, пока работаешь. Остановить: Ctrl+C.'
node scripts/admin.mjs
read -r '?Админка остановлена. Нажми Enter, чтобы закрыть окно.'
