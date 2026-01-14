console.log("1211");

// 後端 FastAPI 反向代理的前綴；用同源更簡單
const API_BASE = "/api";
const menuContainer = document.getElementById("menuContainer");
const dropdownMenu = document.getElementById("dropdownMenu");

window.priceChartInst = null;
window.volumeChartInst = null;
window.conditionAnnoIds = []; //  用來記錄條件點的 annotation id
window.signalAnnoIds = []; // 買賣點用的 annotation id

let future30Added = false;
let originalTradingDates = null;
let futurePredictionSeries = null;
let originalZoomRange = null; //  記住原本 zoom 範圍

let baseCandleData = []; // 只有歷史 K 棒
let currentCandleData = []; // 目前畫在圖上的 K 棒（可能包含未來30天）

// 要畫在圖上的點（用 scatter series 疊在 K 線上）
let conditionMarkPoints = []; // 進階條件 Builder 產生的點
let buySignalPoints = []; // 買訊號
let sellSignalPoints = []; // 賣訊號
let signalMarkersOn = false; // 買賣點 / 預測文字是否開啟

// 註冊點擊連結
async function handleRedirect() {
  const hash = window.location.hash;
  if (hash && hash.includes("access_token")) {
    const { data, error } = await client.auth.getSessionFromUrl({
      storeSession: true,
    });
    if (error) {
      console.error("處理 redirect 登入失敗:", error.message);
      return;
    }
    console.log("登入成功，使用者資訊：", data.session?.user);

    // 可導向到主畫面或清除 URL 中的 token
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
handleRedirect();

// 滑鼠移入顯示選單
menuContainer.addEventListener("mouseenter", () => {
  dropdownMenu.style.display = "block";
});

// 滑鼠移出整個容器隱藏選單
menuContainer.addEventListener("mouseleave", () => {
  dropdownMenu.style.display = "none";
});

// 登出
async function logout() {
  const { error } = await client.auth.signOut();
  if (!error) {
    alert("已登出");
    checkLoginStatus();
    hideMenu();
  }
}

// 判斷登入狀態
async function checkLoginStatus() {
  const {
    data: { user },
  } = await client.auth.getUser();

  const emailSpan = document.getElementById("user-email");
  const loginBtn = document.getElementById("login-btn");
  const registerBtn = document.getElementById("register-btn");
  const logoutBtn = document.getElementById("logout-btn");

  if (user) {
    emailSpan.textContent = user.email;
    emailSpan.style.display = "block";
    loginBtn.style.display = "none";
    registerBtn.style.display = "none";
    logoutBtn.style.display = "block";
  } else {
    emailSpan.textContent = "";
    emailSpan.style.display = "none";
    loginBtn.style.display = "block";
    registerBtn.style.display = "block";
    logoutBtn.style.display = "none";
  }
}

const hashParams = new URLSearchParams(window.location.hash.substring(1));
const accessToken = hashParams.get("access_token");
const refreshToken = hashParams.get("refresh_token");

if (accessToken && refreshToken) {
  supabase.auth
    .setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    .then(() => {
      // 成功登入，跳轉或顯示登入狀態
      window.location.hash = ""; // 清掉 URL hash
      alert("登入成功");
    });
}
window.onload = checkLoginStatus;

// 成交量壓縮比例（全域可調整） 0.3~0.6建議範圍
let VOL_PAD_TOP_RATIO = 0.1;
// === 指標清單（key = 後端欄位名, name = 圖例名, cb = checkbox 的 id）===
const INDICATORS = [
  { key: "Sma_5", name: "SMA_5", cb: "chkSma5" },
  { key: "Sma_10", name: "SMA_10", cb: "chkSma10" },
  { key: "Sma_20", name: "SMA_20", cb: "chkSma20" },
  { key: "Sma_60", name: "SMA_60", cb: "chkSma60" },
  // 之後要加 DIF/DEA/K/D...，照格式擴充即可
];

let chart;
let originalMinX = null;
let originalMaxX = null;

// ===== 時間區隔狀態 =====
let currentMonths = 3; // 目前的時間區隔長度（幾個月）
let showPeriods = false; // 是否顯示時間區隔線
let currentRange = "3m"; // 目前使用中的時間範圍 (5d / 1m / 3m / 1y / custom ...)

// === 視窗範圍工具（放這裡） ===
function getCurrentXRange() {
  const w = window.priceChartInst?.w;
  if (!w) return null;
  const min = w.globals?.minX;
  const max = w.globals?.maxX;
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function restoreXRange(range) {
  if (!range) return;
  // 等 ApexCharts 內部 update 完再套回，並且兩張圖都套
  setTimeout(() => {
    ["pricePane", "volumePane"].forEach((id) => {
      try {
        ApexCharts.exec(id, "zoomX", range.min, range.max);
      } catch (e) {}
    });
  }, 0);
}

//保持顯示技術線
function getCheckedIndicators() {
  return Array.from(document.querySelectorAll(".indicator-check:checked")).map(
    (el) => el.value
  );
}

//還原勾選函式
function restoreCheckedIndicators(checkedIndicators) {
  document.querySelectorAll(".indicator-check").forEach((el) => {
    el.checked = checkedIndicators.includes(el.value);
  });
}

//套用勾選的線到圖表
function applyIndicators() {
  if (window.updateIndicatorsFromChecked) {
    window.updateIndicatorsFromChecked();
  }
}

//儲存條件判斷勾選狀態
function getCheckedRules() {
  return Array.from(document.querySelectorAll(".rule-check:checked")).map(
    (el) => el.value
  );
}

//還原條件判斷勾選狀態
function restoreCheckedRules(checkedRules) {
  document.querySelectorAll(".rule-check").forEach((el) => {
    el.checked = checkedRules.includes(el.value);
  });
}

const allIndicators = [
  "Sma_5",
  "Sma_10",
  "Sma_20",
  "Sma_60",
  "Sma_120",
  "Sma_240",
  "DIF",
  "DEA",
  "K",
  "D",
  "J",
  "Bias",
];

const indicatorGroups = {
  price: ["Sma_5", "Sma_10", "Sma_20", "Sma_60", "Sma_120", "Sma_240"], // 走價格軸(第0軸)
  macd: ["DIF", "DEA"], // 走第1軸
  kdj: ["K", "D", "J"], // 走第2軸
  bias: ["Bias"], // 走第3軸
};

function getSymbol() {
  return document.getElementById("symbolInput").value || "AAPL";
}

function selectSymbol(symbol) {
  const input = document.getElementById("symbolInput");
  const suggestionsDiv = document.getElementById("suggestions");
  const searchContainer = document.getElementById("searchContainer");
  const searchToggle = document.getElementById("searchToggle");

  // 更新輸入框內容
  if (input) input.value = symbol;

  // 關掉建議列表
  if (suggestionsDiv) suggestionsDiv.style.display = "none";

  // 🔹 收起搜尋膠囊，恢復左邊搜尋 icon
  if (searchContainer) searchContainer.classList.add("hidden");
  if (searchToggle) searchToggle.style.display = "flex";

  // （如果你 Enter 時有順便關閉自訂日期 / 控制面板，也可以一起放進來）
  const customDiv = document.getElementById("customDateRange");
  if (customDiv) customDiv.style.display = "none";

  const controlPanel = document.getElementById("controlPanel");
  if (controlPanel) controlPanel.classList.remove("open");

  // 載入新的股票： 沿用目前的時間範圍
  loadStockWithRange(symbol, currentRange || "3m");
}

async function loadStockWithRange(symbol, range) {
  currentRange = range; // 記住這次使用的時間範圍
  // 1. 先記住目前使用者勾選了哪些技術線和條件
  const checkedIndicatorsBefore = getCheckedIndicators();
  const builderStateBefore = getBuilderState();

  // 自訂日期區塊
  if (range === "custom") {
    const start = document.getElementById("customStart").value;
    const end = document.getElementById("customEnd").value;
    if (!start || !end) return alert("請先選擇起訖日期");

    const url = `${API_BASE}/stocks/range?symbol=${encodeURIComponent(
      symbol
    )}&start=${start}&end=${end}`;
    const resp = await fetch(url);
    if (!resp.ok) return alert("查詢失敗");
    const data = await resp.json();
    if (!data || data.length === 0) return alert("查無資料");

    // 加了 await：確保圖表畫完，才執行下面的還原動作
    await displayStockData(data, symbol);

    restoreCheckedIndicators(checkedIndicatorsBefore);
    applyIndicators();

    restoreBuilderState(builderStateBefore); // 還原條件句
    applyConditionBuilder(true); // 自動套用時靜音

    // 如果買賣點目前是開啟狀態，換區間後自動更新
    if (signalMarkersOn) {
      await refreshSignalMarkersForCurrentView({ showAlertIfEmpty: false });
    }
    return;
  }

  // 快捷區間邏輯
  const rangeToCount = {
    "5d": 5,
    "1m": 22,
    "3m": 66,
    "6m": 132,
    "1y": 264,
    "3y": 792,
  };
  let count = rangeToCount[range] || 264;

  if (range === "ytd") {
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const diffTime = Math.abs(today - startOfYear);
    count = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  const url = `${API_BASE}/stocks?symbol=${encodeURIComponent(
    symbol
  )}&count=${count}`;
  const resp = await fetch(url);
  if (!resp.ok) return alert("查詢失敗");
  const data = await resp.json();
  if (!data || data.length === 0) return alert("查無資料");

  // 加了 await：這行最重要，等圖表建立好 global chart 變數後，才能畫線
  await displayStockData(data, symbol);

  // 還原使用者勾選與條件標註
  restoreCheckedIndicators(checkedIndicatorsBefore);
  applyIndicators();

  restoreBuilderState(builderStateBefore);
  applyConditionBuilder(true); // 同樣靜音

  // 如果買賣點目前是開啟狀態，換股票 / 區間後自動更新
  if (signalMarkersOn) {
    await refreshSignalMarkersForCurrentView({ showAlertIfEmpty: false });
  }

  console.log("symbol:", symbol, "count:", count);
}

function normalizeDateKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    console.warn("[normalizeDateKey] Invalid date:", dateStr);
    return null;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  // 之後所有 x-axis 和信號點都用這個格式
  return `${y}-${m}-${day}`; // "YYYY-MM-DD"
}

async function displayStockData(data, symbol) {
  window.stockData = data;

  // X 軸交易日
  // window.tradingDates = data.map((row) => {
  //   const d = new Date(row.date);
  //   return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
  //     2,
  //     "0"
  //   )}-${String(d.getDate()).padStart(2, "0")}`;
  // });
  window.tradingDates = data
    .map((row) => normalizeDateKey(row.date))
    .filter(Boolean);

  // 上圖：K線資料
  const chartData = data.map((row, idx) => ({
    x: window.tradingDates[idx],
    y: [+row.open, +row.high, +row.low, +row.close],
  }));

  // 記下原始 / 目前的 K 棒資料
  baseCandleData = chartData;
  currentCandleData = chartData;

  // 換股票或換區間時，把「未來30天」狀態整個重置
  future30Added = false;
  futurePredictionSeries = null;
  originalTradingDates = null;
  originalZoomRange = null;

  // 下圖：成交量資料
  const volData = (window.stockData || []).map((row, idx) => {
    const open = +row.open || 0;
    const close = +row.close || 0;
    const up = close >= open;
    return {
      x: window.tradingDates[idx],
      y: +row.volume || 0,
      fillColor: up ? "#e74c3c" : "#2ecc71",
    };
  });

  document.getElementById("chartTitle").innerText = `${symbol}`;
  document.getElementById("ohlcInfo").innerHTML =
    "將滑鼠懸停在圖表上以查看詳細資訊";

  // 清除舊圖表
  if (
    window.priceChartInst &&
    typeof window.priceChartInst.destroy === "function"
  ) {
    window.priceChartInst.destroy();
    window.priceChartInst = null;
  }
  if (
    window.volumeChartInst &&
    typeof window.volumeChartInst.destroy === "function"
  ) {
    window.volumeChartInst.destroy();
    window.volumeChartInst = null;
  }

  // const GRID_PAD_PRICE = { top: 10, right: 0, bottom: -30, left: 16 };
  // const GRID_PAD_VOLUME = { top: -25, right: -25, bottom: 0, left: 28 };

  const GRID_PAD_PRICE = { top: 10, right: 0, bottom: -30, left: 28 };
  const GRID_PAD_VOLUME = { top: -25, right: -3, bottom: 0, left: 18 };

  // ===== 上方「價格＋技術線」圖 =====
  const optionsPrice = {
    chart: {
      id: "pricePane",
      group: "stockPane",
      type: "candlestick",
      height: 370,
      zoom: { enabled: true, type: "x", autoScaleYaxis: false },
      events: {
        mounted: function () {
          ensureVolumeAxis();
        },
        zoomed: function () {
          if (!chart || !chart.w) return;
          const checked = getCheckedIndicators?.() ?? [];
          const showMacd = checked.some((n) =>
            indicatorGroups.macd.includes(n)
          );
          const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
          const showBias = checked.some((n) =>
            indicatorGroups.bias.includes(n)
          );

          chart.updateOptions(
            {
              yaxis: [
                { ...chart.w.config.yaxis[0], show: true },
                { ...chart.w.config.yaxis[1], show: showMacd },
                { ...chart.w.config.yaxis[2], show: showKdj },
                { ...chart.w.config.yaxis[3], show: showBias },
              ],
            },
            false,
            false
          );
          ensureVolumeAxis();
        },
      },
    },
    legend: { show: false },
    grid: { padding: GRID_PAD_PRICE },
    plotOptions: {
      candlestick: { colors: { upward: "#e74c3c", downward: "#2ecc71" } },
      bar: { columnWidth: "70%" },
    },
    states: {
      hover: { filter: { type: "darken", value: 0.7 } },
      active: { filter: { type: "darken", value: 1.5 } },
    },
    xaxis: buildSharedXAxis(),
    yaxis: [
      {
        title: { text: "價格 / SMA", offsetX: 0 },
        labels: {
          offsetX: 15,
          formatter: (v) => {
            if (v == null || isNaN(v)) return ""; // ⬅ 先擋掉 null / NaN
            return Number(v);
          },
        },
        tickAmount: 4,
        opposite: false,
        show: true,
        seriesName: [
          "K線圖",
          "Sma_5",
          "Sma_10",
          "Sma_20",
          "Sma_60",
          "Sma_120",
          "Sma_240",
        ],
      },
      {
        title: { text: "MACD" },
        labels: {
          formatter: (v) => {
            if (v == null || isNaN(v)) return "";
            return Number(v).toFixed(2);
          },
        },
        tickAmount: 4,
        opposite: true,
        show: false,
        seriesName: ["DIF", "DEA"],
      },
      {
        title: { text: "KDJ" },
        labels: {
          formatter: (v) => {
            if (v == null || isNaN(v)) return "";
            return Number(v).toFixed(0);
          },
        },
        tickAmount: 4,
        opposite: true,
        show: false,
        seriesName: ["K", "D", "J"],
      },
      {
        title: { text: "Bias" },
        labels: {
          formatter: (v) => {
            if (v == null || isNaN(v)) return "";
            return Number(v).toFixed(2);
          },
        },
        opposite: true,
        show: false,
        seriesName: ["Bias"],
      },
    ],

    series: [{ name: "K線圖", type: "candlestick", data: chartData }],
    annotations: {
      xaxis: [],
      points: [],
    },
    tooltip: {
      shared: true,
      custom: function ({ series, dataPointIndex, w }) {
        const ohlc = w.globals.initialSeries[0].data[dataPointIndex].y;
        const date = window.tradingDates[dataPointIndex];
        const trendClass = ohlc[3] >= ohlc[0] ? "up" : "down";
        const volRaw = window.stockData?.[dataPointIndex]?.volume ?? null;
        function fmtVol(val) {
          if (val == null) return "";
          if (val >= 1e9) return (val / 1e9).toFixed(0) + "B";
          if (val >= 1e6) return (val / 1e6).toFixed(0) + "M";
          if (val >= 1e3) return (val / 1e3).toFixed(0) + "K";
          return String(val);
        }
        let techLinesHtml = "";
        const checked = getCheckedIndicators?.() ?? [];
        checked.forEach((name) => {
          const idx = w.globals.seriesNames.indexOf(name);
          if (idx >= 0) {
            const val = series[idx][dataPointIndex];
            if (val != null) {
              techLinesHtml += `<div style="color:${
                indicatorColors[name] || "#000"
              }">${name}: ${val.toFixed(2)}</div>`;
            }
          }
        });
        const info = document.getElementById("ohlcInfo");
        if (info) {
          info.innerHTML = `
            <span class="ohlc-item"><span class="ohlc-label">開</span><span class="ohlc-value ${trendClass}">${ohlc[0].toFixed(
            2
          )}</span></span>
            <span class="ohlc-item"><span class="ohlc-label">高</span><span class="ohlc-value ${trendClass}">${ohlc[1].toFixed(
            2
          )}</span></span>
            <span class="ohlc-item"><span class="ohlc-label">低</span><span class="ohlc-value ${trendClass}">${ohlc[2].toFixed(
            2
          )}</span></span>
            <span class="ohlc-item"><span class="ohlc-label">收</span><span class="ohlc-value ${trendClass}">${ohlc[3].toFixed(
            2
          )}</span></span>
          `;
        }
        return `<div style="background:rgba(255,255,255,0.85); padding:8px; border-radius:6px; font-size:13px;">
            <div style="font-weight:bold; margin-bottom:4px;">${date}</div>
            <div style="color:#555;">成交量: ${fmtVol(
              volRaw
            )}</div>${techLinesHtml}</div>`;
      },
    },
  };

  // ===== 下方「成交量」圖 =====
  const initChecked = getCheckedIndicators?.() ?? [];
  const initShowMacd = initChecked.some((n) =>
    indicatorGroups.macd.includes(n)
  );
  const initShowKdj = initChecked.some((n) => indicatorGroups.kdj.includes(n));
  const initShowBias = initChecked.some((n) =>
    indicatorGroups.bias.includes(n)
  );
  const optionsVolume = {
    chart: {
      id: "volumePane",
      group: "stockPane",
      type: "bar",
      parentHeightOffset: 0,
      height: 130,
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    plotOptions: { bar: { columnWidth: "70%", borderRadius: 2 } },
    stroke: { width: 0 },
    grid: { padding: GRID_PAD_VOLUME },
    xaxis: buildSharedXAxis(),
    yaxis: makeVolumeYAxes(initShowMacd, initShowKdj, initShowBias),
    dataLabels: { enabled: false },
    tooltip: {
      enabled: true,
      shared: false,
      intersect: true,
      custom: () => "",
    },
    states: {
      normal: { filter: { type: "none", value: 0 } },
      hover: { filter: { type: "darken", value: 0.55 } },
      active: { filter: { type: "darken", value: 0.55 } },
    },
    series: [{ name: "Volume", type: "bar", data: volData }],
  };

  window.priceChartInst = new ApexCharts(
    document.querySelector("#priceChart"),
    optionsPrice
  );
  window.volumeChartInst = new ApexCharts(
    document.querySelector("#volumeChart"),
    optionsVolume
  );

  // Render 並等待完成
  await Promise.all([
    window.priceChartInst.render(),
    window.volumeChartInst.render(),
  ]);

  chart = window.priceChartInst;
  syncXAxes();
  ensureVolumeAxis();

  // 技術指標更新邏輯
  const indicatorFieldMap = {
    Sma_5: "Sma_5",
    Sma_10: "Sma_10",
    Sma_20: "Sma_20",
    Sma_60: "Sma_60",
    Sma_120: "Sma_120",
    Sma_240: "Sma_240",
    DIF: "DIF",
    DEA: "DEA",
    K: "K",
    D: "D",
    J: "J",
    Bias: "Bias",
  };

  window.updateIndicatorsFromChecked = () => {
    const checked = Array.from(
      document.querySelectorAll(".indicator-check:checked")
    ).map((cb) => cb.value);

    // 1) 主 K 線（用 currentCandleData，可能包含未來30天）
    let newSeries = [
      { name: "K線圖", type: "candlestick", data: currentCandleData },
    ];

    // 2) 判斷哪些右側指標被勾選
    const showMacd = checked.some((n) => indicatorGroups.macd.includes(n));
    const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
    const showBias = checked.some((n) => indicatorGroups.bias.includes(n));

    let rightAxisCount = 0;
    if (showMacd) rightAxisCount++;
    if (showKdj) rightAxisCount++;
    if (showBias) rightAxisCount++;

    const axisWidth = 55;
    const baseVolRightPad = -25;
    const newVolRightPad = baseVolRightPad + rightAxisCount * axisWidth;

    // 3) 技術線 series
    const indicatorFieldMap = {
      Sma_5: "Sma_5",
      Sma_10: "Sma_10",
      Sma_20: "Sma_20",
      Sma_60: "Sma_60",
      Sma_120: "Sma_120",
      Sma_240: "Sma_240",
      DIF: "DIF",
      DEA: "DEA",
      K: "K",
      D: "D",
      J: "J",
      Bias: "Bias",
    };

    checked.forEach((name) => {
      const field = indicatorFieldMap[name];
      if (!field) return;
      const dataSeries = window.stockData.map((row, idx) => ({
        x: window.tradingDates[idx],
        y: row[field] != null ? parseFloat(row[field]) : null,
      }));
      let yAxisIndex = 0;
      if (indicatorGroups.macd.includes(name)) yAxisIndex = 1;
      else if (indicatorGroups.kdj.includes(name)) yAxisIndex = 2;
      else if (indicatorGroups.bias.includes(name)) yAxisIndex = 3;

      newSeries.push({
        name,
        type: "line",
        data: dataSeries,
        yAxisIndex,
        color: indicatorColors[name] || "#000",
      });
    });

    // 4) 進階條件點（scatter）→ 對齊每一根 K 棒
    if (conditionMarkPoints.length > 0 && window.tradingDates?.length) {
      // conditionMarkPoints 現在是 [{ x: '2025-06-04', y, label }, ...]
      const condMap = new Map();
      conditionMarkPoints.forEach((pt) => {
        const key = normalizeDateKey(pt.x); // 保險一點，一律用 YYYY-MM-DD
        if (!key) return;
        condMap.set(key, { y: pt.y, label: pt.label });
      });

      // 依照 tradingDates 的順序展開成完整長度的陣列
      const condSeriesData = window.tradingDates.map((d) => {
        const key = normalizeDateKey(d);
        const rec = condMap.get(key);
        if (!rec) {
          return { x: d, y: null }; // 這天沒有條件點
        }
        return { x: d, y: rec.y, label: rec.label };
      });

      newSeries.push({
        name: "條件點",
        type: "scatter",
        data: condSeriesData,
        yAxisIndex: 0,
        color: "#9C27B0", // 進階條件點：紫色，避免和紅綠買賣點混在一起
      });
    }

    // 5) Buy / Sell 點（scatter）→ 同樣對齊每一根 K 棒
    if (buySignalPoints.length > 0 && window.tradingDates?.length) {
      const buyMap = new Map();
      // buySignalPoints 是 [{ x: '2025-06-04', y }, ...]
      buySignalPoints.forEach((pt) => {
        const key = normalizeDateKey(pt.x);
        if (!key) return;
        buyMap.set(key, pt.y);
      });

      const buySeriesData = window.tradingDates.map((d) => {
        const key = normalizeDateKey(d);
        const y = buyMap.has(key) ? buyMap.get(key) : null;
        return { x: d, y };
      });

      newSeries.push({
        name: "Buy",
        type: "scatter",
        data: buySeriesData,
        yAxisIndex: 0,
        color: "#D50000",
      });
    }

    if (sellSignalPoints.length > 0 && window.tradingDates?.length) {
      const sellMap = new Map();
      sellSignalPoints.forEach((pt) => {
        const key = normalizeDateKey(pt.x);
        if (!key) return;
        sellMap.set(key, pt.y);
      });

      const sellSeriesData = window.tradingDates.map((d) => {
        const key = normalizeDateKey(d);
        const y = sellMap.has(key) ? sellMap.get(key) : null;
        return { x: d, y };
      });

      newSeries.push({
        name: "Sell",
        type: "scatter",
        data: sellSeriesData,
        yAxisIndex: 0,
        color: "#00C853",
      });
    }

    // 6) 先更新 series
    chart.updateSeries(newSeries, false);

    // === 6-1 標記大小：線不要點、Buy/Sell 大一點 ===
    const markerSizeArray = newSeries.map((s) => {
      if (s.type === "candlestick") return 0; // K 線不用 marker
      if (s.name === "條件點") return 4;
      if (s.name === "Buy" || s.name === "Sell") return 4;
      return 0;
    });

    // === 6-2 找出每個 series「第一個有值的點」index，只在那個點顯示 label ===
    const firstLabelIndexMap = {}; // key: seriesIndex -> dataPointIndex

    newSeries.forEach((s, seriesIndex) => {
      if (s.name !== "條件點" && s.name !== "Buy" && s.name !== "Sell") {
        return;
      }
      const dataArr = Array.isArray(s.data) ? s.data : [];
      const firstIdx = dataArr.findIndex(
        (pt) => pt && pt.y != null && !Number.isNaN(pt.y)
      );
      if (firstIdx >= 0) {
        firstLabelIndexMap[seriesIndex] = firstIdx;
      }
    });

    // 哪些 series 要顯示 label：只要有第一個點，就啟用
    const labelSeriesIndices = Object.keys(firstLabelIndexMap).map((k) =>
      Number(k)
    );

    chart.updateOptions(
      {
        yaxis: [
          { ...chart.w.config.yaxis[0], show: true },
          { ...chart.w.config.yaxis[1], show: showMacd },
          { ...chart.w.config.yaxis[2], show: showKdj },
          { ...chart.w.config.yaxis[3], show: showBias },
        ],
        markers: {
          size: markerSizeArray,
          shape: "circle",
        },
        dataLabels: {
          enabled: labelSeriesIndices.length > 0,
          enabledOnSeries: labelSeriesIndices,
          offsetY: -10,
          formatter: function (val, opts) {
            const seriesIndex = opts.seriesIndex;
            const firstIdx = firstLabelIndexMap[seriesIndex];

            // 沒設定第一個點，或不是第一個點 → 不顯示
            if (firstIdx == null || opts.dataPointIndex !== firstIdx) {
              return "";
            }

            const sName = opts.w.globals.seriesNames[seriesIndex];
            const seriesData = opts.w.config.series[seriesIndex].data || [];
            const pt = seriesData[opts.dataPointIndex];

            if (!pt || pt.y == null || Number.isNaN(pt.y)) {
              return "";
            }

            // === 真正要顯示的文字內容 ===
            if (sName === "條件點") {
              return pt.label || "";
            }
            if (sName === "Buy") return "Buy";
            if (sName === "Sell") return "Sell";
            return "";
          },
          style: {
            fontSize: "11px",
            fontWeight: 600,
          },
        },
      },
      false,
      false
    );

    // 7) 下方成交量圖：y 軸結構跟上面同步，但把右邊軸藏起來，只留下同樣寬度
    ApexCharts.exec(
      "volumePane",
      "updateOptions",
      {
        yaxis: makeVolumeYAxes(showMacd, showKdj, showBias),
      },
      false,
      false
    );
  };

  document.querySelectorAll(".indicator-check").forEach((checkbox) => {
    checkbox.onchange = window.updateIndicatorsFromChecked;
  });

  if (showPeriods) addPeriodSeparators();
}

async function toggleFuture30Days() {
  console.log("toggleFuture30Days called, future30Added =", future30Added);
  const futureBtn = document.getElementById("future30Btn");

  // ========== 第一次按：加入未來 30 天 ==========
  if (!future30Added) {
    if (!window.stockData || !window.tradingDates || !window.stockData.length) {
      alert("請先載入股票歷史資料");
      return;
    }

    const symbol = getSymbol();
    const resp = await fetch(
      `${API_BASE}/prediction?symbol=${encodeURIComponent(symbol)}`
    );
    if (!resp.ok) {
      alert("預測資料取得失敗");
      return;
    }

    const raw = await resp.text();
    let pred;
    try {
      pred = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("預測 API 回傳的不是合法 JSON：", e);
      alert("預測 API 回傳的不是合法 JSON，請先檢查後端回傳格式。");
      return;
    }

    const predictions = pred?.predictions || [];
    if (!predictions.length) {
      alert("此股票目前沒有未來30天預測資料");
      return;
    }

    // 記住原本的 X 軸 & zoom 範圍（之後移除時要用）
    originalTradingDates = [...window.tradingDates];
    originalZoomRange = getCurrentXRange();

    const lastRow = window.stockData[window.stockData.length - 1];
    const baseClose = parseFloat(lastRow.close);

    const futureCandles = buildFutureCandlesFromDir(predictions, baseClose);
    const futureDates = predictions.map((p) => p.date);

    // 🔹 更新全域資料：把未來30天接到主 K 棒 & X 軸日期
    currentCandleData = baseCandleData.concat(futureCandles);
    window.tradingDates = originalTradingDates.concat(futureDates);

    // 🔹 更新上下兩張圖的 X 軸
    ApexCharts.exec(
      "pricePane",
      "updateOptions",
      { xaxis: buildSharedXAxis() },
      false,
      true
    );
    ApexCharts.exec(
      "volumePane",
      "updateOptions",
      { xaxis: buildSharedXAxis() },
      false,
      true
    );
    syncXAxes();

    // 🔹 用新的 currentCandleData 重畫一次 series
    if (typeof window.updateIndicatorsFromChecked === "function") {
      window.updateIndicatorsFromChecked();
    }

    // 🔹 視窗往右多開 30 根
    const range = originalZoomRange || getCurrentXRange();
    if (range) {
      const extra = futureDates.length;
      ApexCharts.exec("pricePane", "zoomX", range.min, range.max + extra);
      ApexCharts.exec("volumePane", "zoomX", range.min, range.max + extra);
    }

    future30Added = true;
    if (futureBtn) {
      futureBtn.textContent = "移除未來30天";
      futureBtn.classList.add("active");
    }
    console.log("✔ 已加入未來30天預測 K 棒");
    return;
  }

  // ========== 第二次按：移除未來 30 天 ==========
  // 還原 K 棒跟 X 軸
  currentCandleData = baseCandleData.slice();
  if (originalTradingDates) {
    window.tradingDates = [...originalTradingDates];
  }

  ApexCharts.exec(
    "pricePane",
    "updateOptions",
    { xaxis: buildSharedXAxis() },
    false,
    true
  );
  ApexCharts.exec(
    "volumePane",
    "updateOptions",
    { xaxis: buildSharedXAxis() },
    false,
    true
  );
  syncXAxes();

  // 用還原後的 currentCandleData 重畫一次
  if (typeof window.updateIndicatorsFromChecked === "function") {
    window.updateIndicatorsFromChecked();
  }

  // 還原 zoom 範圍
  if (originalZoomRange) {
    ApexCharts.exec(
      "pricePane",
      "zoomX",
      originalZoomRange.min,
      originalZoomRange.max
    );
    ApexCharts.exec(
      "volumePane",
      "zoomX",
      originalZoomRange.min,
      originalZoomRange.max
    );
  }

  future30Added = false;
  if (futureBtn) {
    futureBtn.textContent = "加入未來30天";
    futureBtn.classList.remove("active");
  }
  console.log("已移除未來30天預測 K 棒");
}

function buildFutureCandlesFromDir(predictions, baseClose) {
  if (!predictions || !predictions.length || !baseClose) return [];

  // 每一個「累積分數」讓價位動 0.8%（你可以自己調）
  const step = baseClose * 0.008;
  let score = 0;

  return predictions.map((p) => {
    let delta = 0; // flat = 0
    if (p.dir === "up") delta = 1;
    else if (p.dir === "down") delta = -1;

    score += delta;

    const center = baseClose + score * step;
    const high = center + step * 0.6;
    const low = center - step * 0.6;

    // 自訂顏色
    let color;
    if (p.dir === "up") color = "#ff0000ff";
    else if (p.dir === "down") color = "#51ff00ff";
    else color = "#bdbdbd";

    return {
      x: p.date,
      y: [high, high, low, low], // [open, high, low, close]
      fillColor: "rgba(255,255,255,0)", // 中間填白色 / 空心
      strokeColor: color, // 外框沿用依 dir 變色
    };
  });
}

// 買賣點：畫在「最低價往下」一點，避免蓋到 K 線
const SIGNAL_MARKER_BELOW_RATIO = 0.96; // 想更低就改成 0.95、0.9...

function getLowPriceBelowByDate(dateStr) {
  if (!window.stockData || !window.tradingDates) return null;

  const targetKey = normalizeDateKey(dateStr);
  if (!targetKey) return null;

  // 用 normalizeDateKey 對齊，而不是 new Date 比 time
  const idx = window.tradingDates.findIndex(
    (d) => normalizeDateKey(d) === targetKey
  );
  if (idx === -1 || !window.stockData[idx]) {
    console.warn(
      "找不到對應日期的 K 棒資料:",
      dateStr,
      "目前圖表區間 =",
      window.tradingDates[0],
      "~",
      window.tradingDates[window.tradingDates.length - 1]
    );
    return null;
  }

  const rec = window.stockData[idx];
  const low = parseFloat(rec.low);
  const close = parseFloat(rec.close);
  const base = Number.isFinite(low) ? low : close;

  if (!Number.isFinite(base)) return null;
  return base * SIGNAL_MARKER_BELOW_RATIO;
}

// 新增：直接用「第幾根 K 棒」來取最低價往下 X，比用 Date 對來得穩
function getLowPriceBelowByIndex(idx) {
  if (!window.stockData || !window.stockData[idx]) return null;

  const rec = window.stockData[idx];
  const low = parseFloat(rec.low);
  const close = parseFloat(rec.close);

  if (Number.isFinite(low)) return low * SIGNAL_MARKER_BELOW_RATIO;
  if (Number.isFinite(close)) return close * SIGNAL_MARKER_BELOW_RATIO;
  return null;
}

function formatVolume(val) {
  if (val == null || isNaN(val)) return "";
  const n = +val;
  if (n >= 1e9) return (n / 1e9).toFixed(0) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(0) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(Math.round(n));
}

function makeVolumeYAxis() {
  const arr = (window.stockData || []).map((r) => +r.volume || 0);
  const vmax = Math.max(1, ...arr);
  const ratio = window.VOL_PAD_TOP_RATIO ?? 0.18;
  return {
    title: { text: "Volume", offsetX: 0 },
    min: 0,
    max: Math.ceil(vmax * (1 + ratio)),
    labels: { offsetX: 5, formatter: formatVolume },
    opposite: false,
  };
}

// 成交量圖用的「四軸版本」，右邊 3 軸只是佔位用
function makeVolumeYAxes(showMacd = false, showKdj = false, showBias = false) {
  const main = makeVolumeYAxis(); // 左邊真正的 Volume 軸

  return [
    main,

    // ---- MACD 佔位軸 ----
    {
      opposite: true,
      show: showMacd,
      tickAmount: 4,
      axisTicks: { show: false },
      axisBorder: { show: false },
      labels: {
        show: true,
        formatter: () => "00.00", // 跟上圖一樣寬度
        style: { colors: ["transparent"] }, // 文字透明，看不到
      },
      title: {
        text: "MACD",
        style: { color: "transparent" }, // 標題也透明，但會占寬
      },
    },

    // ---- KDJ 佔位軸 ----
    {
      opposite: true,
      show: showKdj,
      tickAmount: 4,
      axisTicks: { show: false },
      axisBorder: { show: false },
      labels: {
        show: true,
        formatter: () => "100", // 大概 0~100，寬度跟上面差不多
        style: { colors: ["transparent"] },
      },
      title: {
        text: "KDJ",
        style: { color: "transparent" },
      },
    },

    // ---- Bias 佔位軸 ----
    {
      opposite: true,
      show: showBias,
      tickAmount: 4,
      axisTicks: { show: false },
      axisBorder: { show: false },
      labels: {
        show: true,
        formatter: () => "00.00",
        style: { colors: ["transparent"] },
      },
      title: {
        text: "Bias",
        style: { color: "transparent" },
      },
    },
  ];
}

// X 軸永遠使用目前的 categories（交易日字串）
// function makeXAxisCategories() {
//   return {
//     type: "category",
//     categories: window.tradingDates,
//     tickAmount: Math.min(12, window.tradingDates?.length || 12),
//     tickPlacement: "on", // 兩張圖一致，避免一張在格線上、一張在格線間
//     labels: {
//       show: true, // ← 顯示日期
//       rotate: -45,
//       hideOverlappingLabels: true,
//       offsetY: 6,
//     },
//     axisBorder: { show: true },
//     axisTicks: { show: true },
//     tooltip: { enabled: false },
//   };
// }

function formatDateMMDD(val) {
  if (!val) return "";
  const s = String(val);
  // 期待格式是 YYYY-MM-DD
  if (s.includes("-")) {
    const parts = s.split("-");
    if (parts.length === 3) {
      return `${parts[1].padStart(2, "0")}/${parts[2].padStart(2, "0")}`;
    }
  }
  return s; // 萬一不是這種格式，就原樣顯示
}

function getTickAmountByMonths() {
  const m = window.currentMonths || 3;
  if (m >= 36) return 14;
  if (m >= 12) return 14;
  if (m >= 6) return 12;
  if (m >= 3) return 12;
  return Math.min(10, window.tradingDates?.length || 10); // 1m
}

function buildSharedXAxis() {
  const cats = window.tradingDates || [];
  const len = cats.length;
  return {
    type: "category",
    categories: cats,
    tickAmount: len > 1 ? Math.min(getTickAmountByMonths(), len - 1) : len,
    tickPlacement: "on",
    labels: {
      show: true,
      rotate: 0,
      offsetY: 6,
      hideOverlappingLabels: true,
      formatter: (val) => formatDateMMDD(val), // ⬅ 這行改成 mm/dd
    },
    axisBorder: { show: true },
    axisTicks: { show: true },
    tooltip: { enabled: false },
  };
}

function syncXAxes() {
  const base = buildSharedXAxis(); // mm/dd formatter 版

  // 下方成交量：正常顯示日期 + 虛線
  const volumeXAxis = base;

  // 上方價格圖：保留 x 軸（給月份虛線用），但把日期文字藏起來
  const priceXAxis = {
    ...base,
    labels: {
      ...base.labels,
      show: true, // 一定要 true，x 軸實際存在，虛線才畫得出來
      style: {
        // 文字變透明，就「看起來好像沒有日期」
        colors: ["transparent"],
      },
    },
    axisTicks: {
      ...base.axisTicks,
      show: false, // 不畫小刻度
    },
    axisBorder: {
      ...base.axisBorder,
      show: true, // 要留著，annotation 會靠這條邊界定位
    },
    tooltip: { enabled: false },
  };

  ApexCharts.exec(
    "pricePane",
    "updateOptions",
    { xaxis: priceXAxis },
    false,
    false
  );
  ApexCharts.exec(
    "volumePane",
    "updateOptions",
    { xaxis: volumeXAxis },
    false,
    false
  );
}

function recomputeVolumeAxis() {
  if (!window.volumeChart) return;
  window.volumeChart.updateOptions({ yaxis: makeVolumeYAxis() }, false, false);
}

// function updateVolRatio(value) {
//   VOL_PAD_TOP_RATIO = parseFloat(value);
//   const label = document.getElementById("volRatioValue");
//   if (label) label.textContent = value;

//   if (window.volumeChart && window.stockData) {
//     const arr = (window.stockData || []).map((r) => +r.volume || 0);
//     const vmax = Math.max(1, ...arr);
//     const vmin = 0;
//     const vmaxAdj = Math.ceil(vmax * (1 + VOL_PAD_TOP_RATIO));

//     window.volumeChart.updateOptions(
//       {
//         yaxis: {
//           ...makeVolumeYAxis(), // 保留 title 與 labels.formatter
//           min: vmin,
//           max: vmaxAdj,
//         },
//       },
//       false,
//       false
//     );
//   }
// }

function updateVolRatio(value) {
  VOL_PAD_TOP_RATIO = parseFloat(value);
  const label = document.getElementById("volRatioValue");
  if (label) label.textContent = value;

  if (window.volumeChartInst && window.stockData) {
    const arr = (window.stockData || []).map((r) => +r.volume || 0);
    const vmax = Math.max(1, ...arr);
    const vmin = 0;
    const vmaxAdj = Math.ceil(vmax * (1 + VOL_PAD_TOP_RATIO));

    const main = makeVolumeYAxis();
    main.min = vmin;
    main.max = vmaxAdj;

    window.volumeChartInst.updateOptions(
      {
        yaxis: [
          main,
          { show: false, opposite: true },
          { show: false, opposite: true },
          { show: false, opposite: true },
        ],
      },
      false,
      false
    );
  }
}

let __lastCatsLen = null; // 放在全域

function ensureVolumeAxis() {
  if (!window.stockData) return;

  const checked = getCheckedIndicators?.() ?? [];
  const showMacd = checked.some((n) => indicatorGroups.macd.includes(n));
  const showKdj = checked.some((n) => indicatorGroups.kdj.includes(n));
  const showBias = checked.some((n) => indicatorGroups.bias.includes(n));

  const opt = {
    yaxis: makeVolumeYAxes(showMacd, showKdj, showBias),
    tooltip: { y: { formatter: formatVolume } },
  };

  ApexCharts.exec("volumePane", "updateOptions", opt, false, false);
}

function toggleCustomDate() {
  const div = document.getElementById("customDateRange");
  const btn = document.querySelector(".calendar-btn"); // 日曆那顆
  if (!div || !btn) return;

  console.log("toggleCustomDate fired");

  const isHidden = window.getComputedStyle(div).display === "none";

  if (isHidden) {
    // 顯示出來，先讓瀏覽器算出寬度
    div.style.display = "flex";
    div.style.position = "fixed";
    div.style.zIndex = "9999";
    div.style.flexDirection = "column";
    div.style.alignItems = "stretch";
    div.style.gap = "8px";

    div.style.padding = "8px 12px";
    div.style.backgroundColor = "#ffffff";
    div.style.borderRadius = "8px";
    div.style.border = "1px solid #ddd";
    div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";

    // 算出日曆按鈕位置 & 卡片寬度
    const btnRect = btn.getBoundingClientRect();
    const cardRect = div.getBoundingClientRect();

    // 讓「卡片右邊」對齊「日曆按鈕右邊」
    let left = btnRect.right - cardRect.width;

    // 最多貼齊畫面左邊，不要跑出去
    left = Math.max(left, 8);

    div.style.top = btnRect.bottom + 6 + "px";
    div.style.left = left + "px";
  } else {
    div.style.display = "none";
  }
}

// 時間功能列
function setActive(el, range) {
  document
    .querySelectorAll(".time-range-item")
    .forEach((item) => item.classList.remove("active"));
  el.classList.add("active");

  // 切換其它區間時，先收起自訂時間
  const customDiv = document.getElementById("customDateRange");
  if (customDiv) {
    customDiv.style.display = "none"; // 切換區間時就把懸浮框收起來
  }

  loadStockWithRange(getSymbol(), range).then(() => {
    let months = 3;
    if (range === "1m") months = 1;
    else if (range === "3m") months = 3;
    else if (range === "6m") months = 6;
    else if (range === "1y") months = 12;
    else if (range === "3y") months = 36;
    else if (range === "5d") months = 1;
    else if (range === "ytd") months = 12;

    currentMonths = months;
    window.currentMonths = months; // ★ 確保全域也有值

    if (showPeriods) {
      addPeriodSeparators();
    }
    // ensureVolumeAxis / syncXAxes 已在 displayStockData render 完後呼叫
  });
}

// ====== 時間區隔線 ======
// ====== 實際月份切割：在每個「月份第一次出現的 K 棒」畫線 (價格 + 成交量都畫) ======
// BUG : 三年的 2024 2025 會疊再一起 其他正常
function addPeriodSeparators() {
  if (
    !window.priceChartInst ||
    !window.volumeChartInst ||
    !window.tradingDates ||
    window.tradingDates.length === 0
  ) {
    console.warn("[addPeriodSeparators] charts 或 tradingDates 還沒準備好");
    return;
  }

  const cats = window.tradingDates; // ['2022-10-03', '2022-10-04', ...]
  const monthFirstList = [];
  let lastYM = null; // 'YYYY-MM'

  // > 12 個月就切換成「年份模式」
  const months =
    typeof currentMonths === "number"
      ? currentMonths
      : typeof window.currentMonths === "number"
      ? window.currentMonths
      : 3;

  const useYearMode = months > 12;

  // 先找出每個月份第一根 K 棒的 index（在 tradingDates 裡的 index）
  for (let idx = 0; idx < cats.length; idx++) {
    const raw = cats[idx];
    const key = normalizeDateKey(raw); // 統一成 YYYY-MM-DD
    if (!key) continue;

    const ym = key.slice(0, 7); // 'YYYY-MM'
    const dayStr = key.slice(8, 10); // 'DD'
    const day = parseInt(dayStr, 10);

    if (ym !== lastYM) {
      lastYM = ym;

      // 規則：最左邊第一根，如果不是當月 1~5 號，就不要畫這個月的分隔線
      if (!useYearMode && idx === 0 && !(day >= 1 && day <= 5)) {
        continue; // 不 push 這個月
      }

      monthFirstList.push({ idx, ym });
    }
  }

  if (monthFirstList.length === 0) {
    console.log("[addPeriodSeparators] monthFirstList 空的");
    return;
  }

  // ===== 決定這次要畫哪些點 & label 形式 =====
  let listForLabels = monthFirstList;
  let isSingleYear = false;
  let labelYearOnly = false;

  if (useYearMode) {
    // 🔹年份模式：先保留「每年第一次出現」那一筆
    const yearSeen = new Set();
    let yearList = [];
    monthFirstList.forEach((m) => {
      const year = m.ym.slice(0, 4);
      if (!yearSeen.has(year)) {
        yearSeen.add(year);
        yearList.push({ ...m, year }); // m.ym 例如 '2022-10'
      }
    });

    // 如果有至少兩個年份，檢查第一年是不是「不完整年份」
    // 只要第一年的第一個月份不是 01，就把第一年丟掉
    if (yearList.length >= 2) {
      const first = yearList[0]; // { ym: '2022-10', year: '2022', ... }
      const firstMonth = first.ym.slice(5, 7); // '10'
      if (firstMonth !== "01") {
        yearList = yearList.slice(1); // 丟掉第一年，只留後面幾年
      }
    }

    listForLabels = yearList;
    labelYearOnly = true; // label 只顯示年分
  } else {
    // 🔹月份模式：照你原本的 isSingleYear 規則
    const yearSet = new Set(monthFirstList.map((m) => m.ym.slice(0, 4)));
    isSingleYear = yearSet.size === 1;
  }

  console.log("[addPeriodSeparators] useYearMode =", useYearMode);
  console.log("[addPeriodSeparators] listForLabels =", listForLabels);

  // 💡 helper：根據當前圖表狀態，決定這個 idx 要用哪個 X 值
  function getXForIdx(inst, idx) {
    const w = inst.w;
    const catsForChart = w.globals.categoryLabels || [];
    const totalCats = catsForChart.length;
    const totalDates = window.tradingDates.length;

    // 1) 如果 categoryLabels 跟 tradingDates 長度一樣，
    //    代表 index 一致，可以直接用 categoryLabels[idx]
    if (
      Array.isArray(catsForChart) &&
      totalCats > idx &&
      totalCats === totalDates
    ) {
      return catsForChart[idx];
    }

    // 2) 否則，改用 seriesX（通常是 3 年 / YTD 這種被裁切過的情況）
    if (
      w.globals.seriesX &&
      w.globals.seriesX[0] &&
      w.globals.seriesX[0].length > idx
    ) {
      return w.globals.seriesX[0][idx];
    }

    // 3) 最後的備援，再試一次 categoryLabels
    if (Array.isArray(catsForChart) && catsForChart.length > idx) {
      return catsForChart[idx];
    }

    return null;
  }

  // 對「一張圖」套用月份/年份分隔線的 helper
  function applySeparatorsToChart(inst) {
    if (!inst) return;

    const w = inst.w;
    const existing = w.config.annotations || {};
    const existingPoints = Array.isArray(existing.points)
      ? existing.points
      : [];
    const existingXaxis = Array.isArray(existing.xaxis)
      ? existing.xaxis.filter(
          (x) => !(x.cssClass || "").includes("period-separator")
        )
      : [];

    const separators = listForLabels
      .map((m, idxInList) => {
        const xVal = getXForIdx(inst, m.idx); // ⭐ 不管一年或三年都走同一個 helper
        if (xVal == null) return null;

        let labelText;

        if (labelYearOnly) {
          // ===== 年份模式：只畫「第一次出現的年分」，label = 年 =====
          labelText = String(m.year || m.ym.slice(0, 4));
        } else {
          // ===== 月份模式（維持你原本的邏輯）=====
          const [year, month] = m.ym.split("-"); // '2025', '09'
          if (isSingleYear) {
            // 同一年：第一條線顯示年+月，其餘只顯示月
            labelText = idxInList === 0 ? `${year}/${month}` : month;
          } else {
            // 跨年份：只在一月顯示年+月，其餘只顯示月
            labelText = month === "01" ? `${year}/${month}` : month;
          }
        }

        return {
          x: xVal,
          xAxisIndex: 0,
          strokeDashArray: 4,
          borderColor: "#B0BEC5",
          cssClass: "period-separator",
          label: {
            text: labelText,
            orientation: "horizontal",
            offsetY: -10, // 想高一點可以再調
            borderColor: "transparent", // 不要外框線
            style: {
              fontSize: "11px",
              color: "#000000", // 純黑
              background: "transparent", // 拿掉灰底
            },
            cssClass: "period-label",
          },
        };
      })
      .filter(Boolean);

    inst.updateOptions(
      {
        annotations: {
          xaxis: existingXaxis.concat(separators),
          points: existingPoints,
        },
      },
      false,
      false
    );
  }

  // 價格圖 + 成交量圖都套用
  applySeparatorsToChart(window.priceChartInst);
  applySeparatorsToChart(window.volumeChartInst);
}

// 顯示/關閉「時間區隔」的按鈕
function togglePeriods() {
  showPeriods = !showPeriods;

  const btn = document.getElementById("togglePeriodsBtn");
  if (btn) {
    btn.classList.toggle("active", showPeriods);
    btn.textContent = showPeriods ? "關閉區隔" : "顯示區隔";
  }

  if (!window.priceChartInst || !window.volumeChartInst) return;

  if (showPeriods) {
    // 打開 → 依照 currentMonths 把區隔線畫出來
    addPeriodSeparators();
  } else {
    // 關閉 → 把 period 的標註拿掉，但保留條件點等其他 annotations
    function clearSeparators(inst) {
      if (!inst) return;
      const w = inst.w;
      const existing = w.config.annotations || {};
      const existingPoints = Array.isArray(existing.points)
        ? existing.points
        : [];
      const existingXaxis = Array.isArray(existing.xaxis) ? existing.xaxis : [];

      const preservedPoints = existingPoints.filter((p) => {
        const css = p.label?.cssClass || "";
        return !css.includes("period-label");
      });

      const preservedXaxis = existingXaxis.filter((x) => {
        const css = x.cssClass || "";
        return !css.includes("period-separator");
      });

      inst.updateOptions(
        {
          annotations: {
            xaxis: preservedXaxis,
            points: preservedPoints,
          },
        },
        false,
        false
      );
    }

    clearSeparators(window.priceChartInst);
    clearSeparators(window.volumeChartInst);
  }
}

// 畫圖
function makeAnnotation(time, label, color = "#FF4560") {
  return {
    x: new Date(time).getTime(),
    borderColor: color,
    label: {
      borderColor: color,
      style: {
        color: "#fff",
        background: color,
        fontSize: "12px",
        padding: "2px 4px",
      },
      text: label,
      orientation: "horizontal",
      offsetY: 20,
    },
  };
}
const symbolInput = document.getElementById("symbolInput");
const suggestions = document.getElementById("suggestions");

if (symbolInput) {
  symbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const text = symbolInput.value.trim();
      if (text) {
        // 直接當成股票代碼查詢（你也可以先轉成大寫）
        selectSymbol(text.toUpperCase());
      }

      // 查完就收起膠囊、顯示回放大鏡
      const searchContainer = document.getElementById("searchContainer");
      const searchToggle = document.getElementById("searchToggle");
      if (searchContainer) searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";

      // 把建議清掉
      if (suggestions) suggestions.style.display = "none";

      // 按 Enter 查詢時，一併確保自訂日期 / 控制面板關掉
      const customDiv = document.getElementById("customDateRange");
      if (customDiv) customDiv.style.display = "none";
      const controlPanel = document.getElementById("controlPanel");
      if (controlPanel) controlPanel.classList.remove("open");
    } else if (e.key === "Escape") {
      // 按 Esc 也可以關閉搜尋框，不查詢
      const searchContainer = document.getElementById("searchContainer");
      const searchToggle = document.getElementById("searchToggle");
      if (searchContainer) searchContainer.classList.add("hidden");
      if (searchToggle) searchToggle.style.display = "flex";
      if (suggestions) suggestions.style.display = "none";
    }
  });
}

// 輸入時：模糊搜尋
symbolInput.addEventListener("input", async (e) => {
  const keyword = e.target.value.trim();
  if (!keyword) {
    suggestions.style.display = "none";
    return;
  }
  try {
    const resp = await fetch(
      `${API_BASE}/suggest?q=${encodeURIComponent(keyword)}&limit=10`
    );
    if (!resp.ok) throw new Error("suggest failed");
    const data = await resp.json();
    renderSuggestions(data);
  } catch (err) {
    suggestions.innerHTML = `<div style='padding:8px;'>查詢失敗</div>`;
    suggestions.style.display = "block";
  }
});

// 聚焦時：抓前 10 筆熱門（或後端回任意 10 筆）
symbolInput.addEventListener("focus", async () => {
  try {
    const resp = await fetch(`${API_BASE}/suggest?limit=29`);
    if (!resp.ok) throw new Error("suggest failed");
    const data = await resp.json();
    renderSuggestions(data);
  } catch (err) {
    suggestions.innerHTML = `<div style='padding:8px;'>查詢失敗</div>`;
    suggestions.style.display = "block";
  }
});

function renderSuggestions(data, error) {
  if (error || !data || data.length === 0) {
    suggestions.innerHTML = `<div style='padding:8px;'>無符合股票</div>`;
    suggestions.style.display = "block";
    return;
  }

  suggestions.innerHTML = data
    .map((item) => {
      const nameDisplay =
        item.name_zh ||
        item.name_en ||
        item.short_name_zh ||
        item.short_name_en ||
        "";
      return `<div style='padding:8px; cursor:pointer' onclick='selectSymbol("${item.symbol}")'>
                ${item.symbol} - ${nameDisplay}
              </div>`;
    })
    .join("");
  suggestions.style.display = "block";
}

document.addEventListener("click", function (event) {
  const suggestionsDiv = document.getElementById("suggestions");
  const input = document.getElementById("symbolInput");
  if (!suggestionsDiv.contains(event.target) && event.target !== input) {
    suggestionsDiv.style.display = "none";
  }
});

// =============================
// 進階條件拖曳式 Builder
// =============================

// 所有條件句都放在這個陣列裡
let conditionRows = [];
let conditionRowIdSeq = 1;

function createEmptyConditionRow() {
  return {
    id: conditionRowIdSeq++,
    left: null, // { field: "Sma_5", label: "SMA 5" }
    // 預設改成「突破」（crossAbove）
    operator: "crossAbove", // "crossAbove", "crossBelow", ">", "<", ">=", "<="
    right: null, // { field, label } 或 null
    numberValue: null, // 若使用 > < >= <= 時，右邊用這個數值
  };
}

// 取目前 builder 狀態（換時間區間時暫存用）
function getBuilderState() {
  return conditionRows.map((r) => ({
    id: r.id,
    left: r.left ? { ...r.left } : null,
    operator: r.operator,
    right: r.right ? { ...r.right } : null,
    numberValue: r.numberValue,
  }));
}

// 還原 builder 狀態並重畫 UI
function restoreBuilderState(rows) {
  if (Array.isArray(rows) && rows.length > 0) {
    conditionRows = rows.map((r) => ({ ...r }));
    const ids = conditionRows.map((r) => r.id);
    conditionRowIdSeq = (ids.length ? Math.max(...ids) : 0) + 1;
  } else {
    conditionRows = [createEmptyConditionRow()];
  }
  renderConditionRows();
}

// 把 conditionRows 畫到右邊的 #conditionRowsContainer
function renderConditionRows() {
  const container = document.getElementById("conditionRowsContainer");
  if (!container) return;

  container.innerHTML = "";

  // 依照運算子決定「右邊是拖曳 or 數值」
  function applyOperatorLayout(row, rowEl) {
    const opSelect = rowEl.querySelector(".op-select");
    const rightSlot = rowEl.querySelector('.drop-slot[data-side="right"]');
    const valueInput = rowEl.querySelector(".value-input");
    if (!opSelect || !rightSlot || !valueInput) return;

    const op = row.operator || "crossAbove";
    const isCross = op === "crossAbove" || op === "crossBelow";

    if (isCross) {
      // 突破 / 跌破：第二框是拖曳指標
      rightSlot.style.display = "inline-block";
      valueInput.style.display = "none";
    } else {
      // > < >= <=：第二框改成數值輸入
      rightSlot.style.display = "none";
      valueInput.style.display = "inline-block";

      // 比較模式只吃數值 → 把右邊指標清掉，避免 label 混亂
      row.right = null;
    }
  }

  conditionRows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "rule-row";
    rowEl.dataset.id = String(row.id);

    const leftLabel = row.left?.label || "指標 A";
    const rightLabel = row.right?.label || "指標 B";

    rowEl.innerHTML = `
      <div class="drop-slot ${row.left ? "filled" : ""}" data-side="left">
        ${leftLabel}
      </div>
      <select class="op-select">
        <option value="crossAbove">突破</option>
        <option value="crossBelow">跌破</option>
        <option value=">">&gt;</option>
        <option value="<">&lt;</option>
        <option value=">=">&gt;=</option>
        <option value="<=">&lt;=</option>
      </select>
      <div class="drop-slot ${row.right ? "filled" : ""}" data-side="right">
        ${rightLabel}
      </div>
      <input type="number" class="value-input" placeholder="輸入數值" />
      <button type="button" class="delete-row-btn" title="刪除此條件">✕</button>
    `;

    // 運算子 select
    const opSelect = rowEl.querySelector(".op-select");
    opSelect.value = row.operator || "crossAbove";
    opSelect.addEventListener("change", () => {
      row.operator = opSelect.value;
      applyOperatorLayout(row, rowEl);
    });

    // 數值輸入
    const valueInput = rowEl.querySelector(".value-input");
    if (typeof row.numberValue === "number" && !Number.isNaN(row.numberValue)) {
      valueInput.value = row.numberValue;
    }
    valueInput.addEventListener("input", () => {
      const v = valueInput.value;
      row.numberValue = v === "" ? null : parseFloat(v);
    });

    // 刪除這一行
    const delBtn = rowEl.querySelector(".delete-row-btn");
    delBtn.addEventListener("click", () => {
      conditionRows = conditionRows.filter((r) => r.id !== row.id);
      if (conditionRows.length === 0) {
        conditionRows.push(createEmptyConditionRow());
      }
      renderConditionRows();
    });

    container.appendChild(rowEl);

    // 依 operator 套 layout（決定右邊顯示誰）
    applyOperatorLayout(row, rowEl);
  });
}

