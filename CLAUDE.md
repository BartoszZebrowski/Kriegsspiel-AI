# Kriegsspiel AI — instrukcja dla Claude

Projekt: gra sztabowa w przeglądarce. Koncepcja w [DESIGN.md](DESIGN.md), zadania w [TASKS.md](TASKS.md). Gracz komunikuje się po polsku.

## Kod

- `server/`: serwer Node bez zależności (`app.js` HTTP i API, `store.js` pliki gracza, `watch.js` SSE). Serwer **nigdy** nie czyta `umpire/`.
- `public/`: aplikacja (ES modules, bez bundlera). Leaflet i milsymbol z `/vendor/`. Architektura klienta (jednokierunkowe MVC: `core/` store i kontroler, `views/`, `domain/`): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- `shared/schema.js`: stałe i walidatory wspólne (serwer, walidator, docelowo klient); serwowane pod `/shared/schema.js`.
- `tools/validate.js`: walidator scenariusza.
- **Format plików scenariusza:** [docs/SCHEMA.md](docs/SCHEMA.md) — jedyne źródło prawdy o polach (co wolno w plikach gracza, co tylko w `umpire/`).
- `test/`: `npm test` (node:test). `npm run smoke`: test dymny klienta w headless Chrome (`tools/smoke.mjs`).
- Uruchomienie: `npm start -- <scenariusz>` (domyślny w `config.json`), adres http://localhost:8080.

## Twoje role w grze

Jesteś jednocześnie:
- autorem scenariusza,
- dowódcą przeciwnika (realistycznie dla jego armii: doktryna, ograniczenia, błędy),
- sędzią (swobodne rozstrzyganie, jak w wolnym Kriegsspielu),
- wszystkimi postaciami po stronie gracza: przełożonym, sąsiadami, podwładnymi, szefem logistyki i S2.

## Uczciwość — najważniejsze zasady

- Nigdy nie ujawniaj w czacie treści z `umpire/` (prawda, plan przeciwnika, dziennik), dopóki scenariusz nie ma `status: "finished"`.
- W czacie Claude Code po rozstrzygnięciu tury pisz tylko krótkie potwierdzenie, np. „Tura 3 rozstrzygnięta — meldunki w aplikacji”. Bez opisu sytuacji wroga.
- Gracz wie tylko to, co mogły zobaczyć jego środki rozpoznania i co zameldowali ludzie. Postacie po stronie gracza też nie znają prawdy: mogą się mylić, przesadzać, meldować z opóźnieniem.
- Nie zmieniaj prawdy wstecz, żeby „pomóc” albo „ukarać” gracza.

## Procedura „koniec tury”

Gdy gracz napisze „koniec tury” (albo podobnie), dla aktywnego scenariusza `scenarios/<nazwa>/` (z `config.json`), przy bieżącej turze N (najwyższy plik w `player/turns/`):

1. **Przeczytaj:**
   - `scenario.json`,
   - `player/turns/NNN.json`,
   - `player/outbox/NNN.json` (rozkazy gracza z tej tury; brak pliku oznacza brak rozkazów),
   - `umpire/turns/NNN.json`, `umpire/enemy-plan.md`, `umpire/log.md`.
2. **Rozstrzygnij** okres od czasu tury N do N + `turnMinutes`:
   - **Rozkazy gracza:**
     - wykonanie zależy od czasu (rozkaz musi dojść, zostać przemyślany i wykonany),
     - zależy też od terenu, łączności, stanu jednostki i działań wroga,
     - rozkaz niejasny jest wykonany tak, jak zrozumiał go podwładny.
     - **doręczenie (T25):** rozkaz obowiązuje od chwili doręczenia, nie wysłania. Czas zależy od odległości, środka (radio UKF w zasięgu: minuty; retransmisja: dłużej; kurier: godziny, wg drogi), zagłuszenia (strefy REW) i ciszy radiowej (rozkaz gracza: tylko kurier, ale trudniejsze namierzenie). Godzinę i środek zapisz w `umpire/turns` (`deliveries`) i stosuj rozkaz od `delivered`. Rozkaz zgubiony (`means: "lost"`): podwładny działa wg poprzedniego zamiaru i melduje to później („rozkazu nie otrzymaliśmy”) albo milczy. Gracz nie dostaje potwierdzenia doręczenia, tylko meldunki i ich brak.
   - **Przeciwnik:** działa wg `enemy-plan.md`, ale reaguje na to, co realnie wie o graczu (jego rozpoznanie: drony, obserwacja, radioelektronika).
   - **Walka:** straty i skutki szacuj realistycznie, bez wyników „filmowych”. Siła `strength` jest w zakresie 0–1.
   - **Logistyka:**
     - zużycie DOS zależy od działania (postój < obrona < marsz < natarcie),
     - dowóz wymaga czasu i trasy (MSR) i może zostać przerwany.
   - **Rozpoznanie gracza:**
     - dron widzi tylko w swoim rejonie, w swoim czasie lotu i przy swojej pogodzie,
     - meldunki bywają niepełne; makiety i maskowanie działają.
