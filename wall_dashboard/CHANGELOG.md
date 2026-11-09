# Changelog

## 1.4.3
- Kamera na pełnym ekranie: **Zamknij** i **Wypełnij** przeniesione na dół (na iPhonie góra ekranu jest pod paskiem stanu / wycięciem), odstępy od krawędzi z bezpiecznych obszarów ekranu (notch, pasek gestów), mniejszy pad sterowania na telefonie.

## 1.4.2
- Kamera: **sterowanie góra / dół / lewo / prawo / zoom** na obrazie (w kafelku po dotknięciu ikony pada, na pełnym ekranie od razu, większe):
  - **ONVIF** (integracja ONVIF w HA): ruch, dopóki trzymasz przycisk, zatrzymanie po puszczeniu, pozycje zapisane w kamerze jako przyciski (pierwsza = „dom”);
  - **własne przyciski / skrypty** dla każdego kierunku (np. Tuya, Reolink, Hikvision) – przytrzymanie naciska je co 0,6 s.
- Z kiosku dozwolona jest tylko usługa `onvif.ptz` i tylko dla kamery z dashboardu.

## 1.4.1
- Asystent: przycisk **„Nowa rozmowa”** (czyści okno, agent zapomina kontekst) i **separator** w historii, gdy HA zaczął nową rozmowę (po 5 minutach ciszy albo po przeładowaniu) – widać, od kiedy asystent nie pamięta wcześniejszych pytań.
- Kamera: **pełny ekran** – przycisk w rogu kafelka (opcjonalnie dotknięcie obrazu), na pełnym ekranie przełącznik „Wypełnij / Cały obraz”, rozmowa i dźwięk działają jak w kafelku. Ustawienia widgetu: Pełny ekran (przycisk / dotknięcie / wyłączony) i domyślne dopasowanie obrazu.

## 1.4.0
- **Asystent (Assist z Home Assistant)** na tabletach – włączany osobno dla każdego tabletu (Tablety → Asystent):
  - okrągły przycisk w rogu ekranu, okno rozmowy z podpowiedziami, pisanie poleceń;
  - **przytrzymaj mikrofon i mów** – dźwięk idzie przez add-on do potoku Assist (rozpoznawanie mowy w HA);
  - **słowo wybudzające** – panel słucha cały czas (openWakeWord w HA), okno otwiera się samo; przerwa podczas rozmów (SIP / interkom), przy ukrytej aplikacji i – domyślnie – w trybie ciszy;
  - odpowiedź tekstem i głosem (TTS z potoku, nigdy w trybie ciszy), kontekst rozmowy przez 5 minut;
  - wybór potoku (agent: wbudowany, Ollama, OpenAI…, STT, TTS, słowo wybudzające) dla każdego tabletu.

## 1.3.9
- **Harmonogram termostatu Grenton** (integracja wirczur/homeassistant-grenton 0.3+): widget *Klimat* z encją Grenton ma przycisk „Harmonogram” – podgląd tygodnia jako kolorowe paski, edycja godzin (co 15 min) i temperatur (co 0,5°), dodawanie / usuwanie zmian, kopiowanie dnia na dni robocze / weekend / cały tydzień. Zapis wywołuje `grenton.set_thermostat_schedule` (cały tydzień). Działa też z tabletu – z kiosku dozwolona jest tylko ta jedna usługa Grentona i tylko dla termostatu z dashboardu. Przycisk można ukryć w ustawieniach widgetu.

## 1.3.8
- Widget robota ma własny margines wewnętrzny – przy małym „Marginesie wewn.” kafelka ikona, przyciski i pokoje nie dotykają już krawędzi.

## 1.3.7
- Nawadnianie **Rain Bird IQ4** (integracja Chapter-322/rainbird_iq4 1.8–1.10):
  - czas strefy do **100 min** (wcześniej 30);
  - liczba alarmów i ostrzeżeń sterownika w nagłówku, ostrzeżenie przy trybie sterownika „off”;
  - czujnik deszczu („mokro”) i opóźnienie według prognozy przy opóźnieniu deszczowym;
  - przy strefie godzina ostatniego podlewania;
  - „Wykryj” uzupełnia nowe encje (strefy są od 1.8 osobnymi urządzeniami – wykrywanie działa jak wcześniej).

## 1.3.6
- Robot koszący **Segway Navimow** (oficjalna integracja NavimowHA 1.1.x): bateria z atrybutu `battery` (bez osobnego czujnika), ikona zasięgu z `signal_strength`, opis błędu z atrybutu `error`.

