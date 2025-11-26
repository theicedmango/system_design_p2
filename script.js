// Select elements from your widget
const humidityEl = document.querySelector(".humid-percentage");
const statusEl = document.querySelector(".humid-status");
const descEl = document.querySelector(".description");
const iconEls = [
  document.querySelector(".icon1"),
  document.querySelector(".icon2"),
  document.querySelector(".icon3"),
];
const citySelect = document.getElementById("city-select");

// Modal elements
const modalOverlay = document.getElementById("modal-overlay");
const viewMoreBtn = document.getElementById("view-more");
const modalClose = document.getElementById("modal-close");
const modalRefresh = document.getElementById("modal-refresh");
const modalCurrentEl = document.getElementById("modal-current");
const modalStateEl = document.getElementById("modal-state");
const modalUpdatedEl = document.getElementById("modal-updated");
const modalFooterUpdatedEl = document.getElementById("modal-footer-updated");
const rangeSelect = document.getElementById("range-select");

let chart; // Chart.js instance
let lastHumidity = null;
let lastState = { label: "", color: "#22a352" };

// Save a humidity reading to MongoDB via Vercel API
async function saveHumidityToDb(humidity) {
  try {
    await fetch("/api/humidity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        city: "Toronto",
        humidity,
      }),
    });
  } catch (err) {
    console.error("Failed to save humidity to DB", err);
  }
}

// State mapping
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

// Format time helper
function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Fetch current humidity from Open-Meteo
async function fetchHumidity(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=relative_humidity_2m&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    const humidity = data?.current?.relative_humidity_2m;

    if (!Number.isFinite(humidity)) {
      throw new Error("Invalid humidity value");
    }

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

    // Log Toronto readings into the DB (Toronto only)
    if (citySelect.value.startsWith("43.6532")) {
      saveHumidityToDb(humidity);
    }

    updateModalHeader();
  } catch (err) {
    console.error("Failed to fetch humidity", err);
    humidityEl.textContent = "--%";
    statusEl.textContent = "Error";
    statusEl.style.color = "#c62828";
    humidityEl.style.color = "#c62828";
    descEl.textContent = "Unable to load humidity data. Please check your connection.";
  }
}

// History for chart – now backed by MongoDB via Vercel API
async function fetchHistory(lat, lon, rangeKey) {
  try {
    const res = await fetch(`/api/humidity?range=${rangeKey}`);
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

// Chart rendering
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
          data: series,
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
            label: (ctx) => `Humidity: ${ctx.parsed.y}%`,
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

// Modal header + stats update
function updateModalHeader() {
  if (lastHumidity == null) return;

  modalCurrentEl.textContent = `${lastHumidity}%`;
  modalStateEl.textContent = lastState.label;
  modalStateEl.style.color = lastState.color;
  modalCurrentEl.style.color = lastState.color;

  const nowStr = formatTime();
  modalUpdatedEl.textContent = `Last updated: ${nowStr}`;
  modalFooterUpdatedEl.textContent = `Last updated: ${nowStr}`;
}

// Load modal content (chart + stats)
async function loadModalContent() {
  modalRefresh.classList.add("spinning");

  const [lat, lon] = citySelect.value.split(",");
  const rangeKey = rangeSelect.value;

  const { labels, series, avg, high, low } = await fetchHistory(lat, lon, rangeKey);

  renderChart(labels, series);

  const statsAvg = document.getElementById("stat-avg");
  const statsHigh = document.getElementById("stat-high");
  const statsLow = document.getElementById("stat-low");

  if (statsAvg) statsAvg.textContent = `${avg}%`;
  if (statsHigh) statsHigh.textContent = `${high}%`;
  if (statsLow) statsLow.textContent = `${low}%`;

  updateModalHeader();
  modalRefresh.classList.remove("spinning");
}

// Modal controls
function openModal() {
  modalOverlay.classList.add("open");
  loadModalContent();
}

function closeModal() {
  modalOverlay.classList.remove("open");
}

// Event listeners
viewMoreBtn.addEventListener("click", openModal);
modalClose.addEventListener("click", closeModal);
modalRefresh.addEventListener("click", loadModalContent);
rangeSelect.addEventListener("change", loadModalContent);

// Close when clicking overlay background
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) {
    closeModal();
  }
});

// City select change – refresh main widget when switching city
citySelect.addEventListener("change", () => {
  const [lat, lon] = citySelect.value.split(",");
  fetchHumidity(lat, lon);
  if (modalOverlay.classList.contains("open")) {
    loadModalContent();
  }
});

// Initial load
(function init() {
  const [lat, lon] = citySelect.value.split(",");
  fetchHumidity(lat, lon);

  // Refresh every 10 minutes
  setInterval(() => {
    const [clat, clon] = citySelect.value.split(",");
    fetchHumidity(clat, clon);
    if (modalOverlay.classList.contains("open")) {
      loadModalContent();
    }
  }, 10 * 60 * 1000);
})();
