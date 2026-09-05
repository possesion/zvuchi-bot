# Zvuchi Telegram Bot

Telegram бот для работы с CRM системой Zvuchi.

## Установка и запуск

### Вариант 1: Docker (рекомендуется)

#### Требования
- Docker Desktop или Docker Engine 20.10+
- Docker Compose v2.0+

#### Быстрый старт

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd zvuchi-bot
```

2. Создайте файл `.env` в корне проекта:
```env
API_KEY_BOT=your_telegram_bot_token
CRM_EMAIL=your_email@example.com
CRM_API_KEY=your_crm_api_key
HEALTHCHECK_PORT=3000
ALERT_BOT_TOKEN=your_alert_bot_token
ALERT_CHAT_ID=your_alert_chat_id
```

3. Запустите бота:
```bash
docker compose up -d
```

#### Команды Docker

```bash
# Сборка образа
docker compose build

# Запуск в фоновом режиме
docker compose up -d

# Просмотр логов
docker compose logs -f zvuchi-bot

# Остановка бота
docker compose stop

# Перезапуск бота
docker compose restart

# Остановка и удаление контейнера
docker compose down

# Обновление после изменения кода
docker compose up -d --build
```

#### Проверка работоспособности

Healthcheck endpoint доступен на `http://localhost:3000/healthcheck`:

```bash
curl http://localhost:3000/healthcheck
```

Ответ:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600.5
}
```

#### HTTP Эндпоинты

Помимо healthcheck, доступны следующие эндпоинты:

**GET /healthcheck** - проверка работоспособности бота и Telegram API
```bash
curl http://localhost:3000/healthcheck
```

**GET /users** - список всех пользователей в базе данных
```bash
curl http://localhost:3000/users
```

**GET /sync** - принудительная синхронизация расписания уведомлений
```bash
curl http://localhost:3000/sync
```
Этот эндпоинт запускает синхронизацию расписания для всех подписанных пользователей, извлекая данные из CRM и обновляя значения `scheduled_at` в базе данных. Синхронизация также автоматически выполняется ежедневно в 00:00 по московскому времени.

#### База данных

База данных SQLite (`bot.db`) сохраняется на хосте и переживает перезапуски контейнера. Для резервного копирования:

```bash
# Создать бэкап
cp bot.db bot.db.backup.$(date +%Y%m%d-%H%M%S)

# Восстановить из бэкапа
docker compose down
cp bot.db.backup.YYYYMMDD-HHMMSS bot.db
docker compose up -d
```

### Вариант 2: Локальный запуск (Node.js)

#### Требования
- Node.js 22.12.0+
- npm

#### Установка

```bash
npm install
```

#### Настройка

Создайте файл `.env` в корне проекта:

```env
API_KEY_BOT=your_telegram_bot_token
CRM_EMAIL=your_email@example.com
CRM_API_KEY=your_crm_api_key
HEALTHCHECK_PORT=3000
ALERT_BOT_TOKEN=your_alert_bot_token
ALERT_CHAT_ID=your_alert_chat_id
```

#### Запуск

```bash
node index.js
```

## Команды бота

- `/start` - Запуск бота
- `/lessonstotal` - Узнать количество оставшихся уроков
- `/nextlesson` - Узнать дату следующего урока

При первом использовании бот запросит ваш номер телефона для связи с CRM.

## Устранение неполадок

### Docker

**Контейнер не запускается:**
- Проверьте логи: `docker compose logs zvuchi-bot`
- Убедитесь, что файл `.env` существует и содержит все необходимые переменные
- Проверьте, что порт 3000 не занят: `lsof -i :3000` (macOS/Linux)

**Ошибки базы данных:**
- Проверьте права доступа к файлу `bot.db`
- Убедитесь, что файл не заблокирован другим процессом
- При необходимости восстановите из резервной копии

**Бот не отвечает:**
- Проверьте правильность `API_KEY_BOT` в `.env`
- Убедитесь в наличии сетевого подключения к Telegram API
- Проверьте логи на наличие ошибок polling

**Healthcheck недоступен:**
- Проверьте маппинг портов в `docker-compose.yml`
- Убедитесь, что переменная `HEALTHCHECK_PORT` установлена правильно
- Попробуйте обратиться изнутри контейнера: `docker compose exec zvuchi-bot curl localhost:3000/healthcheck`

### Локальный запуск

**Ошибка "Cannot find module":**
- Выполните `npm install` для установки зависимостей
- Убедитесь, что используете Node.js версии 22.12.0 или выше

**База данных не создается:**
- Проверьте права записи в директорию проекта
- Убедитесь, что SQLite3 установлен корректно

## Архитектура

### Структура проекта

```
zvuchi-bot/
├── src/
│   ├── handlers.js       # Обработчики команд бота
│   ├── database.js       # Работа с SQLite
│   ├── api.js           # Клиент AlfaCRM API
│   ├── utils.js         # Вспомогательные функции
│   ├── healthcheck.js   # HTTP сервер для мониторинга
│   └── notifications.js # Планировщик уведомлений
├── index.js             # Точка входа
├── bot.db              # База данных SQLite
├── .env                # Переменные окружения (не в git)
├── Dockerfile          # Сборка Docker образа
└── docker-compose.yml  # Оркестрация Docker
```

### Компоненты

- **Telegram Bot**: Обработка сообщений и команд пользователей
- **SQLite Database**: Хранение номеров телефонов пользователей
- **AlfaCRM Client**: Интеграция с CRM для получения данных об уроках
- **Health Monitor**: HTTP endpoint для проверки работоспособности
- **Notification Scheduler**: Автоматические уведомления о предстоящих уроках

## Разработка

### Запуск тестов

```bash
npm test
```

### Стиль кода

Проект использует CommonJS модули (`require`/`module.exports`) без TypeScript.

## Лицензия

Проприетарное ПО. Все права защищены.
