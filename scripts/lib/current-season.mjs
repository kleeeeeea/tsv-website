const DEFAULT_TIME_ZONE = "Europe/Berlin";
const SEASON_SWITCH_MONTH = 7;

const getDatePart = (date, part, timeZone = DEFAULT_TIME_ZONE) =>
  Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      [part]: "2-digit",
    }).format(date)
  );

export const getCurrentSeasonStartYear = (date = new Date(), timeZone = DEFAULT_TIME_ZONE) => {
  const month = getDatePart(date, "month", timeZone);
  const year = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
    }).format(date)
  );

  return month >= SEASON_SWITCH_MONTH ? year : year - 1;
};

export const getCurrentSeason = (date = new Date(), timeZone = DEFAULT_TIME_ZONE) => {
  const startYear = getCurrentSeasonStartYear(date, timeZone);
  const endYear = startYear + 1;

  return {
    startYear,
    endYear,
    label: `${startYear}/${endYear}`,
    slug: `${startYear}-${String(endYear).slice(-2)}`,
  };
};