// 初始化拖曳事件：chip 拖曳 + drop slot 接收
function initConditionDragAndDrop() {
  // 左邊指標 chip：dragstart
  document.querySelectorAll(".rule-chip").forEach((chip) => {
    chip.addEventListener("dragstart", (e) => {
      const payload = {
        type: chip.dataset.type || "indicator",
        field: chip.dataset.field,
        label: chip.textContent.trim(),
      };
      e.dataTransfer.setData("application/json", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
    });
  });

  // drop-slot：用事件委派掛在 controlPanel 上
  const panel = document.getElementById("controlPanel");
  if (!panel) return;

  panel.addEventListener("dragover", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    slot.classList.add("drag-over");
  });

  panel.addEventListener("dragleave", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    slot.classList.remove("drag-over");
  });

  panel.addEventListener("drop", (e) => {
    const slot = e.target.closest(".drop-slot");
    if (!slot) return;
    e.preventDefault();
    slot.classList.remove("drag-over");

    const json = e.dataTransfer.getData("application/json");
    if (!json) return;

    let data;
    try {
      data = JSON.parse(json);
    } catch {
      return;
    }
    if (!data.field) return;

    const rowEl = slot.closest(".rule-row");
    if (!rowEl) return;
    const rowId = Number(rowEl.dataset.id);
    const row = conditionRows.find((r) => r.id === rowId);
    if (!row) return;

    const side = slot.dataset.side; // "left" or "right"
    row[side] = { field: data.field, label: data.label };

    if (side === "right") {
      // ★ 右邊也拖進來 → 變成「兩邊都是指標」，自動切到「上穿」模式
      row.numberValue = null;
      row.operator =
        row.operator === "crossBelow" || row.operator === "crossAbove"
          ? row.operator
          : "crossAbove";
    } else if (side === "left") {
      // 左邊剛拖進來，先給個預設比較符號
      if (!row.operator) {
        row.operator = ">";
      }
    }

    // 交給 renderConditionRows 重新畫 UI（右側要變成拖曳 or 數值）
    renderConditionRows();
  });
}

