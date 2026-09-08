import {getDefaultSeparatedDueDate} from '../src/utils/separatedDueDate';

describe('annual separated-order deadline', () => {
  it('uses December 24 during the Christmas campaign', () => {
    expect(
      getDefaultSeparatedDueDate(new Date('2026-09-08T15:00:00.000Z')),
    ).toBe('2026-12-25T04:59:59.999Z');
    expect(
      getDefaultSeparatedDueDate(new Date('2027-10-23T15:00:00.000Z')),
    ).toBe('2027-12-25T04:59:59.999Z');
  });

  it('returns to two calendar months on October 24', () => {
    expect(
      getDefaultSeparatedDueDate(new Date('2026-10-24T15:30:00.000Z')),
    ).toBe('2026-12-24T15:30:00.000Z');
  });

  it('uses two months before September and clamps month ends', () => {
    expect(
      getDefaultSeparatedDueDate(new Date('2026-08-31T15:30:00.000Z')),
    ).toBe('2026-10-31T15:30:00.000Z');
    expect(
      getDefaultSeparatedDueDate(new Date('2026-12-31T15:30:00.000Z')),
    ).toBe('2027-02-28T15:30:00.000Z');
  });
});
