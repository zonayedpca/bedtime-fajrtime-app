# Before Fajr

A mobile-first, frontend-only React sleep planner that helps you work backward from the end of Fajr in Dhaka.

## What changed in this version

- Mobile graph now shows one focused month at a time and fits the screen without horizontal chart scrolling.
- Tapping any date selects it and reveals its current timetable.
- Dragging the purple bedtime curve changes the global sleep duration for every date.
- Dragging the green wake curve changes how long before Fajr ends you want to wake for every date.
- Both controls snap to five-minute steps.
- Wake-before-Fajr-end defaults to 15 minutes and can be adjusted from 5 to 90 minutes.
- Fajr end is anchored to sunrise, with an optional local timetable adjustment.
- Installable PWA support includes a manifest, service worker, favicon, Apple touch icon, regular app icons, and a maskable icon.
- Preferences are stored locally; there is no backend or account.

## Run locally with Yarn

```bash
yarn install
yarn dev
```

## Production build

```bash
yarn build
yarn preview
```

## Quality checks

```bash
yarn lint
yarn build
```

## Main interaction model

The annual data is generated from Dhaka prayer times. On desktop, the graph shows the full year. On mobile, it shows a month-sized window with month navigation.

- **Bedtime curve:** dragging it recalculates the global sleep duration.
- **Wake curve:** dragging it recalculates the global wake buffer before Fajr ends.
- **Fajr start and end:** reference curves and not draggable.
- **Hover or tap:** shows the exact timetable after any changes.

The calculated wake time is rounded to a five-minute clock mark, so the actual daily buffer can differ slightly from the selected target.

## Install as an app

Serve the production build over HTTPS. Supported browsers can install it from the app’s Install button or browser menu. On iPhone and iPad, use Share → Add to Home Screen.