// 在第 i 根 K 線上，判斷「單一句」條件是否成立（簡化版）
function evaluateConditionRowAtIndex(row, i) {
  if (!window.stockData || !window.stockData[i]) return false;
  const rec = window.stockData[i];

  if (!row || !row.left || !row.left.field) return false;

  const op = row.operator || "crossAbove";
  const leftField = row.left.field;

  // === 突破 / 跌破：偵測「左指標」與「右指標」交叉 ===
  if (
    (op === "crossAbove" || op === "crossBelow") &&
    row.right &&
    row.right.field
  ) {
    if (i === 0 || !window.stockData[i - 1]) return false;

    const prev = window.stockData[i - 1];

    const lPrev = parseFloat(prev[leftField]);
    const lNow = parseFloat(rec[leftField]);
    const rPrev = parseFloat(prev[row.right.field]);
    const rNow = parseFloat(rec[row.right.field]);

    if (
      !Number.isFinite(lPrev) ||
      !Number.isFinite(lNow) ||
      !Number.isFinite(rPrev) ||
      !Number.isFinite(rNow)
    ) {
      return false;
    }

    if (op === "crossAbove") {
      // 昨天在下方 / 重疊，今天往上突破
      return lPrev <= rPrev && lNow > rNow;
    } else {
      // crossBelow：昨天在上方 / 重疊，今天往下跌破
      return lPrev >= rPrev && lNow < rNow;
    }
  }

  // === 一般比較：左指標 vs 固定數值 ===
  const leftVal = parseFloat(rec[leftField]);
  if (!Number.isFinite(leftVal)) return false;

  let rightVal = null;

  if (typeof row.numberValue === "number" && !Number.isNaN(row.numberValue)) {
    rightVal = row.numberValue;
  } else {
    // 沒有填數值就不成立
    return false;
  }

  if (!Number.isFinite(rightVal)) return false;

  switch (op) {
    case ">":
      return leftVal > rightVal;
    case "<":
      return leftVal < rightVal;
    case ">=":
      return leftVal >= rightVal;
    case "<=":
      return leftVal <= rightVal;
    default:
      return false;
  }
}

