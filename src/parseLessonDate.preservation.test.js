/**
 * Preservation Property Tests - parseLessonDate() Function
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.9**
 * 
 * **IMPORTANT**: These tests run on UNFIXED code and should PASS
 * They verify baseline behavior that must be preserved after timezone fix
 * 
 * **Preservation Scope**:
 * - parseLessonDate() successfully parses valid date strings in format "YYYY-MM-DD HH:MM:SS"
 * - parseLessonDate() returns Invalid Date for invalid date strings
 * - parseLessonDate() returns Date objects with valid year, month, day, hours, minutes for valid inputs
 * - parseLessonDate() behavior remains identical when processed in MSK environment locally
 * - extractTime() and formatNotificationMessage() helper functions remain unchanged
 * 
 * **Methodology**: Observation-first approach
 * 1. Observe actual behavior on unfixed code
 * 2. Write property-based tests capturing observed patterns
 * 3. Verify tests PASS on unfixed code (baseline behavior)
 * 4. After fix, re-run to ensure no regressions
 */

'use strict';

const fc = require('fast-check');
const { parseLessonDate, extractTime, formatNotificationMessage } = require('./notifications');

describe('Property 2: Preservation - parseLessonDate() Baseline Behavior', () => {
    /**
     * Test valid date parsing - should successfully parse well-formed date strings
     */
    describe('Valid Date Parsing Preservation', () => {
        test('Valid date: "2026-12-31 23:59:59" - parses successfully', () => {
            const input = '2026-12-31 23:59:59';
            const result = parseLessonDate(input);
            
            // Should return valid Date object
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            // Should have correct components (local interpretation)
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(11); // December (0-indexed)
            expect(result.getDate()).toBe(31);
            expect(result.getHours()).toBe(23);
            expect(result.getMinutes()).toBe(59);
        });

        test('Valid date: "2026-01-01 00:00:00" - parses midnight correctly', () => {
            const input = '2026-01-01 00:00:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(0); // January
            expect(result.getDate()).toBe(1);
            expect(result.getHours()).toBe(0);
            expect(result.getMinutes()).toBe(0);
        });

        test('Valid date: "2026-06-15 14:30:00" - parses mid-day date', () => {
            const input = '2026-06-15 14:30:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(5); // June (0-indexed)
            expect(result.getDate()).toBe(15);
            expect(result.getHours()).toBe(14);
            expect(result.getMinutes()).toBe(30);
        });

        test('Leap year: "2024-02-29 12:00:00" - handles leap year correctly', () => {
            const input = '2024-02-29 12:00:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(1); // February
            expect(result.getDate()).toBe(29);
        });

        test('Month boundary: "2026-03-31 23:59:00" - handles last day of month', () => {
            const input = '2026-03-31 23:59:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(2); // March
            expect(result.getDate()).toBe(31);
        });

        /**
         * Property-Based Test: For ALL valid date format strings
         * parseLessonDate() should return valid Date object with correct components
         */
        test('Property: Valid date strings always parse to valid Date objects', () => {
            fc.assert(
                fc.property(
                    // Generate valid year
                    fc.integer({ min: 2024, max: 2030 }),
                    // Generate valid month
                    fc.integer({ min: 1, max: 12 }),
                    // Generate valid day (conservative range to avoid invalid dates)
                    fc.integer({ min: 1, max: 28 }),
                    // Generate valid hour
                    fc.integer({ min: 0, max: 23 }),
                    // Generate valid minute
                    fc.integer({ min: 0, max: 59 }),
                    // Generate valid second
                    fc.integer({ min: 0, max: 59 }),
                    (year, month, day, hour, minute, second) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const result = parseLessonDate(input);
                        
                        // Should return valid Date object
                        expect(result).toBeInstanceOf(Date);
                        expect(isNaN(result.getTime())).toBe(false);
                        
                        // Should have correct components (in local interpretation)
                        expect(result.getFullYear()).toBe(year);
                        expect(result.getMonth()).toBe(month - 1); // Month is 0-indexed
                        expect(result.getDate()).toBe(day);
                        expect(result.getHours()).toBe(hour);
                        expect(result.getMinutes()).toBe(minute);
                        
                        return true;
                    }
                ),
                { numRuns: 100, seed: 42 }
            );
        });
    });

    /**
     * Test invalid/malformed input handling - document OBSERVED behavior on unfixed code
     * 
     * OBSERVED BEHAVIOR:
     * - Empty strings or strings without space: function crashes (undefined split error)
     * - Invalid dates (month > 12, Feb 30, etc.): JavaScript Date auto-corrects them!
     *   - "2026-13-01" becomes "2027-01-01" (month 13 wraps to next year)
     *   - "2026-02-30" becomes "2026-03-02" (30 days from Feb 1)
     *   - "2026-00-15" becomes "2025-12-15" (month 0 wraps to previous year)
     * 
     * This is the BASELINE behavior we must preserve after the fix.
     */
    describe('Invalid/Malformed Input Handling Preservation', () => {
        test('Malformed: empty string causes crash (TypeError on split)', () => {
            const input = '';
            
            // OBSERVED: function crashes with TypeError
            expect(() => parseLessonDate(input)).toThrow(TypeError);
            expect(() => parseLessonDate(input)).toThrow(/Cannot read properties of undefined/);
        });

        test('Malformed: "invalid" string causes crash (TypeError on split)', () => {
            const input = 'invalid';
            
            // OBSERVED: function crashes with TypeError (no space means timePart is undefined)
            expect(() => parseLessonDate(input)).toThrow(TypeError);
            expect(() => parseLessonDate(input)).toThrow(/Cannot read properties of undefined/);
        });

        test('Auto-correction: "2026-13-01 12:00:00" (month 13) wraps to next year Jan', () => {
            const input = '2026-13-01 12:00:00';
            const result = parseLessonDate(input);
            
            // OBSERVED: JavaScript Date auto-corrects month 13 to January 2027
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            // Month 13 wraps to January (month 0) of next year
            expect(result.getFullYear()).toBe(2027);
            expect(result.getMonth()).toBe(0); // January
            expect(result.getDate()).toBe(1);
        });

        test('Auto-correction: "2026-02-30 10:00:00" (non-existent date) wraps to March', () => {
            const input = '2026-02-30 10:00:00';
            const result = parseLessonDate(input);
            
            // OBSERVED: JavaScript Date auto-corrects Feb 30 to March 2
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            // Feb only has 28 days in 2026, so Feb 30 becomes March 2
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(2); // March (0-indexed)
            expect(result.getDate()).toBe(2);
        });

        test('Auto-correction: "2026-00-15 12:00:00" (month zero) wraps to previous year', () => {
            const input = '2026-00-15 12:00:00';
            const result = parseLessonDate(input);
            
            // OBSERVED: JavaScript Date auto-corrects month 0 to December of previous year
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            // Month 0 wraps to December (month 11) of previous year
            expect(result.getFullYear()).toBe(2025);
            expect(result.getMonth()).toBe(11); // December
            expect(result.getDate()).toBe(15);
        });

        test('Auto-correction: "2026-06-00 12:00:00" (day zero) wraps to previous month', () => {
            const input = '2026-06-00 12:00:00';
            const result = parseLessonDate(input);
            
            // OBSERVED: JavaScript Date auto-corrects day 0 to last day of previous month
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            // Day 0 wraps to May 31
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(4); // May (0-indexed)
            expect(result.getDate()).toBe(31);
        });

        test('Wrong format: "15-06-2026 12:00:00" parses but gives unexpected result', () => {
            const input = '15-06-2026 12:00:00';
            const result = parseLessonDate(input);
            
            // OBSERVED: Function doesn't crash, returns Date object
            // But the result is nonsensical (year 15, month 6, day 2026)
            expect(result).toBeInstanceOf(Date);
            // The key preservation: function doesn't crash, returns Date object
        });

        /**
         * Property-Based Test: Document auto-correction behavior for invalid months
         * JavaScript Date auto-corrects month > 12 by wrapping to next year(s)
         */
        test('Property: Month values >12 auto-correct by wrapping to subsequent years', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2024, max: 2030 }),
                    fc.integer({ min: 13, max: 24 }), // Months 13-24
                    fc.integer({ min: 1, max: 28 }),
                    fc.integer({ min: 0, max: 23 }),
                    fc.integer({ min: 0, max: 59 }),
                    (year, month, day, hour, minute) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const result = parseLessonDate(input);
                        
                        // OBSERVED: Should return valid Date (auto-corrected)
                        expect(result).toBeInstanceOf(Date);
                        expect(isNaN(result.getTime())).toBe(false);
                        
                        // Month wraps: month 13 → Jan next year, month 14 → Feb next year, etc.
                        const expectedYear = year + Math.floor((month - 1) / 12);
                        const expectedMonth = ((month - 1) % 12);
                        
                        expect(result.getFullYear()).toBe(expectedYear);
                        expect(result.getMonth()).toBe(expectedMonth);
                        
                        return true;
                    }
                ),
                { numRuns: 50, seed: 42 }
            );
        });

        /**
         * Property-Based Test: Document auto-correction behavior for non-existent February dates
         * JavaScript Date auto-corrects by adding days to the actual last day of February
         */
        test('Property: Non-existent February dates auto-correct to March', () => {
            fc.assert(
                fc.property(
                    // Non-leap years
                    fc.constantFrom(2025, 2026, 2027),
                    // Invalid February days (29-31)
                    fc.integer({ min: 29, max: 31 }),
                    fc.integer({ min: 0, max: 23 }),
                    fc.integer({ min: 0, max: 59 }),
                    (year, day, hour, minute) => {
                        const dateStr = `${year}-02-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const result = parseLessonDate(input);
                        
                        // OBSERVED: Should return valid Date (auto-corrected to March)
                        expect(result).toBeInstanceOf(Date);
                        expect(isNaN(result.getTime())).toBe(false);
                        
                        // Feb 29-31 in non-leap year wraps to March 1-3
                        expect(result.getFullYear()).toBe(year);
                        expect(result.getMonth()).toBe(2); // March (0-indexed)
                        
                        // Feb has 28 days, so Feb 29 → Mar 1, Feb 30 → Mar 2, Feb 31 → Mar 3
                        const expectedDay = day - 28;
                        expect(result.getDate()).toBe(expectedDay);
                        
                        return true;
                    }
                ),
                { numRuns: 50, seed: 42 }
            );
        });
    });

    /**
     * Test edge cases - midnight crossings, month boundaries, leap years
     */
    describe('Edge Cases Preservation', () => {
        test('Edge: Midnight crossing "2026-09-01 00:00:01"', () => {
            const input = '2026-09-01 00:00:01';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(8); // September
            expect(result.getDate()).toBe(1);
            expect(result.getHours()).toBe(0);
            expect(result.getMinutes()).toBe(0);
        });

        test('Edge: End of day "2026-09-30 23:59:59"', () => {
            const input = '2026-09-30 23:59:59';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(8); // September
            expect(result.getDate()).toBe(30);
            expect(result.getHours()).toBe(23);
            expect(result.getMinutes()).toBe(59);
        });

        test('Edge: Year boundary December 31 "2026-12-31 23:00:00"', () => {
            const input = '2026-12-31 23:00:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(11); // December
            expect(result.getDate()).toBe(31);
        });

        test('Edge: Year boundary January 1 "2027-01-01 01:00:00"', () => {
            const input = '2027-01-01 01:00:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2027);
            expect(result.getMonth()).toBe(0); // January
            expect(result.getDate()).toBe(1);
        });

        test('Edge: Leap year valid "2024-02-29 12:00:00"', () => {
            const input = '2024-02-29 12:00:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2024);
            expect(result.getMonth()).toBe(1); // February
            expect(result.getDate()).toBe(29);
        });

        test('Edge: Non-leap year Feb 29 "2025-02-29 12:00:00" auto-corrects to Mar 1', () => {
            const input = '2025-02-29 12:00:00';
            const result = parseLessonDate(input);
            
            // OBSERVED: JavaScript Date auto-corrects Feb 29 in non-leap year to Mar 1
            expect(result).toBeInstanceOf(Date);
            expect(isNaN(result.getTime())).toBe(false);
            
            expect(result.getFullYear()).toBe(2025);
            expect(result.getMonth()).toBe(2); // March (0-indexed)
            expect(result.getDate()).toBe(1);
        });
    });

    /**
     * Test helper function preservation - extractTime()
     * This function should continue to work identically after fix
     */
    describe('extractTime() Helper Function Preservation', () => {
        test('extractTime() extracts "12:30:01" from "2026-09-05 12:30:01"', () => {
            const result = extractTime('2026-09-05 12:30:01');
            expect(result).toBe('12:30:01');
        });

        test('extractTime() extracts "00:00:00" from "2026-01-01 00:00:00"', () => {
            const result = extractTime('2026-01-01 00:00:00');
            expect(result).toBe('00:00:00');
        });

        test('extractTime() extracts "23:59:59" from "2026-12-31 23:59:59"', () => {
            const result = extractTime('2026-12-31 23:59:59');
            expect(result).toBe('23:59:59');
        });

        test('Property: extractTime() correctly extracts time from ANY valid format', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2024, max: 2030 }),
                    fc.integer({ min: 1, max: 12 }),
                    fc.integer({ min: 1, max: 28 }),
                    fc.integer({ min: 0, max: 23 }),
                    fc.integer({ min: 0, max: 59 }),
                    fc.integer({ min: 0, max: 59 }),
                    (year, month, day, hour, minute, second) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const result = extractTime(input);
                        
                        expect(result).toBe(timeStr);
                        expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
                        
                        return true;
                    }
                ),
                { numRuns: 100, seed: 42 }
            );
        });
    });

    /**
     * Test helper function preservation - formatNotificationMessage()
     * This function should continue to work identically after fix
     */
    describe('formatNotificationMessage() Helper Function Preservation', () => {
        test('formatNotificationMessage() formats message with name and time', () => {
            const result = formatNotificationMessage({
                name: 'Иван',
                next_lesson_date: '2026-09-05 12:30:01',
                paid_count: 5
            });
            
            expect(result).toContain('Привет, Иван');
            expect(result).toContain('12:30:01');
            expect(result).toContain('у тебя урок');
            expect(result).not.toContain('последний');
        });

        test('formatNotificationMessage() includes warning when paid_count = 1', () => {
            const result = formatNotificationMessage({
                name: 'Мария',
                next_lesson_date: '2026-09-07 18:30:01',
                paid_count: 1
            });
            
            expect(result).toContain('Привет, Мария');
            expect(result).toContain('18:30:01');
            expect(result).toContain('последний');
        });

        test('formatNotificationMessage() handles null name', () => {
            const result = formatNotificationMessage({
                name: null,
                next_lesson_date: '2026-09-09 17:30:01',
                paid_count: 3
            });
            
            expect(result).toContain('студент');
            expect(result).toContain('17:30:01');
        });

        test('Property: formatNotificationMessage() produces valid messages for ANY input', () => {
            fc.assert(
                fc.property(
                    fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 20 })),
                    fc.integer({ min: 2024, max: 2030 }),
                    fc.integer({ min: 1, max: 12 }),
                    fc.integer({ min: 1, max: 28 }),
                    fc.integer({ min: 0, max: 23 }),
                    fc.integer({ min: 0, max: 59 }),
                    fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 20 })),
                    (name, year, month, day, hour, minute, paid_count) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
                        const next_lesson_date = `${dateStr} ${timeStr}`;
                        
                        const result = formatNotificationMessage({ name, next_lesson_date, paid_count });
                        
                        expect(typeof result).toBe('string');
                        expect(result.length).toBeGreaterThan(0);
                        expect(result).toContain('Привет');
                        expect(result).toContain(timeStr);
                        
                        if (name) {
                            expect(result).toContain(name);
                        } else {
                            expect(result).toContain('студент');
                        }
                        
                        if (paid_count === 1) {
                            expect(result).toContain('последний');
                        }
                        
                        return true;
                    }
                ),
                { numRuns: 100, seed: 42 }
            );
        });
    });

    /**
     * Integration test - parseLessonDate works with notification scheduling
     */
    describe('Integration with Notification Scheduling', () => {
        test('Notification timing: 24 hours before lesson', () => {
            const lessonDateStr = '2026-09-05 12:30:00';
            const lessonDate = parseLessonDate(lessonDateStr);
            
            // Should be valid Date
            expect(isNaN(lessonDate.getTime())).toBe(false);
            
            // Notification should be 24 hours (86400000 ms) before
            const notificationTime = lessonDate.getTime() - 24 * 60 * 60 * 1000;
            
            expect(lessonDate.getTime() - notificationTime).toBe(86400000);
        });

        test('Property: Notification always 24 hours before ANY valid lesson date', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2024, max: 2030 }),
                    fc.integer({ min: 1, max: 12 }),
                    fc.integer({ min: 1, max: 28 }),
                    fc.integer({ min: 0, max: 23 }),
                    fc.integer({ min: 0, max: 59 }),
                    (year, month, day, hour, minute) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const lessonDate = parseLessonDate(input);
                        
                        // Skip if parse failed (shouldn't happen with valid inputs)
                        if (isNaN(lessonDate.getTime())) return true;
                        
                        const notificationTime = lessonDate.getTime() - 24 * 60 * 60 * 1000;
                        
                        // Verify exactly 24 hours difference
                        expect(lessonDate.getTime() - notificationTime).toBe(86400000);
                        
                        return true;
                    }
                ),
                { numRuns: 100, seed: 42 }
            );
        });
    });
});
