// GridLight data — every number here is sourced; see README.md "Data & method".
//
// RATES: PG&E residential all-in prices (delivery + generation), effective March 1, 2026,
// from PG&E "Residential electric rate plan pricing" (pge.com). Silicon Valley Clean Energy
// GreenStart customers pay a near-identical total: PG&E's March 2026 SVCE rate comparison shows
// average E-TOU-C bills of $159.32 (GreenStart) vs $159.76 (PG&E), so these prices are a faithful
// proxy for SVCE customers' marginal cost per kWh. Energy charges only: fixed charges
// (e.g. E-ELEC Base Services Charge) are excluded because shifting usage does not change them.
// Seasons: summer = Jun 1 – Sep 30, winter = Oct 1 – May 31.
// Prices in $/kWh. Periods: [startHour, endHour) in local time.

window.GL_RATES = {
  "E-TOU-C": {
    label: "E-TOU-C (default time-of-use)",
    note: "Peak 4–9 PM every day",
    baseline: true,
    periods: (h, dow) => (h >= 16 && h < 21 ? "peak" : "off"),
    // [within baseline, above baseline]
    prices: {
      winter: { peak: [0.32, 0.40], off: [0.29, 0.37] },
      summer: { peak: [0.44, 0.52], off: [0.32, 0.40] },
    },
  },
  "E-TOU-D": {
    label: "E-TOU-D (5–8 PM weekdays)",
    note: "Peak 5–8 PM, non-holiday weekdays",
    baseline: false,
    periods: (h, dow) => (dow >= 1 && dow <= 5 && h >= 17 && h < 20 ? "peak" : "off"),
    prices: {
      winter: { peak: 0.39, off: 0.35 },
      summer: { peak: 0.48, off: 0.34 },
    },
  },
  "EV2-A": {
    label: "EV2-A (home EV charging)",
    note: "Peak 4–9 PM · part-peak 3–4 PM & 9 PM–12 AM · off-peak 12 AM–3 PM",
    baseline: false,
    periods: (h) => (h >= 16 && h < 21 ? "peak" : h === 15 || h >= 21 ? "part" : "off"),
    prices: {
      winter: { peak: 0.41, part: 0.39, off: 0.23 },
      summer: { peak: 0.54, part: 0.43, off: 0.23 },
    },
  },
  "E-ELEC": {
    label: "E-ELEC (all-electric homes)",
    note: "Peak 4–9 PM · part-peak 3–4 PM & 9 PM–12 AM · off-peak 12 AM–3 PM",
    baseline: false,
    periods: (h) => (h >= 16 && h < 21 ? "peak" : h === 15 || h >= 21 ? "part" : "off"),
    prices: {
      winter: { peak: 0.32, part: 0.30, off: 0.28 },
      summer: { peak: 0.55, part: 0.39, off: 0.33 },
    },
  },
};

// DYNAMIC: SVCE hourly dynamic price signal from the CalFUSE / Hourly Flex Pricing pilot API (GridX for PG&E),
// price curve SVCE-CalFUSE-EELEC-SECONDARY, representative circuit 013921103, CAISO day-ahead market, $/kWh.
// https://pge-pe-api.gridx.com/stage/v1/getPricing?utility=PGE&market=DAM&program=CalFUSE&ratename=EELEC&representativeCircuitId=013921103&cca=SVCE&startdate=YYYYMMDD&enddate=YYYYMMDD
// These are the published hourly pilot prices (generation + distribution components), not a full bill.
window.GL_RATES["HFP"] = {
  label: "SVCE hourly dynamic price (pilot)",
  note: "Hourly prices published a day ahead (CalFUSE pilot, E-ELEC, SVCE)",
  baseline: false,
  dynamic: true,
  day: "2026-10-24",
  hourly: {
    "2026-10-21": [0.076269, 0.069863, 0.066367, 0.065065, 0.06482, 0.07009, 0.082742, 0.086458, 0.075699, 0.070292, 0.070859, 0.06941, 0.063914, 0.064663, 0.066642, 0.072123, 0.087023, 0.139945, 0.152416, 0.141417, 0.12656, 0.113368, 0.096632, 0.074035],
    "2026-10-22": [0.073941, 0.068966, 0.060124, 0.059914, 0.061207, 0.067488, 0.075416, 0.080915, 0.068758, 0.062118, 0.060726, 0.055237, 0.05577, 0.053519, 0.051996, 0.060119, 0.070377, 0.089178, 0.107754, 0.106492, 0.088511, 0.080639, 0.073813, 0.066073],
    "2026-10-23": [0.066743, 0.058606, 0.056496, 0.055578, 0.057316, 0.060929, 0.068776, 0.069298, 0.060894, 0.054865, 0.049638, 0.047552, 0.042928, 0.042069, 0.041708, 0.044777, 0.052095, 0.075529, 0.09266, 0.101745, 0.085297, 0.080512, 0.067473, 0.060404],
    "2026-10-24": [0.065249, 0.062168, 0.060796, 0.059722, 0.060022, 0.059294, 0.063374, 0.061414, 0.047594, 0.041525, 0.040487, 0.034266, 0.029683, 0.029154, 0.029345, 0.040357, 0.051176, 0.07556, 0.110578, 0.113383, 0.088541, 0.091984, 0.074922, 0.064829],
    "2026-10-25": [0.066938, 0.063202, 0.060549, 0.058672, 0.057711, 0.058073, 0.062632, 0.058126, 0.04879, 0.040841, 0.034859, 0.030818, 0.029232, 0.029807, 0.030978, 0.038277, 0.051125, 0.076739, 0.111166, 0.114244, 0.094152, 0.095648, 0.072687, 0.066041],
  },
  periods: () => "off",
  prices: {},
};

// GRID CARBON: average CO2 intensity of electricity served on the CAISO grid, gCO2/kWh, by hour
// (hour 0 = 12–1 AM). Computed from CAISO "Today's Outlook" history files:
//   intensity[h] = sum of CO2 by source (t/h, incl. imports, net of exports) / CAISO demand (MW) × 1000
// winter = average of three October 2026 weekdays (Oct 16, 19, 22); summer = Wednesday July 15, 2026.
window.GL_CARBON = {
  winter: [291, 298, 310, 317, 324, 301, 275, 258, 233, 166, 152, 155, 154, 141, 148, 145, 147, 186, 219, 227, 242, 255, 265, 292],
  summer: [268, 264, 274, 282, 285, 285, 274, 217, 160, 164, 144, 115, 108, 115, 116, 113, 118, 139, 152, 175, 185, 190, 205, 242],
  source: {
    winter: "CAISO Today's Outlook, avg. of Oct 16, 19 & 22, 2026 (weekdays)",
    summer: "CAISO Today's Outlook, Jul 15, 2026",
  },
};

// APPLIANCES: typical energy and run time (editable in the app).
window.GL_APPLIANCES = [
  { id: "ev", name: "EV charge", detail: "≈ 130 miles · Level 2 charger", kwh: 36, hours: 5, icon: "ev" },
  { id: "dryer", name: "Clothes dryer", detail: "one electric load", kwh: 3, hours: 1, icon: "dryer" },
  { id: "dish", name: "Dishwasher", detail: "one normal cycle", kwh: 1.5, hours: 2, icon: "dish" },
  { id: "hpwh", name: "Water heater", detail: "heat-pump, daily reheat", kwh: 4, hours: 3, icon: "water" },
  { id: "washer", name: "Washing machine", detail: "one warm load", kwh: 0.8, hours: 1, icon: "washer" },
];