// 進階條件：畫在「最高價往上」一點
const CONDITION_MARKER_ABOVE_RATIO = 1.02; // 想更高可以 1.05、1.1

function getHighPriceAbove(rec) {
  if (!rec) return null;
  const high = parseFloat(rec.high);
  const close = parseFloat(rec.close);
  const base = Number.isFinite(high) ? high : close;
  if (!Number.isFinite(base)) return null;
  return base * CONDITION_MARKER_ABOVE_RATIO;
}

// 套用進階條件：只看「第一條有左邊指標的句子」，畫出符合的點（改成 scatter）
// 套用進階條件：支援多條件 + AND / OR
function applyConditionBuilder(silent = false) {
  console.log("[applyConditionBuilder] start (scatter)", conditionRows);

  if (!window.stockData || !window.tradingDates) {
    console.warn("stockData 或 tradingDates 還沒準備好");
    return;
  }

  // 1. 讀取 AND / OR 選項
  const logicInput = document.getElementById("globalLogic");
  const globalLogic = (logicInput?.value || "AND").toUpperCase(); // 預設 AND

  // 2. 把有左邊指標的條件全部抓出來
  const effectiveRows = conditionRows.filter((r) => r.left && r.left.field);

  // 沒有任何條件 → 清空點
  // 沒有任何條件 → 清空點 & 關掉提示文字
  if (effectiveRows.length === 0) {
    conditionMarkPoints = [];

    const noHitEl = document.getElementById("conditionNoHitMsg");
    if (noHitEl) {
      noHitEl.textContent = "";
      noHitEl.style.display = "none";
    }

    if (typeof window.updateIndicatorsFromChecked === "function") {
      window.updateIndicatorsFromChecked();
    }
    return;
  }
  const markers = [];
  // 3. 逐根 K 線檢查所有條件
  for (let i = 0; i < window.stockData.length; i++) {
    const rec = window.stockData[i];
    if (!rec) continue;

    // 這根 K 線上，有哪些條件成立？
    const matchedRows = [];
    for (const row of effectiveRows) {
      try {
        if (evaluateConditionRowAtIndex(row, i)) {
          matchedRows.push(row);
        }
      } catch (e) {
        console.warn("evaluateConditionRowAtIndex error", e, row, i);
      }
    }

    // 根據 globalLogic 決定這一根要不要畫點
    let isHit = false;
    if (globalLogic === "OR") {
      isHit = matchedRows.length > 0; // 任一條成立
    } else {
      isHit = matchedRows.length === effectiveRows.length; // AND：全部成立
    }

    if (!isHit) continue;

    const xCat = window.tradingDates[i];
    const yVal = getHighPriceAbove(rec); // ★ 用最高價往上 X%
    if (yVal == null) continue;

    // 用來組 label 的條件集合
    const usedRows = globalLogic === "OR" ? matchedRows : effectiveRows;

    // 4. 組 label：「SMA5 突破 SMA20 且 收盤價 > 150」
    const labelParts = usedRows.map((row) => {
      const leftText = row.left?.label || row.left?.field || "";

      let opText = row.operator || "";
      if (opText === "crossAbove") opText = "突破";
      else if (opText === "crossBelow") opText = "跌破";

      let rightText = "";

      // 突破 / 跌破：右邊是指標
      if (
        (row.operator === "crossAbove" || row.operator === "crossBelow") &&
        row.right &&
        row.right.label
      ) {
        rightText = row.right.label;
      }
      // 比較模式：右邊是數值
      else if (
        typeof row.numberValue === "number" &&
        !Number.isNaN(row.numberValue)
      ) {
        rightText = String(row.numberValue);
      }
      // 保險：如果右邊還有 label 就顯示
      else if (row.right && row.right.label) {
        rightText = row.right.label;
      }

      return `${leftText} ${opText} ${rightText}`.trim();
    });

    const joinWord = globalLogic === "OR" ? " 或 " : " 且 ";
    const labelText = labelParts.join(joinWord);

    markers.push({
      x: xCat,
      y: yVal,
      label: labelText,
    });
  }

  console.log("[applyConditionBuilder] markers found:", markers.length);

  // 5. 如果沒有任何點 → 在面板顯示提示文字；有點就關掉提示
  const noHitEl = document.getElementById("conditionNoHitMsg");
  if (noHitEl) {
    if (markers.length === 0) {
      noHitEl.textContent =
        globalLogic === "OR"
          ? "目前區間沒有符合任一條件的點"
          : "目前區間沒有同時符合所有條件的點";
      noHitEl.style.display = "block";
    } else {
      noHitEl.textContent = "";
      noHitEl.style.display = "none";
    }
  }
  // 存到全域，讓 updateIndicatorsFromChecked 一起畫出來
  conditionMarkPoints = markers;

  if (typeof window.updateIndicatorsFromChecked === "function") {
    window.updateIndicatorsFromChecked();
  }
}

