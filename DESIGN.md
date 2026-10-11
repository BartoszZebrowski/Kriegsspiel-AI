# Kriegsspiel AI — dokument projektowy

Wersja 0.1 · 2026-10-11 · wynik sesji sokratejskiej

## 1. Idea w jednym akapicie

Gra sztabowa w duchu Kriegsspiela, osadzona we współczesnym konflikcie (realnym lub hipotetycznym) na prawdziwym terenie. Gracz dowodzi jedną stroną, wydając **rozkazy tekstem w komunikatorze aplikacji**. Claude pełni kilka ról naraz: autora scenariusza, dowódcy przeciwnika (działającego realistycznie dla danej armii), sędziego, który ocenia skutki rozkazów i zarządza mgłą wojny, a także wszystkich postaci po stronie gracza (przełożony, sąsiedzi, podwładni, szef logistyki). Aplikacja w przeglądarce to **mapa sztabowa i komunikator gracza**: pokazuje to, co gracz wie, a nie to, co jest prawdą.

## 2. Role

| Kto | Co robi |
|---|---|
| **Gracz** | Wydaje rozkazy w komunikatorze aplikacji (manewr, ogień, zadania rozpoznania, logistyka). Czyta meldunki. Rysuje na mapie własne notatki i plany. W Claude Code wpisuje tylko „koniec tury”. |
| **Claude** | Tworzy scenariusz i odprawę. Prowadzi wojska przeciwnika. Rozstrzyga swobodnie, jak sędzia w „wolnym Kriegsspielu”. Odgrywa postacie po stronie gracza i pisze w ich imieniu. Aktualizuje mapę gracza. Na końcu pisze raport z ćwiczeń. |
| **Aplikacja** | Wyświetla stan wiedzy gracza, zegar gry i komunikator. Daje narzędzia sztabowe i legendę symboli. Odtwarza bitwę w trybie „po bitwie”. |

## 3. Zasady gry (ustalone)

- **Rozkazy** są wyłącznie tekstowe i trafiają do adresata przez komunikator. Mapa nie jest rozkazem, a strzałki gracza nie są wiążące.
- **Własne jednostki:** pozycja na mapie jest zawsze prawdziwa. Przesuwa je Claude po rozstrzygnięciu tury. Na starcie pozycje własne też są prawdziwe.
- **Mgła wojny dotyczy przeciwnika.** Gracz zna wroga tylko z meldunków rozpoznania.
- **Odprawa może się mylić:** wywiad na starcie podaje oceny, a nie prawdę.
- **Rozpoznanie jest zasobem gracza.** Ma on określone środki (np. 3 drony) i przydziela im zadania rozkazem. Claude melduje tylko to, co dany środek mógł zobaczyć.
- **Meldunki** wyglądają jak prawdziwe raporty, np. *„Dron Bayraktar, 14:22, kolumna ~10 pojazdów, kierunek wsch., pewność średnia”*. Mogą być spóźnione, niepełne lub błędne (makiety, wabiki).
- **Rozstrzyganie:** swobodny osąd Claude. Gracz widzi tylko meldunek, a nie mechanikę.
- **Przeciwnik** działa realistycznie dla swojej armii: doktryna, ograniczenia, typowe błędy.
- **Tura:** długość ustalana w scenariuszu (np. 15 min dla kompanii, 2–4 h dla dywizji, dłużej dla kampanii).
- **Skala:** od kompanii do kampanii, zależnie od scenariusza. Im wyższy szczebel, tym dłuższy scenariusz.
- **Ocena końcowa:** raport w stylu omówienia ćwiczeń sztabowych (co zakładałeś, co było naprawdę, decyzje kluczowe, wnioski).
- **Uczciwość:** prawda leży w plikach na dysku, a gracz do niej nie zagląda (umowa honorowa).

## 4. Przebieg tury

```
1. Gracz pisze w komunikatorze aplikacji: rozkazy do brygad, zadania dla
   rozpoznania, polecenia dla szefa logistyki, meldunki do przełożonego
   → player/outbox/NNN.json
2. Gracz wpisuje w Claude Code „koniec tury”.
3. Claude czyta prawdę (umpire/) i skrzynkę nadawczą, rozstrzyga turę:
   – ruch, walka i logistyka obu stron,
   – co zobaczyło rozpoznanie gracza,
   – co robią przełożony i sąsiedzi.
4. Claude zapisuje:
   – nową prawdę         → umpire/turns/NNN.json
   – nowy widok gracza   → player/turns/NNN.json (jednostki, kontakty, logistyka)
   – wiadomości postaci  → player/inbox/NNN.json (każda w swoim kanale)
5. Aplikacja wykrywa nowe pliki i odświeża mapę oraz komunikator.
6. Gracz analizuje, rysuje notatki (player/notes/NNN.json), pisze kolejne rozkazy.
```

## 5. Pliki scenariusza

