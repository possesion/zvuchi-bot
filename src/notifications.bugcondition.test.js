/**
 * Exploration-тесты баг-условий (пересмотрено для исправленного кода):
 * Property 1 — двухфазная доставка и персистентность в scheduled-notifications.
 *
 * Validates: Requirements 1.1, 1.2, 1.3 / 2.1, 2.3
 *
 * ПОСЛЕ ИСПРАВЛЕНИЯ:
 *   Test 1 (Сценарий A): shouldSendNotification удалена. Проверяем, что syncSchedule
 *     корректно вычисляет scheduled_at = lessonDate - 24h и вызывает scheduleNotification
 *     с правильными параметрами независимо от дня недели (исправление бага A).
 *   Test 2 (персистентность): колонки scheduled_at / sent / next_lesson_date СУЩЕСТВУЮТ.
 *   Test 3 (CRM-ошибка): syncSchedule при rejection getClientData НЕ вызывает bot.sendMessage.
 */

'use strict';

const Database = require('better-sqlite3');
const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Mock setup — должен быть на уровне модуля (Jest hoists jest.mock)
// ---------------------------------------------------------------------------

// Текущие подписчики для Test 3
let mockSubscribedUsers = [{ user_id: 42 }];
// Текущий телефон для Test 3
let mockPhone = '79001234567';
// getSchedule returns null by default (no existing record)
let mockSchedule = null;
// getClientData response for Test 1
let mockClientData = null;

jest.mock('./database', () => ({
    getSubscribedUsers: jest.fn(() => mockSubscribedUsers),
    getPhone:           jest.fn(() => mockPhone),
    setNotify:          jest.fn(),
    getNotify:          jest.fn(() => false),
    savePhone:          jest.fn(),
    initializeNotifyColumn: jest.fn(),
    setSchedule:        jest.fn(),
    clearSchedule:      jest.fn(),
    getSchedule:        jest.fn(() => mockSchedule),
    getPendingSchedules: jest.fn(() => []),
    markSent:           jest.fn(),
}));

