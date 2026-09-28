# Arrobio Kwaliteitsportaal

Digitale kwaliteitsborging voor elektrotechnische mutatiewerkzaamheden van **Arrobio Techniek**, uitgevoerd in opdracht van **Logchies** voor **Eigen Haard**.

De applicatie legt per woning de volledige uitvoering, kwaliteitscontrole, planning en oplevering digitaal vast: wie heeft wat gedaan, wanneer, is het gecontroleerd volgens het vierogenprincipe, zijn bevindingen hersteld, en is de woning definitief vrijgegeven door een manager. Alles met een volledige, niet-verwijderbare audittrail.

Bron: dit project is gebouwd volgens de bouwopdracht in `Kleine plan.docx`, in de context van het verbeterplan dat Arrobio richting Logchies/Eigen Haard heeft gestuurd (`Verbeter plN.docx`).

## Architectuur

- **Backend**: Node.js + Express, REST API onder `/api`
- **Database**: SQLite (Node's ingebouwde `node:sqlite`), permanente server-side opslag in `server/data.sqlite` — geen browser-localStorage
- **Frontend**: React (Vite), responsive voor desktop/tablet/mobiel, geteste met echte mobiele viewport (375×812)
- **Authenticatie**: JWT (10 uur geldig), wachtwoorden gehashed met bcrypt, optionele TOTP-MFA per gebruiker
- **Autorisatie**: server-side rol- en statuscontrole op elk endpoint; het vierogenprincipe en statusovergangen worden centraal afgedwongen in `server/src/lib/statusRules.js` en `server/src/lib/fourEyes.js`, nooit alleen in de UI. Kwaliteitskritische statusovergangen (gereedmelding, controles, vrijgave) lopen uitsluitend via hun eigen gevalideerde endpoint, nooit via een generieke statuswijziging — ook niet voor beheerder/manager.
- **Audittrail**: iedere kritieke actie (aanmaak, statuswijziging, controle, vrijgave, heropening, MFA-wijziging) wordt weggeschreven in `audit_events` en is niet verwijderbaar door reguliere gebruikers
- **Automatische ongeldigmaking**: wijzigingen aan werkzaamheden/checklist/metingen/foto's na technische goedkeuring maken die goedkeuring automatisch ongeldig (`server/src/lib/approvalGuard.js`); na definitieve vrijgave is wijzigen alleen mogelijk na een formele, verplicht beargumenteerde heropening

### Databasemodel (belangrijkste tabellen)

`users`, `roles`, `properties` (woningdossiers), `property_assignments`, `work_items` (met `ruimte`/`aantal`/`eenheid`, naar het echte opdrachtformulier van Arrobio), `work_item_catalog` (normkostenlijst, importeerbaar vanuit Excel), `materials` (materiaalcatalogus met voorraad), `work_item_materials` (materiaalverbruik per werkzaamheid), `material_stock_adjustments`, `checklists`, `checklist_items`, `checklist_results`, `measurements`, `attachments`, `findings`, `repairs`, `technical_reviews`, `manager_reviews`, `external_inspections`, `planning_changes`, `audit_events`, `report_versions`, `improvement_metrics` (verbeterplan-module)

Zie `server/src/db/schema.sql` voor het volledige schema met foreign keys en `created_at`/`updated_at` velden. `server/src/db/index.js` bevat lichte, automatische migraties zodat een bestaande database bij een update niet verwijderd hoeft te worden.

### Rollen

| Rol | Belangrijkste bevoegdheden |
|---|---|
| Beheerder | gebruikers- en rollenbeheer, checklists beheren, alle woningen, systeembrede audittrail |
| Manager | planning, toewijzing, managercontrole, definitieve vrijgave, managementrapportage, verbeterplan |
| Controleur | tweede technische controle/hercontrole, bevindingen registreren, verbeterplan inzien |
| Monteur | werkzaamheden registreren, checklist, foto's, metingen, gereedmelden, herstelacties |
| Leerling | zelfde als monteur, maar nooit zelfstandig goedkeuren/vrijgeven/tweede controle uitvoeren |

### Statusmodel (centraal afgedwongen, geen vrije overgangen vanuit de frontend)

```
NIEUW → GEPLAND → IN_UITVOERING → GEREED_VOOR_CONTROLE
  → (HERSTEL_NODIG → GEREED_VOOR_HERCONTROLE →) TECHNISCH_GOEDGEKEURD
  → MANAGERCONTROLE → VRIJGEGEVEN
  (→ HEROPEND bij wijziging na vrijgave, → GEANNULEERD)
```

### Vierogenprincipe (hard afgedwongen, server-side)

Een gebruiker die als uitvoerder op een werkitem staat, mag nooit zelf de technische controle van diezelfde woning goedkeuren. Dit wordt gecontroleerd in `assertFourEyes` (server/src/lib/fourEyes.js) op het endpoint dat de tweede controle vastlegt — niet alleen verborgen in de UI. Alleen de rol Controleur mag dit endpoint aanroepen; een leerling of manager kan de controle niet uitvoeren of overslaan.

## Voortgang (fasering)

- [x] **Fase 1** — architectuur, database, authenticatie, rollen, woningbeheer, basisdashboard
- [x] **Fase 2** — werkzaamheden, checklists (incl. beheer), foto's (beveiligde upload/download), metingen, gereedmelding met automatische volledigheidscontrole
- [x] **Fase 3** — vierogencontrole, bevindingen, herstel, hercontrole, managercontrole en definitieve vrijgave, met automatische ongeldigmaking van goedkeuring bij latere wijziging en verplichte formele heropening na vrijgave
- [x] **Fase 4** — systeembrede audittrail-weergave (beheerder), PDF-opleverrapport met versienummer/document-ID, managementrapportage met periodefilter (altijd teller/noemer, nooit een kaal percentage), externe keuring met vergelijking t.o.v. interne controle, verbeterplan-dashboard per thema uit het verbeterplan
- [x] **Fase 5** — beveiliging-hardening (rate limiting, security headers, optionele MFA), 34 geautomatiseerde tests, mobiele optimalisatie (geverifieerd op 375px breedte), foutafhandeling (globale foutpagina, automatisch uitloggen bij verlopen sessie, nette 404's), productiedocumentatie
- [x] **Uitbreiding: materiaalbeheer** — materiaalcatalogus met voorraadbewaking en minimumvoorraad-signalering, materiaalverbruik registreren per werkzaamheid (voorraad daalt automatisch, traceerbaar in het PDF-opleverrapport), plus een **werkzaamhedencatalogus** (normkostenlijst) met Excel-import zodat monteurs standaardregels kunnen zoeken/selecteren in plaats van alles handmatig te typen (42 tests)
- [x] **Uitbreiding: productie-hosting** — Dockerfile + `fly.toml` voor Fly.io (één service, permanent volume voor database + foto's, automatische HTTPS), backend serveert de gebouwde frontend uit dezelfde container, lokaal geverifieerd

## Installatie (ontwikkelomgeving)

Vereist: Node.js 18+ (geen extra database-server nodig — SQLite zit in Node zelf).

```bash
cd server
npm install
cp .env.example .env
npm run seed     # maakt rollen, standaardchecklist en eerste gebruikers per rol aan
npm run dev      # start API op http://localhost:4000
```

```bash
cd client
npm install
npm run dev       # start app op http://localhost:5174
```

### Standaard inloggegevens (na seed)

| Rol | E-mail | Wachtwoord |
|---|---|---|
| Beheerder | beheerder@arro-kwaliteit.nl | welkom123 |
| Manager | manager@arro-kwaliteit.nl | welkom123 |
| Controleur | controleur@arro-kwaliteit.nl | welkom123 |
| Monteur | monteur@arro-kwaliteit.nl | welkom123 |
| Leerling | leerling@arro-kwaliteit.nl | welkom123 |

**Wijzig deze wachtwoorden voordat de app in gebruik wordt genomen door de 8 echte medewerkers**, en schakel MFA in via "Mijn account" (rechtsboven in de app) — met name voor de rollen Beheerder en Manager.

## Configuratie

`server/.env` (kopie van `.env.example`):

| Variabele | Betekenis |
|---|---|
| `PORT` | Poort van de API (standaard 4000) |
| `JWT_SECRET` | **Verplicht in productie**: lange, willekeurige string voor het ondertekenen van sessietokens. Zonder deze variabele draait de server met een onveilige ontwikkelwaarde en toont een waarschuwing in de logs. |

## Tests

```bash
cd server
npm test
```

Draait 34 geautomatiseerde tests (Node's ingebouwde testrunner) tegen een tijdelijke, geïsoleerde database — nooit tegen `data.sqlite`. Dekt onder meer: het vierogenprincipe, autorisatie per rol, de gereedmeldings- en (her)controlevalidatie, het statusmodel, automatische ongeldigmaking na wijziging, formele heropening, rate limiting, MFA en beveiligingsheaders.

## Beveiliging

- Autorisatie gebeurt uitsluitend server-side; de frontend verbergt knoppen alleen voor het gebruiksgemak
- Wachtwoorden worden nooit in platte tekst opgeslagen (bcrypt)
- Sessietokens (JWT) zijn 10 uur geldig; een geblokkeerde gebruiker wordt bij het eerstvolgende verzoek direct geweigerd, ook met een nog geldig token
- Login is beperkt tot 20 pogingen per 15 minuten per IP-adres (bescherming tegen brute-force)
- Beveiligingsheaders via `helmet` op elk antwoord
- Optionele TOTP-MFA per gebruiker (Google/Microsoft Authenticator-compatibel), in te stellen via "Mijn account"
- Uploads zijn beperkt tot jpg/png/webp/pdf, max. 15MB, en alleen te downloaden door ingelogde gebruikers; bijlagen worden vergrendeld zodra een woning definitief is vrijgegeven

## Gebruikersbeheer

Alleen de rol Beheerder kan gebruikers aanmaken, rol/functie wijzigen en blokkeren/deblokkeren (pagina "Gebruikers"). Gebruikers worden nooit fysiek verwijderd — geblokkeerd (`active = 0`) is de enige manier om iemands toegang in te trekken, zodat historische dossiers (wie heeft wat gedaan) intact blijven.

## Deployment (Fly.io)

De applicatie draait in productie als **één Docker-service**: Express serveert zowel de API (`/api/*`) als de gebouwde React-frontend (alle overige routes) uit dezelfde container. Dat is voldoende en het eenvoudigst voor een team van ~8 gebruikers, en scheelt een aparte CORS-/hostingopzet. Zie `Dockerfile` en `fly.toml` in de projectroot.

### Eenmalige inrichting

1. **Installeer de Fly.io CLI** (`flyctl`): volg de instructies op [fly.io/docs/flyctl/install](https://fly.io/docs/flyctl/install/) voor Windows (PowerShell: `pwsh -c "iwr https://fly.io/install.ps1 -useb | iex"`).
2. **Maak een gratis Fly.io-account** en log in: `fly auth signup` (of `fly auth login` als je al een account hebt). Dit moet je zelf doen — hier kan niemand anders namens jou inloggen.
3. Ga naar de projectroot (`arro-werk-kwaliteit/`, waar `fly.toml` en `Dockerfile` staan) en maak de app aan:
   ```bash
   fly launch --no-deploy
   ```
   Dit leest de bestaande `fly.toml`. Kiest Fly.io een andere naam omdat `arrobio-kwaliteitsportaal` al bezet is, pas dan `app = "..."` in `fly.toml` aan.
4. **Maak het permanente opslagvolume** (voor de database en foto's — cruciaal, anders ben je alles kwijt bij elke herstart):
   ```bash
   fly volumes create arro_data --region ams --size 1
   ```
5. **Stel het wachtwoordgeheim in** (nooit in `fly.toml` of git zetten):
   ```bash
   fly secrets set JWT_SECRET="<een lange, willekeurige string>"
   ```
   Genereer er zelf een met bijvoorbeeld `openssl rand -hex 48`, of vraag mij om er een te genereren.

### Deployen

```bash
fly deploy
```

Dit bouwt de Docker-image (frontend + backend) en zet hem live op `https://<jouw-app-naam>.fly.dev`.

### Eerste keer: gebruikers en checklist aanmaken

Een verse database heeft nog geen inlogaccounts. Draai de seed **eenmalig** in de draaiende productie-machine:

```bash
fly ssh console -C "node src/db/seed.js"
```

Dit maakt de standaard rollen-accounts aan (zie tabel hierboven) — **wijzig deze wachtwoorden meteen** via "Mijn account" c.q. "Gebruikers" zodra de app live staat.

### Beheer

- **Logs bekijken**: `fly logs`
- **Opnieuw deployen na codewijzigingen**: gewoon `fly deploy` opnieuw draaien
- **Status/machines**: `fly status`
- De machine staat standaard op **auto-stop bij inactiviteit** (`fly.toml`: `min_machines_running = 0`) om binnen de gratis tier te blijven. Eerste bezoek na een stille periode kan daardoor een paar seconden opstarttijd geven. Wil je dit niet (bv. bij dagelijks intensief gebruik), zet dan `min_machines_running = 1` in `fly.toml` (kost dan een klein bedrag per maand).
- **Bestandsopslag**: `UPLOADS_DIR=/data/uploads` en `DB_PATH=/data/data.sqlite` wijzen naar het gekoppelde volume, dus die overleven een deploy/herstart.

## Back-up

De volledige database en alle foto's staan permanent op het Fly.io-volume (`arro_data`, gekoppeld op `/data`). Dit is de enige bron van waarheid voor audittrail en opleverdossiers — bedrijfskritisch en juridisch relevant richting Logchies/Eigen Haard.

- **Automatische volume-snapshots**: Fly.io maakt standaard dagelijks een snapshot van elk volume (5 dagen bewaartermijn op de gratis tier). Bekijken: `fly volumes list` en `fly volumes snapshots list <volume-id>`.
- **Handmatige kopie maken**: `fly ssh sftp get /data/data.sqlite ./backup-data.sqlite` haalt de actuele database lokaal op; doe dit periodiek en bewaar het buiten Fly.io (bv. lokaal of in een andere cloudopslag).
- Lokaal (buiten Fly.io) staat de database in `server/data.sqlite` (plus `-wal`/`-shm`-bestanden) en de foto's in `server/uploads/` — maak hier dagelijks een kopie van als je lokaal blijft draaien naast de productieomgeving.
- Test de restore-procedure periodiek (nieuw volume aanmaken, snapshot terugzetten, `fly deploy`).
