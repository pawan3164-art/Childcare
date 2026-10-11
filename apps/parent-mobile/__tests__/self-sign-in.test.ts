import { nextSignAction, normaliseCode, isCompleteCode, signInResultMessage, selfSignInErrorMessage } from '@/lib/self-sign-in';

describe('nextSignAction', () => {
  it('offers sign in when there are no events today', () => {
    expect(nextSignAction('NO_EVENTS_TODAY')).toEqual({ eventType: 'SIGN_IN', label: 'Sign in' });
  });

  it('offers sign in again after sign out', () => {
    expect(nextSignAction('SIGNED_OUT')).toEqual({ eventType: 'SIGN_IN', label: 'Sign in again' });
  });

  it('offers sign out when signed in', () => {
    expect(nextSignAction('SIGNED_IN')).toEqual({ eventType: 'SIGN_OUT', label: 'Sign out' });
  });
});

describe('normaliseCode', () => {
  it('keeps a plain 6 digit code', () => expect(normaliseCode('123456')).toBe('123456'));
  it('strips spaces', () => expect(normaliseCode('123 456')).toBe('123456'));
  it('strips dashes', () => expect(normaliseCode('123-456')).toBe('123456'));
  it('strips letters and other characters', () => expect(normaliseCode('a1b2.c3!4 5_6')).toBe('123456'));
  it('truncates to 6 characters', () => expect(normaliseCode('123456789')).toBe('123456'));
  it('truncates after stripping', () => expect(normaliseCode('12 34 56 78')).toBe('123456'));
  it('keeps a partial code', () => expect(normaliseCode('12')).toBe('12'));
  it('returns empty for empty input', () => expect(normaliseCode('')).toBe(''));
  it('returns empty when there are no digits', () => expect(normaliseCode('abc- ')).toBe(''));
  it('returns empty for non-string input', () => {
    expect(normaliseCode(undefined as unknown as string)).toBe('');
    expect(normaliseCode(null as unknown as string)).toBe('');
    expect(normaliseCode(123456 as unknown as string)).toBe('');
  });
});

describe('isCompleteCode', () => {
  it('is true for exactly 6 digits', () => expect(isCompleteCode('123456')).toBe(true));
  it('is true for a formatted 6 digit code', () => expect(isCompleteCode('123 456')).toBe(true));
  it('is true when longer input truncates to 6 digits', () => expect(isCompleteCode('1234567')).toBe(true));
  it('is false for 5 digits', () => expect(isCompleteCode('12345')).toBe(false));
  it('is false for empty input', () => expect(isCompleteCode('')).toBe(false));
  it('is false when letters leave fewer than 6 digits', () => expect(isCompleteCode('12ab34')).toBe(false));
  it('is false for non-string input', () => expect(isCompleteCode(undefined as unknown as string)).toBe(false));
});

describe('signInResultMessage', () => {
  const instant = '2026-10-13T20:00:00Z';

  it('describes a sign in with a clock time', () => {
    expect(signInResultMessage('SIGN_IN', 'Mia', instant)).toMatch(/^Mia is signed in at \d{1,2}:\d{2}\s?(am|pm)\.$/i);
  });

  it('describes a sign out with a clock time', () => {
    expect(signInResultMessage('SIGN_OUT', 'Mia', instant)).toMatch(/^Mia is signed out at \d{1,2}:\d{2}\s?(am|pm)\.$/i);
  });

  it('uses the given time zone: 20:00Z is 7:00 am in Sydney (AEDT)', () => {
    expect(signInResultMessage('SIGN_IN', 'Mia', instant, 'Australia/Sydney')).toMatch(/^Mia is signed in at 7:00\s?am\.$/i);
  });

  it('uses the given time zone for sign out', () => {
    expect(signInResultMessage('SIGN_OUT', 'Mia', '2026-10-13T05:05:00Z', 'Australia/Sydney')).toMatch(
      /^Mia is signed out at 4:05\s?pm\.$/i,
    );
  });

  it('falls back to Your child for a blank first name', () => {
    expect(signInResultMessage('SIGN_IN', '', instant, 'Australia/Sydney')).toMatch(/^Your child is signed in at 7:00\s?am\.$/i);
  });

  it('falls back to Your child for a whitespace first name', () => {
    expect(signInResultMessage('SIGN_OUT', '   ', instant, 'Australia/Sydney')).toMatch(/^Your child is signed out at /);
  });
});

describe('selfSignInErrorMessage', () => {
  it('403 not turned on', () => {
    expect(selfSignInErrorMessage(403, 'Self sign-in is Not Turned On for this centre', 'Mia')).toBe(
      'Your centre has not turned on sign-in from the app. Please see a member of staff.',
    );
  });

  it('403 too many attempts', () => {
    expect(selfSignInErrorMessage(403, 'Too many attempts', 'Mia')).toBe(
      'Too many wrong codes. Please wait a few minutes or see a member of staff.',
    );
  });

  it('403 code not right', () => {
    expect(selfSignInErrorMessage(403, 'That code is not right', 'Mia')).toBe(
      'That code is not right or has expired. Check the screen at the centre and try again.',
    );
  });

  it('403 code expired', () => {
    expect(selfSignInErrorMessage(403, 'Code EXPIRED', 'Mia')).toBe(
      'That code is not right or has expired. Check the screen at the centre and try again.',
    );
  });

  it('other 403 uses the permission message with the child name', () => {
    expect(selfSignInErrorMessage(403, 'Forbidden', 'Mia')).toBe(
      "You don't have permission to sign Mia in or out. Please see a member of staff.",
    );
  });

  it('403 with empty server message uses the permission message', () => {
    expect(selfSignInErrorMessage(403, '', 'Leo')).toBe("You don't have permission to sign Leo in or out. Please see a member of staff.");
  });

  it('409 returns the server message unchanged', () => {
    expect(selfSignInErrorMessage(409, 'Mia is already signed in.', 'Mia')).toBe('Mia is already signed in.');
  });

  it('status 0 means no connection', () => {
    expect(selfSignInErrorMessage(0, '', 'Mia')).toBe('No connection. Try again when you are back online.');
  });

  it('other statuses return the server message when present', () => {
    expect(selfSignInErrorMessage(500, 'Internal problem', 'Mia')).toBe('Internal problem');
    expect(selfSignInErrorMessage(404, 'Child not found', 'Mia')).toBe('Child not found');
  });

  it('other statuses fall back to a generic message when the server message is empty', () => {
    expect(selfSignInErrorMessage(500, '', 'Mia')).toBe('Something went wrong. Please try again.');
  });
});
