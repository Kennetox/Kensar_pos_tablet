const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

type BogotaDateParts = {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
};

function getBogotaDateParts(value: Date): BogotaDateParts {
  const shifted = new Date(value.getTime() - BOGOTA_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    seconds: shifted.getUTCSeconds(),
    milliseconds: shifted.getUTCMilliseconds(),
  };
}

function fromBogotaDateParts(parts: BogotaDateParts): Date {
  return new Date(
    Date.UTC(
      parts.year,
      parts.month,
      parts.day,
      parts.hours + 5,
      parts.minutes,
      parts.seconds,
      parts.milliseconds,
    ),
  );
}

function addCalendarMonths(parts: BogotaDateParts, months: number): BogotaDateParts {
  const monthIndex = parts.month + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {...parts, year, month, day: Math.min(parts.day, lastDay)};
}

export function getDefaultSeparatedDueDate(now: Date = new Date()): string {
  const current = getBogotaDateParts(now);
  const isChristmasCampaign =
    current.month === 8 || (current.month === 9 && current.day < 24);

  if (isChristmasCampaign) {
    return fromBogotaDateParts({
      year: current.year,
      month: 11,
      day: 24,
      hours: 23,
      minutes: 59,
      seconds: 59,
      milliseconds: 999,
    }).toISOString();
  }

  return fromBogotaDateParts(addCalendarMonths(current, 2)).toISOString();
}