```
scenarios/<nazwa>/
  scenario.json          # metadane: tytuł, strony, region, czas startu, długość tury, skala
  briefing.md            # odprawa dla gracza (zadanie, siły własne, ocena wywiadu)
  player/                # wszystko, co gracz może widzieć
    turns/000.json       # widok gracza na start tury N
    notes/000.json       # rysunki i notatki gracza z tury N
    outbox/000.json      # wiadomości i rozkazy gracza wysłane w turze N
    inbox/000.json       # wiadomości postaci otrzymane na start tury N
  umpire/                # PRAWDA — gracz tu nie zagląda
    turns/000.json       # pełny stan obu stron
    enemy-plan.md        # zamiar i plan przeciwnika
    log.md               # notatki sędziowskie z rozstrzygnięć
  aar.md                 # raport z ćwiczeń (po bitwie)
```

### Widok gracza (`player/turns/NNN.json`), szkic

```json
{
  "turn": 3,
  "time": "2026-05-14T06:45:00+02:00",
  "units": [
    { "id": "b1-1zmot", "name": "1. bzmot", "sidc": "10031000001211000000",
      "pos": [22.95, 54.10], "strength": 0.85, "status": "w obronie" }
  ],
  "contacts": [
    { "id": "c-017", "observed": "2026-05-14T06:22:00+02:00", "source": "BSP-2",
      "pos": [23.02, 54.13], "uncertainty_m": 500, "estimate": "kompania czołgów?",
      "sidc": "10061000001205000000", "confidence": "średnia" }
  ],
  "assets": [ { "id": "BSP-2", "type": "dron rozpoznawczy", "status": "w powietrzu", "task": "obserwacja rejonu Kolonia" } ],
  "reports": [ { "time": "...", "from": "...", "text": "..." } ]
}
```

Prawda (`umpire/turns/NNN.json`) ma ten sam format jednostek, ale zawiera obie strony i nie ma w niej „kontaktów”.

## 6. Aplikacja

**Technologia (propozycja):** statyczna aplikacja web + mały lokalny serwer (Node), który serwuje pliki scenariusza, zapisuje notatki gracza i powiadamia mapę o zmianach plików.

- **Mapa:** MapLibre GL JS lub Leaflet.
- **Symbole NATO:** biblioteka `milsymbol` (APP-6 / MIL-STD-2525).
- **Podkłady (przełączane):** OpenStreetMap, OpenTopoMap (topografia/poziomice), zdjęcia satelitarne (np. Esri World Imagery), cieniowanie rzeźby terenu. Zgodnie z warunkami i atrybucją dostawców.

**Funkcje:**
- jednostki własne i kontakty wroga jako symbole NATO; kontakt pokazuje czas obserwacji, źródło, pewność i promień niepewności, a wraz z wiekiem informacji blaknie,
- panel meldunków (chronologiczny, filtrowany po turze/źródle),
- zegar gry: tura, godzina, długość tury,
- warstwa notatek gracza: strzałki, linie frontu, rejony, opisy,
- pomiar odległości i szacowany czas marszu,
- wczytanie scenariusza i odprawy,
- **tryb „po bitwie”:** suwak czasu po turach, warstwy „co wiedziałem” / „prawda” / „moje notatki”, przełączane lub nałożone; obok raport z ćwiczeń.

## 7. Plan budowy

**v0.1 — plansza**
1. Szkielet aplikacji + lokalny serwer, przełączanie podkładów.
2. Wczytanie `player/turns/NNN.json`, symbole NATO z legendą i podpowiedziami, zegar.
2a. Komunikator z kanałami (inbox/outbox).
3. Automatyczne odświeżanie po zapisie nowej tury.
4. Scenariusz testowy (mały, poziom batalionu/brygady) napisany przez Claude.

**v0.2 — narzędzia sztabowe**
5. Warstwa notatek gracza z zapisem per tura.
6. Pomiar odległości/czasu marszu, starzenie się kontaktów.
7. Warstwa logistyczna: składy, MSR, mosty, konwoje, panel DOS.

**v0.3 — po bitwie**
8. Suwak czasu, nakładanie prawdy, wyświetlanie `aar.md`.

**v0.4 — Claude jako sędzia**
9. `CLAUDE.md` z instrukcją sędziego: formaty plików, styl meldunków, zasada nieujawniania prawdy, procedura tury. Dzięki temu każda nowa sesja z Claude wie, jak prowadzić grę.

**Później:** rzeźba terenu i linia wzroku (widoczność dla dronów), walka elektroniczna, II wojna światowa z historycznymi mapami (WIG, AMS).

## 8. Ograniczenia, o których warto pamiętać

- Wiedza Claude o realnych konfliktach pochodzi z otwartych źródeł i ma datę graniczną. Scenariusze „realne” są realistyczne, ale nie odwzorowują aktualnej, dokładnej sytuacji.
- Claude nie pamięta między sesjami. Ciągłość gry zapewniają wyłącznie pliki scenariusza.
- Umowa honorowa: plik prawdy jest zwykłym plikiem na dysku.

## 9. Decyzje po rundzie 2

