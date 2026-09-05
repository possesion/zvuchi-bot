/**
 * Bug Condition Exploration Test - Timezone Handling Bug
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
 * 
 * **CRITICAL**: This test is EXPECTED TO FAIL on unfixed code
 * Failure confirms the timezone bug exists - parseLessonDate interprets MSK dates
 * as local timezone instead of explicitly handling UTC+3 offset
 * 
 * **Bug Description**:
 * parseLessonDate() uses `new Date(year, month, day, hours, minutes)` which creates
 * a Date object in the server's LOCAL timezone. In Docker with UTC timezone, this
 * causes MSK dates from CRM to be interpreted as UTC, resulting in +3 hour offset.
 * 
 * Example: "2026-09-05 12:30:01" MSK should become 2026-09-05T09:30:00.000Z (UTC)
 *          but currently becomes 2026-09-05T12:30:00.000Z (wrong!)
 * 
 * **Expected Behavior After Fix**:
 * parseLessonDate() should explicitly convert MSK to UTC by treating input as MSK
 * and subtracting 3 hours, regardless of server timezone
 */

'use strict';

const fc = require('fast-check');

// Mock process.env.TZ to simulate UTC environment for testing
const originalTZ = process.env.TZ;

describe('Property 1: Bug Condition - MSK Date Parsing in UTC Environment', () => {
    let parseLessonDate;
    
    beforeAll(() => {
        // Simulate UTC environment (like Docker production)
        process.env.TZ = 'UTC';
        // Re-import to pick up timezone change
        parseLessonDate = require('./notifications').parseLessonDate;
    });
    
    afterAll(() => {
        // Restore original timezone
        process.env.TZ = originalTZ;
    });

    /**
     * Test concrete failing case from bugfix requirements
     * This is the PRIMARY example of the bug
     */
    describe('Concrete Counterexamples - Core Bug Cases', () => {
        test('Counterexample 1: "2026-09-05 12:30:01" MSK should produce UTC timestamp 1788600600000', () => {
            const input = '2026-09-05 12:30:01';
            const result = parseLessonDate(input);
            
            // Expected: 2026-09-05 12:30 MSK = 2026-09-05 09:30 UTC
            const expectedTimestamp = 1788600600000; // 2026-09-05T09:30:00.000Z
            const expectedISO = '2026-09-05T09:30:00.000Z';
            
            // This WILL FAIL on unfixed code with timestamp 1788611400000 (2026-09-05T12:30:00.000Z)
            // The difference is exactly 10800000ms = 3 hours
            expect(result.getTime()).toBe(expectedTimestamp);
            expect(result.toISOString()).toBe(expectedISO);
            
            // Verify UTC components after conversion
            expect(result.getUTCFullYear()).toBe(2026);
            expect(result.getUTCMonth()).toBe(8); // September (0-indexed)
            expect(result.getUTCDate()).toBe(5);
            expect(result.getUTCHours()).toBe(9); // 12:30 MSK = 09:30 UTC
            expect(result.getUTCMinutes()).toBe(30);
        });

        test('Counterexample 2: Notification scheduling - lesson at "2026-09-05 12:30:01" MSK', () => {
            const input = '2026-09-05 12:30:01';
            const lessonDate = parseLessonDate(input);
            
            // Notification should be scheduled 24 hours before lesson
            const notificationTimestamp = lessonDate.getTime() - 24 * 60 * 60 * 1000;
            
            // Expected: 2026-09-04 09:30 UTC (24 hours before 2026-09-05 09:30 UTC)
            const expectedNotificationTimestamp = 1788514200000; // 2026-09-04T09:30:00.000Z
            const expectedISO = '2026-09-04T09:30:00.000Z';
            
            // This WILL FAIL on unfixed code
            // Current (buggy): 1788525000000 (2026-09-04T12:30:00.000Z) - 3 hours late
            expect(notificationTimestamp).toBe(expectedNotificationTimestamp);
            expect(new Date(notificationTimestamp).toISOString()).toBe(expectedISO);
        });

        test('Counterexample 3: Midnight boundary - "2026-09-05 00:30:01" MSK', () => {
            const input = '2026-09-05 00:30:01';
            const result = parseLessonDate(input);
            
            // Expected: 2026-09-05 00:30 MSK = 2026-09-04 21:30 UTC (previous day!)
            const expectedTimestamp = 1788557400000; // 2026-09-04T21:30:00.000Z
            const expectedISO = '2026-09-04T21:30:00.000Z';
            
            // This WILL FAIL on unfixed code with timestamp 1788568200000 (2026-09-05T00:30:00.000Z)
            expect(result.getTime()).toBe(expectedTimestamp);
            expect(result.toISOString()).toBe(expectedISO);
            
            // Verify day boundary is crossed correctly
            expect(result.getUTCDate()).toBe(4); // Should be day 4, not day 5
            expect(result.getUTCHours()).toBe(21); // Should be 21:30 UTC, not 00:30 UTC
        });
    });

    /**
     * Test that the offset is consistently +3 hours on unfixed code
     * This confirms the bug is systematic, not random
     */
    describe('Offset Measurement - Quantify the Bug', () => {
        test('Offset measurement: difference between buggy and correct timestamps is exactly 10800000ms (3 hours)', () => {
            const input = '2026-09-05 12:30:01';
            const buggyResult = parseLessonDate(input);
            
            const expectedCorrectTimestamp = 1788600600000; // What it SHOULD be
            const buggyTimestamp = buggyResult.getTime();
            
            const offset = buggyTimestamp - expectedCorrectTimestamp;
            
            // On unfixed code, this offset will be +10800000ms (3 hours)
            // After fix, offset should be 0
            const threeHoursInMs = 3 * 60 * 60 * 1000; // 10800000
            
            // This assertion documents the bug: we expect +3 hour offset on unfixed code
            // After fix, this test will pass because offset === 0
            expect(offset).toBe(0);
            
            // Alternative check: buggy timestamp should equal correct timestamp
            expect(buggyTimestamp).toBe(expectedCorrectTimestamp);
        });
    });

    /**
     * Property-Based Test: For ALL MSK dates, conversion to UTC should be correct
     * Generates random dates and verifies MSK → UTC conversion
     * 
     * This will FAIL massively on unfixed code, providing many counterexamples
     */
    describe('Property-Based Testing - Universal Bug Condition', () => {
        test('Property 1: ALL MSK dates convert correctly to UTC (MSK - 3 hours)', () => {
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
                    (year, month, day, hour, minute) => {
                        // Format as CRM date string "YYYY-MM-DD HH:MM:SS"
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:01`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const result = parseLessonDate(input);
                        
                        // Calculate expected UTC timestamp
                        // MSK date → create as UTC → subtract 3 hours
                        const mskAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
                        const mskOffset = 3 * 60 * 60 * 1000; // 3 hours
                        const expectedUTC = mskAsUTC - mskOffset;
                        
                        const actualTimestamp = result.getTime();
                        
                        // This will FAIL on unfixed code for all cases
                        // Unfixed code: actualTimestamp === mskAsUTC (no offset applied)
                        // Fixed code: actualTimestamp === expectedUTC (offset applied)
                        expect(actualTimestamp).toBe(expectedUTC);
                        
                        return true;
                    }
                ),
                { numRuns: 50, seed: 12345 }
            );
        });

        test('Property 2: Notification scheduling always 24h before lesson in UTC', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 2025, max: 2030 }),
                    fc.integer({ min: 1, max: 12 }),
                    fc.integer({ min: 2, max: 28 }), // Day 2-28 to ensure 24h before is valid
                    fc.integer({ min: 0, max: 23 }),
                    fc.integer({ min: 0, max: 59 }),
                    (year, month, day, hour, minute) => {
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:01`;
                        const input = `${dateStr} ${timeStr}`;
                        
                        const lessonDate = parseLessonDate(input);
                        const notificationTime = lessonDate.getTime() - 24 * 60 * 60 * 1000;
                        
                        // Calculate expected notification time
                        const mskAsUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
                        const mskOffset = 3 * 60 * 60 * 1000;
                        const expectedLessonUTC = mskAsUTC - mskOffset;
                        const expectedNotificationUTC = expectedLessonUTC - 24 * 60 * 60 * 1000;
                        
                        // This will FAIL on unfixed code
                        expect(notificationTime).toBe(expectedNotificationUTC);
                        
                        return true;
                    }
                ),
                { numRuns: 30, seed: 67890 }
            );
        });
    });

    /**
     * Edge cases that are particularly problematic
     */
    describe('Edge Cases - Boundary Conditions', () => {
        test('Edge Case: Early morning MSK time crosses to previous day UTC', () => {
            const input = '2026-09-05 01:00:01'; // 1 AM MSK
            const result = parseLessonDate(input);
            
            // Expected: 2026-09-05 01:00 MSK = 2026-09-04 22:00 UTC (previous day)
            const expectedTimestamp = 1788559200000; // 2026-09-04T22:00:00.000Z
            
            expect(result.getTime()).toBe(expectedTimestamp);
            expect(result.getUTCDate()).toBe(4); // Previous day
            expect(result.getUTCHours()).toBe(22);
        });

        test('Edge Case: Late evening MSK time', () => {
            const input = '2026-09-05 23:59:01'; // Almost midnight MSK
            const result = parseLessonDate(input);
            
            // Expected: 2026-09-05 23:59 MSK = 2026-09-05 20:59 UTC (same day)
            const expectedTimestamp = 1788641940000; // 2026-09-05T20:59:00.000Z
            
            expect(result.getTime()).toBe(expectedTimestamp);
            expect(result.getUTCDate()).toBe(5); // Same day
            expect(result.getUTCHours()).toBe(20);
        });

        test('Edge Case: Year boundary - December 31 MSK', () => {
            const input = '2026-12-31 23:30:01';
            const result = parseLessonDate(input);
            
            // Expected: 2026-12-31 23:30 MSK = 2026-12-31 20:30 UTC
            const mskAsUTC = Date.UTC(2026, 11, 31, 23, 30, 0);
            const expectedTimestamp = mskAsUTC - 3 * 60 * 60 * 1000;
            
            expect(result.getTime()).toBe(expectedTimestamp);
            expect(result.getUTCFullYear()).toBe(2026);
            expect(result.getUTCMonth()).toBe(11);
            expect(result.getUTCDate()).toBe(31);
        });

        test('Edge Case: January 1 early morning MSK crosses to previous year UTC', () => {
            const input = '2027-01-01 01:30:01';
            const result = parseLessonDate(input);
            
            // Expected: 2027-01-01 01:30 MSK = 2026-12-31 22:30 UTC (previous year!)
            const mskAsUTC = Date.UTC(2027, 0, 1, 1, 30, 0);
            const expectedTimestamp = mskAsUTC - 3 * 60 * 60 * 1000;
            
            expect(result.getTime()).toBe(expectedTimestamp);
            expect(result.getUTCFullYear()).toBe(2026); // Previous year
            expect(result.getUTCMonth()).toBe(11); // December
            expect(result.getUTCDate()).toBe(31); // Last day of previous year
        });
    });
});
