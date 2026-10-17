/**
 * The weekdays and services of a transport booking, in words a parent and
 * the provider read the same way. Pure, for the form, the payment page, the
 * payment lines and the rider list alike.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WeekdaySet = Record<Weekday, boolean>;

const NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
};

export function daysCount(days: WeekdaySet): number {
  return WEEKDAYS.filter((d) => days[d]).length;
}

/**
 * "Monday to Friday", "Monday to Wednesday", "Monday, Wednesday and Friday",
 * "Tuesday". A run of three or more reads as a range; anything else is a list.
 */
export function weekdaysLabel(days: WeekdaySet): string {
  const chosen = WEEKDAYS.filter((d) => days[d]);
  if (chosen.length === 0) return "No days";
  const first = WEEKDAYS.indexOf(chosen[0]);
  const consecutive = chosen.every((d, i) => WEEKDAYS.indexOf(d) === first + i);
  if (consecutive && chosen.length >= 3) return `${NAMES[chosen[0]]} to ${NAMES[chosen[chosen.length - 1]]}`;
  const names = chosen.map((d) => NAMES[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const SERVICE_LABELS = {
  full: "Morning and afternoon",
  am: "Morning only (home to school)",
  pm: "Afternoon only (school to home)",
} as const;

export type ServiceCode = keyof typeof SERVICE_LABELS;

export const HOUSEHOLD_LABELS = {
  single: "One child",
  same_school: "More than one child, same school",
  different_schools: "More than one child, different schools",
} as const;