// 依「目前圖表上的股票 + 區間」重新取得買賣點
// showAlertIfEmpty = true 時，若區間內沒有任何訊號就跳出 alert
async function refreshSignalMarkersForCurrentView({
  showAlertIfEmpty = false,
} = {}) {
  if (!window.priceChartInst || !window.stockData || !window.tradingDates) {
    return;
  }

  const symbol = getSymbol();
  const resp = await fetch(
    `${API_BASE}/signal_prediction/${encodeURIComponent(symbol)}`
  );
  if (!resp.ok) {
    throw new Error("HTTP " + resp.status);
  }

  const rows = await resp.json(); // [{ date, sig }, ...]
  const cats = window.tradingDates || [];
  if (cats.length === 0) return;

  const dateSet = new Set(cats.map((d) => normalizeDateKey(d)));
  const rowsInRange = rows.filter((r) => dateSet.has(normalizeDateKey(r.date)));

  const buyPts = [];
  const sellPts = [];

  rowsInRange.forEach((row) => {
    const sig = row.sig;
    if (sig !== "Buy" && sig !== "Sell") return;

    // 後端回來的日期 → 標準化
    const dateKey = normalizeDateKey(row.date);
    if (!dateKey) return;

    // 找到「訊號那一天」在 tradingDates 裡是第幾根 K
    const idx = window.tradingDates.findIndex(
      (d) => normalizeDateKey(d) === dateKey
    );
    if (idx === -1) {
      console.warn(
        "[signals] 找不到對應的交易日，略過：",
        row.date,
        "→",
        dateKey
      );
      return;
    }

    //  保留你的設計：畫在「隔日」那根 K 棒
    const nextIdx = idx + 1;
    if (
      nextIdx >= window.tradingDates.length ||
      nextIdx >= window.stockData.length
    ) {
      console.warn("[signals] 訊號在最後一天，沒有隔日 K 線可以畫：", row.date);
      return;
    }

    const xCat = window.tradingDates[nextIdx]; // 隔日的日期（X 軸）
    const yVal = getLowPriceBelowByIndex(nextIdx); // 隔日 K 棒的最低價往下 X（Y 軸）

    if (yVal == null) {
      console.warn("該日期沒有對應的 K 線數值，略過:", xCat);
      return;
    }

    if (sig === "Buy") {
      buyPts.push({ x: xCat, y: yVal });
    } else {
      sellPts.push({ x: xCat, y: yVal });
    }
  });

  if (
    rowsInRange.length === 0 ||
    (buyPts.length === 0 && sellPts.length === 0)
  ) {
    // 區間內沒有任何訊號
    buySignalPoints = [];
    sellSignalPoints = [];
    if (showAlertIfEmpty) {
      alert("目前顯示的區間內無買賣訊號");
    }
  } else {
    buySignalPoints = buyPts;
    sellSignalPoints = sellPts;
  }

  // 不管有沒有點，都更新「下一個交易日預測」
  await showLatestSignal();

  if (typeof window.updateIndicatorsFromChecked === "function") {
    window.updateIndicatorsFromChecked();
  }

  console.log(
    `[refreshSignalMarkersForCurrentView] Buy: ${buySignalPoints.length} 個, Sell: ${sellSignalPoints.length} 個`
  );
}

