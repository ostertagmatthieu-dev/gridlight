**GridLight in one minute**
- **Sustainability impact:** in a simulated SVCE EV home, moving big loads to midday cuts grid CO₂ 18% for a $62/month saving on EV2-A. The same saving on an overnight timer *raises* CO₂ 7%. GridLight shows the difference.
- **Creativity:** one traffic light that merges price and hourly carbon, built on a finding: off-peak isn't one thing (4 AM vs 1 PM on E-TOU-C, same 29¢, 2.3× the CO₂).
- **Technical:** a working app that combines CAISO emissions data, PG&E TOU tariffs, SVCE's hourly dynamic-pricing pilot API and Green Button parsing, all client-side and tested with Playwright.
- **Scale:** no hardware and no sign-up; it uses data every PG&E customer can already download. A program view gives SVCE MW out of the evening peak, t CO₂ and savings for N homes.

## Inspiration
Most customers in PG&E's territory, SVCE's included, are on time-of-use rates, and "avoid 4–9 PM" is all most of them know. When we looked at the data, the bigger problem was that **the price signal and the carbon signal disagree.** On E-TOU-C, every hour outside 4–9 PM costs the same. The grid does not work that way.

| October 2026 weekday | E-TOU-C price (winter, within baseline) | CAISO grid CO₂ (average) |
|---|---|---|
| 1 PM (solar) | 29¢/kWh | 141 g/kWh |
| 4 AM (gas + imports) | 29¢/kWh | 324 g/kWh (2.3×) |
| 4–9 PM peak, average | 32¢/kWh | 204 g/kWh |
| 9 PM–6 AM, average | 29¢/kWh | 295 g/kWh |

"Run it after 9 PM" saves 3¢/kWh in winter and moves the load into the night, whose average intensity is higher than the peak's. Even EV2-A, the EV plan, prices 10 AM and midnight the same: a 5-hour, 36 kWh charge costs $8.28 either way, but emits 5.4 kg CO₂ from 10 AM vs 11.1 kg from midnight. A price signal alone can't tell 1 PM solar from 4 AM gas.

## What it does
**GridLight is a traffic light for your electricity**, built on the customer's own rate plan (E-TOU-C, E-TOU-D, EV2-A, E-ELEC; summer and winter):
- **Right now:** green (cheap and clean), amber (cheap but dirty, or part-peak) or red (peak), with your price, grid CO₂, a countdown to the next change and the next green window.
- **Your day at a glance:** a 24-hour strip with price and carbon on aligned charts, and the day's insight in plain words.
- **What will this cost?** For an EV charge, dryer, dishwasher, water heater or washer: $ and kg CO₂ if you start now, at the best time and at the worst. The pick minimises bill + carbon valued at $/t (default $100/t, adjustable), within the hours the user can wait.
- **Bill X-ray:** drop the Green Button CSV every PG&E customer can download. GridLight shows when your kWh happen, what shifting big flexible loads is worth, and which plan fits. It runs 100% in the browser, so no data is uploaded.
- **For SVCE:** a program view that turns per-home results into MW moved out of the evening peak, t CO₂/yr and customer savings, for N enrolled homes and the share who follow the advice.
- **Dynamic prices:** pick SVCE's hourly dynamic pilot price (CalFUSE, published a day ahead), and the light, planner and nudges follow it hour by hour. On Oct 24, 2026, the pilot's cheapest hour is 1 PM (2.9¢/kWh) while 3 AM costs 6.0¢: hourly prices already point where the grid does, and GridLight makes that visible.
- **Nudges:** plan- and carbon-aware text messages ("Peak is over, but tonight's grid is dirty: car home tomorrow? Set the charger for 9 AM") and a one-click calendar file of today's green windows.

**What the Bill X-ray found** in our simulated San Jose EV home (951 kWh/month): on E-TOU-C, perfect timing saves just **about $5.50/month**. Money alone won't move this customer. On EV2-A, the same shift saves **$62/month ($340 → $278)**, while switching to EV2-A without changing habits saves nothing. But **where the charge lands decides the carbon**: shifted to midday, the home's grid CO₂ falls 18% (232 → 189 kg/month); shifted to an overnight timer, it rises 7% (to 247 kg). Same bill, opposite climate outcome.

## How we built it
- **Rates:** PG&E residential all-in time-of-use prices effective March 1, 2026, for four plans and both seasons, used as a proxy for SVCE customers: GreenStart average E-TOU-C bills are within 0.3% of PG&E's ($159.32 vs $159.76, PG&E's SVCE rate comparison). SVCE's own per-period generation + PCIA prices are a drop-in data swap. E-TOU-C's baseline is modelled as a daily credit.
- **Carbon:** SVCE GreenStart is carbon-free on an annual accounting basis. We use hourly CAISO average intensity because that is what the timing of a kWh changes (the 24/7 view). Source: CAISO *Today's Outlook* CO₂-by-source and demand files; intensity = Σ CO₂ (t/h, imports in, exports out) ÷ demand (MW) × 1000 = g/kWh. Winter = mean of three October 2026 weekdays (16, 19, 22); summer = Jul 15, 2026. Marginal emissions would favour midday even more.
- **Dynamic pricing:** SVCE's CalFUSE hourly pilot prices from the GridX pricing API (price curve SVCE-CalFUSE-EELEC-SECONDARY). Oct 21–25, 2026 are embedded, and today's prices are fetched live when the browser allows it.
- **App:** a static, dependency-free web app (vanilla JS, hand-built SVG charts, light and dark mode, mobile layout). It has a Green Button parser (hourly and 15-minute, solar import/export, gas rows skipped), a shifting model that conserves kWh and caps at a 7.2 kW charger, midday vs overnight scenarios, and an .ics export.
- **QA:** Playwright tests for the math (kWh conserved, CSV round-trip, calendar export), independent judge-style reviews of the app and of this text, and screenshot checks on desktop, phone, light and dark. The demo video was recorded headless from the real app.

## Challenges we ran into
- Making one honest light out of two signals that disagree. We kept red strictly for price, so following GridLight never costs more, and used amber for "cheap but dirty".
- Average vs marginal emissions: we use average hourly intensity and say so.
- Realism: an EV that is away by day can't charge at noon, so the X-ray compares midday and overnight-only shifting instead of assuming the best case.

## Accomplishments that we're proud of
- An insight a rate designer can act on: off-peak isn't one thing, and the cheapest hours are not always the cleanest.
- A working tool, not slides: real rates, real CAISO data, real Green Button parsing, privacy by design.
- Advice that pairs plan choice with timing, because one without the other can cost customers money or carbon.

## What we learned
On E-TOU-C in winter, peak and off-peak differ by 3¢/kWh (about 10%), while same-price hours differ 2.3× in CO₂ (141 vs 324 g/kWh on October weekdays). Price alone won't move behaviour; plan advice and carbon timing have to come together.

## What's next
- SVCE per-period generation rates and PCIA, and the SGIP GHG marginal-emissions signal for the PG&E DLAP in place of average intensity.
- More customers: multifamily (unit-level Green Button), small businesses on B-1, and solar + storage homes (net-load-aware advice; the parser already reads import/export).
- Delivery through SVCE's channels: SMS, voice (ElevenLabs), and smart chargers and thermostats following the green windows, so GridLight works with or without automation, plus workplace-charging partners for daytime EV charging.
- A pilot with SVCE EV customers to measure kWh moved into the 9 AM–4 PM solar window.
