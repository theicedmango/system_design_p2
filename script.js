// ========= DOM ELEMENTS =========
const humidityEl = document.querySelector(".humid-percentage");
const statusEl = document.querySelector(".humid-status");
const descEl = document.querySelector(".description");
const iconEls = [
  document.querySelector(".icon1"),
  document.querySelector(".icon2"),
  document.querySelector(".icon3"),
];

// Modal
const modalOverlay = document.getElementById("modal-overlay");
const viewMoreBtn = document.getElementById("view-more");
const modalClose = document.getElementById("modal-close");
const modalRefresh = document.getElementById("modal-refresh");
const modalCurrentEl = document.getElementById("modal-current");
const modalStateEl = document.getElementById("modal-state");
const modalFooterUpdatedEl = document.getElementById("modal-footer-updated");
const rangeSelect = document.getElementById("range-select");

let chart; // Chart.js instance
let lastHumidity = null;
let lastState = { label: "", color: "#22a352" };

// We’ll always use this “city” key for ESP32 readings
const SENSOR_CITY = "Sensor";

// ========= HELPERS =========

function getHumidityState(h) {
  if (h <= 40) {
    return {
      label: "Good",
      color: "#22a352",
      desc: "Humidity is in an optimal range for most filaments. Printing conditions are stable and moisture absorption is minimal.",
      icons: ["img/icon_full.svg", "img/icon_full.svg", "img/icon_empty.svg"],
    };
  } else if (h <= 50) {
    return {
      label: "OK",
      color: "#4caf50",
      desc: "Humidity is slightly elevated but still acceptable. Most filaments will print fine, though sensitive materials benefit from dry storage.",
      icons: ["img/icon_full.svg", "img/icon_half.svg", "img/icon_empty.svg"],
    };
  } else if (h <= 60) {
    return {
      label: "Fair",
      color: "#d4a017",
      desc: "Humidity is moderately elevated. Filament may slowly absorb moisture over time. Consider using sealed storage if filament is left out.",
      icons: ["img/icon_full.svg", "img/icon_half.svg", "img/icon_empty.svg"],
    };
  } else {
    return {
      label: "Bad",
      color: "#c62828",
      desc: "Humidity is high. Filament can absorb moisture quickly, which may affect print quality. Dry storage is recommended.",
      icons: ["img/icon_full.svg", "img/icon_full.svg", "img/icon_full.svg"],
    };
  }
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ========= API CALLS (ESP32 / MongoDB) =========

// Get recent history from your API (all from ESP32 sensor)
async function fetchHistory(rangeKey) {
  try {
    const res = await fetch(`/api/humidity?city=${SENSOR_CITY}&range=${rangeKey}`);
    if (!res.ok) {
      console.error("Failed to load history from DB");
      return { labels: [], series: [], avg: 0, high: 0, low: 0 };
    }
    return await res.json();
  } catch (err) {
    console.error("Error fetching history from DB", err);
    return { labels: [], series: [], avg: 0, high: 0, low: 0 };
  }
}

// Use the latest point from history as our "current" humidity reading
async function fetchLatestHumidity() {
  try {
    const { series } = await fetchHistory("week");
    if (!series || series.length === 0) {
      throw new Error("No sensor data available");
    }

    // Take the last reading and round it
    const humidity = Math.round(series[series.length - 1]);

    // Update widget UI
    humidityEl.textContent = `${humidity}%`;
    const state = getHumidityState(humidity);
    statusEl.textContent = state.label;
    statusEl.style.color = state.color;
    humidityEl.style.color = state.color;
    descEl.textContent = state.desc;
    iconEls.forEach((el, i) => {
      el.src = state.icons[i];
      el.alt = state.label;
    });

    // Save for modal
    lastHumidity = humidity;
    lastState = state;

    updateModalHeader();
  } catch (err) {
    console.error("Failed to fetch latest humidity from sensor", err);
    humidityEl.textContent = "--%";
    statusEl.textContent = "Error";
    statusEl.style.color = "#c62828";
    humidityEl.style.color = "#c62828";
    descEl.textContent =
      "Unable to load humidity data from sensor. Please check the ESP32 connection.";
  }
}

// ========= CHART + MODAL =========

function renderChart(labels, series) {
  const canvas = document.getElementById("humidityChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, "rgba(66, 163, 255, 0.25)");
  gradient.addColorStop(1, "rgba(66, 163, 255, 0.03)");

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Humidity (%)",
          data: series.map((v) => Math.round(v)), // round for the chart too
          borderColor: "rgba(66, 163, 255, 1)",
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { left: 4, right: 6, top: 8, bottom: 4 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#2f2f33",
          titleColor: "#e5e5e7",
          bodyColor: "#e5e5e7",
          padding: 8,
          displayColors: false,
          callbacks: {
            label: (ctx) => `Humidity: ${Math.round(ctx.parsed.y)}%`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 6,
            color: "#9f9fa4",
          },
          grid: {
            display: false,
          },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 100,
          ticks: {
            stepSize: 20,
            color: "#9f9fa4",
          },
          grid: {
            color: "rgba(255,255,255,0.05)",
          },
        },
      },
    },
  });
}

function updateModalHeader() {
  if (lastHumidity == null) return;

  modalCurrentEl.textContent = `${lastHumidity}%`;
  modalStateEl.textContent = lastState.label;
  modalStateEl.style.color = lastState.color;
  modalCurrentEl.style.color = lastState.color;

  const nowStr = formatTime();
  modalFooterUpdatedEl.textContent = `Last updated: ${nowStr}`;
}

async function loadModalContent() {
  modalRefresh.classList.add("spinning");

  const rangeKey = rangeSelect.value;
  const { labels, series, avg, high, low } = await fetchHistory(rangeKey);

  renderChart(labels, series);

  const statsAvg = document.getElementById("stat-avg");
  const statsHigh = document.getElementById("stat-high");
  const statsLow = document.getElementById("stat-low");

  if (statsAvg) statsAvg.textContent = `${Math.round(avg)}%`;
  if (statsHigh) statsHigh.textContent = `${Math.round(high)}%`;
  if (statsLow) statsLow.textContent = `${Math.round(low)}%`;

  updateModalHeader();
  modalRefresh.classList.remove("spinning");
}

// ========= MODAL CONTROLS =========

function openModal() {
  modalOverlay.classList.add("open");
  loadModalContent();
}

function closeModal() {
  modalOverlay.classList.remove("open");
}

viewMoreBtn.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
modalRefresh.addEventListener("click", loadModalContent);
rangeSelect.addEventListener("change", loadModalContent);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

// ========= INIT =========

(function init() {
  // First load from sensor
  fetchLatestHumidity();

  // Refresh every 10 minutes
  setInterval(() => {
    fetchLatestHumidity();
    if (modalOverlay.classList.contains("open")) {
      loadModalContent();
    }
  }, 10 * 60 * 1000);
})();
