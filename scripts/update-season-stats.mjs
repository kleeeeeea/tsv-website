import { readFile, writeFile } from "node:fs/promises";

const VEREIN_PATH = "verein.html";
const HISTORY_URL = "https://www.fupa.net/team/tsv-hainsfarth-m1-2025-26/history";
const USER_AGENT = "Mozilla/5.0 (compatible; TSVHainsfarthBot/1.0)";

const extractScriptJson = (scriptContent) => {
  const jsonStart = scriptContent.indexOf("{");

  if (jsonStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < scriptContent.length; index += 1) {
    const char = scriptContent[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return scriptContent.slice(jsonStart, index + 1);
      }
    }
  }

  return null;
};

const extractReduxData = (html) => {
  const scriptContents = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean);

  const reduxScript = scriptContents.find((content) => content.includes("window.REDUX_DATA"));

  if (!reduxScript) {
    throw new Error("Could not find FuPa redux data");
  }

  const json = extractScriptJson(reduxScript);

  if (!json) {
    throw new Error("Could not parse FuPa redux data");
  }

  return JSON.parse(json);
};

const fetchReduxData = async (url) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`FuPa request failed for ${url}: ${response.status}`);
  }

  return extractReduxData(await response.text());
};

const findDataHistoryEntry = (reduxData, key) => {
  const dataHistory = Array.isArray(reduxData?.dataHistory) ? reduxData.dataHistory : [];
  return dataHistory.find((entry) => entry?.[key])?.[key] || null;
};

const normalizeLeagueName = (league = "") =>
  league
    .replace(/\s+\(bis 1998\)$/u, "")
    .replace(/\s+\(bis 2006\)$/u, "")
    .replace(/^A-Klasse Nord$/u, "A-Klasse")
    .replace(/^B-Klasse Nord$/u, "B-Klasse")
    .replace(/^Kreisklasse Nordschwaben 1$/u, "Kreisklasse Nord 1");

const parseExistingRows = (html) => {
  const tableMatch = html.match(
    /<table class="stats-table">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>[\s\S]*?<\/table>/u
  );

  if (!tableMatch) {
    throw new Error("Could not find stats table body in verein.html");
  }

  const rowMatches = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gu)];
  const entries = new Map();

  for (const rowMatch of rowMatches) {
    const cells = [...rowMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gu)].map((cell) =>
      cell[1].replace(/<[^>]+>/gu, "").trim()
    );

    if (cells.length !== 6) {
      continue;
    }

    entries.set(cells[0], {
      season: cells[0],
      league: cells[1],
      place: cells[2],
      topScorer: cells[3],
      goals: cells[4],
      trainer: cells[5],
    });
  }

  return entries;
};

const compareSeasonLabelsDesc = (left, right) => {
  const [leftStart, leftEnd] = toSortableSeasonLabel(left);
  const [rightStart, rightEnd] = toSortableSeasonLabel(right);

  if (leftStart !== rightStart) {
    return rightStart - leftStart;
  }

  return rightEnd - leftEnd;
};

const toSortableSeasonLabel = (label) => {
  const [startPart, endPart] = label.split("/");
  const start = Number(startPart);
  const end = Number(endPart);
  return [start < 70 ? 2000 + start : 1900 + start, endPart?.length === 2 ? end : 0];
};

const formatPlayerName = (player) => `${player.lastName} ${player.firstName}`.trim();

const buildTopScorer = (players = [], existingEntry, shouldPreferFuPa) => {
  if (!shouldPreferFuPa && existingEntry?.topScorer) {
    return {
      topScorer: existingEntry.topScorer,
      goals: existingEntry.goals || "",
    };
  }

  const ranked = [...players]
    .filter((player) => Number(player?.goals || 0) > 0)
    .sort((left, right) => {
      if ((right.goals || 0) !== (left.goals || 0)) {
        return (right.goals || 0) - (left.goals || 0);
      }

      return formatPlayerName(left).localeCompare(formatPlayerName(right), "de");
    });

  if (!ranked.length) {
    return {
      topScorer: existingEntry?.topScorer || "",
      goals: existingEntry?.goals || "",
    };
  }

  const bestGoals = ranked[0].goals || 0;
  const leaders = ranked.filter((player) => (player.goals || 0) === bestGoals);

  if (leaders.length === 1) {
    return {
      topScorer: formatPlayerName(leaders[0]),
      goals: String(bestGoals),
    };
  }

  return {
    topScorer: leaders.map(formatPlayerName).join(" / "),
    goals: leaders.map((player) => String(player.goals || 0)).join("/"),
  };
};