## 1.3.5
- Widget robota – nowy wygląd pokoi: siatka kafelków z nazwą i ikonami trybu (odkurzanie / mop), znacznik pokoju, w którym jest robot, „Wszystkie / Żaden”, ustawienia pokoi w nagłówku. Szeroki kafelek: sterowanie po lewej, pokoje po prawej; przyciski nie rozciągają się na całą szerokość.
- Pokoje mogą mieć **nazwę wyświetlaną** (np. „Salon” zamiast „Living room2”) – nazwa z MyDyson zostaje do sterowania robotem.

## 1.3.4
- Robot Dyson Spot+Scrub: **ustawienia pokoi** z kafelka (przycisk z zębatką) – tryb (odkurzanie / odkurzanie + mop / tylko mop / najpierw odkurzanie, potem mop), moc, ilość wody, mycie mopa; przy pokojach widać ich tryb. Wybór trybu przy „Sprzątaj wybrane” jest zawsze widoczny (wcześniej tylko z encją „Tryb sprzątania”).
- „Wykryj urządzenie” zbiera wszystkie ustawienia pokoi z hass-dyson.

## 1.3.3
- **Robot Dyson (hass-dyson 0.39, Spot+Scrub / Vis Nav)** w widgecie *Robot*:
  - aktualny pokój przy stanie, stan stacji dokującej z godziną końca;
  - mapa pokrycia sprzątania w okienku (odświeżana w trakcie sprzątania);
  - sprzątanie wybranych pokoi z wyborem trybu (odkurzanie / mop), przez `hass_dyson.start_zone_clean`;
  - „Wykryj urządzenie” uzupełnia nowe encje i pokoje automatycznie.

## 1.3.2
- *Sceny i automatyzacje* pokazują tylko sceny i automatyzacje utworzone w Wall Dashboard (pozostałe z HA są pomijane). Automatyzacja telewizora sceny nie jest pokazywana osobno – scena ma dopisek „+ telewizor”.

## 1.3.1
- **Telewizor w scenie**: w kreatorze sceny można dodać telewizor z pilota Wall Dashboard – włącz / wyłącz, aplikacja, wejście (TV, HDMI 1–4), dodatkowe klawisze. Obok sceny powstaje automatyzacja „Scena „…” – telewizor”, która przy włączeniu sceny wysyła zdarzenie `wall_dashboard_tv`; add-on wykonuje kroki (z Wake-on-LAN, gdy telewizor jest wyłączony). „Podgląd – ustaw teraz w domu” steruje też telewizorem.
- Nowe zdarzenie HA `wall_dashboard_tv` do sterowania telewizorem z własnych automatyzacji i skryptów.

## 1.3.0
- **Nowy panel zarządzania**: menu z boku zamiast zakładek u góry (Wygląd / Urządzenia / Dzwonek i automatyka / System), działa też na telefonie.
- **Stan** – strona startowa: panele online, centrala SIP, dzwonki z dziś, tryb ciszy, ostatnie dzwonki i lista „Wymaga uwagi” (panel offline, stara aplikacja Android, panel niezarejestrowany w centrali, brak HTTPS, go2rtc nie odpowiada).
- **Tablety**: lista ze stanem na żywo (online / offline od…, aplikacja i wersja, ekran, rejestracja SIP) i szczegóły w zakładkach Ogólne · Dashboardy · Ekran · Rozmowy · Cisza; szybkie akcje; kolejność dashboardów tabletu.
- **Dashboardy**: miniatury w kolorach motywu, „używany na”, szukanie (także po encjach), szablony siatki (tablet, panel 1:1, telefon), import / eksport JSON, zmiana nazwy.
- **Edytor**: struktura po lewej (widoki, panele boczne, lista widgetów, szybkie dodawanie), właściwości w zakładkach Widget / Widok / Dashboard, pasek „Używany na”, ostrzeżenia dashboardu, podgląd motywów okolicznościowych i **Na tablecie** (niezapisana wersja na wybranym tablecie przez 3 minuty).
- Ustawienia (adres kiosku, go2rtc), Furtka i SIP oraz Kopia zapasowa mają własne strony.

## 1.2.0
- **Własne motywy** (nowa zakładka *Motywy*):
  - kolory tła, kafelków, tekstu, akcentu i stanu „włączony”;
  - kafelki pełne lub szklane, zaokrąglenie, czcionka;
  - własny CSS (automatycznie zawężony do motywu);
  - podgląd na żywo na wybranym dashboardzie;
  - gotowe punkty startowe (Szkło, Mech, Grafit, Papier, Ocean), import i eksport JSON.

  Wybór w edytorze: *Motyw → Wygląd → „Mój: …”*. Motyw obejmuje też pop-upy i panele boczne na tabletach.
