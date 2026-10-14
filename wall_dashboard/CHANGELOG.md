# Changelog

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
