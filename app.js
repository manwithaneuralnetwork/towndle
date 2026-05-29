const { createApp } = Vue;

const EARTH_RADIUS_KM = 6371;
const PERFECT_SCORE_DISTANCE_KM = 10;
const SCORE_DECAY_KM = 1600;
const DATASET_BASE_URL = "";
const SUPABASE_URL = "https://oonlddgrujfxvcmudaqk.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ZrrKYK0S_hwswfNB9gUzsw_JSOCWs-a";
const USER_ID_STORAGE_KEY = "towndle_user_id";
const GAME_PROGRESS_STORAGE_KEY = "towndle_daily_progress";
const DAILY_TIME_ZONE = "America/New_York";
const DIFFICULTIES = [
  {
    id: "standard",
    label: "Standard",
    description: "1M+ Cities. English map labels. You get population, elevation, and country code.",
    datasetPath: "clean-datasets/cities1000000.txt",
    mapStyle: "english",
    hints: {
      countryCode: true,
      population: true,
      elevation: true,
    },
  },
  {
    id: "hard",
    label: "Hard",
    description: "250k+ Cities. Local map labels. You get population and elevation.",
    datasetPath: "clean-datasets/cities250000.txt",
    mapStyle: "local",
    hints: {
      countryCode: false,
      population: true,
      elevation: true,
    },
  },
  {
    id: "impossible",
    label: "Impossible",
    description: "100k+ Cities. No map labels. You get no help of any kind.",
    datasetPath: "clean-datasets/cities100000.txt",
    mapStyle: "blank",
    hints: {
      countryCode: false,
      population: false,
      elevation: false,
    },
  },
];