- README repozytorium: opis funkcji, instalacja w HA (również z prywatnego repozytorium) i przykładowe zrzuty ekranu.

## 1.1.4
- Panel boczny i pop-up otwierane z kafelka na ekranach dotykowych od razu się zamykały (kliknięcie z tego samego dotknięcia trafiało w tło panelu). Tło ignoruje teraz kliknięcia przez 0,45 s po otwarciu.

## 1.1.3
- Telewizory Samsung: wykrywanie Jellyfin – wersja ze sklepu Samsung (3202007021208) i wgrana ręcznie (AprZAARz4r.Jellyfin).

## 1.1.2
- Głośność rozmowy SIP osobno od powiadomień: w trakcie rozmowy przyciski − / + (50–400%, wzmocnienie głosu rozmówcy, panel zapamiętuje ustawienie). W ustawieniach tabletu: „Głośność systemu w rozmowie” (na czas rozmowy, potem powrót do poprzedniej) i „Wzmocnienie głosu rozmówcy”.
- „Głośność powiadomień i dzwonka” dla każdego tabletu (domyślna dla dźwięków panelu; głośność w wyzwalaczu ma pierwszeństwo).
- Aplikacja na Androida 0.1.4: rozmowa SIP zawsze na głośniku (tryb komunikacji – na niektórych panelach dźwięk szedł do nieistniejącej słuchawki i był bardzo cichy), procesor nie zasypia przy wyłączonym ekranie, dashboard ma wysoki priorytet także w tle – dzwonek SIP dochodzi od razu.

## 1.1.1
- Cisza na panelu z opcją „W ciszy nie przyjmuj rozmów z interkomu” dotyczy też centrali SIP: add-on sam odpowiada centrali „zajęty” (486), panel nie dzwoni i nie pokazuje pop-upu, a grupa dzwonienia dzwoni dalej na pozostałe panele i telefony. Bez tej opcji cisza tylko wycisza dźwięki, jak dotąd.

## 1.1.0
- **Dzwonek z furtki przez centralę SIP** (VitalPBX / Asterisk) – do wyboru w Tablety → Dzwonek z furtki: „po staremu” (wyzwalacz HA + go2rtc + poczekalnia add-onu) albo „przez centralę SIP”. W trybie SIP panele i telefony są numerami wewnętrznymi centrali: centrala odbiera furtkę, gra powitanie i muzykę i dzwoni do wszystkich; pop-up ma Odbierz / Odrzuć / Otwórz furtkę, w rozmowie Wycisz / Rozłącz. Głos idzie bezpośrednio panel ⇄ centrala, add-on przekazuje tylko sygnalizację (działa przez HTTPS kiosku).
- Telefony: push z aplikacji HA przy dzwonku; po otwarciu „Odbierz” przejmuje połączenie kodem przechwycenia (np. *8). Historia dzwonków i powiadomienia działają także w trybie SIP.
- Na czas rozmowy SIP dashboard w tle jest wstrzymywany (słabe panele). Instrukcja konfiguracji centrali w dokumentacji add-onu.

## 1.0.9
- Poczekalnia (IVR): „Odbierz w domofonie” jest naciskany ponownie (co 2 s, do 6 razy), dopóki stan połączenia (encja wyzwalacza, np. Call state z Hikvision Doorbell) nie przestanie być „dzwoni” – domofon ignoruje odebranie w pierwszej chwili połączenia. Muzyka startuje po odebraniu; w logu widać każdą próbę i moment odebrania.

## 1.0.8
- Przewijanie list (AGD, historia dzwonków, panel boczny) na dużych ekranach: przeciąganie myszą / rysikiem / ramką dotykową USB (zgłaszają się jak mysz) przewija listę jak palcem; puszczenie po przeciągnięciu nie jest kliknięciem.
- Starsze WebView: gdy palec przesuwa listę, a przeglądarka jej nie przewija, panel przewija ją sam.

## 1.0.7
- Poczekalnia (IVR) jako zamiennik dzwonka: add-on sam odbiera domofon, gra powitanie i muzykę, a gdy przez ustawiony czas (domyślnie 60 s od dzwonka) nikt nie odbierze na panelu ani telefonie – mówi pożegnanie, zamyka pop-upy i rozłącza domofon (nowe pole „Rozłącz domofon” + „Rozłącz, gdy nikt nie odbierze, po (s)”).
- „Odrzuć” na panelu rozłącza domofon, gdy połączenie odebrała poczekalnia. Gdy odwiedzający sam się rozłączy (stan „zamknij przy”), poczekalnia kończy się bez pożegnania.
- Pop-up na panelach czeka tyle, ile poczekalnia.