// =============================
// 買賣點 toggle：future30Btn2（改成用 scatter）（改成對齊 tradingDates）
// =============================

async function toggleSignalMarkers() {
  if (!window.priceChartInst || !window.stockData || !window.tradingDates) {
    alert("請先載入股票資料");
    return;
  }

  const btn = document.getElementById("future30Btn2");
  const predEl = document.getElementById("predictionText");

  // === 現在是「開」→ 這次按要關掉 ===
  if (signalMarkersOn) {
    buySignalPoints = [];
    sellSignalPoints = [];

    if (btn) btn.classList.remove("active");

    if (typeof window.updateIndicatorsFromChecked === "function") {
      window.updateIndicatorsFromChecked();
    }

    if (predEl) {
      predEl.textContent = "";
      predEl.style.display = "none";
    }

    signalMarkersOn = false;
    console.log("[toggleSignalMarkers] 關閉買賣點與預測文字");
    return;
  }

  // === 現在是「關」→ 這次按要打開，並依目前區間載入訊號 ===
  try {
    await refreshSignalMarkersForCurrentView({ showAlertIfEmpty: true });
    signalMarkersOn = true;
    if (btn) btn.classList.add("active");
    console.log("[toggleSignalMarkers] 開啟買賣點");
  } catch (err) {
    console.error("載入買賣點失敗:", err);
    alert("載入買賣點失敗，請稍後再試");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // 預設載入 AAPL 3 個月
  loadStockWithRange("AAPL", "3m");

  // 搜尋圖示 → 展開膠囊搜尋框（同時隱藏圖示）
  const searchToggle = document.getElementById("searchToggle");
  const searchContainer = document.getElementById("searchContainer");
  if (searchToggle && searchContainer) {
    searchToggle.addEventListener("click", () => {
      // 顯示膠囊框
      searchContainer.classList.remove("hidden");
      // 隱藏放大鏡按鈕
      searchToggle.style.display = "none";

      // 關閉「自訂日期」懸浮視窗
      const customDiv = document.getElementById("customDateRange");
      if (customDiv) {
        customDiv.style.display = "none"; // 我們現在是用 inline style 控制
      }

      // 關閉右側控制面板
      const controlPanel = document.getElementById("controlPanel");
      if (controlPanel) {
        controlPanel.classList.remove("open"); // 拿掉 open class → 收起
      }

      const input = document.getElementById("symbolInput");
      if (input) {
        input.focus();
        input.select(); // 把原本文字全選，方便直接輸入
      }
    });
  }
  //  膠囊內的放大鏡 → 關閉搜尋框，恢復原本搜尋按鈕
  const pillIcon = document.querySelector(".search-pill-icon");
  if (pillIcon && searchContainer && searchToggle) {
    pillIcon.addEventListener("click", () => {
      // 收起膠囊
      searchContainer.classList.add("hidden");
      // 顯示左邊原本那顆搜尋按鈕
      searchToggle.style.display = "flex";

      // 把建議列表也順便關掉
      if (typeof suggestions !== "undefined" && suggestions) {
        suggestions.style.display = "none";
      }
    });
  }

  // === 初始化 flatpickr 自訂日期 ===
  if (window.flatpickr) {
    if (flatpickr.l10ns && flatpickr.l10ns.zh_tw) {
      flatpickr.localize(flatpickr.l10ns.zh_tw);
    }

    // 和 CSS 裡的 transform: scale(...) 保持一樣
    const CAL_SCALE = 0.85;

    const commonOptions = {
      dateFormat: "Y-m-d",
      maxDate: "today",
      allowInput: false,

      onOpen: function (selectedDates, dateStr, instance) {
        requestAnimationFrame(() => {
          const cal = instance.calendarContainer;
          const input = instance.input;
          if (!cal || !input) return;

          const inputRect = input.getBoundingClientRect();
          const calRect = cal.getBoundingClientRect();
          const margin = 8;

          let left;

          if (input.id === "customStart") {
            // 🔹開始日期：左邊對齊 input
            left = inputRect.left;
          } else {
            // 🔹結束日期：右邊對齊 input
            left = inputRect.right - calRect.width;
          }

          // 防止超出畫面
          if (left < margin) left = margin;
          if (left + calRect.width > window.innerWidth - margin) {
            left = window.innerWidth - calRect.width - margin;
          }

          cal.style.left = left + "px";
          cal.style.top = inputRect.bottom + 6 + "px"; // 接在 input 下方一點
        });
      },
    };

    // 開始／結束兩顆 input 都用同一組設定
    flatpickr("#customStart", commonOptions);
    flatpickr("#customEnd", commonOptions);
  }

  // 預設把 3m 的按鈕標成 active
  const defaultBtn = document.querySelector(
    ".time-range-item[onclick*=\"'3m'\"]"
  );
  if (defaultBtn) {
    defaultBtn.classList.add("active");
  }

  // === 進階條件 builder 初始化 ===
  restoreBuilderState([]); // 產生第一行空白條件
  initConditionDragAndDrop(); // 啟用拖曳

  const addBtn = document.getElementById("addConditionRowBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      conditionRows.push(createEmptyConditionRow());
      renderConditionRows();
    });
  }

  const applyBtn = document.getElementById("applyConditionsBtn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      applyConditionBuilder();
    });
  }

  const clearBtn = document.getElementById("clearConditionsBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      conditionRows = [createEmptyConditionRow()];
      renderConditionRows();
      applyConditionBuilder(true); // 不跳 alert，只清掉條件點
    });
  }

  // AND / OR pill 切換
  const logicToggle = document.getElementById("globalLogicToggle");
  const logicHidden = document.getElementById("globalLogic");

  if (logicToggle && logicHidden) {
    logicToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".logic-option");
      if (!btn) return;

      const value = btn.dataset.value; // "AND" 或 "OR"
      if (!value) return;

      // 更新 hidden 值給 applyConditionBuilder 用
      logicHidden.value = value;

      // 切換 pill 白色底位置
      logicToggle.classList.toggle("is-or", value === "OR");

      // 切換文字顏色（active 狀態）
      logicToggle.querySelectorAll(".logic-option").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  }

  const futureBtn = document.getElementById("future30Btn");
  if (futureBtn) {
    futureBtn.addEventListener("click", (e) => {
      e.preventDefault(); // ← 擋掉 <a href="#"> 或 <button> 在 form 裡的預設行為
      e.stopPropagation(); // ← 避免冒泡到外層又觸發其他事件
      toggleFuture30Days(); // ← 只執行我們自己的切換邏輯
    });
  }

  const futureBtn2 = document.getElementById("future30Btn2");
  if (futureBtn2) {
    futureBtn2.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSignalMarkers();
    });
  }

  // const futureBtn3 = document.getElementById("future30Btn3");
  // if (futureBtn3) {
  //   futureBtn3.addEventListener("click", (e) => {
  //     e.preventDefault();
  //     e.stopPropagation();
  //     toggleSignalMarkers();
  //   });
  // }
});

