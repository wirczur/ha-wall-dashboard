# Wall Dashboard

Dashboardy na tablety ścienne. Dwa wejścia do jednego add-onu:

| Wejście | Adres | Kto | Co można |
|---|---|---|---|
| **Panel admina** | pozycja *Wall Dashboard* w pasku bocznym HA (ingress) | tylko administratorzy HA | wszystko: dashboardy, widoki, widgety, wygląd, tablety, klucze |
| **Kiosk** | `http://<IP-HA>:8100/?k=<klucz-tabletu>` (port na hoście — add-on działa w sieci hosta) | tablety ścienne | tylko oglądanie i sterowanie — bez żadnych ustawień |

## Instalacja

**Z repozytorium (zalecane):** **Ustawienia → Dodatki → Sklep z dodatkami → ⋮ → Repozytoria** → dodaj adres repozytorium GitHub tego add-onu → odśwież sklep → **Wall Dashboard** → Zainstaluj. Aktualizacje pojawiają się w HA same.

**Lokalnie:** folder `wall_dashboard` do udziału **`addons`** w HA (Samba: `\\<IP-HA>\addons\wall_dashboard`, SSH: `/addons/wall_dashboard`) → **Sklep z dodatkami → ⋮ → Sprawdź aktualizacje** → sekcja *Local add-ons*.

Po instalacji włącz **Pokaż na pasku bocznym** i uruchom. Przy pierwszym starcie add-on tworzy pusty dashboard **Mój dashboard** (zegar + powitanie) i tablet **Tablet 1** z kluczem.

**Przenosiny / kopia zapasowa:** **Kopia zapasowa → Pobierz kopię** zapisuje wszystko w jednym pliku (dashboardy, tablety z kluczami, domy 3D, telewizory, wyzwalacze, wgrane pliki); **Przywróć z pliku** wczytuje ją w innej instalacji – linki tabletów działają dalej.

## Pierwsze kroki

Panel zarządzania ma menu z boku: **Stan**, *Wygląd* (Dashboardy, Motywy, Domy 3D), *Urządzenia* (Tablety, Telewizory), *Dzwonek i automatyka* (Furtka i SIP, Wyzwalacze i pop-upy, Sceny i automatyzacje) oraz *System* (Ustawienia, Kopia zapasowa, Encje).

**Stan** to strona startowa: ile paneli jest online, czy centrala SIP odpowiada, dzwonki z dziś, tryb ciszy i lista „Wymaga uwagi” (panel offline, stara aplikacja, panel niezarejestrowany w centrali, brak HTTPS, go2rtc nie odpowiada). Przycisk **Otwórz** przy ostrzeżeniu przenosi tam, gdzie się to naprawia.

1. **Dashboardy** pokazują miniatury w kolorach motywu i tablety, na których dashboard jest używany. **Edytuj** otwiera edytor, **Duplikuj** robi kopię, **⋯** zmienia nazwę, eksportuje JSON albo usuwa. Nowy dashboard możesz zacząć od siatki dla tabletu, panelu 1:1 albo telefonu; **Importuj** wczytuje JSON z eksportu.
2. Edytor:
   - **po lewej** struktura: widoki (zakładki), panele boczne i lista widgetów bieżącego widoku – kliknięcie zaznacza widget, także mały albo przykryty; strzałki zmieniają kolejność widoków; na dole szybkie dodawanie widgetów i **Więcej…** (pełna galeria z podpowiedziami encji z HA);
   - **w środku** podgląd: przeciągnij widget, aby go przesunąć, a róg, aby zmienić rozmiar; strzałki przesuwają o kratkę, Shift+strzałki zmieniają rozmiar, Delete usuwa, Ctrl+D duplikuje; pod podglądem pasek **Używany na** – kliknięcie tabletu od razu przypisuje albo odłącza dashboard;
   - **po prawej** właściwości w zakładkach **Widget / Widok / Dashboard** oraz ostrzeżenia (encja, której nie ma w HA, widgety nachodzące na siebie, panel boczny, którego nic nie otwiera – kliknięcie przenosi do widgetu);
   - u góry: rozmiar ekranu, **podgląd motywu okolicznościowego** (Święta, Wielkanoc… – tylko w edytorze) i **Na tablecie** – wybrany tablet pokazuje bieżącą, także niezapisaną wersję przez 3 minuty (baner „Podgląd z edytora”, dotknięcie wraca wcześniej).
3. **Zapisz** (lub Ctrl+S). Tablety z tym dashboardem przeładują go same. **Cofnij / Ponów**: Ctrl+Z / Ctrl+Y. Tryb **JSON** daje dostęp do całej konfiguracji, **Podgląd** pokazuje działający dashboard.
4. **Tablety**: lista ze stanem (online / od kiedy offline, aplikacja i jej wersja, numer SIP i rejestracja). Wybrany tablet ma szybkie akcje (Przeładuj, Wygaś, Test pop-upu, Kopiuj link, Otwórz) i zakładki **Ogólne · Dashboardy · Ekran · Rozmowy · Cisza**. **Kopiuj link** → wklej jako adres startowy w Fully Kiosk Browser albo sparuj aplikację na Androida kodem (karta *Parowanie* pod listą).

