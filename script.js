const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const audioStateKey = "tsv-club-audio-state";

const ensureClubAudioUi = () => {
  let audio = document.querySelector("[data-club-audio]");
  let toggle = document.querySelector("[data-audio-toggle]");

  if (!audio) {
    audio = document.createElement("audio");
    audio.preload = "auto";
    audio.setAttribute("data-club-audio", "");

    const source = document.createElement("source");
    source.src = "tsv-song.mp3?v=20260310b";
    source.type = "audio/mpeg";
    audio.appendChild(source);
    document.body.appendChild(audio);
  }

  if (!toggle) {
    toggle = document.createElement("button");
    toggle.className = "floating-audio-button";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "TSV-Song abspielen oder pausieren");
    toggle.setAttribute("data-audio-toggle", "");
    toggle.innerHTML = '<span class="floating-audio-emoji" aria-hidden="true">⚽</span>';
    document.body.appendChild(toggle);
  }

  return { audio, toggle };
};

const { audio: clubAudio, toggle: audioToggle } = ensureClubAudioUi();

if (audioToggle && clubAudio) {
  const readAudioState = () => {
    try {
      return JSON.parse(window.localStorage.getItem(audioStateKey) || "{}");
    } catch {
      return {};
    }
  };

  const writeAudioState = (nextState) => {
    try {
      const currentState = readAudioState();
      window.localStorage.setItem(
        audioStateKey,
        JSON.stringify({
          ...currentState,
          ...nextState,
        })
      );
    } catch {
      // Ignore storage issues and keep controls responsive.
    }
  };

  const syncAudioState = () => {
    audioToggle.classList.toggle("is-playing", !clubAudio.paused);
  };

  const kickBall = () => {
    audioToggle.classList.remove("is-kicking");
    void audioToggle.offsetWidth;
    audioToggle.classList.add("is-kicking");
  };

  const tryPlayAudio = () => {
    clubAudio
      .play()
      .then(() => {
        writeAudioState({ shouldPlay: true });
        syncAudioState();
      })
      .catch(() => {
        syncAudioState();
      });
  };

  audioToggle.addEventListener("click", () => {
    kickBall();

    if (clubAudio.paused) {
      tryPlayAudio();
    } else {
      clubAudio.pause();
      writeAudioState({ shouldPlay: false, currentTime: clubAudio.currentTime });
      syncAudioState();
    }
  });

  clubAudio.addEventListener("play", () => {
    writeAudioState({ shouldPlay: true });
    syncAudioState();
  });

  clubAudio.addEventListener("pause", () => {
    writeAudioState({ shouldPlay: false, currentTime: clubAudio.currentTime });
    syncAudioState();
  });

  clubAudio.addEventListener("timeupdate", () => {
    writeAudioState({ currentTime: clubAudio.currentTime });
  });

  clubAudio.addEventListener("ended", () => {
    writeAudioState({ shouldPlay: false, currentTime: 0 });
    syncAudioState();
  });

  window.addEventListener("load", () => {
    const savedState = readAudioState();

    if (typeof savedState.currentTime === "number" && Number.isFinite(savedState.currentTime)) {
      const resumeTime = Math.max(0, savedState.currentTime);
      clubAudio.currentTime = resumeTime;
    }

    syncAudioState();

    if (savedState.shouldPlay) {
      tryPlayAudio();
    }
  });

  window.addEventListener("beforeunload", () => {
    writeAudioState({
      shouldPlay: !clubAudio.paused,
      currentTime: clubAudio.currentTime,
    });
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
    } catch {
      renderWeatherFallback();
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
        const events = parseEvents(icsText);
        const nextEvent = getCurrentOrNextEvent(events);

        if (!nextEvent) {
          renderFallback();
          return;
        }

        dateNode.textContent = formatDate(nextEvent.start);
        locationNode.textContent = nextEvent.location;
        renderSpotlight(nextEvent);
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

const squadData = window.tsvSquadData;

if (squadData?.teams) {
  const squadGrid = document.querySelector("[data-squad-grid]");
  const staffGrid = document.querySelector("[data-staff-grid]");
  const squadCount = document.querySelector("[data-squad-count]");
  const filterButtons = Array.from(document.querySelectorAll("[data-squad-filters] [data-filter]"));
  const teamButtons = Array.from(document.querySelectorAll("[data-team-switcher] [data-team-key]"));
  const teamEyebrow = document.querySelector("[data-team-eyebrow]");
  const teamHeroTitle = document.querySelector("[data-team-hero-title]");
  const teamHeroLead = document.querySelector("[data-team-hero-lead]");
  const teamBadge = document.querySelector("[data-team-badge]");
  const teamSeasonLabel = document.querySelector("[data-team-season-label]");
  const teamSeasonNote = document.querySelector("[data-team-season-note]");
  const teamSourceLabel = document.querySelector("[data-team-source-label]");
  const teamSourceDate = document.querySelector("[data-team-source-date]");
  const teamSectionEyebrow = document.querySelector("[data-team-section-eyebrow]");
  const teamSectionTitle = document.querySelector("[data-team-section-title]");
  const teamSectionLead = document.querySelector("[data-team-section-lead]");
  const sourceLinkPrimary = document.querySelector("[data-team-source-link]");
  const sourceLinkSecondary = document.querySelector("[data-team-source-link-secondary]");
  const positionOrder = {
    Torwart: 0,
    Abwehr: 1,
    Mittelfeld: 2,
    Angriff: 3,
  };
  const sortPlayers = (inputPlayers) =>
    [...inputPlayers].sort((left, right) => {
      const positionDiff = (positionOrder[left.position] ?? 99) - (positionOrder[right.position] ?? 99);

      if (positionDiff !== 0) {
        return positionDiff;
      }

      if (left.jerseyNumber !== null && right.jerseyNumber !== null && left.jerseyNumber !== right.jerseyNumber) {
        return left.jerseyNumber - right.jerseyNumber;
      }

      return `${left.lastName}${left.firstName}`.localeCompare(`${right.lastName}${right.firstName}`, "de");
    });
  const formatName = (person) => `${person.firstName} ${person.lastName}`;
  const formatNumber = (value) => (typeof value === "number" ? value : "--");
  const formatAge = (value) => (typeof value === "number" ? `${value} J.` : "Alter offen");
  const getImageToken = (value) => {
    const match = value?.match(/\/player\/([^/]+)/i);
    return match?.[1] || null;
  };
  const cutoutOverrides = {};

  const resolveImageUrl = (value) => {
    if (!value) {
      return "logo.png?v=20260310b";
    }

    if (/\.(?:avif|webp|png|jpe?g|svg)$/i.test(value)) {
      return value;
    }

    return `${value.replace(/\/$/, "")}/480x600.webp`;
  };
  const resolveCutoutUrl = (person) => {
    if (person?.customCutoutUrl) {
      return person.customCutoutUrl;
    }

    const value = person?.imageUrl;
    const token = getImageToken(value);

    if (!token) {
      return null;
    }

    if (cutoutOverrides[token]) {
      return cutoutOverrides[token];
    }

    return `images/kader/cutouts/${token}.png?v=20260317c`;
  };
  const fallbackImageAttributes = (value) => {
    const remoteImage = resolveImageUrl(value);
    const escapedRemote = remoteImage.replace(/'/g, "\\'");
    return `data-fallback-src="${escapedRemote}" onerror="if(!this.dataset.fallbackApplied){this.dataset.fallbackApplied='true';this.src=this.dataset.fallbackSrc;}else{this.onerror=null;this.src='logo.png?v=20260310b';}"`;
  };
  const resolveDisplayImageUrl = (person) => resolveCutoutUrl(person) || resolveImageUrl(person?.imageUrl);
  const asCssImage = (person) => `style="--player-image: url('${resolveDisplayImageUrl(person)}');"`;
  const formatFlags = (flags = []) =>
    flags.map((flag) => {
      if (flag === "new") {
        return "Neuzugang";
      }

      return flag;
    });

  const renderSquad = (players, activeFilter) => {
    if (!squadGrid) {
      return;
    }

    const visiblePlayers = players.filter((player) => activeFilter === "Alle" || player.position === activeFilter);

    squadGrid.innerHTML = visiblePlayers
      .map((player) => {
        const tags = formatFlags(player.flags)
          .map((flag) => `<span class="squad-flag">${flag}</span>`)
          .join("");
        const playerImage = player.hideImage
          ? ""
          : `<img src="${resolveDisplayImageUrl(player)}" alt="${formatName(player)}" loading="lazy" ${fallbackImageAttributes(player.imageUrl)}>`;
        const playerMediaStyle = player.hideImage ? "" : ` ${asCssImage(player)}`;

        return `
          <article class="squad-card">
            <div class="squad-card-media"${playerMediaStyle}>
              <span class="squad-card-logo" aria-hidden="true"></span>
              ${playerImage}
            </div>
            <div class="squad-card-body">
              <div class="squad-card-topline">
                <div>
                  <p class="squad-position">${player.position}</p>
                  <h3>${formatName(player)}</h3>
                </div>
                <span class="squad-number-badge">${formatNumber(player.jerseyNumber)}</span>
              </div>
              ${tags}
              <div class="squad-meta">
                <span>${formatAge(player.age)}</span>
                <span>${player.matches} Spiele</span>
                <span>${player.goals} Tore</span>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    if (squadCount) {
      squadCount.textContent = `${visiblePlayers.length} Spieler`;
    }
  };

  const renderStaff = (staff) => {
    if (!staffGrid) {
      return;
    }

    staffGrid.innerHTML = staff
      .map(
        (member) => `
          <article class="staff-card">
            <div class="staff-card-media" ${asCssImage(member)}>
              <img src="${resolveDisplayImageUrl(member)}" alt="${formatName(member)}" loading="lazy" ${fallbackImageAttributes(member.imageUrl)}>
            </div>
            <div class="staff-card-body">
              <p class="staff-role">${member.role}</p>
              <h3>${formatName(member)}</h3>
              <div class="staff-meta">
                <span>${formatAge(member.age)}</span>
              </div>
            </div>
          </article>
        `
      )
      .join("");
  };

  let activeFilter = "Alle";
  let activeTeamKey = squadData.defaultTeam || "team1";

  const renderTeam = () => {
    const team = squadData.teams[activeTeamKey];

    if (!team) {
      return;
    }

    const players = sortPlayers(team.players);

    if (teamEyebrow) teamEyebrow.textContent = team.eyebrow;
    if (teamHeroTitle) teamHeroTitle.textContent = team.heroTitle;
    if (teamHeroLead) teamHeroLead.textContent = team.heroLead;
    if (teamBadge) teamBadge.textContent = team.heroBadge;
    if (teamSeasonLabel) teamSeasonLabel.textContent = team.seasonLabel;
    if (teamSeasonNote) teamSeasonNote.textContent = team.seasonNote;
    if (teamSourceLabel) teamSourceLabel.textContent = team.sourceLabel;
    if (teamSourceDate) teamSourceDate.textContent = team.sourceDate;
    if (teamSectionEyebrow) teamSectionEyebrow.textContent = team.sectionEyebrow;
    if (teamSectionTitle) teamSectionTitle.textContent = team.sectionTitle;
    if (teamSectionLead) teamSectionLead.textContent = team.sectionLead;
    if (sourceLinkPrimary) sourceLinkPrimary.href = team.sourceUrl;
    if (sourceLinkSecondary) sourceLinkSecondary.href = team.sourceUrl;

    teamButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.teamKey === activeTeamKey);
    });

    renderSquad(players, activeFilter);
    renderStaff(team.staff);
  };

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "Alle";

      filterButtons.forEach((candidate) => {
        candidate.classList.toggle("is-active", candidate === button);
      });

      renderTeam();
    });
  });

  teamButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeTeamKey = button.dataset.teamKey || squadData.defaultTeam || "team1";
      renderTeam();
    });
  });

  renderTeam();
}
