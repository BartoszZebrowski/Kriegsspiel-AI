# Kriegsspiel AI — projekt interfejsu (UI)

Wersja 1.0 · 2026-10-11. Makieta wzorcowa: [`public/mockup.html`](../public/mockup.html) (po uruchomieniu serwera: `http://localhost:8080/mockup.html`). Zrzuty: [main](ui-mockup-main.png), [omnibox](ui-mockup-omnibox.png), [wąski](ui-mockup-narrow.png).

Motyw i układ zostały zaakceptowane przez gracza. **Wartości w tym dokumencie są wartościami z makiety — implementacja ma je przepisać 1:1** (tokeny CSS w §4 można skopiować bez zmian). Wszystkie teksty interfejsu są po polsku.

---

## 1. Zasady projektowe

1. **Mapa jest sceną, reszta to narzędzia.** Panele otaczają mapę (jak w Palantir Gotham / Maven), nie nakładają się na nią na stałe. Na mapie pływają tylko małe palety narzędzi.
2. **Gęsto, ale spokojnie.** Ciemny, łupkowy motyw, płaskie panele, separatory 1 px, bez cieni na panelach (cień tylko dla elementów pływających). Jeden kolor akcentu.
3. **Struktura jest zawsze widoczna.** Drzewo jednostek nie jest zakładką — to stały panel po lewej.
4. **Jeden obiekt zaznaczony naraz** i wszędzie ten sam: mapa, drzewo, inspektor, komunikator (§6.2).
5. **Kolor ma znaczenie.** Kolory NATO (niebieski/czerwony/żółty/zielony) wyłącznie dla symboli i znaczników przynależności. Chrome interfejsu używa neutralnych szarości + jednego akcentu (niebieski UI `#4c90f0`, wyraźnie bardziej szary niż „swój” NATO `#80e0ff`).
6. **Liczby, współrzędne, DTG — czcionką mono** z cyframi tabelarycznymi.
7. **Wszystko ma skrót klawiszowy**, a polecenia są dostępne z omniboxu (Ctrl K).
8. **Gracz widzi tylko to, co wie.** Kontakty są oznaczone wiekiem i pewnością, szacunki — etykietą „NIE PRAWDA”.
9. **Każdy panel jest przesuwalny** (splittery, §3.4) i zapamiętywany.

---

## 2. Układ ekranu

### 2.1 Desktop 1440×900

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◧ KRIEGSSPIEL        ┌ 🔍 Szukaj jednostki, kontaktu, miejsca…  Ctrl K ┐  ◀ [TURA 2] CZW 14.05·10:00 ▶ …  │ 44
│   Ćwiczenie „Przesmyk”└─────────────────────────────────────────────────┘  141000B MAJ 26   SKRZYNKA·2  📄 🔔 ? ▯▯ │
├───────────────────┬─────────────────────────────────────────────────────────────┬──────────────────────────┤
│ STRUKTURA   26  ⇕ │ [✥]                SZCZEGÓŁOWOŚĆ [Auto|Bat|Komp]       [≣]  │ KOMUNIKATOR  3 nowe    ⌇ 🔍 │ 32
│ ▽ Filtruj…     /  │ [↗]                                                      [?]  │ [DD¹][S2¹][S4¹][1 bzmot][…]▾│ 40
│ ˅ SIŁY WŁASNE  23 │ [∿]            (c-001)     ▭krozp                       [+]  │ ▭ Dowództwo dywizji   ●łączn.│
│ ˅ ▭ ZT Hańcza  93 │ [⬠]                                                     [−]  │──────────────────────────────│
│   ├─˅ ▭ 1 bzmot 94│ [◎]                    ▭1 bzmot ▭ksap                   [⌖]  │▌gen. Nowicki  PILNE ROZKAZ   │
│   │  ├─ 1k 1bzmot │ [▣]                                                          │▌ Przeciwnik w sile… {c-001}  │
│   │  ├─ 2k …      │ [⚑]       ▭dart      ▭ZT Hańcza ▭bopl      ▭2 bzmot         │  1. Do 11:00 zająć Rejon A   │
│   │  ├─ 3k …  58  │ [📏]               ▭bcz                                      │──── NOWE ───────────────────│
│   │  └─ kw …      │                         ▭blog                                │ Ty · Meldunek nr 1  ✓✓       │
│   ├─› ▭ 2 bzmot   │ KURSOR 54.15°N… ZOOM 10 PODKŁAD Ciemny                       │                              │
│ › PRZEŁOŻONY… 3   ├─────────────────────────────────────────────────────────────┤ [Rozkaz|Zarząd.|Meld.|Wiad.] │
│ › KONTAKTY    3   │ OŚ CZASU      T0 ◇───◇──◆ T2 ┄┄┄┄┄ T4 ┄┄┄┄ T6 …   │ wiadom.  │ ┌ Treść rozkazu…          ┐ │
│ › ŚRODKI ROZP. 2  │ T2·bieżąca    06:00     10:00        14:00           │ rozkazy  │ └ Szkic Szablon   Wyślij ┘ │
├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤  ◁ ▷ Bieżąca  ││ ┃ ┃┃  ┃         ┃                    │ 🔒 Po bitwie │              │ 98
│ INSPEKTOR       ⌖ ✕│                                                             │                          │
│ Przegląd Zaopatr. …│                                                             │                          │
│ ▭ 1 bzmot  [Wiad.] │                                                             │                          │
│ STAN OSOBOWY 612/650                                                             │                          │
│ SPRZĘT …           │                                                             │                          │
└───────────────────┴─────────────────────────────────────────────────────────────┴──────────────────────────┘
   312 px (220–520)              reszta (mapa)                                            392 px (300–640)
