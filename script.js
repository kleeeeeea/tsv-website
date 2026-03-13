const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const audioToggle = document.querySelector("[data-audio-toggle]");
const clubAudio = document.querySelector("[data-club-audio]");

if (audioToggle && clubAudio) {
  const syncAudioState = () => {
    audioToggle.classList.toggle("is-playing", !clubAudio.paused);
  };

  const kickBall = () => {
    audioToggle.classList.remove("is-kicking");
    void audioToggle.offsetWidth;
    audioToggle.classList.add("is-kicking");
  };

  const tryPlayAudio = () => {
    clubAudio.play().then(syncAudioState).catch(() => {
      syncAudioState();
    });
  };

  audioToggle.addEventListener("click", () => {
    kickBall();

    if (clubAudio.paused) {
      tryPlayAudio();
    } else {
      clubAudio.pause();
      syncAudioState();
    }
  });

  clubAudio.addEventListener("play", syncAudioState);
  clubAudio.addEventListener("pause", syncAudioState);

  window.addEventListener("load", () => {
    tryPlayAudio();
  });
}

const countdownRoot = document.querySelector("[data-countdown]");

if (countdownRoot) {
  const dateNode = countdownRoot.querySelector("[data-countdown-date]");
  const locationNode = countdownRoot.querySelector("[data-countdown-location]");
  const timerNode = countdownRoot.querySelector("[data-countdown-timer]");
  const countdownSrc = countdownRoot.getAttribute("data-countdown-src");
  const spotlightRoot = document.querySelector("[data-matchday-spotlight]");
  const spotlightBadgeNode = spotlightRoot?.querySelector("[data-matchday-badge]");
  const spotlightCompetitionNode = spotlightRoot?.querySelector("[data-matchday-competition]");
  const spotlightOpponentNode = spotlightRoot?.querySelector("[data-matchday-opponent]");
  const spotlightRouteNode = spotlightRoot?.querySelector("[data-matchday-route]");
  const matchResultRoot = spotlightRoot?.querySelector("[data-match-result]");
  const matchResultLabelNode = spotlightRoot?.querySelector("[data-match-result-label]");
  const matchResultTextNode = spotlightRoot?.querySelector("[data-match-result-text]");
  const matchResultNoteNode = spotlightRoot?.querySelector("[data-match-result-note]");
  const weatherRoot = countdownRoot.querySelector("[data-match-weather]");
  const weatherTempNode = weatherRoot?.querySelector("[data-weather-temp]");
  const weatherLabelNode = weatherRoot?.querySelector("[data-weather-label]");
  const weatherRainNode = weatherRoot?.querySelector("[data-weather-rain]");
  const weatherWindNode = weatherRoot?.querySelector("[data-weather-wind]");
  const weatherTimeNode = weatherRoot?.querySelector("[data-weather-time]");
  const aiRoot = countdownRoot.querySelector("[data-match-ai]");
  const aiScoreNode = aiRoot?.querySelector("[data-ai-score]");
  const aiOutlookNode = aiRoot?.querySelector("[data-ai-outlook]");
  const aiConfidenceNode = aiRoot?.querySelector("[data-ai-confidence]");
  const aiNoteNode = aiRoot?.querySelector("[data-ai-note]");
  const activeMatchWindowMs = 4 * 60 * 60 * 1000;

  const formatDate = (date) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

  const parseIcsDate = (rawValue) => {
    const match = rawValue.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);

    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  };

  const parseSummary = (summary) => {
    const [fixturePart = "", competition = "", league = ""] = summary.split(",").map((part) => part.trim());
    const clubName = "TSV Hainsfarth";
    let opponent = fixturePart || clubName;
    let isHome = fixturePart.startsWith(`${clubName}-`);

    if (fixturePart.startsWith(`${clubName}-`)) {
      opponent = fixturePart.slice(`${clubName}-`.length);
      isHome = true;
    } else if (fixturePart.endsWith(`-${clubName}`)) {
      opponent = fixturePart.slice(0, fixturePart.length - `-${clubName}`.length);
      isHome = false;
    }

    return {
      fixture: fixturePart || clubName,
      competition,
      league,
      opponent: opponent.trim() || clubName,
      isHome,
    };
  };

  const getRouteAddress = (location) => {
    const normalizedLocation = (location || "").replace(/\s+/g, " ").trim();

    if (!normalizedLocation) {
      return "86744 Hainsfarth, Deutschland";
    }

    const streetPostalMatch = normalizedLocation.match(
      /((?:[A-Za-zÄÖÜäöüß.\-]+\s?)+(?:Straße|Str\.|Weg|Gasse|Platz|Ring|Allee|Ufer)\s*\d+[A-Za-z]?)[, ]+(\d{5}\s+[A-Za-zÄÖÜäöüß().\-\s]+)/i
    );

    if (streetPostalMatch) {
      const [, street, postalCity] = streetPostalMatch;
      return `${street.trim()}, ${postalCity.trim()}, Deutschland`;
    }

    const parts = normalizedLocation
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length >= 3) {
      const streetPart = parts.find((part) => /(?:str\.|straße|weg|gasse|platz|ring|allee|ufer)\b/i.test(part));
      const postalCityPart = parts.find((part) => /\b\d{5}\b/.test(part));

      if (streetPart && postalCityPart) {
        return `${streetPart}, ${postalCityPart}, Deutschland`;
      }

      if (parts[1] && postalCityPart) {
        return `${parts[1]}, ${postalCityPart}, Deutschland`;
      }

      return `${parts.slice(-2).join(", ")}, Deutschland`;
    }

    return `${normalizedLocation}, Deutschland`;
  };

  const buildRouteHref = (location) => {
    const routeAddress = getRouteAddress(location);
    const routeQuery = encodeURIComponent(routeAddress);
    return `https://www.google.com/maps/dir/?api=1&destination=${routeQuery}&travelmode=driving&dir_action=navigate`;
  };

  const weatherCodeMap = {
    0: "Klar",
    1: "Meist klar",
    2: "Leicht bewölkt",
    3: "Bedeckt",
    45: "Neblig",
    48: "Raureif",
    51: "Leichter Niesel",
    53: "Niesel",
    55: "Starker Niesel",
    61: "Leichter Regen",
    63: "Regen",
    65: "Starker Regen",
    66: "Leichter Eisregen",
    67: "Eisregen",
    71: "Leichter Schnee",
    73: "Schnee",
    75: "Starker Schnee",
    77: "Schneekörner",
    80: "Regenschauer",
    81: "Schauer",
    82: "Starke Schauer",
    85: "Schneeschauer",
    86: "Starke Schneeschauer",
    95: "Gewitter",
    96: "Gewitter mit Hagel",
    99: "Starkes Gewitter",
  };

  const parseEvents = (icsText) => {
    const normalized = icsText.replace(/\r\n[ \t]/g, "").replace(/\r/g, "");

    return normalized
      .split("BEGIN:VEVENT")
      .slice(1)
      .map((chunk) => {
        const getField = (fieldName) => {
          const fieldMatch = chunk.match(new RegExp(`${fieldName}[^:]*:(.+)`));
          return fieldMatch ? fieldMatch[1].trim() : "";
        };

        return {
          start: parseIcsDate(getField("DTSTART")),
          summary: getField("SUMMARY").replace(/\\,/g, ","),
          location: getField("LOCATION").replace(/\\,/g, ","),
          uid: getField("UID"),
        };
      })
      .map((event) => ({
        ...event,
        ...parseSummary(event.summary),
      }))
      .filter((event) => event.start instanceof Date && !Number.isNaN(event.start.getTime()))
      .sort((a, b) => a.start - b.start);
  };

  const getCurrentOrNextEvent = (events) => {
    const now = Date.now();
    const currentEvent = events.find((event) => {
      const startTime = event.start.getTime();
      return now >= startTime && now <= startTime + activeMatchWindowMs;
    });

    if (currentEvent) {
      return currentEvent;
    }

    return events.find((event) => event.start.getTime() > now) || null;
  };

  const buildFixtureText = (event) =>
    event.isHome
      ? `TSV Hainsfarth vs. ${event.opponent}`
      : `${event.opponent} vs. TSV Hainsfarth`;

  const renderAiPrediction = (event, weatherPoint = null) => {
    if (!aiRoot || !aiScoreNode || !aiOutlookNode || !aiConfidenceNode || !aiNoteNode) {
      return;
    }

    let hainsfarthStrength = event.isHome ? 1.2 : 0.95;
    let opponentStrength = event.isHome ? 0.95 : 1.15;
    const notes = [];

    if (event.isHome) {
      notes.push("Heimvorteil für den TSV");
    } else {
      notes.push("Auswärtsspiel macht die Aufgabe enger");
    }

    if (/meisterschaften/i.test(event.competition)) {
      hainsfarthStrength += 0.1;
      opponentStrength += 0.1;
      notes.push("Pflichtspiel mit offenem Verlauf");
    }

    if (weatherPoint) {
      const rain = Number(weatherPoint.precipitation_probability ?? 0);
      const wind = Number(weatherPoint.wind_speed_10m ?? 0);

      if (rain >= 50) {
        hainsfarthStrength -= 0.05;
        opponentStrength -= 0.05;
        notes.push("Nasses Wetter spricht eher für ein enges Spiel");
      }

      if (wind >= 20) {
        hainsfarthStrength -= 0.05;
        opponentStrength -= 0.05;
        notes.push("Wind kann den Spielfluss brechen");
      }
    }

    const hainsfarthGoals = Math.max(0, Math.min(4, Math.round(hainsfarthStrength + (weatherPoint ? 0 : 0.1))));
    const opponentGoals = Math.max(0, Math.min(4, Math.round(opponentStrength)));
    const goalDiff = hainsfarthGoals - opponentGoals;
    const confidenceBase = Math.max(Math.abs(goalDiff), 1);
    const confidence = Math.min(82, 52 + confidenceBase * 9 + (event.isHome ? 4 : 0));

    let outlook = "Ausgeglichenes Spiel";
    if (goalDiff > 0) {
      outlook = "Leichter Vorteil TSV";
    } else if (goalDiff < 0) {
      outlook = "Schwere Auswärtsaufgabe";
    }

    aiScoreNode.textContent = event.isHome
      ? `${hainsfarthGoals}:${opponentGoals}`
      : `${opponentGoals}:${hainsfarthGoals}`;
    aiOutlookNode.textContent = outlook;
    aiConfidenceNode.textContent = `Wahrscheinlichkeit: ${confidence}%`;
    aiNoteNode.textContent = notes[0] || "Datenbasierte Tendenz";
  };

  const renderSpotlight = (event) => {
    if (!spotlightRoot) {
      return;
    }

    if (spotlightBadgeNode) {
      spotlightBadgeNode.textContent = event.isHome ? "Heimspiel" : "Auswärtsspiel";
    }

    if (spotlightCompetitionNode) {
      spotlightCompetitionNode.textContent = [event.competition, event.league].filter(Boolean).join(" · ") || "Pflichtspiel";
    }

    const fixtureText = buildFixtureText(event);

    if (spotlightOpponentNode) {
      spotlightOpponentNode.textContent = fixtureText;
    }

    if (spotlightRouteNode) {
      spotlightRouteNode.href = buildRouteHref(event.location);
    }
  };

  const showPendingMatchResult = () => {
    if (!matchResultRoot) {
      return;
    }

    matchResultRoot.hidden = false;
    matchResultRoot.classList.remove("is-live");
    matchResultRoot.classList.add("is-pending");

    if (matchResultLabelNode) {
      matchResultLabelNode.textContent = "Ergebnis folgt ab Anpfiff";
    }

    if (matchResultTextNode) {
      matchResultTextNode.textContent = "--:--";
      matchResultTextNode.style.fontFamily = "";
    }

    if (matchResultNoteNode) {
      matchResultNoteNode.textContent = "BFV";
    }
  };

  const ensureBfvFont = (fontId) => {
    if (!fontId) {
      return null;
    }

    const fontName = `bfv-obfuscated-${fontId}`;
    const styleId = `bfv-font-${fontId}`;

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        @font-face {
          font-family: "${fontName}";
          src: url("https://app.bfv.de/export.fontface/-/format/woff/id/${fontId}/type/font") format("woff");
          font-display: swap;
        }
      `;
      document.head.appendChild(style);
    }

    return fontName;
  };

  const renderMatchResult = (resultData) => {
    if (!matchResultRoot || !matchResultTextNode || !resultData?.available || !resultData?.text) {
      showPendingMatchResult();
      return;
    }

    matchResultRoot.hidden = false;
    matchResultRoot.classList.remove("is-pending");
    matchResultRoot.classList.toggle("is-live", Boolean(resultData.live));

    if (matchResultLabelNode) {
      matchResultLabelNode.textContent = resultData.label || "BFV-Ergebnis";
    }

    if (matchResultTextNode) {
      matchResultTextNode.textContent = resultData.text;
      const fontName = ensureBfvFont(resultData.fontId);
      matchResultTextNode.style.fontFamily = fontName ? `"${fontName}"` : "";
    }

    if (matchResultNoteNode) {
      matchResultNoteNode.textContent = resultData.note || "BFV";
    }
  };

  const renderFallback = () => {
    if (dateNode) {
      dateNode.textContent = "Kalender nicht verfügbar";
    }

    if (locationNode) {
      locationNode.textContent = "Bitte Spielplan prüfen";
    }

    if (timerNode) {
      timerNode.innerHTML = "<span>Kein Countdown verfügbar</span>";
    }

    if (spotlightBadgeNode) {
      spotlightBadgeNode.textContent = "Matchday";
    }

    if (spotlightCompetitionNode) {
      spotlightCompetitionNode.textContent = "Kalender";
    }

    if (spotlightOpponentNode) {
      spotlightOpponentNode.textContent = "TSV Hainsfarth vs. Gegner";
    }

    if (spotlightRouteNode) {
      spotlightRouteNode.href = buildRouteHref("Am Sportplatz 2, 86744 Hainsfarth");
    }

    showPendingMatchResult();

    if (weatherTempNode) {
      weatherTempNode.textContent = "--°";
    }

    if (weatherLabelNode) {
      weatherLabelNode.textContent = "Wetter nicht verfügbar";
    }

    if (weatherRainNode) {
      weatherRainNode.textContent = "Regenrisiko: --";
    }

    if (weatherWindNode) {
      weatherWindNode.textContent = "Wind: --";
    }

    renderAiPrediction({
      isHome: true,
      competition: "",
      opponent: "Gegner",
    });
  };

  const renderWeatherFallback = () => {
    if (weatherTempNode) {
      weatherTempNode.textContent = "--°";
    }

    if (weatherLabelNode) {
      weatherLabelNode.textContent = "Wetter folgt";
    }

    if (weatherRainNode) {
      weatherRainNode.textContent = "Regenrisiko: --";
    }

    if (weatherWindNode) {
      weatherWindNode.textContent = "Wind: --";
    }

    renderAiPrediction({
      isHome: true,
      competition: "",
      opponent: "Gegner",
    });
  };

  const fetchMatchResult = async (event) => {
    if (!event?.uid) {
      showPendingMatchResult();
      return;
    }

    try {
      const response = await fetch(`matchday-live.json?t=${Date.now()}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Match result unavailable");
      }

      const data = await response.json();
      const liveMatch = data?.match;

      if (!liveMatch || liveMatch.uid !== event.uid) {
        showPendingMatchResult();
        return;
      }

      renderMatchResult(liveMatch.result);
    } catch {
      showPendingMatchResult();
    }
  };

  const renderWeather = (hourlyPoint, eventDate) => {
    if (weatherTempNode) {
      weatherTempNode.textContent = `${Math.round(hourlyPoint.temperature_2m)}°`;
    }

    if (weatherLabelNode) {
      weatherLabelNode.textContent = weatherCodeMap[hourlyPoint.weather_code] || "Spielwetter";
    }

    if (weatherRainNode) {
      weatherRainNode.textContent = `Regenrisiko: ${Math.round(hourlyPoint.precipitation_probability ?? 0)}%`;
    }

    if (weatherWindNode) {
      weatherWindNode.textContent = `Wind: ${Math.round(hourlyPoint.wind_speed_10m ?? 0)} km/h`;
    }

    if (weatherTimeNode) {
      weatherTimeNode.textContent = new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(eventDate);
    }
  };

  const getLocationQueries = (event) => {
    const normalizedLocation = (event.location || "").replace(/\s+/g, " ").trim();
    const queries = [];
    const pushQuery = (value) => {
      const nextValue = value?.trim();

      if (nextValue && !queries.includes(nextValue)) {
        queries.push(nextValue);
      }
    };

    pushQuery(normalizedLocation);

    const locationParts = normalizedLocation.split(",").map((part) => part.trim()).filter(Boolean);
    const postalPart = locationParts.find((part) => /\b\d{5}\b/.test(part));
    const postalMatch = postalPart?.match(/\b(\d{5})\b\s*(.+)?/);

    if (postalMatch) {
      const [, postalCode, cityName = ""] = postalMatch;
      pushQuery(`${cityName.trim()}, ${postalCode}, Deutschland`);
      pushQuery(`${cityName.trim()}, Deutschland`);
      pushQuery(cityName.trim());
    }

    const trailingCity = locationParts[locationParts.length - 1];
    pushQuery(trailingCity);

    if (event.isHome) {
      pushQuery("Hainsfarth, Deutschland");
      pushQuery("86744 Hainsfarth, Deutschland");
    }

    return queries;
  };

  const fetchGeocode = async (query) => {
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", query);
    geoUrl.searchParams.set("count", "5");
    geoUrl.searchParams.set("language", "de");
    geoUrl.searchParams.set("format", "json");
    geoUrl.searchParams.set("countryCode", "DE");

    const response = await fetch(geoUrl);

    if (!response.ok) {
      throw new Error("Geocoding unavailable");
    }

    const geoData = await response.json();
    return geoData?.results?.[0] || null;
  };

  const fetchMatchWeather = async (event) => {
    if (!weatherRoot) {
      return;
    }

    if (weatherTimeNode) {
      weatherTimeNode.textContent = new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(event.start);
    }

    try {
      const locationQueries = getLocationQueries(event);
      let place = null;

      for (const query of locationQueries) {
        place = await fetchGeocode(query);

        if (place) {
          break;
        }
      }

      if (!place) {
        throw new Error("Location not found");
      }

      const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
      forecastUrl.searchParams.set("latitude", place.latitude);
      forecastUrl.searchParams.set("longitude", place.longitude);
      forecastUrl.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code,wind_speed_10m");
      forecastUrl.searchParams.set("timezone", "auto");
      forecastUrl.searchParams.set("forecast_days", "16");

      const response = await fetch(forecastUrl);

      if (!response.ok) {
        throw new Error("Forecast unavailable");
      }

      const forecastData = await response.json();
      const hourly = forecastData?.hourly;

      if (!hourly?.time?.length) {
        throw new Error("Hourly forecast missing");
      }

      const targetTime = event.start.getTime();
      let bestIndex = 0;
      let bestDiff = Number.POSITIVE_INFINITY;

      hourly.time.forEach((timeValue, index) => {
        const candidateTime = new Date(timeValue).getTime();
        const diff = Math.abs(candidateTime - targetTime);

        if (diff < bestDiff) {
          bestDiff = diff;
          bestIndex = index;
        }
      });

      renderWeather(
        {
          temperature_2m: hourly.temperature_2m?.[bestIndex],
          precipitation_probability: hourly.precipitation_probability?.[bestIndex],
          weather_code: hourly.weather_code?.[bestIndex],
          wind_speed_10m: hourly.wind_speed_10m?.[bestIndex],
        },
        event.start
      );
      renderAiPrediction(
        event,
        {
          temperature_2m: hourly.temperature_2m?.[bestIndex],
          precipitation_probability: hourly.precipitation_probability?.[bestIndex],
          weather_code: hourly.weather_code?.[bestIndex],
          wind_speed_10m: hourly.wind_speed_10m?.[bestIndex],
        }
      );
    } catch {
      renderWeatherFallback();
      renderAiPrediction(event);
    }
  };

  const startCountdown = (targetDate) => {
    const render = () => {
      const diff = targetDate.getTime() - Date.now();

      if (diff <= 0) {
        timerNode.innerHTML = "<span>Läuft jetzt</span>";
        return;
      }

      const totalMinutes = Math.floor(diff / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;

      timerNode.innerHTML = `
        <span>${days} Tage</span>
        <span>${hours} Stunden</span>
        <span>${minutes} Minuten</span>
      `;
    };

    render();
    window.setInterval(render, 60000);
  };

  if (countdownSrc && dateNode && locationNode && timerNode) {
    fetch(`${countdownSrc}?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Countdown source unavailable");
        }

        return response.text();
      })
      .then((icsText) => {
        const nextEvent = getCurrentOrNextEvent(parseEvents(icsText));

        if (!nextEvent) {
          renderFallback();
          return;
        }

        dateNode.textContent = formatDate(nextEvent.start);
        locationNode.textContent = nextEvent.location;
        renderSpotlight(nextEvent);
        renderAiPrediction(nextEvent);
        void fetchMatchResult(nextEvent);
        void fetchMatchWeather(nextEvent);
        startCountdown(nextEvent.start);
      })
      .catch(() => {
        renderFallback();
      });
  }
}

const penaltyGameRoot = document.querySelector("[data-penalty-game]");

if (penaltyGameRoot) {
  const fieldNode = penaltyGameRoot.querySelector("[data-penalty-field]");
  const goalNode = penaltyGameRoot.querySelector("[data-penalty-goal]");
  const targetNode = penaltyGameRoot.querySelector("[data-penalty-target]");
  const ballNode = penaltyGameRoot.querySelector("[data-penalty-ball]");
  const keeperNode = penaltyGameRoot.querySelector("[data-penalty-keeper]");
  const statusNode = penaltyGameRoot.querySelector("[data-penalty-status]");
  const shootButton = penaltyGameRoot.querySelector("[data-penalty-shoot]");
  const resetButton = penaltyGameRoot.querySelector("[data-penalty-reset]");
  let selectedTarget = null;
  let isAnimating = false;

  const setStatus = (text) => {
    if (statusNode) {
      statusNode.textContent = text;
    }
  };

  const resetPenaltyGame = (message = "Ziel wählen.") => {
    selectedTarget = null;
    isAnimating = false;
    keeperNode?.classList.remove("is-left", "is-right");
    if (targetNode) {
      targetNode.style.setProperty("--target-x", "50%");
      targetNode.style.setProperty("--target-y", "52%");
    }
    if (ballNode) {
      ballNode.classList.remove("is-shot");
      ballNode.classList.add("is-resetting");
      ballNode.style.removeProperty("--shot-x");
      ballNode.style.removeProperty("--shot-y");
      window.setTimeout(() => {
        ballNode.classList.remove("is-resetting");
      }, 280);
    }
    setStatus(message);
  };

  const selectTarget = (clientX, clientY) => {
    if (!goalNode || !targetNode || isAnimating) {
      return;
    }

    const rect = goalNode.getBoundingClientRect();
    const clampedX = Math.max(16, Math.min(rect.width - 16, clientX - rect.left));
    const clampedY = Math.max(18, Math.min(rect.height - 18, clientY - rect.top));
    const xPercent = (clampedX / rect.width) * 100;
    const yPercent = (clampedY / rect.height) * 100;

    selectedTarget = { xPercent, yPercent };
    targetNode.style.setProperty("--target-x", `${xPercent}%`);
    targetNode.style.setProperty("--target-y", `${yPercent}%`);
    setStatus("Ziel steht. Jetzt schießen.");
  };

  goalNode?.addEventListener("click", (event) => {
    selectTarget(event.clientX, event.clientY);
  });

  targetNode?.addEventListener("click", (event) => {
    event.preventDefault();
    selectTarget(event.clientX, event.clientY);
  });

  shootButton?.addEventListener("click", () => {
    if (!selectedTarget || !fieldNode || !goalNode || !ballNode || !keeperNode || isAnimating) {
      if (!selectedTarget) {
        setStatus("Erst ein Ziel im Tor anklicken.");
      }
      return;
    }

    isAnimating = true;
    const keeperRoll = Math.random();
    const keeperSide = keeperRoll < 0.33 ? "is-left" : keeperRoll > 0.66 ? "is-right" : "";
    keeperNode.classList.remove("is-left", "is-right");
    if (keeperSide) {
      keeperNode.classList.add(keeperSide);
    }

    const fieldRect = fieldNode.getBoundingClientRect();
    const goalRect = goalNode.getBoundingClientRect();
    const ballRect = ballNode.getBoundingClientRect();
    const ballStartX = ballRect.left - fieldRect.left + ballRect.width / 2;
    const ballStartY = ballRect.top - fieldRect.top + ballRect.height / 2;
    const targetX = goalRect.left - fieldRect.left + (goalRect.width * selectedTarget.xPercent) / 100;
    const targetY = goalRect.top - fieldRect.top + (goalRect.height * selectedTarget.yPercent) / 100;
    const deltaX = targetX - ballStartX;
    const deltaY = targetY - ballStartY;

    ballNode.style.setProperty("--shot-x", `${deltaX}px`);
    ballNode.style.setProperty("--shot-y", `${deltaY}px`);
    ballNode.classList.add("is-shot");

    const sideBucket = selectedTarget.xPercent < 38 ? "is-left" : selectedTarget.xPercent > 62 ? "is-right" : "";
    const isSave = sideBucket && sideBucket === keeperSide && selectedTarget.yPercent > 26;

    window.setTimeout(() => {
      setStatus(isSave ? "Gehalten. Noch ein Versuch." : "Tor für den TSV.");
    }, 520);

    window.setTimeout(() => {
      resetPenaltyGame(isSave ? "Neues Ziel wählen." : "Nochmal? Ziel neu setzen.");
    }, 1300);
  });

  resetButton?.addEventListener("click", () => {
    resetPenaltyGame("Ziel wählen.");
  });

  resetPenaltyGame("Ziel wählen.");
}