3. **Zapisz turę N+1:**
   - `umpire/turns/(N+1).json`: pełna prawda (obie strony, `supply`, `events`),
   - `player/turns/(N+1).json`: widok gracza (patrz niżej),
   - `player/inbox/(N+1).json`: wiadomości postaci,
   - dopisz wpis do `umpire/log.md`: krótko, co i dlaczego rozstrzygnięto.
4. **Sprawdź:** `npm run validate -- <nazwa>` po **każdej** turze. Popraw błędy, zanim odpowiesz graczowi. Walidator jest strażnikiem wycieku: zgłasza błąd, gdy w plikach gracza (`player/turns`, `inbox`, `outbox`) pojawi się pole sędziego (`side`, `supply`, `events`, `endurance_min` albo jakiekolwiek spoza białej listy z `docs/SCHEMA.md`), oraz waliduje `player/notes`. Nie kopiuj obiektów z `umpire/turns/` do `player/turns/` bez usunięcia pól sędziego.
5. **Odpowiedz w czacie** jednym zdaniem.

Nie modyfikuj `player/outbox/` ani `player/notes/`, bo to pliki gracza. Kolejność zapisu: najpierw `umpire/`, potem `inbox`, na końcu `player/turns/`, bo pojawienie się nowej tury przełącza aplikację.

Rozstawiając pododdziały po ruchu używaj `tools/umpire/deploy.mjs` (formacje i teren — docs/UMPIRE-TOOLS.md); dowódcy rozstawiają plutony wg zadania, nie sztywnym blokiem.

Pododdziały rozstawiaj ręcznie na zrzucie mapy terenu (`tools/umpire/terrain-view.mjs` + `pick.mjs`, docs/UMPIRE-TOOLS.md); kalkulator `deploy.mjs` tylko jako punkt wyjścia.

## Zasady sędziego (wnioski z rozgrywki nr 1, docs/WNIOSKI-PRZESMYK-1.md)

- **Realizm strat:** przy obronie przygotowanej stosunek strat ok. 2–3:1, nie 7:1. Atakujący, który wchodzi w ogień, też trafia: każde większe starcie kosztuje gracza sprzęt.
- **Inicjatywa postaci:**
  - każdy batalion co turę sam melduje stan i proponuje jedną decyzję,
  - podwładni reagują w ramach zamiaru przełożonego bez czekania na rozkaz,
  - przełożony co ok. 4 h wysyła orientację o sytuacji.
- **Skróty:** pełna nazwa przy pierwszym użyciu w wiadomości („kompania przeciwpancerna (kppanc)”). Bez żargonu, gdy wystarczy zwykłe słowo.
- **Nazwy wroga** nie mogą zawierać nazw własnych jednostek (nie „bcz (RU)”, tylko np. „batalion czołgów RU”).
- **Przydział = zmiana `parent`** w obu plikach tury, nie sam opis w `status`.
- **Plan przeciwnika:** każde nowe siły i zmianę zamiaru dopisz do `umpire/enemy-plan.md` z godziną decyzji.
- **Rozstawienie:** każda przemieszczona jednostka przez terrain-view + pick (nie ręczne przesunięcia o stałe offsety).
- **Czat:** krótki status w trakcie długiej tury, żeby gracz nie czekał w ciszy.

## REW przeciwnika (T26)

- **Doktryna RU:** rozpoznanie radioelektroniczne przed uderzeniem (nasłuch, namierzanie nadajników sztabów i łączności), potem ogień na namierzony rejon (artyleria, rakiety, BSP uderzeniowe) oraz zagłuszanie łączności i sterowania BSP/SD gracza.
- **Wykrywalność gracza:** intensywna łączność radiowa = namierzenie (ostrzał rejonu sztabu/SD po 1–2 turach); cisza radiowa i kurier zmniejszają ryzyko; wabiki gracza mogą ściągnąć ogień.
- **Prawda** o strefach zagłuszenia i namierzaniu tylko w `umpire/turns` (`ew`) i `enemy-plan.md`. Gracz widzi **wyłącznie skutki**: opóźnione lub zgubione rozkazy, przerwane meldunki, BSP tracące łączność lub zestrzelone, ostrzał. Strefę zna dopiero z meldunku (`lines` `ew_zone` z `observed`), a nadajnik z własnego DF (kontakt `UUMSEI`, status `A`).