```

Siatka: `grid-template-columns: var(--dock-l) minmax(0,1fr) var(--dock-r)`, wiersze: pasek górny 44 px + reszta. Oś czasu (domyślnie 98 px) jest tylko pod mapą — lewy i prawy dok sięgają od paska górnego do dołu ekranu.

### 2.2 Węższe okna

| Szerokość | Zmiana |
|---|---|
| ≤ 1200 px | `--dock-l` 276, `--dock-r` 340; w zegarze znika linia DTG; prawy panel osi czasu (legenda zdarzeń) ukryty; skrócona nazwa scenariusza |
| ≤ 980 px | `--dock-l` 248, `--dock-r` 300; omnibox zwija się do ikony; mniejszy panel osi czasu |
| ≤ 760 px (telefon) | jedna kolumna; **dolny pasek zakładek** (56 px): Mapa · Struktura · Szczegóły · Komunikator (z licznikiem nieprzeczytanych). Docki stają się pełnoekranowymi arkuszami między paskiem górnym a dolnym. Splittery ukryte. Paleta narzędzi układa się poziomo, „Szczegółowość” na dole mapy, oś czasu 70 px (tylko wiadomości) |

```
390 px
┌──────────────────────────┐
│ ◧  🔍  ◀ [TURA 2] CZW.. ▶ │ 46
├──────────────────────────┤
│ [✥][↗][∿][⬠][⚑][📏]  [≣] │
│                      [?] │
│   mapa (pełny ekran)  [+]│
│                      [−] │
│ [Auto|Batalion|Kompania] │
├──────────────────────────┤
│ T0◇ T1◇ T2◆ T3┄ … T12    │ 70
├──────────────────────────┤
│ Mapa Struktura Szczeg. Komun.¹ │ 56
└──────────────────────────┘
 (Struktura / Szczegóły / Komunikator = pełnoekranowe arkusze)
```

---

## 3. Regiony — zawartość i zachowanie

### 3.1 Pasek górny (44 px, `--bg-1`, dolny separator)

Od lewej:
1. **Logo + scenariusz** — znak 24×24 (ramka akcentu, krzyż celowniczy), „KRIEGSSPIEL” (11 px, 700, tracking .14em), pod spodem nazwa scenariusza (11 px, `--t-3`).
2. **Omnibox** (przycisk-pole, 28 px wysokości, max 380 px): lupa, tekst „Szukaj jednostki, kontaktu, miejsca lub polecenia…”, `Ctrl K`. Klik / Ctrl K / `/` (gdy fokus nie jest w polu) otwiera okno wyszukiwania (§3.8).
3. **Zegar** (32 px): `◀` · znacznik `TURA N` (akcent; w archiwum bursztyn + „ARCHIWUM ·”) · czas `CZW 14.05 · 10:00` (13 px mono 600) nad linią DTG `141000B MAJ 26 · tura 2 h` (11 px mono, `--t-3`) · `▶`. Skróty `,` / `.`. Gdy oglądamy archiwum, obok pojawia się „Wróć do bieżącej”. (DTG: strefa +02:00 = litera B.)
4. **Pigułka „SKRZYNKA · N”** — liczba rozkazów w skrzynce nadawczej oczekujących na „koniec tury” (podpowiedź wyjaśnia).
5. Przyciski ikonowe: **Odprawa** (`B`), **Powiadomienia** (czerwony licznik), **Pomoc/legenda** (`?`), przełączniki lewego i prawego docka (`Alt 1`, `Alt 2`).

### 3.2 Lewy dok: STRUKTURA (zawsze) + INSPEKTOR (ułożone pionowo, nie zakładki)

Decyzja: **dwa panele jeden pod drugim**, rozdzielone splitterem pionowym (domyślnie 46% / 54%). Struktura nigdy nie znika; inspektor pokazuje zaznaczony obiekt (puste: „Nic nie zaznaczono”).

**Struktura** (nagłówek: „STRUKTURA”, licznik, „zwiń do batalionów”, „rozwiń wszystko”):
- Pole filtra (`/` ustawia fokus) filtruje jednostki po nazwie/id, zachowując rodziców dopasowanych węzłów.
- Sekcje zwijane (nagłówek 26 px, **lepki** u góry i u dołu panelu, więc zwinięte sekcje zawsze widać): **Siły własne** (drzewo), **Przełożony i sąsiedzi**, **Kontakty przeciwnika** (id, szacunek, wiek, kropka pewności), **Środki rozpoznania**.
- **Wiersz drzewa** (28 px): strzałka zwijania · miniatura symbolu NATO (20 px, w komórce 24×22) · nazwa · plakietka nieprzeczytanych · przycisk „kanał” (po hover) · pasek ukompletowania 34×4 + wartość % (mono 11 px). Pasek: ≥ 80% zielony `--ok`, 50–79% bursztyn `--warn`, < 50% czerwony `--danger` (progi z `strength.js`).
- **Linie łączące** (`├─ └─ │`) rysowane CSS-em: dla każdego `li` pseudoelement `::before` (pionowa kreska, dla ostatniego dziecka skrócona do 14 px = środek wiersza) i `::after` (pozioma kreska 12 px na wysokości 14 px); kolor `#3a4b61`; zagnieżdżone `ul` mają `margin-left:7px`, a `li` `padding-left:14px`, dzięki czemu kreska wypada pod środkiem strzałki rodzica. Podświetlenie wiersza to `::before` wiersza rozciągnięty na całą szerokość (`left/right:-400px`, `overflow-x:hidden` na kontenerze, `isolation:isolate`).
- Klik = zaznaczenie (mapa leci do obiektu, inspektor się odświeża); dwuklik lub ikona „kanał” = otwarcie kanału w komunikatorze; strzałki ↑↓ ←→ (roving tabindex) nawigują po drzewie, Enter zaznacza.