createApp({
  data() {
    return {
      screen: "menu",
      cityCache: {},
      isLoading: true,
      hasLoadError: false,
      loadingDifficultyId: null,
      activeDifficultyId: "standard",
      gameLength: 5,
      rounds: [],
      currentRoundIndex: 0,
      totalScore: 0,
      selectedLat: null,
      selectedLng: null,
      roundSubmitted: false,
      roundScore: 0,
      roundDistanceKm: null,
      map: null,
      mapTileLayer: null,
      guessMarker: null,
      answerMarker: null,
      distanceLine: null,
      shareLabel: "Share",
      histogramBuckets: [],
      scoreSyncStatus: "",
      isSyncingScore: false,
      dailyPlayCount: null,
      resetCountdown: "00:00:00",
      resetTimerId: null,
      lastDailyDateKey: "",
    };
  },

  computed: {
    currentCity() {
      return this.rounds[this.currentRoundIndex] ?? {
        name: "",
        countryCode: "",
        population: 0,
        latitude: 0,
        longitude: 0,
        dem: null,
      };
    },

    difficulties() {
      return DIFFICULTIES;
    },

    activeDifficulty() {
      return this.difficulties.find((difficulty) => difficulty.id === this.activeDifficultyId) ?? this.difficulties[0];
    },

    roundNumber() {
      return this.currentRoundIndex + 1;
    },

    maxScore() {
      return this.gameLength * 5000;
    },

    hasGuess() {
      return Number.isFinite(this.selectedLat) && Number.isFinite(this.selectedLng);
    },

    isFinalRound() {
      return this.currentRoundIndex === this.gameLength - 1;
    },

    selectedLatDisplay() {
      return Number.isFinite(this.selectedLat) ? this.selectedLat.toFixed(4) : "Not set";
    },

    selectedLngDisplay() {
      return Number.isFinite(this.selectedLng) ? this.selectedLng.toFixed(4) : "Not set";
    },

    countryCodeDisplay() {
      return this.activeDifficulty.hints.countryCode ? this.currentCity.countryCode : "?";
    },

    populationDisplay() {
      return this.activeDifficulty.hints.population ? this.currentCity.population.toLocaleString() : "?";
    },

    elevationDisplay() {
      if (!this.activeDifficulty.hints.elevation) {
        return "?";
      }

      return Number.isFinite(this.currentCity.dem) ? `${this.currentCity.dem.toLocaleString()} m` : "Unknown";
    },

    distanceDisplay() {
      return Number.isFinite(this.roundDistanceKm)
        ? `${Math.round(this.roundDistanceKm).toLocaleString()} km`
        : "Unknown";
    },

    highlightedBucketLabel() {
      return this.getScoreBucketLabel(this.totalScore);
    },

    histogramDifficultyLabel() {
      return `${this.activeDifficulty.label} - ${this.dailyDateKey}`;
    },

    maxHistogramCount() {
      return Math.max(1, ...this.histogramBuckets.map((bucket) => Number(bucket.submission_count) || 0));
    },

    dailyDateKey() {
      return this.getDailyDateKey();
    },

    dailyPlayCountDisplay() {
      return this.dailyPlayCount === null ? "--" : this.dailyPlayCount.toLocaleString();
    },
  },

  mounted() {
    this.isLoading = false;
    this.lastDailyDateKey = this.getDailyDateKey();
    this.updateResetCountdown();
    this.loadDailyPlayCount();
    this.resetTimerId = setInterval(() => {
      const currentDailyDateKey = this.getDailyDateKey();
      this.updateResetCountdown();
      if (currentDailyDateKey !== this.lastDailyDateKey) {
        this.lastDailyDateKey = currentDailyDateKey;
        this.dailyPlayCount = null;
        this.loadDailyPlayCount();
      }
    }, 1000);
  },

  methods: {
    parseCities(text) {
      const lines = text.trim().split(/\r?\n/);
      return lines
        .slice(1)
        .map((line) => {
          const [name, countryCode, population, latitude, longitude, dem] = line.split("\t");
          return {
            name,
            countryCode,
            population: Number(population),
            latitude: Number(latitude),
            longitude: Number(longitude),
            dem: dem === "" ? null : Number(dem),
          };
        })
        .filter(
          (city) =>
            city.name &&
            Number.isFinite(city.population) &&
            Number.isFinite(city.latitude) &&
            Number.isFinite(city.longitude),
        );
    },

    showDifficultySelect() {
      this.hasLoadError = false;
      this.screen = "difficulty";
    },

    async startGame(difficultyId) {
      if (this.isLoading) {
        return;
      }

      this.hasLoadError = false;
      this.isLoading = true;
      this.loadingDifficultyId = difficultyId;

      try {
        const cities = await this.getCitiesForDifficulty(difficultyId);
        const savedProgress = this.getSavedProgress(difficultyId);
        this.destroyMap();
        this.activeDifficultyId = difficultyId;
        this.rounds = this.pickDailyCities(cities, this.gameLength, difficultyId);
        this.currentRoundIndex = savedProgress?.currentRoundIndex ?? 0;
        this.totalScore = savedProgress?.totalScore ?? 0;
        this.shareLabel = "Share";
        this.histogramBuckets = [];
        this.scoreSyncStatus = "";
        this.restoreRoundState(savedProgress);
        this.screen = "game";
        this.$nextTick(() => {
          this.initMap();
          if (this.roundSubmitted) {
            this.restoreSubmittedMapState();
          }
        });
      } catch (error) {
        console.error(error);
        this.hasLoadError = true;
      } finally {
        this.isLoading = false;
        this.loadingDifficultyId = null;
      }
    },

    async getCitiesForDifficulty(difficultyId) {
      if (this.cityCache[difficultyId]) {
        return this.cityCache[difficultyId];
      }

      const difficulty = this.difficulties.find((option) => option.id === difficultyId);
      if (!difficulty) {
        throw new Error(`Unknown difficulty: ${difficultyId}`);
      }

      const response = await fetch(this.getDatasetUrl(difficulty.datasetPath));
      if (!response.ok) {
        throw new Error(`Dataset request failed with ${response.status}`);
      }

      const text = await response.text();
      const cities = this.parseCities(text);
      if (cities.length < this.gameLength) {
        throw new Error("Not enough cities to start a game");
      }

      this.cityCache[difficultyId] = cities;
      return cities;
    },

    getDatasetUrl(datasetPath) {
      return `${DATASET_BASE_URL}${datasetPath}`;
    },

    pickDailyCities(cities, count, difficultyId) {
      const random = this.createSeededRandom(`${this.getDailyDateKey()}:${difficultyId}`);
      const selectedIndexes = new Set();

      while (selectedIndexes.size < count) {
        selectedIndexes.add(Math.floor(random() * cities.length));
      }

      return [...selectedIndexes].map((index) => cities[index]);
    },

    createSeededRandom(seedText) {
      let seed = 2166136261;
      for (let i = 0; i < seedText.length; i += 1) {
        seed ^= seedText.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
      }

      return () => {
        seed += 0x6d2b79f5;
        let value = seed;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    },

    initMap() {
      if (this.map || !window.L) {
        return;
      }

      this.map = L.map("map", {
        worldCopyJump: true,
        zoomControl: true,
      }).setView([20, 0], 2);

      const tileLayerConfig = this.getMapLayerConfig();
      this.mapTileLayer = L.tileLayer(tileLayerConfig.url, tileLayerConfig.options).addTo(this.map);

      this.map.on("click", (event) => this.placeGuess(event.latlng));
      setTimeout(() => this.map.invalidateSize(), 0);
    },

    getMapLayerConfig() {
      if (this.activeDifficulty.mapStyle === "english") {
        return {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
          options: {
            attribution:
              "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, Garmin, FAO, NOAA, USGS, EPA, NPS, US Census Bureau, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri, HERE, Garmin, SafeGraph, GeoTechnologies, Inc, METI/NASA, USGS",
            maxZoom: 19,
          },
        };
      }

      if (this.activeDifficulty.mapStyle === "blank") {
        return {
          url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
          options: {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 20,
            subdomains: "abcd",
          },
        };
      }

      return {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        options: {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
        },
      };
    },

    placeGuess(latlng) {
      if (this.roundSubmitted) {
        return;
      }

      this.selectedLat = latlng.lat;
      this.selectedLng = latlng.lng;

      if (this.guessMarker) {
        this.guessMarker.setLatLng(latlng);
      } else {
        this.guessMarker = L.circleMarker(latlng, {
          radius: 8,
          color: "#fff8ea",
          weight: 3,
          fillColor: "#171814",
          fillOpacity: 1,
        }).addTo(this.map);
      }
    },

    submitGuess() {
      if (!this.hasGuess || this.roundSubmitted) {
        return;
      }

      const city = this.currentCity;
      this.roundDistanceKm = this.getDistanceKm(
        this.selectedLat,
        this.selectedLng,
        city.latitude,
        city.longitude,
      );
      this.roundScore = this.getScore(this.roundDistanceKm);
      this.totalScore += this.roundScore;
      this.roundSubmitted = true;
      this.showAnswer();
      this.saveProgress();
    },

    showAnswer() {
      const cityLatLng = [this.currentCity.latitude, this.currentCity.longitude];
      this.answerMarker = L.circleMarker(cityLatLng, {
        radius: 8,
        color: "#f8f3e6",
        weight: 3,
        fillColor: "#2f6f4e",
        fillOpacity: 1,
      })
        .addTo(this.map)
        .bindTooltip(`${this.currentCity.name}, ${this.currentCity.countryCode}`, {
          permanent: false,
          direction: "top",
        });

      this.distanceLine = L.polyline(
        [
          [this.selectedLat, this.selectedLng],
          cityLatLng,
        ],
        {
          color: "#2f6f4e",
          weight: 3,
          opacity: 0.78,
        },
      ).addTo(this.map);

      const bounds = L.latLngBounds([
        [this.selectedLat, this.selectedLng],
        cityLatLng,
      ]);
      this.map.fitBounds(bounds.pad(0.28), {
        maxZoom: 5,
        animate: true,
      });
    },

    goToNextRound() {
      if (this.isFinalRound) {
        this.destroyMap();
        this.screen = "end";
        this.clearSavedProgress(this.activeDifficulty.id);
        this.syncFinalScore();
        return;
      }

      this.currentRoundIndex += 1;
      this.resetRoundState();
      this.saveProgress();
      this.$nextTick(() => {
        this.clearMapLayers();
        this.map.setView([20, 0], 2);
      });
    },

    resetRoundState() {
      this.selectedLat = null;
      this.selectedLng = null;
      this.roundSubmitted = false;
      this.roundScore = 0;
      this.roundDistanceKm = null;
    },

    restoreRoundState(savedProgress) {
      if (!savedProgress?.roundSubmitted) {
        this.resetRoundState();
        return;
      }

      this.selectedLat = savedProgress.selectedLat;
      this.selectedLng = savedProgress.selectedLng;
      this.roundSubmitted = true;
      this.roundScore = savedProgress.roundScore;
      this.roundDistanceKm = savedProgress.roundDistanceKm;
    },

    restoreSubmittedMapState() {
      if (!this.hasGuess || !this.map) {
        return;
      }

      this.clearMapLayers();
      this.guessMarker = L.circleMarker([this.selectedLat, this.selectedLng], {
        radius: 8,
        color: "#fff8ea",
        weight: 3,
        fillColor: "#171814",
        fillOpacity: 1,
      }).addTo(this.map);
      this.showAnswer();
    },

    clearMapLayers() {
      [this.guessMarker, this.answerMarker, this.distanceLine].forEach((layer) => {
        if (layer) {
          layer.remove();
        }
      });
      this.guessMarker = null;
      this.answerMarker = null;
      this.distanceLine = null;
    },

    destroyMap() {
      if (this.map) {
        this.clearMapLayers();
        this.map.remove();
        this.map = null;
        this.mapTileLayer = null;
      }
    },

    getDistanceKm(lat1, lon1, lat2, lon2) {
      const dLat = this.toRadians(lat2 - lat1);
      const dLon = this.toRadians(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(this.toRadians(lat1)) *
          Math.cos(this.toRadians(lat2)) *
          Math.sin(dLon / 2) ** 2;
      return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    getScore(distanceKm) {
      if (distanceKm <= PERFECT_SCORE_DISTANCE_KM) {
        return 5000;
      }

      const adjustedDistance = distanceKm - PERFECT_SCORE_DISTANCE_KM;
      return Math.round(5000 * Math.exp(-adjustedDistance / SCORE_DECAY_KM));
    },

    toRadians(degrees) {
      return (degrees * Math.PI) / 180;
    },

    async shareScore() {
      const text = [
        `Towndle ${this.dailyDateKey}`,
        `${this.activeDifficulty.label}: ${this.totalScore.toLocaleString()} / ${this.maxScore.toLocaleString()}`,
        "https://towndle-game.netlify.app",
      ].join("\n");
      try {
        await navigator.clipboard.writeText(text);
        this.shareLabel = "Copied";
      } catch (error) {
        console.error(error);
        this.shareLabel = "Copy failed";
      }
      setTimeout(() => {
        this.shareLabel = "Share";
      }, 1600);
    },

    returnToMenu() {
      this.destroyMap();
      this.screen = "menu";
      this.loadDailyPlayCount();
    },

    async syncFinalScore() {
      this.scoreSyncStatus = "Syncing score...";
      this.isSyncingScore = true;

      try {
        const submitResult = await this.submitFinalScore();
        await this.loadScoreHistogram();
        await this.loadDailyPlayCount();
        this.scoreSyncStatus = submitResult.counted
          ? "Your score was added to today's distribution."
          : "You already submitted this difficulty today. Showing today's distribution.";
      } catch (error) {
        console.error(error);
        this.scoreSyncStatus = "Could not sync today's distribution right now.";
      } finally {
        this.isSyncingScore = false;
      }
    },

    async submitFinalScore() {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/towndle_score_submissions`, {
        method: "POST",
        headers: this.getSupabaseHeaders({
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        }),
        body: JSON.stringify({
          user_id: this.getUserId(),
          game_date: this.getDailyDateKey(),
          difficulty: this.activeDifficulty.id,
          score: this.totalScore,
        }),
      });

      if (response.ok) {
        return { counted: true };
      }

      if (response.status === 409) {
        return { counted: false };
      }

      throw new Error(`Score submission failed with ${response.status}`);
    },

    async loadScoreHistogram() {
      this.histogramBuckets = await this.fetchScoreHistogram(this.activeDifficulty.id, this.getDailyDateKey());
    },

    async loadDailyPlayCount() {
      try {
        const histograms = await Promise.all(
          this.difficulties.map((difficulty) => this.fetchScoreHistogram(difficulty.id, this.getDailyDateKey())),
        );
        this.dailyPlayCount = histograms
          .flat()
          .reduce((total, bucket) => total + (Number(bucket.submission_count) || 0), 0);
      } catch (error) {
        console.error(error);
        this.dailyPlayCount = null;
      }
    },

    async fetchScoreHistogram(difficultyId, dailyDateKey) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_towndle_score_histogram`, {
        method: "POST",
        headers: this.getSupabaseHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          p_game_date: dailyDateKey,
          p_difficulty: difficultyId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Histogram request failed with ${response.status}`);
      }

      return response.json();
    },

    getSupabaseHeaders(extraHeaders = {}) {
      return {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        ...extraHeaders,
      };
    },

    getUserId() {
      const existingUserId = localStorage.getItem(USER_ID_STORAGE_KEY);
      if (existingUserId) {
        return existingUserId;
      }

      const newUserId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (character) =>
              (Number(character) ^ (Math.random() * 16)).toString(16).slice(0, 1),
            );
      localStorage.setItem(USER_ID_STORAGE_KEY, newUserId);
      return newUserId;
    },

    getDailyDateKey() {
      const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: DAILY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const partMap = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
      const year = partMap.year;
      const month = partMap.month;
      const day = partMap.day;
      return `${year}-${month}-${day}`;
    },

    getNextDailyResetTime() {
      const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: DAILY_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const partMap = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
      return this.getZonedDateTimeUtcMs(
        Number(partMap.year),
        Number(partMap.month),
        Number(partMap.day) + 1,
        0,
        0,
        0,
        DAILY_TIME_ZONE,
      );
    },

    getZonedDateTimeUtcMs(year, month, day, hour, minute, second, timeZone) {
      const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
      const offset = this.getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
      return utcGuess - offset;
    },

    getTimeZoneOffsetMs(date, timeZone) {
      const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(date);
      const partMap = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
      const zonedAsUtc = Date.UTC(
        Number(partMap.year),
        Number(partMap.month) - 1,
        Number(partMap.day),
        Number(partMap.hour),
        Number(partMap.minute),
        Number(partMap.second),
      );
      return zonedAsUtc - date.getTime();
    },

    updateResetCountdown() {
      this.resetCountdown = this.formatDuration(Math.max(0, this.getNextDailyResetTime() - Date.now()));
    },

    formatDuration(durationMs) {
      const totalSeconds = Math.floor(durationMs / 1000);
      const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      return `${hours}:${minutes}:${seconds}`;
    },

    getScoreBucketLabel(score) {
      if (score === 25000) {
        return "25000";
      }

      const bucketMin = Math.floor(score / 2500) * 2500;
      const cappedBucketMin = Math.min(bucketMin, 22500);
      return `${cappedBucketMin}-${cappedBucketMin + 2499}`;
    },

    getProgressKey(difficultyId) {
      return `${this.getDailyDateKey()}:${difficultyId}`;
    },

    getAllSavedProgress() {
      try {
        return JSON.parse(localStorage.getItem(GAME_PROGRESS_STORAGE_KEY)) ?? {};
      } catch (error) {
        console.error(error);
        return {};
      }
    },

    getSavedProgress(difficultyId) {
      const savedProgress = this.getAllSavedProgress()[this.getProgressKey(difficultyId)];
      if (!savedProgress || savedProgress.completed) {
        return null;
      }

      if (savedProgress.gameLength !== this.gameLength) {
        return null;
      }

      return savedProgress;
    },

    saveProgress() {
      const progressByKey = this.getAllSavedProgress();
      progressByKey[this.getProgressKey(this.activeDifficulty.id)] = {
        gameDate: this.getDailyDateKey(),
        difficulty: this.activeDifficulty.id,
        gameLength: this.gameLength,
        currentRoundIndex: this.currentRoundIndex,
        totalScore: this.totalScore,
        selectedLat: this.selectedLat,
        selectedLng: this.selectedLng,
        roundSubmitted: this.roundSubmitted,
        roundScore: this.roundScore,
        roundDistanceKm: this.roundDistanceKm,
        completed: false,
      };
      localStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progressByKey));
    },

    clearSavedProgress(difficultyId) {
      const progressByKey = this.getAllSavedProgress();
      delete progressByKey[this.getProgressKey(difficultyId)];
      localStorage.setItem(GAME_PROGRESS_STORAGE_KEY, JSON.stringify(progressByKey));
    },

    getHistogramBarStyle(bucket) {
      const count = Number(bucket.submission_count) || 0;
      const width = count === 0 ? "0%" : `${Math.max(4, (count / this.maxHistogramCount) * 100)}%`;
      return { width };
    },
  },
}).mount("#app");
