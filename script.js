// Select elements from your widget
const humidityEl = document.querySelector(".humid-percentage");
const statusEl = document.querySelector(".humid-status");
const descEl = document.querySelector(".description");
const iconEls = [document.querySelector(".icon1"), document.querySelector(".icon2"), document.querySelector(".icon3")];
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

// State mapping 
function getHumidityState(h) {
  if (h <= 40) {
    return {
      label: "Good",
      color: "#22a352",
      desc: "Humidity is in an optimal range. Filament stays stable and printing performance remains reliable. No extra precautions are needed.",
      icons: ["img/icon_half.svg", "img/icon_empty.svg", "img/icon_empty.svg"]
    };
  } else if (h <= 60) {
    return {
      label: "Fair",
      color: "#d4a017",
      desc: "Humidity is moderately elevated. Filament may slowly absorb moisture over time. Consider using sealed storage if filament is left out.",
      icons: ["img/icon_full.svg", "img/icon_half.svg", "img/icon_empty.svg"]
    };
  } else {
    return {
      label: "Bad",
      color: "#c62828",
      desc: "Humidity is high. Filament can absorb moisture quickly, which may affect print quality. Dry storage is recommended.",
      icons: ["img/icon_full.svg", "img/icon_full.svg", "img/icon_full.svg"]
    };
  }
}

// Apply Good/Fair/Bad color to any element based on a numeric humidity value
function applyStateColor(el, value) {
  const s = getHumidityState(value);
  el.style.color = s.color;
}

// Current humidity 
async function fetchHumidity(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=relative_humidity_2m&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  const humidity = data?.current?.relative_humidity_2m;

  // Update widget UI
  humidityEl.textContent = `${humidity}%`;
  const state = getHumidityState(humidity);
  statusEl.textContent = state.label;
  statusEl.style.color = state.color;
  humidityEl.style.color = state.color;
  descEl.textContent = state.desc;
  iconEls.forEach((el, i) => (el.src = state.icons[i]));

  // Save for modal
  lastHumidity = humidity;
  lastState = state;

  updateModalHeader();
}

// History for chart (fix: skip invalids to avoid 0% lows)
async function fetchHistory(lat, lon, rangeKey) {
  const ranges = {
    week:    { past: 7,  step: 6  },  // every 6 hours
    month:   { past: 30, step: 12 },  // every 12 hours
    quarter: { past: 90, step: 24 }   // every 24 hours
  };
  const { past, step } = ranges[rangeKey] || ranges.week;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=relative_humidity_2m&past_days=${past}&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();

  const times  = data?.hourly?.time || [];
  const values = data?.hourly?.relative_humidity_2m || [];

  const labels = [];
  const series = [];

  // only push valid numeric points (prevents false 0 lows and left clipping)
  for (let i = 0; i < times.length; i += step) {
    const v = values[i];
    if (Number.isFinite(v)) {
      labels.push(times[i]);
      series.push(v);
    }
  }

  const filtered = series.filter(Number.isFinite);
  const avg  = Math.round(filtered.reduce((a, b) => a + b, 0) / (filtered.length || 1));
  const high = filtered.length ? Math.max(...filtered) : 0;
  const low  = filtered.length ? Math.min(...filtered) : 0;

  return { labels, series: filtered, avg, high, low };
}

// Chart rendering
function renderChart(labels, series) {
  const ctx = document.getElementById("humidityChart").getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, "rgba(66, 163, 255, 0.25)");
  gradient.addColorStop(1, "rgba(66, 163, 255, 0.03)");

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: series,
        spanGaps: true,
        fill: true,
        backgroundColor: gradient,
        borderColor: "#7fb8ff",
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { left: 4, right: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#2f2f33",
          titleColor: "#e5e5e7",
          bodyColor: "#e5e5e7",
          borderColor: "#4c4c55",
          borderWidth: 1
        }
      },
      scales: {
        x: {
          ticks: { display: false, color: "#9a9aa0" },
          grid: { color: "rgba(255,255,255,0.06)" }
        },
        y: {
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: { color: "#9a9aa0", stepSize: 10, callback: v => v + "%" },
          grid: { color: "rgba(255,255,255,0.06)" }
        }
      }
    }
  });
}

// Modal helpers 
function openModal() {
  modalOverlay.classList.add("open");
  setTimeout(loadModalContent, 50);
}
function closeModal() { modalOverlay.classList.remove("open"); }

function updateModalHeader() {
  if (lastHumidity == null) return;
  modalCurrentEl.textContent = `${lastHumidity}%`;
  modalStateEl.textContent = `(${lastState.label})`;
  modalCurrentEl.style.color = lastState.color;
  modalStateEl.style.color = lastState.color;

  const t = new Date();
  const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  modalUpdatedEl.textContent = `Last Updated: ${time}`;
  modalFooterUpdatedEl.textContent = `Last updated: ${time}`;
}

async function loadModalContent() {
  updateModalHeader();
  const [lat, lon] = citySelect.value.split(",");
  const rangeKey = rangeSelect.value;
  const { labels, series, avg, high, low } = await fetchHistory(lat, lon, rangeKey);

  renderChart(labels, series);

  // Update stats + color-code like main value
  const avgEl = document.getElementById("stat-avg");
  const highEl = document.getElementById("stat-high");
  const lowEl = document.getElementById("stat-low");

  avgEl.textContent = `${avg}%`;
  highEl.textContent = `${high}%`;
  lowEl.textContent = `${low}%`;

  applyStateColor(avgEl, avg);
  applyStateColor(highEl, high);
  applyStateColor(lowEl, low);
}

// Events 
citySelect.addEventListener("change", () => {
  const [lat, lon] = citySelect.value.split(",");
  fetchHumidity(lat, lon);
  if (modalOverlay.classList.contains("open")) loadModalContent();
});

viewMoreBtn.addEventListener("click", openModal);
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-refresh").addEventListener("click", loadModalContent);
rangeSelect.addEventListener("change", loadModalContent);

// Close when clicking overlay
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Initial load 
(function init() {
  const [lat, lon] = citySelect.value.split(",");
  fetchHumidity(lat, lon);
  setInterval(() => {
    const [clat, clon] = citySelect.value.split(",");
    fetchHumidity(clat, clon);
    if (modalOverlay.classList.contains("open")) loadModalContent();
  }, 10 * 60 * 1000);
})();