**Inspektor** (nagłówek: „INSPEKTOR”, wycentruj, zamknij; poniżej zakładki **Przegląd · Zaopatrzenie · Historia**):
- Góra: symbol 44 px w ramce 52×52, nazwa (16 px/600), pełna nazwa jednostki (12 px), SIDC (mono 11 px, `--t-3`), chip statusu; akcje: **Wiadomość** (primary), Wycentruj, Rozkaz…
- **Przegląd**: STAN OSOBOWY (duża liczba 20 px mono + pasek 6 px), GŁÓWNY SPRZĘT (wiersze: nazwa · pasek 4 px · `41/44`), ZADANIE I POŁOŻENIE (zadanie, współrzędne DMS mono + kopiuj, MGRS, łączność i czas ostatniego meldunku), PODPORZĄDKOWANIE (chipy z miniaturą — klik zaznacza).
- **Zaopatrzenie**: wskaźniki DOS (paliwo, amunicja, żywność/woda, części) jako 5-segmentowe belki z wartością „3,0 d”, próg ostrzegawczy < 2,0 d (bursztyn); najbliższy skład i dystans. (Warstwa logistyczna v0.2 — w v0.1 zakładka może być wyszarzona.)
- **Historia**: dziennik zdarzeń jednostki (czas mono + opis), z linkami do rozkazów.
- **Kontakt** (c-001): akcje Wycentruj / Zapytaj S2 / Hipoteza; sekcje OBSERWACJA (zaobserwowano + wiek bursztynem, źródło, pewność, niepewność ± km, pozycja) i SZACUNEK SIŁ z plakietką „NIE PRAWDA”.

### 3.3 Środek: mapa i pływające palety

Leaflet z podkładem domyślnym **Ciemny** (Esri Dark Gray Base + Reference); pozostałe: topo, OSM, jasny, satelitarny. Znaczniki: symbol milsymbol + etykieta (11 px, biała z konturem). Zaznaczony: ramka akcentu + poświata; hover: jasna ramka (synchronizowany z wierszem drzewa). Kontakty: okrąg niepewności (przerywany czerwony), etykieta `c-001 / 25 min`, krycie maleje z wiekiem (min. .38).

Palety (`.float`: tło `rgba(16,22,29,.94)`, 1 px `--line-2`, radius 6, `--e-float`, blur 6 px):
- **Lewa szyna narzędzi** (pionowa, przyciski 32×32): Wybieraj `V` · Strzałka `A` · Linia `L` · Rejon `R` · Punkt `P` · Symbol `Y` · **Znaki taktyczne NATO `G`** (flyout: granica, FLOT, oś natarcia, linia fazowa, rejon obrony, zapora) · Miarka `M`. Aktywne: `--accent-2` + biała ikona. Podpowiedź z nazwą i skrótem po prawej.
- **Szczegółowość** (góra-środek): segmented Auto | Batalion | Kompania (`1/2/3`).
- **Prawa kolumna**: Warstwy `W` (popover: podkład jako radio, nakładki jako checkboxy: granice, podporządkowanie, kontakty, szkice, logistyka [wkrótce], koleje, etykiety), **Legenda `?`** (popover, §3.7), Przybliż/Oddal, „Pokaż wszystkie siły” `F`.
- **Dół-lewo**: pasek stanu mono (kursor, zoom, podkład) + skala Leaflet.
- **Toasty** (dół-prawo mapy, §3.9).

### 3.4 Splittery i rozmiary paneli (wszystkie panele są zmienialne)

Komponent **splitter**: separator 1 px (kolor `--line`) z niewidocznym polem chwytu 7 px (3 px po każdej stronie), `cursor: col-resize` / `row-resize`. Hover, przeciąganie i fokus klawiatury: linia 1 px w `--accent` + poświata `0 0 0 1px --accent-line`. W trakcie przeciągania `body.dragging` blokuje zaznaczanie tekstu. Pointer events + `setPointerCapture`.

| Splitter | Co zmienia | Domyślnie | Min | Max | Zachowanie specjalne |
|---|---|---|---|---|---|
| `sp-l` (pionowy, prawa krawędź lewego docka) | szerokość lewego docka | 312 px | 220 | 520 | przeciągnięcie poniżej 160 px **zwija dok do szyny** (pas 40 px z ikonami: Struktura, Inspektor, plakietka nieprzeczytanych); ponowne kliknięcie ikony / `Alt 1` rozwija |
| `sp-r` (pionowy, lewa krawędź prawego docka) | szerokość komunikatora | 392 px | 300 | 640 | j.w., szyna z ikoną wiadomości i licznikiem; `Alt 2` |
| `sp-i` (poziomy, między Strukturą a Inspektorem) | wysokość struktury (inspektor bierze resztę) | 46% | 120 px | wysokość docka − 152 px | — |
| `sp-t` (poziomy, nad osią czasu) | wysokość osi czasu | 98 px | 64 | 240 | przy < 80 px znikają ścieżki zdarzeń, zostają węzły tur |
| `sp-c` (poziomy, nad polem wiadomości) | wysokość pola tekstowego komponowania | 78 px | 56 | 320 | pole rośnie w górę (kosztem listy wiadomości) |

Reguły wspólne:
- **Dwuklik** na splitterze = przywrócenie wartości domyślnej (`Home` na splitterze z klawiatury robi to samo).
- **Zapis**: po puszczeniu myszy/klawisza wartość trafia do `localStorage` pod kluczem `ks.split.<id>` (opakować w try/catch; brak zapisu = wartość domyślna). Wczytanie przy starcie, zanim widoki wyrenderują układ (uniknięcie migania). Dotychczasowe klucze szerokości paneli z `lib/layout.js` mają zostać zmigrowane/zastąpione.
- **Dostępność**: splitter ma `role="separator"`, `aria-orientation`, `aria-label` (np. „Szerokość lewego panelu”), `aria-valuenow/min/max`, `tabindex="0"`. Strzałki zmieniają o 16 px, z Shift o 48 px; `Home` = domyślna. Fokus widoczny jako wyżej.
- Po zmianie rozmiaru: `map.invalidateSize()` (z debounce ~30 ms) i przerysowanie osi czasu (gęstość etykiet godzin zależy od szerokości).
- Maksymalna suma szerokości docków ogranicza się tak, by mapa miała ≥ 320 px (przy `resize` okna wartości są przycinane).
- Na telefonie (≤ 760 px) splittery są wyłączone.

### 3.5 Prawy dok: KOMUNIKATOR

Pionowo: nagłówek panelu (32 px) → **pasek kanałów** (40 px) → **nagłówek kanału** → **wątek** (przewijany) → splitter → **komponowanie**.