- **Kontakty wroga** nanosi Claude (z meldunków). Gracz może dopisywać własne przypuszczenia w warstwie notatek.
- **Walka elektroniczna** może ograniczać wiedzę o własnych wojskach: jednostka bez łączności zostaje „zamrożona” na ostatniej znanej pozycji, z oznaczeniem czasu ostatniego kontaktu. Etap późniejszy.
- **Pierwszy scenariusz:** hipotetyczny atak Rosji i Białorusi na Polskę z kierunku Białorusi i Kaliningradu.
- **Logistyka ma być istotną częścią gry** (sekcja 10).
- **Gracz:** dowódca dywizji po stronie polskiej. Polska walczy sama, bez posiłków NATO.
- **Czas trwania** zależy od skali scenariusza: krótko dla kompanii, długo (nawet miesiące) dla wyższych szczebli.

## 10. Logistyka

**Zasada:** gracz wydaje rozkazy szefowi logistyki (priorytety, trasy, rozmieszczenie punktów). Nie przelicza ciężarówek. Widzi za to na mapie całą sieć zaopatrzenia i stan jednostek.

**Stan każdej jednostki** jest liczony w dobach zaopatrzenia (DOS):
- paliwo (kl. III): bez paliwa jednostka nie manewruje,
- amunicja (kl. V): bez amunicji spada siła ognia, a artyleria musi racjonować,
- sprawność sprzętu: marsze i walka powodują awarie, naprawa wymaga czasu i zaplecza,
- zaopatrzenie ogólne (żywność, woda, medyczne) jako jeden wskaźnik.

Zużycie zależy od działania (postój < obrona < marsz < natarcie pod ogniem).

**Sieć na mapie:**
- składy, punkty zaopatrzenia, rejony napraw i ewakuacji,
- główne i zapasowe drogi zaopatrzenia (MSR/ASR) po realnych drogach i torach,
- węzły krytyczne: mosty (Wisła, Narew, Biebrza, Bug), stacje, skrzyżowania,
- konwoje jako obiekty na mapie: mają trasę i czas przejazdu, mogą zostać trafione.

**Mgła w logistyce:**
- własne zapasy gracz zna z meldunków logistyki, które mogą być opóźnione lub zawyżone,
- zapasów wroga gracz nie zna; może je wywnioskować z obserwacji (kolumny cystern, spadek tempa ostrzału, stojące jednostki),
- skutki uderzeń w logistykę wroga pojawiają się z opóźnieniem.

**Specyfika teatru:**
- Kaliningrad jest odcięty i ma skończone zapasy, co działa jak zegar scenariusza,
- rosyjska logistyka opiera się na kolei i ma mało ciężarówek; natarcie słabnie wraz z odległością od węzłów kolejowych,
- polskie zaopatrzenie płynie z zachodu przez ograniczoną liczbę przepraw.

**Aplikacja:**
- warstwa sieci logistycznej,
- panel DOS dla każdej jednostki,
- konwoje na mapie,
- w trybie „po bitwie” prawdziwy stan logistyki przeciwnika.

**Pliki:** w `player/turns/NNN.json` i `umpire/turns/NNN.json` dochodzą pola `supply` (dla każdej jednostki), `depots`, `routes` i `convoys`.

## 11. Dowodzenie i komunikacja

**Komunikator w aplikacji** (wariant B):
- osobny kanał dla każdego korespondenta: przełożony (dowództwo operacyjne), dywizje sąsiednie, każda podległa brygada lub pułk, szef logistyki, rozpoznanie,
- gracz pisze w aplikacji, a wiadomości trafiają do `player/outbox/`,
- postacie odpisują po rozstrzygnięciu tury w swoich kanałach (`player/inbox/`),
- postacie piszą też same z siebie, na przykład sąsiad o 03:40: „wycofujemy się z Augustowa, wasze prawe skrzydło odsłonięte”. Takie wiadomości pojawiają się zawsze w rozstrzygnięciu tury, bo Claude działa tylko po komendzie „koniec tury”.

**Przełożony:**
- daje zadanie, granice pasa działania i zasoby,
- może odmówić wsparcia albo wydać rozkaz, z którym gracz się nie zgadza (np. „utrzymać Ełk za wszelką cenę”).

**Sąsiedzi:**
- prowadzą własną walkę i meldują o swojej sytuacji,
- ich porażka może odsłonić skrzydło gracza.

**Na mapie:**
- sztab przełożonego jako symbol NATO,
- dywizje sąsiednie przedstawione ogólnie (rejon, linia styczności),
- granice pasa działania dywizji.

## 12. Legenda symboli

Panel boczny z legendą symboli NATO:
- **domyślnie** pokazuje tylko symbole obecne aktualnie na mapie, z polskim opisem (np. „brygada zmechanizowana”, „kompania czołgów — kontakt”),
- **pełna ściąga** pokazuje podstawy systemu: rodzaj sił (kształt i kolor ramki), rodzaj wojsk (ikona w środku), wielkość jednostki (znaczek nad ramką), ramka przerywana dla obiektów przewidywanych lub niepotwierdzonych,
- **podpowiedź** po najechaniu na symbol na mapie: pełny opis jednostki lub kontaktu.
