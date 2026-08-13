import { describe, expect, test } from 'bun:test';
import { versionCodeFromSemver } from '../scripts/version-code.mjs';

describe('versionCodeFromSemver', () => {
    test('maps semver to Android versionCode', () => {
        expect(versionCodeFromSemver('1.0.23')).toBe(10023);
        expect(versionCodeFromSemver('2.15.7')).toBe(21507);
    });

    test('returns 0 for invalid version', () => {
        expect(versionCodeFromSemver('bad')).toBe(0);
    });
});