- **Pasek kanałów**: przypięte/ostatnie kanały jako zakładki-pigułki (28 px): ikona 20×20 (miniatura symbolu jednostki albo ikona roli: S2 radio, S4 ciężarówka), nazwa skrócona (DD, S2, S4, „1 bzmot”), plakietka nieprzeczytanych (czerwona dla przełożonego/pilnych). Pasek przewija się w poziomie (gradient maski z prawej). Przycisk `▾` otwiera **popover „Wszystkie kanały”** pogrupowany: Przełożony · Sztab · Sąsiedzi · Podwładni (+ link do struktury i Ctrl K). **Zintegrowanie z drzewem**: wiersz jednostki w strukturze pokazuje plakietkę nieprzeczytanych (suma poddrzewa) i ikonę „kanał” otwierającą rozmowę — osobne drzewo kanałów w komunikatorze znika.
- **Nagłówek kanału**: awatar 34×34 (symbol/ikona), nazwa (14 px/600), „osoba · rola” (11 px), wskaźnik łączności (zielona/bursztynowa kropka + „łączność dobra / zakłócona”).
- **Wiadomość** (karta, nie bąbelek; padding 12 px; siatka 32 px awatar + treść): nagłówek = **nadawca (600)** · rola (`--t-3`) · tagi · po prawej **DTG + tura** (mono 11 px, np. `140940B · T1`). Lewy pasek 2 px: **pilne** = `--danger` + delikatny gradient czerwony; **moje** = `--accent-line` i awatar „TY” w tonach akcentu; zwykłe = brak. Tagi (11 px, caps, 700): `PILNE` (danger), `ROZKAZ BOJOWY` / `ZARZĄDZENIE` (akcent), `ROZKAZ` od przełożonego (bursztyn), `MELDUNEK` (neutralny).
- **Wzmianki**: jednostka = chip z miniaturą symbolu i niebieskim tłem `--accent-soft`; miejsce = pinezka + podkreślenie kropkowane; kontakt = czerwonawy chip. Klik zaznacza obiekt / leci do miejsca z pulsującym znacznikiem.
- **Załączniki**: chip 26 px z ikoną spinacza, nazwą szkicu i rodzajem (mono 11); klik podświetla szkic na mapie.
- **Stopka wiadomości wysłanej** (mono 11 px): `✓✓ Doręczono 06:14 · przyjęto do wykonania` (zielony) albo `● W skrzynce · rozpatrzenie w turze 3 · Wycofaj` (bursztyn, tylko w bieżącej turze).
- **Separatory**: „czw. 14.05.2026” i **NOWE** (akcent) przed nieprzeczytanymi; po otwarciu kanału stan „przeczytane” ustawia się po ~1,2 s.
- **Komponowanie**: segmented typu **Rozkaz · Zarządzenie · Meldunek · Wiadomość** (wybór wstawia szablon, jeśli pole jest puste/ma szablon); przełącznik **Pilne**; pole (13 px, 1.5); pasek: **Szkic** (menu załączników), **Szablon** (menu: rozkaz bojowy w 5 punktach, zarządzenie, meldunek sytuacyjny), podpowiedź `Ctrl ↵`, przycisk **Wyślij** (primary). Wybrane załączniki jako chipy pod polem. `@` i `#` podpowiadają jednostki i miejsca (do zrobienia po MVP).
- **Linia łączności z jednostką** (ikona w nagłówku) rysuje na mapie linię od krawędzi mapy do symbolu rozmówcy (obecny `leader.js`).

### 3.6 Dół: oś czasu tur (98 px; przyszły suwak „po bitwie”)

- Lewa komórka (136 px): „OŚ CZASU”, `T2 · bieżąca` (mono), przyciski ⏮ ⏭ i „Bieżąca”.
- Środek: oś z węzłami-rombami co turę; **etykiety `T0…` (11 px mono 600) nad linią, godziny pod linią** (co 2. / 3. / 4. węzeł zależnie od szerokości). Przeszłość = linia akcentu, bieżąca tura = wypełniony romb z poświatą, przyszłość = romby przerywane i linia kropkowana (nieklikalne). Klik w przeszłą turę = **archiwum**: romb bursztynowy, zegar w pasku górnym bursztynowy, na osi plakietka „ARCHIWUM · TYLKO PODGLĄD”. Pod osią trzy ścieżki zdarzeń (8 px): wiadomości (szare, pilne czerwone), twoje rozkazy (akcent), kontakty (czerwone). Znacznik „playhead” = pionowa linia akcentu.
- Prawa komórka (150 px): legenda ścieżek oraz zablokowany przełącznik **🔒 Po bitwie** (po zakończeniu scenariusza: Wiedza / Prawda / Notatki, a oś stanie się suwakiem czasu z przeciąganiem uchwytu i odtwarzaniem ▶).

### 3.7 Legenda — nowe miejsce

Legenda **nie jest zakładką**. To popover otwierany z palety mapy (ikona `?`, klawisz `?`, także z paska górnego i z omniboxu), zakotwiczony przy prawym górnym rogu mapy, szer. 340 px, z przełącznikiem **Na mapie | Zasady**:
- **Na mapie** — tylko typy symboli obecne w tej turze (siły własne / przeciwnik / środki rozpoznania, ze zliczeniem ×N i SIDC) + elementy mapy (okrąg niepewności, wiek informacji, granice, podporządkowanie).
- **Zasady** — ściąga budowy symbolu: przynależność (kolor/kształt), wielkość (znaczniki nad ramką), rodzaj (znak w środku), status (ramka przerywana).
- **Kontekstowo**: najechanie na symbol na mapie / w drzewie pokazuje podpowiedź z opisem po polsku (obecne opisy z `sidc.js`), więc legenda jest potrzebna rzadko. Stopka popovera przypomina o tym.
Esc / klik poza zamyka.

### 3.8 Omnibox (Ctrl K)