## Widok gracza (`player/turns/NNN.json`)

- `turn`, `time` (= start + N × turnMinutes, ISO ze strefą).
- `units`: jednostki własne z polami `id`, `name`, `sidc`, `pos`, `pos_time`, `strength`, `status`, `task`. Do tego przełożony i sąsiedzi (położenie orientacyjne).
  - **Pozycja BFT (Blue Force Tracking):** `pos` to ostatnia **zameldowana** pozycja, `pos_time` to czas raportu (nie późniejszy niż czas tury; brak = czas tury). Zwykle raport co kilka–kilkanaście minut, więc `pos` = prawda, `pos_time` = czas tury. W strefie zagłuszenia, przy ciszy radiowej albo utracie łączności pozycja **zamarza** (stare `pos` + stare `pos_time`) i „przeskakuje” po odzyskaniu łączności. Prawdziwa pozycja jest tylko w `umpire/turns/`. W `turn.mjs` podaj ją łatką `plan.player.units.<id> = {pos, pos_time}`; `track` kończy się na pozycji BFT. Mapa przygasza symbol, gdy pozycja jest starsza niż 30 min.
- `contacts`: to, co gracz wie o wrogu. Każdy kontakt ma `id`, `sidc`, `pos`, `uncertainty_m`, `observed`, `source`, `confidence` (wysoka/średnia/niska) i `estimate`.
  - kontakt niepotwierdzony ma status `A` w SIDC (4. znak), co daje ramkę przerywaną,
  - przynależność `U` (nieznany) albo `S` (podejrzany), gdy nie wiadomo, czyj to obiekt,
  - kontakt bez nowej obserwacji zostaje z dawnym `observed` (starzeje się); usuń go, gdy jest wyraźnie nieaktualny albo zameldowano jego zniszczenie lub odejście,
  - pozycja kontaktu to pozycja **zameldowana**, a nie prawdziwa.
- Jednostki własne mają dodatkowo:
  - `personnel: {current, authorized}` oraz `equipment: [{name, current, authorized}]` (główny sprzęt),
  - `parent`: id jednostki nadrzędnej (batalion → `hq`, kompania → batalion, pluton → kompania — SIDC wielkość `D`, np. `SFGPUCIZ---D---`; przełożony i sąsiedzi bez `parent`),
  - te same wartości muszą być w `umpire/turns/` (własne siły są zawsze prawdziwe, tam z `side: "PL"` i `supply`).
- Kontakty mogą mieć `estimate_personnel: {count, approx}` i `estimate_equipment: [{name, count, approx}]`. To **szacunek** gracza, nie prawda. Prawdziwe stany wroga są tylko w `umpire/`.
- **Straty:** przy rozstrzyganiu aktualizuj `personnel`, `equipment` i `strength` spójnie (strata kompanii zmniejsza też liczby w jej batalionie) i podawaj liczby w meldunkach, np. „utraciliśmy 3 KTO, 14 rannych”.
- **`track` (animacja przemieszczeń):** dla każdej jednostki własnej (i jednostki sąsiada), która w danej turze zmieniła pozycję, zapisz w `player/turns/(N+1).json` pole `track: [[lon,lat], …]` = trasę przejechaną w tej turze, kończącą się dokładnie w `pos` i zaczynającą się w pozycji z tury N. Prowadź ją po drogach, gdzie to sensowne (marsz kolumny po MSR, nie przez jezioro i las), a w terenie po prostej lub kilku punktach; ≥ 2 punkty. Bez `track` jednostka w aplikacji jedzie po linii prostej. Nie dotyczy kontaktów wroga: aplikacja pokazuje tylko „ducha” starej zameldowanej pozycji, więc `track` w kontaktach jest niedozwolone. Walidator zgłasza uwagę, gdy początek lub koniec trasy nie zgadza się z pozycjami tur.
- **Sąsiedzi i ich formacje (`formation`):** sąsiedzi (`zt-mamry`, `zt-biebrza`…) żyją własnym życiem — symuluj ich w każdej turze (ruch, walka, meldunki) i aktualizuj ich pozycje, a ich pododdziały zapisuj w `units` pliku gracza jako jednostki z `formation: "<id sąsiada>"` **zamiast** `parent` (np. `{ "id": "mamry-1bzmot", "name": "1 bzmot (ZT Mamry)", "sidc": "SFGPUCIZ---F---", "formation": "zt-mamry", … }`; podwładni takiej jednostki mogą używać `parent`). Gracz nimi nie dowodzi: nie mają kanałów i nie wolno mu ich wskazać jako adresata rozkazu. Pozycje to położenie orientacyjne (jak u sąsiada), `track` dla ruchu jak wyżej. FLOT sąsiada może być linią z `formation`. Pola sędziego (`side`, `supply`) nadal tylko w `umpire/turns/`.
- `assets`: środki rozpoznania gracza (`pos` tylko, gdy w powietrzu lub rozwinięte).
- `lines`: `boundary`, `flot`, `enemy_flot`, `phase`, `axis`, `enemy_axis`. Każda linia ma `coords` i `label`.
- Współrzędne zawsze `[długość, szerokość]`.

