/**
 * Preservation-тесты (Property 5): Вспомогательные функции notifications.js
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 *
 * IMPORTANT: Эти тесты фиксируют корректное базовое поведение вспомогательных
 * функций, которое НЕ должно сломаться после исправления бага. Они должны
 * ПРОХОДИТЬ и на неисправленном, и на исправленном коде.
 *
 * Methodology: observation-first — тесты написаны на основе наблюдений за
 * поведением оригинального кода на входных данных вне баг-условия.
 */

'use strict';

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Мок ./api — нужен для getClientDataWithRetry, не затрагивает parseLessonDate
// и formatNotificationMessage
// ---------------------------------------------------------------------------

jest.mock('./api', () => ({
    getClientData: jest.fn(),
}));

const { getClientData } = require('./api');
const {
    parseLessonDate,
    formatNotificationMessage,
    getClientDataWithRetry,
} = require('./notifications');

// ---------------------------------------------------------------------------
// Section 1: parseLessonDate
// ---------------------------------------------------------------------------

describe('parseLessonDate — парсинг строки даты занятия', () => {
    /**
     * Validates: Requirements 3.1
     *
     * Конкретные наблюдения из спека.
     */
    test('Пример: "15.07.2025 10:30" → new Date(2025, 6, 15, 10, 30)', () => {
        const result = parseLessonDate('15.07.2025 10:30');
        expect(result).toEqual(new Date(2025, 6, 15, 10, 30));
    });

    test('Граничный случай: "31.12.2025 23:59" → new Date(2025, 11, 31, 23, 59) (конец года)', () => {
        const result = parseLessonDate('31.12.2025 23:59');
        expect(result).toEqual(new Date(2025, 11, 31, 23, 59));
    });

    test('Граничный случай: "28.02.2025 09:00" → new Date(2025, 1, 28, 9, 0) (конец февраля)', () => {
        const result = parseLessonDate('28.02.2025 09:00');
        expect(result).toEqual(new Date(2025, 1, 28, 9, 0));
    });

    /**
     * Validates: Requirements 3.1
     *
     * Property: для любого валидного dateString в формате "DD.MM.YYYY HH:MM"
     * parseLessonDate(dateString).getTime() совпадает с ожидаемым timestamp.
     *
     * Генератор строит timestamp вручную, чтобы исключить двусмысленность
     * часовых поясов — используем те же конструкторы что и parseLessonDate.
     */
    test('Property: для любого валидного dateString → getTime() совпадает с ожидаемым timestamp', () => {
        fc.assert(
            fc.property(
                // Год 2020–2030
                fc.integer({ min: 2020, max: 2030 }),
                // Месяц 1–12
                fc.integer({ min: 1, max: 12 }),
                // День — безопасный диапазон 1–28, чтобы избежать несуществующих дат
                fc.integer({ min: 1, max: 28 }),
                // Час 0–23
                fc.integer({ min: 0, max: 23 }),
                // Минута 0–59
                fc.integer({ min: 0, max: 59 }),
                (year, month, day, hour, minute) => {
                    const dd = String(day).padStart(2, '0');
                    const mm = String(month).padStart(2, '0');
                    const HH = String(hour).padStart(2, '0');
                    const MM = String(minute).padStart(2, '0');
                    const dateString = `${dd}.${mm}.${year} ${HH}:${MM}`;

                    const result = parseLessonDate(dateString);

                    // Ожидаемый Date строится по той же логике что в parseLessonDate
                    const expected = new Date(year, month - 1, day, hour, minute);

                    return result.getTime() === expected.getTime();
                }
            ),
            { numRuns: 200, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.1
     *
     * Property: результат является объектом Date (не NaN, не null).
     */
    test('Property: parseLessonDate всегда возвращает валидный Date', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2020, max: 2030 }),
                fc.integer({ min: 1, max: 12 }),
                fc.integer({ min: 1, max: 28 }),
                fc.integer({ min: 0, max: 23 }),
                fc.integer({ min: 0, max: 59 }),
                (year, month, day, hour, minute) => {
                    const dateString = [
                        `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
                        `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
                    ].join(' ');

                    const result = parseLessonDate(dateString);

                    return result instanceof Date && !isNaN(result.getTime());
                }
            ),
            { numRuns: 200, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Section 2: formatNotificationMessage
// ---------------------------------------------------------------------------

describe('formatNotificationMessage — форматирование текста уведомления', () => {
    /**
     * Validates: Requirements 3.2
     *
     * Конкретные наблюдения из спека.
     */
    test('Пример: с именем → "Привет, Иван, завтра в 10:30 у тебя урок по вокалу."', () => {
        const result = formatNotificationMessage({
            next_lesson_date: '15.07.2025 10:30',
            name: 'Иван',
        });
        expect(result).toBe('Привет, Иван, завтра в 10:30 у тебя урок по вокалу.');
    });

    test('Пример: без имени → "Привет, студент, завтра в 10:30 у тебя урок по вокалу."', () => {
        const result = formatNotificationMessage({
            next_lesson_date: '15.07.2025 10:30',
        });
        expect(result).toBe('Привет, студент, завтра в 10:30 у тебя урок по вокалу.');
    });

    /**
     * Validates: Requirements 3.2
     *
     * Property: для любого next_lesson_date в формате "DD.MM.YYYY HH:MM"
     * сообщение содержит точное время урока (HH:MM часть).
     */
    test('Property: сообщение всегда содержит время урока из next_lesson_date', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 2020, max: 2030 }),
                fc.integer({ min: 1, max: 12 }),
                fc.integer({ min: 1, max: 28 }),
                fc.integer({ min: 0, max: 23 }),
                fc.integer({ min: 0, max: 59 }),
                (year, month, day, hour, minute) => {
                    const dd = String(day).padStart(2, '0');
                    const mm = String(month).padStart(2, '0');
                    const HH = String(hour).padStart(2, '0');
                    const MM = String(minute).padStart(2, '0');
                    const next_lesson_date = `${dd}.${mm}.${year} ${HH}:${MM}`;
                    const expectedTime = `${HH}:${MM}`;

                    const result = formatNotificationMessage({ next_lesson_date });

                    return result.includes(expectedTime);
                }
            ),
            { numRuns: 200, seed: 42 }
        );
    });

    /**
     * Validates: Requirements 3.2
     *
     * Property: при наличии имени — сообщение содержит это имя.
     * При отсутствии имени — сообщение содержит "студент".
     */
    test('Property: имя в сообщении совпадает с clientData.name или дефолтным "студент"', () => {
        fc.assert(
            fc.property(
                // Имя — непустая строка из букв и пробелов (русские/латинские)
                fc.option(fc.stringMatching(/^[A-Za-zА-Яа-яЁё ]{1,20}$/), { nil: undefined }),
                (name) => {
                    const clientData = {
                        next_lesson_date: '15.07.2025 10:30',
                        ...(name !== undefined ? { name } : {}),
                    };

                    const result = formatNotificationMessage(clientData);
                    const expectedName = name !== undefined ? name : 'студент';

                    return result.includes(expectedName);
                }
            ),
            { numRuns: 200, seed: 42 }
        );
    });
});

