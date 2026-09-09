/**
 * Тесты нового cron-механизма доставки уведомлений.
 *
 * Покрывает:
 *   - database.getDueSchedules(now): фильтрация due-записей (scheduled_at <= now,
 *     sent = 0, notify = 1).
 *   - notifications.processDueNotifications(bot): отправка «созревших» уведомлений,
 *     пропуск просроченных уроков, устойчивость к ошибкам bot.sendMessage,
 *     защита от повторной отправки через markSent.
 */

'use strict';

// ---------------------------------------------------------------------------
// Section 1: database.getDueSchedules — on in-memory SQLite
// ---------------------------------------------------------------------------

describe('getDueSchedules — фильтрация due-записей', () => {
    const Database = require('better-sqlite3');
    let db;

    function makeSchema(database) {
        database.exec(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                phone_number TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                notify BOOLEAN DEFAULT 0
            )
        `);
        const migrations = [
            'ALTER TABLE users ADD COLUMN next_lesson_date TEXT DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN scheduled_at INTEGER DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN sent BOOLEAN DEFAULT 0',
            'ALTER TABLE users ADD COLUMN name TEXT DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN paid_count INTEGER DEFAULT NULL',
        ];
        for (const sql of migrations) {
            try { database.exec(sql); } catch (e) {
                if (!e.message.includes('duplicate column name')) throw e;
            }
        }
    }

    // Копия запроса из database.getDueSchedules (тот же самый SQL).
    function getDueSchedules(database, now) {
        return database
            .prepare('SELECT user_id, name, next_lesson_date, scheduled_at, sent, paid_count FROM users WHERE scheduled_at IS NOT NULL AND scheduled_at <= ? AND sent = 0 AND notify = 1')
            .all(now);
    }

    function insertUser(database, { userId, scheduledAt = null, sent = 0, notify = 1 }) {
        database
            .prepare('INSERT INTO users (user_id, phone_number, notify, next_lesson_date, scheduled_at, sent) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId, '79001234567', notify, '2026-01-01 10:00:00', scheduledAt, sent);
    }

    beforeEach(() => {
        db = new Database(':memory:');
        makeSchema(db);
    });

    afterEach(() => {
        db.close();
    });

    const NOW = 1_000_000_000;

    test('Возвращает запись со scheduled_at <= now, sent=0, notify=1', () => {
        insertUser(db, { userId: 1, scheduledAt: NOW - 1000 });
        const rows = getDueSchedules(db, NOW);
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBe(1);
    });

    test('Не возвращает запись со scheduled_at в будущем', () => {
        insertUser(db, { userId: 2, scheduledAt: NOW + 1000 });
        expect(getDueSchedules(db, NOW)).toHaveLength(0);
    });

    test('Не возвращает уже отправленную (sent=1)', () => {
        insertUser(db, { userId: 3, scheduledAt: NOW - 1000, sent: 1 });
        expect(getDueSchedules(db, NOW)).toHaveLength(0);
    });

    test('Не возвращает неподписанного (notify=0)', () => {
        insertUser(db, { userId: 4, scheduledAt: NOW - 1000, notify: 0 });
        expect(getDueSchedules(db, NOW)).toHaveLength(0);
    });

    test('Не возвращает запись без scheduled_at (NULL)', () => {
        insertUser(db, { userId: 5, scheduledAt: null });
        expect(getDueSchedules(db, NOW)).toHaveLength(0);
    });

    test('Граничный случай: scheduled_at === now — считается due', () => {
        insertUser(db, { userId: 6, scheduledAt: NOW });
        expect(getDueSchedules(db, NOW)).toHaveLength(1);
    });

    test('Возвращает только подходящие среди смешанного набора', () => {
        insertUser(db, { userId: 10, scheduledAt: NOW - 5000 });          // due
        insertUser(db, { userId: 11, scheduledAt: NOW + 5000 });          // future
        insertUser(db, { userId: 12, scheduledAt: NOW - 5000, sent: 1 }); // sent
        insertUser(db, { userId: 13, scheduledAt: NOW - 5000, notify: 0 });// not subscribed
        const ids = getDueSchedules(db, NOW).map(r => r.user_id).sort();
        expect(ids).toEqual([10]);
    });
});

// ---------------------------------------------------------------------------
// Section 2: notifications.processDueNotifications
// ---------------------------------------------------------------------------

// Мок БД: due-записи и markSent конфигурируются per-test.
// Имена с префиксом mock* разрешены внутри фабрики jest.mock (jest hoisting).
let mockDue = [];
let mockMarkSentImpl = () => true;
const mockMarkSent = jest.fn((userId) => mockMarkSentImpl(userId));

jest.mock('./database', () => ({
    getPhone: jest.fn(),
    getSubscribedUsers: jest.fn(() => []),
    setSchedule: jest.fn(),
    clearSchedule: jest.fn(),
    getSchedule: jest.fn(() => null),
    getDueSchedules: jest.fn(() => mockDue),
    markSent: (userId) => mockMarkSent(userId),
}));

jest.mock('./api', () => ({
    getClientData: jest.fn(),
}));

const { processDueNotifications } = require('./notifications');

/**
 * Строит next_lesson_date ("YYYY-MM-DD HH:MM:SS", MSK) так, чтобы
 * parseLessonDate(строка).getTime() === targetMs (с точностью до минуты).
 */
function toLessonString(targetMs) {
    const msk = new Date(targetMs + 3 * 60 * 60 * 1000); // MSK = UTC+3
    const y = msk.getUTCFullYear();
    const mo = String(msk.getUTCMonth() + 1).padStart(2, '0');
    const d = String(msk.getUTCDate()).padStart(2, '0');
    const h = String(msk.getUTCHours()).padStart(2, '0');
    const mi = String(msk.getUTCMinutes()).padStart(2, '0');
    return `${y}-${mo}-${d} ${h}:${mi}:00`;
}

describe('processDueNotifications — доставка «созревших» уведомлений', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDue = [];
        mockMarkSentImpl = () => true;
    });

    test('(a) Запись в окне (< 24ч до урока) → bot.sendMessage вызван + markSent', async () => {
        const now = Date.now();
        mockDue = [{
            user_id: 42,
            name: 'Иван',
            next_lesson_date: toLessonString(now + 3 * 60 * 60 * 1000), // урок через 3ч
            scheduled_at: now - 1000,
            sent: 0,
            paid_count: 5,
        }];

        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };
        await processDueNotifications(bot);

        expect(mockMarkSent).toHaveBeenCalledWith(42);
        expect(bot.sendMessage).toHaveBeenCalledTimes(1);
        const [chatId, text] = bot.sendMessage.mock.calls[0];
        expect(chatId).toBe(42);
        expect(text).toContain('Иван');
    });

    test('(b) Урок уже прошёл → bot.sendMessage НЕ вызван, но markSent помечает запись', async () => {
        const now = Date.now();
        mockDue = [{
            user_id: 7,
            name: 'Мария',
            next_lesson_date: toLessonString(now - 60 * 60 * 1000), // урок был час назад
            scheduled_at: now - 25 * 60 * 60 * 1000,
            sent: 0,
            paid_count: null,
        }];

        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };
        await processDueNotifications(bot);

        expect(mockMarkSent).toHaveBeenCalledWith(7);
        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    test('(c) Ошибка bot.sendMessage не прерывает обработку остальных записей', async () => {
        const now = Date.now();
        mockDue = [
            {
                user_id: 1,
                name: 'A',
                next_lesson_date: toLessonString(now + 2 * 60 * 60 * 1000),
                scheduled_at: now - 1000,
                sent: 0,
                paid_count: null,
            },
            {
                user_id: 2,
                name: 'B',
                next_lesson_date: toLessonString(now + 2 * 60 * 60 * 1000),
                scheduled_at: now - 1000,
                sent: 0,
                paid_count: null,
            },
        ];

        const bot = {
            sendMessage: jest.fn()
                .mockRejectedValueOnce(new Error('Telegram недоступен'))
                .mockResolvedValueOnce(undefined),
        };

        await expect(processDueNotifications(bot)).resolves.toBeUndefined();
        expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('(d) markSent вернул false (уже отправлено) → повторной отправки нет', async () => {
        const now = Date.now();
        mockMarkSentImpl = () => false;
        mockDue = [{
            user_id: 99,
            name: 'Пётр',
            next_lesson_date: toLessonString(now + 60 * 60 * 1000),
            scheduled_at: now - 1000,
            sent: 0,
            paid_count: null,
        }];

        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };
        await processDueNotifications(bot);

        expect(mockMarkSent).toHaveBeenCalledWith(99);
        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    test('Пустой список due → bot.sendMessage не вызывается', async () => {
        mockDue = [];
        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };
        await processDueNotifications(bot);
        expect(bot.sendMessage).not.toHaveBeenCalled();
    });
});