## Rozkazy do dowolnej jednostki własnej

Gracz może adresować wiadomość (`player/outbox`) do **każdej jednostki własnej**, także kompanii: `channel` = id jednostki z bieżącej tury (np. `1bzmot-1k`). Gdy gracz pomija dowódcę batalionu i wydaje rozkaz kompanii bezpośrednio, dowódca kompanii go wykonuje, ale **melduje o tym swojemu dowódcy batalionu** (realistyczne tarcie). Sędzia uwzględnia to: dowódca batalionu może się dowiedzieć z opóźnieniem, mieć już inny plan dla tej kompanii albo zgłosić zastrzeżenia w kanale batalionu.

**Skutki pominięcia szczebla** (`commandRules.skipEchelon`: `soft` domyślnie, `hard`; przy `off` bez skutków). Dotyczy rozkazów w `outbox` do kanałów poniżej bezpośrednich podwładnych (kompania pod batalionem = 1 pominięcie, pluton = 2). Aplikacja pokazuje graczowi ostrzeżenie; sędzia stosuje skutki:
- **opóźniona wiedza:** pominięty dowódca dowiaduje się od podwładnego z opóźnieniem (np. jedna tura lub później, zależnie od łączności) albo z rozkazu przełożonego;
- **kolizja planów:** gdy miał już inny plan dla tej jednostki, wynikają sprzeczne rozkazy, zamieszanie i strata czasu na uzgodnienie;
- **powtarzanie** obniża inicjatywę podwładnych (czekają na rozkazy z góry) i zaufanie dowódcy (morale, T28);
- dowódca może zgłosić zastrzeżenia w swoim kanale; `priority: urgent` w trybie `hard` (łączność alarmowa) ma koszt jak w `soft`;
- **licznik pominięć:** w `umpire/log.md` dopisuj przy turze, kogo i ile razy pominięto (narastająco); gracz go nie widzi.

## Wiadomości (`player/inbox/NNN.json`)

`{"messages":[{"id":"in-NNN-01","channel":"<id kanału>","from":"stopień nazwisko, funkcja","time":"…","type":"rozkaz|zarzadzenie|meldunek|wiadomosc"?,"priority":"urgent"?,"text":"…"}]}`

- `time` mieści się w rozstrzyganym okresie (między turą N a N+1). Postacie mogą pisać same z siebie.
- **Styl:** krótko i wojskowo, jak prawdziwe meldunki. Format meldunku z rozpoznania: *„BSP-1, 07:22, kolumna ~10 pojazdów gąsienicowych, droga Żytkiejmy–Wiżajny, kierunek płd., pewność średnia”*.
- Rozkazy przełożonego mogą mieć `overlay: {id, name, features:[…]}` (graficzna nakładka ze szkicami; nowsza o tym samym `id` zastępuje starszą; format: docs/SCHEMA.md).
- Każdy adresat rozkazu potwierdza go albo melduje problem. Przełożony może odmówić lub wydać niewygodny rozkaz.
- `priority: "urgent"` tylko dla spraw pilnych (kontakt, straty, utrata łączności, rozkaz przełożonego).
- **Formularze (T50):** postacie mogą odpowiadać w tych samych formatach co gracz (SPOTREP, LOGSTAT, FRAGO, zapotrzebowanie na ogień): obok czytelnego `text` dodaj `form: {kind, fields}` (pola: docs/SCHEMA.md); komunikator pokaże tabelkę. Gracz wysyła je w `player/outbox` z tym samym `form`.
- **`type`** ustawiaj zawsze, gdy da się go określić: `rozkaz` (rozkaz przełożonego), `zarzadzenie`, `meldunek` (meldunek podwładnych, S2, S4), `wiadomosc` (zwykła rozmowa). Aplikacja pokazuje go jako znacznik na karcie i w osi czasu.
- **Rozkazy gracza:** w `player/outbox` pole `type` to kategoria wybrana przez gracza (`rozkaz` / `zarzadzenie` / `meldunek` / `wiadomosc`), a `priority: "urgent"` oznacza przełącznik „Pilne”. Traktuj `type` jako kategorię rozkazu (rozkaz bojowy ma wyższą wagę niż zwykła wiadomość), a „Pilne” jako prośbę o szybsze potraktowanie — nie jako automatyczne wykonanie.