const fetchPlayerStatsBySeason = async (slug) => {
  const reduxData = await fetchReduxData(`https://www.fupa.net/team/${slug}/playerstats`);
  const statsPage = findDataHistoryEntry(reduxData, "TeamPlayerStatsPage");
  return Array.isArray(statsPage?.season?.players) ? statsPage.season.players : [];
};

const buildRows = async () => {
  const vereinSource = await readFile(VEREIN_PATH, "utf8");
  const existingRows = parseExistingRows(vereinSource);

  const historyRedux = await fetchReduxData(HISTORY_URL);
  const historyPage = findDataHistoryEntry(historyRedux, "TeamHistoryPage");
  const historyItems = Array.isArray(historyPage?.items) ? historyPage.items : [];
  const newestExistingSeason = [...existingRows.keys()].sort(compareSeasonLabelsDesc)[0] || "";
  const [newestExistingStartYear] = toSortableSeasonLabel(newestExistingSeason);

  const relevantItems = historyItems
    .filter((item) => item?.competition?.category?.name === "Liga")
    .filter((item) => item?.competition?.name && item.competition.name !== "noch nicht zugeordnet")
    .filter((item) => item?.rank || existingRows.has(item?.competition?.season?.name || ""))
    .sort((left, right) =>
      compareSeasonLabelsDesc(left?.competition?.season?.name || "", right?.competition?.season?.name || "")
    );

  const rowsBySeason = new Map(existingRows);

  for (const item of relevantItems) {
    const season = item?.competition?.season?.name || "";
    const existingEntry = existingRows.get(season);

    if (!existingEntry) {
      const [seasonStartYear] = toSortableSeasonLabel(season);

      if (seasonStartYear <= newestExistingStartYear) {
        continue;
      }
    }

    const players = await fetchPlayerStatsBySeason(item.slug).catch(() => []);
    const shouldPreferFuPaTopScorer = Boolean(item?.competition?.active) || !existingEntry?.topScorer;
    const topScorer = buildTopScorer(players, existingEntry, shouldPreferFuPaTopScorer);

    rowsBySeason.set(season, {
      season,
      league: normalizeLeagueName(item?.competition?.name || existingEntry?.league || ""),
      place: item?.rank ? `${item.rank}.` : existingEntry?.place || "",
      topScorer: topScorer.topScorer,
      goals: topScorer.goals,
      trainer: existingEntry?.trainer || "",
    });
  }

  const rows = [...rowsBySeason.values()].sort((left, right) =>
    compareSeasonLabelsDesc(left?.season || "", right?.season || "")
  );

  return { vereinSource, rows };
};

const renderRowsHtml = (rows) =>
  rows
    .map(
      (row) =>
        `                <tr><td>${row.season}</td><td>${row.league}</td><td>${row.place}</td><td>${row.topScorer}</td><td>${row.goals}</td><td>${row.trainer}</td></tr>`
    )
    .join("\n");

const updateVereinHtml = async () => {
  const { vereinSource, rows } = await buildRows();
  const rowsHtml = renderRowsHtml(rows);
  const tablePattern =
    /(<table class="stats-table">[\s\S]*?<tbody>)([\s\S]*?)(<\/tbody>[\s\S]*?<\/table>)/u;
  const tableMatch = vereinSource.match(tablePattern);

  if (!tableMatch) {
    throw new Error("Could not replace season statistics rows in verein.html");
  }

  const currentRowsMarkup = tableMatch[2].trim();

  if (currentRowsMarkup === rowsHtml.trim()) {
    console.log(`Season statistics already up to date with ${rows.length} FuPa seasons.`);
    return;
  }

  const nextSource = vereinSource.replace(
    tablePattern,
    `$1\n${rowsHtml}\n              $3`
  );

  await writeFile(VEREIN_PATH, nextSource);
  console.log(`Updated season statistics with ${rows.length} FuPa seasons.`);
};

await updateVereinHtml();
