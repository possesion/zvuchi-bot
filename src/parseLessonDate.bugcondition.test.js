/**
 * Bug Condition Exploration Test - Date Parsing Bug
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3**
 * 
 * **CRITICAL**: This test is EXPECTED TO FAIL on unfixed code
 * Failure confirms the bug exists - the parser cannot handle ISO format dates
 * 
 * **Bug Description**:
 * parseLessonDate() expects "DD.MM.YYYY HH:MM" but CRM returns "YYYY-MM-DD HH:MM:SS"
 * Current implementation splits by '.' which fails on dash-separated dates
 * Results in Invalid Date → NaN timestamp → notifications never scheduled
 * 
 * **Expected Behavior After Fix**:
 * parseLessonDate() should correctly parse ISO format dates "YYYY-MM-DD HH:MM:SS"
 * and return valid Date objects with correct components
 */

'use strict';

const fc = require('fast-check');
const { parseLessonDate } = require('./notifications');

describe('Property 1: Bug Condition - ISO Format Date Parsing Failure', () => {
    /**
     * Test concrete failing examples from production logs
     * These are actual date strings returned by CRM API that cause the bug
     */
    describe('Concrete Counterexamples from Production', () => {
        test('Counterexample 1: "2026-09-05 12:30:01" - parseLessonDate returns valid Date', () => {
            const input = '2026-09-05 12:30:01';
            const result = parseLessonDate(input);
            
            // After fix: should return valid Date object
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            // Verify correct component extraction
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(8); // September is month 8 (0-indexed)
            expect(result.getDate()).toBe(5);
            expect(result.getHours()).toBe(12);
            expect(result.getMinutes()).toBe(30);
        });

        test('Counterexample 2: "2026-09-07 18:30:01" - parseLessonDate returns valid Date', () => {
            const input = '2026-09-07 18:30:01';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(8); // September
            expect(result.getDate()).toBe(7);
            expect(result.getHours()).toBe(18);
            expect(result.getMinutes()).toBe(30);
        });

        test('Counterexample 3: "2026-09-09 17:30:01" - parseLessonDate returns valid Date', () => {
            const input = '2026-09-09 17:30:01';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(8); // September
            expect(result.getDate()).toBe(9);
            expect(result.getHours()).toBe(17);
            expect(result.getMinutes()).toBe(30);
        });
    });

    /**
     * Test edge cases with ISO format
     */
    describe('Edge Cases with ISO Format', () => {
        test('Edge Case: Midnight "2026-01-01 00:00:00"', () => {
            const input = '2026-01-01 00:00:00';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(0); // January
            expect(result.getDate()).toBe(1);
            expect(result.getHours()).toBe(0);
            expect(result.getMinutes()).toBe(0);
        });

        test('Edge Case: Year boundary "2026-12-31 23:59:59"', () => {
            const input = '2026-12-31 23:59:59';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(11); // December
            expect(result.getDate()).toBe(31);
            expect(result.getHours()).toBe(23);
            expect(result.getMinutes()).toBe(59);
        });

        test('Edge Case: Different month "2026-12-15 18:45:30"', () => {
            const input = '2026-12-15 18:45:30';
            const result = parseLessonDate(input);
            
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).not.toBeNaN();
            
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(11); // December
            expect(result.getDate()).toBe(15);
            expect(result.getHours()).toBe(18);
            expect(result.getMinutes()).toBe(45);
        });
    });

    /**
     * Property-Based Test: For ALL inputs matching ISO format pattern
     * parseLessonDate should return valid Date with correct components
     * 
     * Generates random valid ISO format dates and verifies parsing
     */
    test('Property 1: ALL ISO format dates "YYYY-MM-DD HH:MM:SS" parse correctly', () => {
        fc.assert(
            fc.property(
                // Generate year 2025-2030
                fc.integer({ min: 2025, max: 2030 }),
                // Generate month 1-12
                fc.integer({ min: 1, max: 12 }),
                // Generate day 1-28 (safe for all months)
                fc.integer({ min: 1, max: 28 }),
                // Generate hour 0-23
                fc.integer({ min: 0, max: 23 }),
                // Generate minute 0-59
                fc.integer({ min: 0, max: 59 }),
                // Generate second 0-59
                fc.integer({ min: 0, max: 59 }),
                (year, month, day, hour, minute, second) => {
                    // Format as ISO-like string "YYYY-MM-DD HH:MM:SS"
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
                    const input = `${dateStr} ${timeStr}`;
                    
                    const result = parseLessonDate(input);
                    
                    // Assert: result is valid Date object
                    expect(result).toBeInstanceOf(Date);
                    
                    // Assert: timestamp is valid (not NaN)
                    const timestamp = result.getTime();
                    expect(timestamp).not.toBeNaN();
                    expect(typeof timestamp).toBe('number');
                    expect(timestamp).toBeGreaterThan(0);
                    
                    // Assert: extracted components match input
                    expect(result.getFullYear()).toBe(year);
                    expect(result.getMonth()).toBe(month - 1); // 0-indexed
                    expect(result.getDate()).toBe(day);
                    expect(result.getHours()).toBe(hour);
                    expect(result.getMinutes()).toBe(minute);
                    // Seconds are ignored - not tested
                    
                    return true;
                }
            ),
            { numRuns: 100, seed: 42 }
        );
    });
});
