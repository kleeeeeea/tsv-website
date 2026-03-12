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
  const spotlightFixtureNode = spotlightRoot?.querySelector("[data-matchday-fixture]");
  const spotlightStatusNode = spotlightRoot?.querySelector("[data-matchday-status]");
  const weatherRoot = countdownRoot.querySelector("[data-match-weather]");
  const weatherTempNode = weatherRoot?.querySelector("[data-weather-temp]");
  const weatherLabelNode = weatherRoot?.querySelector("[data-weather-label]");
  const weatherRainNode = weatherRoot?.querySelector("[data-weather-rain]");
  const weatherWindNode = weatherRoot?.querySelector("[data-weather-wind]");
  const weatherTimeNode = weatherRoot?.querySelector("[data-weather-time]");

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

  const weatherCodeMap = {
    0: "Klar",
    1: "Meist klar",
    2: "Leicht bewoelkt",
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
    77: "Schneekoerner",
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
        };
      })
      .map((event) => ({
        ...event,
        ...parseSummary(event.summary),
      }))
      .filter((event) => event.start instanceof Date && !Number.isNaN(event.start.getTime()))
      .sort((a, b) => a.start - b.start);
  };

  const getMatchStatus = (targetDate) => {
    const diff = targetDate.getTime() - Date.now();
    const hoursDiff = diff / 3600000;
    const dayDiff = Math.ceil(diff / 86400000);

    if (diff <= 0) {
      return "Jetzt";
    }

    if (hoursDiff <= 24) {
      return "Heute";
    }

    if (dayDiff <= 1) {
      return "Morgen";
    }

    if (dayDiff <= 3) {
      return "Bald";
    }

    if (dayDiff <= 7) {
      return "Diese Woche";
    }

    return "Demnaechst";
  };

  const renderSpotlight = (event) => {
    if (!spotlightRoot) {
      return;
    }

    if (spotlightBadgeNode) {
      spotlightBadgeNode.textContent = event.isHome ? "Heimspiel" : "Auswaertsspiel";
    }

    if (spotlightCompetitionNode) {
      spotlightCompetitionNode.textContent = [event.competition, event.league].filter(Boolean).join(" · ") || "Pflichtspiel";
    }

    if (spotlightOpponentNode) {
      spotlightOpponentNode.textContent = event.opponent;
    }

    if (spotlightFixtureNode) {
      spotlightFixtureNode.textContent = event.isHome
        ? `TSV Hainsfarth empfaengt ${event.opponent}.`
        : `TSV Hainsfarth reist zu ${event.opponent}.`;
    }

    if (spotlightStatusNode) {
      spotlightStatusNode.textContent = getMatchStatus(event.start);
    }
  };

  const renderFallback = () => {
    if (dateNode) {
      dateNode.textContent = "Kalender nicht verfuegbar";
    }

    if (locationNode) {
      locationNode.textContent = "Bitte Spielplan pruefen";
    }

    if (timerNode) {
      timerNode.innerHTML = "<span>Kein Countdown verfuegbar</span>";
    }

    if (spotlightBadgeNode) {
      spotlightBadgeNode.textContent = "Matchday";
    }

    if (spotlightCompetitionNode) {
      spotlightCompetitionNode.textContent = "Kalender";
    }

    if (spotlightOpponentNode) {
      spotlightOpponentNode.textContent = "Naechster Gegner";
    }

    if (spotlightFixtureNode) {
      spotlightFixtureNode.textContent = "Bitte Spielplan pruefen.";
    }

    if (spotlightStatusNode) {
      spotlightStatusNode.textContent = "Bald";
    }

    if (weatherTempNode) {
      weatherTempNode.textContent = "--°";
    }

    if (weatherLabelNode) {
      weatherLabelNode.textContent = "Wetter nicht verfuegbar";
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
        timerNode.innerHTML = "<span>Laeuft jetzt</span>";
        if (spotlightStatusNode) {
          spotlightStatusNode.textContent = "Jetzt";
        }
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

      if (spotlightStatusNode) {
        spotlightStatusNode.textContent = getMatchStatus(targetDate);
      }
    };

    render();
    window.setInterval(render, 60000);
  };

  if (countdownSrc && dateNode && locationNode && timerNode) {
    fetch(countdownSrc)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Countdown source unavailable");
        }

        return response.text();
      })
      .then((icsText) => {
        const nextEvent = parseEvents(icsText).find((event) => event.start.getTime() > Date.now());

        if (!nextEvent) {
          renderFallback();
          return;
        }

        dateNode.textContent = formatDate(nextEvent.start);
        locationNode.textContent = nextEvent.location;
        renderSpotlight(nextEvent);
        void fetchMatchWeather(nextEvent);
        startCountdown(nextEvent.start);
      })
      .catch(() => {
        renderFallback();
      });
  }
}