// 統一顏色表
const indicatorColors = {
  Sma_5: "#e74c3c", // 紅
  Sma_10: "#3498db", // 藍
  Sma_20: "#27ae60", // 綠
  Sma_60: "#f39c12", // 橘
  Sma_120: "#9b59b6", // 紫
  Sma_240: "#16a085", // 青
  DIF: "#d35400", // 深橘
  DEA: "#8e44ad", // 深紫
  K: "#2ecc71", // 淺綠
  D: "#2980b9", // 深藍
  J: "#c0392b", // 暗紅
  Bias: "#7f8c8d", // 灰
};

// 初始化時，讓 checkbox label 文字顏色一致
document.querySelectorAll(".indicator-check").forEach((cb) => {
  const color = indicatorColors[cb.value];
  if (color) {
    cb.parentElement.style.color = color;
    cb.dataset.color = color; // 儲存顏色以便後續使用
  }
});

// ==========================================
// 分析面板按鈕：開 / 關 右側控制面板
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const controlBtn = document.getElementById("controlPanelToggle");
  const controlPanel = document.getElementById("controlPanel");

  if (controlBtn && controlPanel) {
    // 用 onclick 強制綁定一次，避免被別的程式碼覆蓋
    controlBtn.onclick = (e) => {
      e.preventDefault();
      console.log("分析面板按鈕被點擊！");

      // 切換面板顯示狀態 (對應 .control-panel-right.open)
      const isOpen = controlPanel.classList.toggle("open");

      // 按鈕本身也加上 active 樣式（如果你有寫）
      controlBtn.classList.toggle("active", isOpen);
    };
    console.log("分析面板按鈕綁定完成");
  } else {
    console.error(
      "找不到分析面板按鈕 (controlPanelToggle) 或面板本體 (controlPanel)"
    );
  }
});

