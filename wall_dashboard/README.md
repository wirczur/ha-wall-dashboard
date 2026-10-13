# Wall Dashboard

Dashboardy na tablety ścienne dla Home Assistant: **kiosk** dla tabletów (link z kluczem, tylko podgląd i sterowanie) i **edytor** w panelu bocznym HA.

Instrukcja: zakładka *Dokumentacja* add-onu ([DOCS.md](DOCS.md)).

## Budowanie ze źródeł
```sh
cd app
npm ci
npm run typecheck
npm run build       # dist/server + dist/web – to kopiuje Dockerfile
```