// ---------------------------------------------------------------------------
// Section 3: getClientDataWithRetry
// ---------------------------------------------------------------------------

describe('getClientDataWithRetry — повторный запрос при ошибке CRM', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /**
     * Validates: Requirements 3.3
     *
     * При успехе на первой попытке — возвращает данные без повторного запроса.
     */
    test('При успехе на первой попытке — возвращает данные, getClientData вызван 1 раз', async () => {
        const mockData = { name: 'Иван', next_lesson_date: '15.07.2025 10:30' };
        getClientData.mockResolvedValueOnce(mockData);

        const result = await getClientDataWithRetry('79001234567');

        expect(result).toEqual(mockData);
        expect(getClientData).toHaveBeenCalledTimes(1);
        expect(getClientData).toHaveBeenCalledWith('79001234567');
    });

    /**
     * Validates: Requirements 3.3
     *
     * При ошибке на первой попытке делает повторный запрос через 1 с.
     * При успехе на второй попытке — возвращает данные.
     */
    test('При ошибке на первой попытке — делает ретрай через 1 с и возвращает данные', async () => {
        const mockData = { name: 'Мария', next_lesson_date: '20.07.2025 14:00' };
        getClientData
            .mockRejectedValueOnce(new Error('CRM timeout'))
            .mockResolvedValueOnce(mockData);

        const promise = getClientDataWithRetry('79001234567', 1);

        // Продвигаем таймер на 1000 мс — задержка перед ретраем
        await jest.runAllTimersAsync();

        const result = await promise;

        expect(result).toEqual(mockData);
        expect(getClientData).toHaveBeenCalledTimes(2);
    });

    /**
     * Validates: Requirements 3.3
     *
     * При ошибке на обеих попытках (retries=1) — бросает ошибку.
     */
    test('При ошибке на обеих попытках — пробрасывает ошибку', async () => {
        getClientData
            .mockRejectedValueOnce(new Error('CRM unavailable'))
            .mockRejectedValueOnce(new Error('CRM unavailable'));

        let caughtError = null;
        const promise = getClientDataWithRetry('79001234567', 1).catch(e => {
            caughtError = e;
        });

        await jest.runAllTimersAsync();
        await promise;

        expect(caughtError).not.toBeNull();
        expect(caughtError.message).toBe('CRM unavailable');
        expect(getClientData).toHaveBeenCalledTimes(2);
    });

    /**
     * Validates: Requirements 3.3
     *
     * При retries=0 — не делает ретрай, сразу бросает ошибку.
     */
    test('При retries=0 — не делает ретрай, сразу бросает ошибку', async () => {
        getClientData.mockRejectedValueOnce(new Error('CRM error'));

        await expect(getClientDataWithRetry('79001234567', 0)).rejects.toThrow('CRM error');

        expect(getClientData).toHaveBeenCalledTimes(1);
    });
});