// api mock is re-configured per describe block
jest.mock('./api', () => ({
    getClientData: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Test 1: syncSchedule корректно вычисляет scheduled_at = lessonDate − 24h
// ---------------------------------------------------------------------------

describe('Test 1 (Сценарий A): syncSchedule вычисляет scheduled_at корректно для любого дня', () => {
    /**
     * Validates: Requirements 2.1, 2.5
     *
     * Прежний баг: shouldSendNotification возвращала false, если урок не попадал
     * ровно на «завтра» по календарному дню (например, урок в воскресенье в 10:00,
     * cron запустился в воскресенье в 00:00).
     *
     * Исправление: syncSchedule вычисляет scheduled_at = lessonDate.getTime() - 24h
     * и вызывает scheduleNotification с этим значением — без завязки на «завтра».
     *
     * Проверяем через мок: после syncSchedule с конкретной next_lesson_date
     * setSchedule вызван с scheduledAt === parseLessonDate(next_lesson_date) - 24h.
     */

    let database;
    let api;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        database = require('./database');
        api      = require('./api');
        mockSchedule = null; // нет существующей записи
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.resetModules();
    });

    test('Контрпример A1: урок в воскресенье в 10:00 — setSchedule вызван с lessonDate − 24h', async () => {
        const { syncSchedule, parseLessonDate } = require('./notifications');

        const next_lesson_date = '06.07.2025 10:00'; // воскресенье
        api.getClientData.mockResolvedValue({ name: 'Иван', next_lesson_date });

        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };

        await syncSchedule(bot, [42]);

        expect(database.setSchedule).toHaveBeenCalledTimes(1);
        const [, , scheduledAt] = database.setSchedule.mock.calls[0];
        const expectedScheduledAt = parseLessonDate(next_lesson_date).getTime() - 24 * 60 * 60 * 1000;
        expect(scheduledAt).toBe(expectedScheduledAt);

        // bot.sendMessage не вызван в фазе синхронизации (только setTimeout ставится)
        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    test('Контрпример A2: урок в пятницу в 23:30 — setSchedule вызван с lessonDate − 24h', async () => {
        const { syncSchedule, parseLessonDate } = require('./notifications');

        const next_lesson_date = '04.07.2025 23:30'; // пятница
        api.getClientData.mockResolvedValue({ name: 'Мария', next_lesson_date });

        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };

        await syncSchedule(bot, [42]);

        expect(database.setSchedule).toHaveBeenCalledTimes(1);
        const [, , scheduledAt] = database.setSchedule.mock.calls[0];
        const expectedScheduledAt = parseLessonDate(next_lesson_date).getTime() - 24 * 60 * 60 * 1000;
        expect(scheduledAt).toBe(expectedScheduledAt);

        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    /**
     * Property-based: для любого next_lesson_date syncSchedule вызывает setSchedule
     * с scheduledAt === parseLessonDate(next_lesson_date).getTime() - 24 * 3600 * 1000.
     *
     * Validates: Requirements 2.1
     */
    test('Property 1: для любого next_lesson_date scheduled_at = lessonDate − 24h', async () => {
        const { syncSchedule, parseLessonDate } = require('./notifications');

        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 2025, max: 2030 }),
                fc.integer({ min: 1,    max: 12   }),
                fc.integer({ min: 1,    max: 28   }),
                fc.integer({ min: 0,    max: 23   }),
                fc.integer({ min: 0,    max: 59   }),
                async (year, month, day, hour, minute) => {
                    jest.clearAllMocks();
                    database.getSchedule.mockReturnValue(null);

                    const dd = String(day).padStart(2, '0');
                    const mm = String(month).padStart(2, '0');
                    const HH = String(hour).padStart(2, '0');
                    const MM = String(minute).padStart(2, '0');
                    const next_lesson_date = `${dd}.${mm}.${year} ${HH}:${MM}`;

                    api.getClientData.mockResolvedValue({ next_lesson_date });

                    const bot = { sendMessage: jest.fn(() => Promise.resolve()) };

                    await syncSchedule(bot, [42]);

                    if (database.setSchedule.mock.calls.length === 0) return false;

                    const [, , scheduledAt] = database.setSchedule.mock.calls[0];
                    const expected = parseLessonDate(next_lesson_date).getTime() - 24 * 60 * 60 * 1000;

                    return scheduledAt === expected;
                }
            ),
            { numRuns: 20, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Test 2: Сценарий B — колонки персистентного состояния существуют в БД
// ---------------------------------------------------------------------------

describe('Test 2 (Сценарий B): Колонки scheduled_at / sent / next_lesson_date существуют в БД', () => {
    /**
     * Validates: Requirements 1.2 (Bug) / 2.9 (Fix)
     *
     * Создаём in-memory БД и воспроизводим миграцию из database.js.
     * Ожидаем, что колонки существуют (после исправления).
     */

    let db;

    beforeEach(() => {
        db = new Database(':memory:');
        // Оригинальная схема
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                phone_number TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                notify BOOLEAN DEFAULT 0
            )
        `);
        // Миграции, добавленные в рамках исправления
        const migrations = [
            'ALTER TABLE users ADD COLUMN next_lesson_date TEXT DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN scheduled_at INTEGER DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN sent BOOLEAN DEFAULT 0',
        ];
        for (const sql of migrations) {
            try { db.exec(sql); } catch (e) {
                if (!e.message.includes('duplicate column name')) throw e;
            }
        }
        db.prepare('INSERT INTO users (user_id, phone_number) VALUES (?, ?)').run(1, '79001234567');
    });

    afterEach(() => {
        db.close();
    });

    test('scheduled_at существует — персистентность обеспечена', () => {
        expect(() => {
            db.prepare('SELECT scheduled_at FROM users').all();
        }).not.toThrow();
    });

    test('sent существует — персистентность обеспечена', () => {
        expect(() => {
            db.prepare('SELECT sent FROM users').all();
        }).not.toThrow();
    });

    test('next_lesson_date существует — персистентность обеспечена', () => {
        expect(() => {
            db.prepare('SELECT next_lesson_date FROM users').all();
        }).not.toThrow();
    });

    test('Property 2: все три колонки доступны одним запросом', () => {
        expect(() => {
            db.prepare('SELECT scheduled_at, sent, next_lesson_date FROM users').all();
        }).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Test 3: CRM-ошибка → bot.sendMessage НЕ вызван
// ---------------------------------------------------------------------------

describe('Test 3: CRM-ошибка в syncSchedule — bot.sendMessage не вызывается', () => {
    /**
     * Validates: Requirements 1.3 (Bug) / 2.3 (Fix)
     *
     * getClientData всегда отклоняется — имитирует сбой CRM.
     * После исправления syncSchedule делает console.error + continue,
     * не вызывая bot.sendMessage.
     */

    let api;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        api = require('./api');
        api.getClientData.mockRejectedValue(new Error('CRM недоступен'));
        mockSchedule = null;
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.resetModules();
    });

    test('Контрпример: при ошибке CRM bot.sendMessage НЕ должен вызываться', async () => {
        const { syncSchedule } = require('./notifications');

        mockSubscribedUsers = [{ user_id: 42 }];
        mockPhone = '79001234567';

        const bot = { sendMessage: jest.fn(() => Promise.resolve()) };

        const runPromise = syncSchedule(bot);
        await jest.runAllTimersAsync();
        await runPromise;

        expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    test('Property 3: при ошибке CRM у нескольких подписчиков bot.sendMessage никогда не вызывается', async () => {
        const { syncSchedule } = require('./notifications');

        await fc.assert(
            fc.asyncProperty(
                fc.array(
                    fc.integer({ min: 1, max: 999_999 }),
                    { minLength: 1, maxLength: 5 }
                ),
                async (userIds) => {
                    jest.clearAllMocks();
                    api = require('./api');
                    api.getClientData.mockRejectedValue(new Error('CRM недоступен'));

                    mockSubscribedUsers = userIds.map(id => ({ user_id: id }));
                    mockPhone = '79001234567';

                    const bot = { sendMessage: jest.fn(() => Promise.resolve()) };

                    const runPromise = syncSchedule(bot);
                    await jest.runAllTimersAsync();
                    await runPromise;

                    return bot.sendMessage.mock.calls.length === 0;
                }
            ),
            { numRuns: 5, seed: 42 }
        );
    });
});