Modal wyśrodkowany (szer. 660 px, `--z-modal`, tło przyciemnione + blur): pole 16 px z lupą, filtry-segmenty **Wszystko · Jednostki · Kontakty · Miejsca · Polecenia**, lista pogrupowana (w „Wszystko” po 2–4 wyniki na grupę), wiersze 38 px: symbol / ikona · tytuł z podświetlonym dopasowaniem (akcent) · opis (typ, przełożony, wiek) · po prawej MGRS lub skrót. Dane: jednostki, kontakty (`c-001`…), miejsca z gazetteera, polecenia (przejdź do bieżącej tury, otwórz odprawę, legenda, miarka, zmiana podkładu, pokaż siły). Klawisze: ↑↓, Enter (przejdź: zaznacz + leć), Shift+Enter (otwórz kanał/szczegóły), Esc. Stopka z podpowiedziami klawiszy.

### 3.9 Toasty i powiadomienia

Prawy dolny róg mapy, szer. 340 px, kolejka pionowa, 9 s. Karta `--bg-2`, 1 px `--line-3`, lewy pasek 3 px (akcent; pilne = danger), tytuł 13 px/600, treść 12 px `--t-2`, przycisk akcji po prawej (np. „Czytaj” otwiera kanał). `aria-live="polite"`. Zdarzenia: nowa wiadomość (pilna wyróżniona), nowa tura, kontakt wykryty, rozkaz zapisany w skrzynce. Dzwonek w pasku górnym zbiera historię.

### 3.10 Odprawa — widok dokumentu

Pełnoekranowa nakładka (`B`), nie małe okienko: pasek z tytułem, plakietką i „Zamknij Esc”; trzy kolumny — **spis treści** po lewej (240 px, aktywna sekcja z lewym paskiem akcentu), **dokument** w środku (kolumna max 720 px, 15 px / 1.7, nagłówki sekcji caps 12 px z numerem w mono i akcentem, tabela sił, ramka „Ważne” z bursztynowym paskiem), **karta odprawy** po prawej (strona, skala, tura, start, wspomniane miejsca jako klikalne chipy). Na telefonie tylko dokument. Treść pochodzi z `briefing.md` (renderer markdown, sekcje `##` = spis treści).

---

## 4. Tokeny projektowe

### 4.1 Kolory (CSS custom properties — skopiuj do `:root`)

| Token | Hex | Użycie |
|---|---|---|
| `--bg-0` | `#0b0f14` | tło aplikacji, pod mapą, pola wprowadzania |
| `--bg-1` | `#10161d` | panele |
| `--bg-2` | `#151c25` | nagłówki paneli, popovery, karty |
| `--bg-3` | `#1b2430` | hover |
| `--bg-4` | `#243142` | zaznaczenie / aktywne |
| `--line` | `#202a36` | separatory 1 px |
| `--line-2` | `#2d3a4a` | obramowania kontrolek |
| `--line-3` | `#41536a` | obramowanie hover / popovery |
| (drzewo) | `#3a4b61` | linie łączące drzewa |
| `--t-1` | `#e6ebf1` | tekst główny (kontrast na `--bg-1` ≈ 15:1) |
| `--t-2` | `#a7b3c2` | tekst drugorzędny (≈ 8:1) |
| `--t-3` | `#7f8c9d` | metadane, etykiety (≈ 5,3:1) |
| `--t-dis` | `#566273` | wyłącznie wyłączone elementy (nie dla treści) |
| `--accent` | `#4c90f0` | akcent: zaznaczenie, linki, fokus (kontrast ≈ 6:1) |
| `--accent-2` | `#2d72d2` | wypełnienie przycisku primary (biały tekst ≈ 4,9:1) |
| `--accent-soft` | `rgba(76,144,240,.16)` | tła wzmianek, tagów |
| `--accent-line` | `rgba(76,144,240,.45)` | obramowania akcentowe |
| `--friend` | `#80e0ff` | swój (NATO) — tylko symbole/oznaczenia |
| `--hostile` | `#ff8080` | wróg |
| `--unknown` | `#ffff80` | nieznany |
| `--neutral` | `#aaffaa` | neutralny |
| `--ok` | `#3fb67f` | dobry stan, łączność |
| `--warn` | `#e8b339` | uwaga, archiwum, 50–79% |
| `--danger` | `#ec6a5e` | pilne, błąd, < 50% |
| `--focus` | `#8fbcff` | pierścień fokusu (2 px, offset 1 px) |

Reguła: kolorów NATO nie używa się do elementów chrome. Tekst na `--bg-1` i `--bg-2` zawsze ≥ 4,5:1 (`--t-1/2/3`); `--t-dis` tylko dla elementów nieaktywnych.

### 4.2 Typografia

- `--font-ui`: `"Inter","Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif`
- `--font-mono`: `"JetBrains Mono","IBM Plex Mono","Cascadia Mono","SF Mono",Consolas,"Liberation Mono",monospace` (zawsze z `font-variant-numeric: tabular-nums`)
- Nie ładujemy webfontów (praca offline); stosy systemowe.

**Skala — to jedyne dozwolone rozmiary** (minimum 11 px nigdzie niżej):

| Token | px | Użycie |
|---|---|---|
| `--fs-cap` | 11 | etykiety sekcji CAPS (`600`, tracking `.09em`, `--t-3`), tagi (`700`, caps), plakietki/liczniki, metadane (czas, DTG, stopki), wartości mono w drzewie, kbd |
| `--fs-meta` | 11 | rola/opisy drugorzędne, podpisy na mapie (mono 11) |
| `--fs-ui` | 12 | domyślny rozmiar kontrolek, wierszy drzewa i kanałów, etykiety kluczy w inspektorze, przyciski, zakładki |
| `--fs-body` | 13 | treść wiadomości, pole komponowania, tytuł karty, nazwa nadawcy |
| `--fs-lead` | 14 | nagłówek kanału, tytuły w modalach |
| `--fs-h3` | 16 | nazwa obiektu w inspektorze, pole omniboxu |
| `--fs-h2` | 20 | duże liczby (stan osobowy) |
| (dokument) | 15 / 26 | wyłącznie widok odprawy (15 px/1.7 treść; 26 px tytuł) |

Interlinia: UI 1.4; wiadomości i pole tekstowe 1.5; odprawa 1.7. Wagi: 400 / 500 (mono) / 600 / 700 (tagi, caps). Etykiety CAPS: `text-transform:uppercase; letter-spacing:.09em`.

### 4.3 Odstępy (skala 4 pt)

