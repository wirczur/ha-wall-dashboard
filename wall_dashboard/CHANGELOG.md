# Changelog

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