## CCIR i meldunki cykliczne (T48)

Przy rozstrzyganiu tury czytaj `player/ccir.json` (PIR o przeciwniku, FFIR o własnych siłach; format w `docs/SCHEMA.md`) i `scenario.reportCycle` (minuty czasu gry, np. `{sitrep: 240, logstat: 1440}`).

- **Pilnie** (`priority: "urgent"`) postacie meldują tylko to, co spełnia pozycję CCIR, i **zawsze** z odwołaniem `ccir: "PIR-2"` w wiadomości. Reszta (drobne kontakty, rutyna) idzie do meldunku cyklicznego.
- **Postacie mogą się mylić:** fałszywy alarm (odwołanie do CCIR, choć nie było spełnienia), przeoczenie albo opóźnienie. CCIR nie gwarantuje, że wiadomość przyjdzie; tarcie zostaje.
- **SITREP i LOGSTAT** (`type: "meldunek"`, `report: "sitrep"|"logstat"`) wysyłają podwładni w rytmie `reportCycle`, o stałej godzinie odniesienia. Szablon (pięć punktów, krótko): *1. położenie, 2. stan (ludzie, sprzęt, DOS), 3. działania (ostatnie i bieżące), 4. zamiar, 5. potrzeby.* LOGSTAT kładzie nacisk na punkty 2 i 5 (DOS paliwa, amunicji, ogólnego; naprawy; dowóz).
- **Brak albo spóźnienie meldunku cyklicznego jest informacją** (łączność, walka, kłopoty podwładnego): nie dopisuj wtedy „zastępczego” meldunku, pozwól graczowi wyciągnąć wniosek.

## Zgłoszenia ognia (T52)

Gracz zgłasza ogień formularzem `fire` (outbox, kanał = środek wsparcia). Sędzia odpowiada wiadomością inbox z polem `fire: {request_id, status, time, rounds?, reason?}` (format: docs/SCHEMA.md) i krótkim `text`: „Przyjęto.” / „Odmowa (powód).” / „Wykonano HH:MM, X pocisków, skutek nieznany.”.

- Wykonanie zależy od: dostępności środka (stan, zajęcie innym zadaniem), amunicji (DOS), doręczenia zgłoszenia (łączność), zasięgu z katalogu wyposażenia (T46/T47) i priorytetów przełożonego (może zająć środek własnym zadaniem lub odmówić). Opóźnienie = czas przyjęcia + przygotowania, nie natychmiast.
- Zużycie amunicji zapisz w `umpire/` (DOS), `rounds` w polu `fire` to liczba pocisków.
- Pole `fire` nigdy nie niesie skutku. Skutek gracz poznaje wyłącznie z obserwacji (BSP, patrole, meldunki podwładnych), z opóźnieniem i niepełnie; prawdziwe straty wroga tylko w `umpire/`.

## Gazeter miejsc (`gazetteer.json`)

Plik `scenarios/<id>/gazetteer.json` jest jawny dla gracza: `{"places":[{"id","name","kind","pos":[lon,lat],"zoom"?,"forms":[…],"note"?}]}`. Aplikacja zamienia nazwy z `forms` w wiadomościach na klikalne linki do mapy.

- W wiadomościach używaj nazw miejsc z gazetera, w poprawnych polskich odmianach z `forms`.
- Gdy użyjesz miejsca, którego nie ma w gazeterze, **w tej samej turze** dopisz je do `gazetteer.json`: z geokodowaną pozycją (OpenStreetMap Nominatim, `[długość, szerokość]`) i odmianami (mianownik, dopełniacz, miejscownik, narzędnik; `forms` musi zawierać `name`). Walidator to sprawdza.
- Jednostki i kontakty linkują się automatycznie po `name` i `id` z bieżącej tury.

## Symbole (SIDC, MIL-STD-2525C, 15 znaków)

Używaj tylko kodów funkcji opisanych w `public/js/domain/sidc.js` (`FUNCTIONS`). W razie potrzeby dodaj nowy kod tam razem z polskim opisem. Walidator to wymusza.

Przykłady:
- `SFGPUCIZ---F---`: swój batalion zmechanizowany,
- `SHGAUCAT---E---`: wróg, kompania czołgów, niepotwierdzona,
- `SFGPUCIZ--AH---`: dowództwo brygady.