`2 · 4 · 8 · 12 · 16 · 24`. Zasady użycia (obowiązują 1:1):
- padding poziomy paneli i sekcji: **12 px** (nagłówek panelu: `0 8px 0 12px`),
- pionowy rytm sekcji inspektora: padding **12 px**, odstęp etykieta→treść **8 px**,
- karta wiadomości: padding **12 px**, odstęp awatar→treść **12 px**, nagłówek→treść **4 px**, treść→stopka **8 px**,
- komponowanie: padding `8px 12px 12px`, odstęp segment→pole **8 px**,
- przerwa między sąsiednimi kontrolkami: **8 px** (ikony w pasku: 2–4 px),
- wysokości wierszy: nagłówek panelu **32**, wiersz drzewa **28**, nagłówek sekcji **26**, zakładki panelu **32**, pasek kanałów **40**, pole filtra **28**, przycisk **26** (mały 22), pasek górny **44**, oś czasu **98**, tab-bar mobilny **56**.
- **Lewy i prawy dok mają identyczne**: wysokość nagłówka panelu (32), padding poziomy (12), wysokość zakładek (32) i separator 1 px.

### 4.4 Promienie, cienie, z-index

- Promienie: `--r-1` 2 px (tagi, paski), `--r-2` 3 px (chipy, wiersze), `--r-3` 4 px (przyciski, pola), `--r-4` 6 px (palety, popovery, toasty). Brak zaokrągleń > 6 px (poza pigułkami liczników).
- Cienie: `--e-float` `0 1px 0 rgba(255,255,255,.04) inset, 0 6px 20px rgba(0,0,0,.45)` (palety); `--e-pop` `… 0 12px 32px rgba(0,0,0,.55)` (popovery, toasty); `--e-modal` `0 28px 80px rgba(0,0,0,.65)`. Panele docków nie mają cieni.
- z-index: `--z-map-ui` 500 · `--z-dock` 600 · (splittery 650) · `--z-topbar` 700 · `--z-pop` 800 · `--z-modal` 900 (omnibox, odprawa) · `--z-toast` 1000 · `--z-tip` 1100. Kontener mapy ma `isolation:isolate`, więc panele Leaflet (do 700) nie wychodzą ponad interfejs.

---

## 5. Specyfikacje komponentów

| Komponent | Specyfikacja |
|---|---|
| **Nagłówek panelu** | 32 px, `--bg-2`, dolny 1 px `--line`; tytuł CAPS 11 px `--t-2`; licznik jako pigułka (mono 11, `--bg-0`, 1 px `--line`); akcje: przyciski ikonowe 24×24 (`--t-3` → hover `--bg-3`/`--t-1`) |
| **Wiersz drzewa** | 28 px; gap 8; strzałka 14, symbol 24×22, nazwa 12 px; hover `--bg-3`; zaznaczony `--bg-4` + lewy pasek 2 px `--accent` + nazwa 600; pasek siły 34×4 (1 px `--line-2`, tło `--bg-0`) + % mono 11 px (szer. 28, do prawej) |
| **Wiersz kanału (zakładka)** | 28 px, padding `0 8 0 6`, ikona 20×20 w ramce, nazwa 12 px, plakietka; aktywny `--bg-4` + 1 px `--line-2` |
| **Karta wiadomości** | §3.5; awatar 32×32 (`--bg-0`, 1 px `--line-2`, radius 4) |
| **Plakietka (badge)** | min 16×16, radius 8, 11 px/700; domyślna `--accent-2` + biały tekst; pilna `--danger` + `#1a0c0a` |
| **Tag** | 11 px/700 caps, tracking .09em, padding 3×5, radius 2, 1 px obrys w kolorze tekstu; warianty: urgent, ord, rep, dir |
| **Przyciski** | wysokość 26 (sm 22), 12 px, radius 4, 1 px `--line-2`, tło `--bg-3`. Warianty: **primary** (`--accent-2`, biały tekst, 600; hover `#3a80e6`), **default**, **ghost** (bez tła/ramki, `--t-2`), **danger** (tekst `--danger`), **ikonowy** (24×24 lub 32×32 w paletach), **narzędzie aktywne** (`--accent-2`). `:disabled` krycie .45 |
| **Pole tekstowe** | 28 px, tło `--bg-0`, 1 px `--line-2`, radius 4; fokus: obrys `--accent` + `0 0 0 1px --accent-line`; placeholder `--t-3` |
| **Segmented control** | kontener `--bg-0`, 1 px `--line-2`, radius 4, padding 2; przycisk 22 px (sm 20), 12 px; aktywny `--bg-4` + wewnętrzny 1 px `--line-3` |
| **Tooltip** | `#05080c`, 1 px `--line-3`, radius 4, 12 px, padding 5×8; zawiera `kbd` ze skrótem; pozycja: pod elementem (lub po stronie `data-pos`); pojawia się natychmiast, znika po opuszczeniu |
| **kbd** | mono 11 px 600, `--bg-3`, 1 px `--line-2`, dolna krawędź 2 px, radius 3, padding 2×5 |
| **Toast** | §3.9 |
| **Popover / menu** | `--bg-2`, 1 px `--line-3`, radius 6, `--e-pop`; pozycja menu 28 px, hover `--bg-4`; nagłówek grupy CAPS 11 px |
| **Splitter** | §3.4 |
| **Oś czasu** | §3.6; węzeł 14×14 (romb 9×9 obrócony 45°, obrys 1,5 px) |
| **Chip jednostki** | 22 px, padding `0 7 0 4`, miniatura 14 px, 11 px, `--bg-3`, 1 px `--line-2`; hover obrys `--accent-line` |
| **Wskaźnik siły / meter** | 6 px (sprzęt 4 px), tło `--bg-0`, 1 px `--line-2`, wypełnienie `--ok/--warn/--danger` |

Ikony: inline SVG, kreska 1,6 px, `round` cap/join, 16×16 (małe 13×13); `currentColor`. Zestaw w makiecie (`<symbol id="i-…">`) można przenieść do `index.html` jako sprite.

---

## 6. Interakcje

### 6.1 Skróty klawiszowe