## 1.0.6
- Poczekalnia (IVR): przycisk odsłuchu przy dźwięku (powitanie, muzyka) gra z ustawioną głośnością.
- Poczekalnia: start bez opóźnienia przy „po 0 s” – mowa z HA i ściszony dźwięk są przygotowywane z góry (po zapisaniu reguł i po starcie add-onu), a adres mowy z HA jest pamiętany. Po naciśnięciu „odbierz” add-on czeka 1 s, aż domofon otworzy kanał audio, i sprawdza, czy dzwonek nadal trwa.

## 1.0.5
- Poczekalnia (IVR): dźwięk z głośnością inną niż 100% jest najpierw przygotowywany jako gotowy plik WAV (znana długość, zapisany na kolejne połączenia) zamiast przesyłania „na żywo” – go2rtc odtwarza go jak zwykły plik. Błędy przygotowania widać w logu i po przycisku testu.

## 1.0.4
- Poczekalnia (IVR): głośność inna niż 100% działa. go2rtc odrzuca źródła ze spacjami („source with spaces may be insecure”), więc filtr głośności nie mógł do niego trafić – teraz add-on sam przygotowuje ściszony / wzmocniony dźwięk (FFmpeg w obrazie add-onu, 100% bez zmian).
- Poczekalnia: powitanie po polsku – mowa z HA zawsze z językiem „pl” (wcześniej silnik czytał polski tekst angielskim głosem); wybór silnika TTS z listy, język i głos (np. HA Cloud ZofiaNeural, Piper pl_PL-gosia-medium).
- Przycisk testu poczekalni pokazuje prawdziwą przyczynę błędu (brak silnika TTS, odpowiedź go2rtc).

## 1.0.3
- Zegar na wygaszonym ekranie (aplikacja Wall Dashboard na Androida, tryb „czarny ekran”): osobno w trybie nocnym (okna godzinowe) i po wygaszeniu w dzień; opcjonalnie data, do 4 wartości z HA (np. temperatura na zewnątrz, alarm) i nieodebrane dzwonki. Przygaszony, co minutę lekko przesuwany (ochrona ekranu). Ustawienia: Tablety → Ekran i aplikacja → Zegar na wygaszonym ekranie. Wymaga aplikacji 0.1.3.

## 1.0.2
- Parowanie aplikacji: przy każdym kodzie wybór „Nowy tablet” albo istniejący tablet; urządzenie parowane ponownie samo podpowiada tablet, z którym było sparowane (zachowuje klucz, dashboardy i ustawienia). Ręczne wpisanie kodu zwinięte pod „Wpisz kod ręcznie”.
- Podpowiedź: aplikację paruj adresem https:// (opcja „ssl” add-onu) – bez tego nie działa mikrofon.

## 1.0.1
- Telewizory Samsung: uruchamianie aplikacji działa na nowszych modelach – add-on próbuje kolejno REST, DEEP_LINK i NATIVE_LAUNCH i sprawdza w telewizorze, czy aplikacja wystartowała. Gdy żaden sposób nie zadziała, panel pokazuje komunikat.
- Wykrywanie aplikacji: także Apple Music, Deezer i inne wersje Disney+.

## 1.0.0
Pierwsze publiczne wydanie.
- Dashboardy na tablety ścienne: kiosk (link z kluczem per tablet) i edytor w panelu HA (widoki, siatka, motywy, wizualny edytor, JSON).
- Widgety: przyciski, światła, rolety, klimatyzacja / termostat (z funkcjami dodatkowymi), media, kamery (WebRTC / MSE / HLS), kalendarz, pogoda, urządzenia AGD, robot, oczyszczacz, szambo, UPS, alarm, nawadnianie, wykresy i inne.
- Dom 3D z rzutów SVG (import własnych rzutów), urządzenia na modelu.
- Pop-upy z automatyzacji (domofon / furtka), wyzwalacze, dźwięki i mowa na tabletach, tryb ciszy, historia dzwonka i poczekalnia (IVR).
- Interkom głosowy między panelami, pilot telewizorów Samsung.
- Aplikacja na telefon / iPad (ekran główny), przesuwanie palcem między widokami.
- Kopia zapasowa i przywracanie, parowanie aplikacji Wall Dashboard na Androida, polecenia dla paneli z HA.
