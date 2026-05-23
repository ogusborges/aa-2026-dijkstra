(function () {
  "use strict";
  const saved = localStorage.getItem("djk-theme") || "dark";
  if (saved === "light") document.documentElement.classList.add("light");

  const DARK = {
    mapBg:"#131927", sandboxBg:"#0b1120",
    grid:"rgba(255,255,255,0.022)",
    districtBdr:"rgba(255,255,255,0.04)", districtLabel:"rgba(255,255,255,0.15)",
    blockFill:"rgba(255,255,255,0.038)", blockBdr:"rgba(255,255,255,0.055)",
    roadHW:"#94a3b8", roadMain:"#6b7280", roadSlow:"#4b5563",
    hwStripe:"rgba(251,191,36,0.32)", roadName:"rgba(148,163,184,0.5)",
    pillBg:"#0d1524", pillBdr:"#374151", pillTxt:"#9ca3af",
    sbPillBg:"#0b1120", sbPillBdr:"#475569", sbPillTxt:"#cbd5e1",
    pinStroke:"#0d1524", sbNodeStroke:"#0b1120",
    labelBg:"rgba(13,21,36,0.88)", labelTxt:"#e2e8f0",
    badgeBg:"#0d1524", badgeBdr:"#374151",
    badgeTxtFin:"#fde68a", badgeTxtInf:"#64748b",
  };
  const LIGHT = {
    mapBg:"#e8eaed", sandboxBg:"#f1f3f4",
    grid:"rgba(0,0,0,0.04)",
    districtBdr:"rgba(0,0,0,0.06)", districtLabel:"rgba(0,0,0,0.35)",
    blockFill:"rgba(0,0,0,0.06)", blockBdr:"rgba(0,0,0,0.09)",
    roadHW:"#ffffff", roadMain:"#cccccc", roadSlow:"#bbbbbb",
    hwStripe:"rgba(0,0,0,0.18)", roadName:"rgba(60,60,60,0.50)",
    pillBg:"#ffffff", pillBdr:"#c0c0c0", pillTxt:"#424242",
    sbPillBg:"#ffffff", sbPillBdr:"#c0c0c0", sbPillTxt:"#424242",
    pinStroke:"#ffffff", sbNodeStroke:"#ffffff",
    labelBg:"rgba(255,255,255,0.92)", labelTxt:"#202124",
    badgeBg:"#ffffff", badgeBdr:"#9e9e9e",
    badgeTxtFin:"#424242", badgeTxtInf:"#9e9e9e",
  };

  window.CTHEME = {
    isLight: function () { return document.documentElement.classList.contains("light"); },
    get c() { return this.isLight() ? LIGHT : DARK; },
    toggle: function () {
      document.documentElement.classList.toggle("light");
      localStorage.setItem("djk-theme", this.isLight() ? "light" : "dark");
      this._syncBtns();
      window.dispatchEvent(new Event("themechange"));
    },
    _syncBtns: function () {
      const label = this.isLight() ? "🌙 Dark" : "☀ Light";
      document.querySelectorAll(".theme-toggle").forEach(function (b) { b.textContent = label; });
    },
    initBtn: function (el) { el.textContent = this.isLight() ? "🌙 Dark" : "☀ Light"; },
  };

  /* Auto-init any buttons already in the DOM when this script runs */
  document.addEventListener("DOMContentLoaded", function () { window.CTHEME._syncBtns(); });
})();
