# GridLight · a traffic light for your electricity

**Stanford Cleantech Hackathon 2026 · Track 1: Energy & the Grid · SVCE challenge "Making time-of-use rates make sense"**

GridLight tells a Silicon Valley Clean Energy customer, hour by hour, whether electricity is **cheap and clean (green)**, **cheap but dirty (amber)** or **peak-priced (red)**, on *their* rate plan. It also prices each appliance run in dollars and CO₂, and X-rays their own Green Button usage file to show what better timing (and the right plan) is worth.

## The insight

On PG&E/SVCE's default plan **E-TOU-C**, every hour outside 4–9 PM costs the same. The grid does not work that way. With CAISO data for October 2026 weekdays:

| Hour | E-TOU-C price (winter, within baseline) | Grid CO₂ (avg of Oct 16, 19, 22) |
|---|---|---|
| 1 PM | 29¢/kWh | 141 g/kWh |
| 4 AM | 29¢/kWh | 324 g/kWh (2.3×) |
| 4–9 PM peak (mean) | 32¢/kWh | 204 g/kWh |
| 9 PM–6 AM (mean) | 29¢/kWh | 295 g/kWh |

The usual advice, "run it after 9 PM", saves 3¢/kWh in winter but sends the load to the dirtiest hours of the day, dirtier than the peak itself. Price signals alone push customers toward gas. GridLight adds the missing carbon dimension and turns both into one light people understand.

## Features

1. **Right now**: the light, your price, grid CO₂, the countdown to the next change, and today's green window.
2. **Your day at a glance**: a 24-hour strip, with the price and carbon curves on separate, aligned axes.
3. **What will this cost?**: for an EV charge, dryer, dishwasher, water heater or washer, the cost and CO₂ if you start now, the best start in the next 24 h, and the worst. A slider trades money against carbon.
4. **Bill X-ray**: drop a PG&E Green Button CSV (or use the simulated sample home). You get the share of kWh in green/amber/red, monthly cost and CO₂, the value of shifting big flexible loads (midday vs overnight), a plan-fit table (E-TOU-C, E-TOU-D, EV2-A, E-ELEC), and an SVCE program-impact estimate (MW off the peak, t CO₂/yr, $/yr). Everything runs in the browser and no data is uploaded.
5. **Nudges**: plan- and carbon-aware SMS previews, plus a one-click `.ics` with today's green windows.

## Data & method

- **Prices** (a proxy for SVCE customers): PG&E residential electric rate plan pricing, all-in delivery + generation, effective **March 1, 2026**. Seasons: summer Jun–Sep, winter Oct–May. SVCE GreenStart bills are within 0.3% of PG&E's on E-TOU-C ($159.32 vs $159.76, PG&E SVCE rate comparison, Mar 2026), so PG&E all-in prices stand in for an SVCE customer's prices; SVCE's own per-period generation + PCIA is a data swap in `data.js`. SVCE GreenStart is carbon-free on an annual accounting basis; GridLight uses hourly CAISO system intensity because that is what the timing of a kWh changes. Energy charges only; fixed charges (e.g. the E-ELEC Base Services Charge) are excluded because timing doesn't change them.
- **Grid carbon**: CAISO *Today's Outlook* history files. `intensity[h] = Σ CO₂ by source (t/h, imports included, net of exports) ÷ CAISO demand (MW) × 1000` → g/kWh. Winter profile = mean of Oct 16, 19 and 22, 2026; summer = Jul 15, 2026. Raw hourly extracts and the script are in [`data/`](data/). The app also tries CAISO's live `outlook/current` feed and falls back to the typical profile.
- **Traffic light**: red = plan peak; amber = part-peak, or off-peak with carbon above `min + 0.4 × (max − min)` of the day; green = off-peak and clean.
- **Best start time**: minimises `bill + CO₂ × carbon value` (default $100/t, adjustable) over the start hours the user can wait for (6, 12 or 24 h; 12 h by default).
- **Shifting**: per day, hourly usage above `max(2.5 kWh, 3 × the home's median hour)` counts as big flexible load (EV, dryer, water heating). It moves to that day's best hours (any hour, or overnight 9 PM–7 AM only when the car is away by day), capped at 7.2 kWh/h (a Level 2 charger). Comparing the two shows the core finding: the same bill saving can raise or cut CO₂ depending on where the charge lands.
- **E-TOU-C baseline**: every kWh is priced above baseline, minus a daily credit on the first B kWh (B set by the user, default 10 kWh/day). Shifting never changes the credit; plan choice does.
- **Program view**: per-home results × enrolled homes × share who follow the advice (default 30%), annualised.

### Honest limits
- Carbon is **average** intensity. Marginal emissions (what a shifted kWh actually changes) are usually even more favourable to midday, because curtailed solar is on the margin then and gas is at night. Next step: WattTime/CAISO marginal signal.
- The sample household is **synthetic**.
- SMS sending is a preview. Production would send it with Twilio, or by voice with ElevenLabs.

## Run it

Static site, no build: open `index.html`, or serve the folder (`python3 -m http.server`).

URL options for demos: `?t=17:15` (set the time), `?plan=EV2-A`, `?season=summer`.

## Team
Matthieu Ostertag, Valentin Mann, Hippolyte du Pac.
