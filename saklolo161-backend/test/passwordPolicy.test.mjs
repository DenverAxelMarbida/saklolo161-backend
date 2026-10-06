/**
 * test/passwordPolicy.test.mjs
 * --------------------------------------------------------------
 * Unit tests for the shared password policy
 * (services/passwordPolicy.js) — the single source of truth the
 * admin create-user flow AND the self-service change-password flow
 * both validate against.
 *
 * Policy: >= 16 chars, >= 1 lowercase, >= 1 uppercase, >= 1 digit,
 * >= 1 special character.
 * --------------------------------------------------------------
 */

import { describe, it, expect } from 'vitest';
import passwordPolicy from '../services/passwordPolicy.js';

const { isStrongPassword, passwordFailures, PASSWORD_REQUIREMENTS } = passwordPolicy;

describe('password policy', () => {
  it('rejects a password shorter than 16 characters', () => {
    expect(isStrongPassword('Sh0rt!Pass')).toBe(false);
    expect(passwordFailures('Sh0rt!Pass')).toContain('must be at least 16 characters');
  });

  it('accepts exactly 16 characters satisfying every requirement', () => {
    // 16 chars: upper A, lower b, digit 1, special !
    expect(isStrongPassword('Ab1!Ab1!Ab1!Ab1!')).toBe(true);
    expect(passwordFailures('Ab1!Ab1!Ab1!Ab1!')).toEqual([]);
  });

  it('rejects a password with no lowercase letter', () => {
    const pw = 'AAAAAAA1!AAAAAAAA'; // 17 chars, no lowercase
    expect(isStrongPassword(pw)).toBe(false);
    expect(passwordFailures(pw)).toContain('must contain at least 1 lowercase letter');
  });

  it('rejects a password with no uppercase letter', () => {
    const pw = 'aaaaaaa1!aaaaaaaa'; // 17 chars, no uppercase
    expect(isStrongPassword(pw)).toBe(false);
    expect(passwordFailures(pw)).toContain('must contain at least 1 uppercase letter');
  });

  it('rejects a password with no number', () => {
    const pw = 'Abc!Abc!Abc!Abc!A'; // 17 chars, no digit
    expect(isStrongPassword(pw)).toBe(false);
    expect(passwordFailures(pw)).toContain('must contain at least 1 number');
  });

  it('rejects a password with no special character', () => {
    const pw = 'Abc1Abc1Abc1Abc1A'; // 17 chars, no special
    expect(isStrongPassword(pw)).toBe(false);
    expect(passwordFailures(pw)).toContain('must contain at least 1 special character');
  });

  it('accepts a longer valid password', () => {
    expect(isStrongPassword('Str0ngPass!xK9pQ2')).toBe(true);
    expect(passwordFailures('Str0ngPass!xK9pQ2')).toEqual([]);
  });

  it('rejects non-string input instead of throwing', () => {
    expect(isStrongPassword(null)).toBe(false);
    expect(isStrongPassword(undefined)).toBe(false);
    expect(isStrongPassword(1234567890123456)).toBe(false);
  });

  it('exposes exactly the five policy requirements', () => {
    expect(PASSWORD_REQUIREMENTS).toHaveLength(5);
    expect(PASSWORD_REQUIREMENTS.map((r) => r.id)).toEqual([
      'length',
      'lowercase',
      'uppercase',
      'number',
      'special',
    ]);
    for (const requirement of PASSWORD_REQUIREMENTS) {
      expect(typeof requirement.label).toBe('string');
      expect(typeof requirement.test).toBe('function');
    }
  });
});