function resetAllSelections() {
  // 將所有 checkbox (技術指標 + 條件判斷) 的勾選狀態拿掉
  document.querySelectorAll(".indicator-check, .rule-check").forEach((cb) => {
    cb.checked = false;
  });

  // 更新技術指標線圖 (這會把線清掉)
  if (typeof window.updateIndicatorsFromChecked === "function") {
    window.updateIndicatorsFromChecked();
  }

  // 更新條件判斷標註 (這會把倒三角形清掉)
  // 我們直接呼叫 applyRules，它會去讀現在的 checkbox (都是空的)，進而清除圖表
  if (typeof applyRules === "function") {
    applyRules();
  }
}

function getTodayDateKey() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function renderPredictionText(predEl, signalRaw) {
  if (!predEl) return;

  const signal = (signalRaw || "HOLD").toUpperCase();

  const map = {
    BUY: {
      color: "#D50000",
      icon: "↑",
      label: "Buy",
    },
    HOLD: {
      color: "#757575",
      icon: "-",
      label: "Hold",
    },
    SELL: {
      color: "#00C853",
      icon: "↓",
      label: "Sell",
    },
  };

  const meta = map[signal] || map.HOLD;

  // 高級一點的文案 ＋ 彩色狀態
  predEl.innerHTML = `
    <span class="pred-label">下一個交易日預測：</span>
    <span class="pred-signal" style="color:${meta.color}; font-weight:600;">
      ${meta.icon} ${meta.label}
    </span>
  `;
  predEl.style.display = "block";
}

async function showLatestSignal() {
  try {
    const symbol = getSymbol();
    const response = await fetch(
      `${API_BASE}/signal_prediction/${encodeURIComponent(symbol)}`
    );

    const predEl = document.getElementById("predictionText");
    if (!predEl) return;

    if (!response.ok) {
      console.error("取得最新信號失敗 HTTP", response.status);
      // 失敗時就顯示預設 HOLD
      renderPredictionText(predEl, "HOLD");
      return;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.log("[showLatestSignal] 後端沒有任何信號資料");
      renderPredictionText(predEl, "HOLD");
      return;
    }

    // === 1. 以「今天」當基準日 ===
    const baseKey = getTodayDateKey();
    const baseTime = new Date(baseKey).getTime();
    console.log("[showLatestSignal] 基準日(今天) =", baseKey, "ms =", baseTime);

    // === 2. 掃過所有 signal，拆成「今天(含)之後」與「今天之前」 ===
    let bestFuture = null;
    let bestFutureTime = null;
    let bestPast = null;
    let bestPastTime = null;

    const allDatesLog = [];

    for (const row of data) {
      if (!row.date) continue;

      const key = normalizeDateKey(row.date);
      if (!key) continue;

      const t = new Date(key).getTime();
      if (!Number.isFinite(t)) continue;

      allDatesLog.push(`${key} (${row.sig})`);

      if (t >= baseTime) {
        if (bestFutureTime == null || t < bestFutureTime) {
          bestFuture = row;
          bestFutureTime = t;
        }
      } else {
        if (bestPastTime == null || t > bestPastTime) {
          bestPast = row;
          bestPastTime = t;
        }
      }
    }

    console.log("[showLatestSignal] 所有信號日期 =", allDatesLog);

    // === 3. 優先用「今天(含)之後最近的一天」，沒有就用「今天之前最後一天」 ===
    let chosen = bestFuture || bestPast;
    let latestSignal = "HOLD";

    if (chosen) {
      const chosenKey = normalizeDateKey(chosen.date);
      latestSignal = (chosen.sig || "HOLD").toUpperCase();
      console.log(
        "[showLatestSignal] 選到的日期 =",
        chosen.date,
        "normalizeDateKey =",
        chosenKey,
        "sig =",
        latestSignal
      );
    }

    // 最後只用高級版 render 函式
    renderPredictionText(predEl, latestSignal);
  } catch (error) {
    console.error("取得最新信號失敗", error);
    const predEl = document.getElementById("predictionText");
    if (predEl) {
      renderPredictionText(predEl, "HOLD");
    }
  }
}

// ===  彈出視窗 ===
function showHbdPopup() {
  const overlay = document.getElementById("hbdOverlay");
  if (!overlay) return;
  overlay.classList.add("show"); // 加上 show -> display:flex + 動畫
}

function hideHbdPopup() {
  const overlay = document.getElementById("hbdOverlay");
  if (!overlay) return;
  overlay.classList.remove("show"); // 移除 show -> 回到 display:none
}

// 讓 HTML 的 onclick 可以呼叫到
window.hideHbdPopup = hideHbdPopup;

// 頁面載入完成後，自動跳一次
document.addEventListener("DOMContentLoaded", () => {
  // 稍微等畫面準備好再跳（避免閃一下）
  setTimeout(showHbdPopup, 400);
});