| Klawisz | Akcja |
|---|---|
| `Ctrl K` (lub `/` gdy fokus poza polem — wtedy ustawia fokus w filtrze struktury) | omnibox |
| `Esc` | zamknij popover / omnibox / odprawę / anuluj narzędzie |
| `,` / `.` | poprzednia / następna tura |
| `B` | odprawa |
| `?` | legenda |
| `W` | warstwy |
| `F` | pokaż wszystkie siły własne |
| `V A L R P Y G M` | narzędzia: wybór, strzałka, linia, rejon, punkt, symbol, znaki taktyczne, miarka |
| `1 / 2 / 3` | szczegółowość Auto / Batalion / Kompania |
| `Alt 1` / `Alt 2` | pokaż/ukryj lewy / prawy dok |
| `Ctrl Enter` | wyślij wiadomość |
| `↑ ↓ ← →`, `Enter` | nawigacja po drzewie / liście wyników omniboxu |
| `Shift Enter` (omnibox) | otwórz kanał / szczegóły zamiast „przejdź” |
Skróty literowe nie działają, gdy fokus jest w polu tekstowym.

### 6.2 Synchronizacja zaznaczenia

Jedno źródło prawdy: `store.selection = {id, kind}`.
- Klik w **mapie** → drzewo przewija i podświetla wiersz, inspektor się odświeża, mapa nie skacze.
- Klik w **drzewie / omniboksie / wzmiance w komunikatorze / linku w inspektorze** → mapa leci do obiektu (jeśli jest ukryty przez poziom szczegółowości — przełącza na „Kompania”), pozostałe widoki podążają.
- Zaznaczenie **nie** zmienia kanału komunikatora. Kanał zmienia: dwuklik w drzewie, ikona „kanał”, przycisk „Wiadomość” w inspektorze, klik w zakładkę.
- **Hover** wiersza drzewa lub znacznika podświetla odpowiednik w drugim widoku (jasna ramka).
- Zaznaczenie nieistniejące w archiwalnej turze jest czyszczone.

### 6.3 Stany

Hover: `--bg-3`; aktywne/zaznaczone: `--bg-4` (+ pasek akcentu w listach); fokus klawiatury: pierścień `--focus` 2 px; disabled: krycie .45; archiwum: bursztyn w zegarze i na osi, komponowanie wyłączone (tylko podgląd).

---

## 7. Dostępność

- Kontrast tekstu ≥ 4,5:1 (patrz §4.1); elementy nietekstowe (obrysy kontrolek, ikony) ≥ 3:1 — obrys `--line-2` na `--bg-1` jest dekoracyjny, a stan ważny zawsze zapewnia też kształt/tekst/ikona (nie sam kolor: pilne = tag „PILNE”, nie tylko czerwony pasek; siła = liczba obok paska).
- Fokus widoczny wszędzie (`:focus-visible`, 2 px `--focus`); splittery, drzewo (roving tabindex), zakładki i przyciski dostępne z klawiatury.
- Role ARIA: `tree/treeitem/group`, `tablist/tab`, `separator`, `dialog` (omnibox, odprawa, legenda), `toolbar` (paleta narzędzi), `aria-live="polite"` dla toastów i nowych wiadomości.
- `prefers-reduced-motion`: wyłącz animacje (pulsowanie znacznika, wejście toastów).
- Rozmiar celu klikalnego ≥ 24×24 (palety 32×32); na telefonie ≥ 30.
- Minimalny rozmiar tekstu 11 px.

---

## 8. Plan migracji (obecny klient → nowy projekt)

Klient po refaktorze jest w MVC (`public/js/{core,domain,lib,views}`; patrz [ARCHITECTURE.md](ARCHITECTURE.md)). Wymiana wyglądu dotyczy głównie `index.html`, CSS i widoków; store/kontroler/domain bez zmian poza drobnymi dodatkami.