### Adres kiosku
Link budowany jest z adresu, pod którym otwierasz HA, i portu 8100. Jeśli wchodzisz przez domenę lub reverse proxy (np. `ha.example.com`), w **Ustawieniach** ustaw *Adres kiosku widziany z tabletów*, np. `http://192.168.1.10:8100`. Port można zmienić w konfiguracji add-onu (sekcja *Sieć*).

### Fully Kiosk Browser
- *Start URL*: link z zakładki Tablety.
- Zalecane: *Keep Screen On*, *Autoplay Videos*, *Enable Fullscreen*, wyłączony *Pull to Refresh*.

## Dom 3D
1. Zakładka **Domy 3D** → **Importuj dom z rzutów SVG**: jedna kondygnacja = jeden plik SVG (klasy `r` pomieszczenia, `w` ściany, `ok` okna, `br` brama, `st` schody, `mb`/`ml` meble, teksty `n` i `m2`). Skala liczona jest z metraży pomieszczeń.
2. W edytorze domu:
   - **Pokoje** — przypisz czujnik temperatury / wilgotności, termostat i światło sufitowe (lampa pojawi się na środku pokoju).
   - **Meble** — kliknij mebel na modelu: popraw typ, obróć o 90°, zmień wymiary, usuń lub dodaj nowy.
   - **Urządzenia** — wybierz rodzaj i encję, kliknij miejsce na modelu. Lampy świecą, TV i głośniki reagują na stan, klimatyzator pokazuje nawiew. Każde urządzenie może mieć własną akcję po dotknięciu.
   - **Bramy** — przypisz encję `cover`; model pokaże otwarcie bramy.
3. Na dashboardzie dodaj widget **Dom 3D**, wybierz dom i ustaw kąt kamery (obrót, nachylenie, przybliżenie). Tablet pokazuje dom zawsze pod tym kątem; opcja „Pozwól obracać palcem” odblokowuje obracanie.
4. Na słabych panelach włącz **Tryb Lite** (bez cieni, niższa rozdzielczość).

Modele mebli: [Kenney Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0).

**Układanie mebli i urządzeń:** w edytorze domu przeciągnij element po modelu. Meble trzymają siatkę 5 cm (Shift: 1 cm) i dosuwają się do ścian (Alt: bez przyciągania). Zaznaczony element przesuwasz strzałkami (Shift: 25 cm, Alt: 1 cm), R obraca o 90°, Ctrl+D duplikuje, Delete usuwa. Nowy mebel: wybierz rodzaj → „Dodaj i kliknij miejsce” → kliknij podłogę. Zmiany zapisuje przycisk **Zapisz**.