| Obecnie | Nowy projekt / działanie |
|---|---|
| `public/index.html` | Przebudować na siatkę `#app` (topbar / dock-l / center / dock-r / tabbar), dodać sprite ikon, splittery, omnibox, widok odprawy, kontener toastów. `<dialog>` odprawy → nakładka (`#brief`) lub `<dialog>` w trybie pełnoekranowym |
| `public/css/app.css` | Zastąpić: nowy plik `tokens.css` (§4: kolory, skale, z-index) + `layout.css` (siatka, RWD) + `components.css` (§5). Usunąć motyw oliwkowo-złoty (`--bg:#1b1f1a`, `--accent:#c9a646`). Selektory z makiety (`.panel-h`, `.trow`, `.msg`, `.float` …) można przenieść wprost |
| `public/css/draw.css` | Dostosować do tokenów (kolory narzędzi, paleta, flyout znaków) |
| `views/topbar.js` (zegar, `turn-prev/next/current`, `clock-meta`) | Nowy pasek: logo + omnibox + zegar z DTG + pigułka skrzynki + ikony; archiwum = bursztynowy znacznik zamiast osobnego `archive-banner` (baner przenieść na oś czasu). Dodać obsługę `Ctrl K` |
| nowy `views/omnibox.js` | Indeks z `store`: jednostki (`entities`), kontakty, miejsca (`/api/gazetteer`), polecenia; wywołuje intencje kontrolera (select, flyTo, goTurn, openBriefing, setBasemap) |
| `views/structure.js` + `domain/orbat.js` | Przenieść z zakładki do stałego panelu w lewym doku; dodać linie łączące (CSS), sekcje (Przełożony/sąsiedzi, Kontakty, Środki), filtr, paski siły, plakietki nieprzeczytanych (`messages.js` – suma poddrzewa), nawigację klawiaturą |
| `views/details.js` + `domain/cards.js` | Inspektor pod strukturą w lewym doku (nie osobna szuflada z uchwytem); sekcje i zakładki z §3.2; `cards.js` zwraca dane sekcji, nie gotowy HTML z klasami starego motywu; usunąć `details__resizer` na rzecz splittera `sp-i`/`sp-l` |
| `views/messenger.js` + `domain/messages.js`, `linkify.js` | Prawy dok: pasek kanałów + popover „Wszystkie kanały” (zamiast kolumny drzewa kanałów; hierarchia jest teraz w strukturze), nagłówek kanału, karty wiadomości (priorytet, tagi, DTG, stopka stanu), wzmianki jako chipy (linkify zwraca typ: unit/contact/place/asset), załączniki jako chipy, komponowanie z typami i szablonami. Pole `priority` i typ wiadomości (`type`: rozkaz/zarządzenie/meldunek) — opcjonalne pola w outboxie (rozszerzyć `SCHEMA.md` i walidator) |
| `views/legend.js` | Zamiast zakładki: popover na palecie mapy (`#legend`), dwie karty „Na mapie / Zasady”; podpowiedzi kontekstowe z `sidc.js` przy hoverze symbolu |
| `views/draw.js`, `domain/tactical.js` | Paleta narzędzi `#rail` + flyout znaków NATO; stany aktywne wg §5; skróty `V A L R P Y G M` |
| `views/leader.js` | Bez zmian logiki; kolor linii = `--accent`; przycisk w nagłówku komunikatora |
| `views/map/*` | Domyślny podkład „Ciemny”; znaczniki z klasami `.mk`, etykiety 11 px; zaznaczenie/hover synchronizowane ze store; popover Warstwy zamiast kontrolki Leaflet; pływające palety; własne przyciski zoomu; `isolation:isolate` na kontenerze |
| `views/panels.js`, `lib/layout.js`, `lib/storage.js` | Zastąpić uchwyty paneli generycznym komponentem splittera (§3.4) z kluczami `ks.split.*`, klawiaturą, dwuklikiem, zwijaniem do szyny |
| nowy `views/timeline.js` | Oś czasu (dane: `store.turns`, wiadomości, kontakty); archiwum; później suwak „po bitwie” |
| `views/briefing.js` | Widok dokumentu §3.10 (spis treści z nagłówków `##`) |
| `views/toasts.js` | Nowy wygląd §3.9; kolejka |
| `domain/strength.js` | Progi bez zmian; zwraca klasę `good/warn/bad` → `--ok/--warn/--danger` |
| testy | Bez zmian w domain; dodać testy czystych funkcji: ograniczanie rozmiaru splittera (min/max/zwinięcie), indeks omniboxu, grupowanie kanałów |

Kolejność wdrożenia: (1) tokeny + siatka + topbar, (2) struktura + inspektor, (3) komunikator, (4) mapa i palety + legenda, (5) oś czasu i splittery, (6) omnibox, odprawa, toasty, (7) RWD telefon.

---

## 9. Znane uproszczenia makiety

Dane (siła, sprzęt kontaktów, wiadomości, miejsca) są przykładowe; strzałki ↑↓ w drzewie, `@`/`#` w komponowaniu, szyna zwiniętego docka i przeciąganie węzła osi czasu są tylko opisane. Rozmiary paneli w makiecie zapisują się w `localStorage` (`ks.split.*`).

---

## 10. Odstępstwa implementacji od makiety i specyfikacji

Wdrożenie (T12.7) trzyma tokeny i układ 1:1. Świadome różnice:

- **Szyna zwiniętego docka** (decyzja użytkownika): dok nie znika, tylko zwęża się do pasa 40 px z ikonami i licznikiem nieprzeczytanych (makieta chowała go całkiem). Przeciągnięcie poniżej 160 px zwija; po rozwinięciu wraca rozmiar sprzed zwinięcia.
- **Domyślny podkład** „Ciemna (Esri)” tylko wtedy, gdy gracz nie ma zapisanego wyboru.
- **Linie podporządkowania** pozostają magentowe z ciemną obwódką (wymóg istniejącej funkcji i testów), a nie szare jak w makiecie.
- **Szczegółowość** ma czwarty przycisk „Pluton” (klawisz 4); automat: kompania od zoomu 11, pluton od 13.
- **Etykiety na mapie** rysuje milsymbol (`uniqueDesignation`, obok symbolu), a nie osobny element pod znakiem. Kontakt: „c-001” + wiek informacji w minutach, krycie maleje z wiekiem.
- **Wskaźnik łączności** w nagłówku kanału pominięty: plik gracza nie zawiera takiej informacji, a nie wymyślamy jej.
- **Zaopatrzenie** w inspektorze to zakładka-zapowiedź warstwy logistycznej (v0.2): dane DOS należą do sędziego i nie trafiają do plików gracza. **Historia** pokazuje korespondencję z jednostką.
- **Struktura:** „Siły własne” to wszystkie jednostki poza przełożonym i sąsiadami (kanały `superior` / `neighbor`). Domyślnie rozwinięte są szczeble od batalionu w górę, plutony schowane pod kompaniami.
- **Przypięte kanały** (pasek komunikatora): domyślnie przełożony, sztab i jednostki ze scenariusza; otwarcie dowolnego kanału przypina go; środkowy przycisk myszy odpina.
- **Linia do jednostki** wychodzi z aktywnej karty kanału (kotwica = `data-leader-anchor`); przycisk w nagłówku komunikatora ją wyłącza. Wiersz drzewa nie jest kotwicą.
- **Flyout znaków NATO** wylicza wszystkie znaki taktyczne obsługiwane przez aplikację (osie, linie, rejony, punkty), a nie tylko sześć z makiety.
- **Omnibox** szuka też szkiców; Tab przełącza filtry. MGRS liczy czysta funkcja `domain/mgrs.js` (1 m w inspektorze, 10 m w omniboksie i na pasku stanu).
- **Powiadomienia:** dzwonek pokazuje historię toastów (do 30); toast o nowej wiadomości pojawia się dla wiadomości, które nie są jeszcze przeczytane.
- **„Po bitwie”:** przełącznik jest zablokowany (aktywny dopiero przy `status: "finished"`, na razie tylko informuje o wersji 0.3).
- **Zaznaczenie przy zmianie tury** nie przeskakuje na jednostkę kanału: inspektor zachowuje wybrany obiekt, dopóki istnieje.
- **Pierwsze uruchomienie** otwiera kanał przełożonego, żeby komunikator nie był pusty.