## Kamera na żywo i rozmowa
- Widget **Kamera** i wiersz panelu `display: camera` pokazują obraz na żywo przez WebRTC. Domyślnie przez Home Assistant (go2rtc wbudowane od HA 2024.11) — tablet nie potrzebuje dostępu do go2rtc. Alternatywnie w ustawieniach widgetu: **Bezpośrednio go2rtc** (adres np. `http://192.168.1.10:1984` i nazwa strumienia).
- Jeśli WebRTC nie działa, widget sam przełącza się na zdjęcia odświeżane co kilka sekund.
- **Rozmowa** (`talk: true` / „Rozmowa (mikrofon tabletu)”): przycisk *Odbierz* wysyła mikrofon tabletu. Przeglądarka udostępnia mikrofon tylko przez HTTPS — włącz w konfiguracji add-onu **HTTPS dla kiosku** (`ssl: true`, certyfikaty z folderu `/ssl`, np. z dodatku Let's Encrypt) i użyj w Fully Kiosk adresu `https://…:8100/?k=…`. W Fully Kiosk włącz też *Web Content Settings → Enable Microphone Access*.
- Dźwięk z tabletu odtworzy się na furtce, jeśli go2rtc obsługuje backchannel dla tej kamery (Hikvision przez źródło `isapi://`).

**Bezpośrednio z go2rtc** (np. dodatek go2rtc ze strumieniem `rtsp://…:8554/furtka`): w zakładce *Tablety* ustaw *Adres API go2rtc* (port **1984**, adres widziany z add-onu, np. `http://127.0.0.1:1984` lub `http://192.168.1.10:1984`) i kliknij *Zapisz i sprawdź*. W widgecie kamery wybierz *Źródło: Bezpośrednio go2rtc* i nazwę strumienia (`furtka`). Tablet wymienia z go2rtc tylko opis połączenia przez add-on; obraz płynie bezpośrednio z go2rtc (port WebRTC 8555 musi być osiągalny z tabletów). W pop-upie: `go2rtc: { stream: furtka }`.

## Pop-upy z automatyzacji (np. dzwonek)
```yaml
automation:
  - alias: Dzwonek — furtka na tabletach
    triggers:
      - trigger: state
        entity_id: binary_sensor.dzwonek_furtka
        to: "on"
    actions:
      - event: wall_dashboard_popup
        event_data:
          id: furtka
          tablets: ["Tablet 1"]        # nazwy lub id tabletów; brak = wszystkie
          title: Dzwoni furtka
          camera: camera.furtka
          talk: true
          rows:
            - entity: lock.furtka
              name: Zamek furtki
              display: buttons
          timeout: 60                      # sekundy; 0 = do zamknięcia
          open:                            # duży przycisk „Otwórz furtkę” (przytrzymaj ~1 s)
            entity: lock.furtka
          reject:                          # „Odrzuć” – zamyka na wszystkich tabletach
            entity: button.domofon_rozlacz # opcjonalnie
```
Zamknięcie z automatyzacji: `event: wall_dashboard_popup` z `event_data: { id: furtka, action: close }`. Pop-up może sterować encjami, które przysłała automatyzacja, nawet jeśli nie ma ich na dashboardzie tabletu. W Fully Kiosk włącz *Advanced Web Settings → Enable JavaScript Interface*, aby pop-up wybudzał ekran.

Ściszanie muzyki na czas rozmowy zrób w tej samej automatyzacji (np. `media_player.volume_mute` lub `scene.create` przed i `scene.turn_on` po).

## Pilot do telewizora Samsung (bez HA)
Telewizor sterowany jest bezpośrednio przez add-on w sieci lokalnej — integracja Samsung w HA nie jest potrzebna.

1. Na telewizorze: *Ustawienia → Ogólne → Menedżer urządzeń zewnętrznych → Menedżer połączeń urządzeń* — powiadomienie o dostępie włączone, dostęp „zawsze”. Do włączania z sieci: *Ogólne → Sieć → Ustawienia eksperta → Włącz z urządzeniem mobilnym* (Wake-on-LAN).
2. Panel admina → **Telewizory** → dodaj IP i MAC (MAC znajdziesz w UniFi lub w *Ustawienia → Pomoc techniczna → Informacje o urządzeniu*). Najlepiej przypisz telewizorowi stały adres IP w routerze.
3. **Paruj** → na telewizorze zaakceptuj „Wall Dashboard” (30 s). Token zapisuje się w add-onie.
4. **Aplikacje na pilocie** → zaznacz skróty (Netflix, YouTube, …).
5. Na dashboard dodaj widget **Pilot TV** albo w edytorze domu 3D przy urządzeniu *Telewizor* wybierz **Pilot Samsung** — dotknięcie TV na modelu otworzy pilota.

**Włączanie:** gdy TV jest w czuwaniu sieciowym, przycisk zasilania wysyła KEY_POWER; gdy jest całkiem wyłączony — pakiet Wake-on-LAN na adres rozgłoszeniowy podsieci TV (np. `192.168.1.255`) i na sam adres TV. Add-on działa w sieci hosta, więc pakiet trafia do LAN-u. Jeśli TV jest w innej podsieci/VLAN niż HA, router musi przepuszczać rozgłoszenia kierowane (UniFi: *Settings → Networks → … → Multicast / directed broadcast*) albo wpisz w polu „Adres rozgłoszeniowy” adres, który dociera do TV.

**Modele sprzed 2016 r.** (seria H/J) używają innego protokołu i nie są obsługiwane.

## Termostat i klimatyzacja z kilku encji
Widget **Termostat / klimatyzacja** działa z jedną encją `climate.*` albo z termostatem „rozbitym” na osobne encje (np. sterowniki TECH, piece, pompy ciepła). W edytorze: *Źródło danych* → „Tylko osobne encje” i przypisz role:

| Rola | Typowa encja | Zapis |
|---|---|---|
| Temperatura aktualna | `sensor.*` | — |
| Wilgotność | `sensor.*` | — |
| Nastawa | `number.*`, `input_number.*` | `set_value` |
| Tryb | `select.*`, `input_select.*`, `switch.*` | `select_option` / `turn_on/off` |
| Czy pracuje | `binary_sensor.*`, `switch.*`, `sensor.*` (pompa, zawór) | — |
| Zasilanie | `switch.*` (osobny wyłącznik klimatyzatora) | `turn_on/off` |
| Wentylator / Lamele / Preset | `select.*` | `select_option` |
| Następny punkt – godzina / temperatura | `sensor.*` | — |
| Nastawa tymczasowa | `number.*` | `set_value` |

Każda rola może czytać **atrybut** zamiast stanu i zapisywać **własną usługą** (np. `script.tech_tymczasowa` — wartość trafia do `variables.value`). Przy źródle „encja climate” puste role biorą wartości z encji climate, a wpisane je nadpisują (np. temperatura z innego czujnika).

**Tryby** wczytasz przyciskiem *Wczytaj z encji*; dla każdego ustawisz nazwę, ikonę, ukrycie i rodzaj (*Ręczny*, *Harmonogram*, *Wyłączony*, *Grzanie*, *Chłodzenie*…). Rodzaj decyduje o zachowaniu:
- **−/+ w harmonogramie**: *Przełącz na ręczny* (domyślnie), *Zablokuj* albo *Zmień tymczasowo* (do roli „Nastawa tymczasowa” lub bezpośrednio do nastawy).
- **−/+ gdy wyłączony**: *Zablokuj* albo *Włącz*.
- Kilka szybkich kliknięć −/+ wysyła jedną wartość (opóźnienie domyślnie 900 ms).

**Układy** (*Automatycznie* wybiera według rozmiaru kafelka): *Mały* (temperatura i nastawa; dotknięcie otwiera panel z pełnym sterowaniem, przełącza tryb albo zasilanie), *Średni* (−/+ i przełącznik trybu), *Duży* (wszystko: przyciski trybów, wentylator, lamele, następny punkt, dodatkowe wartości), *Pasek* (jeden wiersz na listę pokoi).

**Klimatyzacja** (*Rodzaj: Klimatyzacja*): przycisk zasilania, tryby chłodzenie/grzanie/osuszanie/wentylator/auto, prędkość wentylatora i lamele. Te same ustawienia ma klimatyzator postawiony w **Domu 3D** (urządzenie → „Klimatyzacja – panel”), a pokój może mieć **termostat z osobnych encji** — temperatura na modelu i w mapie ciepła bierze się wtedy z roli „Temperatura aktualna”.

Przykład (JSON widgetu):
```jsonc
{ "type": "climate", "title": "Salon", "x": 0, "y": 0, "w": 6, "h": 3,
  "options": { "kind": "thermostat", "source": "entities", "layout": "auto",
    "roles": { "current": { "entity": "sensor.tech_salon_temperatura" }, "target": { "entity": "number.tech_salon_nastawa" },
               "mode": { "entity": "select.tech_salon_tryb" }, "action": { "entity": "binary_sensor.tech_salon_pompa" } },
    "modes": [ { "value": "manual", "kind": "manual" }, { "value": "auto", "label": "Harmonogram", "kind": "schedule" }, { "value": "off", "kind": "off" } ],
    "scheduleBehavior": "switch" } }
```

## Tryb Lite
W zakładce **Tablety** zaznacz *Tryb Lite* dla słabych paneli (np. Rockchip PX30): bez rozmycia tła i cieni, mniejsza rozdzielczość widoku 3D.

## Bezpieczeństwo
- Panel admina działa wyłącznie przez ingress HA (połączenia spoza Supervisora są odrzucane), a pozycja w pasku bocznym jest widoczna tylko dla administratorów.
- Kiosk nie ma dostępu do API admina. Tablet widzi i steruje **tylko encjami użytymi w jego dashboardach**, tylko przez bezpieczne domeny (światła, rolety, klimat, zamki, media, sceny, skrypty…). Rozbrajanie alarmu z kiosku jest zablokowane.
- **Nowy klucz** natychmiast unieważnia stary link i rozłącza tablet. Tablet nie zna tokenu HA — wszystkie wywołania idą przez add-on.

## Konfiguracja dashboardu (JSON)

```jsonc
{
  "title": "Parter",
  "showTabs": true,                       // zakładki widoków u góry
  "theme": {
    "background": { "type": "glass", "color": "#0B0D12", "image": "", "blur": 0, "dim": 35 },
    "accent": "#FFC870", "textColor": "#F5F3EF", "tileOpacity": 0.58, "radius": 20
  },
  "views": [{
    "id": "sterowanie", "title": "Sterowanie",
    "columns": 24, "rowHeight": 56, "gap": 12,   // siatka: x,y,w,h widgetów w tych jednostkach
    "widgets": [ … ]
  }]
}
```

### Widgety
| `type` | Do czego | Najważniejsze pola |
|---|---|---|
| `clock` | zegar | `options.seconds` |
| `date` | data | `options.format`: `long` / `short` |
| `value` | stan lub atrybut encji | `entity`, `options.attribute`, `decimals`, `unit`, `stateMap` |
| `temperature` | temperatura (+ np. wilgotność) | `entity` (sensor lub climate), `secondary` |
| `climate` | termostat / klimatyzacja (encja climate albo zestaw encji) | `entity`, `options.kind`, `options.roles`, `options.modes`, `options.layout` — patrz niżej |
| `button` | kafelek/przycisk | `entity`, `icon`, `options.subtitle`, `stateMap`, `subtitleAttribute` + `subtitleSuffix`, `countOn` |
| `text` | tekst | `options.text`, `options.size` |
| `image` | obrazek (np. rzut) | `options.url` (np. `media/plan.png` po wysłaniu w edytorze), `options.fit` |
| `iframe` | osadzona strona (np. Windy) | `options.url` |
| `camera` | podgląd kamery (odświeżany obraz) | `entity`, `options.refresh` (s) |

**Wygląd każdego widgetu** (`style`): `background`, `color`, `accent`, `radius`, `opacity` (0–1), `fontScale`, `padding`, `border: false`, `hideTitle`, `align`. Ikony: wbudowane (`bulb`, `gate`, `garage`, `lock`, `fan`, `play`, `thermometer`, `trash`, `calendar`, `washer`, `cam`, `garden`, `mute`, …) albo dowolna `mdi:nazwa-ikony`.

### Dynamiczne teksty
W tytule, podpisie przycisku, tekście i szablonie widgetu Wartość: `{sensor.temp_salon}` (stan z jednostką), `{climate.salon.temperature}` (atrybut), `{sensor.temp_salon:1}` (1 miejsce po przecinku). Przykład podpisu: `{sensor.co2_salon} ppm · {fan.rekuperator.percentage}%`.

### Akcje (`tap`, `hold` — przytrzymanie)
```jsonc
{ "type": "toggle" }                                         // przełącz encję widgetu
{ "type": "set", "steps": [ { "entity": "fan.rekuperator", "value": "30" }, { "entity": "select.reku_tryb", "value": "Noc" } ] }  // ustaw wartości
{ "type": "service", "service": "script.turn_on", "entity": "script.dobranoc" }
{ "type": "view", "view": "prognoza" }                       // inna zakładka
{ "type": "dashboard", "dashboard": "pietro-1a2b" }          // inny dashboard tabletu
{ "type": "url", "url": "https://…" }
{ "type": "panel", "panel": { … } }                          // panel boczny
{ "type": "none" }
```
Bez `tap`: przycisk z encją ją przełącza, `value`/`temperature` otwierają panel z wykresem.

### Panel boczny
```jsonc
{ "title": "Światła", "subtitle": "Parter", "rows": [
  { "entity": "light.salon", "name": "Pokój dzienny", "display": "slider" },
  { "entity": "cover.brama_garazowa", "display": "buttons" },
  { "entity": "sensor.temperatura_zewnatrz", "display": "graph", "hours": 48 },
  { "entity": "camera.furtka", "display": "camera" }
]}
```
`display`: `auto` (dobór wg domeny), `toggle`, `slider` (jasność / pozycja / % wentylatora / głośność / input_number), `value`, `buttons` (rolety, zamki, media ze źródłami, klimat z trybami, odkurzacz), `graph` (historia), `camera`.

## Uruchomienie poza HA (rozwój)
```sh
cd app && npm install && npm run build
HA_URL=http://192.168.1.10:8123 HA_TOKEN=<long-lived token> DATA_DIR=./data npm start
# admin: http://localhost:8099   kiosk: http://localhost:8100/?k=<klucz>
```

## Plan kolejnych etapów
- ~~Etap 3 — edytor wizualny~~ (0.2.0)
- ~~Etap 4 — widget „Dom 3D”~~ (0.3.0)
- ~~Etap 5 — kamera WebRTC z rozmową, pop-upy, HTTPS, Lite~~ (0.4.0)

## Belka na dole i widgety w panelu bocznym

- **Styl widoków**: edytor dashboardu → Ogólne → „Styl przełączania widoków”: zakładki u góry, pigułki, belka na dole albo pasek boczny. Przy belce/pasku nadaj widokom ikony (bez ikony pokazuje się kropka).
- **Widgety w panelu**: dodaj widok i zaznacz „Tylko do panelu”, ułóż w nim widgety w edytorze wizualnym, a w kafelku z akcją „Panel boczny” wybierz go w polu „Widgety z zakładki”. Wiersze panelu (encje, kamery, pilot) pokazują się pod widgetami.
- **Galeria widgetów**: „＋ Dodaj widget” pokazuje podgląd każdego typu i gotowych wariantów na encjach z Twojego HA – kliknięcie wstawia widget na dół widoku.

## Odtwarzacz (media player)

Widget „Odtwarzacz” pokazuje dowolną encję `media_player` (HEOS, Sonos, Spotify, telewizor…). Układ: pasek (wysokość 2), mały, duży z okładką albo auto wg rozmiaru. W opcjach można wyłączyć okładkę, tło, postęp, głośność, źródło, losowo/powtarzanie i zasilanie. W polu „Multiroom” wskaż inne głośniki – na widgecie pojawią się przyciski, które dołączają je do odtwarzacza (`media_player.join`) lub odłączają (`unjoin`).

## Wygląd, „Wyłącz wszystkie”, efekty świateł

- **Wygląd**: Motyw → Wygląd: „Szkło – ciemny” albo „Mech i mosiądz – jasny, ciepły”. W „Mech i mosiądz” kolory akcentu/tekstu i krycie kafelków z motywu są pomijane.
- **Wyłącz wszystkie**: w kafelku ustaw akcję „Wyłącz wszystkie”. Bez listy encji używa „Licz włączone” i encji kafelka. Typowo: dotknięcie = panel ze światłami, przytrzymanie = wyłącz wszystkie.
- **Efekty świateł**: w panelu przy lampie pojawiają się efekty, kolory i barwa bieli, jeśli encja je obsługuje (`effect_list`, `supported_color_modes`). Ukryjesz je w wierszu panelu opcją „Efekty, kolory i barwa bieli”.

## Kalendarz

Widget „Kalendarz” pokazuje wydarzenia z encji `calendar.*` (np. Google Calendar, CalDAV, Local Calendar, harmonogram wywozu śmieci). W opcjach dodaj kalendarze (kolor i nazwa opcjonalnie) i wybierz układ: lista najbliższych dni, tydzień albo miesiąc z listą wydarzeń wybranego dnia. „Auto” dobiera układ do rozmiaru: szeroki i wysoki → miesiąc, szeroki → tydzień, wąski → lista.

## Wywóz śmieci

Widget „Wywóz śmieci” ma dwa źródła:
- **Dwie encje** – „Kiedy” (sensor z datą `2026-10-14`, liczbą dni `2` albo tekstem „jutro”, „za 3 dni”; może być atrybut) i „Co” (np. „Plastik, Papier”).
- **Kalendarz** – encja `calendar.*` (np. z integracji Waste Collection Schedule): tytuł wydarzenia to rodzaj odpadów, kilka w jednym dniu łączy się w „Plastik + Papier”.
Kafelek wyróżnia się w kolorze pojemnika, gdy do wywozu zostało tyle dni lub mniej, ile ustawisz (domyślnie 1). Kolory rozpoznawane są po nazwie; własne ustawisz w „Własne kolory”.

## Simple Timer i Rain Bird IQ4

- **Timer (Simple Timer)** – wskaż sensor integracji (ten z dziennym czasem pracy, ma atrybut `timer_state`). Przyciski czasu wpisujesz po przecinku: `15, 30, 60, 1.5h, 30s`. Gdy timer trwa, przyciski dodają czas (`simple_timer.add_timer`), Stop anuluje (`cancel_timer`), ikona po lewej włącza/wyłącza urządzenie (`manual_power_toggle`). Opcje: opóźniony start, planowanie startu, dzienny czas pracy.
- **Nawadnianie (Rain Bird IQ4)** – kliknij „Wykryj strefy i programy Rain Bird IQ4”, potem ewentualnie usuń zbędne. Start strefy: `rainbird_iq4.start_zone` (1–30 min), Stop: `stop_zone`, „Zatrzymaj wszystko”: `stop_all_zones`, programy: `start_program`, opóźnienie: `set_rain_delay`. Kalendarze programów z tej integracji pokażesz widgetem Kalendarz.

## Wyzwalacze (dzwonek, domofon) i wybudzanie tabletu

Zakładka **Wyzwalacze**: wskaż encję (np. `binary_sensor.dzwonek`, `event.domofon_ding`) i stan, na który ma reagować (pusto = każda zmiana – dla encji `event.*`). Reakcja: pop-up z kamerą i przyciskami albo samo wybudzenie. Add-on reaguje sam – nie trzeba automatyzacji w HA.

Wybudzanie w **Fully Kiosk Browser**: *Settings → Advanced Web Settings → Enable JavaScript Interface* (oraz w *Device Management* zezwól na wyłączanie wygaszacza/ekranu). Add-on wywołuje `fully.turnScreenOn()`, `fully.stopScreensaver()`, `fully.bringToForeground()`, opcjonalnie `setScreenBrightness`, `playSound`, `textToSpeech`.

## Asystent (Assist)

**Tablety → wybrany tablet → Asystent → „Asystent na tym tablecie”.** Na panelu pojawia się okrągły przycisk w prawym dolnym rogu: okno rozmowy, podpowiedzi (własne wpiszesz w ustawieniach), pole tekstowe i mikrofon.

- **Potok Assist** – wybierasz jeden z potoków HA (Ustawienia → Asystenci głosowi): agent rozmowy (wbudowany, Ollama, OpenAI…), rozpoznawanie mowy (np. Whisper), głos (np. Piper) i słowo wybudzające (openWakeWord). Puste = domyślny potok HA.
- **Głos:** *tylko tekst*, *przytrzymaj mikrofon i mów* albo *słowo wybudzające* – panel wysyła dźwięk z mikrofonu do HA cały czas (ok. 32 kB/s, 16 kHz), po wykryciu słowa okno otwiera się samo i zamyka po odpowiedzi. Słuchanie wstrzymuje się podczas rozmów (SIP, interkom), gdy aplikacja jest w tle i – jeśli nie zaznaczysz inaczej – w trybie ciszy.
- **Odpowiadaj głosem** – odpowiedź z TTS potoku (w trybie ciszy tylko tekst).
- Mikrofon w przeglądarce wymaga **HTTPS** kiosku (jak interkom).
- Asystent steruje encjami **udostępnionymi dla Assist** w HA (Ustawienia → Asystenci głosowi → Udostępnianie) – nie tylko tymi z dashboardu tabletu. Udostępniaj tylko to, czym asystent ma sterować z paneli.

## Sceny i automatyzacje

Zakładka **Sceny i automatyzacje** zapisuje bezpośrednio w HA (`scenes.yaml`, `automations.yaml` – standardowa konfiguracja HA je dołącza). Po zapisie add-on przeładowuje sceny/automatyzacje.

**Telewizor w scenie.** W kroku *Urządzenia* zaznacz telewizor z sekcji *Telewizory (pilot Wall Dashboard)*, a w kroku *Ustawienia* wybierz: zasilanie (włącz / wyłącz), aplikację (skróty z zakładki Telewizory), wejście (TV, HDMI 1–4) i ewentualnie dodatkowe klawisze pilota (np. `KEY_VOLDOWN`). Telewizory z pilota nie są encjami HA, dlatego obok sceny powstaje automatyzacja **„Scena „…” – telewizor”**: gdy scena się włączy (z tabletu, z HA, głosem), wysyła zdarzenie `wall_dashboard_tv`, a add-on steruje telewizorem. Całkiem wyłączony telewizor włącza się przez Wake-on-LAN – wymaga adresu MAC w zakładce Telewizory. Usunięcie sceny w Wall Dashboard usuwa też jej automatyzację.

To samo zdarzenie możesz wysłać z własnej automatyzacji lub skryptu:
```yaml
action: event.fire        # w automatyzacji: event
data:
  event_type: wall_dashboard_tv
  event_data:
    tv: "TV Salon"          # nazwa albo id telewizora z zakładki Telewizory
    power: "on"             # on | off (opcjonalnie)
    app: "Netflix"          # nazwa skrótu albo appId (opcjonalnie)
    keys: [KEY_HDMI1]       # klawisze pilota po kolei (opcjonalnie)
```

## Dyson, AGD Samsung (LocalThings), Scheduler, Satel

- **Termostat Grenton** (integracja wirczur/homeassistant-grenton 0.3+, encja climate z atrybutem `weekly_schedule`): przycisk **Harmonogram** w widgecie Klimat otwiera tydzień – paski dni w kolorach temperatur, edycja zmian (godzina co 15 min, temperatura co 0,5° w granicach termostatu), kopiowanie dnia na dni robocze / weekend / cały tydzień. **Zapisz** wysyła cały tydzień przez `grenton.set_thermostat_schedule`. Z tabletu dozwolona jest tylko ta usługa Grentona. Przycisk wyłączysz w ustawieniach widgetu (Klimat → „Grenton: przycisk Harmonogram”).
- **Oczyszczacz (Dyson)**: „Wykryj urządzenie Dyson” wypełnia encje z integracji hass-dyson.
- **Robot sprzątający Dyson (hass-dyson 0.39+, Spot+Scrub / Vis Nav)**: w widgecie *Robot* przycisk „Wykryj urządzenie” uzupełnia też aktualny pokój (pokazywany przy stanie), stan stacji dokującej z godziną końca (np. „suszy mop do 10:55”), mapę pokrycia sprzątania (przycisk z mapą – podgląd odświeżany co 10 s w trakcie sprzątania), tryb sprzątania i listę pokoi. Przy każdym pokoju widać jego zapisany tryb (np. „Kuchnia · mop”). Przycisk z zębatką otwiera **ustawienia pokoi** – tryb (odkurzanie, odkurzanie + mop, tylko mop, najpierw odkurzanie potem mop), moc ssania, ilość wody i liczbę myć mopa; zmiany zapisują się w robocie (tylko gdy jest w stacji). W kafelku (co najmniej 5 wierszy wysokości) zaznacz pokoje, opcjonalnie wybierz tryb jednorazowo dla tego sprzątania i „Sprzątaj wybrane” – add-on wywołuje `hass_dyson.start_zone_clean`. Pokój, w którym robot jest teraz, ma obwódkę. Dla Vis Nav pokoje wpisz ręcznie (nazwy z MyDyson).
- **Urządzenie / AGD**: „Wybierz urządzenie” – dowolne urządzenie z HA (np. pralka z LocalThings); możesz usunąć zbędne encje i zmienić kolejność.
- **Harmonogramy**: integracja scheduler-component; filtr po tagu lub urządzeniach.
- **Alarm**: partycja Satel Integra (`alarm_control_panel.*`), strefy (`binary_sensor`), wyjścia (`switch`). Rozbrajanie z tabletu: Tablety → „Może rozbrajać alarm”.


## Aplikacja na Androida i polecenia dla paneli

Aplikacja **Wall Dashboard** (osobny projekt Android) może zastąpić Fully Kiosk na słabym panelu. Parowanie: uruchom aplikację,
wpisz adres add-onu (np. `192.168.1.10:8100`), panel pokaże 6-cyfrowy kod – wybierz go w **Tablety → Parowanie aplikacji**.
Ustawienia ekranu (wygaszanie, jasność, PIN) są w **Tablety → wybrany tablet → Ekran**.

Polecenia z Home Assistant (aplikacja i Fully):

```yaml
action: event.fire
data:
  event_type: wall_dashboard_command
  event_data:
    tablet: "Panel piętro"   # nazwa, id albo all
    command: saver             # reload | restart | screen-on | screen-off | saver | brightness
    value: 40                  # tylko brightness (0–100)
```

## Dzwonek z furtki przez centralę SIP (VitalPBX / Asterisk)

**Furtka i SIP** → „Sposób obsługi połączeń”:
- **Po staremu** – wyzwalacz z HA otwiera pop-up, obraz i rozmowa przez go2rtc, poczekalnia add-onu (IVR).
- **Przez centralę SIP** – furtka dzwoni do centrali, centrala odbiera, gra powitanie i muzykę i jednocześnie dzwoni do paneli i telefonów (numery wewnętrzne). Add-on przekazuje sygnalizację SIP (panel → add-on → centrala), głos idzie bezpośrednio panel ⇄ centrala (WebRTC). Obraz w pop-upie nadal z go2rtc.

Przełączenie w każdej chwili w obie strony – ustawienia SIP zostają zapisane.

### Centrala (VitalPBX)
1. **WebSocket SIP**: centrala musi nasłuchiwać SIP przez WebSocket (Asterisk: `ws://IP:8088/ws`, szyfrowane `wss://IP:8089/ws`).
2. **Numer furtki** (np. 100): zwykłe konto SIP (UDP). W panelu www furtki Hikvision włącz SIP, zarejestruj ją tym kontem i ustaw numer wywoływany = numer grupy dzwonienia (np. 600).
3. **Numery paneli i telefonów** (np. 201, 202…): konta z profilem **WebRTC** (DTLS-SRTP, ICE, rtcp-mux, transport WS/WSS).
4. **Grupa dzwonienia** (np. 600): wszystkie panele i telefony, dzwonią jednocześnie, czas 60 s; przed dzwonieniem komunikat powitalny, zamiast sygnału – muzyka oczekiwania; gdy nikt nie odbierze: komunikat pożegnalny i rozłączenie.
5. **Przechwytywanie połączeń**: panele i telefony w tej samej grupie przechwytywania (pickup group), kod z „Feature Codes” (często `*8`).

### Wall Dashboard
1. **Furtka i SIP** → **Przez centralę SIP**: adres WebSocket centrali (widziany z add-onu), kod przechwycenia, **Furtki**: numer furtki (100) → wyzwalacz, którego pop-up ma się pokazać (kamera go2rtc, „Otwórz furtkę”, historia dzwonków).
2. W karcie każdego tabletu: **numer wewnętrzny i hasło**. Telefony (zaznaczone jako „Telefon / iPad”): dodatkowo **powiadomienie** `notify.mobile_app_…`.
3. **Adres kiosku** ustaw na adres https (opcja „ssl” add-onu) – mikrofon w przeglądarce wymaga HTTPS, a powiadomienie otwiera ten adres.

### Jak to działa
- Panel z kontem SIP rejestruje się w centrali po otwarciu dashboardu; dzwonek otwiera pop-up z **Odbierz / Odrzuć / Otwórz furtkę**, w rozmowie **Wycisz / Rozłącz**. „Odrzuć” odrzuca dzwonek na wszystkich panelach (centrala przechodzi do pożegnania).
- Telefon dostaje push z aplikacji HA; stuknięcie otwiera Wall Dashboard, a „Odbierz” przejmuje dzwoniące połączenie kodem przechwycenia.
- Gdy SIP jest włączony, wyzwalacz z HA tej furtki nie otwiera pop-upu (robi to połączenie), a poczekalnia add-onu nie działa – jest w centrali.

## Własne motywy

Zakładka **Motywy** → **Nowy motyw na bazie** (Szkło, Mech, Grafit, Papier, Ocean) albo **Importuj** (JSON).

- **Kolory:** tło, kafelek, tekst, tekst drugorzędny, akcent, kafelek „włączony” (np. zapalone światło) z tekstem i ikoną, kolory OK i błędu.
- **Kafelki:**
  - **Pełne:** płaskie, bez rozmycia, najlżejsze dla słabych paneli;
  - **Szkło:** półprzezroczyste, krycie ustawiasz suwakiem.
- **Zaokrąglenie** kafelków i **czcionka:** systemowa, szeryfowa albo własna, np. z Google Fonts przez `@import` w CSS.
- **Własny CSS:** reguły są automatycznie zawężone do motywu (`[data-theme="…"]`), więc nie psują innych dashboardów.
- **Podgląd** na żywo pokazuje wybrany dashboard albo przykład.
- **Eksportuj** kopiuje motyw jako JSON, np. żeby przenieść go na inny HA.

Motyw wybierasz w edytorze dashboardu: **Motyw → Wygląd → „Mój: …”**. Zmiany motywu po zapisaniu trafiają od razu na tablety. Motywy okolicznościowe (Święta, Wielkanoc…), jeśli są włączone, mają pierwszeństwo w swoje dni.
