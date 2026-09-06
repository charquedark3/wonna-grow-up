import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Home, Apple, Dumbbell, MessageSquare, ShoppingCart, User, Plus, X, Search,
  ChevronRight, ChevronDown, ChevronLeft, Check, Trash2, Barcode,
  Refrigerator, Download, RotateCcw, Info, AlertTriangle, TrendingUp, Footprints,
  Droplet, Send, Loader2, Calendar, Play, Pause, MapPin, Star,
} from "lucide-react";

/* --------------------------------------------------------------------------
   Chargement différé des deux grosses bibliothèques
   Le moteur 3D pèse 520 Ko et les graphiques 258 Ko : les inclure dans le
   paquet de départ faisait télécharger 778 Ko à quelqu'un qui ouvre
   l'application pour noter un repas. Ils sont désormais chargés à la demande,
   puis préchargés en tâche de fond dès que le fil principal est libre.
   -------------------------------------------------------------------------- */

let THREE = null, _chargeThree = null;
const chargerThree = () => {
  if (THREE) return Promise.resolve(THREE);
  if (!_chargeThree) _chargeThree = import("three").then((m) => (THREE = m)).catch((e) => { _chargeThree = null; throw e; });
  return _chargeThree;
};

let RC = null, _chargeRC = null;
const chargerRecharts = () => {
  if (RC) return Promise.resolve(RC);
  if (!_chargeRC) _chargeRC = import("recharts").then((m) => (RC = m)).catch((e) => { _chargeRC = null; throw e; });
  return _chargeRC;
};

// Préchargement opportuniste : dès que le navigateur souffle, on va chercher
// les deux modules pour que le premier passage sur un graphique ou sur la 3D
// soit instantané.
if (typeof window !== "undefined") {
  const differer = window.requestIdleCallback || ((f) => setTimeout(f, 1800));
  differer(() => { chargerRecharts().catch(() => {}); differer(() => chargerThree().catch(() => {})); });
}

/* ==========================================================================
   FIT — Coach personnel entraînement & nutrition
   Direction visuelle : "chalk on iron".
   Fond fonte / craie chaude / codage couleur des disques calibrés IWF :
   rouge 25 = intensité & force, bleu 20 = volume & hypertrophie,
   jaune 15 = énergie & glucides, vert 10 = récupération & cible atteinte.
   La couleur n'est jamais décorative : c'est le code que tout pratiquant
   lit déjà sur une barre chargée.
   ========================================================================== */

const THEME = {
  noir: "#000000",
  fonte: "#0C0D0F",
  surface: "#131417",
  surface2: "#1B1D22",
  rule: "#2A2D33",
  craie: "#EDEAE3",
  gris: "#8E9198",
  gris2: "#5C6067",
  rouge: "#E4322B",   // disque 25 kg — force, intensité, alerte
  bleu: "#3577D6",    // disque 20 kg — volume, hypertrophie, eau
  jaune: "#F2C230",   // disque 15 kg — énergie, glucides
  vert: "#43A06E",    // disque 10 kg — récupération, dans la cible
  blanc: "#E9E6DF",   // disque 5 kg — protéines
};

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Archivo+Black&family=JetBrains+Mono:wght@400;500;700&display=swap');
`;

const FF = {
  display: "'Archivo Black', 'Helvetica Neue', system-ui, sans-serif",
  body: "'Archivo', system-ui, -apple-system, sans-serif",
  data: "'JetBrains Mono', ui-monospace, 'SF Mono', monospace",
};

/* --------------------------------------------------------------------------
   Stockage persistant (API clé-valeur de l'hôte, jamais localStorage)
   -------------------------------------------------------------------------- */

const memFallback = {};

/* Base locale IndexedDB — utilisée quand l'application tourne en autonome
   (installée sur l'écran d'accueil). Plus robuste que localStorage : quota
   large, données binaires possibles, et Safari la purge beaucoup moins vite. */
const idb = {
  db: null,
  async open() {
    if (idb.db) return idb.db;
    if (typeof indexedDB === "undefined") return null;
    idb.db = await new Promise((res, rej) => {
      const r = indexedDB.open("fit-coach", 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
    return idb.db;
  },
  async tx(mode, fn) {
    const db = await idb.open(); if (!db) throw new Error("indexedDB indisponible");
    return new Promise((res, rej) => {
      const t = db.transaction("kv", mode);
      const rq = fn(t.objectStore("kv"));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  },
};

/* L'hôte est évalué à chaque appel plutôt qu'une fois pour toutes : dans
   l'atelier Claude, window.storage peut être injecté après l'évaluation du
   module. Le figer au chargement était la cause du message « stockage
   indisponible » affiché alors que la sauvegarde fonctionnait. */
const hoteActuel = () => (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function" ? "artefact" : "autonome");

let diagStockage = { mode: "inconnu", detail: "" };

const store = {
  get hote() { return hoteActuel(); },
  get diag() { return diagStockage; },
  async get(key) {
    if (hoteActuel() === "artefact") {
      diagStockage = { mode: "atelier", detail: "Espace de stockage de l'atelier Claude." };
      // Une clé absente lève une exception : ce n'est pas une panne.
      try { const r = await window.storage.get(key, false); return r ? JSON.parse(r.value) : null; }
      catch { return null; }
    }
    try {
      const v = await idb.tx("readonly", (st) => st.get(key));
      diagStockage = { mode: "indexeddb", detail: "Base locale de l'appareil." };
      return v === undefined ? null : v;
    } catch {
      diagStockage = { mode: "memoire", detail: "Base locale inaccessible — navigation privée ou espace saturé." };
      return memFallback[key] ?? null;
    }
  },
  async set(key, value) {
    if (hoteActuel() === "artefact") {
      try {
        await window.storage.set(key, JSON.stringify(value), false);
        diagStockage = { mode: "atelier", detail: "Espace de stockage de l'atelier Claude." };
        return true;
      } catch (e) {
        // Repli silencieux : la donnée reste en mémoire pour la session plutôt
        // que d'alarmer sur un incident passager.
        memFallback[key] = value;
        diagStockage = { mode: "memoire", detail: String(e?.message || e).slice(0, 130) };
        return false;
      }
    }
    try {
      await idb.tx("readwrite", (st) => st.put(value, key));
      diagStockage = { mode: "indexeddb", detail: "Base locale de l'appareil." };
      return true;
    } catch (e) {
      memFallback[key] = value;
      diagStockage = { mode: "memoire", detail: String(e?.message || e).slice(0, 130) };
      return false;
    }
  },
  async del(key) {
    delete memFallback[key];
    if (hoteActuel() === "artefact") { try { await window.storage.delete(key, false); return true; } catch { return false; } }
    try { await idb.tx("readwrite", (st) => st.delete(key)); return true; } catch { return false; }
  },
  async liste(prefixe = "") {
    if (hoteActuel() === "artefact") {
      try { const r = await window.storage.list(prefixe, false); return r?.keys ?? []; } catch { return []; }
    }
    try { return await idb.tx("readonly", (st) => st.getAllKeys()); } catch { return Object.keys(memFallback); }
  },
  /* Écriture puis relecture réelles, pour l'écran de diagnostic. */
  async tester() {
    const cle = "diagnostic-stockage", temoin = { t: Date.now() };
    const ecrit = await store.set(cle, temoin);
    const relu = await store.get(cle);
    await store.del(cle);
    return { ecrit, relu: relu?.t === temoin.t, mode: diagStockage.mode, detail: diagStockage.detail };
  },
};

/* --------------------------------------------------------------------------
   Versionnage du schéma de données
   Chaque enregistrement porte le numéro de schéma sous lequel il a été écrit.
   Au chargement, les migrations manquantes sont appliquées en séquence. Sans
   ce mécanisme, le moindre renommage de champ casserait en silence toutes les
   installations existantes — et une donnée perdue ne se récupère pas.
   -------------------------------------------------------------------------- */

const SCHEMA = 2;

const MIGRATIONS = {
  // v1 vers v2 : l'historique d'entraînement quitte la clé monolithique pour
  // être partitionné par trimestre.
  2: (cle, d) => {
    if (cle === "entrainement" && d && Array.isArray(d.seances)) return { ...d, partitionne: true };
    return d;
  },
};

function migrer(cle, valeur) {
  if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return valeur;
  let v = valeur.__schema || 1;
  let d = valeur;
  while (v < SCHEMA) {
    v += 1;
    try { if (MIGRATIONS[v]) d = MIGRATIONS[v](cle, d); }
    catch (e) { console.error("Migration " + v + " interrompue sur " + cle, e); break; }
  }
  return { ...d, __schema: SCHEMA };
}

/* --------------------------------------------------------------------------
   Intégration iOS : mode installé, notifications, badge d'icône
   -------------------------------------------------------------------------- */

const estInstalle = () => typeof window !== "undefined" &&
  (window.navigator?.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches);

const estIOS = () => typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

async function demanderNotifications() {
  if (typeof Notification === "undefined") return "indisponible";
  if (Notification.permission === "granted") return "granted";
  try { return await Notification.requestPermission(); } catch { return "denied"; }
}

/* La pastille rouge sur l'icône : c'est la seule « bulle » qu'iOS expose à une
   application web installée. Widgets et îlot dynamique restent réservés au natif. */
function poserBadge(n) {
  try { if (n > 0) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch (e) { /* pastille non geree */ }
}

async function notifier(titre, corps) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.showNotification) { await reg.showNotification(titre, { body: corps, icon: "./icones/icone-192.png", badge: "./icones/badge-96.png", tag: "fit-repos", renotify: true, vibrate: [80, 40, 80] }); return true; }
    new Notification(titre, { body: corps, icon: "./icones/icone-192.png" }); return true;
  } catch { return false; }
}

/* --------------------------------------------------------------------------
   Base d'aliments — valeurs pour 100 g
   nom|cat|kcal|prot|gluc|sucres|lip|sat|fibres|portion|g|micros
   micros : fer/calcium/magnesium/potassium en mg, vitD/b12 en µg, vitC en mg
   -------------------------------------------------------------------------- */

const FOOD_CSV = `
Riz blanc cuit|fec|130|2.7|28|0.1|0.3|0.1|0.4|bol|180|magnesium:12;potassium:35
Riz complet cuit|fec|123|2.6|25|0.4|1|0.2|1.8|bol|180|magnesium:44;potassium:86;fer:0.6
Pâtes blanches cuites|fec|158|5.8|31|0.6|0.9|0.2|1.8|assiette|220|magnesium:18;fer:0.5
Pâtes complètes cuites|fec|124|5.3|26|0.8|0.5|0.1|4.5|assiette|220|magnesium:44;fer:1.1;potassium:62
Flocons d'avoine|fec|375|13|59|1|7|1.2|10|bol|60|magnesium:138;fer:4.2;potassium:360
Pain complet|fec|247|9|41|3|3.4|0.7|6.8|tranche|35|magnesium:82;fer:2.5
Pain blanc baguette|fec|270|9|53|2.5|1.5|0.3|2.7|tranche|35|fer:1.2
Pomme de terre cuite|fec|87|2|20|0.9|0.1|0|1.8|moyenne|150|potassium:379;vitC:13
Patate douce cuite|fec|90|2|21|6.5|0.1|0|3.3|moyenne|150|potassium:475;vitC:20
Quinoa cuit|fec|120|4.4|21|0.9|1.9|0.2|2.8|bol|180|magnesium:64;fer:1.5
Semoule couscous cuite|fec|112|3.8|23|0.1|0.2|0|1.4|assiette|200|magnesium:8
Boulgour cuit|fec|83|3.1|19|0.1|0.2|0|4.5|assiette|200|magnesium:32;fer:1
Blanc de poulet|prot|165|31|0|0|3.6|1|0|filet|130|b12:0.3;fer:0.7;potassium:256
Cuisse de poulet sans peau|prot|177|24|0|0|8.6|2.4|0|cuisse|120|fer:1.3;b12:0.6
Dinde escalope|prot|135|29|0|0|1.7|0.5|0|escalope|120|b12:1.2;fer:1.1
Steak haché 5% MG|prot|137|21|0|0|5|2.3|0|steak|125|fer:2.6;b12:2.5;magnesium:21
Steak haché 15% MG|prot|219|19|0|0|15|6.5|0|steak|125|fer:2.4;b12:2.4
Filet de porc|prot|143|26|0|0|4|1.4|0|filet|130|b12:0.7;magnesium:26
Jambon blanc|prot|110|20|1|1|3|1|0|tranche|45|b12:0.6;fer:0.8
Saumon frais|prot|208|20|0|0|13|3.1|0|pavé|130|vitD:11;b12:3.2;potassium:363
Saumon fumé|prot|180|22|0|0|10|2|0|tranche|30|vitD:10;b12:3
Maquereau|prot|205|19|0|0|14|3.3|0|filet|100|vitD:8.5;b12:8.7
Sardines à l'huile|prot|208|25|0|0|11|2.6|0|boîte|100|calcium:382;vitD:5;b12:8.9
Thon naturel|prot|116|26|0|0|1|0.3|0|boîte|100|b12:2.2;vitD:2
Cabillaud|prot|82|18|0|0|0.7|0.1|0|filet|140|b12:0.9;potassium:413
Crevettes|prot|99|24|0|0|0.3|0.1|0|portion|100|b12:1.1;calcium:70
Oeuf entier|prot|143|13|0.7|0.4|9.5|3.1|0|oeuf moyen|55|vitD:2;b12:1.1;fer:1.8
Blanc d'oeuf|prot|52|11|0.7|0.7|0.2|0|0|blanc|33|potassium:163
Tofu ferme|vege|144|17|3|0.6|8|1.2|2.3|portion|150|calcium:350;fer:2.7;magnesium:58
Tempeh|vege|193|19|9|0|11|2.2|6|portion|120|fer:2.7;magnesium:81
Lentilles cuites|vege|116|9|20|1.8|0.4|0.1|8|assiette|200|fer:3.3;magnesium:36;potassium:369
Pois chiches cuits|vege|164|9|27|4.8|2.6|0.3|7.6|assiette|200|fer:2.9;magnesium:48
Haricots rouges cuits|vege|127|9|22|0.3|0.5|0.1|6.4|assiette|200|fer:2.9;potassium:405
Pois cassés cuits|vege|118|8|21|2.9|0.4|0.1|8.3|assiette|200|fer:1.3;magnesium:36
Seitan|vege|141|25|4|0|1.9|0.3|0.6|portion|120|fer:1.4
Protéine whey poudre|prot|380|78|7|5|5|2|0|dose|30|calcium:400
Brocoli cuit|leg|35|2.4|4|1.4|0.4|0.1|3.3|portion|150|vitC:65;calcium:40;potassium:293
Épinards cuits|leg|23|3|1.4|0.4|0.3|0|2.4|portion|150|fer:3.6;magnesium:79;calcium:136
Haricots verts cuits|leg|31|1.8|3.6|1.6|0.2|0|3.4|portion|150|vitC:9;potassium:211
Courgette|leg|17|1.2|2.1|1.7|0.3|0.1|1|moyenne|200|potassium:261;vitC:17
Carotte|leg|41|0.9|7|4.7|0.2|0|2.8|moyenne|90|potassium:320;vitC:6
Tomate|leg|18|0.9|2.7|2.6|0.2|0|1.2|moyenne|120|potassium:237;vitC:14
Poivron rouge|leg|31|1|4.6|4.2|0.3|0|2.1|moyen|150|vitC:128;potassium:211
Salade verte|leg|15|1.4|1.3|0.8|0.2|0|1.3|bol|60|fer:0.9;potassium:194
Champignons de Paris|leg|22|3.1|0.3|0.2|0.3|0|1|portion|120|potassium:318;vitD:0.2
Chou-fleur cuit|leg|23|1.8|2.3|1.9|0.5|0.1|2.3|portion|150|vitC:44;potassium:142
Poireau cuit|leg|31|1.2|4.5|1.9|0.3|0|2.2|portion|150|fer:1.1;potassium:180
Oignon|leg|40|1.1|7.6|4.2|0.1|0|1.7|moyen|110|potassium:146;vitC:7
Avocat|leg|160|2|1.8|0.7|15|2.1|6.7|demi|100|potassium:485;magnesium:29
Banane|fru|89|1.1|20|12|0.3|0.1|2.6|moyenne|120|potassium:358;magnesium:27;vitC:9
Pomme|fru|52|0.3|12|10|0.2|0|2.4|moyenne|150|potassium:107;vitC:5
Orange|fru|47|0.9|9|9|0.1|0|2.4|moyenne|150|vitC:53;calcium:40;potassium:181
Kiwi|fru|61|1.1|10|9|0.5|0|3|moyen|75|vitC:93;potassium:312
Fraises|fru|32|0.7|5.7|4.9|0.3|0|2|bol|150|vitC:59;potassium:153
Myrtilles|fru|57|0.7|12|10|0.3|0|2.4|bol|125|vitC:10;potassium:77
Raisin|fru|69|0.7|16|16|0.2|0|0.9|grappe|150|potassium:191
Dattes|fru|282|2.5|75|63|0.4|0|8|datte|8|potassium:656;magnesium:43
Lait demi-écrémé|lait|46|3.2|4.8|4.8|1.6|1|0|verre|200|calcium:120;b12:0.4
Yaourt nature|lait|61|3.5|4.7|4.7|3.3|2.1|0|pot|125|calcium:121;b12:0.4
Skyr / 0% MG|lait|57|11|4|4|0.2|0.1|0|pot|150|calcium:150;b12:0.5
Fromage blanc 3%|lait|72|8|4|4|3|1.9|0|pot|100|calcium:112
Comté|lait|417|27|0|0|34|21|0|part|30|calcium:900;b12:1.5
Mozzarella|lait|280|22|2|1|21|13|0|boule|125|calcium:505
Parmesan|lait|392|36|4|1|25|16|0|copeaux|20|calcium:1184
Beurre|gras|745|0.7|0.6|0.6|82|51|0|noisette|10|vitD:1.5
Huile d'olive|gras|900|0|0|0|100|14|0|c. à soupe|12|
Huile de colza|gras|900|0|0|0|100|7|0|c. à soupe|12|
Crème fraîche 30%|gras|292|2.4|3|3|30|20|0|c. à soupe|15|calcium:80
Amandes|olea|598|21|10|4|53|4|12|poignée|30|magnesium:270;calcium:264;fer:3.7
Noix|olea|654|15|7|2.6|65|6.1|6.7|poignée|30|magnesium:158;fer:2.9
Noisettes|olea|628|15|7|4.3|61|4.5|10|poignée|30|magnesium:163;fer:4.7
Beurre de cacahuète|olea|588|25|20|9|50|10|6|c. à soupe|16|magnesium:154;fer:1.9
Graines de chia|olea|486|17|42|0|31|3.3|34|c. à soupe|12|calcium:631;magnesium:335;fer:7.7
Graines de lin|olea|534|18|29|1.6|42|3.7|27|c. à soupe|10|magnesium:392;fer:5.7
Chocolat noir 70%|snack|579|8|46|24|43|24|11|carré|10|magnesium:228;fer:11
Biscuits type petit-beurre|snack|450|7|72|24|15|7|2|biscuit|8|
Chips|snack|536|6.6|53|0.3|34|3.1|4.8|poignée|30|potassium:1275
Barre céréales|snack|420|6|65|25|14|6|3|barre|25|
Pizza margherita|snack|266|11|33|3.6|10|4.5|2.3|part|130|calcium:188
Miel|condiment|304|0.3|82|82|0|0|0|c. à café|7|
Ketchup|condiment|101|1.3|23|21|0.1|0|0.4|c. à soupe|15|
Moutarde|condiment|66|4|5|1|3.3|0.2|3.3|c. à café|5|
Sauce soja|condiment|53|8|5|1.7|0.1|0|0.8|c. à soupe|15|
Eau|boisson|0|0|0|0|0|0|0|verre|250|
Café noir|boisson|2|0.3|0|0|0|0|0|tasse|100|potassium:49
Jus d'orange|boisson|45|0.7|10|8.4|0.2|0|0.2|verre|200|vitC:50;potassium:200
Soda cola|boisson|42|0|10.6|10.6|0|0|0|canette|330|
Bière blonde 5%|boisson|43|0.5|3.6|0|0|0|0|demi|250|
Vin rouge|boisson|85|0.1|2.6|0.6|0|0|0|verre|125|potassium:127
`.trim();

const MICRO_LABELS = {
  fer: { n: "Fer", u: "mg", rda: 11 },
  calcium: { n: "Calcium", u: "mg", rda: 950 },
  magnesium: { n: "Magnésium", u: "mg", rda: 380 },
  potassium: { n: "Potassium", u: "mg", rda: 3500 },
  vitD: { n: "Vitamine D", u: "µg", rda: 15 },
  b12: { n: "Vitamine B12", u: "µg", rda: 4 },
  vitC: { n: "Vitamine C", u: "mg", rda: 110 },
};

const CAT_LABELS = {
  fec: "Féculents", prot: "Protéines animales", vege: "Végétal & légumineuses",
  leg: "Légumes", fru: "Fruits", lait: "Produits laitiers", gras: "Matières grasses",
  olea: "Oléagineux", snack: "Snacks", condiment: "Condiments", boisson: "Boissons",
};

function parseFoods() {
  return FOOD_CSV.split("\n").map((line, i) => {
    const c = line.split("|");
    const micros = {};
    if (c[12]) c[12].split(";").forEach((m) => { const [k, v] = m.split(":"); if (k) micros[k] = parseFloat(v); });
    return {
      id: "f" + i, nom: c[0], cat: c[1], kcal: +c[2], prot: +c[3], gluc: +c[4],
      sucres: +c[5], lip: +c[6], sat: +c[7], fibres: +c[8],
      portion: c[9], pg: +c[10], micros, source: "base",
    };
  });
}
const BASE_FOODS = parseFoods();

/* Équivalences pratiques — toujours converties en grammes réels */
const EQUIV = [
  ["1 œuf moyen", 55], ["1 tranche de pain", 35], ["1 c. à soupe d'huile", 12],
  ["1 c. à café d'huile", 5], ["1 poignée d'oléagineux", 30], ["1 bol de riz cuit", 180],
  ["1 yaourt", 125], ["1 verre d'eau", 250], ["1 dose de whey", 30],
];

/* Listes fonctionnelles — A.1.3 */
const LISTES_FONCTION = [
  { id: "fibres", titre: "Riches en fibres", pourquoi: "Transit, satiété, santé du microbiote. Le déficit de fibres est le plus fréquent chez les pratiquants qui priorisent protéines et féculents raffinés.", test: (f) => f.fibres >= 5, couleur: "vert" },
  { id: "densite", titre: "Densité protéique élevée", pourquoi: "Construction et préservation musculaire : beaucoup de protéines pour peu de calories, c'est ce qui permet de tenir 2 g/kg sans exploser l'enveloppe calorique.", test: (f) => f.prot >= 15 && f.prot / Math.max(f.kcal, 1) * 100 >= 8, couleur: "blanc" },
  { id: "omega3", titre: "Sources d'oméga-3", pourquoi: "Fonction anti-inflammatoire et récupération. Deux portions de poisson gras par semaine couvrent l'essentiel.", test: (f) => ["Saumon frais", "Saumon fumé", "Maquereau", "Sardines à l'huile", "Noix", "Huile de colza", "Graines de lin", "Graines de chia"].includes(f.nom), couleur: "bleu" },
  { id: "fer", titre: "Riches en fer", pourquoi: "Transport de l'oxygène, donc performance en endurance. Le fer végétal s'absorbe mal seul : associe-le à une source de vitamine C.", test: (f) => (f.micros.fer || 0) >= 2.5, couleur: "rouge" },
  { id: "calcium", titre: "Calcium & vitamine D", pourquoi: "Santé osseuse, essentielle sous charge lourde. L'os s'adapte à la contrainte s'il a le substrat pour le faire.", test: (f) => (f.micros.calcium || 0) >= 150 || (f.micros.vitD || 0) >= 2, couleur: "blanc" },
  { id: "magpot", titre: "Magnésium & potassium", pourquoi: "Fonction neuromusculaire. Un déficit se traduit d'abord par des crampes et une récupération dégradée.", test: (f) => (f.micros.magnesium || 0) >= 60 || (f.micros.potassium || 0) >= 300, couleur: "vert" },
  { id: "glucLent", titre: "Glucides à digestion lente", pourquoi: "À placer à distance de la séance : libération progressive, énergie stable, pas de pic.", test: (f) => f.cat === "fec" && f.fibres >= 3 && f.sucres < 5, couleur: "jaune" },
  { id: "igBas", titre: "Index glycémique bas", pourquoi: "Index inférieur ou égal à 55 : la glycémie monte progressivement. À privilégier à distance de la séance, quand on cherche une énergie stable et une satiété durable. Attention toutefois : un index bas ne dit rien des calories ni de la qualité globale d'un aliment.", test: (f) => igNiveau(IG[f.nom]) === "bas" && f.gluc >= 5, couleur: "vert" },
  { id: "igEleve", titre: "Index glycémique élevé", pourquoi: "Index supérieur ou égal à 70 : montée rapide de la glycémie. Ce n'est un défaut qu'à distance de l'effort. Autour de la séance, c'est exactement ce que l'on cherche pour reconstituer le glycogène.", test: (f) => igNiveau(IG[f.nom]) === "eleve", couleur: "rouge" },
  { id: "glucRapide", titre: "Glucides à digestion rapide", pourquoi: "Autour de la séance : reconstitution rapide du glycogène quand la fenêtre compte.", test: (f) => (f.cat === "fru" || f.cat === "fec") && f.sucres >= 10, couleur: "jaune" },
];


/* --------------------------------------------------------------------------
   Prix indicatifs, en euros par kilo de produit tel qu'acheté.
   Ordres de grandeur relevés en grande surface française, hors promotion.
   Ils servent à comparer des menus entre eux et à estimer un budget de
   semaine, pas à prédire un ticket de caisse au centime.
   -------------------------------------------------------------------------- */
const PRIX_KG = {
  "Riz blanc cuit": 1.1, "Riz complet cuit": 1.5, "Pâtes blanches cuites": 0.8,
  "Pâtes complètes cuites": 1.3, "Flocons d'avoine": 2.6, "Pain complet": 4.2,
  "Pain blanc baguette": 3.4, "Pomme de terre cuite": 1.6, "Patate douce cuite": 2.9,
  "Quinoa cuit": 3.2, "Semoule couscous cuite": 1.2, "Boulgour cuit": 1.4,
  "Blanc de poulet": 11.5, "Cuisse de poulet sans peau": 7.5, "Dinde escalope": 12.5,
  "Steak haché 5% MG": 13.5, "Steak haché 15% MG": 10.5, "Filet de porc": 11,
  "Jambon blanc": 12, "Saumon frais": 22, "Saumon fumé": 32, "Maquereau": 9,
  "Sardines à l'huile": 11, "Thon naturel": 13, "Cabillaud": 17, "Crevettes": 19,
  "Oeuf entier": 5.2, "Blanc d'oeuf": 6, "Tofu ferme": 9, "Tempeh": 14,
  "Lentilles cuites": 2.2, "Pois chiches cuits": 2, "Haricots rouges cuits": 2.1,
  "Pois cassés cuits": 1.9, "Seitan": 13, "Protéine whey poudre": 26,
  "Brocoli cuit": 3.2, "Épinards cuits": 3.6, "Haricots verts cuits": 3.4,
  "Courgette": 2.4, "Carotte": 1.5, "Tomate": 3, "Poivron rouge": 4,
  "Salade verte": 4.5, "Champignons de Paris": 4.2, "Chou-fleur cuit": 2.6,
  "Poireau cuit": 2.6, "Oignon": 1.6, "Avocat": 6.5,
  "Banane": 1.9, "Pomme": 2.5, "Orange": 2.3, "Kiwi": 3.6, "Fraises": 8,
  "Myrtilles": 14, "Raisin": 4.5, "Dattes": 9,
  "Lait demi-écrémé": 1.2, "Yaourt nature": 2.2, "Skyr / 0% MG": 6.5,
  "Fromage blanc 3%": 2.8, "Comté": 21, "Mozzarella": 8.5, "Parmesan": 26,
  "Beurre": 11, "Huile d'olive": 9.5, "Huile de colza": 4, "Crème fraîche 30%": 5.5,
  "Amandes": 16, "Noix": 14, "Noisettes": 20, "Beurre de cacahuète": 9,
  "Graines de chia": 12, "Graines de lin": 6, "Chocolat noir 70%": 14,
  "Biscuits type petit-beurre": 5, "Chips": 8, "Barre céréales": 12,
  "Pizza margherita": 6, "Miel": 12, "Ketchup": 3.5, "Moutarde": 4,
  "Sauce soja": 5, "Eau": 0, "Café noir": 0.5, "Jus d'orange": 1.6,
  "Soda cola": 1.2, "Bière blonde 5%": 2.5, "Vin rouge": 6,
};
const prixDe = (nom, grammes) => ((PRIX_KG[nom] ?? 4) * grammes) / 1000;
const euro = (v) => (v < 10 ? v.toFixed(2) : Math.round(v * 10) / 10).toString().replace(".", ",") + " €";

/* --------------------------------------------------------------------------
   Paliers de composition corporelle
   Des repères factuels, pas des physiques à imiter. Chaque palier dit ce qu'il
   demande réellement, combien de temps il prend, et ce qu'il coûte à tenir.
   -------------------------------------------------------------------------- */
const PALIERS_MG = {
  H: [
    { id: "essentiel", nom: "Sous 6 %", plage: [0, 6], couleur: "rouge", danger: true,
      apparence: "Niveau de scène en bodybuilding, tenu quelques jours seulement.",
      cout: "En dessous du seuil de graisse essentielle. Chute de testostérone, perte de libido, troubles du sommeil, fragilité osseuse, système immunitaire affaibli. Ce n'est pas un objectif, c'est un état transitoire de compétition, préparé et encadré.",
      duree: "Non tenable. Le retour à un niveau normal est immédiat après la compétition." },
    { id: "tresSec", nom: "6 à 9 %", plage: [6, 9], couleur: "rouge",
      apparence: "Abdominaux nets en permanence, vascularisation visible, très peu de graisse sous-cutanée.",
      cout: "Faim quasi constante, performance en baisse, vie sociale difficile, souvent une aménorrhée chez la femme à l'équivalent. Beaucoup de gens y arrivent, très peu y restent.",
      duree: "Quelques semaines après une sèche menée jusqu'au bout. Compte 5 à 8 mois de déficit depuis 20 %." },
    { id: "sec", nom: "10 à 13 %", plage: [9, 14], couleur: "jaune",
      apparence: "Abdominaux visibles, dessin musculaire net, silhouette athlétique franche.",
      cout: "Demande une attention alimentaire régulière mais reste vivable. C'est le niveau que la plupart des gens ont en tête quand ils disent vouloir « être sec ».",
      duree: "Tenable à l'année pour quelqu'un de rigoureux. 3 à 5 mois de sèche depuis 20 %." },
    { id: "athletique", nom: "14 à 18 %", plage: [14, 18], couleur: "vert",
      apparence: "Silhouette sportive, abdominaux devinés en contraction, muscles apparents sans être découpés.",
      cout: "Faible. C'est la zone la plus confortable : performance maximale, hormones normales, alimentation souple, progression en force possible.",
      duree: "Tenable indéfiniment. C'est généralement le meilleur endroit où vivre entre deux phases." },
    { id: "moyen", nom: "19 à 24 %", plage: [18, 25], couleur: "bleu",
      apparence: "Silhouette normale, muscles présents mais peu dessinés.",
      cout: "Aucun problème de santé en soi. C'est le point de départ le plus fréquent, et c'est un bon endroit pour construire du muscle sans se restreindre.",
      duree: "Sans limite. Une sèche devient pertinente au-delà de 20 % si l'objectif est esthétique." },
    { id: "eleve", nom: "Au-dessus de 25 %", plage: [25, 100], couleur: "jaune",
      apparence: "Contours musculaires peu visibles, tour de taille marqué.",
      cout: "Au-delà de 25 %, le risque métabolique commence à monter. C'est le seul cas où une perte de gras relève aussi de la santé et pas seulement de l'esthétique.",
      duree: "Une phase de perte de gras est indiquée. Un avis médical est utile au-delà de 30 %." },
  ],
  F: [
    { id: "essentiel", nom: "Sous 14 %", plage: [0, 14], couleur: "rouge", danger: true,
      apparence: "Niveau de scène, tenu quelques jours.",
      cout: "Sous le seuil de graisse essentielle chez la femme. Aménorrhée quasi systématique, perte de densité osseuse, troubles hormonaux durables. Ce n'est pas un objectif.",
      duree: "Non tenable, et risqué même brièvement sans encadrement médical." },
    { id: "tresSec", nom: "14 à 18 %", plage: [14, 18], couleur: "rouge",
      apparence: "Abdominaux visibles, très peu de graisse sous-cutanée.",
      cout: "Le cycle menstruel s'interrompt fréquemment à ce niveau, ce qui est un signal d'alerte à ne pas ignorer. Faim constante, humeur instable.",
      duree: "Quelques semaines au maximum, en fin de préparation." },
    { id: "sec", nom: "19 à 23 %", plage: [18, 24], couleur: "jaune",
      apparence: "Silhouette athlétique très définie, abdominaux devinés.",
      cout: "Exige une rigueur constante. Tenable pour certaines, difficile pour d'autres : la variabilité individuelle est grande.",
      duree: "3 à 5 mois de sèche depuis 30 %." },
    { id: "athletique", nom: "24 à 29 %", plage: [24, 30], couleur: "vert",
      apparence: "Silhouette sportive, muscles apparents, courbes conservées.",
      cout: "Faible. Zone de confort : hormones normales, performance maximale, cycle régulier.",
      duree: "Tenable indéfiniment. Le meilleur endroit où vivre entre deux phases." },
    { id: "moyen", nom: "30 à 35 %", plage: [30, 36], couleur: "bleu",
      apparence: "Silhouette normale.",
      cout: "Aucun problème de santé en soi, et une bonne base pour construire du muscle.",
      duree: "Sans limite." },
    { id: "eleve", nom: "Au-dessus de 36 %", plage: [36, 100], couleur: "jaune",
      apparence: "Tour de taille marqué.",
      cout: "Le risque métabolique commence à monter au-delà de ce seuil.",
      duree: "Une phase de perte de gras est indiquée. Avis médical utile au-delà de 42 %." },
  ],
};
const palierDe = (sexe, mg) => (PALIERS_MG[sexe] || PALIERS_MG.H).find((p) => mg >= p.plage[0] && mg < p.plage[1]) || PALIERS_MG.H[4];
const MG_PLANCHER = { H: 8, F: 16 };

/* --------------------------------------------------------------------------
   Glossaire — le jargon expliqué, pour qu'il n'exclue personne
   -------------------------------------------------------------------------- */
const GLOSSAIRE = [
  { t: "RPE", dev: "Rate of Perceived Exertion — effort perçu", cat: "Entraînement",
    d: "Une note de 1 à 10 qui dit à quel point la série était dure. Ce n'est pas une impression vague : elle se lit en répétitions restantes. RPE 8 signifie qu'il te restait deux répétitions propres dans le réservoir. RPE 10 signifie que la suivante ne serait pas passée.",
    ex: "Tu fais 8 répétitions à 80 kg et tu sens que tu aurais pu en faire 2 de plus : c'est RPE 8.",
    pourquoi: "La charge d'un pourcentage figé ne tient pas compte de ta forme du jour. Le RPE, si. C'est ce qui permet de bien s'entraîner un jour de fatigue au lieu de forcer bêtement." },
  { t: "RIR", dev: "Repetitions In Reserve — répétitions en réserve", cat: "Entraînement",
    d: "L'autre face du RPE : le nombre de répétitions que tu aurais encore pu faire. RIR 2 correspond à RPE 8, RIR 0 à RPE 10.",
    ex: "3 RIR sur une série de squat : tu t'arrêtes trois répétitions avant l'échec.",
    pourquoi: "Sur les mouvements lourds, garder 2 à 3 répétitions en réserve conserve presque tout le stimulus pour beaucoup moins de fatigue et de risque." },
  { t: "1RM", dev: "Une répétition maximale", cat: "Entraînement",
    d: "La charge la plus lourde que tu peux soulever une seule fois avec une technique correcte. L'application l'estime à partir de tes séries loggées, sans jamais te faire tester un vrai maximum.",
    ex: "100 kg × 5 répétitions donne un maximum estimé autour de 117 kg.",
    pourquoi: "Tester un vrai maximum coûte cher en fatigue et se fait rarement seul en sécurité. L'estimation suffit pour piloter les pourcentages." },
  { t: "Tempo", dev: "Vitesse d'exécution", cat: "Entraînement",
    d: "Trois chiffres : durée de la descente, durée de la pause en bas, durée de la remontée, en secondes. Un X à la fin signifie « le plus explosif possible ».",
    ex: "3-0-1 : tu descends en 3 secondes, aucun arrêt, tu remontes en 1 seconde.",
    pourquoi: "Deux séries de 10 répétitions peuvent durer 20 ou 50 secondes selon le tempo. Le temps passé sous tension change le stimulus autant que la charge." },
  { t: "Volume", dev: "Volume d'entraînement", cat: "Entraînement",
    d: "Le nombre de séries efficaces réalisées par groupe musculaire et par semaine. Une série efficace est une série menée assez près de l'échec pour compter.",
    ex: "4 séries de développé et 3 d'écarté, deux fois par semaine : 14 séries hebdomadaires sur les pectoraux.",
    pourquoi: "C'est le levier principal de l'hypertrophie. La fourchette utile va d'environ 10 à 20 séries par groupe et par semaine." },
  { t: "Surcharge progressive", dev: "", cat: "Entraînement",
    d: "Le principe de base : pour que le corps s'adapte, la demande doit augmenter au fil du temps. Cela passe par la charge, mais aussi par les répétitions, les séries, l'amplitude ou le tempo.",
    ex: "Semaine 1 : 8 répétitions à 60 kg. Semaine 3 : 10 répétitions à 60 kg. Semaine 4 : 8 répétitions à 65 kg.",
    pourquoi: "Sans elle, aucun programme ne fonctionne, aussi bien conçu soit-il." },
  { t: "Deload", dev: "Semaine de décharge", cat: "Entraînement",
    d: "Une semaine à volume ou intensité réduits de 40 à 50 %, planifiée toutes les 4 à 6 semaines selon ton niveau.",
    ex: "Au lieu de 4 séries à RPE 9, tu fais 2 séries à RPE 6.",
    pourquoi: "Ce n'est pas une semaine perdue : c'est là que la supercompensation s'exprime. Sauter les décharges est la cause de stagnation la plus fréquente chez les pratiquants assidus." },
  { t: "Échec technique", dev: "", cat: "Entraînement",
    d: "Le moment où la répétition suivante ne serait plus exécutée proprement. Il arrive avant l'échec musculaire, où le muscle ne peut plus rien du tout.",
    ex: "Ton dos commence à s'arrondir au rowing : tu es à l'échec technique, tu arrêtes la série.",
    pourquoi: "Les répétitions au-delà de l'échec technique n'apportent presque rien et concentrent l'essentiel du risque de blessure." },
  { t: "Polyarticulaire", dev: "", cat: "Entraînement",
    d: "Un exercice qui met en jeu plusieurs articulations et plusieurs muscles à la fois. Par opposition à l'isolation, qui n'en mobilise qu'une.",
    ex: "Le squat est polyarticulaire, le leg extension est une isolation.",
    pourquoi: "Les polyarticulaires passent en premier dans la séance : ils demandent un système nerveux frais et rapportent le plus." },
  { t: "Métabolisme de base", dev: "MB ou BMR", cat: "Nutrition",
    d: "Ce que ton corps dépense au repos complet, sans rien faire, pour maintenir ses fonctions vitales. C'est le socle de ton besoin calorique.",
    ex: "Environ 1 700 kcal pour un homme de 75 kg.",
    pourquoi: "Toute cible calorique part de là. Descendre durablement en dessous est le signal d'un déficit mal réglé." },
  { t: "Maintenance", dev: "Dépense énergétique totale", cat: "Nutrition",
    d: "Métabolisme de base plus tout le reste : digestion, travail, pas quotidiens, entraînement. C'est le nombre de calories qui te fait rester au même poids.",
    ex: "1 700 kcal de base, plus 350 pour un métier debout, plus 250 pour tes pas, plus 200 d'entraînement, donne environ 2 500 kcal.",
    pourquoi: "Au-dessus tu prends, en dessous tu perds. Tout le reste n'est que réglage." },
  { t: "Déficit et surplus", dev: "", cat: "Nutrition",
    d: "L'écart entre ce que tu manges et ta maintenance, exprimé en pourcentage plutôt qu'en calories brutes.",
    ex: "Un déficit de 15 % sur 2 500 kcal fait une cible à 2 125 kcal.",
    pourquoi: "Un pourcentage s'adapte à ton gabarit, contrairement à un « moins 500 kcal » qui n'a pas le même sens à 55 kg et à 100 kg." },
  { t: "Index glycémique", dev: "IG", cat: "Nutrition",
    d: "La vitesse à laquelle les glucides d'un aliment font monter la glycémie, mesurée sur une quantité fixe de 100 g de glucides purs.",
    ex: "Pain blanc 95, patate douce 63, lentilles 32.",
    pourquoi: "Utile pour placer les glucides autour de la séance. Mais l'index seul est trompeur : voir la charge glycémique." },
  { t: "Charge glycémique", dev: "CG", cat: "Nutrition",
    d: "L'index corrigé par la quantité réellement mangée. C'est elle qui décrit l'effet réel sur la glycémie.",
    ex: "La carotte a un index de 39, mais 90 g n'apportent que 6 g de glucides : sa charge est de 2, donc négligeable.",
    pourquoi: "Personne ne mange 100 g de glucides de carotte. La charge est la seule des deux qui décrive ton assiette." },
  { t: "Masse maigre", dev: "", cat: "Nutrition",
    d: "Tout ce qui n'est pas de la graisse : muscles, os, organes, eau. C'est elle qu'on cherche à préserver en sèche.",
    ex: "80 kg à 15 % de masse grasse font 68 kg de masse maigre.",
    pourquoi: "Perdre du poids est facile. Perdre du gras en gardant la masse maigre est le vrai objectif, et c'est ce qui distingue une sèche d'un régime." },
  { t: "DIAAS", dev: "Score de qualité protéique", cat: "Nutrition",
    d: "Une mesure de la digestibilité et du profil en acides aminés d'une protéine. Un score supérieur à 1,0 signifie qu'elle couvre tous les besoins sans acide aminé limitant.",
    ex: "Œufs, lait, viandes et poissons dépassent 1,0. La plupart des sources végétales isolées sont en dessous, sauf le soja.",
    pourquoi: "Si tu manges peu de produits animaux, il faut associer les sources pour compenser." },
  { t: "RED-S", dev: "Déficit énergétique relatif dans le sport", cat: "Santé",
    d: "L'ensemble des conséquences d'un apport calorique trop bas maintenu trop longtemps : chute des performances, perturbations hormonales, fragilité osseuse, troubles du sommeil et de l'humeur.",
    ex: "Un déficit agressif tenu plusieurs mois sans phase de maintien.",
    pourquoi: "C'est le principal risque d'une sèche mal conduite. L'application surveille ce seuil et alerte avant qu'il ne soit franchi." },
];
const CAT_GLOSSAIRE = ["Entraînement", "Nutrition", "Santé"];

/* --------------------------------------------------------------------------
   Index glycémique et charge glycémique
   L'IG classe un aliment sur 100 g de glucides purs. La CG tient compte de la
   quantité réellement mangée : c'est elle qui décrit l'effet réel sur la glycémie.
   Valeurs issues des tables internationales de référence (Foster-Powell et al.,
   University of Sydney). Ce sont des moyennes : la cuisson, la maturité, la
   présence de fibres, de lipides ou de protéines dans le repas modifient
   sensiblement la réponse réelle, qui varie aussi d'une personne à l'autre.
   -------------------------------------------------------------------------- */

const IG = {
  "Riz blanc cuit": 73, "Riz complet cuit": 68, "Pâtes blanches cuites": 49,
  "Pâtes complètes cuites": 42, "Flocons d'avoine": 55, "Pain complet": 71,
  "Pain blanc baguette": 95, "Pomme de terre cuite": 78, "Patate douce cuite": 63,
  "Quinoa cuit": 53, "Semoule couscous cuite": 65, "Boulgour cuit": 48,
  "Lentilles cuites": 32, "Pois chiches cuits": 28, "Haricots rouges cuits": 24,
  "Pois cassés cuits": 25, "Banane": 51, "Pomme": 36, "Orange": 43, "Kiwi": 50,
  "Fraises": 41, "Myrtilles": 53, "Raisin": 59, "Dattes": 55,
  "Lait demi-écrémé": 37, "Yaourt nature": 41, "Skyr / 0% MG": 15, "Fromage blanc 3%": 30,
  "Miel": 61, "Chocolat noir 70%": 23, "Biscuits type petit-beurre": 64,
  "Chips": 56, "Barre céréales": 61, "Pizza margherita": 60, "Ketchup": 55,
  "Jus d'orange": 50, "Soda cola": 63, "Carotte": 39, "Tomate": 15, "Poivron rouge": 15,
  "Courgette": 15, "Brocoli cuit": 15, "Oignon": 15, "Haricots verts cuits": 30,
  "Chou-fleur cuit": 15, "Poireau cuit": 15, "Épinards cuits": 15, "Salade verte": 15,
  "Champignons de Paris": 15, "Avocat": 10, "Amandes": 15, "Noix": 15, "Noisettes": 15,
  "Beurre de cacahuète": 14, "Graines de chia": 1, "Graines de lin": 1,
};

const igNiveau = (v) => (v == null ? null : v <= 55 ? "bas" : v <= 69 ? "modere" : "eleve");
const IG_LABEL = { bas: { l: "IG bas", c: "vert" }, modere: { l: "IG modéré", c: "jaune" }, eleve: { l: "IG élevé", c: "rouge" } };
const cgNiveau = (v) => (v <= 10 ? "bas" : v <= 19 ? "modere" : "eleve");

/* Charge glycémique de la portion réellement consommée */
function chargeGlycemique(f, g) {
  const ig = IG[f.nom]; if (ig == null) return null;
  const glucides = (f.gluc * g) / 100;
  return { ig, cg: Math.round((ig * glucides) / 100 * 10) / 10, glucides: Math.round(glucides * 10) / 10 };
}

const PEDAGO_IG = {
  titre: "Index glycémique et charge glycémique",
  texte: "L'index glycémique classe un aliment selon la vitesse à laquelle ses glucides font monter la glycémie, mesurée sur une quantité fixe de 100 g de glucides purs. Le problème est que personne ne mange 100 g de glucides de carotte. La charge glycémique corrige ça : elle multiplie l'index par la quantité de glucides réellement présente dans ta portion. La carotte a un index de 39, mais 90 g de carotte ne contiennent que 6 g de glucides : sa charge est de 2, c'est-à-dire négligeable. C'est la charge qui décrit l'effet réel, pas l'index.",
  reperes: "Index : bas jusqu'à 55, modéré de 56 à 69, élevé au-delà de 70. Charge par portion : basse jusqu'à 10, modérée de 11 à 19, élevée au-delà de 20.",
  nuances: "Trois choses relativisent ces chiffres. La cuisson et la maturité les modifient nettement — des pâtes al dente et des pâtes trop cuites n'ont pas le même index, une banane mûre non plus. Les fibres, les lipides et les protéines du même repas ralentissent la vidange gastrique et abaissent la réponse réelle : un index mesuré sur l'aliment seul ne décrit pas ce qui se passe dans un repas complet. Enfin la variabilité entre individus est importante, ce que les tables ne montrent pas.",
  usage: "En pratique : index bas ou modéré à distance de la séance pour une énergie stable, index élevé autour de la séance quand la reconstitution rapide du glycogène est utile. Hors de ces deux moments, c'est le total calorique et l'apport en fibres qui pèsent bien plus lourd que l'index.",
};

/* --------------------------------------------------------------------------
   Base d'exercices — B.7
   nom|groupe|secondaires|materiel|type|pattern|niveau|interet|consignes|erreurs|variantes|contre
   -------------------------------------------------------------------------- */

const EX_CSV = `
Développé couché barre|Pectoraux|pec-stern;pec-abdo|delt-ant;tri-lat|barre|poly|pousseeH|inter|Référence de poussée horizontale : charge lourde, progression mesurable, base de la force du haut du corps.|Le sternal travaille en adduction horizontale du bras. La tension est maximale en position basse, quand les fibres sont allongées et le bras à l'écart du tronc — c'est cette portion de l'amplitude qui construit le plus.|Omoplates serrées et basses, pieds ancrés, barre au niveau du bas des pectoraux, coudes à environ 45 degrés du tronc.|Coudes trop écartés, rebond sur la poitrine, fessiers qui décollent.|Coudes à 90 degrés du tronc : cisaillement de l'articulation acromio-claviculaire et conflit sous-acromial. Sans pareur, la barre bloquée sur la cage est le premier accident de salle.|Développé haltères, développé incliné, développé au sol|Douleur d'épaule antérieure, luxation antérieure ancienne
Développé incliné barre|Pectoraux|pec-clav|delt-ant;tri-lat|barre|poly|pousseeH|inter|Cible le faisceau claviculaire, point faible le plus fréquent chez ceux qui ne font que du couché.|Le faisceau claviculaire s'insère sur la clavicule : il se raccourcit surtout quand le bras monte en diagonale vers l'intérieur. L'inclinaison à 30 degrés place cette ligne de traction dans l'axe de la barre.|Banc à 30 degrés maximum, barre au niveau du haut des pectoraux, coudes sous les poignets.|Inclinaison à 45 degrés ou plus : le mouvement bascule sur les deltoïdes antérieurs.|Plus l'inclinaison monte, plus l'épaule est en position de conflit. Au-delà de 45 degrés, c'est un développé épaules déguisé.|Développé incliné haltères, écarté incliné|Douleur d'épaule
Développé incliné haltères|Pectoraux|pec-clav|delt-ant;tri-lat|halteres|poly|pousseeH|debutant|Amplitude et liberté articulaire supérieures à la barre, avec un travail unilatéral qui corrige les asymétries.|Les haltères permettent aux mains de converger en fin de course, ce qui ajoute de l'adduction et raccourcit davantage le pectoral qu'une barre qui bloque l'écartement.|Banc à 30 degrés, descente jusqu'à l'étirement sans forcer, convergence légère en haut.|Cogner les haltères en haut, descendre au-delà de l'amplitude confortable de l'épaule.|Un étirement excessif sous charge lourde met la capsule antérieure de l'épaule en tension extrême.|Développé incliné barre, écarté incliné poulie|Instabilité d'épaule
Développé couché haltères|Pectoraux|pec-stern|delt-ant;tri-lat|halteres|poly|pousseeH|debutant|Alternative au couché quand l'épaule tolère mal la barre : la trajectoire s'adapte à ton anatomie au lieu de l'imposer.|Chaque bras gère sa propre trajectoire, ce qui réduit la contrainte de rotation interne forcée et permet une descente plus profonde.|Poignets neutres ou légèrement pronés, coudes à 45 degrés, contrôle de la descente sur 2 à 3 secondes.|Charges déséquilibrées entre les deux bras, à-coups en bas.|La mise en place et la sortie de position sont les moments à risque : monte les haltères genoux fléchis puis bascule.|Développé couché barre, presse convergente|
Développé décliné|Pectoraux|pec-abdo|tri-lat;pec-stern|barre|poly|pousseeH|inter|Portion inférieure du pectoral, souvent la mieux servie chez ceux qui ont un couché lourd mais utile en finition.|Le faisceau abdominal tire le bras vers le bas et l'intérieur : la déclinaison aligne la résistance sur cette ligne de traction.|Déclinaison de 15 à 20 degrés, barre au niveau du bas des pectoraux.|Déclinaison excessive qui transforme le mouvement en pull-over.|Position tête en bas : montée de pression intracrânienne, à éviter en cas d'hypertension ou de sensibilité.|Dips buste penché, écarté à la poulie haute|Hypertension, reflux gastro-oesophagien
Développé couché prise serrée|Pectoraux|pec-stern|tri-long;tri-lat;delt-ant|barre|poly|pousseeH|inter|Deux exercices en un : renforce le triceps tout en gardant un stimulus pectoral, très rentable en séance courte.|La prise serrée réduit l'adduction horizontale et augmente l'extension de coude : la part du triceps monte nettement.|Mains à largeur d'épaules, coudes serrés le long du corps, barre au niveau du sternum.|Prise trop serrée qui écrase les poignets.|Prise inférieure à la largeur d'épaules : contrainte importante sur le poignet et le coude.|Barre au front, dips buste vertical|Douleur de poignet
Dips pectoraux|Pectoraux|pec-abdo;pec-stern|tri-lat;delt-ant|pdc|poly|pousseeH|inter|Très forte tension en étirement sur le bas des pectoraux, difficile à reproduire avec un autre mouvement.|En bas, l'épaule est en extension maximale : le pectoral est étiré sous charge, ce qui est un stimulus hypertrophique puissant mais exigeant.|Buste penché en avant, coudes légèrement écartés, descente jusqu'à ce que les bras soient à l'horizontale.|Descendre trop bas sans mobilité suffisante, à-coups en bas de mouvement.|Descente excessive : lésion du grand pectoral à son insertion et contrainte sur l'articulation sterno-claviculaire.|Dips assistés machine, développé décliné|Douleur d'épaule, antécédent de luxation
Pompes|Pectoraux|pec-stern|tri-lat;delt-ant;grand-droit-haut|pdc|poly|pousseeH|debutant|Toujours disponible, excellente en volume ou en substitution quand le matériel manque.|La position de planche ajoute une composante de gainage antirotation qui n'existe pas au banc : le tronc travaille en même temps que la poussée.|Corps aligné cheville-hanche-épaule, gainage actif, poitrine près du sol, coudes à 45 degrés.|Bassin qui s'affaisse, amplitude partielle, tête qui plonge en avant.|L'affaissement du bassin met les lombaires en hyperextension sous charge répétée.|Pompes surélevées, pompes lestées, pompes déclinées|
Pompes déclinées|Pectoraux|pec-clav|delt-ant;tri-lat|pdc|poly|pousseeH|debutant|Version pompe qui cible le haut des pectoraux, sans banc ni charge.|Pieds surélevés : le corps pousse vers le haut et l'avant, ce qui reproduit la ligne de traction du faisceau claviculaire.|Pieds sur un support stable de 30 à 50 cm, corps gréé, poitrine vers le sol.|Support instable, bassin cassé.|Plus la déclinaison est forte, plus la charge passe sur l'épaule en position haute.|Développé incliné, pompes pieds sur banc|
Écarté haltères|Pectoraux|pec-stern|delt-ant|halteres|iso|pousseeH|debutant|Isolation pure du pectoral : la seule articulation qui bouge est l'épaule, le triceps ne peut pas prendre le relais.|Le pectoral est chargé au maximum en position allongée. La tension chute presque à zéro en haut, quand les bras sont verticaux : c'est pour cela que l'écarté se fait en contrôle, pas en charge.|Coudes légèrement fléchis et fixes, descente jusqu'à l'étirement confortable, remontée en pensant à rapprocher les coudes.|Fléchir puis tendre les coudes, ce qui transforme l'écarté en développé.|La position basse charge la capsule antérieure de l'épaule : c'est l'exercice où une charge trop lourde blesse le plus vite.|Écarté poulie, pec deck|Instabilité d'épaule, tendinopathie du long biceps
Écarté à la poulie|Pectoraux|pec-stern;pec-abdo|delt-ant|poulie|iso|pousseeH|debutant|Tension constante sur toute l'amplitude, contrairement aux haltères qui perdent la charge en haut.|La poulie maintient la résistance horizontale du début à la fin : le pectoral reste chargé y compris en position raccourcie, là où l'écarté haltères ne demande plus rien.|Un pas en avant pour créer la tension, coudes fixes, croiser légèrement les mains en fin de course.|Tirer avec les bras tendus comme un pull-over, buste qui s'effondre.|Charge excessive : compensation par une rotation du tronc.|Pec deck, écarté haltères|
Écarté incliné à la poulie basse|Pectoraux|pec-clav|delt-ant|poulie|iso|pousseeH|inter|Isolation du haut des pectoraux, zone que peu d'exercices atteignent en isolation.|La traction part du bas et monte en diagonale vers l'intérieur : c'est exactement la ligne des fibres claviculaires.|Poulies au sol, banc à 30 degrés, mouvement en diagonale montante.|Monter trop haut et perdre la tension.|Charge lourde en position d'étirement : contrainte sur l'épaule antérieure.|Développé incliné haltères, pec deck incliné|
Pec deck|Pectoraux|pec-stern|delt-ant|machine|iso|pousseeH|debutant|Isolation guidée : idéale en fin de séance ou en pré-fatigue, aucune exigence de stabilisation.|La machine impose la trajectoire et supprime le rôle stabilisateur de l'épaule, ce qui permet d'aller près de l'échec sans risque technique.|Coudes à hauteur d'épaules, dos plaqué, contraction d'une seconde en fin de course.|Épaules qui s'enroulent vers l'avant, amplitude d'ouverture excessive.|Ouverture trop grande en début de mouvement : mise en tension brutale de la capsule antérieure.|Écarté poulie, écarté haltères|
Presse convergente pectoraux|Pectoraux|pec-stern|tri-lat;delt-ant|machine|poly|pousseeH|debutant|Charge lourde en sécurité, sans pareur : parfait pour aller près de l'échec en solo.|La convergence des poignées ajoute de l'adduction en fin de course, ce que la barre ne permet pas.|Réglage du siège pour que les poignées soient au niveau du bas des pectoraux.|Verrouiller les coudes brutalement en fin de poussée.|Le réglage trop bas du siège place l'épaule en conflit.|Développé haltères, développé barre|
Pull-over haltère|Pectoraux|pec-abdo|dors-sup;tri-long|halteres|iso|pousseeH|inter|Travaille le pectoral et le grand dorsal en étirement maximal, dans un plan que rien d'autre ne sollicite.|Le bras passe de l'extension complète au-dessus de la tête vers la flexion : les fibres inférieures du pectoral et le grand dorsal se raccourcissent ensemble.|Buste sur le banc ou en travers, coudes légèrement fléchis, descente lente jusqu'à l'étirement.|Cambrure lombaire excessive pour gagner de l'amplitude.|Position d'étirement extrême sous charge : l'épaule et le coude sont vulnérables. Charge modérée obligatoire.|Pull-over poulie haute, écarté|Instabilité d'épaule
Pompes archer|Pectoraux|pec-stern|tri-lat;grand-droit-haut|pdc|poly|pousseeH|avance|Étape vers la pompe à un bras : charge fortement un côté sans matériel.|Le bras tendu sert d'appui pendant que l'autre encaisse l'essentiel de la charge, ce qui double la contrainte unilatérale.|Écartement large, poids transféré sur un bras, l'autre reste tendu latéralement.|Rotation du bassin pour tricher.|Le bras tendu subit une traction latérale sur le coude et l'épaule.|Pompes surélevées, pompes classiques|
Pompes surélevées|Pectoraux|pec-stern|tri-lat|pdc|poly|pousseeH|debutant|Version allégée pour construire du volume quand les pompes au sol sont encore trop dures.|Plus les mains sont hautes, plus la part du poids de corps portée par les bras diminue : c'est un réglage continu de la difficulté.|Mains sur un banc ou un rebord, corps aligné, amplitude complète.|Utiliser un support trop bas et perdre l'amplitude.|Support instable.|Pompes au sol, pompes sur genoux|
Développé au sol|Pectoraux|pec-stern|tri-lat|barre|poly|pousseeH|inter|Amplitude limitée par le sol : permet de charger lourd quand l'épaule ne tolère plus la descente complète.|Le coude touche le sol avant que l'épaule n'atteigne l'extension complète : la portion la plus contraignante du mouvement est supprimée.|Coudes qui touchent le sol, pause d'une seconde, poussée explosive.|Rebondir sur le sol avec les coudes.|Le rebond peut léser le coude.|Développé couché, développé partiel en rack|
Écarté machine incliné|Pectoraux|pec-clav|delt-ant|machine|iso|pousseeH|debutant|Isolation guidée du haut des pectoraux, sans exigence de stabilisation.|Le guidage permet de tenir la position raccourcie plusieurs secondes, ce qui augmente le temps sous tension.|Siège réglé pour que les coudes soient à hauteur de la clavicule.|Utiliser l'élan du buste.|Ouverture excessive.|Écarté poulie basse, développé incliné|
Pompes prise large|Pectoraux|pec-stern|delt-ant|pdc|poly|pousseeH|debutant|Accentue l'adduction horizontale : plus de pectoral, moins de triceps.|Un écartement large augmente le bras de levier du pectoral et réduit l'amplitude d'extension du coude.|Mains à une fois et demie la largeur d'épaules, poitrine au sol.|Écartement extrême qui met l'épaule en abduction à 90 degrés.|Conflit sous-acromial si les coudes partent à l'équerre.|Pompes classiques, écarté|
Traction pronation|Dorsaux|dors-sup|bic-long;rhomb;trap-inf|pdc|poly|tirageV|inter|Meilleur constructeur de largeur de dos et meilleur indicateur du rapport force sur poids.|Le grand dorsal ramène le bras du dessus de la tête vers le tronc : c'est de l'adduction. En prise pronation large, le biceps aide moins et le dorsal fait davantage le travail.|Prise un peu plus large que les épaules, initier par la descente des omoplates, menton au-dessus de la barre, descente contrôlée.|Balancement, amplitude partielle, épaules qui montent aux oreilles en bas.|La descente complète brutale avec les épaules relâchées met la coiffe des rotateurs en traction. Garde une tension résiduelle en bas.|Traction supination, tirage vertical, traction assistée élastique|Épicondylite, douleur d'épaule
Traction supination|Dorsaux|dors-sup|bic-long;bic-court;brachial|pdc|poly|tirageV|inter|Plus de biceps, souvent plus de répétitions accessibles : bonne porte d'entrée vers la traction pronation.|La supination place le biceps en position de force optimale, ce qui augmente la charge totale déplaçable et le stimulus sur le bras.|Prise largeur d'épaules paumes vers soi, poitrine vers la barre, coudes vers le bas.|Cambrer excessivement pour raccourcir la distance.|Contrainte accrue sur le tendon distal du biceps, surtout en descente lente lestée.|Traction neutre, tirage supination|Tendinopathie du biceps
Traction prise neutre|Dorsaux|dors-sup|brachial;bic-long|pdc|poly|tirageV|debutant|La prise la plus confortable pour l'épaule et le coude : celle à privilégier en cas de douleur.|La prise marteau place l'avant-bras en position neutre, ce qui réduit la contrainte de rotation sur le coude et l'épaule.|Poignées parallèles, tirer les coudes vers les hanches.|Se balancer pour lancer le mouvement.|Peu de risques : c'est la variante la plus tolérante.|Traction pronation, tirage prise neutre|
Tirage vertical poulie|Dorsaux|dors-sup|bic-long;rhomb|poulie|poly|tirageV|debutant|Permet de doser la charge au kilo près quand la traction n'est pas encore accessible.|Même adduction du bras que la traction, mais avec une charge réglable : on peut travailler la fourchette de répétitions exacte visée.|Poitrine sortie, barre vers le haut des pectoraux, léger recul du buste seulement.|Tirer avec les bras sans engager les omoplates, se balancer d'avant en arrière.|Tirage derrière la nuque : rotation externe forcée, à proscrire chez presque tout le monde.|Traction, tirage prise neutre|
Tirage vertical prise serrée|Dorsaux|dors-inf|bic-long;brachial|poulie|poly|tirageV|debutant|Accentue les fibres basses du grand dorsal, celles qui donnent l'épaisseur sous l'omoplate.|Une prise serrée augmente l'amplitude d'adduction et fait descendre le coude plus près du tronc, ce qui raccourcit davantage les fibres inférieures.|Prise serrée neutre, coudes vers les hanches, contraction en fin de course.|Se pencher en arrière à 45 degrés.|Charge excessive et compensation lombaire.|Tirage vertical, traction neutre|
Rowing barre buste penché|Dorsaux|dors-inf;rhomb|trap-moy;bic-long;lombaires|barre|poly|tirageH|inter|Épaisseur du dos et contre-poids indispensable au développé couché pour la santé de l'épaule.|Le tirage horizontal met les rhomboïdes et le trapèze moyen en rétraction scapulaire, chose que le tirage vertical ne fait presque pas.|Buste à 45 degrés ou moins, dos neutre gréé, barre vers le nombril, contrôle de la descente.|Buste qui se relève à chaque répétition, dos arrondi, tirage en biceps.|Le dos arrondi sous charge en position penchée est un des mécanismes les plus fréquents de lombalgie en salle.|Rowing haltère, rowing T-bar, rowing poulie basse|Lombalgie en cours, hernie discale
Rowing Pendlay|Dorsaux|dors-inf;rhomb|trap-moy;lombaires|barre|poly|tirageH|avance|Chaque répétition repart du sol : pas d'élan possible, force pure et explosivité.|La remise au sol supprime le cycle étirement-raccourcissement : chaque répétition démarre en contraction concentrique pure.|Buste parallèle au sol, barre reposée au sol entre chaque répétition, explosivité vers le bas du sternum.|Relever le buste pour aider, arrondir le dos à la reprise.|Le buste à l'horizontale exige un gainage lombaire irréprochable.|Rowing barre classique, rowing T-bar|Lombalgie
Rowing haltère un bras|Dorsaux|dors-inf|rhomb;trap-moy;bic-long|halteres|poly|tirageH|debutant|Travail unilatéral qui corrige les asymétries et soulage nettement le bas du dos.|L'appui sur le banc décharge la colonne : tout le travail se concentre sur le dos sans coût lombaire.|Appui main et genou sur le banc, tirer le coude vers la hanche, pas de rotation du buste.|Rotation du tronc pour aider, tirage en biceps pur.|La rotation lombaire répétée sous charge est à éviter.|Rowing poulie basse, rowing machine|
Rowing T-bar|Dorsaux|dors-inf;rhomb|trap-moy;bic-long|barre|poly|tirageH|inter|Charge lourde avec une prise neutre confortable, très efficace pour l'épaisseur.|La prise neutre et le point de pivot fixe permettent de charger davantage qu'au rowing barre à qualité technique égale.|Buste à 45 degrés, poitrine sortie, tirer vers le bas du sternum.|Se redresser progressivement au fil des répétitions.|Même risque lombaire que le rowing barre, atténué par l'appui poitrine sur les modèles avec support.|Rowing barre, rowing machine|Lombalgie
Rowing poulie basse|Dorsaux|dors-inf;rhomb|trap-moy;bic-long|poulie|poly|tirageH|debutant|Tension constante et faible contrainte lombaire : le meilleur choix pour accumuler du volume.|La poulie garde la résistance dans l'axe horizontal du début à la fin, y compris en position raccourcie où le rowing haltère ne demande plus rien.|Dos droit, tirer vers le nombril, laisser les omoplates s'écarter en fin d'allongement.|Se pencher en arrière pour tricher, épaules enroulées en fin de course.|Le balancement lombaire d'avant en arrière sous charge.|Rowing machine, rowing haltère|
Rowing machine assise|Dorsaux|dors-inf;rhomb|trap-moy|machine|poly|tirageH|debutant|Appui poitrine : zéro contrainte lombaire, idéal en fin de séance ou en récupération du bas du dos.|L'appui supprime la nécessité de gainer, donc l'intégralité de l'effort part dans le dos.|Poitrine contre le coussin, coudes vers l'arrière, contraction d'une seconde.|Décoller la poitrine du coussin.|Peu de risques.|Rowing poulie basse, rowing haltère|
Rowing inversé|Dorsaux|dors-inf;rhomb|trap-moy;bic-long|pdc|poly|tirageH|debutant|Tirage horizontal sans charge additionnelle : l'inclinaison du corps règle la difficulté au degré près.|Plus le corps est horizontal, plus la part du poids de corps tirée augmente : c'est une progression continue sans matériel.|Corps gréé de la tête aux talons, poitrine vers la barre, omoplates serrées en fin de course.|Bassin qui s'affaisse, amplitude écourtée.|L'affaissement du bassin met le bas du dos en hyperextension.|Rowing haltère, rowing poulie basse|
Tirage bras tendus|Dorsaux|dors-inf|tri-long;grand-droit-haut|poulie|iso|tirageV|debutant|Isolation du grand dorsal sans participation du biceps : utile quand le bras lâche avant le dos.|Le coude reste fixe : seule l'épaule bouge, en extension. Le biceps ne peut pas participer, tout passe par le dorsal.|Bras quasi tendus, buste légèrement penché, ramener la barre vers les cuisses.|Fléchir les coudes et transformer le mouvement en tirage vertical.|Position d'étirement avec charge lourde : contrainte sur l'épaule.|Pull-over poulie, pull-over haltère|
Pull-over à la poulie haute|Dorsaux|dors-sup;dors-inf|tri-long|poulie|iso|tirageV|inter|Étirement complet du grand dorsal sous tension, sensation très marquée.|Le dorsal est chargé en position d'allongement maximal, bras au-dessus de la tête : c'est la position où il produit le plus de tension par fibre.|À genoux ou debout penché, bras tendus, ramener vers les hanches sans plier les coudes.|Utiliser le poids du corps pour descendre la charge.|Charge excessive en amplitude haute.|Tirage bras tendus, pull-over haltère|
Soulevé de terre|Dorsaux|lombaires|isch-biceps-fem;fess-grand;trap-sup;dors-inf|barre|poly|charniere|inter|La charge la plus lourde manipulable et le meilleur constructeur de chaîne postérieure complète.|Les érecteurs du rachis travaillent en isométrie pour maintenir le dos neutre pendant que hanches et genoux étendent : c'est un exercice de transmission de force, pas de flexion de dos.|Barre contre les tibias, dos neutre gréé, pousser le sol plutôt que tirer la barre, verrouillage hanches sans hyperextension.|Bassin qui monte avant la barre, dos qui s'arrondit, barre qui s'éloigne des jambes.|Le dos en flexion sous charge maximale est le mécanisme classique de hernie discale. Le verrouillage en hyperextension écrase les facettes articulaires.|Soulevé de terre roumain, sumo, trap bar|Hernie discale, lombalgie en cours
Soulevé de terre sumo|Dorsaux|lombaires|quad-vaste-med;fess-grand;add|barre|poly|charniere|inter|Position plus verticale du buste : moins de contrainte lombaire pour une charge équivalente.|L'écartement des pieds réduit la distance à parcourir et rapproche la barre du centre de gravité, ce qui diminue le bras de levier sur les lombaires.|Pieds très écartés, pointes ouvertes, prise à l'intérieur des genoux, poitrine haute.|Genoux qui rentrent, bassin qui recule au démarrage.|Fort étirement des adducteurs en position basse.|Soulevé conventionnel, trap bar|
Soulevé de terre trap bar|Dorsaux|lombaires|quad-vaste-lat;fess-grand|barre|poly|charniere|debutant|La version la plus sûre du soulevé : la charge est dans l'axe du corps, pas devant.|Les poignées latérales placent le centre de gravité au niveau des hanches, ce qui réduit fortement le moment de flexion sur la colonne.|Buste plus vertical qu'au conventionnel, poussée des jambes prononcée.|Traiter le mouvement comme un squat et perdre le travail de charnière.|Nettement moins risqué pour le dos que le conventionnel.|Soulevé conventionnel, goblet squat lourd|
Good morning|Dorsaux|lombaires|isch-biceps-fem;fess-grand|barre|poly|charniere|avance|Renforce spécifiquement la capacité des érecteurs à maintenir le dos neutre sous charge penchée.|Le bras de levier est maximal car la barre est sur les épaules, loin des hanches : les érecteurs travaillent en isométrie à leur contrainte la plus élevée.|Charge légère, hanches loin en arrière, dos strictement neutre, descente jusqu'à sentir les ischios.|Charger comme un squat, arrondir le dos en bas.|Le rapport charge sur contrainte lombaire est le plus défavorable de tous les exercices. Charge très prudente.|Soulevé roumain, hyperextension|Toute lombalgie
Hyperextension lombaire|Dorsaux|lombaires|fess-grand;isch-demi-tendineux|machine|iso|lombaire|debutant|Renforce les érecteurs sans charge axiale sur la colonne : le meilleur exercice de prévention lombaire.|Le banc supprime la compression verticale : les érecteurs travaillent en extension pure, sans que la colonne encaisse le poids d'une barre.|Bassin appuyé sur le coussin, montée jusqu'à l'alignement seulement, pas au-delà.|Hyperextension en fin de course, élan.|L'hyperextension répétée comprime les articulations facettaires.|Superman au sol, good morning léger|
Superman au sol|Dorsaux|lombaires|fess-grand;trap-inf|pdc|iso|lombaire|debutant|Renforcement lombaire accessible partout, sans aucun matériel ni charge.|Contraction isométrique des érecteurs contre le seul poids du tronc et des membres : suffisant chez un débutant ou en rééducation encadrée.|Bras et jambes décollés simultanément, regard au sol, tenue de 3 à 5 secondes.|Casser la nuque en regardant devant.|Peu de risques à charge nulle.|Bird dog, hyperextension|
Shrug barre|Dorsaux|trap-sup|fl-avant-bras|barre|iso|tirageH|debutant|Isolation du trapèze supérieur, utile pour le port de charge et la tenue de la barre.|Le trapèze supérieur élève l'omoplate : le mouvement est une simple montée verticale, sans rotation ni recul.|Barre à bout de bras, hausser les épaules vers les oreilles, pause en haut, descente contrôlée.|Rouler les épaules, ce qui n'ajoute rien et met l'épaule en position vulnérable.|La rotation d'épaule chargée est un mécanisme classique de conflit.|Shrug haltères, shrug trap bar|
Shrug haltères|Dorsaux|trap-sup||halteres|iso|tirageH|debutant|Amplitude légèrement supérieure à la barre, et charge dans l'axe du corps.|Les bras le long du corps permettent une élévation plus verticale et plus complète de l'omoplate.|Bras le long du corps, montée verticale pure, pause d'une seconde.|Utiliser l'élan des jambes.|Charges très lourdes : contrainte de préhension avant contrainte musculaire.|Shrug barre, farmer walk|
Face pull|Dorsaux|trap-moy;rhomb|delt-post;coiffe|poulie|iso|epauleIso|debutant|Le meilleur exercice de santé d'épaule : renforce les rotateurs externes que le développé néglige systématiquement.|Il combine rétraction scapulaire et rotation externe, deux fonctions affaiblies chez tous ceux qui poussent beaucoup et tirent peu.|Corde à hauteur de visage, tirer en écartant, rotation externe des poignets en fin de course.|Trop lourd, ce qui transforme le mouvement en rowing haut avec les trapèzes.|Peu de risques : c'est un exercice protecteur.|Band pull-apart, oiseau|
Band pull-apart|Dorsaux|rhomb;trap-moy|delt-post|elastique|iso|epauleIso|debutant|Échauffement d'épaule idéal et rattrapage postural, faisable partout.|La résistance croissante de l'élastique culmine en position raccourcie, exactement là où les rhomboïdes sont les plus faibles.|Bras tendus devant, écarter jusqu'à ce que l'élastique touche la poitrine, contrôle du retour.|Plier les coudes, hausser les épaules.|Aucun risque notable.|Face pull, oiseau|
Tirage menton corde|Dorsaux|trap-moy;trap-sup|delt-lat;bic-long|poulie|poly|tirageV|inter|Alternative sûre au tirage menton barre, qui met l'épaule en rotation interne forcée.|La corde laisse les poignets libres, ce qui permet de monter les coudes sans forcer la rotation interne de l'épaule.|Coudes plus hauts que les poignets, montée jusqu'à hauteur de clavicule maximum.|Monter au-delà de l'horizontale des bras.|Le tirage menton barre au-delà de l'horizontale est un mécanisme reconnu de conflit sous-acromial.|Face pull, élévations latérales|Conflit sous-acromial
Farmer walk|Dorsaux|trap-sup|fl-avant-bras;grand-droit-haut;fess-moyen|halteres|poly|gainage|debutant|Force de préhension, gainage global et endurance sous charge : transfert direct vers le port de charge et la randonnée.|Le tronc travaille en isométrie antilatéroflexion pendant que la marche déstabilise en permanence : c'est du gainage dynamique sous charge réelle.|Charges lourdes à bout de bras, épaules basses et actives, marche contrôlée sur 20 à 40 mètres.|Se pencher d'un côté, laisser les épaules s'affaisser.|Lâcher la charge sur les pieds. Utilise un sol dégagé.|Suitcase carry, farmer walk une main|
Suitcase carry|Dorsaux|lombaires|obliques;fess-moyen;trap-sup|halteres|poly|gainage|debutant|Gainage antilatéroflexion sous charge asymétrique : exactement la contrainte d'un sac porté d'un côté.|Une charge d'un seul côté force les obliques et le carré des lombes du côté opposé à travailler en isométrie pour garder le buste vertical.|Une seule charge, buste strictement vertical, marche lente, changer de côté.|Se pencher du côté de la charge.|La flexion latérale répétée sous charge est à éviter.|Farmer walk, pallof press|
Développé militaire debout|Deltoïdes|delt-ant;delt-lat|tri-long;grand-droit-haut;trap-sup|barre|poly|pousseeV|inter|Poussée verticale debout : force d'épaule et gainage antérieur, très transférable au port de charge au-dessus de la tête.|Le deltoïde antérieur amène le bras de l'avant vers le haut. Debout, le tronc doit résister à l'extension : le gainage travaille autant que l'épaule.|Barre au niveau des clavicules, gainage abdos et fessiers serré, tête qui recule au passage de la barre puis se replace.|Cambrure lombaire excessive pour compenser un manque de mobilité d'épaule.|La cambrure sous charge transforme le mouvement en développé incliné debout et charge violemment les lombaires.|Développé haltères assis, développé Arnold, push press|Instabilité d'épaule, lombalgie
Développé épaules haltères assis|Deltoïdes|delt-ant;delt-lat|tri-long|halteres|poly|pousseeV|debutant|Version stable qui permet plus de volume avec moins d'exigence de gainage.|Les haltères laissent l'épaule choisir sa trajectoire, ce qui réduit le conflit chez ceux qui manquent de rotation externe.|Dossier légèrement incliné vers l'arrière, descente jusqu'à hauteur d'oreilles, coudes légèrement en avant du plan du corps.|Amplitude écourtée, à-coups de jambes, coudes strictement dans le plan frontal.|Coudes plein axe frontal : rotation externe forcée et conflit sous-acromial.|Développé militaire, presse à épaules|
Développé Arnold|Deltoïdes|delt-ant;delt-lat|tri-long|halteres|poly|pousseeV|inter|Ajoute une rotation qui recrute le faisceau antérieur sur une amplitude plus longue.|La rotation externe pendant la montée fait passer le deltoïde antérieur d'une position raccourcie à allongée puis raccourcie : le temps sous tension augmente.|Départ paumes vers soi, rotation progressive pendant la montée, retour contrôlé.|Rotation trop rapide, charges lourdes qui forcent la trajectoire.|La rotation sous charge lourde sollicite la coiffe : charge modérée.|Développé haltères, développé militaire|Tendinopathie de la coiffe
Push press|Deltoïdes|delt-ant;delt-lat|tri-long;quad-vaste-lat|barre|poly|pousseeV|avance|Permet de charger au-dessus du maximum strict grâce à l'impulsion des jambes : développe la puissance.|Une légère flexion-extension des jambes lance la barre, l'épaule prend le relais au-dessus du point de blocage. On surcharge ainsi la portion haute du mouvement.|Flexion courte des genoux, extension explosive, verrouillage bras tendus.|Fléchir trop profondément, ce qui transforme le mouvement en squat.|La réception de la barre au retour est le moment critique : contrôle la descente.|Développé militaire, jerk|
Élévations latérales haltères|Deltoïdes|delt-lat||halteres|iso|epauleIso|debutant|Le faisceau latéral n'est presque pas sollicité par les développés : c'est lui qui donne la largeur d'épaule.|Le deltoïde latéral abduit le bras. Sa tension est maximale quand le bras est proche de l'horizontale, et quasi nulle bras le long du corps : d'où l'intérêt des variantes à la poulie.|Charge légère, coudes légèrement fléchis et fixes, monter jusqu'à l'horizontale, descente en 2 secondes.|Prendre de l'élan, monter au-dessus de l'horizontale en haussant les trapèzes, pouces vers le bas.|Le vidage de canette avec pouces vers le bas met l'épaule en rotation interne pendant l'abduction : mécanisme de conflit reconnu.|Élévations poulie, élévations élastique, élévations machine|Conflit sous-acromial
Élévations latérales à la poulie|Deltoïdes|delt-lat||poulie|iso|epauleIso|debutant|Tension présente dès le départ, y compris bras le long du corps où les haltères ne demandent rien.|La poulie basse croisée derrière le corps crée une résistance horizontale constante sur toute l'amplitude d'abduction.|Poulie basse, bras opposé, montée jusqu'à l'horizontale, contrôle du retour.|Utiliser le buste pour lancer.|Charge excessive et compensation par le trapèze.|Élévations haltères, élévations machine|
Élévations latérales penché appui|Deltoïdes|delt-post|trap-moy;rhomb|halteres|iso|epauleIso|debutant|Isole le faisceau postérieur, presque toujours le plus faible chez ceux qui poussent beaucoup.|Buste penché, l'abduction devient horizontale : la ligne de traction passe sur les fibres postérieures au lieu des latérales.|Buste penché à 45 degrés ou plus, écartement des bras sans hausser les épaules, contraction d'une seconde.|Utiliser les trapèzes, charge trop lourde qui transforme le mouvement en rowing.|Peu de risques.|Reverse pec deck, face pull|
Oiseau haltères|Deltoïdes|delt-post|rhomb;trap-moy|halteres|iso|epauleIso|debutant|Équilibre l'épaule face au volume de poussée et améliore la posture sous sac à dos.|Le deltoïde postérieur produit l'abduction horizontale : c'est l'antagoniste direct du pectoral au développé couché.|Buste penché, coudes légèrement fléchis, écartement large, pas de haussement d'épaules.|Tirer en rowing avec les coudes vers l'arrière.|Peu de risques.|Reverse pec deck, face pull|
Reverse pec deck|Deltoïdes|delt-post|rhomb;trap-moy|machine|iso|epauleIso|debutant|Isolation guidée du deltoïde postérieur, sans exigence de gainage ni de stabilisation.|Le guidage bloque la trajectoire horizontale : impossible de tricher en rowing.|Poitrine contre le coussin, bras à hauteur d'épaules, ouverture jusqu'à l'alignement du buste.|Décoller la poitrine, aller au-delà de l'alignement.|Aller trop loin en arrière étire la capsule antérieure.|Oiseau haltères, face pull|
Élévations frontales|Deltoïdes|delt-ant|pec-clav|halteres|iso|epauleIso|debutant|Isolation du faisceau antérieur : rarement nécessaire si tu fais déjà des développés, utile en rattrapage.|Le deltoïde antérieur fléchit le bras vers l'avant. C'est le faisceau le plus sollicité par tous les mouvements de poussée : son volume additionnel est rarement le facteur limitant.|Montée jusqu'à hauteur d'yeux maximum, alternée ou simultanée, pas d'élan de hanches.|Balancer le buste, monter au-dessus de la tête.|Volume excessif sur un faisceau déjà très sollicité : déséquilibre antéropostérieur.|Élévations poulie, développé incliné|
Élévations frontales à la barre|Deltoïdes|delt-ant|pec-clav|barre|iso|epauleIso|debutant|Version bilatérale plus lourde, à charge modeste.|La barre bloque la trajectoire : le mouvement est purement dans le plan sagittal.|Prise pronation largeur d'épaules, montée jusqu'aux yeux, descente lente.|Utiliser les hanches comme catapulte.|Cambrure lombaire compensatoire.|Élévations haltères, élévations poulie|
Presse à épaules machine|Deltoïdes|delt-ant;delt-lat|tri-long|machine|poly|pousseeV|debutant|Charge lourde en sécurité pour l'épaule, sans exigence de stabilisation.|Le guidage supprime le rôle de la coiffe comme stabilisateur : on peut aller près de l'échec sans dérive technique.|Siège réglé pour que les poignées soient à hauteur d'épaules.|Verrouiller brutalement, siège trop bas.|Un siège trop bas met l'épaule en abduction extrême.|Développé haltères, développé militaire|
Rotation externe à la poulie|Deltoïdes|coiffe|delt-post|poulie|iso|epauleIso|debutant|Renforce la coiffe des rotateurs : prévention pure, à faire même si ça ne fait pas grossir.|L'infra-épineux et le petit rond assurent la rotation externe et le centrage de la tête humérale. Ils sont sous-entraînés chez presque tous les pratiquants.|Coude collé au corps à 90 degrés, rotation lente vers l'extérieur, charge très légère.|Charge lourde qui fait décoller le coude.|Aucun risque à charge légère : c'est un exercice de prévention.|Rotation externe élastique, face pull|
Rotation externe élastique|Deltoïdes|coiffe|delt-post|elastique|iso|epauleIso|debutant|Échauffement d'épaule à faire avant toute séance de poussée lourde.|La faible résistance de l'élastique convient parfaitement à des muscles petits et lents à s'échauffer.|Coude au corps, 15 à 20 répétitions lentes par bras avant la séance.|Aller trop vite, charge trop forte.|Aucun.|Rotation externe poulie, band pull-apart|
Élévations latérales machine|Deltoïdes|delt-lat||machine|iso|epauleIso|debutant|Trajectoire guidée qui empêche la triche par le buste : très efficace en fin de séance.|Le point de pivot fixe garantit que la résistance reste dans le plan d'abduction sur toute l'amplitude.|Coudes contre les coussins, montée jusqu'à l'horizontale.|Se soulever du siège.|Peu de risques.|Élévations poulie, élévations haltères|
Y-raise sur banc incliné|Deltoïdes|delt-post;trap-inf|rhomb|halteres|iso|epauleIso|inter|Renforce le trapèze inférieur, muscle clé de la bascule saine de l'omoplate et souvent le grand oublié.|Le trapèze inférieur fait basculer l'omoplate vers le bas et l'arrière : sans lui, l'épaule s'enroule et le conflit s'installe.|Buste sur banc incliné, bras en Y, montée jusqu'à l'alignement avec le corps, charges très légères.|Charges lourdes qui font basculer le buste.|Aucun à charge légère.|Face pull, band pull-apart|
Pompes en équilibre contre mur|Deltoïdes|delt-ant;delt-lat|tri-long;grand-droit-haut|pdc|poly|pousseeV|avance|Poussée verticale au poids du corps complet : force et contrôle exceptionnels.|Le corps entier devient la charge : le deltoïde travaille contre l'intégralité du poids, avec une exigence de gainage maximale.|Pieds contre le mur, corps gréé, descente contrôlée jusqu'à ce que la tête frôle le sol.|Cambrer le dos, descendre sans contrôle.|Chute sur la tête ou la nuque. À aborder progressivement avec une progression sur pompes piquées.|Pompes piquées, développé militaire|Débutant, problème cervical
Pompes piquées|Deltoïdes|delt-ant;delt-lat|tri-long|pdc|poly|pousseeV|debutant|Poussée verticale sans matériel, marche intermédiaire vers l'équilibre contre le mur.|Bassin haut, la ligne de poussée devient verticale : la charge passe des pectoraux aux deltoïdes.|Bassin haut, tête entre les mains, descente vers le sol devant les mains.|Écarter les coudes à l'équerre, chercher l'amplitude au prix du dos.|Coudes à 90 degrés : conflit d'épaule.|Développé militaire, développé haltères|Douleur d'épaule en amplitude haute
Élévations latérales une main penché sur banc|Deltoïdes|delt-lat||halteres|iso|epauleIso|inter|Permet de charger le deltoïde latéral en position allongée, ce que la version debout ne fait pas.|Le buste incliné place la résistance maximale au début de l'abduction, quand les fibres sont étirées.|Buste incliné à 30 degrés, un bras à la fois, montée jusqu'à l'horizontale.|Se redresser pour aider.|Peu de risques à charge légère.|Élévations poulie, élévations classiques|
Curl haltères|Biceps|bic-long;bic-court|brachial;fl-avant-bras|halteres|iso|bras|debutant|Volume direct sur le biceps : les tirages seuls ne suffisent pas au développement du bras.|Le biceps fléchit le coude et supine l'avant-bras. Les haltères permettent la supination complète, contrairement à la barre droite.|Coudes fixes le long du corps, supination complète en haut, descente contrôlée sur 2 secondes.|Balancement du buste, coudes qui avancent, amplitude partielle.|Le balancement lombaire répété sous charge et l'à-coup en bas de mouvement sur le tendon distal.|Curl barre, curl incliné, curl marteau|
Curl barre EZ|Biceps|bic-long;bic-court|brachial|barre|iso|bras|debutant|Permet de charger plus lourd qu'aux haltères, avec des poignets moins contraints que sur barre droite.|La barre EZ place l'avant-bras en semi-supination : moins de contrainte sur le poignet et le coude pour un recrutement quasi identique.|Coudes fixes, montée jusqu'à contraction, descente en 2 secondes.|Reculer les coudes en fin de montée, ce qui relâche la tension.|La barre droite chargée lourd est une cause fréquente de tendinopathie du poignet.|Curl haltères, curl poulie|Épicondylite
Curl incliné|Biceps|bic-long||halteres|iso|bras|inter|Charge la longue portion du biceps en étirement maximal, ce qu'aucun curl debout ne fait.|Bras derrière le plan du corps, la longue portion qui s'insère au-dessus de l'épaule est pré-étirée : la tension par fibre y est maximale.|Banc à 45 à 60 degrés, bras pendants, montée sans avancer les coudes.|Avancer les coudes pour aider en fin de course.|Position d'étirement sous charge : risque sur le tendon proximal si la charge est excessive.|Curl haltères, curl à la poulie basse derrière|Tendinopathie du long biceps
Curl marteau|Biceps|brachial;brachio-radial|bic-long|halteres|iso|bras|debutant|Cible le brachial, qui pousse le biceps vers le haut et épaissit visuellement le bras.|Le brachial se situe sous le biceps et ne supine pas : la prise neutre le met en position de force optimale.|Prise neutre, coudes fixes, montée complète, descente contrôlée.|Élan des épaules, balancement.|Prise neutre : la variante la plus tolérante pour les coudes sensibles.|Curl corde, curl haltères|
Curl marteau à la corde|Biceps|brachial;brachio-radial|bic-long|poulie|iso|bras|debutant|Tension constante sur toute l'amplitude, y compris en contraction maximale.|La poulie garde la résistance en fin de course, là où les haltères perdent presque toute la tension.|Coudes fixes, corde tirée vers les épaules, contraction d'une seconde.|Reculer les coudes, se pencher en arrière.|Peu de risques.|Curl marteau haltères, curl poulie|
Curl pupitre|Biceps|bic-court||barre|iso|bras|debutant|Élimine toute triche : les coudes sont bloqués, seul le biceps peut travailler.|Le pupitre place le bras en avant du corps, ce qui raccourcit la longue portion et concentre la charge sur la courte portion.|Bras entièrement en contact avec le pupitre, descente complète mais contrôlée.|Descendre en relâchant brutalement en bas.|L'extension complète brutale sous charge lourde est un mécanisme de rupture du tendon distal.|Curl haltère pupitre, curl concentré|
Curl concentré|Biceps|bic-court||halteres|iso|bras|debutant|Isolation maximale, sensation très marquée : idéal en finition de séance bras.|Le coude calé contre la cuisse supprime toute participation de l'épaule : le biceps travaille seul, en amplitude complète.|Coude contre l'intérieur de la cuisse, montée lente, supination accentuée en haut.|Utiliser l'épaule pour lancer.|Peu de risques à charge modérée.|Curl pupitre, curl poulie basse|
Curl à la poulie basse|Biceps|bic-long;bic-court|brachial|poulie|iso|bras|debutant|Tension constante et angle réglable selon la hauteur de poulie.|La ligne de traction reste constante quel que soit l'angle du coude, contrairement à la gravité qui varie avec la position du bras.|Coudes fixes, buste immobile, contraction en fin de course.|Reculer d'un pas pour changer l'angle en cours de série.|Peu de risques.|Curl barre, curl haltères|
Curl araignée|Biceps|bic-court||halteres|iso|bras|inter|Bras perpendiculaires au sol : la tension est maximale en contraction, là où le curl classique en manque.|La position penchée en avant place le bras devant le corps : la courte portion est raccourcie et pleinement chargée en fin de course.|Buste sur banc incliné face au dossier, bras pendants verticaux, montée complète.|Balancer les bras.|Peu de risques.|Curl pupitre, curl concentré|
Curl inversé|Biceps|brachio-radial;ext-avant-bras|brachial|barre|iso|avantbras|debutant|Renforce les extenseurs de l'avant-bras et le brachio-radial : prévention directe de l'épicondylite.|La pronation met le brachio-radial en position de force et sollicite fortement les extenseurs du poignet, souvent faibles chez ceux qui tirent beaucoup.|Prise pronation, coudes fixes, charge modeste, montée complète.|Charger comme un curl classique : le mouvement devient impossible proprement.|Charge excessive sur des tendons peu habitués : c'est un exercice de renforcement progressif.|Curl marteau, extension de poignet|Épicondylite en crise
Curl élastique|Biceps|bic-long;bic-court|brachial|elastique|iso|bras|debutant|Utilisable partout, avec une résistance qui croît là où le muscle est le plus fort.|La tension de l'élastique augmente avec l'allongement : le maximum de résistance arrive en contraction, ce qui compense la courbe de force naturelle.|Pied sur l'élastique, coudes fixes, contraction complète.|Laisser l'élastique tirer le bras vers le bas sans contrôle.|Élastique qui se détache : vérifie l'ancrage.|Curl haltères, curl poulie|
Traction supination lestée|Biceps|bic-long;bic-court|dors-sup;brachial|pdc|poly|tirageV|avance|Le mouvement de biceps le plus lourd disponible : charge composée avec le poids du corps.|Le biceps travaille en synergie avec le dorsal sous une charge très supérieure à celle d'un curl : c'est un stimulus de force et non d'isolation.|Ceinture lestée, prise supination largeur d'épaules, amplitude complète.|Amplitude partielle sous charge lourde.|Fort stress sur le tendon distal du biceps en position basse. Descente contrôlée obligatoire.|Traction supination, curl barre lourd|Tendinopathie du biceps
Curl Zottman|Biceps|bic-court;brachio-radial|ext-avant-bras;brachial|halteres|iso|bras|inter|Combine curl classique et curl inversé dans un seul mouvement : bras complet et avant-bras.|Montée en supination pour charger le biceps, descente en pronation pour charger les extenseurs en excentrique, régime où ils sont les plus forts.|Montée paumes vers le haut, rotation en haut, descente lente paumes vers le bas.|Rotation trop rapide, charge trop lourde pour la phase descendante.|La descente en pronation est exigeante pour le coude : charge modeste.|Curl inversé, curl marteau|Épicondylite
Extension triceps à la poulie corde|Triceps|tri-lat;tri-med|tri-long|poulie|iso|bras|debutant|Tension constante sur le triceps, complément direct des poussées lourdes.|Le triceps étend le coude. La corde permet d'écarter les mains en fin de course, ce qui ajoute une contraction complète du faisceau latéral.|Coudes serrés et strictement fixes, extension complète, écartement de la corde en bas.|Coudes qui s'écartent, buste qui accompagne le mouvement.|Peu de risques.|Barre au front, dips|
Barre au front|Triceps|tri-long|tri-lat;tri-med|barre|iso|bras|inter|Étire la longue portion, la plus volumineuse des trois et la moins sollicitée par les développés.|La longue portion s'insère sur l'omoplate : elle ne s'étire que si le bras est au-dessus de la tête ou en arrière. Coudes vers le plafond, elle est chargée en allongement.|Coudes fixes pointant vers le plafond, descente vers le front ou légèrement derrière la tête.|Écarter les coudes, descendre trop vite, bouger les épaules.|Contrainte importante sur le coude : c'est l'exercice le plus associé aux tendinopathies du triceps. Charge progressive.|Extension poulie, extension haltère au-dessus de la tête|Douleur de coude
Extension au-dessus de la tête à la corde|Triceps|tri-long|tri-lat|poulie|iso|bras|debutant|La position la plus efficace pour cibler la longue portion, avec moins de contrainte que la barre au front.|Bras au-dessus de la tête, la longue portion est pré-étirée à son maximum : la tension par fibre y est la plus élevée.|Dos à la poulie, coudes hauts et fixes, extension complète.|Laisser les coudes descendre, cambrer le dos.|Cambrure lombaire compensatoire si les abdos ne tiennent pas.|Extension haltère assis, barre au front|
Extension haltère au-dessus de la tête|Triceps|tri-long|tri-lat|halteres|iso|bras|debutant|Étirement maximal de la longue portion avec un simple haltère : faisable partout.|Même logique que la version poulie, mais la résistance chute en fin de course quand le bras devient vertical.|Un haltère à deux mains ou un par bras, coudes serrés, descente lente derrière la nuque.|Écarter les coudes, cambrer.|Descente incontrôlée derrière la nuque : contrainte cervicale et sur l'épaule.|Extension corde, barre au front|Douleur d'épaule en amplitude haute
Kickback triceps|Triceps|tri-lat;tri-med||halteres|iso|bras|debutant|Contraction maximale en fin de course, sensation forte pour peu de charge.|La position bras en arrière place le triceps en raccourcissement complet : la tension culmine là où beaucoup d'exercices l'ont déjà perdue.|Buste penché, bras collé au corps, extension complète, pause d'une seconde.|Balancer l'haltère, laisser le coude descendre.|Peu de risques à charge légère.|Extension poulie, extension corde|
Dips triceps|Triceps|tri-lat;tri-long|pec-abdo;delt-ant|pdc|poly|bras|inter|Le mouvement de triceps le plus lourd au poids du corps.|Buste vertical, l'adduction du bras est minimale et l'extension du coude devient le moteur principal : la part du triceps monte fortement.|Buste strictement vertical, coudes serrés vers l'arrière, descente jusqu'à l'horizontale des bras.|Pencher le buste, ce qui bascule le travail sur les pectoraux.|Descente excessive : contrainte sur l'épaule antérieure et le sternum.|Dips machine assistée, développé prise serrée|Douleur d'épaule
Dips sur banc|Triceps|tri-lat;tri-med|delt-ant|pdc|poly|bras|debutant|Accessible partout, charge réglable par la position des pieds.|Le poids porté dépend de la distance des pieds : plus ils sont loin, plus la charge sur les triceps augmente.|Mains sur le banc derrière soi, coudes vers l'arrière, descente à 90 degrés maximum.|Descendre trop bas, coudes qui s'écartent.|Cette position met l'épaule en extension et rotation interne : descendre trop bas est un mécanisme classique de conflit antérieur.|Dips barres parallèles, extension poulie|Douleur d'épaule antérieure
Extension triceps à la poulie barre|Triceps|tri-lat;tri-med|tri-long|poulie|iso|bras|debutant|Permet de charger plus lourd que la corde, avec une trajectoire fixe.|La barre bloque la position des mains en pronation, ce qui accentue le faisceau latéral.|Coudes serrés le long du corps, extension complète, retour contrôlé à 90 degrés.|Utiliser le poids du corps en se penchant sur la barre.|Poignets forcés en flexion si la barre est trop basse.|Extension corde, extension barre EZ|
Pompes diamant|Triceps|tri-lat;tri-med|pec-stern|pdc|poly|bras|debutant|La poussée qui charge le plus les triceps sans matériel.|Mains rapprochées, l'amplitude d'extension du coude augmente et l'adduction diminue : le triceps devient moteur principal.|Mains jointes sous la poitrine, coudes serrés le long du corps, poitrine vers les mains.|Coudes qui s'écartent, ce qui reporte le travail sur les pectoraux.|Contrainte en extension sur le poignet : passe sur poings fermés si ça tire.|Extension poulie, dips|Douleur de poignet
Développé prise serrée haltères|Triceps|tri-lat;tri-long|pec-stern|halteres|poly|bras|debutant|Poussée avec haltères serrés : charge lourde sur le triceps sans contrainte de poignet.|Les haltères en prise neutre serrée maximisent l'extension du coude tout en épargnant le poignet.|Haltères collés, coudes le long du corps, descente au niveau du bas des pectoraux.|Laisser les haltères s'écarter.|Peu de risques.|Développé couché prise serrée, dips|
Extension triceps couché barre EZ|Triceps|tri-long;tri-lat||barre|iso|bras|inter|Version au sol ou sur banc, charge lourde possible avec des poignets ménagés.|La barre EZ réduit la contrainte en pronation du poignet tout en gardant la ligne de traction sur la longue portion.|Coudes fixes vers le plafond, descente lente, pas de blocage brutal en haut.|Verrouiller violemment en fin d'extension.|Le blocage brutal répété est agressif pour le coude.|Barre au front, extension poulie|Douleur de coude
Extension triceps un bras à la poulie|Triceps|tri-lat;tri-med||poulie|iso|bras|debutant|Corrige les asymétries et permet une supination qui accentue le faisceau médial.|Le travail unilatéral empêche le côté fort de compenser, ce qui est fréquent sur les versions à deux mains.|Poignée simple, coude fixe, extension complète avec légère supination.|Utiliser le buste, laisser le coude s'éloigner.|Peu de risques.|Kickback, extension corde|
Extension triceps machine|Triceps|tri-lat;tri-med;tri-long||machine|iso|bras|debutant|Trajectoire guidée : idéal pour aller à l'échec en fin de séance sans dérive technique.|Le guidage supprime la stabilisation et permet une contraction contrôlée jusqu'à l'échec.|Coudes calés, extension complète, retour lent.|Décoller les coudes des supports.|Peu de risques.|Extension poulie, dips machine|
Extension de poignet|Avant-bras|ext-avant-bras||halteres|iso|avantbras|debutant|Renforce les extenseurs du poignet : la prévention la plus directe de l'épicondylite.|Les extenseurs sont chroniquement faibles chez ceux qui tirent et serrent beaucoup sans jamais les entraîner en extension.|Avant-bras posé, paume vers le bas, extension complète du poignet, charge très légère.|Charge trop lourde, amplitude écourtée.|Aucun à charge légère : c'est un exercice de prévention.|Curl inversé, extension élastique|
Flexion de poignet|Avant-bras|fl-avant-bras||halteres|iso|avantbras|debutant|Renforce les fléchisseurs : améliore directement la préhension au soulevé et aux tractions.|Les fléchisseurs assurent le maintien de la barre : leur endurance est souvent le premier facteur limitant au soulevé de terre.|Avant-bras posé, paume vers le haut, laisser la barre rouler vers les doigts puis remonter.|Charger comme un curl.|Contrainte tendineuse si la charge est excessive.|Farmer walk, suspension à la barre|
Suspension à la barre|Avant-bras|fl-avant-bras|dors-sup;trap-sup|pdc|iso|avantbras|debutant|Développe la préhension et décomprime la colonne : deux bénéfices en un mouvement gratuit.|La suspension passive étire le dorsal et la capsule d'épaule pendant que la préhension travaille en isométrie maximale.|Suspension bras tendus, épaules actives sans être totalement relâchées, 20 à 60 secondes.|Se pendre totalement relâché avec des épaules instables.|La suspension totalement passive n'est pas conseillée en cas d'instabilité d'épaule.|Farmer walk, suspension une main|Instabilité d'épaule
Squat barre dos|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand;isch-biceps-fem;lombaires|barre|poly|squat|inter|Le patron moteur le plus rentable du bas du corps : charge lourde, masse musculaire recrutée maximale, transfert direct vers la montée et le port de charge.|Les vastes étendent le genou contre une charge axiale. Plus la descente est profonde, plus le fessier et l'adducteur participent : la profondeur change la répartition, pas seulement la difficulté.|Barre sur les trapèzes, pieds largeur d'épaules pointes légèrement ouvertes, descente hanches en arrière et genoux qui suivent, buste gréé, remontée en poussant le sol.|Genoux qui rentrent, dos qui s'arrondit en bas, remontée fessiers d'abord qui bascule le buste vers l'avant.|Le valgus de genou sous charge lourde met le ligament croisé antérieur et le ménisque interne en contrainte. L'arrondi lombaire en bas de squat est un mécanisme direct de lésion discale.|Squat gobelet, squat avant, hack squat, presse à cuisses|Lombalgie aiguë, mobilité de cheville très limitée non travaillée
Squat avant|Quadriceps|quad-droit;quad-vaste-med|fess-grand;grand-droit-haut|barre|poly|squat|avance|Angle plus quadriceps et exigence de gainage antérieur très élevée : excellent complément au squat dos.|La barre devant impose un buste vertical : le moment sur le genou augmente et celui sur les lombaires diminue. Le droit fémoral, qui passe aussi par la hanche, y est plus sollicité.|Barre sur les deltoïdes antérieurs, coudes hauts, buste le plus vertical possible, descente complète.|Coudes qui tombent, ce qui fait rouler la barre vers l'avant.|La chute des coudes projette la barre : lâche-la vers l'avant plutôt que de tenter de la rattraper.|Squat gobelet, hack squat, zercher squat|Problème de poignet ou d'épaule
Squat gobelet|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand;grand-droit-haut|halteres|poly|squat|debutant|Version d'apprentissage : la charge devant force naturellement un buste droit et enseigne le placement sans risque.|Le contrepoids frontal permet de descendre plus bas avec un buste vertical, ce qui rend la profondeur accessible même avec une mobilité de cheville moyenne.|Haltère ou kettlebell contre la poitrine, coudes à l'intérieur des genoux en bas, descente lente.|Charge trop lourde qui déplace le centre de gravité, talons qui décollent.|Peu de risques : c'est la variante la plus sûre.|Squat au poids du corps, squat avant|
Squat au poids du corps|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand|pdc|poly|squat|debutant|Point d'entrée du patron squat : apprend le placement et permet du volume partout.|Sans charge externe, la contrainte articulaire est minime : c'est le régime idéal pour construire la mobilité et le contrôle avant d'ajouter du poids.|Descente contrôlée jusqu'à cuisses parallèles ou plus bas, talons ancrés, buste gréé.|Genoux qui rentrent, talons qui décollent.|Aucun risque notable.|Squat gobelet, squat sauté|
Squat bulgare|Quadriceps|quad-vaste-lat;quad-droit|fess-grand;isch-biceps-fem|halteres|poly|fente|inter|Charge très élevée sur une jambe avec peu de poids absolu : rendement exceptionnel et forte demande d'équilibre.|Le travail unilatéral supprime la compensation du côté fort et sollicite fortement les stabilisateurs de hanche. Buste penché en avant, le fessier prend le relais du quadriceps.|Pied arrière sur un banc, descente verticale, poids sur la jambe avant, genou avant aligné avec le pied.|Pied avant trop près du banc, genou en valgus, torsion du genou arrière.|Le genou arrière subit une torsion si le pied est mal placé. La perte d'équilibre sous charge est le risque principal.|Fente marchée, split squat, step-up|Douleur fémoro-patellaire non évaluée
Fente marchée|Quadriceps|quad-vaste-lat;quad-droit|fess-grand;isch-biceps-fem|halteres|poly|fente|debutant|Unilatéral et proche de la marche chargée : le transfert vers la randonnée est direct.|Chaque pas combine une phase excentrique de freinage et une phase concentrique de poussée, exactement comme en terrain montant.|Grand pas, genou arrière qui frôle le sol, buste droit, poussée sur le talon avant.|Pas trop court qui écrase le genou avant, buste qui bascule.|Un pas court augmente la contrainte fémoro-patellaire. Le genou arrière qui frappe le sol est douloureux et évitable.|Fente statique, fente bulgare, step-up|Douleur rotulienne
Fente au poids du corps|Quadriceps|quad-vaste-lat|fess-grand|pdc|poly|fente|debutant|Unilatéral sans matériel : suffisant pour construire l'équilibre et l'endurance de force.|Le poids de corps sur une jambe représente déjà une charge relative importante pour un débutant.|Grand pas, genou arrière proche du sol, buste droit.|Pas trop court, buste qui bascule vers l'avant.|Peu de risques.|Fente marchée, fente arrière|
Fente arrière|Quadriceps|quad-vaste-lat|fess-grand;isch-biceps-fem|halteres|poly|fente|debutant|Plus douce pour le genou que la fente avant : le pas se fait vers l'arrière, sans impact de freinage.|Le pied avant reste fixe : il n'y a pas de phase de réception, ce qui réduit la contrainte fémoro-patellaire.|Pas en arrière, descente verticale, retour en poussant sur la jambe avant.|Se déséquilibrer vers l'arrière.|Nettement plus tolérée en cas de douleur rotulienne que la fente avant.|Fente marchée, split squat|
Fente latérale|Quadriceps|quad-vaste-med;add|fess-moyen|halteres|poly|fente|inter|Travaille le plan frontal, presque absent de l'entraînement classique : utile pour le terrain irrégulier.|Le déplacement latéral sollicite les adducteurs en excentrique et le vaste médial en fin de course.|Grand pas de côté, hanche de la jambe fléchie qui recule, pied opposé tendu.|Genou qui dépasse largement le pied, buste qui s'affaisse.|Étirement important des adducteurs : progression prudente.|Fente avant, cossack squat|
Presse à cuisses|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand;isch-biceps-fem|machine|poly|squat|debutant|Permet d'accumuler du volume sur les quadriceps avec très peu de contrainte sur le dos.|La colonne est appuyée : aucune charge axiale. Tout l'effort passe dans l'extension de genou et de hanche.|Pieds à mi-plateau, ne pas verrouiller les genoux en haut, amplitude complète sans décoller le bassin.|Bassin qui décolle en bas, ce qui met le bas du dos en flexion sous charge.|Le décollement du bassin en fin de descente est le mécanisme de blessure lombaire propre à cette machine. Le verrouillage brutal des genoux est agressif.|Hack squat, squat|
Hack squat machine|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand|machine|poly|squat|debutant|Charge lourde sur les quadriceps avec un dos totalement soutenu.|La trajectoire guidée et l'inclinaison placent la résistance presque entièrement sur l'extension de genou.|Dos plaqué, pieds à mi-plateau, descente profonde et contrôlée.|Décoller le dos, verrouiller violemment.|Le décollement lombaire en bas.|Presse à cuisses, squat avant|
Leg extension|Quadriceps|quad-vaste-lat;quad-vaste-med;quad-droit||machine|iso|squat|debutant|Isolation du quadriceps, utile en pré-fatigue, en finition ou en rééducation encadrée.|C'est le seul exercice qui charge le quadriceps en position raccourcie complète, genou tendu, ce qu'aucun squat ne fait.|Contrôle de la descente, pas de verrouillage brutal, contraction d'une seconde en haut.|Charge trop lourde avec élan, amplitude partielle.|La contrainte fémoro-patellaire est maximale en début d'extension avec charge lourde : à moduler en cas de douleur rotulienne.|Squat gobelet, presse|Syndrome rotulien en crise
Sissy squat|Quadriceps|quad-droit;quad-vaste-med||pdc|iso|squat|avance|Étire le quadriceps sous tension à la hanche et au genou simultanément : sensation unique.|Le bassin part en avant : le droit fémoral, qui traverse la hanche, est étiré en même temps qu'il freine la flexion du genou.|Genoux qui avancent, corps en ligne des genoux aux épaules, descente très lente.|Aller trop bas trop vite, charger d'emblée.|Contrainte fémoro-patellaire élevée : à introduire très progressivement.|Leg extension, squat avant|Douleur rotulienne
Cossack squat|Quadriceps|quad-vaste-med;add|fess-moyen|pdc|poly|fente|inter|Travaille la force en amplitude extrême et la mobilité de hanche en même temps.|La jambe fléchie travaille en amplitude complète pendant que la jambe tendue est étirée en abduction : force et mobilité dans le même mouvement.|Pieds très écartés, descente sur un côté, talon au sol, autre jambe tendue.|Talon qui décolle, dos rond.|Étirement extrême des adducteurs : progression lente.|Fente latérale, squat gobelet profond|
Step-up sur banc haut|Quadriceps|quad-vaste-lat;quad-droit|fess-grand;gastro|halteres|poly|unipodal|debutant|L'exercice le plus spécifique à la montée en terrain raide : il reproduit exactement la poussée unilatérale sous charge.|La montée est purement concentrique sur une jambe, sans élan ni rebond : c'est le geste de la marche en côte, chargé.|Banc à hauteur de genou ou plus, monter sans pousser avec la jambe arrière, descente contrôlée sur 2 à 3 secondes.|Prendre l'élan avec la jambe au sol, se laisser tomber à la descente.|La descente non contrôlée charge violemment le genou. Banc instable : chute.|Montée de marches chargée, fente|
Descente de marche contrôlée|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-moyen|pdc|iso|excentrique|debutant|Prépare spécifiquement la contraction excentrique de descente, cause principale des courbatures sévères et des douleurs de genou en rando.|En descente, le quadriceps travaille en excentrique : il s'allonge tout en freinant. Ce régime crée le plus de dommages musculaires mais aussi la meilleure adaptation protectrice.|Descendre en 3 à 5 secondes, contrôler par la jambe d'appui, poser le talon sans bruit.|Aller trop vite, introduire trop de volume d'un coup.|L'excentrique génère beaucoup de dommages musculaires : commence à 2 séries de 6 par jambe, jamais plus de 10 pour cent d'augmentation par semaine.|Squat excentrique, fente en descente lente|Douleur rotulienne aiguë
Squat excentrique|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand|pdc|poly|excentrique|debutant|Renforce la tolérance aux dommages musculaires de la descente en rando.|La phase excentrique lente augmente le temps sous tension et provoque les micro-lésions qui déclenchent l'adaptation protectrice contre les courbatures.|Descente en 4 à 5 secondes, remontée normale, charge modérée.|Charger trop lourd d'emblée sur de l'excentrique.|Courbatures sévères pendant 3 à 5 jours après la première séance : c'est normal mais il faut l'anticiper.|Descente de marche, fente lente|
Nordic curl excentrique|Ischios|isch-biceps-fem;isch-demi-tendineux|fess-grand|pdc|iso|excentrique|avance|L'exercice le mieux documenté pour réduire le risque de lésion des ischios.|Les ischios freinent en excentrique la descente du corps : ce régime allonge le muscle sous tension et augmente la longueur de fascicule, facteur protecteur reconnu.|Chevilles bloquées, corps gréé, descente la plus lente possible, remontée en poussant avec les mains.|Casser au niveau des hanches, descendre en chute libre.|Courbatures très sévères après la première séance. Démarre à 2 séries de 3 répétitions.|Leg curl, soulevé roumain|Lésion d'ischios récente
Soulevé de terre roumain|Ischios|isch-biceps-fem;isch-demi-tendineux|fess-grand;lombaires|barre|poly|charniere|inter|Cible l'étirement sous tension des ischios : très efficace en hypertrophie et protecteur pour la descente en rando.|Les ischios traversent la hanche : quand elle se fléchit jambes quasi tendues, ils s'allongent sous charge. C'est la position où ils produisent le plus de tension.|Jambes quasi tendues, hanches loin en arrière, barre qui rase les cuisses, descente jusqu'à l'étirement sans arrondir le dos.|Transformer le mouvement en squat, descendre plus bas que ce que la souplesse permet au prix du dos.|Dès que le dos s'arrondit, la charge passe des ischios aux disques intervertébraux. Arrête la descente là où le dos commence à céder.|RDL haltères, good morning, hip thrust|Lombalgie aiguë
Soulevé de terre roumain une jambe|Ischios|isch-biceps-fem|fess-grand;fess-moyen;lombaires|halteres|poly|charniere|inter|Combine charnière de hanche, équilibre et stabilité latérale : très proche des exigences du terrain irrégulier.|L'appui unipodal force le moyen fessier à stabiliser le bassin pendant que l'ischio travaille en allongement : deux qualités entraînées ensemble.|Une jambe au sol, l'autre tendue en arrière, bassin qui reste horizontal, descente lente.|Ouvrir la hanche vers l'extérieur, ce qui supprime le travail de stabilisation.|Perte d'équilibre sous charge.|RDL classique, good morning|
Leg curl allongé|Ischios|isch-biceps-fem;isch-demi-tendineux|gastro|machine|iso|charniere|debutant|Complète le soulevé roumain en travaillant la flexion de genou, l'autre fonction des ischios.|Les ischios ont deux fonctions : extension de hanche et flexion de genou. Le RDL ne travaille que la première : le leg curl comble le manque.|Amplitude complète, contrôle de la phase de retour sur 2 à 3 secondes.|Décoller le bassin du coussin, à-coups.|Le décollement du bassin met les lombaires en hyperextension.|Leg curl assis, nordic curl|
Leg curl assis|Ischios|isch-biceps-fem;isch-demi-tendineux||machine|iso|charniere|debutant|Position hanche fléchie : les ischios sont pré-étirés, ce qui augmente le stimulus hypertrophique.|Hanche fléchie, l'ischio est déjà allongé à son origine : la flexion de genou le charge dans une amplitude plus favorable qu'en position allongée.|Cuisses bien calées, amplitude complète, retour contrôlé.|Amplitude écourtée.|Peu de risques.|Leg curl allongé, nordic curl|
Good morning léger|Ischios|isch-biceps-fem|lombaires;fess-grand|barre|poly|charniere|avance|Charge les ischios en étirement avec une contrainte lombaire maximale : réservé aux pratiquants confirmés.|Le bras de levier depuis les épaules jusqu'aux hanches est le plus long de tous les exercices : la contrainte par kilo est très élevée.|Charge légère, hanches loin en arrière, dos strictement neutre.|Charger comme un squat.|Rapport charge sur contrainte le plus défavorable en salle. Ne dépasse pas 40 pour cent de ton squat.|Soulevé roumain, hyperextension|Toute lombalgie
Hip thrust|Fessiers|fess-grand|isch-biceps-fem|barre|poly|charniere|debutant|Tension maximale sur les fessiers en position raccourcie, là où le squat les sollicite le moins.|Le grand fessier étend la hanche. À l'horizontale, le bras de levier de la charge est maximal exactement au moment où la hanche est en extension complète : personne d'autre ne fait ça.|Dos des omoplates sur le banc, menton rentré, verrouillage fessiers en haut sans cambrer le bas du dos.|Hyperextension lombaire en haut, amplitude partielle, poussée sur les pointes de pieds.|L'hyperextension lombaire en fin de course est le défaut le plus fréquent : la sensation vient du bas du dos et non des fessiers, c'est le signal.|Pont fessier au sol, kickback poulie|
Pont fessier au sol|Fessiers|fess-grand|isch-biceps-fem;lombaires|pdc|poly|charniere|debutant|Charnière de hanche accessible sans matériel : le substitut le plus proche du hip thrust.|Amplitude plus courte que le hip thrust car le sol limite la descente, mais la contraction finale est identique.|Pieds à plat près des fessiers, verrouillage fessiers en haut sans cambrer, pause d'une seconde.|Pousser avec les lombaires plutôt qu'avec les fessiers.|Hyperextension lombaire.|Hip thrust, pont fessier une jambe|
Pont fessier une jambe|Fessiers|fess-grand|fess-moyen;isch-biceps-fem|pdc|poly|charniere|debutant|Unilatéral sans matériel : révèle et corrige les asymétries de force entre les deux côtés.|La charge est doublée sur un côté et le bassin doit rester horizontal, ce qui recrute aussi le moyen fessier.|Une jambe fléchie au sol, l'autre tendue, bassin horizontal en haut.|Laisser le bassin basculer du côté libre.|Peu de risques.|Pont fessier, hip thrust une jambe|
Kickback fessier à la poulie|Fessiers|fess-grand||poulie|iso|charniere|debutant|Isolation pure du grand fessier avec tension constante.|Le mouvement est une extension de hanche pure sans participation du quadriceps : le fessier travaille seul.|Buste stable, extension de hanche sans cambrer, contraction en fin de course.|Cambrer le dos pour gagner de l'amplitude.|La cambrure compensatoire est le défaut universel de cet exercice.|Hip thrust, pont fessier|
Abduction hanche à la poulie|Fessiers|fess-moyen;fess-petit||poulie|iso|charniere|debutant|Renforce le moyen fessier, stabilisateur clé du bassin en appui unipodal.|Le moyen fessier empêche le bassin de tomber du côté opposé pendant la marche : sa faiblesse est une cause fréquente de douleur de genou et de hanche.|Corps droit, jambe tendue qui s'écarte, pas de bascule du buste.|Se pencher du côté opposé pour gagner de l'amplitude.|Peu de risques.|Abduction élastique, clamshell|
Abduction hanche machine|Fessiers|fess-moyen;fess-petit||machine|iso|charniere|debutant|Volume facile sur le moyen fessier, souvent négligé et pourtant essentiel en rando.|Le guidage permet de charger précisément un muscle petit et difficile à isoler autrement.|Buste légèrement penché en avant pour cibler davantage le moyen fessier, amplitude complète.|Utiliser l'élan.|Peu de risques.|Abduction poulie, marche latérale élastique|
Marche latérale élastique|Fessiers|fess-moyen;fess-petit||elastique|iso|charniere|debutant|Échauffement de hanche idéal avant toute séance de jambes, et renforcement de la stabilité latérale.|Le maintien d'une abduction constante pendant le déplacement met le moyen fessier en isométrie prolongée, exactement son rôle à la marche.|Élastique au-dessus des genoux ou aux chevilles, demi-squat, pas latéraux lents.|Laisser les genoux rentrer, se déplacer trop vite.|Aucun.|Clamshell, abduction poulie|
Clamshell|Fessiers|fess-moyen;fess-petit||elastique|iso|charniere|debutant|Activation ciblée du moyen fessier, utile en rééducation et en échauffement.|La rotation externe de hanche isole le moyen fessier de manière très sélective, sans participation du quadriceps.|Allongé sur le côté, genoux fléchis, ouverture du genou supérieur sans basculer le bassin.|Rouler le bassin en arrière.|Aucun.|Marche latérale, abduction poulie|
Adduction machine|Adducteurs|add||machine|iso|adducteur|debutant|Renforce les adducteurs, souvent faibles et fréquemment lésés dans les sports de changement de direction.|Les adducteurs stabilisent aussi le bassin dans le plan frontal : leur faiblesse relative par rapport aux abducteurs est un facteur de pubalgie.|Amplitude complète mais contrôlée, pas de rebond en fin d'ouverture.|Ouvrir trop grand en position d'étirement avec une charge lourde.|La mise en tension brutale en amplitude extrême est le mécanisme de lésion des adducteurs.|Cossack squat, sumo squat|Pubalgie
Copenhagen plank|Adducteurs|add|obliques|pdc|iso|adducteur|avance|Renforcement excentrique et isométrique des adducteurs : très efficace en prévention de pubalgie.|L'adducteur travaille en isométrie contre le poids du corps en position d'allongement, régime le plus protecteur.|Appui coude au sol, jambe supérieure sur un banc, bassin décollé, tenue 10 à 20 secondes.|Laisser le bassin s'affaisser.|Très exigeant : commence avec le genou en appui et non le pied.|Adduction machine, planche latérale|Pubalgie en cours
Sumo squat|Adducteurs|add;quad-vaste-med|fess-grand|halteres|poly|squat|debutant|Position large : les adducteurs prennent une part importante du travail.|L'écartement des pieds et la rotation externe placent les adducteurs en position de moteurs d'extension de hanche, pas seulement de stabilisateurs.|Pieds très écartés, pointes ouvertes à 45 degrés, descente entre les jambes, buste vertical.|Genoux qui rentrent, talons qui décollent.|Étirement important des adducteurs en position basse.|Squat gobelet, cossack squat|
Mollets debout machine|Mollets|gastro|soleaire|machine|iso|mollet|debutant|Les mollets encaissent chaque pas en rando : leur endurance conditionne la fin de sortie.|Le gastrocnémien traverse le genou : jambes tendues, il est en position de force. C'est la variante qui le cible le mieux.|Jambes tendues, amplitude complète avec étirement en bas, pause d'une seconde en haut.|Rebond élastique sans contraction volontaire, amplitude partielle.|Le rebond en fin de descente charge le tendon d'Achille sans travail musculaire.|Mollets assis, montées sur pointes|Tendinopathie d'Achille en crise
Mollets assis|Mollets|soleaire|gastro|machine|iso|mollet|debutant|Cible le soléaire, muscle d'endurance qui porte la marche longue.|Genou fléchi, le gastrocnémien est raccourci et mis hors jeu : le soléaire fait presque tout le travail. C'est le muscle de l'effort long.|Genoux à 90 degrés, amplitude complète, tempo lent.|Amplitude écourtée, charge trop lourde.|Peu de risques.|Mollets debout, montées sur pointes genou fléchi|
Montées sur pointes|Mollets|gastro|soleaire|pdc|iso|mollet|debutant|Endurance des mollets sans matériel : faisable tous les jours, partout.|Le poids du corps suffit à charger le mollet en endurance, régime qui correspond exactement à l'usage en randonnée.|Amplitude complète, pause en haut, descente lente sous le niveau de la marche si possible.|Rebond élastique.|Peu de risques.|Mollets machine, montées une jambe|
Montées sur pointes une jambe|Mollets|gastro|soleaire;tib-ant|pdc|iso|mollet|debutant|Double la charge sans matériel et révèle les asymétries.|Une jambe supporte tout le poids du corps : la charge relative se rapproche de celle d'un exercice avec machine.|Une main en appui pour l'équilibre, amplitude complète, 15 à 25 répétitions.|Utiliser le bras pour soulager.|Contrainte importante sur le tendon d'Achille : progression graduelle.|Mollets machine, montées deux jambes|Tendinopathie d'Achille
Élévations tibial antérieur|Mollets|tib-ant||pdc|iso|mollet|debutant|Renforce le tibial antérieur : prévention des périostites et meilleur contrôle du pied en descente.|Le tibial antérieur freine la pose du pied à chaque pas en descente. Sa faiblesse est une cause classique de périostite tibiale.|Dos au mur, talons au sol, montée des pointes de pied, 20 répétitions lentes.|Aller trop vite.|Aucun.|Marche sur les talons, dorsiflexion élastique|
Relevés de bassin au sol|Abdominaux|grand-droit-bas|obliques;psoas|pdc|iso|gainage|debutant|Cible les fibres basses du grand droit, portion la moins sollicitée par les crunchs classiques.|Le grand droit est un seul muscle, mais l'activation régionale existe : la flexion par le bas recrute davantage les fibres inférieures.|Mains sous les fessiers, jambes tendues ou fléchies, enrouler le bassin vers le haut sans élan.|Balancer les jambes, décoller le bas du dos.|La traction du psoas peut créer une hyperlordose si les abdos ne tiennent pas.|Relevés de jambes suspendu, crunch inversé|Lombalgie
Relevés de jambes suspendu|Abdominaux|grand-droit-bas|psoas;fl-avant-bras|pdc|iso|gainage|inter|Le mouvement d'abdominaux le plus exigeant au poids du corps, avec un bonus de préhension.|La suspension supprime tout appui : le grand droit doit enrouler le bassin contre le poids complet des jambes.|Suspension bras tendus, enroulement du bassin vers le haut, pas de balancement.|Se balancer, ne bouger que les hanches sans enrouler le bassin.|Le balancement sous suspension sollicite l'épaule en traction.|Relevés de bassin, crunch inversé|Instabilité d'épaule
Crunch|Abdominaux|grand-droit-haut||pdc|iso|gainage|debutant|Flexion du tronc pure : simple, efficace, et le meilleur point d'entrée pour sentir travailler les abdos.|Le grand droit rapproche le sternum du pubis : le crunch reproduit exactement cette fonction sur une amplitude courte.|Bas du dos plaqué, mains sur les tempes sans tirer, montée courte et lente.|Tirer sur la nuque, faire un relevé de buste complet.|La traction manuelle sur la nuque est une cause fréquente de cervicalgie.|Crunch poulie, crunch machine|Cervicalgie
Crunch à la poulie haute|Abdominaux|grand-droit-haut;obliques||poulie|iso|gainage|debutant|Permet de charger progressivement les abdominaux, chose impossible au poids du corps.|La résistance additionnelle permet de travailler dans la fourchette 8 à 15 répétitions, comme n'importe quel autre muscle.|À genoux, corde derrière la nuque, enroulement du tronc sans bouger les hanches.|Tirer avec les bras, se plier depuis les hanches.|Charge excessive et compensation lombaire.|Crunch machine, crunch au sol|
Planche frontale|Abdominaux|transverse;grand-droit-haut|delt-ant;fess-grand|pdc|iso|gainage|debutant|Apprend au tronc à résister à l'extension : c'est exactement sa fonction sous sac ou sous barre.|Le gainage antirotation et antiextension est le vrai rôle du tronc en situation réelle : il empêche le dos de céder, il ne produit pas de mouvement.|Corps aligné, abdos et fessiers serrés, respiration continue, coudes sous les épaules.|Bassin trop haut ou affaissé, apnée.|L'affaissement du bassin met les lombaires en hyperextension prolongée.|Planche sur genoux, planche lestée, dead bug|
Planche latérale|Abdominaux|obliques|fess-moyen|pdc|iso|gainage|debutant|Résistance à l'inclinaison latérale, essentielle quand le sac déporte le centre de gravité.|Les obliques et le carré des lombes travaillent en isométrie pour maintenir l'alignement contre la gravité latérale.|Coude sous l'épaule, hanches hautes, corps aligné, respiration continue.|Hanches qui tombent, rotation du buste.|Contrainte sur l'épaule d'appui si elle est instable.|Planche latérale genoux, side plank raise|Instabilité d'épaule
Dead bug|Abdominaux|transverse|grand-droit-bas|pdc|iso|gainage|debutant|Dissocie les membres du tronc sans charger la colonne : la base du contrôle lombaire.|Le transverse maintient le bas du dos plaqué pendant que les membres s'éloignent : c'est le contrôle lombaire pur, sans compression.|Bas du dos plaqué au sol en permanence, mouvement lent, expiration à l'extension.|Décollement lombaire quand la jambe s'allonge.|Aucun risque : c'est un exercice correctif.|Bird dog, hollow hold|
Bird dog|Abdominaux|transverse|lombaires;fess-grand|pdc|iso|gainage|debutant|Coordination controlatérale : exactement le schéma de la marche chargée.|Bras et jambe opposés reproduisent le couplage croisé de la marche, avec le tronc qui résiste à la rotation.|Bras et jambe opposés, bassin stable, pas de rotation, tenue de 3 secondes.|Cambrure lombaire pour aller plus haut.|Aucun.|Dead bug, planche|
Pallof press|Abdominaux|obliques;transverse||poulie|iso|gainage|debutant|Résistance à la rotation : la qualité de gainage la plus utile et la moins entraînée.|La poulie tire latéralement : les obliques travaillent en isométrie pour empêcher le tronc de tourner, sans jamais produire de mouvement.|De profil, bras tendus loin du corps, ne pas laisser le buste tourner, respiration continue.|Charge trop lourde qui fait pivoter le buste.|Peu de risques.|Pallof élastique, planche latérale|
Hollow hold|Abdominaux|grand-droit-haut;grand-droit-bas;transverse||pdc|iso|gainage|inter|Position de référence de la gymnastique : gainage antiextension au maximum.|Le grand droit maintient une flexion lombaire légère contre le poids des bras et des jambes tendus : c'est la contraction isométrique la plus intense au poids du corps.|Bas du dos plaqué, bras et jambes tendus proches du sol, respiration continue.|Décoller le bas du dos, retenir sa respiration.|Le décollement lombaire annule le bénéfice et charge les érecteurs.|Dead bug, hollow rock|
Roue abdominale|Abdominaux|grand-droit-haut;transverse|dors-sup;delt-ant|pdc|iso|gainage|avance|Le gainage antiextension le plus difficile qui existe en salle.|En extension complète, le bras de levier sur le tronc est maximal : les abdos doivent empêcher l'hyperextension lombaire contre presque tout le poids du corps.|Départ à genoux, extension progressive, bassin rétroversé en permanence.|Aller trop loin trop tôt, laisser le bas du dos cambrer.|C'est l'exercice d'abdominaux qui blesse le plus le bas du dos quand on brûle les étapes. Commence à genoux, amplitude réduite.|Planche, roue avec butée mur|Lombalgie
Russian twist|Abdominaux|obliques||halteres|iso|gainage|debutant|Travaille la rotation du tronc, absente de la plupart des programmes.|Les obliques produisent la rotation : contrairement au gainage antirotation, ici le mouvement est le but.|Buste incliné à 45 degrés, rotation lente en gardant le bas du dos stable, charge légère.|Balancer la charge d'un côté à l'autre sans contrôle.|La rotation lombaire rapide sous charge est déconseillée : privilégie le contrôle.|Pallof press, wood chop|Lombalgie, hernie discale
Wood chop à la poulie|Abdominaux|obliques;transverse|delt-ant;fess-grand|poulie|iso|gainage|inter|Rotation contrôlée en diagonale sous charge : très transférable aux gestes sportifs.|Le mouvement combine rotation thoracique et transfert de poids, avec les obliques comme moteurs et le tronc comme transmetteur.|Rotation qui vient du tronc et non des bras, pivot du pied arrière, bassin qui suit.|Tirer avec les bras, tourner depuis le bas du dos.|La rotation doit venir du thorax : si elle vient du lombaire, c'est contraignant.|Pallof press, russian twist|Lombalgie
Crunch inversé|Abdominaux|grand-droit-bas|obliques|pdc|iso|gainage|debutant|Cible les fibres basses sans matériel et sans contrainte cervicale.|L'enroulement part du bassin : le grand droit se raccourcit par le bas, sans que le cou n'intervienne.|Genoux fléchis, enroulement du bassin vers la poitrine, descente lente.|Utiliser l'élan des jambes.|Peu de risques.|Relevés de bassin, relevés de jambes suspendu|
Gainage avec charge suspendue|Abdominaux|transverse;obliques|fess-grand|elastique|iso|gainage|inter|Ajoute une perturbation imprévisible : le tronc doit corriger en permanence.|La charge oscillante crée des micro-perturbations que le tronc corrige en réflexe, ce qui entraîne la réactivité et non seulement la force.|Position de planche, élastique tendu latéralement, résister aux tractions.|Bouger le bassin à chaque perturbation.|Peu de risques.|Pallof press, planche|
Marche zone 2|Cardio|cardio||aucun|cardio|cardio|debutant|Développe la densité mitochondriale et l'usage des lipides comme carburant : c'est ce qui permet de marcher six heures sans s'effondrer.|À basse intensité, la filière aérobie prédomine et l'organisme apprend à épargner le glycogène en oxydant davantage de lipides.|Intensité à laquelle une conversation reste possible, environ 60 à 70 pour cent de la fréquence cardiaque maximale, 45 à 90 minutes.|Monter en intensité et perdre le bénéfice spécifique de la zone 2.|Aucun risque, hormis le volume trop rapide qui provoque des périostites.|Vélo zone 2, rameur zone 2|
Intervalles en côte|Cardio|cardio|quad-vaste-lat;fess-grand|aucun|cardio|cardio|inter|Élève le VO2 max et rend les montées raides beaucoup plus confortables.|Les efforts proches du maximum sollicitent le débit cardiaque maximal, principal déterminant du VO2 max chez un sujet entraîné.|4 à 6 répétitions de 3 minutes en côte, récupération complète entre les répétitions.|Récupération écourtée qui transforme la séance en travail au seuil dégradé.|Charge cardiovasculaire élevée : à éviter en cas de pathologie cardiaque non évaluée.|Intervalles vélo, côtes courtes|Pathologie cardiaque non évaluée
Sortie longue avec sac|Cardio|cardio|quad-vaste-lat;gastro;trap-sup|aucun|cardio|cardio|debutant|Seul moyen de tester réellement le matériel et d'habituer les épaules et les pieds à la charge.|La spécificité prime : aucun exercice de salle ne reproduit six heures de charge continue sur les mêmes appuis.|Augmenter la durée, puis le dénivelé, puis la charge, jamais les trois en même temps, dix pour cent par semaine maximum.|Tester des chaussures neuves juste avant l'échéance.|Les ampoules et les tendinopathies d'Achille viennent presque toujours d'une progression trop rapide.|Marche chargée sur tapis incliné|
Vélo zone 2|Cardio|cardio|quad-vaste-lat|machine|cardio|cardio|debutant|Volume aérobie sans impact : idéal quand les articulations sont chargées par la muscu.|Même adaptation centrale et périphérique que la marche, sans contrainte de réception au sol.|Cadence 80 à 90 tours par minute, résistance permettant de parler, 45 à 75 minutes.|Monter la résistance jusqu'à sortir de la zone.|Aucun.|Marche zone 2, rameur|
Rameur|Cardio|cardio|dors-inf;quad-vaste-lat;lombaires|machine|cardio|cardio|inter|Cardio complet qui sollicite aussi le dos : bon compromis quand le temps manque.|La chaîne postérieure travaille en endurance pendant que le système aérobie est sollicité : deux qualités dans le même geste.|Séquence jambes puis buste puis bras, retour dans l'ordre inverse, dos neutre en permanence.|Tirer avec les bras en premier, arrondir le dos à l'attaque.|Le dos arrondi répété à haute cadence est une cause classique de lombalgie chez les rameurs débutants.|Vélo, marche zone 2|Lombalgie
Corde à sauter|Cardio|cardio|gastro;soleaire|aucun|cardio|cardio|debutant|Cardio dense en peu de temps et renforcement réactif du pied et de la cheville.|Le cycle étirement-raccourcissement du mollet est sollicité à haute fréquence : la raideur tendineuse s'améliore, ce qui rend la marche plus économe.|Sauts bas, réception sur l'avant du pied, genoux légèrement fléchis.|Sauter trop haut, réception talons au sol.|Impact répété : monter progressivement pour éviter la périostite.|Corde sur place, montées de genoux|Périostite en cours
Mobilité hanches 90-90|Mobilité|mobilite||aucun|iso|mobilite|debutant|Une hanche libre permet un squat profond sans compenser par le bas du dos.|Le travail actif en fin d'amplitude renforce la nouvelle amplitude au lieu de simplement l'étirer passivement, ce qui la rend utilisable sous charge.|Assis jambes à 90 degrés, rotation d'un côté à l'autre en contrôle actif, 8 à 10 répétitions par côté.|Forcer en passif sans renforcer la nouvelle amplitude.|Aucun.|Fente basse, CARs de hanche|
Mobilité chevilles genou au mur|Mobilité|mobilite|tib-ant|aucun|iso|mobilite|debutant|La dorsiflexion conditionne la profondeur de squat et la stabilité en descente de sentier.|Un manque de dorsiflexion force le talon à décoller ou le dos à s'arrondir : c'est souvent la vraie cause d'un squat qui bascule.|Genou vers le mur en gardant le talon au sol, 10 répétitions lentes par côté, chercher un centimètre de plus à chaque séance.|Décoller le talon pour gagner de l'amplitude apparente.|Aucun.|Étirement mollet, squat lesté profond|
Mobilité thoracique|Mobilité|mobilite||aucun|iso|mobilite|debutant|Une colonne thoracique raide reporte la contrainte sur les lombaires et l'épaule.|Le thorax doit fournir l'essentiel de la rotation et de l'extension du tronc : quand il ne le fait pas, le lombaire compense au-delà de sa capacité.|Rotations en quadrupédie, extension sur rouleau, respiration ample en fin d'amplitude.|Chercher la rotation dans le bas du dos.|Aucun.|Cat-cow, ouverture de livre|
Équilibre unipodal|Mobilité|mobilite|fess-moyen;tib-ant|aucun|iso|gainage|debutant|Renforce les corrections posturales de cheville : premier rempart contre l'entorse en terrain irrégulier.|Les récepteurs proprioceptifs de la cheville déclenchent des corrections réflexes : elles s'entraînent par l'exposition au déséquilibre contrôlé.|30 à 60 secondes par jambe, progresser en fermant les yeux puis sur surface instable.|Se rattraper en permanence sans chercher le contrôle.|Chute : place-toi près d'un appui.|Équilibre sur coussin, marche talon-pointe|
Étirement fléchisseurs de hanche|Mobilité|mobilite|psoas|aucun|iso|mobilite|debutant|La position assise prolongée raccourcit le psoas, ce qui bascule le bassin et cambre le bas du dos.|Un psoas court tire le bassin en antéversion : le bas du dos se creuse en permanence, ce qui comprime les articulations postérieures.|Fente basse genou au sol, bassin rétroversé, fessier du côté arrière contracté, 30 secondes.|Cambrer le bas du dos pour avoir l'impression d'un plus grand étirement.|Aucun.|90-90, étirement couché|
Curl 21|Biceps|bic-long;bic-court|brachial|barre|iso|bras|inter|Trois amplitudes dans une seule série : congestion maximale pour un temps sous tension très long.|Sept répétitions basses, sept hautes, sept complètes : chaque portion d'amplitude reçoit un volume dédié, ce qu'une série classique dilue.|7 répétitions de bas à mi-course, 7 de mi-course en haut, 7 complètes, sans repos.|Charger comme une série normale : impossible de finir proprement.|Fatigue extrême du coude en fin de série : charge réduite de moitié.|Curl barre, curl poulie|Épicondylite
Curl poulie haute bicep pose|Biceps|bic-court;bic-long||poulie|iso|bras|debutant|Contraction en position raccourcie extrême, sensation très marquée.|Bras à l'horizontale, le biceps est chargé en fin de course, là où le curl classique perd presque toute résistance.|Deux poulies hautes, bras à l'horizontale, flexion vers les tempes, contraction d'une seconde.|Bouger les coudes vers le bas.|Peu de risques.|Curl araignée, curl poulie basse|
Curl allongé à la poulie basse|Biceps|bic-long||poulie|iso|bras|inter|Bras derrière le plan du corps avec tension constante : le meilleur des deux mondes.|La longue portion est pré-étirée par la position et reste chargée sur toute l'amplitude grâce à la poulie.|Allongé au sol, poulie basse derrière la tête, coudes fixes.|Avancer les coudes.|Position d'étirement chargée : charge modérée.|Curl incliné, curl haltères|Tendinopathie du long biceps
Curl prise marteau à la barre|Biceps|brachial;brachio-radial|bic-long|barre|iso|bras|debutant|Version bilatérale du curl marteau, permet de charger plus lourd.|La prise neutre bilatérale place le brachial en position optimale avec une charge supérieure aux haltères.|Barre à prise neutre ou poignées parallèles, coudes fixes.|Balancer le buste.|Peu de risques.|Curl marteau, curl corde|
Curl à la barre au pupitre haltère|Biceps|bic-court||halteres|iso|bras|debutant|Unilatéral au pupitre : révèle les asymétries et empêche toute compensation.|Le bras est bloqué et travaille seul : impossible pour le côté fort de compenser.|Bras entièrement en contact, descente contrôlée, jamais de relâchement brutal.|Relâcher brutalement en bas.|Extension brutale sous charge : risque tendineux distal.|Curl pupitre barre, curl concentré|
Curl élastique marteau|Biceps|brachial;brachio-radial||elastique|iso|bras|debutant|Prise neutre avec résistance croissante, transportable partout.|La résistance de l'élastique culmine en fin de course, ce qui compense la faiblesse relative du brachial en position raccourcie.|Pied sur l'élastique, prise neutre, coudes fixes.|Laisser l'élastique ramener le bras sans contrôle.|Vérifier l'ancrage.|Curl marteau, curl corde|
Chin-up négatif|Biceps|bic-long;bic-court|dors-sup;brachial|pdc|poly|tirageV|debutant|Construit la force en excentrique pour accéder à la première traction supination complète.|La force excentrique dépasse la force concentrique d'environ 30 pour cent : on peut donc descendre lentement bien avant de pouvoir monter.|Départ menton au-dessus de la barre, descente en 5 secondes, remonter avec un appui.|Se laisser tomber.|Le tendon distal du biceps est sollicité en excentrique : progression graduelle.|Traction assistée, curl lourd|Tendinopathie du biceps
Curl prise large barre|Biceps|bic-court||barre|iso|bras|inter|Prise large : accentue la courte portion, celle qui donne la largeur du bras vue de face.|Une prise large place l'épaule en légère rotation externe et raccourcit la longue portion, ce qui transfère la charge sur la courte.|Prise plus large que les épaules, coudes fixes, amplitude complète.|Poignets forcés si la prise est trop large sur barre droite.|Contrainte de poignet sur barre droite : préfère l'EZ.|Curl EZ, curl pupitre|Douleur de poignet
Dips machine assistée|Triceps|tri-lat;tri-long|pec-abdo|machine|poly|bras|debutant|Permet de faire des dips propres avant d'avoir la force au poids du corps complet.|L'assistance réduit la charge de manière réglable, ce qui rend accessible un mouvement autrement réservé aux pratiquants confirmés.|Buste vertical pour les triceps, descente jusqu'à l'horizontale des bras.|Descendre trop bas.|Descente excessive : contrainte d'épaule antérieure.|Dips barres, développé prise serrée|Douleur d'épaule
Extension triceps corde une main au-dessus de la tête|Triceps|tri-long||poulie|iso|bras|inter|Isolation unilatérale de la longue portion en étirement complet.|La position bras au-dessus de la tête étire la longue portion à son maximum, et l'unilatéral empêche toute compensation.|Coude haut et fixe, extension complète, contrôle du retour.|Laisser le coude descendre.|Cambrure compensatoire.|Extension corde deux mains, barre au front|
Barre au front derrière la tête|Triceps|tri-long|tri-lat|barre|iso|bras|avance|Amplitude maximale sur la longue portion : le stimulus le plus fort mais le plus exigeant.|Descendre derrière la tête plutôt que sur le front augmente l'étirement de la longue portion et donc la tension par fibre.|Coudes légèrement inclinés vers l'arrière, descente lente derrière la tête, charge modeste.|Charger comme une barre au front classique.|C'est la variante la plus agressive pour le coude. Volume et charge réduits.|Barre au front, extension corde|Douleur de coude
Extension triceps élastique|Triceps|tri-lat;tri-med||elastique|iso|bras|debutant|Isolation du triceps transportable, résistance croissante en fin de course.|La tension maximale de l'élastique arrive en extension complète, où le triceps est le plus fort.|Élastique ancré en hauteur, coudes fixes, extension complète.|Laisser l'élastique ramener le bras.|Vérifier l'ancrage.|Extension poulie, kickback|
Kickback triceps à la poulie|Triceps|tri-lat;tri-med||poulie|iso|bras|debutant|Contraction terminale avec tension constante, contrairement à la version haltère.|La poulie maintient la résistance en fin de course, où l'haltère ne demande plus rien.|Buste penché, coude fixe, extension complète, pause d'une seconde.|Laisser le coude descendre.|Peu de risques.|Kickback haltère, extension corde|
Pompes triceps surélevées|Triceps|tri-lat;tri-med|pec-stern|pdc|poly|bras|debutant|Version allégée des pompes diamant pour construire du volume triceps sans matériel.|La surélévation réduit la part du poids de corps portée, ce qui rend possible plus de répétitions propres.|Mains rapprochées sur un support, coudes serrés le long du corps.|Écarter les coudes.|Contrainte de poignet.|Pompes diamant, dips banc|
Extension triceps à la poulie prise inversée|Triceps|tri-med;tri-lat||poulie|iso|bras|inter|Prise supination : accentue le faisceau médial, rarement ciblé.|La supination modifie l'angle de traction et recrute davantage le chef médial, souvent le plus faible.|Prise paumes vers le haut, coudes serrés, charge modeste.|Charger comme en pronation : le poignet lâche avant le triceps.|Contrainte de poignet.|Extension corde, extension barre|Douleur de poignet
Développé couché prise serrée haltères au sol|Triceps|tri-lat;tri-long|pec-stern|halteres|poly|bras|debutant|Amplitude limitée par le sol : charge lourde sur le triceps sans contrainte d'épaule.|Le coude touche le sol avant l'extension complète de l'épaule : la portion la plus contraignante est supprimée.|Coudes qui touchent le sol, pause, poussée.|Rebondir.|Rebond sur le coude.|Développé prise serrée, dips|
Leg curl une jambe|Ischios|isch-biceps-fem;isch-demi-tendineux||machine|iso|charniere|debutant|Révèle et corrige les asymétries entre les deux ischios, fréquentes après une lésion.|Une asymétrie de force supérieure à 10 pour cent entre les deux côtés est un facteur de risque documenté de récidive.|Une jambe à la fois, amplitude complète, retour très contrôlé.|Compenser en décollant le bassin.|Peu de risques.|Leg curl bilatéral, nordic curl|
Glute ham raise|Ischios|isch-biceps-fem;isch-demi-tendineux|fess-grand;lombaires|machine|poly|excentrique|avance|Travaille les deux fonctions de l'ischio simultanément : extension de hanche et flexion de genou.|C'est le seul exercice qui charge l'ischio sur ses deux articulations en même temps, ce qui reproduit sa fonction réelle à la course.|Chevilles bloquées, descente contrôlée, remontée en fléchissant les genoux.|Casser aux hanches pour tricher.|Très exigeant : commence par la phase excentrique seule.|Nordic curl, leg curl|Lésion d'ischios récente
Soulevé de terre roumain haltères|Ischios|isch-biceps-fem;isch-demi-tendineux|fess-grand|halteres|poly|charniere|debutant|Amplitude légèrement supérieure à la barre et charge plus accessible pour apprendre la charnière.|Les haltères passent de part et d'autre des jambes, ce qui permet de descendre un peu plus bas sans que la barre bloque.|Hanches loin en arrière, haltères qui rasent les jambes, dos neutre.|Plier les genoux comme un squat.|Le dos qui s'arrondit en fin de descente.|RDL barre, good morning|Lombalgie
Kettlebell swing|Ischios|isch-biceps-fem;fess-grand|lombaires;transverse|kettlebell|poly|charniere|inter|Charnière de hanche explosive : développe la puissance et l'endurance de la chaîne postérieure.|L'extension de hanche balistique recrute les fibres rapides des ischios et du fessier, un régime que les mouvements lents ne touchent pas.|Charnière et non squat, projection par les hanches, bras relâchés, kettlebell qui monte à hauteur de poitrine.|Squatter au lieu de charnière, soulever avec les bras, hyperextension en haut.|L'hyperextension lombaire en fin de swing est le défaut le plus fréquent et le plus contraignant.|RDL, good morning|Lombalgie
Hip thrust une jambe|Ischios|isch-biceps-fem|fess-grand;fess-moyen|pdc|poly|charniere|inter|Double la charge sur un côté et sollicite fortement les stabilisateurs de bassin.|Le bassin doit rester horizontal malgré l'appui unique : le moyen fessier entre en jeu en plus de l'extension de hanche.|Dos sur le banc, une jambe fléchie au sol, bassin horizontal en haut.|Laisser le bassin basculer.|Peu de risques.|Hip thrust, pont fessier une jambe|
Extension lombaire à 45 degrés ischios|Ischios|isch-biceps-fem|fess-grand;lombaires|machine|iso|charniere|debutant|Version dos arrondi volontairement figé : le mouvement vient uniquement de la hanche, donc des ischios.|En gardant le dos en flexion fixe, l'extension provient exclusivement de la hanche : les érecteurs travaillent en isométrie et les ischios en concentrique.|Dos volontairement arrondi et figé, extension par la hanche seule, sans charge au départ.|Étendre le dos au lieu de la hanche.|À charge nulle uniquement tant que la technique n'est pas maîtrisée.|Hyperextension classique, RDL|Lombalgie
Fente arrière avec buste penché|Ischios|isch-biceps-fem|fess-grand;quad-vaste-lat|halteres|poly|fente|inter|Le buste penché bascule le travail du quadriceps vers la chaîne postérieure.|Plus le buste s'incline, plus le bras de levier sur la hanche augmente : le fessier et l'ischio deviennent moteurs principaux.|Buste incliné à 30 degrés, pas en arrière, poussée par le talon avant.|Se redresser en cours de série.|Contrainte lombaire si le dos s'arrondit.|Fente arrière, RDL une jambe|
Leg curl élastique|Ischios|isch-biceps-fem;isch-demi-tendineux||elastique|iso|charniere|debutant|Flexion de genou sans machine : utile à domicile ou en déplacement.|La résistance croissante de l'élastique culmine en flexion complète, où l'ischio est le plus fort.|Élastique ancré bas, allongé sur le ventre, flexion complète.|Décoller le bassin.|Vérifier l'ancrage.|Leg curl machine, nordic curl|
Bonne matinée assis|Ischios|isch-biceps-fem|lombaires|barre|poly|charniere|avance|Isole la charnière sans participation des jambes : très ciblé, très exigeant pour le dos.|Assis, le genou est bloqué en flexion : tout le mouvement vient de la flexion du tronc, avec les érecteurs en isométrie maximale.|Charge très légère, dos strictement neutre, amplitude réduite.|Charger comme un good morning debout.|Contrainte lombaire parmi les plus élevées en salle.|Good morning debout, RDL|Toute lombalgie
Marche en fente lestée longue|Ischios|isch-biceps-fem|fess-grand;quad-vaste-lat|halteres|poly|fente|inter|Pas très long : la chaîne postérieure prend le dessus sur le quadriceps.|Un pas plus long augmente l'angle de flexion de hanche et donc la part du fessier et de l'ischio.|Pas nettement plus long qu'une fente classique, poussée par le talon.|Réduire progressivement la longueur du pas en fatiguant.|Perte d'équilibre sous charge.|Fente marchée, fente arrière|
Soulevé de terre jambes tendues|Ischios|isch-biceps-fem;isch-demi-tendineux|lombaires|barre|poly|charniere|avance|Amplitude maximale sur les ischios, à réserver à ceux qui ont déjà la souplesse.|Genoux quasi verrouillés, l'ischio ne peut pas se raccourcir au genou : tout l'allongement se fait à la hanche, avec une tension par fibre très élevée.|Genoux quasi tendus, descente seulement jusqu'à la limite de la souplesse, dos neutre.|Descendre jusqu'au sol en arrondissant le dos.|C'est la variante où le dos s'arrondit le plus facilement.|RDL, good morning|Lombalgie, souplesse limitée
Hip thrust machine|Fessiers|fess-grand|isch-biceps-fem|machine|poly|charniere|debutant|Même logique que le hip thrust barre, sans l'inconfort de la barre sur les hanches.|Le rembourrage et le guidage permettent de charger davantage sans que la barre ne devienne le facteur limitant.|Dos calé, verrouillage complet en haut, pause d'une seconde.|Hyperextension lombaire.|Hyperextension.|Hip thrust barre, pont fessier|
Kickback fessier élastique|Fessiers|fess-grand|isch-biceps-fem|elastique|iso|charniere|debutant|Activation des fessiers sans matériel lourd, idéale en échauffement.|La résistance croissante correspond bien à la courbe de force du fessier, qui est le plus fort en extension complète.|Élastique aux chevilles, extension de hanche sans cambrer.|Cambrer le dos.|Aucun.|Kickback poulie, pont fessier|
Fente bulgare buste penché|Fessiers|fess-grand|isch-biceps-fem;quad-vaste-lat|halteres|poly|fente|inter|Le buste penché transfère le travail du quadriceps vers le fessier.|L'inclinaison du buste augmente la flexion de hanche : le fessier devient moteur principal de l'extension.|Buste incliné à 30 degrés, descente verticale, poussée par le talon avant.|Se redresser au fil des répétitions.|Perte d'équilibre.|Fente bulgare classique, hip thrust|
Step-up latéral|Fessiers|fess-moyen;fess-grand|quad-vaste-lat|halteres|poly|unipodal|debutant|Travaille le moyen fessier en charge dans le plan frontal.|La montée latérale sollicite l'abduction en charge, ce qui renforce le stabilisateur principal du bassin à la marche.|Montée de côté sur un banc, sans élan, descente contrôlée.|Pousser avec la jambe au sol.|Banc instable.|Step-up frontal, marche latérale élastique|
Frog pump|Fessiers|fess-grand||pdc|iso|charniere|debutant|Position en rotation externe : le fessier travaille dans une amplitude où il est très efficace.|La rotation externe des hanches place le grand fessier en position raccourcie optimale et met le quadriceps hors jeu.|Plantes de pieds jointes, genoux ouverts, montée du bassin sans cambrer.|Cambrer le bas du dos.|Aucun.|Pont fessier, hip thrust|
Fire hydrant|Fessiers|fess-moyen;fess-petit||pdc|iso|charniere|debutant|Abduction en quadrupédie : activation ciblée du moyen fessier sans matériel.|La position à quatre pattes isole l'abduction de hanche sans que le tronc ne puisse compenser par une inclinaison.|À quatre pattes, ouverture du genou latéralement, bassin stable.|Rouler le bassin pour gagner de l'amplitude.|Aucun.|Clamshell, abduction poulie|
Extension de hanche à la poulie debout|Fessiers|fess-grand|isch-biceps-fem|poulie|iso|charniere|debutant|Extension de hanche debout avec tension constante : simple et efficace.|La position debout reproduit la fonction du fessier à la marche et à la montée, avec une résistance réglable.|Buste stable, extension par la hanche seule, pas de cambrure.|Cambrer le dos pour gagner de l'amplitude.|Cambrure compensatoire.|Kickback, hip thrust|
Squat profond gobelet fessiers|Fessiers|fess-grand|quad-vaste-med;add|halteres|poly|squat|debutant|La profondeur maximale est ce qui recrute le plus le fessier au squat.|Plus la hanche descend bas, plus le fessier est allongé et plus sa participation à la remontée augmente.|Descente sous la parallèle, talons ancrés, remontée en poussant le sol.|Écourter l'amplitude en chargeant.|Nécessite de la mobilité de cheville et de hanche.|Squat gobelet, cossack squat|
Mollets à la presse|Mollets|gastro|soleaire|machine|iso|mollet|debutant|Charge lourde sur le mollet avec un dos totalement soutenu.|La presse permet de charger le mollet bien au-delà du poids de corps sans compression de la colonne.|Pointes de pieds sur le bord du plateau, amplitude complète, pas de verrouillage de genou.|Verrouiller les genoux, amplitude partielle.|Le verrouillage du genou avec une charge lourde en fin d'extension est risqué.|Mollets debout, mollets assis|
Mollets en déficit|Mollets|gastro|soleaire|halteres|iso|mollet|debutant|L'étirement sous la marche augmente l'amplitude et le stimulus.|La position en dessous de l'horizontale allonge le gastrocnémien au-delà de sa longueur de repos, où la tension par fibre est plus élevée.|Avant-pieds sur une marche, talons qui descendent sous le niveau, pause en bas.|Rebondir en bas.|Le rebond en étirement charge le tendon d'Achille brutalement.|Mollets machine, montées sur pointes|Tendinopathie d'Achille
Donkey calf raise|Mollets|gastro|soleaire|machine|iso|mollet|inter|Position penchée : le gastrocnémien est pré-étiré par la flexion de hanche.|Le buste penché avec le genou tendu maximise l'allongement du gastrocnémien à ses deux extrémités.|Buste penché à 90 degrés, amplitude complète, tempo lent.|Utiliser l'élan du buste.|Peu de risques.|Mollets debout, mollets presse|
Sauts sur place|Mollets|gastro;soleaire|quad-vaste-lat|pdc|iso|mollet|debutant|Travaille la raideur tendineuse, ce qui rend la marche et la course plus économes.|Le tendon d'Achille stocke et restitue de l'énergie élastique : cette qualité s'entraîne par des contacts au sol brefs et répétés.|Contacts au sol courts, réception sur l'avant du pied, genoux souples.|Réception talons au sol, contacts longs.|Impact répété : progression graduelle pour éviter la périostite.|Corde à sauter, montées sur pointes|Tendinopathie d'Achille, périostite
Mollets une jambe avec charge|Mollets|gastro|soleaire|halteres|iso|mollet|debutant|Charge unilatérale complète : le meilleur rapport efficacité sur matériel.|Une jambe supporte le poids du corps plus l'haltère, ce qui atteint des charges comparables aux machines.|Haltère d'un côté, appui de l'autre main, amplitude complète.|Utiliser le bras d'appui pour soulager.|Contrainte importante sur l'Achille.|Mollets machine, montées sur pointes|Tendinopathie d'Achille
Marche sur les pointes|Mollets|gastro;soleaire||pdc|iso|mollet|debutant|Endurance des mollets en régime continu, très proche de l'usage en montée.|La contraction continue sur plusieurs dizaines de mètres reproduit la sollicitation en côte prolongée.|20 à 40 mètres sur la pointe des pieds, talons jamais au sol.|Poser les talons en cours de trajet.|Aucun.|Montées sur pointes, farmer walk sur pointes|
Marche sur les talons|Mollets|tib-ant||pdc|iso|mollet|debutant|Renforce le tibial antérieur en endurance : prévention directe de la périostite.|Le tibial antérieur travaille en isométrie prolongée pour maintenir la dorsiflexion, exactement son rôle en descente.|20 à 40 mètres sur les talons, pointes de pieds relevées.|Poser les pointes.|Aucun.|Élévations tibial, dorsiflexion élastique|
Dorsiflexion élastique|Mollets|tib-ant||elastique|iso|mollet|debutant|Renforcement ciblé du tibial antérieur avec résistance réglable.|La résistance progressive permet de charger un muscle petit qui répond mal au seul poids de corps.|Élastique autour de l'avant-pied, ancré devant, dorsiflexion lente contre résistance.|Aller trop vite.|Aucun.|Élévations tibial, marche sur les talons|
Extension de poignet à la poulie|Avant-bras|ext-avant-bras||poulie|iso|avantbras|debutant|Tension constante sur les extenseurs, plus régulière qu'avec un haltère.|La poulie garde la résistance sur toute l'amplitude, y compris en extension complète où l'haltère perd la tension.|Avant-bras posé, poignée basse, extension complète et lente.|Charge trop lourde.|Aucun à charge légère.|Extension haltère, curl inversé|
Rouleau de poignet|Avant-bras|fl-avant-bras;ext-avant-bras||halteres|iso|avantbras|debutant|Travaille fléchisseurs et extenseurs en endurance : préhension et prévention en un seul outil.|L'enroulement alterné sollicite les deux groupes en alternance sur une durée longue, ce qui développe l'endurance plutôt que la force maximale.|Bras tendus à l'horizontale, enrouler puis dérouler la corde, sans reposer les bras.|Fléchir les coudes pour soulager.|Fatigue des épaules avant les avant-bras : réduis la durée.|Farmer walk, suspension|
Pince de préhension|Avant-bras|fl-avant-bras||halteres|iso|avantbras|debutant|Force de serrage pure : le premier facteur limitant au soulevé de terre lourd.|La préhension écrasante utilise les fléchisseurs des doigts, distincts de ceux du poignet, et se travaille en isométrie ou en répétitions courtes.|Serrage complet, tenue 2 secondes, 8 à 12 répétitions.|Serrer sans amplitude complète.|Aucun.|Farmer walk, suspension|
Suspension une main|Avant-bras|fl-avant-bras|dors-sup|pdc|iso|avantbras|avance|Double la charge de préhension et développe le contrôle d'épaule sous charge.|Le poids complet du corps repose sur une seule main : la contrainte de préhension est maximale.|Une main, épaule active, 10 à 20 secondes, changer de côté.|Se pendre totalement relâché.|Contrainte élevée sur l'épaule : réserve aux pratiquants confirmés.|Suspension deux mains, farmer walk|Instabilité d'épaule
Farmer walk une main|Avant-bras|fl-avant-bras|obliques;trap-sup|halteres|poly|gainage|debutant|Préhension et gainage antilatéroflexion dans le même mouvement.|La charge d'un seul côté oblige les obliques opposés à travailler en isométrie pendant que la main serre.|Charge lourde d'un côté, buste strictement vertical, 20 à 30 mètres.|Se pencher du côté de la charge.|Flexion latérale sous charge.|Farmer walk deux mains, suitcase carry|
Pronation supination avec massue|Avant-bras|ext-avant-bras;fl-avant-bras|brachio-radial|halteres|iso|avantbras|debutant|Travaille la rotation de l'avant-bras, mouvement absent de tous les autres exercices.|La pronosupination est assurée par des muscles spécifiques que ni le curl ni la préhension ne sollicitent directement.|Haltère tenu par une extrémité, coude au corps, rotation lente d'un côté à l'autre.|Charge trop lourde, mouvement rapide.|Contrainte de poignet si la charge est excessive.|Curl Zottman, rouleau de poignet|
Adduction à la poulie basse|Adducteurs|add||poulie|iso|adducteur|debutant|Isolation des adducteurs debout avec tension constante.|La position debout permet une amplitude plus naturelle qu'en machine et sollicite aussi la stabilité du bassin.|Sangle à la cheville, jambe qui croise devant l'autre, contrôle du retour.|Se pencher pour gagner de l'amplitude.|Peu de risques.|Adduction machine, cossack squat|
Squat sumo barre|Adducteurs|add;quad-vaste-med|fess-grand|barre|poly|squat|inter|Version chargée du sumo squat : les adducteurs deviennent moteurs de l'extension.|L'écartement place les adducteurs en position d'extenseurs de hanche, rôle qu'ils n'ont pas en position étroite.|Pieds très écartés, pointes ouvertes, descente entre les jambes, buste vertical.|Genoux qui rentrent.|Étirement important des adducteurs en bas.|Sumo squat haltère, cossack squat|Pubalgie
Adduction isométrique ballon|Adducteurs|add|transverse|aucun|iso|adducteur|debutant|Contraction isométrique simple, utile en prévention et en reprise après lésion.|L'isométrie permet de charger l'adducteur sans mouvement, régime le mieux toléré en phase de reprise.|Ballon ou coussin entre les genoux, serrage 10 secondes, 6 à 10 répétitions.|Serrer en apnée.|Aucun.|Copenhagen plank, adduction machine|
Fente latérale lestée|Adducteurs|add;quad-vaste-med|fess-moyen|halteres|poly|fente|inter|Charge le plan frontal, très peu travaillé, avec un étirement contrôlé des adducteurs.|Le déplacement latéral sollicite les adducteurs en excentrique sur la jambe tendue et en concentrique au retour.|Grand pas latéral, hanche qui recule, pied opposé tendu, retour actif.|Genou qui dépasse largement le pied.|Étirement important : progression prudente.|Cossack squat, fente latérale|Pubalgie
Ab wheel debout|Abdominaux|grand-droit-haut;transverse|dors-sup|pdc|iso|gainage|avance|La version la plus difficile du gainage antiextension.|Départ debout, le bras de levier est maximal dès le début : la contrainte sur les abdos dépasse tout autre exercice.|Uniquement après avoir maîtrisé la version à genoux en amplitude complète.|Tenter avant d'être prêt.|Le mécanisme d'accident le plus courant est l'effondrement en hyperextension lombaire.|Roue à genoux, planche lestée|Lombalgie
Planche lestée|Abdominaux|transverse;grand-droit-haut|fess-grand|pdc|iso|gainage|inter|Permet de progresser sur la planche autrement qu'en allongeant indéfiniment la durée.|Au-delà de 60 secondes, allonger la tenue développe surtout l'endurance : ajouter de la charge relance le stimulus de force.|Disque sur le haut du dos, position de planche stricte, 20 à 40 secondes.|Bassin qui s'affaisse sous la charge.|Affaissement lombaire sous charge additionnelle.|Planche, roue abdominale|
Side plank raise|Abdominaux|obliques|fess-moyen|pdc|iso|gainage|inter|Version dynamique de la planche latérale : plus de stimulus pour la même position.|Le mouvement de montée-descente ajoute une composante concentrique et excentrique aux obliques, absente de l'isométrie pure.|Planche latérale, montée et descente du bassin en contrôle, 8 à 15 répétitions.|Rouler le buste vers l'avant.|Contrainte d'épaule d'appui.|Planche latérale, pallof press|Instabilité d'épaule
Crunch machine|Abdominaux|grand-droit-haut||machine|iso|gainage|debutant|Permet de charger les abdominaux progressivement, comme tout autre muscle.|La charge réglable rend possible un travail en 8 à 15 répétitions, seule façon d'appliquer une surcharge progressive aux abdominaux.|Dos calé, enroulement du tronc, retour contrôlé.|Tirer avec les bras.|Peu de risques.|Crunch poulie, crunch au sol|
Hollow rock|Abdominaux|grand-droit-haut;grand-droit-bas;transverse||pdc|iso|gainage|avance|Version dynamique du hollow hold : maintenir la position pendant que le corps balance.|Le balancement crée des perturbations que les abdos doivent absorber sans que le bas du dos ne se décolle.|Position hollow stricte, balancement d'avant en arrière sans casser la position.|Casser la position pour balancer plus.|Décollement lombaire.|Hollow hold, dead bug|
Dead bug lesté|Abdominaux|transverse;grand-droit-bas||halteres|iso|gainage|inter|Ajoute une charge au meilleur exercice de contrôle lombaire.|Une charge dans les mains augmente le bras de levier que le transverse doit neutraliser pour garder le dos plaqué.|Petite charge dans chaque main, bas du dos plaqué en permanence.|Décoller le bas du dos pour utiliser une charge plus lourde.|Décollement lombaire.|Dead bug, hollow hold|
Squat sur boîte|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand;lombaires|barre|poly|squat|inter|Fixe la profondeur exacte et supprime le rebond : la remontée part d'un arrêt complet.|La pause sur la boîte élimine l'énergie élastique accumulée à la descente : la remontée est purement concentrique, ce qui développe la force de démarrage.|Boîte réglée à la profondeur cible, assise contrôlée sans s'écraser, remontée sans élan.|S'effondrer sur la boîte, rebondir dessus.|L'écrasement brutal sur la boîte transmet un choc à la colonne.|Squat classique, squat avec pause|Lombalgie
Squat avec pause|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand|barre|poly|squat|inter|Deux à trois secondes en bas : renforce la position la plus faible du mouvement.|La pause dissipe l'énergie élastique et allonge le temps sous tension dans la position d'étirement, la plus productive en hypertrophie.|Descente normale, pause de 2 à 3 secondes en bas sans relâcher le gainage, remontée explosive.|Relâcher le dos pendant la pause.|Le relâchement du gainage en position basse chargée.|Squat sur boîte, squat classique|
Walking lunge en montée|Quadriceps|quad-vaste-lat;quad-droit|fess-grand;gastro|aucun|poly|fente|debutant|Fente réalisée en pente : le geste le plus proche de la montée en sentier raide.|La pente réduit la phase excentrique et augmente la part concentrique, exactement comme en côte.|En pente montante, grands pas, buste droit, poussée par le talon avant.|Pas trop courts en fatiguant.|Terrain instable.|Fente marchée, step-up|
Zercher squat|Quadriceps|quad-vaste-med;quad-droit|fess-grand;grand-droit-haut;lombaires|barre|poly|squat|avance|Barre au creux des coudes : exigence de gainage antérieur maximale et buste très vertical.|La charge portée devant, au niveau du sternum, impose au tronc de résister à la flexion tout au long du mouvement.|Barre au creux des coudes, buste vertical, descente profonde, gainage serré.|Laisser le buste s'effondrer vers l'avant.|Inconfort marqué au creux du coude, et chute de barre si le gainage lâche.|Squat avant, squat gobelet|
Développé haltères une main|Deltoïdes|delt-ant;delt-lat|obliques;transverse|halteres|poly|pousseeV|inter|Poussée unilatérale : le tronc doit résister à l'inclinaison latérale pendant que l'épaule pousse.|La charge d'un seul côté ajoute une composante antilatéroflexion : le gainage travaille autant que l'épaule.|Debout, un haltère, gainage serré, buste strictement vertical.|Se pencher du côté opposé.|Flexion latérale compensatoire sous charge.|Développé militaire, développé haltères|
Tirage horizontal prise large|Dorsaux|dors-sup;rhomb|delt-post;trap-moy|poulie|poly|tirageH|debutant|Prise large sur un tirage horizontal : accentue la largeur plutôt que l'épaisseur.|Une prise large fait partir les coudes à l'écart du corps : la ligne de traction passe sur les fibres hautes du dorsal et le deltoïde postérieur, plutôt que sur les fibres basses.|Barre large, coudes à hauteur d'épaules, tirer vers le haut du sternum.|Tirer vers le nombril, ce qui annule l'intérêt de la prise large.|Peu de risques.|Rowing poulie basse, face pull|
Traction lestée|Dorsaux|dors-sup|bic-long;rhomb;fl-avant-bras|pdc|poly|tirageV|avance|Le mouvement de dos le plus lourd disponible au poids du corps.|Au-delà d'une douzaine de tractions propres, ajouter de la charge est le seul moyen de rester dans une fourchette de force plutôt que d'endurance.|Ceinture lestée, amplitude complète, descente contrôlée avec tension résiduelle en bas.|Écourter l'amplitude pour ajouter du poids.|La descente complète brutale sous charge met la coiffe en traction.|Traction, tirage vertical lourd|Douleur d'épaule
Traction prise serrée supination|Dorsaux|dors-inf|bic-long;bic-court|pdc|poly|tirageV|inter|Amplitude d'adduction maximale : les fibres basses du dorsal se raccourcissent complètement.|Une prise serrée en supination rapproche les coudes du tronc en fin de course, ce qui raccourcit davantage les fibres inférieures que la prise large.|Mains serrées paumes vers soi, poitrine vers la barre, coudes vers les hanches.|Cambrer excessivement.|Contrainte sur le tendon distal du biceps.|Traction neutre, tirage serré|Tendinopathie du biceps
Rowing Kroc|Dorsaux|dors-inf|trap-sup;fl-avant-bras;rhomb|halteres|poly|tirageH|avance|Rowing haltère très lourd en séries longues : construit le dos et la préhension simultanément.|La charge très élevée et le léger élan contrôlé permettent d'accumuler un volume de tension impossible en strict, avec un fort recrutement du trapèze.|Appui sur un banc, charge lourde, 15 à 25 répétitions, léger élan de hanche toléré.|Transformer l'élan contrôlé en balancement complet du dos.|L'élan doit venir de la hanche, jamais d'une flexion-extension lombaire.|Rowing haltère strict, rowing machine|Lombalgie
Rowing Meadows|Dorsaux|dors-inf|rhomb;trap-moy|barre|poly|tirageH|inter|Angle de traction unique grâce à la barre en coin : forte contraction en fin de course.|La barre ancrée au sol crée un arc de traction qui accompagne le mouvement naturel de l'omoplate, avec un étirement marqué en position basse.|Barre en coin, prise pronation, buste penché, tirer vers la hanche.|Se redresser en cours de série.|Contrainte lombaire en position penchée.|Rowing haltère, rowing T-bar|Lombalgie
Tirage vertical unilatéral|Dorsaux|dors-sup|bic-long|poulie|poly|tirageV|debutant|Révèle les asymétries et permet une amplitude d'adduction plus complète qu'en bilatéral.|Un seul bras peut descendre le coude plus près du tronc sans que l'autre côté ne bloque : l'amplitude gagnée est réelle.|Poignée simple, buste stable, coude vers la hanche.|Tourner le buste pour aider.|Peu de risques.|Traction, tirage bilatéral|
Pull-up australien lesté|Dorsaux|dors-inf;rhomb|trap-moy;bic-long|pdc|poly|tirageH|inter|Version chargée du rowing inversé, sans contrainte lombaire.|Le corps reste gréé en ligne : le tirage horizontal se fait sans que le bas du dos n'ait à maintenir une position penchée.|Disque sur la poitrine, corps aligné, poitrine vers la barre.|Bassin qui s'affaisse.|Affaissement lombaire sous charge.|Rowing inversé, rowing poulie|
Shrug incliné|Dorsaux|trap-moy;trap-inf|rhomb|halteres|iso|tirageH|inter|Cible le trapèze moyen et inférieur, presque jamais isolés.|Buste penché sur un banc incliné, l'élévation d'omoplate se fait vers l'arrière et non vers le haut : ce sont les fibres moyennes et basses qui travaillent.|Buste sur banc incliné, bras pendants, rétraction pure des omoplates sans plier les coudes.|Plier les coudes et transformer en rowing.|Aucun.|Face pull, Y-raise|
Extension lombaire une jambe|Dorsaux|lombaires|fess-grand;isch-biceps-fem|pdc|iso|lombaire|inter|Renforce les érecteurs et révèle les asymétries de chaîne postérieure.|L'appui unilatéral oblige le carré des lombes du côté opposé à stabiliser en plus de l'extension.|Sur banc à 45 degrés, une jambe seulement, montée jusqu'à l'alignement.|Basculer le bassin.|Hyperextension.|Hyperextension classique, bird dog|Lombalgie
Reverse hyper|Dorsaux|lombaires|fess-grand;isch-biceps-fem|machine|iso|lombaire|inter|Renforce la chaîne postérieure en décompression plutôt qu'en compression.|Le buste est fixe et ce sont les jambes qui montent : la colonne travaille en traction douce au lieu d'encaisser une charge axiale.|Buste appuyé, montée des jambes jusqu'à l'horizontale, descente lente sans balancement.|Balancer les jambes par élan.|Le balancement rapide annule le bénéfice et sollicite les lombaires en à-coups.|Hyperextension, superman|
Bonne posture au mur|Dorsaux|trap-inf;rhomb|coiffe|aucun|iso|epauleIso|debutant|Corrige l'enroulement d'épaules dû à la position assise, faisable partout et tous les jours.|Le glissement des bras contre le mur force la bascule postérieure de l'omoplate, mouvement que le trapèze inférieur assure et qui se perd avec la sédentarité.|Dos, tête et bras au mur, glisser les bras vers le haut sans décoller les poignets.|Cambrer le dos pour garder les bras au mur.|Aucun.|Y-raise, face pull|
Deadlift déficit|Dorsaux|lombaires|isch-biceps-fem;fess-grand;quad-vaste-lat|barre|poly|charniere|avance|Amplitude allongée : renforce spécifiquement le démarrage du soulevé au sol.|Debout sur une cale, la barre part plus bas : la portion la plus faible du mouvement est chargée sur une amplitude supérieure.|Cale de 3 à 5 cm, charge réduite de 15 à 20 pour cent, dos strictement neutre.|Garder la charge habituelle sur une amplitude allongée.|C'est la variante où le dos s'arrondit le plus facilement au démarrage.|Soulevé classique, soulevé en rack|Lombalgie
Rack pull|Dorsaux|trap-sup;lombaires|dors-inf;fess-grand|barre|poly|charniere|inter|Charge supérieure au soulevé complet sur une amplitude réduite : renforce le verrouillage.|En partant au-dessus du genou, le bras de levier est bien plus favorable : on peut manipuler une charge nettement supérieure et habituer le corps à la tenir.|Barre en rack à hauteur de genou, dos neutre, verrouillage complet des hanches.|Hyperextension au verrouillage.|Charge très élevée : la préhension et le dos doivent suivre.|Soulevé classique, shrug lourd|Lombalgie
Kettlebell clean|Dorsaux|trap-sup;lombaires|fess-grand;isch-biceps-fem|kettlebell|poly|charniere|avance|Charnière explosive suivie d'une réception : puissance et coordination.|L'extension de hanche projette la kettlebell, le corps doit ensuite absorber la réception en position rackée : deux qualités entraînées dans un même geste.|Charnière de hanche, projection, réception souple au rack sans choc sur l'avant-bras.|Laisser la kettlebell retomber sur l'avant-bras.|Le choc à la réception est le défaut le plus douloureux, corrigé par une rotation de poignet propre.|Kettlebell swing, high pull|Lombalgie
Poulie basse prise neutre serrée|Dorsaux|dors-inf|rhomb;bic-long|poulie|poly|tirageH|debutant|La variante la plus confortable de tirage horizontal, y compris avec une épaule sensible.|La prise neutre place l'épaule dans son axe le plus tolérant et concentre la traction sur les fibres basses du dorsal.|Dos droit, tirer vers le nombril, omoplates qui s'écartent en fin d'allongement.|Se pencher en arrière.|Peu de risques.|Rowing machine, rowing haltère|
Pompes lestées|Pectoraux|pec-stern|tri-lat;delt-ant;transverse|pdc|poly|pousseeH|inter|Permet de rester dans une fourchette de force quand les pompes deviennent trop faciles.|Un disque sur le dos ajoute une charge réelle : au-delà de 20 pompes, seul le lestage relance un stimulus de force.|Disque sur le haut du dos, gainage serré, amplitude complète.|Bassin qui s'affaisse sous la charge.|Affaissement lombaire aggravé par la charge.|Pompes déclinées, développé couché|
Développé incliné à la poulie|Pectoraux|pec-clav|delt-ant;tri-lat|poulie|poly|pousseeH|inter|Tension constante sur le haut des pectoraux, du début à la fin du mouvement.|Contrairement aux haltères, la poulie ne perd pas de résistance en fin de poussée : le pectoral reste chargé en position raccourcie.|Poulies basses, banc à 30 degrés, convergence des mains en haut.|Charge excessive qui force la trajectoire.|Peu de risques.|Développé incliné haltères, écarté poulie|
Squeeze press|Pectoraux|pec-stern|tri-lat|halteres|poly|pousseeH|debutant|La pression des haltères l'un contre l'autre maintient une contraction permanente du pectoral.|L'adduction isométrique constante ajoute un stimulus que la poussée seule ne produit pas, y compris en position haute.|Haltères collés et pressés l'un contre l'autre pendant tout le mouvement.|Relâcher la pression en cours de série.|Peu de risques.|Développé haltères, pec deck|
Pompes sur anneaux|Pectoraux|pec-stern|tri-lat;coiffe;transverse|pdc|poly|pousseeH|avance|L'instabilité recrute fortement les stabilisateurs d'épaule en plus des pectoraux.|Les anneaux mobiles obligent la coiffe à centrer l'humérus en permanence, ce qu'aucun appui fixe ne demande.|Anneaux bas, corps gréé, coudes serrés, rotation externe en fin de poussée.|Laisser les anneaux partir vers l'extérieur.|L'instabilité sous fatigue est le moment où l'épaule lâche.|Pompes classiques, dips anneaux|Instabilité d'épaule
Développé couché avec pause|Pectoraux|pec-stern|tri-lat;delt-ant|barre|poly|pousseeH|inter|Supprime le rebond : la remontée part d'un arrêt complet sur la poitrine.|La pause dissipe l'énergie élastique accumulée à la descente : la portion la plus faible du mouvement est chargée en pur concentrique.|Descente contrôlée, pause d'une à deux secondes sans relâcher la tension, poussée franche.|Se reposer la barre sur la cage pendant la pause.|Poser le poids sur la cage thoracique.|Développé classique, développé au sol|
Élévations latérales en déficit poulie|Deltoïdes|delt-lat||poulie|iso|epauleIso|inter|Charge le deltoïde latéral dès le début du mouvement, bras encore le long du corps.|La poulie basse croisée derrière le corps crée une tension en position d'étirement, exactement là où les haltères ne demandent rien.|Poulie basse croisée, montée jusqu'à l'horizontale, descente très lente.|Utiliser l'élan du buste.|Peu de risques.|Élévations haltères, élévations machine|
Développé assis à la poulie|Deltoïdes|delt-ant;delt-lat|tri-long|poulie|poly|pousseeV|debutant|Tension constante sur la poussée verticale, sans point mort en fin de course.|La résistance de la poulie ne diminue pas quand les bras se tendent, contrairement à la gravité sur des haltères.|Banc entre deux poulies basses, poussée verticale, coudes légèrement en avant.|Cambrer le dos.|Cambrure compensatoire.|Développé haltères, presse à épaules|
Élévations latérales élastique|Deltoïdes|delt-lat||elastique|iso|epauleIso|debutant|Résistance croissante qui culmine à l'horizontale, là où le deltoïde travaille le plus.|La courbe de l'élastique épouse bien la courbe de force de l'abduction : peu de résistance en bas, maximum en haut.|Pied sur l'élastique, montée jusqu'à l'horizontale, retour freiné.|Laisser l'élastique ramener le bras.|Vérifier l'ancrage.|Élévations poulie, élévations haltères|
Rotation externe couché sur le côté|Deltoïdes|coiffe|delt-post|halteres|iso|epauleIso|debutant|Renforcement de la coiffe sans matériel spécifique, en position stable.|Allongé sur le côté, la gravité charge directement la rotation externe, mouvement que rien d'autre ne travaille en salle.|Coude au corps à 90 degrés, charge très légère, rotation lente vers le plafond.|Charge lourde qui fait décoller le coude.|Aucun à charge légère.|Rotation externe poulie, face pull|
Sleeper stretch actif|Deltoïdes|coiffe||aucun|iso|mobilite|debutant|Restaure la rotation interne d'épaule, souvent perdue chez ceux qui poussent beaucoup.|Le manque de rotation interne modifie la course de la tête humérale et favorise le conflit : le récupérer est une mesure de prévention directe.|Allongé sur le côté, bras à 90 degrés, rotation douce vers le sol, jamais forcée.|Forcer jusqu'à la douleur.|Ne jamais forcer : la douleur signale une mise en tension excessive de la capsule.|Mobilité thoracique, rotation externe|Douleur d'épaule aiguë
Élévations frontales à la corde|Deltoïdes|delt-ant|pec-clav|poulie|iso|epauleIso|debutant|Tension constante et prise neutre : plus confortable pour l'épaule que la barre.|La corde autorise une légère rotation externe en fin de course, ce qui réduit le pincement sous-acromial.|Poulie basse, montée jusqu'aux yeux, écartement léger de la corde en haut.|Monter au-dessus de la tête.|Conflit si l'amplitude dépasse la hauteur des yeux.|Élévations haltères, développé incliné|
Handstand hold contre mur|Deltoïdes|delt-ant;delt-lat|tri-long;transverse|pdc|iso|pousseeV|inter|Isométrie sous le poids du corps complet : force d'épaule et gainage antérieur.|Le maintien en équilibre demande une contraction continue du deltoïde et un gainage antiextension permanent.|Pieds au mur, corps gréé, épaules actives et poussées vers le haut, 20 à 45 secondes.|Cambrer le dos, relâcher les épaules.|Chute sur la nuque : monte progressivement, à côté d'un tapis.|Pompes piquées, développé militaire|Problème cervical
Curl bayésien à la poulie|Biceps|bic-long||poulie|iso|bras|inter|Bras derrière le corps avec tension constante : la meilleure façon de charger la longue portion.|La longue portion s'insère au-dessus de l'épaule : elle n'est pleinement étirée que si le bras part en arrière, ce que la poulie permet sans lâcher la tension.|Dos à la poulie basse, un pas en avant, coude fixe légèrement derrière le corps.|Avancer le coude en fin de montée.|Position d'étirement chargée : charge modérée.|Curl incliné, curl haltères|Tendinopathie du long biceps
Curl marteau croisé|Biceps|brachial;brachio-radial|bic-court|halteres|iso|bras|debutant|La trajectoire croisée devant le corps accentue le brachial.|Amener l'haltère vers l'épaule opposée place le brachial dans son axe le plus favorable et raccourcit le biceps.|Coude fixe, haltère qui monte vers l'épaule opposée.|Bouger l'épaule pour accompagner.|Peu de risques.|Curl marteau, curl corde|
Chin-up isométrique|Biceps|bic-long;bic-court|dors-sup|pdc|iso|tirageV|inter|Tenue en position haute : la contraction maximale maintenue construit la force de finition.|L'isométrie en fin d'amplitude renforce spécifiquement la portion du mouvement où la traction bloque le plus souvent.|Menton au-dessus de la barre, tenue 15 à 30 secondes, descente contrôlée.|Se relâcher progressivement sans contrôle.|Fatigue tendineuse : progression graduelle.|Traction, curl lourd|Tendinopathie du biceps
Curl banc Scott poulie|Biceps|bic-court||poulie|iso|bras|debutant|Combine le blocage du pupitre et la tension constante de la poulie.|Le pupitre supprime toute triche pendant que la poulie garde la résistance en fin de course, là où l'haltère la perd.|Bras entièrement en contact avec le pupitre, descente contrôlée.|Relâcher brutalement en bas.|Extension brutale sous charge.|Curl pupitre barre, curl concentré|
Extension triceps couché haltères|Triceps|tri-long;tri-lat||halteres|iso|bras|debutant|Chaque bras travaille indépendamment : moins de contrainte de poignet qu'à la barre.|Les haltères permettent une légère rotation qui soulage le coude tout en gardant l'étirement de la longue portion.|Coudes fixes vers le plafond, descente de part et d'autre de la tête.|Écarter les coudes.|Contrainte de coude, moindre qu'à la barre droite.|Barre au front, extension corde|Douleur de coude
Dips lestés|Triceps|tri-lat;tri-long|pec-abdo;delt-ant|pdc|poly|bras|avance|Le mouvement de triceps le plus lourd qui existe au poids du corps.|Au-delà de quinze dips propres, seule la charge additionnelle maintient un stimulus de force plutôt que d'endurance.|Ceinture lestée, buste vertical, descente jusqu'à l'horizontale des bras.|Descendre trop bas sous charge.|La descente excessive sous charge est le mécanisme classique de lésion de l'épaule antérieure.|Dips, développé prise serrée|Douleur d'épaule
JM press|Triceps|tri-long;tri-med|pec-stern|barre|poly|bras|avance|Hybride entre développé prise serrée et barre au front : charge lourde sur le triceps.|La trajectoire descend vers le cou avec les coudes qui avancent : le triceps est étiré puis chargé sur une amplitude complète, avec la stabilité d'un développé.|Prise serrée, coudes qui avancent, barre vers le haut du sternum.|Trajectoire mal maîtrisée avec charge lourde.|La barre passe près de la gorge : à n'aborder qu'avec des barres de sécurité en place.|Développé prise serrée, barre au front|Débutant
Extension triceps à genoux poulie haute|Triceps|tri-long||poulie|iso|bras|inter|Position à genoux : le gainage empêche toute compensation lombaire.|La position agenouillée bloque la triche par le buste et maintient la longue portion en étirement complet.|À genoux, dos à la poulie, coudes hauts et fixes.|Cambrer le dos.|Cambrure compensatoire.|Extension corde debout, barre au front|
Squat sauté|Quadriceps|quad-vaste-lat;quad-droit|fess-grand;gastro|pdc|poly|squat|inter|Développe la puissance et la capacité à produire de la force rapidement.|Le cycle étirement-raccourcissement recrute les fibres rapides, régime que le squat lent ne touche pas.|Descente à mi-course, extension explosive, réception souple genoux fléchis.|Réception jambes tendues, atterrissage bruyant.|La réception raide transmet le choc au genou et au dos. Volume limité.|Squat classique, step-up explosif|Douleur de genou
Split squat bulgare au poids du corps|Quadriceps|quad-vaste-lat|fess-grand;fess-moyen|pdc|poly|fente|debutant|Unilatéral sans matériel, avec un fort travail d'équilibre.|Le poids de corps sur une jambe représente déjà une charge relative importante, et la position déséquilibrée sollicite les stabilisateurs de hanche.|Pied arrière sur un support, descente verticale, buste droit.|Pied avant trop près du support.|Torsion du genou arrière si le pied est mal placé.|Fente arrière, squat bulgare lesté|
Presse une jambe|Quadriceps|quad-vaste-lat;quad-vaste-med|fess-grand|machine|poly|squat|debutant|Corrige les asymétries sans contrainte lombaire ni exigence d'équilibre.|La machine supprime la composante d'équilibre : tout l'effort du côté faible passe dans le muscle plutôt que dans la stabilisation.|Pied centré, amplitude complète sans décoller le bassin, retour contrôlé.|Bassin qui décolle en fin de descente.|Décollement lombaire.|Presse bilatérale, fente bulgare|
Wall sit|Quadriceps|quad-vaste-lat;quad-vaste-med||pdc|iso|squat|debutant|Isométrie longue : développe l'endurance de force, précieuse en descente de sentier.|La contraction isométrique prolongée sollicite les fibres lentes du quadriceps, celles qui portent une descente de plusieurs heures.|Dos au mur, cuisses parallèles au sol, 30 à 90 secondes.|Prendre appui sur les mains.|Aucun risque hormis la fatigue.|Squat au poids du corps, descente de marche|
Fente sautée alternée|Quadriceps|quad-vaste-lat;quad-droit|fess-grand;gastro|pdc|poly|fente|avance|Puissance unilatérale et coordination sous fatigue.|L'alternance en l'air demande un contrôle du bassin en suspension, en plus de la production de force explosive.|Fente basse, saut, changement de jambe en l'air, réception souple.|Réception raide, genou qui rentre.|Réception mal amortie : contrainte élevée sur le genou. Volume limité.|Squat sauté, fente marchée|Douleur de genou
Leg extension une jambe|Quadriceps|quad-vaste-med;quad-vaste-lat||machine|iso|squat|debutant|Isole un côté à la fois : indispensable après une blessure pour rattraper l'écart.|Une asymétrie supérieure à dix pour cent entre les deux jambes est un facteur de risque de récidive documenté.|Une jambe, amplitude complète, contraction d'une seconde en haut.|Charge trop lourde avec élan du buste.|Contrainte fémoro-patellaire.|Leg extension bilatérale, presse une jambe|Syndrome rotulien
Hack squat inversé|Quadriceps|quad-vaste-lat|fess-grand;isch-biceps-fem|machine|poly|squat|inter|Face à la machine : le travail bascule vers les fessiers et les ischios.|L'orientation inverse la répartition du couple articulaire entre hanche et genou : la chaîne postérieure devient motrice.|Poitrine contre le dossier, descente profonde, poussée par les talons.|Décoller les talons.|Peu de risques.|Hack squat classique, presse|
Step-down|Quadriceps|quad-vaste-med|fess-moyen|pdc|iso|excentrique|debutant|Excentrique contrôlé du quadriceps et test de contrôle du genou.|La descente lente sur une jambe met le quadriceps en excentrique tout en révélant un éventuel valgus de genou, signe de faiblesse du moyen fessier.|Sur une marche, descendre le talon opposé au sol en 3 secondes sans le poser.|Laisser le genou rentrer vers l'intérieur.|Le valgus répété est le signal à corriger avant d'ajouter de la charge.|Descente de marche, squat une jambe|Douleur rotulienne
Hip thrust élastique|Fessiers|fess-grand|fess-moyen|elastique|poly|charniere|debutant|Résistance croissante qui culmine au verrouillage, exactement où le fessier est le plus fort.|La courbe de l'élastique correspond à celle du fessier : peu de tension en bas, maximum en extension complète.|Élastique sur les hanches, verrouillage complet sans cambrer.|Hyperextension lombaire.|Hyperextension.|Hip thrust barre, pont fessier|
Marche latérale en demi-squat|Fessiers|fess-moyen;fess-petit|quad-vaste-lat|elastique|iso|charniere|debutant|Isométrie du moyen fessier pendant un déplacement : sa fonction exacte à la marche.|Le muscle doit maintenir l'abduction tout en absorbant les transferts de poids, ce qu'un exercice statique ne reproduit pas.|Élastique au-dessus des genoux, demi-squat maintenu, pas latéraux lents.|Se redresser en cours de série.|Aucun.|Marche latérale, clamshell|
Pont fessier une jambe pieds surélevés|Fessiers|fess-grand|isch-biceps-fem;fess-moyen|pdc|poly|charniere|inter|Amplitude accrue par la surélévation, sur une seule jambe : charge élevée sans matériel.|Le pied surélevé augmente l'amplitude d'extension de hanche, et l'unilatéral double la charge relative.|Pied sur un support de 30 cm, bassin horizontal en haut, montée complète.|Basculer le bassin du côté libre.|Peu de risques.|Hip thrust une jambe, pont fessier|
Kickback fessier machine|Fessiers|fess-grand||machine|iso|charniere|debutant|Isolation guidée avec charge réglable, sans possibilité de compenser par le dos.|Le guidage bloque le bassin : la cambrure compensatoire, défaut principal de cet exercice, devient impossible.|Buste appuyé, extension de hanche complète, contraction d'une seconde.|Chercher une amplitude au-delà de la capacité de la hanche.|Peu de risques.|Kickback poulie, hip thrust|
Rotation externe de hanche assis|Fessiers|fess-moyen;fess-petit||elastique|iso|charniere|debutant|Renforce les rotateurs de hanche, souvent en cause dans les douleurs de genou.|Une faiblesse des rotateurs externes laisse le fémur tourner vers l'intérieur sous charge, ce qui crée le valgus de genou.|Assis, élastique aux genoux, ouverture lente et contrôlée.|Ouvrir par à-coups.|Aucun.|Clamshell, fire hydrant|
Nordic curl assisté élastique|Ischios|isch-biceps-fem;isch-demi-tendineux||elastique|iso|excentrique|inter|Rend le nordic curl accessible avant d'avoir la force de le faire complet.|L'élastique fournit une assistance décroissante, ce qui permet de contrôler la descente sur toute l'amplitude dès le départ.|Élastique ancré haut, chevilles bloquées, descente la plus lente possible.|Casser aux hanches.|Courbatures sévères : commence par 2 séries de 3.|Nordic curl, leg curl|Lésion d'ischios récente
Swing une main|Ischios|isch-biceps-fem;fess-grand|obliques;transverse|kettlebell|poly|charniere|inter|Ajoute une contrainte antirotation à la charnière explosive.|La charge d'un seul côté force les obliques à empêcher la rotation du tronc à chaque répétition.|Charnière de hanche, projection par les hanches, buste sans rotation.|Laisser le buste tourner.|Rotation lombaire sous charge explosive.|Swing deux mains, RDL une jambe|Lombalgie
Ischios à la poulie en extension de hanche|Ischios|isch-biceps-fem|fess-grand|poulie|iso|charniere|debutant|Isole l'extension de hanche debout avec tension constante.|Contrairement au RDL, le genou reste fixe : la seule variable est l'extension de hanche, donc l'ischio et le fessier.|Sangle à la cheville, buste stable, extension de hanche sans cambrer.|Cambrer le dos.|Cambrure compensatoire.|Kickback, RDL une jambe|
Mollets à la presse une jambe|Mollets|gastro|soleaire|machine|iso|mollet|debutant|Double la charge relative et corrige les asymétries.|Le mollet est très fort en proportion : l'unilatéral est souvent nécessaire pour atteindre une charge suffisante.|Un pied à la fois, amplitude complète, pause en bas.|Verrouiller le genou.|Contrainte sur l'Achille.|Mollets machine, montées sur pointes|Tendinopathie d'Achille
Mollets assis en déficit|Mollets|soleaire||machine|iso|mollet|debutant|Cible le soléaire sur une amplitude allongée.|Genou fléchi et talon sous le niveau, le soléaire travaille en étirement, position où la tension par fibre est la plus élevée.|Avant-pied sur une cale, genoux à 90 degrés, descente complète.|Rebondir en bas.|Rebond en étirement sur l'Achille.|Mollets assis, mollets debout|
Sauts à la corde une jambe|Mollets|gastro;soleaire|tib-ant|aucun|cardio|mollet|inter|Développe la raideur tendineuse et la réactivité du pied, jambe par jambe.|Le tendon d'Achille stocke et restitue l'énergie : cette qualité se travaille par des contacts brefs et répétés sur un seul appui.|Contacts très courts, réception sur l'avant du pied, 20 à 40 sauts par jambe.|Contacts longs, réception talon.|Impact répété : progression graduelle.|Corde à sauter, sauts sur place|Périostite, tendinopathie d'Achille
Écriture d'alphabet avec le pied|Mollets|tib-ant||aucun|iso|mobilite|debutant|Mobilise la cheville dans tous les axes : prévention d'entorse et récupération après blessure.|La cheville doit contrôler des amplitudes dans plusieurs plans en terrain irrégulier : ce travail multidirectionnel les entraîne toutes.|Pied en l'air, dessiner l'alphabet lentement avec la pointe, les deux côtés.|Aller trop vite.|Aucun.|Équilibre unipodal, mobilité cheville|
Rowing à un bras élastique|Avant-bras|fl-avant-bras|dors-inf;rhomb|elastique|poly|tirageH|debutant|Tirage complet transportable, avec un fort travail de préhension.|La résistance croissante de l'élastique culmine en contraction, ce qui sollicite la préhension au moment où elle est le plus mise à l'épreuve.|Élastique ancré, tirer le coude vers la hanche, retour freiné.|Laisser l'élastique ramener le bras.|Vérifier l'ancrage.|Rowing haltère, rowing poulie|
Suspension serviette|Avant-bras|fl-avant-bras|dors-sup|pdc|iso|avantbras|avance|Préhension épaisse : bien plus exigeant qu'une barre, transfert direct vers le port de charge.|Un diamètre de prise plus large réduit fortement la force de serrage disponible, ce qui surcharge les fléchisseurs des doigts.|Deux serviettes sur la barre, suspension 15 à 30 secondes.|Lâcher brutalement.|Chute : reste à faible hauteur.|Suspension barre, farmer walk|
Pince à disques|Avant-bras|fl-avant-bras||halteres|iso|avantbras|inter|Préhension en pince, différente du serrage : utile pour la force de doigts.|Le pincement sollicite le pouce en opposition, muscle négligé par tous les exercices de tirage.|Deux disques lisses pincés entre pouce et doigts, tenue 15 à 30 secondes.|Utiliser des disques trop lourds d'emblée.|Chute du disque sur les pieds.|Farmer walk, pince de préhension|
Flexion de poignet à la poulie|Avant-bras|fl-avant-bras||poulie|iso|avantbras|debutant|Tension constante sur les fléchisseurs, plus régulière qu'avec un haltère.|La poulie maintient la charge sur toute l'amplitude, y compris en fin de flexion où l'haltère perd la tension.|Avant-bras posé, paume vers le haut, flexion complète et lente.|Charge trop lourde.|Contrainte tendineuse.|Flexion haltère, rouleau de poignet|
Cossack squat lesté|Adducteurs|add;quad-vaste-med|fess-moyen|halteres|poly|fente|avance|Force en amplitude extrême sous charge : mobilité et force dans un même mouvement.|La charge en amplitude maximale renforce les adducteurs dans la position où ils sont le plus vulnérables.|Charge légère devant la poitrine, descente complète d'un côté, talon au sol.|Talon qui décolle, dos rond.|Étirement extrême sous charge : progression très lente.|Cossack squat, fente latérale|Pubalgie
Copenhagen plank genou|Adducteurs|add|obliques|pdc|iso|adducteur|debutant|Version accessible du Copenhagen : première marche vers la prévention de pubalgie.|L'appui sur le genou plutôt que sur le pied raccourcit le bras de levier et divise la contrainte par deux environ.|Genou de la jambe supérieure sur le banc, bassin décollé, 10 à 20 secondes.|Laisser le bassin s'affaisser.|Progression prudente.|Copenhagen plank complet, adduction machine|Pubalgie en cours
Adduction élastique debout|Adducteurs|add||elastique|iso|adducteur|debutant|Renforcement des adducteurs sans machine, transportable.|La résistance latérale de l'élastique reproduit la fonction d'adduction en position debout, plus fonctionnelle qu'en machine.|Élastique à la cheville ancré latéralement, jambe qui croise devant, retour contrôlé.|Se pencher pour gagner de l'amplitude.|Aucun.|Adduction poulie, sumo squat|
Sumo deadlift à la trap bar|Adducteurs|add;quad-vaste-med|fess-grand;lombaires|barre|poly|charniere|inter|Position large avec la charge dans l'axe du corps : adducteurs chargés sans contrainte lombaire excessive.|Les poignées latérales rapprochent le centre de gravité des hanches, ce qui allège fortement le moment de flexion sur la colonne.|Pieds écartés, pointes ouvertes, buste plus vertical qu'au conventionnel.|Genoux qui rentrent.|Étirement des adducteurs en position basse.|Soulevé sumo, sumo squat|Pubalgie
Gainage dynamique planche-pompe|Abdominaux|transverse;grand-droit-haut|delt-ant;tri-lat|pdc|iso|gainage|inter|Le passage coude-main ajoute une contrainte antirotation permanente.|Le corps doit résister à la rotation du bassin à chaque transfert d'appui : c'est du gainage antirotation dynamique.|Passage alterné coude puis main, bassin le plus stable possible.|Balancer le bassin d'un côté à l'autre.|Contrainte d'épaule répétée.|Planche, pallof press|Douleur d'épaule
Relevés de jambes à la chaise romaine|Abdominaux|grand-droit-bas|psoas;obliques|machine|iso|gainage|debutant|Version stable du relevé de jambes, sans exigence de préhension.|Les avant-bras appuyés suppriment le facteur limitant de la préhension : les abdominaux peuvent aller à l'échec.|Dos plaqué au dossier, enroulement du bassin, pas de balancement.|Ne bouger que les hanches sans enrouler le bassin.|Cambrure lombaire si le dos décolle.|Relevés suspendu, crunch inversé|
Rotation russe à la poulie|Abdominaux|obliques|transverse|poulie|iso|gainage|inter|Rotation chargée avec tension constante, plus contrôlable que les disques.|La poulie impose une résistance régulière : la rotation reste lente et contrôlée, ce qui protège le rachis lombaire.|Rotation venant du thorax, bassin stable, retour freiné.|Tourner depuis le bas du dos.|La rotation lombaire chargée est déconseillée : le mouvement doit venir du thorax.|Pallof press, wood chop|Hernie discale
Gainage bras tendus une jambe|Abdominaux|transverse;obliques|fess-grand|pdc|iso|gainage|inter|Trois appuis au lieu de quatre : la contrainte antirotation double.|Retirer un appui déséquilibre le corps en diagonale, ce que les obliques et le transverse doivent compenser en isométrie.|Position de planche haute, une jambe levée, bassin strictement horizontal.|Laisser le bassin tourner.|Peu de risques.|Planche, bird dog|
Marche du fermier en gainage|Abdominaux|transverse;obliques|trap-sup;fl-avant-bras|halteres|poly|gainage|debutant|Gainage sous charge en déplacement : la situation réelle du port de sac.|Le tronc doit résister à la fois à la flexion latérale et à la rotation pendant que les appuis alternent.|Charges lourdes, buste vertical, pas courts et contrôlés.|Se pencher, laisser les épaules s'affaisser.|Lâcher la charge sur les pieds.|Suitcase carry, farmer walk une main|
Course en côte|Cardio|cardio|quad-vaste-lat;gastro;fess-grand|aucun|cardio|cardio|inter|Développe la puissance aérobie avec moins d'impact qu'à plat.|La pente réduit la phase excentrique de la foulée : moins de dommages musculaires pour un coût cardiovasculaire équivalent.|Pente de 5 à 10 pour cent, foulée courte, effort soutenu mais contrôlé.|Attaquer trop vite au départ.|Charge cardiovasculaire élevée.|Intervalles en côte, vélo|Pathologie cardiaque non évaluée
Marche rapide chargée sur tapis incliné|Cardio|cardio|quad-vaste-lat;soleaire;trap-sup|machine|cardio|cardio|debutant|Reproduit la montée chargée en salle, avec un dénivelé et une charge réglables au degré près.|C'est la seule façon de contrôler précisément la progression en dénivelé et en charge quand le terrain manque.|Inclinaison 10 à 15 pour cent, sac chargé, 30 à 60 minutes, sans se tenir aux barres.|Se tenir aux poignées, ce qui divise la dépense.|Progression graduelle en charge.|Sortie longue, intervalles en côte|
Fractionné vélo court|Cardio|cardio|quad-vaste-lat|machine|cardio|cardio|inter|Efficacité cardiovasculaire maximale en peu de temps, sans impact articulaire.|Les efforts très courts et intenses sollicitent le débit cardiaque maximal, principal déterminant du VO2 max, sans contrainte de réception.|8 à 12 répétitions de 30 secondes à intensité élevée, récupération de 90 secondes.|Récupération écourtée.|Charge cardiovasculaire élevée.|Intervalles en côte, rameur|Pathologie cardiaque non évaluée
Natation continue|Cardio|cardio|dors-sup;delt-post|aucun|cardio|cardio|debutant|Volume aérobie sans aucun impact : idéal en récupération ou en cas de douleur articulaire.|La portance supprime la contrainte de réception : le système aérobie travaille sans que les articulations n'encaissent quoi que ce soit.|30 à 50 minutes à allure conversationnelle.|Forcer sur une technique non maîtrisée.|Aucun risque articulaire.|Vélo zone 2, marche|
Étirement actif ischios|Mobilité|mobilite|isch-biceps-fem|aucun|iso|mobilite|debutant|Gagne de l'amplitude utilisable plutôt qu'une souplesse passive inutile sous charge.|Contracter le quadriceps pendant l'étirement de l'ischio utilise l'inhibition réciproque et renforce la nouvelle amplitude au lieu de simplement l'étirer.|Jambe tendue en appui, contraction active du quadriceps, 5 tenues de 8 secondes.|Forcer en relâchement complet.|Aucun.|RDL une jambe, 90-90|
Mobilité d'épaule au bâton|Mobilité|mobilite|coiffe|aucun|iso|mobilite|debutant|Restaure l'amplitude nécessaire au développé militaire et aux tractions.|Le passage du bâton d'avant en arrière ouvre progressivement la rotation externe et l'élévation, deux amplitudes perdues avec la sédentarité.|Prise très large sur un bâton, passage lent d'avant en arrière, jamais en force.|Prise trop serrée qui force l'épaule.|Ne jamais forcer : réduis l'écartement plutôt que de compenser.|Mobilité thoracique, sleeper stretch|Douleur d'épaule aiguë
Squat profond tenu|Mobilité|mobilite|add;quad-vaste-med|aucun|iso|mobilite|debutant|Restaure la position de squat profond, perdue chez presque tous les adultes sédentaires.|Tenir la position basse charge les tissus en fin d'amplitude, ce qui augmente l'amplitude utilisable plus durablement qu'un étirement passif.|Position basse, talons au sol, coudes contre les genoux, 60 à 120 secondes.|Talons décollés, dos totalement rond.|Aucun.|Mobilité chevilles, cossack squat|
`.trim();

/* Anatomie — chaque faisceau avec sa fonction réelle, pas seulement son nom.
   C'est ce qui permet de répondre à « ce muscle, il travaille comment ? ». */
const MUSCLES = {
  "pec-clav": { nom: "Pectoral — faisceau claviculaire", court: "Haut des pecs", groupe: "pectoraux", fonction: "S'insère sur la clavicule. Il amène le bras vers le haut et l'intérieur, en diagonale montante. C'est le faisceau que le développé couché à plat sollicite le moins, et donc le point faible le plus fréquent." },
  "pec-stern": { nom: "Pectoral — faisceau sternal", court: "Sternal", groupe: "pectoraux", fonction: "La masse principale du pectoral, la plus volumineuse. Elle ramène le bras vers l'intérieur à l'horizontale : c'est l'adduction horizontale du développé couché et de l'écarté." },
  "pec-abdo": { nom: "Pectoral — faisceau abdominal", court: "Bas des pecs", groupe: "pectoraux", fonction: "Fibres basses qui tirent le bras vers le bas et l'intérieur. Travaillées par le décliné, les dips et tout ce qui pousse en diagonale descendante." },
  "delt-ant": { nom: "Deltoïde antérieur", court: "Épaule avant", groupe: "deltoides", fonction: "Fléchit le bras vers l'avant. Il participe à toutes les poussées, ce qui en fait le faisceau le plus sollicité et le moins souvent en retard." },
  "delt-lat": { nom: "Deltoïde latéral", court: "Épaule latérale", groupe: "deltoides", fonction: "Écarte le bras du corps. C'est lui qui donne la largeur d'épaule, et presque rien ne le travaille en dehors des élévations latérales : les développés le sollicitent peu." },
  "delt-post": { nom: "Deltoïde postérieur", court: "Épaule arrière", groupe: "deltoides", fonction: "Ramène le bras vers l'arrière à l'horizontale. C'est l'antagoniste direct du pectoral : son retard est la cause posturale la plus courante chez ceux qui poussent beaucoup." },
  "coiffe": { nom: "Coiffe des rotateurs", court: "Coiffe", groupe: "deltoides", fonction: "Quatre petits muscles qui centrent la tête de l'humérus dans son articulation. Ils ne font pas grossir, ils empêchent l'épaule de se blesser. Sous-entraînés chez presque tout le monde." },
  "bic-long": { nom: "Biceps — longue portion", court: "Longue portion", groupe: "biceps", fonction: "S'insère au-dessus de l'articulation de l'épaule : elle ne s'étire vraiment que lorsque le bras part derrière le corps. C'est elle qui forme le pic du biceps." },
  "bic-court": { nom: "Biceps — courte portion", court: "Courte portion", groupe: "biceps", fonction: "Portion interne du biceps, elle donne l'épaisseur vue de face. Elle travaille davantage quand le bras est devant le corps, comme au pupitre." },
  "brachial": { nom: "Brachial antérieur", court: "Brachial", groupe: "biceps", fonction: "Situé sous le biceps, il pousse celui-ci vers le haut et épaissit le bras. Il ne supine pas : la prise neutre est ce qui le met en position de force." },
  "brachio-radial": { nom: "Brachio-radial", court: "Brachio-radial", groupe: "biceps", fonction: "Muscle de l'avant-bras qui fléchit le coude. Il est le plus fort en prise neutre ou en pronation : curl marteau et curl inversé le ciblent directement." },
  "fl-avant-bras": { nom: "Fléchisseurs de l'avant-bras", court: "Fléchisseurs", groupe: "avantbras", fonction: "Ferment la main et fléchissent le poignet. Ce sont eux qui tiennent la barre : leur endurance est souvent le premier facteur limitant au soulevé de terre." },
  "ext-avant-bras": { nom: "Extenseurs de l'avant-bras", court: "Extenseurs", groupe: "avantbras", fonction: "Ouvrent la main et étendent le poignet. Chroniquement faibles chez ceux qui tirent et serrent beaucoup : c'est le déséquilibre à l'origine de l'épicondylite." },
  "grand-droit-haut": { nom: "Grand droit — portion haute", court: "Abdos hauts", groupe: "abdominaux", fonction: "Rapproche le sternum du pubis. C'est le muscle du crunch : une flexion courte du tronc, pas un relevé de buste complet." },
  "grand-droit-bas": { nom: "Grand droit — portion basse", court: "Abdos bas", groupe: "abdominaux", fonction: "Même muscle, mais l'activation régionale existe : enrouler le bassin vers le haut recrute davantage les fibres inférieures que le crunch classique." },
  "obliques": { nom: "Obliques", court: "Obliques", groupe: "abdominaux", fonction: "Produisent la rotation et la flexion latérale du tronc, et surtout les empêchent quand il faut. C'est leur rôle de frein qui compte le plus sous un sac porté d'un côté." },
  "transverse": { nom: "Transverse", court: "Transverse", groupe: "abdominaux", fonction: "Muscle profond qui ceinture l'abdomen. Il ne produit aucun mouvement visible : il stabilise la colonne, et c'est lui qu'on entraîne en gainage." },
  "quad-droit": { nom: "Droit fémoral", court: "Droit fémoral", groupe: "quadriceps", fonction: "Seul chef du quadriceps à traverser la hanche : il fléchit la hanche en plus d'étendre le genou. Il travaille le mieux quand la hanche est étendue, comme au squat avant ou au sissy squat." },
  "quad-vaste-lat": { nom: "Vaste latéral", court: "Vaste externe", groupe: "quadriceps", fonction: "Le plus volumineux des quatre, sur l'extérieur de la cuisse. Il donne la largeur visible et fait l'essentiel de l'extension de genou sous charge lourde." },
  "quad-vaste-med": { nom: "Vaste médial", court: "Vaste interne", groupe: "quadriceps", fonction: "La goutte au-dessus du genou, à l'intérieur. Il stabilise la rotule et travaille surtout en fin d'extension et en amplitude profonde." },
  "add": { nom: "Adducteurs", court: "Adducteurs", groupe: "adducteurs", fonction: "Ramènent la cuisse vers l'intérieur et participent à l'extension de hanche en position écartée. Leur faiblesse relative aux abducteurs est un facteur de pubalgie." },
  "tib-ant": { nom: "Tibial antérieur", court: "Tibial", groupe: "mollets", fonction: "Relève la pointe du pied. Il freine la pose du pied à chaque pas en descente : sa faiblesse est une cause classique de périostite tibiale." },
  "dors-sup": { nom: "Grand dorsal — fibres hautes", court: "Dorsaux — largeur", groupe: "dos", fonction: "Ramènent le bras du dessus de la tête vers le tronc. C'est l'adduction du bras, celle des tractions : ce sont ces fibres qui donnent la largeur du dos." },
  "dors-inf": { nom: "Grand dorsal — fibres basses", court: "Dorsaux — épaisseur", groupe: "dos", fonction: "Tirent le bras vers l'arrière et le bas, coude près du corps. Ce sont les fibres du tirage horizontal, celles qui donnent l'épaisseur sous l'omoplate." },
  "trap-sup": { nom: "Trapèze supérieur", court: "Trapèze haut", groupe: "trapezes", fonction: "Élève l'omoplate. C'est lui qui porte les charges à bout de bras et qui encaisse les bretelles d'un sac lourd." },
  "trap-moy": { nom: "Trapèze moyen", court: "Trapèze moyen", groupe: "trapezes", fonction: "Rapproche les omoplates de la colonne. Avec les rhomboïdes, c'est le contre-poids postural direct de tout le volume de développé couché." },
  "trap-inf": { nom: "Trapèze inférieur", court: "Trapèze bas", groupe: "trapezes", fonction: "Fait basculer l'omoplate vers le bas et l'arrière. C'est le grand oublié : sans lui, l'épaule s'enroule vers l'avant et le conflit sous-acromial s'installe." },
  "rhomb": { nom: "Rhomboïdes", court: "Rhomboïdes", groupe: "trapezes", fonction: "Situés entre les omoplates, ils les rapprochent et les font basculer vers l'intérieur. Ils travaillent sur tous les tirages horizontaux." },
  "lombaires": { nom: "Érecteurs du rachis", court: "Lombaires", groupe: "lombaires", fonction: "Maintiennent le dos neutre. Au soulevé de terre, ils travaillent en isométrie : ils ne produisent pas le mouvement, ils empêchent la colonne de céder pendant que les hanches poussent." },
  "tri-long": { nom: "Triceps — longue portion", court: "Longue portion", groupe: "triceps", fonction: "La plus volumineuse des trois, et la seule à s'insérer sur l'omoplate. Elle ne s'étire que si le bras passe au-dessus de la tête ou en arrière : c'est pour cela que les extensions overhead sont irremplaçables." },
  "tri-lat": { nom: "Triceps — chef latéral", court: "Chef latéral", groupe: "triceps", fonction: "Le chef externe, celui qui donne le fer à cheval visible de profil. Il travaille sur toutes les extensions de coude, surtout en pronation." },
  "tri-med": { nom: "Triceps — chef médial", court: "Chef médial", groupe: "triceps", fonction: "Le chef profond, actif sur toute l'amplitude et particulièrement en fin d'extension. Il est le plus sollicité par les charges légères et les fins de course." },
  "fess-grand": { nom: "Grand fessier", court: "Grand fessier", groupe: "fessiers", fonction: "Le muscle le plus puissant du corps. Il étend la hanche : c'est lui qui pousse en montée, au sprint et à la remontée de squat profond." },
  "fess-moyen": { nom: "Moyen fessier", court: "Moyen fessier", groupe: "fessiers", fonction: "Empêche le bassin de tomber du côté opposé pendant l'appui sur une jambe. Sa faiblesse est une cause fréquente de douleur de genou et de hanche à la marche longue." },
  "fess-petit": { nom: "Petit fessier", court: "Petit fessier", groupe: "fessiers", fonction: "Profond, il assiste le moyen fessier dans la stabilisation du bassin et la rotation de hanche." },
  "isch-biceps-fem": { nom: "Biceps fémoral", court: "Biceps fémoral", groupe: "ischios", fonction: "Le chef externe des ischios. Il étend la hanche et fléchit le genou : c'est le plus souvent lésé, et l'excentrique est ce qui le protège le mieux." },
  "isch-demi-tendineux": { nom: "Demi-tendineux et demi-membraneux", court: "Ischios internes", groupe: "ischios", fonction: "Les chefs internes des ischios. Mêmes fonctions que le biceps fémoral, avec une composante de rotation interne du genou." },
  "gastro": { nom: "Gastrocnémien", court: "Jumeaux", groupe: "mollets", fonction: "Le mollet visible, qui traverse le genou : il travaille surtout jambe tendue. Il assure la poussée explosive et la restitution élastique à chaque pas." },
  "soleaire": { nom: "Soléaire", court: "Soléaire", groupe: "mollets", fonction: "Sous le gastrocnémien, il ne traverse pas le genou : il travaille genou fléchi. C'est le muscle de l'endurance, celui qui porte la marche longue." },
  "cardio": { nom: "Système cardiovasculaire", court: "Cardio", groupe: "cardio", fonction: "Le moteur aérobie : cœur, capillaires et mitochondries. C'est ce qui détermine la capacité à tenir un effort de plusieurs heures sans s'effondrer." },
  "psoas": { nom: "Psoas-iliaque", court: "Psoas", groupe: "abdominaux", fonction: "Fléchisseur principal de la hanche, il relie le fémur aux vertèbres lombaires. Raccourci par la position assise, il bascule le bassin en avant et creuse le bas du dos." },
  "mobilite": { nom: "Mobilité articulaire", court: "Mobilité", groupe: "mobilite", fonction: "Amplitude utilisable sous contrôle. Une amplitude gagnée passivement mais non renforcée ne sert à rien sous charge." },
};

const GROUPES_MUSCULAIRES = {
  pectoraux: { nom: "Pectoraux", vue: "avant", couleur: "rouge" },
  deltoides: { nom: "Épaules", vue: "avant", couleur: "jaune" },
  biceps: { nom: "Biceps", vue: "avant", couleur: "bleu" },
  avantbras: { nom: "Avant-bras", vue: "avant", couleur: "blanc" },
  abdominaux: { nom: "Abdominaux", vue: "avant", couleur: "vert" },
  quadriceps: { nom: "Quadriceps", vue: "avant", couleur: "rouge" },
  adducteurs: { nom: "Adducteurs", vue: "avant", couleur: "bleu" },
  dos: { nom: "Dorsaux", vue: "arriere", couleur: "bleu" },
  trapezes: { nom: "Trapèzes & rhomboïdes", vue: "arriere", couleur: "jaune" },
  lombaires: { nom: "Lombaires", vue: "arriere", couleur: "rouge" },
  triceps: { nom: "Triceps", vue: "arriere", couleur: "vert" },
  fessiers: { nom: "Fessiers", vue: "arriere", couleur: "jaune" },
  ischios: { nom: "Ischio-jambiers", vue: "arriere", couleur: "rouge" },
  mollets: { nom: "Mollets", vue: "arriere", couleur: "vert" },
  cardio: { nom: "Cardio", vue: "aucune", couleur: "vert" },
  mobilite: { nom: "Mobilité", vue: "aucune", couleur: "blanc" },
};

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 46);

function parseExercises() {
  const vus = {};
  return EX_CSV.split("\n").map((line) => {
    const c = line.split("|");
    let id = slug(c[0]);
    if (vus[id]) id = id + "-" + (++vus[id]); else vus[id] = 1;
    return {
      id, nom: c[0], groupe: c[1],
      chefs: c[2] ? c[2].split(";").filter(Boolean) : [],
      secondaires: c[3] ? c[3].split(";").filter(Boolean) : [],
      materiel: c[4], type: c[5], pattern: c[6], niveau: c[7],
      interet: c[8], mecanique: c[9], consignes: c[10], erreurs: c[11],
      risques: c[12], variantes: c[13], contre: c[14] || "",
    };
  });
}
const EXERCICES = parseExercises();
/* --------------------------------------------------------------------------
   Profils de pratiquant — le niveau ne change pas qu'un multiplicateur.
   Il change le modèle de progression, le volume, le plafond d'intensité,
   la complexité technique autorisée et la fréquence des décharges.
   -------------------------------------------------------------------------- */

const NIVEAUX = {
  debutant: {
    nom: "Débutant", duree: "Moins d'un an de pratique régulière", couleur: "vert",
    volMult: 0.72, exosMax: 5, rpePlafond: 8, deloadToutes: 6, complexite: 1,
    progression: "lineaire",
    principe: "Tu progresses d'une séance à l'autre grâce à l'apprentissage moteur, pas grâce à l'accumulation de volume. Ajouter des séries ne fait qu'ajouter de la fatigue et dégrader la technique.",
    changements: [
      "Volume réduit d'environ 30 % : moins de séries, plus de qualité par série.",
      "Cinq exercices maximum par séance, tous polyarticulaires ou simples.",
      "Progression linéaire : on ajoute de la charge à chaque séance tant que ça passe proprement.",
      "RPE plafonné à 8 : on garde toujours deux répétitions en réserve. L'échec n'apporte rien à ce stade et coûte cher en technique.",
      "Aucun exercice de niveau avancé proposé, même si le matériel est disponible.",
      "Décharge toutes les 6 semaines : la fatigue s'accumule moins vite qu'à haut volume.",
    ],
    nutrition: "Protéines dans le haut de fourchette et surplus ou déficit modéré : la recomposition corporelle est très accessible en début de pratique, il n'y a pas besoin d'être agressif.",
  },
  intermediaire: {
    nom: "Confirmé", duree: "Un à trois ans, technique acquise, progression par paliers", couleur: "jaune",
    volMult: 1, exosMax: 6, rpePlafond: 9, deloadToutes: 5, complexite: 2,
    progression: "double",
    principe: "La progression séance après séance s'est arrêtée. Le levier devient l'accumulation de volume sur des blocs de plusieurs semaines, avec des paliers plutôt qu'une pente continue.",
    changements: [
      "Volume de référence : dix à vingt séries efficaces par groupe et par semaine.",
      "Six exercices par séance, avec des variantes qui ciblent les faisceaux en retard.",
      "Double progression : on monte en répétitions jusqu'au plafond de la fourchette, puis on augmente la charge et on redescend.",
      "RPE jusqu'à 9 sur les séries d'isolation, 8 maximum sur les polyarticulaires lourds.",
      "Exercices de niveau intermédiaire débloqués.",
      "Décharge toutes les 5 semaines.",
    ],
    nutrition: "Les gains simultanés deviennent difficiles : mieux vaut alterner des phases de construction et des phases de sèche plutôt que de rester à la maintenance en permanence.",
  },
  avance: {
    nom: "Expert", duree: "Plus de trois ans, progression lente et planifiée", couleur: "rouge",
    volMult: 1.25, exosMax: 7, rpePlafond: 10, deloadToutes: 4, complexite: 3,
    progression: "ondulatoire",
    principe: "Le stimulus nécessaire est devenu élevé et la marge de récupération étroite. La progression se planifie par blocs, avec une qualité qui mène et l'autre qui entretient.",
    changements: [
      "Volume majoré de 25 % et jusqu'à sept exercices par séance.",
      "Progression ondulatoire : l'intensité et les répétitions varient d'une séance à l'autre sur un même mouvement, lourd puis moyen puis léger dans la semaine.",
      "Autorégulation par RPE : la charge du jour dépend de la forme du jour, pas d'un pourcentage figé.",
      "Échec technique autorisé sur les séries longues d'isolation uniquement.",
      "Tous les exercices débloqués, y compris ceux qui exigent une maîtrise technique élevée.",
      "Décharge toutes les 4 semaines : à ce volume, la récupération devient le facteur limitant.",
    ],
    nutrition: "Les marges sont fines : c'est le niveau où la répartition des protéines par prise, le placement des glucides autour de la séance et la régularité du sommeil font une différence mesurable.",
  },
};
const NIV = (p) => NIVEAUX[p?.niveau] || NIVEAUX.intermediaire;

/* Zones sensibles : filtrage réel des exercices contre-indiqués */
const ZONES_SENSIBLES = {
  epaule: { nom: "Épaule", motifs: ["épaule", "coiffe", "acromio", "sous-acromial", "luxation", "sterno"] },
  coude: { nom: "Coude", motifs: ["coude", "épicondyl", "biceps", "triceps"] },
  poignet: { nom: "Poignet / main", motifs: ["poignet"] },
  dos: { nom: "Bas du dos", motifs: ["lombalgie", "lombaire", "hernie", "discale", "dos"] },
  genou: { nom: "Genou", motifs: ["genou", "rotul", "fémoro-patellaire", "croisé", "ménisque"] },
  hanche: { nom: "Hanche / aine", motifs: ["pubalgie", "hanche", "adducteur"] },
  cheville: { nom: "Cheville / pied", motifs: ["achille", "cheville", "périostite", "entorse"] },
  cervical: { nom: "Nuque", motifs: ["cervical", "nuque"] },
};

function exerciceDeconseille(ex, zones) {
  if (!zones?.length) return null;
  const texte = ((ex.contre || "") + " " + (ex.risques || "")).toLowerCase();
  for (const z of zones) {
    const def = ZONES_SENSIBLES[z]; if (!def) continue;
    if (def.motifs.some((m) => texte.includes(m))) return def.nom;
  }
  return null;
}

const nomMuscle = (id) => MUSCLES[id]?.court || id;
const nomMuscleLong = (id) => MUSCLES[id]?.nom || id;
const musclesDuGroupe = (g) => Object.entries(MUSCLES).filter(([, m]) => m.groupe === g).map(([k]) => k);
function exercicesPourMuscle(id) {
  const primaires = EXERCICES.filter((e) => e.chefs.includes(id));
  const secondaires = EXERCICES.filter((e) => !e.chefs.includes(id) && e.secondaires.includes(id));
  return { primaires, secondaires };
}
function exercicesPourGroupe(g) {
  const ids = musclesDuGroupe(g);
  const primaires = EXERCICES.filter((e) => e.chefs.some((c) => ids.includes(c)));
  const secondaires = EXERCICES.filter((e) => !primaires.includes(e) && e.secondaires.some((c) => ids.includes(c)));
  return { primaires, secondaires };
}
const exById = (id) => EXERCICES.find((e) => e.id === id);

/* --------------------------------------------------------------------------
   Objectifs d'entraînement : logique physiologique et paramètres — B.1 à B.4
   -------------------------------------------------------------------------- */

const OBJECTIFS_ENTRAINEMENT = {
  force: {
    nom: "Force", couleur: "rouge",
    logique: "La force est d'abord une compétence neuromusculaire avant d'être une question de taille de muscle. On cherche à améliorer le recrutement des unités motrices, la fréquence de décharge et la coordination intermusculaire. Seule une charge lourde impose au système nerveux de recruter les fibres à seuil élevé dès la première répétition.",
    comparaison: "Pourquoi 5×3 et pas 3×12 ? À 3 répétitions à 87 % du 1RM, chaque répétition est exécutée avec un recrutement maximal et une vitesse que le système nerveux apprend à reproduire. À 12 répétitions à 65 %, les premières répétitions ne recrutent pas les fibres rapides et la fatigue métabolique dégrade la technique en fin de série : on accumule du volume utile à l'hypertrophie, mais un signal de force beaucoup moins spécifique.",
    schemes: {
      principal: { series: 5, reps: [3, 5], rpe: [7, 8], repos: 240, intensite: [82, 90], pourquoiRepos: "3 à 5 minutes : la restauration de la phosphocréatine, principal substrat des efforts courts et intenses, exige ce délai. Écourter le repos réduit la charge à la série suivante, donc le stimulus de force lui-même." },
      secondaire: { series: 4, reps: [4, 6], rpe: [7, 8], repos: 180, intensite: [75, 85], pourquoiRepos: "3 minutes : encore lourd, encore dépendant de la filière anaérobie alactique." },
      accessoire: { series: 3, reps: [8, 12], rpe: [8, 9], repos: 90, intensite: [60, 70], pourquoiRepos: "90 s : le rôle de l'accessoire est de renforcer les points faibles et de protéger les articulations, pas de battre un record." },
      gainage: { series: 3, reps: [30, 45], rpe: [7, 8], repos: 60, unite: "s", pourquoiRepos: "60 s suffisent, l'objectif est la qualité de contraction." },
    },
    conseils: [
      "Les mouvements lourds passent en premier, sur système nerveux frais.",
      "Échauffement en pyramide obligatoire avant les séries de travail.",
      "Une répétition dégradée n'est pas une répétition de force, c'est une répétition à risque.",
      "La force progresse par paliers : une semaine sans progression n'est pas une stagnation.",
    ],
    frequenceMouvement: "2 à 3 fois par semaine sur les mouvements clés — la force étant une compétence, la répétition fréquente du geste améliore la maîtrise technique.",
  },
  hypertrophie: {
    nom: "Hypertrophie", couleur: "bleu",
    logique: "L'hypertrophie répond principalement à la tension mécanique appliquée aux fibres, accumulée sur un volume suffisant, avec le stress métabolique et les dommages musculaires comme facteurs secondaires. Le levier numéro un est le volume hebdomadaire de séries proches de l'échec par groupe musculaire.",
    comparaison: "Pourquoi 4×10 et pas 5×3 ? À 10 répétitions proches de l'échec, on cumule beaucoup plus de répétitions sous tension élevée qu'à 3 répétitions, tout en générant une fatigue neurologique bien moindre. On peut donc en faire davantage, plus souvent, et récupérer plus vite d'une séance à l'autre. C'est ce cumul de volume, semaine après semaine, qui construit du muscle.",
    schemes: {
      principal: { series: 4, reps: [6, 10], rpe: [7, 9], repos: 150, intensite: [70, 80], pourquoiRepos: "2 à 3 minutes sur les polyarticulaires. Attention au mythe du repos court : un repos trop bref réduit le nombre de répétitions à la série suivante, donc le volume total, qui est justement le moteur de l'hypertrophie." },
      secondaire: { series: 4, reps: [8, 12], rpe: [8, 9], repos: 120, intensite: [65, 75], pourquoiRepos: "2 minutes : compromis entre densité de séance et maintien du volume." },
      accessoire: { series: 3, reps: [10, 20], rpe: [8, 10], repos: 75, intensite: [55, 70], pourquoiRepos: "60 à 90 s en isolation : la fatigue locale se dissipe vite et les séries longues peuvent aller à l'échec sans risque." },
      gainage: { series: 3, reps: [40, 60], rpe: [8, 9], repos: 60, unite: "s", pourquoiRepos: "60 s." },
    },
    conseils: [
      "Amplitude complète et contrôle de l'excentrique sur 2 à 3 secondes : l'allongement sous tension est un puissant stimulus.",
      "Varier les angles : un muscle n'est pas stimulé uniformément par un seul exercice.",
      "L'échec technique arrive avant l'échec musculaire — s'arrêter au premier.",
      "Le volume doit être progressif, pas maximal d'emblée : trop de volume trop tôt sature la récupération.",
    ],
    frequenceMouvement: "2 fois par semaine par groupe musculaire : meilleur compromis entre stimulus et récupération pour un volume donné. Cible 10 à 20 séries efficaces par groupe et par semaine.",
  },
  hybride: {
    nom: "Force / Hypertrophie", couleur: "jaune",
    logique: "Les deux qualités ne s'opposent pas, elles se nourrissent : un muscle plus gros a un potentiel de force supérieur, et une force plus élevée permet de manipuler des charges plus lourdes sur les séries d'hypertrophie, donc plus de tension mécanique. L'erreur classique est de tout mélanger dans chaque séance ; la bonne approche est de séparer les qualités dans le temps.",
    comparaison: "Dans la séance : mouvements principaux en mode force d'abord, accessoires en mode hypertrophie ensuite. Dans la semaine : jours lourds en début de semaine, jours volume quand la fatigue s'accumule. Dans le cycle : 3 à 4 semaines à dominante hypertrophie, puis 3 à 4 semaines à dominante force, puis décharge.",
    schemes: {
      principal: { series: 5, reps: [3, 5], rpe: [7, 8], repos: 210, intensite: [80, 88], pourquoiRepos: "3 à 4 minutes : le travail lourd exige un système nerveux frais et une restauration complète." },
      secondaire: { series: 4, reps: [6, 8], rpe: [8, 8], repos: 150, intensite: [70, 80], pourquoiRepos: "2 à 3 minutes : zone de recouvrement entre force et hypertrophie." },
      accessoire: { series: 4, reps: [10, 15], rpe: [8, 9], repos: 75, intensite: [55, 70], pourquoiRepos: "60 à 90 s : le rôle est d'ajouter du volume, pas de la charge." },
      gainage: { series: 3, reps: [40, 60], rpe: [8, 9], repos: 60, unite: "s", pourquoiRepos: "60 s." },
    },
    conseils: [
      "Sur un bloc donné, une qualité mène, l'autre entretient. Ne pas chercher à progresser sur tout en même temps.",
      "Le risque principal est la fatigue cumulée : la semaine de décharge n'est pas optionnelle dans un modèle hybride.",
      "Suivre séparément la progression de charge sur les mouvements clés et le volume par groupe musculaire.",
    ],
    frequenceMouvement: "Chaque groupe 2 fois par semaine, avec un jour lourd et un jour volume par moitié de corps.",
  },
  rando: {
    nom: "Randonnée / Endurance", couleur: "vert",
    logique: "La randonnée est un effort long, à intensité modérée, en terrain irrégulier, souvent avec charge et avec une composante excentrique majeure en descente. Les deux erreurs classiques : ne préparer que le cardio alors que ce sont les quadriceps et les genoux qui lâchent en descente, et ne jamais s'entraîner avec le sac.",
    comparaison: "Pourquoi mélanger séries lourdes et séries longues ? La force maximale abaisse le pourcentage d'effort que représente chaque pas ; l'endurance de force permet de répéter ce pas des milliers de fois. Les deux sont nécessaires.",
    schemes: {
      principal: { series: 4, reps: [5, 8], rpe: [7, 8], repos: 180, intensite: [72, 82], pourquoiRepos: "3 minutes : la force maximale reste la base sur laquelle repose l'endurance de force." },
      secondaire: { series: 3, reps: [10, 15], rpe: [8, 9], repos: 90, intensite: [55, 70], pourquoiRepos: "90 s : on cherche l'endurance de force, la fatigue partielle fait partie du stimulus." },
      accessoire: { series: 3, reps: [12, 20], rpe: [8, 9], repos: 60, intensite: [45, 60], pourquoiRepos: "60 s." },
      gainage: { series: 3, reps: [45, 60], rpe: [8, 9], repos: 45, unite: "s", pourquoiRepos: "45 s : le tronc doit apprendre à tenir longtemps, pas fort." },
    },
    conseils: [
      "L'excentrique de descente est l'entraînement le plus rentable pour éviter la souffrance en fin de rando — à introduire graduellement, il génère beaucoup de dommages musculaires.",
      "Ne pas augmenter le volume de plus de 10 % par semaine.",
      "Augmenter durée, puis dénivelé, puis charge — jamais les trois en même temps.",
      "Tester les chaussures, le sac et les chaussettes exacts avant l'échéance : les ampoules ruinent plus de randos que le manque de cardio.",
      "Placer le cardio intense à distance des séances de jambes, idéalement 6 h ou un jour séparé.",
    ],
    frequenceMouvement: "2 à 3 séances aérobies hebdomadaires en zone 2, plus 2 séances de force du bas du corps et une sortie longue.",
  },
};


/* Méthodes de structuration — ce qui distingue deux programmes qui contiennent
   pourtant les mêmes exercices. */
const METHODES = {
  standard: { nom: "Charge progressive", court: "Standard",
    quoi: "Chaque séance reprend la précédente et ajoute un peu de charge ou une répétition.",
    quand: "Le modèle par défaut, valable tant que la progression suit." },
  dup: { nom: "Ondulation quotidienne", court: "DUP",
    quoi: "Le même mouvement change de format d'une séance à l'autre dans la semaine : lourd, moyen, léger. Force et hypertrophie sont stimulées en parallèle plutôt qu'en blocs successifs.",
    quand: "Très efficace en hybride force-hypertrophie chez un pratiquant qui s'entraîne au moins quatre fois par semaine." },
  blocs: { nom: "Périodisation par blocs", court: "Blocs",
    quoi: "Trois à quatre semaines d'accumulation, puis autant d'intensification, puis une réalisation et une décharge. Une qualité mène, l'autre entretient.",
    quand: "Le modèle le plus solide sur le long terme, et le seul qui tienne quand une échéance est fixée." },
  vagues: { nom: "Progression par vagues", court: "Vagues",
    quoi: "Trois semaines de montée en intensité sur un mouvement principal, puis retour à un niveau supérieur au point de départ. Chaque cycle repart plus haut.",
    quand: "Sur les mouvements de force quand la progression linéaire s'est arrêtée." },
  antagonistes: { nom: "Séries antagonistes", court: "Antagonistes",
    quoi: "On alterne un mouvement et son opposé — pousser puis tirer — pendant les temps de repos. La densité de séance monte sans que la performance ne baisse.",
    quand: "Quand le temps manque : une séance de 45 minutes fait le travail d'une séance d'une heure." },
  circuit: { nom: "Circuit et densité", court: "Circuit",
    quoi: "Enchaînement de stations avec peu de repos, sur un format en temps plutôt qu'en séries. La composante cardiovasculaire devient significative.",
    quand: "En recomposition, en reprise, ou comme séance de complément. Ce n'est pas le meilleur format pour la force maximale." },
  autoregulation: { nom: "Autorégulation par RPE", court: "RPE",
    quoi: "La charge du jour dépend de la forme du jour, pas d'un pourcentage figé décidé trois semaines plus tôt.",
    quand: "Indispensable quand le sommeil, le stress ou le travail varient beaucoup d'une semaine à l'autre." },
  minimal: { nom: "Dose minimale efficace", court: "Minimal",
    quoi: "Deux à trois mouvements par séance, uniquement les plus rentables, en trente minutes.",
    quand: "Périodes de partiels, déplacements, semaines chargées. Mieux vaut un programme réduit tenu qu'un programme parfait abandonné." },
};



/* --------------------------------------------------------------------------
   Plan de recomposition corporelle
   Une suite de phases datées. La trajectoire est projetée semaine par semaine
   à partir de la vitesse propre à chaque phase et de la part réaliste de
   muscle dans le gain — qui dépend fortement de l'expérience d'entraînement.
   -------------------------------------------------------------------------- */

const TYPES_PHASE = {
  masse: { nom: "Prise de masse", couleur: "bleu", objNutri: "lean_bulk", signe: 1,
    vitesse: 0.375, quoi: "Surplus modéré, poids en hausse lente et contrôlée.",
    duree: "8 à 20 semaines. Au-delà, la part de gras dans la prise augmente nettement." },
  masseRapide: { nom: "Prise de masse rapide", couleur: "jaune", objNutri: "bulk_rapide", signe: 1,
    vitesse: 0.75, quoi: "Surplus marqué, prise plus rapide mais plus grasse.",
    duree: "8 à 12 semaines maximum, et seulement depuis un taux de gras bas." },
  seche: { nom: "Sèche", couleur: "rouge", objNutri: "seche", signe: -1,
    vitesse: -0.75, quoi: "Déficit modéré, protéines hautes, charges maintenues.",
    duree: "12 à 20 semaines. Au-delà, prévois une pause à la maintenance." },
  recomp: { nom: "Recomposition", couleur: "vert", objNutri: "recomp", signe: 0,
    vitesse: -0.05, quoi: "Maintien calorique, gain de muscle et perte de gras simultanés.",
    duree: "12 semaines et plus. Lent, mais réaliste chez un débutant ou en reprise." },
  maintien: { nom: "Maintien", couleur: "blanc", objNutri: "maintien", signe: 0,
    vitesse: 0, quoi: "Calories à la maintenance, priorité à la performance et à la récupération.",
    duree: "3 à 6 semaines. Obligatoire entre une sèche et une prise de masse." },
};

/* Part du gain de poids qui part en muscle, et part de la perte qui vient du
   gras. Les deux dépendent surtout de l'expérience d'entraînement. */
const PART_MUSCLE = { debutant: 0.62, intermediaire: 0.45, avance: 0.3 };
const PART_GRAS_PERDU = { debutant: 0.82, intermediaire: 0.87, avance: 0.9 };

function projeterPlan(profil, phases) {
  let poids = profil.poids;
  let mg = profil.mg && profil.mg > 3 ? profil.mg : (profil.sexe === "H" ? 20 : 30);
  let masseGrasse = (poids * mg) / 100;
  let maigre = poids - masseGrasse;
  const partM = PART_MUSCLE[profil.niveau] || 0.45;
  const partG = PART_GRAS_PERDU[profil.niveau] || 0.87;
  const points = [{ sem: 0, poids, mg, maigre, phase: null, date: new Date() }];
  const jalons = [];
  let semaine = 0;

  phases.forEach((ph, iph) => {
    const t = TYPES_PHASE[ph.type];
    const nbSem = Math.max(1, Math.round(ph.semaines));
    const vitesse = (ph.vitesse ?? t.vitesse) / 100; // fraction du poids par semaine
    for (let k = 0; k < nbSem; k++) {
      semaine++;
      const delta = poids * vitesse;
      if (delta > 0) { maigre += delta * partM; masseGrasse += delta * (1 - partM); }
      else if (delta < 0) { masseGrasse += delta * partG; maigre += delta * (1 - partG); }
      else if (t.objNutri === "recomp") { maigre += poids * 0.0012; masseGrasse -= poids * 0.0017; }
      // La projection ne descend jamais sous le plancher de sécurité : au-delà,
      // le modèle ne décrit plus rien de souhaitable, et la trajectoire
      // laisserait croire qu'un tel niveau se planifie comme les autres.
      const plancherProj = (MG_PLANCHER[profil.sexe] || 8) / 100;
      masseGrasse = Math.max(masseGrasse, plancherProj * (maigre + masseGrasse));
      poids = maigre + masseGrasse;
      mg = (masseGrasse / poids) * 100;
      const d = new Date(); d.setDate(d.getDate() + semaine * 7);
      points.push({ sem: semaine, poids: Math.round(poids * 10) / 10, mg: Math.round(mg * 10) / 10,
        maigre: Math.round(maigre * 10) / 10, phase: ph.type, date: d });
    }
    const fin = points[points.length - 1];
    jalons.push({ phase: ph, index: iph, semaineFin: semaine, ...fin });
  });

  // Alertes : ce que le plan a de discutable, dit avant de le lancer.
  const alertes = [];
  const plancher = MG_PLANCHER[profil.sexe] || 8;
  const mgMin = Math.min(...points.map((p) => p.mg));
  if (mgMin < plancher) alertes.push({ n: "danger", t: `Le plan descend à ${mgMin.toFixed(1)} % de masse grasse, sous le plancher de sécurité de ${plancher} % pour ton sexe. En dessous, les perturbations hormonales et la fragilité osseuse deviennent la règle plutôt que l'exception. Raccourcis la phase de sèche ou vise un taux plus haut.` });
  phases.forEach((ph) => {
    if (ph.type === "seche" && ph.semaines > 20) alertes.push({ n: "attention", t: `Une sèche de ${ph.semaines} semaines sans interruption est très longue. Coupe-la par deux à trois semaines à la maintenance : la fatigue et la faim s'accumulent plus vite que les résultats.` });
    if (ph.type === "masseRapide" && ph.semaines > 12) alertes.push({ n: "attention", t: "Une prise de masse rapide au-delà de douze semaines produit surtout du gras à reperdre ensuite." });
  });
  for (let i = 1; i < phases.length; i++) {
    if (phases[i - 1].type === "seche" && (phases[i].type === "masse" || phases[i].type === "masseRapide")) {
      alertes.push({ n: "attention", t: "Passer directement d'une sèche à une prise de masse favorise une reprise de gras rapide. Intercale trois à quatre semaines de maintien : le métabolisme et l'appétit ont besoin de se recaler." });
    }
  }
  const dernier = points[points.length - 1];
  return { points, jalons, alertes, depart: points[0], arrivee: dernier, semaines: semaine };
}

/* Propose une suite de phases à partir d'une cible et d'une échéance.
   Le temps disponible ne dicte pas la durée de la sèche : celle-ci est
   dimensionnée pour atteindre la cible, et le reste part en maintien. Sans
   cette règle, un horizon large produisait une sèche qui dépassait la cible
   et descendait sous le plancher de sécurité. */
function proposerPlan(profil, cibleMG, moisDispo) {
  const mg0 = profil.mg && profil.mg > 3 ? profil.mg : (profil.sexe === "H" ? 20 : 30);
  const semDispo = Math.max(4, Math.round(moisDispo * 4.33));
  const plancher = MG_PLANCHER[profil.sexe] || 8;
  const cible = Math.max(cibleMG, plancher);

  // Une sèche est plafonnée à vingt semaines : au-delà, la fatigue et la faim
  // s'accumulent plus vite que les résultats. Sur un horizon long, on enchaîne
  // donc plusieurs blocs séparés par un retour à la maintenance, ce qui est
  // aussi la façon la plus solide de mener une perte de gras importante.
  const construire = (semMasse, semSeche) => {
    const ph = [];
    if (semMasse > 0) ph.push({ type: "masse", semaines: semMasse });
    if (semMasse > 0 && semSeche > 0) ph.push({ type: "maintien", semaines: 3 });
    let restantSeche = semSeche;
    while (restantSeche > 0) {
      const bloc = Math.min(restantSeche, 20);
      ph.push({ type: "seche", semaines: bloc });
      restantSeche -= bloc;
      if (restantSeche > 0) ph.push({ type: "maintien", semaines: 3 });
    }
    let utilise = ph.reduce((acc, x) => acc + x.semaines, 0);
    // Les maintiens insérés entre deux blocs peuvent faire déborder l'horizon :
    // on rogne alors la dernière phase pour tenir dans le calendrier demandé.
    while (utilise > semDispo && ph.length) {
      const trop = utilise - semDispo;
      const der = ph[ph.length - 1];
      if (der.semaines - trop >= 1) { der.semaines -= trop; utilise -= trop; }
      else { utilise -= der.semaines; ph.pop(); }
    }
    if (semDispo > utilise) ph.push({ type: "maintien", semaines: semDispo - utilise });
    return ph.filter((x) => x.semaines >= 1);
  };
  const mgFinale = (ph) => projeterPlan(profil, ph).arrivee.mg;

  if (Math.abs(cible - mg0) <= 1) return [{ type: "recomp", semaines: semDispo }];

  if (cible > mg0 + 1) {
    // Prise de masse : on s'arrête dès que la cible est atteinte.
    let masse = Math.min(semDispo, 20);
    while (masse > 4 && mgFinale(construire(masse, 0)) > cible + 0.5) masse -= 1;
    return construire(masse, 0);
  }

  // Perte de gras. On garde d'abord de la place pour construire si l'horizon
  // le permet, puis on ajuste la sèche jusqu'à tomber sur la cible.
  const margeConstruction = semDispo >= 30 ? Math.min(Math.round(semDispo * 0.35), 18) : 0;
  let masse = margeConstruction;
  let seche = Math.max(1, semDispo - masse - (masse > 0 ? 3 : 0));
  let garde = 0;
  while (seche > 3 && mgFinale(construire(masse, seche)) < cible - 0.4 && garde++ < 40) seche -= 1;
  garde = 0;
  while (seche + masse + (masse > 0 ? 3 : 0) < semDispo
         && mgFinale(construire(masse, seche)) > cible + 0.6 && garde++ < 40) seche += 1;
  // Si même la sèche maximale ne suffit pas, on réduit la phase de construction.
  garde = 0;
  while (masse > 0 && mgFinale(construire(masse, seche)) > cible + 1.5 && garde++ < 20) {
    masse -= 2;
    seche = Math.max(1, semDispo - Math.max(masse, 0) - (masse > 0 ? 3 : 0));
  }
  return construire(Math.max(masse, 0), Math.max(seche, 1));
}

/* --------------------------------------------------------------------------
   Semainier de menus et budget de courses
   -------------------------------------------------------------------------- */

function coutRecette(rec, foods) {
  return rec.ing.reduce((s, [nom, g]) => {
    const f = resoudreIngredient(nom, foods);
    return s + prixDe(f ? f.nom : nom, g);
  }, 0);
}

function genererSemaine(profil, obj, foods, graine = 0) {
  const dispo = recettesCompatibles(profil);
  const par = (m) => dispo.filter((r) => r.moment === m);
  const pool = { petitdej: par("petitdej"), dej: par("dej"), diner: par("diner"), collation: par("collation") };
  Object.keys(pool).forEach((k) => { if (!pool[k].length) pool[k] = dispo; });
  const JOURS_SEM = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  const choisir = (m, i) => {
    const l = pool[m];
    // Rotation décalée : on évite de servir deux fois le même plat de suite.
    const idx = (i * 2 + graine + (m === "dej" ? 1 : m === "diner" ? 3 : 0)) % l.length;
    return l[idx];
  };
  const jours = JOURS_SEM.map((nom, i) => {
    const repas = ["petitdej", "dej", "diner", "collation"].map((m) => {
      const r = choisir(m, i);
      return { moment: m, recette: r, nut: nutritionRecette(r, foods), cout: coutRecette(r, foods) };
    });
    const tot = repas.reduce((a, x) => ({
      kcal: a.kcal + x.nut.kcal, prot: a.prot + x.nut.prot, gluc: a.gluc + x.nut.gluc,
      lip: a.lip + x.nut.lip, fibres: a.fibres + x.nut.fibres, cout: a.cout + x.cout,
    }), { kcal: 0, prot: 0, gluc: 0, lip: 0, fibres: 0, cout: 0 });
    // Ajustement d'échelle : on adapte les portions à la cible du jour plutôt
    // que de proposer un menu qui tomberait à côté de plusieurs centaines de kcal.
    const facteur = tot.kcal > 0 ? Math.max(0.6, Math.min(1.6, obj.kcal / tot.kcal)) : 1;
    return { nom, repas, tot, facteur: Math.round(facteur * 100) / 100 };
  });
  const coutSemaine = jours.reduce((s, j) => s + j.tot.cout * j.facteur, 0);
  // Liste de courses agrégée sur les sept jours
  const panier = {};
  jours.forEach((j) => j.repas.forEach((r) => r.recette.ing.forEach(([nom, g]) => {
    const f = resoudreIngredient(nom, foods);
    const cle = f ? f.nom : nom;
    panier[cle] = (panier[cle] || 0) + g * j.facteur;
  })));
  const courses = Object.entries(panier)
    .map(([nom, g]) => ({ nom, g: Math.round(g), prix: prixDe(nom, g) }))
    .sort((a, b) => b.prix - a.prix);
  return { jours, coutSemaine, courses, coutJour: coutSemaine / 7 };
}

/* ==========================================================================
   TECHNIQUES D'INTENSIFICATION
   Elles augmentent la difficulté d'une série sans ajouter de charge. Toutes
   coûtent en récupération : c'est pour cela qu'elles se placent en fin de
   séance, sur les mouvements les moins risqués, et jamais partout à la fois.
   ========================================================================== */

const TECHNIQUES = {
  dropset: {
    nom: "Série dégressive", court: "Dégressive", couleur: "rouge", niveauMin: 2, preuve: "probable",
    quoi: "Tu vas jusqu'à l'échec technique, tu baisses immédiatement la charge d'environ 25 %, tu repars sans repos. Deux ou trois paliers.",
    pourquoi: "Quand les fibres les plus puissantes lâchent, baisser la charge permet de continuer à recruter celles qui restent. On prolonge le temps passé près de l'échec sans allonger la série initiale.",
    quand: "Sur la dernière série d'un exercice d'isolation ou de machine. Jamais sur un squat ou un soulevé lourd : l'échec y est dangereux.",
    cout: "Élevé. Une à deux dégressives par séance suffisent, sur un seul groupe.",
    notation: "12 réps puis 5 + 5 + 5 en baissant la charge à chaque palier",
  },
  restpause: {
    nom: "Rest-pause", court: "Rest-pause", couleur: "jaune", niveauMin: 2, preuve: "probable",
    quoi: "Tu termines ta série, tu reposes la charge 10 à 20 secondes, puis tu repars pour un maximum de répétitions avec la même charge.",
    pourquoi: "Ces quelques secondes suffisent à restaurer une partie de la phosphocréatine, assez pour arracher des répétitions supplémentaires à charge constante. Le volume effectif de la série augmente sans baisser l'intensité.",
    quand: "Sur les mouvements guidés ou les haltères, en fin de séance. Excellent quand le temps manque.",
    cout: "Élevé sur le système nerveux. Une à deux séries par séance.",
    notation: "9 réps, 10 s de repos, puis 10 réps de plus avec la même charge",
  },
  superset: {
    nom: "Superset antagoniste", court: "Superset", couleur: "bleu", niveauMin: 1, preuve: "solide",
    quoi: "Deux exercices opposés enchaînés sans repos : une poussée puis un tirage, un biceps puis un triceps.",
    pourquoi: "Pendant que l'agoniste travaille, l'antagoniste récupère. La densité de séance monte fortement sans que la performance sur chaque exercice ne baisse — c'est le seul enchaînement dont le coût sur la charge est quasi nul.",
    quand: "Partout, y compris chez un débutant. C'est la technique la plus rentable quand le temps manque.",
    cout: "Faible. Peut être utilisé sur toute une séance.",
    notation: "Développé couché puis rowing, sans repos entre les deux",
  },
  biset: {
    nom: "Bi-set agoniste", court: "Bi-set", couleur: "bleu", niveauMin: 2, preuve: "probable",
    quoi: "Deux exercices du même muscle enchaînés sans repos, généralement un polyarticulaire puis une isolation.",
    pourquoi: "Le second exercice attaque le muscle déjà fatigué sous un angle différent : le stress métabolique monte fortement. C'est un levier d'hypertrophie, pas de force.",
    quand: "En fin de séance sur un groupe en retard.",
    cout: "Élevé. La charge du second exercice chute nettement, c'est normal.",
    notation: "Développé incliné puis écarté incliné, enchaînés",
  },
  triset: {
    nom: "Tri-set", court: "Tri-set", couleur: "rouge", niveauMin: 3, preuve: "debat",
    quoi: "Trois exercices du même groupe enchaînés sans repos.",
    pourquoi: "Poussé à l'extrême, le principe du bi-set. La congestion est maximale, mais la charge s'effondre sur le troisième mouvement.",
    quand: "Réservé aux blocs de spécialisation, sur une durée limitée.",
    cout: "Très élevé. Une seule fois par séance, sur un seul groupe.",
    notation: "Trois exercices d'épaules enchaînés, une seule fois en fin de séance",
  },
  serieLongue: {
    nom: "Série longue", court: "Série longue", couleur: "vert", niveauMin: 1, preuve: "solide",
    quoi: "Vingt à trente répétitions à charge légère, jusqu'à l'échec.",
    pourquoi: "À condition d'aller réellement près de l'échec, une série longue à charge légère produit une hypertrophie comparable à une série lourde. Ce qui compte est la proximité de l'échec, pas la charge absolue.",
    quand: "Sur les mollets, les avant-bras, les épaules latérales, ou quand une articulation ne tolère plus le lourd.",
    cout: "Modéré sur le système nerveux, très inconfortable localement.",
    notation: "1 série de 25 répétitions jusqu'à l'échec technique",
  },
  excentriqueAccentue: {
    nom: "Excentrique accentué", court: "Excentrique", couleur: "rouge", niveauMin: 2, preuve: "solide",
    quoi: "La phase de descente est allongée à 3, 4 ou 5 secondes, la remontée reste normale.",
    pourquoi: "Le muscle produit plus de force en s'allongeant qu'en se raccourcissant. Allonger l'excentrique augmente le temps sous tension et les micro-lésions qui déclenchent l'adaptation — c'est aussi ce qui protège le mieux contre les courbatures futures.",
    quand: "Sur les mouvements contrôlables. Très efficace pour apprendre un mouvement, et pour préparer les descentes en randonnée.",
    cout: "Courbatures marquées les premières séances. Introduire progressivement.",
    notation: "Descente en 4 secondes, pause, remontée normale",
  },
  pause: {
    nom: "Série avec pause", court: "Pause", couleur: "craie", niveauMin: 2, preuve: "solide",
    quoi: "Un à trois secondes d'arrêt complet en position basse, sans relâcher le gainage.",
    pourquoi: "La pause dissipe l'énergie élastique accumulée à la descente : la remontée part d'un arrêt total. On renforce précisément la portion la plus faible du mouvement.",
    quand: "Sur le squat, le développé couché, le soulevé. Idéal pour corriger un point de blocage.",
    cout: "Modéré. La charge baisse d'environ 10 %, c'est attendu.",
    notation: "5 séries de 3 répétitions avec 2 secondes d'arrêt en bas",
  },
  preFatigue: {
    nom: "Pré-fatigue", court: "Pré-fatigue", couleur: "jaune", niveauMin: 2, preuve: "debat",
    quoi: "Une isolation du muscle cible avant le polyarticulaire.",
    pourquoi: "L'idée est que le muscle visé devienne le facteur limitant plutôt que le triceps ou l'avant-bras. Les mesures d'activation ne confirment pas toujours ce transfert, et la charge du polyarticulaire chute nettement : le bilan reste discuté.",
    quand: "Quand un muscle ne se sent jamais travailler sur son polyarticulaire, malgré une technique correcte.",
    cout: "La charge du mouvement principal baisse. À réserver aux séances de volume, jamais aux séances lourdes.",
    notation: "Écarté puis développé couché",
  },
  myoreps: {
    nom: "Myo-reps", court: "Myo-reps", couleur: "bleu", niveauMin: 3, preuve: "probable",
    quoi: "Une série d'activation près de l'échec, puis des mini-séries de 3 à 5 répétitions séparées de 5 secondes de repos.",
    pourquoi: "La série d'activation recrute déjà toutes les unités motrices ; les mini-séries suivantes maintiennent ce recrutement maximal avec très peu de répétitions inutiles. C'est le rapport stimulus sur temps le plus favorable.",
    quand: "En fin de séance, sur des exercices guidés, chez un pratiquant qui sait juger sa proximité de l'échec.",
    cout: "Élevé. Un seul exercice par séance.",
    notation: "12 réps puis 4 mini-séries de 4 réps espacées de 5 secondes",
  },
};

/* Tempo — la notation est excentrique / pause basse / concentrique, en secondes */
const TEMPOS = {
  force: { code: "2-1-X", texte: "Descente contrôlée en 2 secondes, arrêt d'une seconde, remontée la plus explosive possible.", pourquoi: "L'intention d'accélérer, même si la barre monte lentement, est ce qui recrute les fibres rapides. La pause supprime le rebond et force un démarrage en force pure." },
  hypertrophie: { code: "3-0-1", texte: "Descente en 3 secondes, pas d'arrêt, remontée en 1 seconde.", pourquoi: "L'allongement sous tension est le stimulus le plus rentable en hypertrophie. Trois secondes de descente doublent le temps sous tension par rapport à une série lâchée." },
  isolation: { code: "2-1-1", texte: "Descente en 2 secondes, contraction tenue une seconde en fin de course, remontée normale.", pourquoi: "Sur une isolation, la position raccourcie est celle où le muscle est le plus difficile à charger : la tenir une seconde compense." },
  excentrique: { code: "4-0-1", texte: "Descente en 4 secondes, remontée normale.", pourquoi: "Régime le plus efficace pour préparer les descentes en montagne et pour renforcer un tendon." },
  cardio: { code: "—", texte: "Rythme régulier, respiration contrôlée.", pourquoi: "" },
};

function techniquesPour(role, objectif, niveau, exercice) {
  const rang = { debutant: 1, intermediaire: 2, avance: 3 }[niveau] || 2;
  const sortie = [];
  const guide = exercice && ["machine", "poulie", "halteres"].includes(exercice.materiel);
  const iso = exercice && exercice.type === "iso";
  if (role === "principal") {
    if (objectif === "force" || objectif === "hybride") sortie.push("pause");
    if (objectif === "rando") sortie.push("excentriqueAccentue");
  }
  if (role === "secondaire" && rang >= 2) sortie.push("superset");
  if (role === "accessoire") {
    if (rang >= 3 && guide) sortie.push("myoreps");
    if (rang >= 2 && (iso || guide)) sortie.push("dropset", "restpause");
    if (rang >= 1) sortie.push("superset");
    if (iso) sortie.push("serieLongue");
  }
  return [...new Set(sortie)].filter((t) => rang >= TECHNIQUES[t].niveauMin).slice(0, 3);
}

function tempoPour(role, objectif) {
  if (objectif === "rando" && role === "principal") return TEMPOS.excentrique;
  if (role === "principal") return objectif === "force" || objectif === "hybride" ? TEMPOS.force : TEMPOS.hypertrophie;
  if (role === "accessoire" || role === "gainage") return TEMPOS.isolation;
  return TEMPOS.hypertrophie;
}

/* ==========================================================================
   CARDIO, COMPLÉMENTS, IDÉES REÇUES
   ========================================================================== */

const ZONES_CARDIO = [
  { id: "z2", nom: "Zone 2 — fondamentale", pct: "60 à 70 % de la FC max", couleur: "vert",
    duree: "30 à 60 minutes", freq: "2 à 4 fois par semaine",
    quoi: "Intensité à laquelle une conversation reste possible. C'est la zone où la part des lipides dans le carburant est la plus élevée en proportion.",
    pourquoi: "Elle développe la densité mitochondriale et la capillarisation sans créer de fatigue qui empiéterait sur les séances de musculation. C'est aussi la seule zone qu'on peut accumuler en volume sans coût de récupération significatif.",
    attention: "La croyance qu'il faut rester en zone 2 pour brûler du gras confond proportion et quantité. À intensité plus haute, la part des lipides baisse mais la dépense totale monte. Ce qui décide de la perte de gras, c'est le bilan calorique sur la semaine, pas la zone." },
  { id: "seuil", nom: "Seuil", pct: "80 à 88 % de la FC max", couleur: "jaune",
    duree: "20 à 40 minutes en blocs", freq: "1 fois par semaine",
    quoi: "Effort soutenu où la conversation devient hachée. Blocs de 8 à 15 minutes.",
    pourquoi: "Repousse le point où le lactate s'accumule plus vite qu'il n'est éliminé. C'est ce qui permet de tenir une allure plus élevée plus longtemps.",
    attention: "Zone coûteuse en récupération : elle empiète sur les séances de jambes." },
  { id: "hiit", nom: "Intervalles courts", pct: "90 % et plus de la FC max", couleur: "rouge",
    duree: "15 à 25 minutes en tout", freq: "1 à 2 fois par semaine maximum",
    quoi: "Efforts de 20 à 60 secondes proches du maximum, avec récupération complète entre les répétitions.",
    pourquoi: "C'est le moyen le plus efficace d'élever le VO2 max, principal déterminant de la capacité aérobie chez un sujet déjà entraîné.",
    attention: "Le HIIT ne fait pas fondre le gras plus vite qu'un déficit calorique équivalent : l'effet d'après-combustion représente en réalité quelques dizaines de calories, pas des centaines. Son intérêt réel est cardiovasculaire et gain de temps. À éviter en cas de pathologie cardiaque non évaluée, et à limiter en surpoids important à cause de la contrainte articulaire." },
];

const REGLES_CARDIO = [
  { r: "Place le cardio intense à distance des séances de jambes", d: "Idéalement six heures d'écart, ou un jour séparé. C'est l'effet d'interférence : un cardio intense juste avant ou après réduit la qualité de la séance de force." },
  { r: "Le cardio à jeun n'a pas d'avantage démontré", d: "La perte de gras sur 24 heures est identique à jeun ou non, à déficit égal. Si tu le supportes bien, fais-le ; sinon, ne t'impose rien." },
  { r: "N'augmente pas le cardio pour compenser un écart alimentaire", d: "C'est le mécanisme le plus fréquent de dérive vers la compensation. La correction se fait sur la moyenne de la semaine, calmement." },
  { r: "En sèche, le cardio complète le déficit, il ne le crée pas", d: "Si tu as besoin de plus d'une heure de cardio par jour pour tenir ton déficit, c'est l'apport calorique qui est mal réglé." },
];

const COMPLEMENTS = [
  { nom: "Créatine monohydrate", preuve: "solide", couleur: "vert", dose: "3 à 5 g par jour, à n'importe quel moment",
    quoi: "Le complément le mieux documenté de toute la nutrition sportive, et de loin. Il augmente les stocks de phosphocréatine, donc le nombre de répétitions disponibles sur les efforts courts et intenses.",
    verdict: "Utile. C'est celui à prendre si tu n'en prends qu'un.",
    reserve: "Pas de phase de charge nécessaire. La prise de poids initiale d'un à deux kilos est de l'eau intramusculaire, pas du gras." },
  { nom: "Protéine en poudre", preuve: "solide", couleur: "vert", dose: "Selon ce qui manque pour atteindre ta cible",
    quoi: "Un aliment pratique, pas un produit magique. Sa seule fonction est de t'aider à atteindre ton total protéique quotidien.",
    verdict: "Utile si tu n'atteins pas ta cible autrement. Inutile si tu y arrives avec des aliments solides.",
    reserve: "Aucun avantage sur la viande, les œufs ou le poisson à quantité de protéines égale." },
  { nom: "Caféine", preuve: "solide", couleur: "vert", dose: "3 à 6 mg par kg, 45 à 60 minutes avant",
    quoi: "Améliore réellement la performance en force et en endurance, et réduit la perception de l'effort.",
    verdict: "Utile, avec des limites nettes.",
    reserve: "Demi-vie d'environ cinq heures : une prise après 16 h dégrade la profondeur du sommeil, ce qui coûte plus que le gain de séance. La tolérance s'installe en quelques semaines." },
  { nom: "Oméga-3 EPA et DHA", preuve: "probable", couleur: "jaune", dose: "1 à 2 g d'EPA et DHA combinés",
    quoi: "Bénéfices établis sur l'inflammation et la santé cardiovasculaire, probables sur la récupération.",
    verdict: "Utile, surtout si tu manges peu de poisson gras.",
    reserve: "Au-delà de 3 g par jour, l'intérêt supplémentaire n'est pas démontré et le risque de saignement augmente." },
  { nom: "Vitamine D", preuve: "probable", couleur: "jaune", dose: "Selon dosage sanguin, souvent 1000 à 2000 UI en hiver",
    quoi: "Le déficit est très fréquent en France d'octobre à avril. Corriger un déficit réel améliore la fonction musculaire et osseuse.",
    verdict: "Utile en cas de déficit avéré, inutile sinon.",
    reserve: "Liposoluble donc cumulative : un surdosage prolongé est toxique. Fais doser avant." },
  { nom: "BCAA", preuve: "debat", couleur: "rouge", dose: "—",
    quoi: "Trois acides aminés isolés sur les vingt nécessaires à la synthèse protéique.",
    verdict: "Inutile dès lors que l'apport protéique quotidien est atteint. Les travaux récents montrent que des acides aminés incomplets ne soutiennent pas la synthèse musculaire.",
    reserve: "Un des produits les plus vendus et les moins justifiés du marché." },
  { nom: "Glutamine", preuve: "debat", couleur: "rouge", dose: "—",
    quoi: "Acide aminé abondant, présenté comme soutien immunitaire et de récupération.",
    verdict: "Aucun effet démontré sur la performance, la masse musculaire ou la récupération chez le sujet sain qui mange assez.",
    reserve: "Un intérêt existe en milieu clinique, chez le grand brûlé ou le patient dénutri. Ce n'est pas ton cas." },
  { nom: "L-carnitine", preuve: "debat", couleur: "rouge", dose: "—",
    quoi: "Vendue comme transporteur des acides gras vers la mitochondrie, donc comme accélérateur de perte de gras.",
    verdict: "La supplémentation orale n'augmente pas significativement la carnitine musculaire chez le sujet sain. Aucun effet fiable sur la perte de gras.",
    reserve: "Le raisonnement biochimique est juste, la conclusion pratique ne suit pas." },
  { nom: "Brûleurs de graisse", preuve: "debat", couleur: "rouge", dose: "—",
    quoi: "Mélanges de caféine, extraits végétaux et thermogéniques divers.",
    verdict: "L'essentiel de leur effet mesurable vient de la caféine qu'ils contiennent. Le reste ne dépasse pas quelques calories par jour.",
    reserve: "Segment peu régulé, avec des cas documentés d'atteintes hépatiques. Il n'existe pas d'aliment ni de gélule qui brûle du gras : seul le déficit calorique le fait." },
];

const IDEES_RECUES = [
  { faux: "Les aliments brûle-graisse font maigrir", vrai: "Le citron, l'ananas, le pamplemousse ou le céleri ne brûlent rien. Ils sont peu caloriques et rassasiants, ce qui aide à tenir un déficit — mais c'est le déficit qui fait perdre du gras, pas l'aliment." },
  { faux: "Il faut faire des séries longues et légères pour sécher", vrai: "C'est l'erreur la plus coûteuse en sèche. La charge lourde est le signal qui dit au corps de garder le muscle. En déficit, on maintient l'intensité et on réduit éventuellement le volume, jamais l'inverse." },
  { faux: "On peut cibler la perte de gras sur le ventre", vrai: "La répartition de la perte est déterminée par la génétique et les hormones, pas par les exercices choisis. Mille abdominaux ne creusent pas la taille." },
  { faux: "Les glucides le soir font grossir", vrai: "Aucune donnée ne soutient cela à apport calorique égal. Placer les glucides le soir améliore même souvent le sommeil et la satiété." },
  { faux: "La fenêtre anabolique dure trente minutes", vrai: "Elle est bien plus large que ce qu'on disait dans les années 2000 : plusieurs heures. Le total quotidien pèse beaucoup plus lourd que le minutage." },
  { faux: "Transpirer beaucoup signifie brûler plus", vrai: "La transpiration régule la température, elle ne mesure pas la dépense. Le poids perdu à la sortie d'un sauna est de l'eau." },
  { faux: "Les protéines abîment les reins", vrai: "Aucune atteinte démontrée chez le sujet aux reins sains, jusqu'à des apports élevés. En cas d'insuffisance rénale connue, c'est différent et cela relève du médecin." },
  { faux: "Il faut aller à l'échec à chaque série", vrai: "S'entraîner proche de l'échec produit un stimulus quasi identique pour une fatigue nettement moindre. Réserve l'échec aux séries d'isolation en fin de séance." },
];

/* Équivalences alimentaires : remplacer un aliment par un autre à apport comparable */
function equivalences(food, grammes, foods, cle = "auto") {
  const critere = cle === "auto"
    ? (food.prot >= 12 ? "prot" : food.gluc >= 15 ? "gluc" : food.lip >= 15 ? "lip" : "kcal")
    : cle;
  const cible = (food[critere] * grammes) / 100;
  if (cible <= 0) return { critere, liste: [] };
  const memeFamille = (f) => {
    if (critere === "prot") return ["prot", "vege", "lait"].includes(f.cat) && f.prot >= 8;
    if (critere === "gluc") return ["fec", "fru"].includes(f.cat) && f.gluc >= 10;
    if (critere === "lip") return ["gras", "olea"].includes(f.cat) && f.lip >= 10;
    return f.cat === food.cat;
  };
  const liste = foods.filter((f) => f.nom !== food.nom && memeFamille(f)).map((f) => {
    const g = Math.round((cible * 100) / f[critere]);
    // Plage de plausibilité : une équivalence de 400 g de fromage blanc
    // est juste mathématiquement mais inutilisable à table.
    if (g < 15 || g > 350) return null;
    return { f, g, kcal: Math.round((f.kcal * g) / 100), prot: Math.round((f.prot * g) / 100),
      gluc: Math.round((f.gluc * g) / 100), lip: Math.round((f.lip * g) / 100) };
  }).filter(Boolean);
  const kcalRef = (food.kcal * grammes) / 100;
  liste.sort((a, b) => Math.abs(a.kcal - kcalRef) - Math.abs(b.kcal - kcalRef));
  return { critere, cible: Math.round(cible), kcalRef: Math.round(kcalRef), liste: liste.slice(0, 8) };
}
const LABEL_CRITERE = { prot: "protéines", gluc: "glucides", lip: "lipides", kcal: "calories" };

/* Plan de journée : placement des repas selon l'heure d'entraînement */
function planJournee(profil, obj) {
  const h = profil.horaireSeance || "soir";
  const seances = {
    matin: { seance: "7 h 30", repas: [
      ["6 h 00", "Repas d'avant-séance — léger", "Glucides digestes et une source de protéines, une heure trente avant si tu le tolères. Si tu ne digères pas au réveil, entraîne-toi à jeun : à apport quotidien égal, la différence sur la journée est marginale."],
      ["9 h 00", "Repas post-séance", "Le plus gros apport en glucides de la journée, avec 30 à 40 g de protéines. C'est le moment où le glycogène se reconstitue le plus vite."],
      ["13 h 00", "Déjeuner", "Repas complet, glucides à index bas ou modéré pour une énergie stable l'après-midi."],
      ["16 h 30", "Collation", "30 g de protéines pour franchir à nouveau le seuil de leucine."],
      ["20 h 00", "Dîner", "Protéines, légumes, lipides. Les glucides restants passent ici sans problème."]] },
    midi: { seance: "12 h 30", repas: [
      ["7 h 30", "Petit-déjeuner", "Protéines et glucides à index bas ou modéré : avoine, pain complet, œufs."],
      ["10 h 30", "Repas d'avant-séance", "Deux heures avant, digeste, glucides modérés."],
      ["14 h 00", "Repas post-séance", "Apport glucidique principal, 30 à 40 g de protéines."],
      ["17 h 30", "Collation", "Prise protéique intermédiaire."],
      ["20 h 30", "Dîner", "Repas complet, plus léger en glucides."]] },
    soir: { seance: "18 h 30", repas: [
      ["7 h 30", "Petit-déjeuner", "Protéines et glucides à libération lente pour tenir la matinée."],
      ["12 h 30", "Déjeuner", "Repas complet et copieux : il alimente la séance du soir."],
      ["16 h 30", "Repas d'avant-séance", "Deux heures avant, glucides digestes et protéines, peu de lipides et de fibres pour ne pas alourdir la digestion."],
      ["19 h 45", "Repas post-séance", "Le plus gros apport glucidique, 30 à 40 g de protéines."],
      ["22 h 00", "Collation légère", "Facultative. Une source protéique lente si le dîner était tôt."]] },
  };
  const plan = seances[h];
  return { ...plan, principe: "Les prises protéiques sont espacées de trois à quatre heures : le temps que la synthèse protéique retombe et qu'un nouveau repas puisse relancer le signal. Les glucides sont concentrés autour de la séance, là où ils servent réellement.",
    hydratation: Math.round((profil.poids * 35 + (profil.frequence >= 4 ? 700 : 400)) / 100) / 10 };
}


/* Splits — le split découle de la fréquence et de l'objectif, jamais l'inverse */
const SPLITS = [
  { id: "fb2", freq: 2, nom: "Full body A/B", methode: "standard", objectifs: ["force", "hypertrophie", "hybride", "rando"], pourquoi: "Seule option cohérente à 2 séances : elle permet de stimuler chaque groupe musculaire 2 fois par semaine.", jours: ["fbA", "fbB"] },
  { id: "min2", freq: 2, nom: "Express — dose minimale", methode: "minimal", objectifs: ["force", "hybride", "maintien"], pourquoi: "Trois mouvements par séance, trente minutes. Conçu pour les semaines où le programme normal serait abandonné : mieux vaut peu et régulier que parfait et absent.", jours: ["express", "express"] },
  { id: "fb3", freq: 3, nom: "Full body A/B/C", methode: "standard", objectifs: ["force", "hybride", "rando"], pourquoi: "Le standard à 3 séances : fréquence maximale sur les mouvements clés, excellent pour la force.", jours: ["fbA", "fbB", "fbC"] },
  { id: "fbdup3", freq: 3, nom: "Full body ondulatoire", methode: "dup", objectifs: ["hybride", "force", "hypertrophie"], pourquoi: "Séance lourde, séance moyenne, séance légère sur les mêmes mouvements. Gère la fatigue tout en gardant une fréquence élevée, et stimule force et volume en parallèle.", jours: ["fbA", "fbB", "fbC"] },
  { id: "ppl3", freq: 3, nom: "Push / Pull / Legs", methode: "standard", objectifs: ["hypertrophie"], pourquoi: "Possible, mais chaque groupe n'est stimulé qu'une fois par semaine — moins optimal pour l'hypertrophie qu'un full body à cette fréquence.", jours: ["push", "pull", "legs"] },
  { id: "hbf3", freq: 3, nom: "Haut / Bas / Full", methode: "standard", objectifs: ["hybride", "hypertrophie"], pourquoi: "Bon compromis : deux séances spécialisées plus une séance de rattrapage global.", jours: ["hautLourd", "basLourd", "fbC"] },
  { id: "tbj3", freq: 3, nom: "Torse / Bras / Jambes", methode: "standard", objectifs: ["hypertrophie", "hybride"], pourquoi: "Sépare les bras du torse : ils reçoivent une séance dédiée au lieu d'arriver épuisés en fin de séance de dos. Utile quand les bras sont le point faible.", jours: ["torse", "brasJour", "jambes"] },
  { id: "circ3", freq: 3, nom: "Circuit métabolique", methode: "circuit", objectifs: ["recomp", "maintien", "rando"], pourquoi: "Six stations enchaînées avec peu de repos. La dépense énergétique et la composante cardiovasculaire montent nettement, au prix d'un stimulus de force plus faible.", jours: ["circuit", "circuit", "circuit"] },
  { id: "street3", freq: 3, nom: "Street workout — poids du corps", methode: "standard", objectifs: ["force", "hybride"], pourquoi: "Construit autour de la traction, du dips et du squat unilatéral. Aucune machine, une barre suffit : le rapport force sur poids devient l'indicateur principal.", jours: ["streetHaut", "streetBas", "streetHaut"] },
  { id: "rando3", freq: 3, nom: "Rando — base minimale", methode: "blocs", objectifs: ["rando"], pourquoi: "Une séance aérobie, une séance de force du bas, une sortie longue. Le socle irréductible d'une préparation à la marche en montagne.", jours: ["z2", "basRando", "sortie"] },
  { id: "hb4", freq: 4, nom: "Half body — Haut/Bas ×2", methode: "standard", objectifs: ["hybride", "force", "hypertrophie"], pourquoi: "Sans doute le meilleur rapport efficacité sur récupération pour un objectif hybride : chaque groupe 2 fois par semaine, avec un jour lourd et un jour volume par moitié de corps.", jours: ["hautLourd", "basLourd", "hautVolume", "basVolume"] },
  { id: "uldup4", freq: 4, nom: "Haut / Bas ondulatoire", methode: "dup", objectifs: ["hybride", "force"], pourquoi: "Haut lourd, bas lourd, haut volume, bas volume, avec les répétitions qui ondulent d'une séance à l'autre sur les mêmes mouvements. Le format le plus efficace en hybride à quatre séances.", jours: ["hautLourd", "basLourd", "hautVolume", "basVolume"] },
  { id: "ppl4", freq: 4, nom: "Push / Pull / Legs + Upper", methode: "standard", objectifs: ["hypertrophie"], pourquoi: "PPL classique complété d'une quatrième séance sur les points faibles du haut du corps.", jours: ["push", "pull", "legs", "hautVolume"] },
  { id: "anta4", freq: 4, nom: "Antagonistes", methode: "antagonistes", objectifs: ["hypertrophie", "hybride"], pourquoi: "Pectoraux et dos dans la même séance, en alternant les séries pendant les repos. La densité monte : une séance de 45 minutes couvre ce qu'une séance classique fait en une heure.", jours: ["pecsDos", "jambes", "epaulesBras", "pecsDos"] },
  { id: "power4", freq: 4, nom: "Powerbuilding — un mouvement par séance", methode: "vagues", objectifs: ["force", "hybride"], pourquoi: "Chaque séance s'ouvre sur un mouvement de compétition traité en force par vagues, puis l'accessoire passe en hypertrophie. C'est la structure des programmes de force les plus éprouvés.", jours: ["focusSquat", "focusBench", "focusDeadlift", "focusPress"] },
  { id: "pp4", freq: 4, nom: "Push / Pull ×2", methode: "standard", objectifs: ["hypertrophie", "hybride"], pourquoi: "Découpe plus simple que le PPL : les jambes se répartissent entre les deux séances, chaque schéma moteur revient deux fois par semaine.", jours: ["push", "pull", "push", "pull"] },
  { id: "street4", freq: 4, nom: "Street workout ×2", methode: "standard", objectifs: ["force", "hybride"], pourquoi: "Haut et bas du corps deux fois chacun, au poids du corps. La progression se fait par variantes plus dures plutôt que par ajout de charge.", jours: ["streetHaut", "streetBas", "streetHaut", "streetBas"] },
  { id: "rando4", freq: 4, nom: "Rando — base + force + spécifique", methode: "blocs", objectifs: ["rando"], pourquoi: "Deux séances aérobies, une séance de force du bas, une sortie longue chargée : couvre les quatre composantes sans les empiler.", jours: ["z2", "basRando", "excentrique", "sortie"] },
  { id: "hbppl5", freq: 5, nom: "Haut / Bas / Push / Pull / Legs", methode: "standard", objectifs: ["hybride", "hypertrophie", "force"], pourquoi: "Le meilleur des deux structures : fréquence élevée sur le bas, volume élevé sur le haut.", jours: ["hautLourd", "basLourd", "push", "pull", "legs"] },
  { id: "bro5", freq: 5, nom: "Un groupe par jour", methode: "standard", objectifs: ["hypertrophie"], pourquoi: "Pectoraux, dos, épaules, bras, jambes : une séance entière par groupe. Chaque muscle n'est stimulé qu'une fois par semaine, ce qui est sous-optimal pour l'hypertrophie — mais le volume par séance est énorme et la récupération locale complète.", jours: ["pecs", "dosJour", "epaules", "bras", "jambes"] },
  { id: "spec5", freq: 5, nom: "Spécialisation point faible", methode: "blocs", objectifs: ["hypertrophie"], pourquoi: "Quatre séances d'entretien plus une séance entièrement dédiée au groupe en retard. À tenir sur un bloc de six semaines maximum : le reste du corps est en maintien pendant ce temps.", jours: ["hautLourd", "basLourd", "specialisation", "hautVolume", "basVolume"] },
  { id: "hyb5", freq: 5, nom: "Muscu 4 + cardio 1", methode: "standard", objectifs: ["recomp", "maintien", "rando"], pourquoi: "Quatre séances de résistance et une séance cardio placée à distance des jambes. Le compromis le plus tenable en recomposition corporelle.", jours: ["hautLourd", "basLourd", "hautVolume", "basVolume", "z2"] },
  { id: "rando5", freq: 5, nom: "Rando — 4 + 1 cardio", methode: "blocs", objectifs: ["rando"], pourquoi: "Ajoute une séance d'intervalles pour élever le VO2 max et améliorer le confort dans les montées raides.", jours: ["z2", "basRando", "intervalles", "excentrique", "sortie"] },
  { id: "ppl6", freq: 6, nom: "Push / Pull / Legs ×2", methode: "standard", objectifs: ["hypertrophie", "hybride"], pourquoi: "Le standard en hypertrophie à volume élevé : chaque groupe 2 fois par semaine. À 6 séances, la récupération devient le facteur limitant — le volume par séance doit baisser, pas s'additionner.", jours: ["push", "pull", "legs", "push", "pull", "legs"] },
  { id: "arnold6", freq: 6, nom: "Arnold split", methode: "standard", objectifs: ["hypertrophie"], pourquoi: "Pectoraux-dos, épaules-bras, jambes, deux fois par semaine. Les antagonistes sont travaillés ensemble, ce qui donne une congestion marquée et une fréquence de deux par groupe.", jours: ["pecsDos", "epaulesBras", "jambes", "pecsDos", "epaulesBras", "jambes"] },
  { id: "ul6", freq: 6, nom: "Haut / Bas ×3", methode: "dup", objectifs: ["force", "hybride"], pourquoi: "Fréquence de trois fois par semaine sur chaque moitié de corps, avec ondulation des formats. Idéal pour la maîtrise technique des mouvements clés.", jours: ["hautLourd", "basLourd", "hautVolume", "basVolume", "hautLourd", "basLourd"] },
  { id: "tbj6", freq: 6, nom: "Torse / Bras / Jambes ×2", methode: "standard", objectifs: ["hypertrophie"], pourquoi: "Les bras reçoivent deux séances dédiées par semaine, sans jamais arriver pré-fatigués. La structure à privilégier quand les bras sont le point faible assumé.", jours: ["torse", "brasJour", "jambes", "torse", "brasJour", "jambes"] },
];

/* Modèles de séance : suite de créneaux (pattern, rôle) */
const JOURS = {
  fbA: { nom: "Full body A", slots: [["squat", "principal"], ["pousseeH", "secondaire"], ["tirageH", "secondaire"], ["epauleIso", "accessoire"], ["gainage", "gainage"]] },
  fbB: { nom: "Full body B", slots: [["charniere", "principal"], ["pousseeV", "secondaire"], ["tirageV", "secondaire"], ["bras", "accessoire"], ["gainage", "gainage"]] },
  fbC: { nom: "Full body C", slots: [["fente", "principal"], ["pousseeH", "secondaire"], ["tirageH", "secondaire"], ["mollet", "accessoire"], ["gainage", "gainage"]] },
  hautLourd: { nom: "Haut — lourd", slots: [["pousseeH", "principal"], ["tirageV", "principal"], ["pousseeV", "secondaire"], ["tirageH", "secondaire"], ["bras", "accessoire"], ["gainage", "gainage"]] },
  hautVolume: { nom: "Haut — volume", slots: [["pousseeH", "secondaire"], ["tirageH", "secondaire"], ["pousseeV", "accessoire"], ["epauleIso", "accessoire"], ["bras", "accessoire"], ["bras", "accessoire"]] },
  basLourd: { nom: "Bas — lourd", slots: [["squat", "principal"], ["charniere", "secondaire"], ["fente", "accessoire"], ["mollet", "accessoire"], ["gainage", "gainage"]] },
  basVolume: { nom: "Bas — volume", slots: [["charniere", "principal"], ["squat", "secondaire"], ["unipodal", "accessoire"], ["mollet", "accessoire"], ["gainage", "gainage"]] },
  push: { nom: "Push", slots: [["pousseeH", "principal"], ["pousseeV", "secondaire"], ["pousseeH", "accessoire"], ["epauleIso", "accessoire"], ["bras", "accessoire"]] },
  pull: { nom: "Pull", slots: [["tirageV", "principal"], ["tirageH", "secondaire"], ["tirageV", "accessoire"], ["epauleIso", "accessoire"], ["bras", "accessoire"]] },
  legs: { nom: "Legs", slots: [["squat", "principal"], ["charniere", "secondaire"], ["fente", "accessoire"], ["mollet", "accessoire"], ["gainage", "gainage"]] },
  z2: { nom: "Base aérobie — zone 2", slots: [["cardio", "principal"], ["mobilite", "accessoire"]], forceEx: ["Marche zone 2"] },
  intervalles: { nom: "Intervalles en côte", slots: [["cardio", "principal"], ["gainage", "gainage"]], forceEx: ["Intervalles en côte"] },
  basRando: { nom: "Force du bas — spécifique rando", slots: [["unipodal", "principal"], ["charniere", "secondaire"], ["squat", "secondaire"], ["mollet", "accessoire"], ["gainage", "gainage"]] },
  excentrique: { nom: "Excentrique & stabilité", slots: [["excentrique", "principal"], ["excentrique", "secondaire"], ["gainage", "gainage"], ["gainage", "accessoire"], ["mobilite", "accessoire"]] },
  sortie: { nom: "Sortie longue avec sac", slots: [["cardio", "principal"], ["mobilite", "accessoire"]], forceEx: ["Sortie longue avec sac"] },

  // --- Découpes par groupe musculaire ---
  pecs: { nom: "Pectoraux", slots: [["pousseeH", "principal"], ["pousseeH", "secondaire"], ["pousseeH", "accessoire"], ["pousseeH", "accessoire"], ["gainage", "gainage"]] },
  dosJour: { nom: "Dos", slots: [["tirageV", "principal"], ["tirageH", "secondaire"], ["tirageH", "accessoire"], ["tirageV", "accessoire"], ["epauleIso", "accessoire"]] },
  epaules: { nom: "Épaules", slots: [["pousseeV", "principal"], ["epauleIso", "secondaire"], ["epauleIso", "accessoire"], ["epauleIso", "accessoire"], ["gainage", "gainage"]] },
  bras: { nom: "Bras", slots: [["bras", "principal"], ["bras", "secondaire"], ["bras", "accessoire"], ["bras", "accessoire"], ["avantbras", "accessoire"]] },
  jambes: { nom: "Jambes", slots: [["squat", "principal"], ["charniere", "secondaire"], ["fente", "accessoire"], ["adducteur", "accessoire"], ["mollet", "accessoire"]] },
  // --- Antagonistes : on alterne agoniste et antagoniste dans la séance ---
  pecsDos: { nom: "Pectoraux / Dos — antagonistes", slots: [["pousseeH", "principal"], ["tirageH", "principal"], ["pousseeH", "secondaire"], ["tirageV", "secondaire"], ["pousseeH", "accessoire"], ["tirageH", "accessoire"]] },
  epaulesBras: { nom: "Épaules / Bras", slots: [["pousseeV", "principal"], ["epauleIso", "secondaire"], ["bras", "accessoire"], ["bras", "accessoire"], ["epauleIso", "accessoire"], ["avantbras", "accessoire"]] },
  // --- Torse / Bras / Jambes ---
  torse: { nom: "Torse", slots: [["pousseeH", "principal"], ["tirageV", "principal"], ["pousseeV", "secondaire"], ["tirageH", "secondaire"], ["epauleIso", "accessoire"], ["gainage", "gainage"]] },
  brasJour: { nom: "Bras & épaules", slots: [["bras", "principal"], ["bras", "secondaire"], ["epauleIso", "accessoire"], ["bras", "accessoire"], ["avantbras", "accessoire"]] },
  // --- Séance construite autour d'un mouvement de compétition ---
  focusSquat: { nom: "Squat — mouvement du jour", slots: [["squat", "principal"], ["charniere", "secondaire"], ["fente", "accessoire"], ["lombaire", "accessoire"], ["gainage", "gainage"]] },
  focusBench: { nom: "Développé — mouvement du jour", slots: [["pousseeH", "principal"], ["tirageH", "secondaire"], ["pousseeV", "accessoire"], ["bras", "accessoire"], ["epauleIso", "accessoire"]] },
  focusDeadlift: { nom: "Soulevé — mouvement du jour", slots: [["charniere", "principal"], ["tirageH", "secondaire"], ["lombaire", "accessoire"], ["unipodal", "accessoire"], ["gainage", "gainage"]] },
  focusPress: { nom: "Militaire — mouvement du jour", slots: [["pousseeV", "principal"], ["tirageV", "secondaire"], ["epauleIso", "accessoire"], ["bras", "accessoire"], ["gainage", "gainage"]] },
  // --- Circuit métabolique et poids du corps ---
  circuit: { nom: "Circuit métabolique", slots: [["squat", "secondaire"], ["pousseeH", "secondaire"], ["tirageH", "secondaire"], ["charniere", "accessoire"], ["gainage", "accessoire"], ["cardio", "accessoire"]] },
  streetHaut: { nom: "Street — haut du corps", slots: [["tirageV", "principal"], ["pousseeH", "principal"], ["pousseeV", "secondaire"], ["tirageH", "secondaire"], ["bras", "accessoire"], ["gainage", "gainage"]] },
  streetBas: { nom: "Street — bas du corps", slots: [["squat", "principal"], ["fente", "secondaire"], ["charniere", "secondaire"], ["mollet", "accessoire"], ["gainage", "gainage"]] },
  // --- Spécialisation d'un point faible ---
  specialisation: { nom: "Spécialisation", slots: [["epauleIso", "principal"], ["epauleIso", "secondaire"], ["bras", "accessoire"], ["epauleIso", "accessoire"], ["avantbras", "accessoire"]] },
  // --- Séance courte, dose minimale efficace ---
  express: { nom: "Express — dose minimale", slots: [["squat", "principal"], ["pousseeH", "secondaire"], ["tirageV", "secondaire"]] },
};

const ROLE_LABEL = { principal: "Principal", secondaire: "Second mouvement", accessoire: "Accessoire", gainage: "Gainage" };

/* --------------------------------------------------------------------------
   Objectifs nutritionnels — A.4.3
   -------------------------------------------------------------------------- */

const OBJECTIFS_NUTRI = {
  lean_bulk: {
    nom: "Prise de masse musculaire", court: "Lean bulk", couleur: "bleu",
    ecart: [10, 15], // % au-dessus de la maintenance
    prot: [1.8, 2.2], lipMin: 0.9,
    vitesse: "+0,25 à +0,5 % du poids de corps par semaine",
    explication: "Léger surplus calorique pour maximiser le gain musculaire en limitant le gain de gras. Convient à un pratiquant intermédiaire qui veut gagner en volume sans exploser son taux de masse grasse.",
    compromis: "Plus le surplus est agressif, plus la part de gras dans la prise augmente. Un surplus modéré construit autant de muscle mais avec moins de gras à reperdre ensuite.",
    demarrage: "Ne saute pas d'un coup à la cible : pars de ta maintenance et monte de 100 à 150 kcal toutes les deux à trois semaines, tant que la balance suit le rythme visé. Une hausse brutale se traduit surtout par du gras et de l'inconfort digestif.",
    quantite: "Si l'appétit est le facteur limitant, augmente la densité calorique plutôt que le volume : huile ajoutée en fin de cuisson, oléagineux, avoine mixée, formes liquides. Manger plus n'est pas manger plus lourd.",
  },
  bulk_rapide: {
    nom: "Prise de masse rapide", court: "Bulk agressif", couleur: "jaune",
    ecart: [18, 25], prot: [1.6, 2.0], lipMin: 0.9,
    vitesse: "+0,5 à +1 % du poids de corps par semaine",
    explication: "Surplus plus marqué, gain de poids plus rapide mais proportion de gras plus élevée. À réserver aux profils très maigres ou en reprise après une longue pause.",
    compromis: "Au-delà d'un certain seuil, le muscle ne se construit pas plus vite — seul le tissu adipeux suit. Le gain de temps est souvent illusoire.",
  },
  seche: {
    nom: "Perte de gras", court: "Sèche", couleur: "rouge",
    ecart: [-20, -15], prot: [2.0, 2.4], lipMin: 0.8,
    vitesse: "-0,5 à -1 % du poids de corps par semaine maximum",
    explication: "Déficit modéré, protéines élevées et entraînement en force maintenu pour préserver la masse musculaire. Le muscle se préserve par la charge, pas par le cardio.",
    compromis: "Un déficit plus agressif accélère la perte mais dégrade la performance, la récupération et la part de masse maigre conservée.",
    demarrage: "Compte environ trois mois pour une sèche menée correctement, soit à peu près deux kilos par mois. Au-delà, la fatigue et la faim s'accumulent plus vite que les résultats : mieux vaut une pause à la maintenance qu'un déficit prolongé indéfiniment.",
    quantite: "Le volume alimentaire est ton meilleur allié : légumes verts, protéines maigres, aliments peu denses. C'est ce qui permet de manger beaucoup en calories basses, et donc de tenir.",
  },
  recomp: {
    nom: "Recomposition corporelle", court: "Recomp", couleur: "vert",
    ecart: [-5, 0], prot: [2.0, 2.4], lipMin: 0.9,
    vitesse: "Poids quasi stable, mensurations qui évoluent",
    explication: "Maintien calorique ou déficit très léger, protéines élevées, entraînement en résistance rigoureux. Gain de muscle et perte de gras simultanés : plus lent, mais réaliste chez un débutant, un pratiquant en reprise, ou avec un taux de gras élevé.",
    compromis: "Le poids sur la balance ne bougera presque pas. C'est le tour de taille et les charges soulevées qui mesurent le progrès, pas la balance.",
  },
  maintien: {
    nom: "Maintien / performance", court: "Maintien", couleur: "blanc",
    ecart: [0, 0], prot: [1.6, 2.0], lipMin: 1.0,
    vitesse: "Poids stable",
    explication: "Calories à la maintenance, priorité à la performance et à la récupération plutôt qu'à la composition corporelle. Adapté à une phase de préparation, par exemple avant une randonnée ou un événement sportif.",
    compromis: "Aucune transformation visuelle rapide : c'est un choix de performance, assumé comme tel.",
  },
  force_stable: {
    nom: "Prise de force à poids stable", court: "Force", couleur: "rouge",
    ecart: [0, 3], prot: [1.8, 2.2], lipMin: 1.0,
    vitesse: "Poids stable, charges en hausse",
    explication: "Maintien calorique, focus sur la progression neuronale et technique. Utile pour rester dans une catégorie de poids ou éviter la prise de gras.",
    compromis: "La progression de charge sera plus lente qu'en surplus : c'est le prix du poids stable.",
  },
};

const VITESSES = { douce: 0.55, moderee: 1, agressive: 1.4 };

/* --------------------------------------------------------------------------
   Calculs — A.4.4
   -------------------------------------------------------------------------- */

const METIERS = {
  assis: { nom: "Bureau, assis", kcal: 0, desc: "Poste sédentaire : la dépense vient presque entièrement des pas hors travail." },
  debout: { nom: "Debout, peu de déplacements", kcal: 180, desc: "Station debout prolongée : environ +180 kcal sur une journée de travail." },
  actif: { nom: "En mouvement toute la journée", kcal: 350, desc: "Commercial, vendeur, artisan : déplacement quasi continu, environ +350 kcal." },
  physique: { nom: "Travail physique avec port de charges", kcal: 600, desc: "Manutention, chantier : environ +600 kcal, avec une fatigue qui compte aussi dans la récupération." },
};

function bmr(p) {
  const { sexe, poids, taille, age, mg } = p;
  if (mg && mg > 3 && mg < 60) {
    const lbm = poids * (1 - mg / 100);
    return { valeur: 370 + 21.6 * lbm, methode: "Katch-McArdle", pourquoi: "Ton taux de masse grasse est renseigné : Katch-McArdle calcule à partir de la masse maigre, ce qui est plus précis chez un sujet musclé que les formules basées sur le poids total." };
  }
  const base = 10 * poids + 6.25 * taille - 5 * age + (sexe === "H" ? 5 : -161);
  return { valeur: base, methode: "Mifflin-St Jeor", pourquoi: "Formule la plus fiable en population générale. Renseigne ton taux de masse grasse pour basculer sur Katch-McArdle, plus précise chez un sujet musclé." };
}

function kcalPas(pas, poids) { return Math.round((pas || 0) * poids * 0.0005); }

function kcalSeance(p, typeSeance) {
  if (!typeSeance) return 0;
  const base = p.poids * 0.09;
  const durees = { muscu: 70, cardio: 60, sortie: 180, leger: 40 };
  const intens = { muscu: 5.5, cardio: 8, sortie: 6.5, leger: 3.5 };
  const d = durees[typeSeance] ?? 60, i = intens[typeSeance] ?? 5;
  return Math.round((base * i * d) / 60);
}

function calculBesoins(p, ctx = {}) {
  const b = bmr(p);
  const pas = ctx.pas ?? p.pasMoyens ?? 7000;
  const metier = METIERS[p.metier] || METIERS.assis;
  const neatBase = b.valeur * 0.1; // thermogenèse alimentaire + activité résiduelle
  const kPas = kcalPas(pas, p.poids);
  const kSeance = ctx.seance !== undefined ? kcalSeance(p, ctx.seance) : Math.round((p.frequence * kcalSeance(p, "muscu")) / 7);
  const maintenance = Math.round(b.valeur + neatBase + metier.kcal + kPas + kSeance);

  const obj = OBJECTIFS_NUTRI[p.objNutrition] || OBJECTIFS_NUTRI.maintien;
  const mult = VITESSES[p.vitesse] ?? 1;
  const ecartBrut = ((obj.ecart[0] + obj.ecart[1]) / 2) * mult;
  let cible = Math.round(maintenance * (1 + ecartBrut / 100));

  // Garde-fous de sécurité
  const plancherAbsolu = p.sexe === "H" ? 1500 : 1200;
  const plancherPhysio = Math.round(b.valeur * 1.05);
  const plancher = Math.max(plancherAbsolu, plancherPhysio);
  let alerte = null;
  if (cible < plancher) {
    cible = plancher;
    alerte = `Le déficit demandé descendait sous ${plancher} kcal, en dessous de ta dépense de repos. La cible a été relevée à ce plancher. Un déficit très agressif prolongé relève du RED-S : chute de performance, perturbations hormonales, fragilité osseuse. Si tu veux aller plus bas, parles-en à un médecin ou un diététicien.`;
  }
  if (ecartBrut < -28) alerte = "Déficit très agressif. Sur plus de quelques semaines, ce niveau de restriction dégrade la performance et la masse maigre. Un avis professionnel est recommandé.";

  // Macros
  const refPoids = p.mg && p.mg > 3 && p.mg < 60 ? p.poids * (1 - p.mg / 100) * 1.15 : p.poids;
  const gProtKg = (obj.prot[0] + obj.prot[1]) / 2;
  let prot = Math.round(refPoids * gProtKg);
  let lip = Math.round(p.poids * obj.lipMin);
  let kcalRestantes = cible - prot * 4 - lip * 9;
  let gluc = Math.round(kcalRestantes / 4);
  if (gluc < 60) { // protéger le plancher lipidique tout en gardant des glucides
    gluc = 60;
    lip = Math.max(Math.round(p.poids * 0.7), Math.round((cible - prot * 4 - gluc * 4) / 9));
  }

  return {
    bmr: Math.round(b.valeur), methodeBmr: b.methode, pourquoiBmr: b.pourquoi,
    neat: Math.round(neatBase), metier: metier.kcal, kPas, kSeance, pas,
    maintenance, cible, ecart: Math.round(ecartBrut), alerte,
    prot, lip, gluc, gProtKg: gProtKg.toFixed(1),
    obj,
  };
}

function objectifsDuJour(p, journalJour) {
  const base = calculBesoins(p, {
    pas: journalJour?.pas ?? p.pasMoyens,
    seance: journalJour?.entrainementPrevu ?? undefined,
  });
  const o = p.overrides || {};
  return {
    ...base,
    kcal: o.kcal ?? base.cible,
    prot: o.prot ?? base.prot,
    lip: o.lip ?? base.lip,
    gluc: o.gluc ?? base.gluc,
    surcharge: !!(o.kcal || o.prot || o.lip || o.gluc),
  };
}

/* --------------------------------------------------------------------------
   Analyse rétrospective de l'entraînement
   L'application prescrivait du volume sans jamais le mesurer après coup. Or le
   volume hebdomadaire par groupe musculaire est le premier déterminant de
   l'hypertrophie : ne pas le suivre, c'est piloter à l'aveugle.
   -------------------------------------------------------------------------- */

const SERIE_EFFICACE_RPE = 7;
const FOURCHETTE_VOLUME = [10, 20];

function volumeParGroupe(seances, semaines = 1, finSemaine = new Date()) {
  const debut = new Date(finSemaine);
  debut.setDate(debut.getDate() - semaines * 7);
  const compte = {};
  seances.filter((sc) => new Date(sc.date) >= debut).forEach((sc) => {
    Object.entries(sc.logs || {}).forEach(([exId, series]) => {
      const ex = exById(exId); if (!ex) return;
      // Une série ne compte que si elle a été menée assez près de l'échec.
      const efficaces = series.filter((x) => (x.rpe ?? 8) >= SERIE_EFFICACE_RPE).length;
      if (!efficaces) return;
      const groupes = [...new Set(ex.chefs.map((c) => MUSCLES[c]?.groupe).filter(Boolean))];
      const soutien = [...new Set(ex.secondaires.map((c) => MUSCLES[c]?.groupe).filter(Boolean))];
      groupes.forEach((g) => { compte[g] = (compte[g] || 0) + efficaces; });
      // Le travail indirect compte pour moitié : c'est la convention la plus
      // répandue et elle évite de surestimer le volume des bras.
      soutien.filter((g) => !groupes.includes(g)).forEach((g) => { compte[g] = (compte[g] || 0) + efficaces * 0.5; });
    });
  });
  return Object.entries(compte)
    .map(([g, v]) => {
      const parSem = v / semaines;
      return { groupe: g, series: Math.round(parSem * 10) / 10,
        etat: parSem < FOURCHETTE_VOLUME[0] ? "bas" : parSem > FOURCHETTE_VOLUME[1] ? "haut" : "cible" };
    })
    .sort((a, b) => b.series - a.series);
}

/* Records personnels : meilleure charge, meilleur volume, meilleur maximum estimé. */
function recordsPersonnels(historique) {
  const out = [];
  Object.entries(historique).forEach(([exId, series]) => {
    const ex = exById(exId); if (!ex || !series.length) return;
    let charge = series[0], rm = series[0], volume = series[0];
    series.forEach((x) => {
      if (x.charge > charge.charge) charge = x;
      if (epley(x.charge, x.reps) > epley(rm.charge, rm.reps)) rm = x;
      if (x.charge * x.reps > volume.charge * volume.reps) volume = x;
    });
    out.push({ exId, nom: ex.nom, groupe: ex.groupe, charge, rm: epley(rm.charge, rm.reps), rmSerie: rm, volume,
      recent: series.at(-1), n: series.length });
  });
  return out.sort((a, b) => b.rm - a.rm);
}

/* Détecte, au moment de valider, si la série vient de battre un record. */
function recordBattu(historique, exId, charge, reps) {
  const h = historique[exId] || [];
  if (!h.length) return null;
  const maxCharge = Math.max(...h.map((x) => x.charge));
  const maxRm = Math.max(...h.map((x) => epley(x.charge, x.reps)));
  const maxVol = Math.max(...h.map((x) => x.charge * x.reps));
  const rm = epley(charge, reps);
  if (charge > maxCharge) return { type: "charge", texte: `Record de charge : ${charge} kg, contre ${maxCharge} kg jusqu'ici.` };
  if (rm > maxRm + 0.5) return { type: "rm", texte: `Record de maximum estimé : ${Math.round(rm)} kg, contre ${Math.round(maxRm)} kg.` };
  if (charge * reps > maxVol) return { type: "volume", texte: `Record de volume sur une série : ${charge} × ${reps}.` };
  return null;
}

/* Estimation 1RM — Epley */
const epley = (poids, reps) => (reps <= 1 ? poids : Math.round(poids * (1 + reps / 30) * 10) / 10);

/* Calcul de chargement de barre — disques calibrés courants en France */
const DISQUES = [
  { kg: 25, c: "rouge" }, { kg: 20, c: "bleu" }, { kg: 15, c: "jaune" },
  { kg: 10, c: "vert" }, { kg: 5, c: "blanc" }, { kg: 2.5, c: "rouge" },
  { kg: 1.25, c: "gris" },
];
function chargerBarre(total, barre = 20) {
  if (total < barre) return { possible: false, cote: [], reste: 0 };
  let parCote = (total - barre) / 2;
  const cote = [];
  for (const d of DISQUES) {
    while (parCote >= d.kg - 0.001) { cote.push(d); parCote -= d.kg; }
  }
  return { possible: true, cote, reste: Math.round(parCote * 100) / 100 };
}

/* --------------------------------------------------------------------------
   Connaissances avancées sur les macronutriments
   Chaque affirmation porte son niveau de preuve. Un mécanisme démontré en
   laboratoire n'est pas la même chose qu'un bénéfice mesuré sur le terrain :
   la distinction est faite ici plutôt que laissée dans le flou.
   -------------------------------------------------------------------------- */

const PREUVE = {
  solide: { l: "Consensus solide", c: "vert", d: "Établi par plusieurs travaux convergents et repris par les organismes de référence." },
  probable: { l: "Probable", c: "jaune", d: "Données cohérentes mais nombre d'études limité, ou effets de taille modeste." },
  mecanisme: { l: "Mécanisme documenté, application débattue", c: "bleu", d: "Le phénomène biologique est démontré, mais son bénéfice réel en conditions d'entraînement normales n'est pas établi." },
  debat: { l: "Débattu", c: "rouge", d: "La littérature est partagée. À considérer comme une piste, pas comme une règle." },
};

const AVANCE = [
  {
    id: "prot", titre: "Protéines — signalisation anabolique", couleur: "blanc",
    intro: "À un niveau avancé, les protéines ne servent plus seulement de briques : chaque repas est un signal. La question devient combien, à quel moment, et sous quelle forme.",
    points: [
      { t: "Le seuil de leucine", preuve: "solide", texte: "La leucine est l'acide aminé qui déclenche la voie mTORC1, celle qui lance la synthèse protéique musculaire. En dessous d'une certaine dose par repas, le signal ne part pas ou part faiblement. L'ordre de grandeur retenu est de 2,5 à 3,5 g de leucine, soit environ 0,4 à 0,55 g/kg de protéines de haute valeur biologique — pour 75 kg, cela fait 30 à 40 g de protéines par prise.", pratique: "Vise 30 à 40 g de protéines par repas plutôt que 20 g répartis partout." },
      { t: "L'effet muscle full", preuve: "mecanisme", texte: "Après ingestion, la synthèse protéique culmine vers 60 à 90 minutes puis retombe à sa ligne de base en 3 à 4 heures, même si les acides aminés sanguins restent élevés. Le muscle cesse de répondre : c'est la période réfractaire. Ce phénomène a été observé en perfusion continue d'acides aminés ; son extrapolation aux repas réels reste discutée, et l'effet sur la masse musculaire à long terme n'est pas démontré.", pratique: "Espacer les prises protéiques de 3 h 30 à 5 h est une organisation raisonnable. Ne fais pas de cette règle une contrainte : le total quotidien reste de loin le facteur dominant." },
      { t: "Qualité et score DIAAS", preuve: "solide", texte: "Le DIAAS mesure la digestibilité et le profil en acides aminés indispensables. Un score supérieur à 1,0 signifie que la protéine couvre tous les besoins sans facteur limitant : œufs entiers, lait, isolat de lactosérum, viandes maigres, poissons. Les sources végétales isolées descendent souvent en dessous, sauf le soja.", pratique: "Si tu manges peu de produits animaux, associe céréale et légumineuse dans la journée pour compenser les acides aminés limitants." },
      { t: "Solide autour des repas, rapide autour de la séance", preuve: "debat", texte: "L'idée est de garder les protéines solides aux repas principaux pour une libération lente, et les formes rapides autour de l'entraînement. En pratique, l'avantage des protéines rapides en péri-entraînement est faible dès lors que l'apport quotidien est atteint : la fenêtre anabolique est bien plus large que ce que l'on croyait dans les années 2000.", pratique: "Utilise la whey pour sa commodité, pas parce qu'elle serait indispensable." },
    ],
    sources: ["International Society of Sports Nutrition — position stand sur les protéines", "Morton et al., 2018 — méta-analyse apport protéique et hypertrophie", "FAO — méthode DIAAS"],
  },
  {
    id: "gluc", titre: "Glucides — glycogène et signal hormonal", couleur: "jaune",
    intro: "Les glucides sont le levier le plus efficace pour débloquer un plateau chez un pratiquant expérimenté. Ils sont anti-cataboliques et soutiennent directement la qualité des séries lourdes.",
    points: [
      { t: "Avant la séance", preuve: "probable", texte: "1 h 30 à 2 h avant, des glucides à index bas ou modéré associés à une source de protéines donnent une glycémie stable sans pic prématuré : avoine, patate douce, riz basmati. L'objectif est d'arriver avec le glycogène plein et sans creux.", pratique: "Si tu t'entraînes tôt le matin, un repas léger et digeste vaut mieux qu'un gros repas mal digéré." },
      { t: "Pendant la séance", preuve: "mecanisme", texte: "0,5 à 0,8 g/kg par heure d'entraînement sous forme de dextrine hautement branchée ou de maltodextrine à faible osmolarité. L'argument est la vidange gastrique rapide sans inconfort digestif, une glycémie constante et une moindre montée du cortisol. Le bénéfice est réel sur les efforts longs, au-delà de 75 à 90 minutes, ou en glycogène bas. Sur une séance de musculation d'une heure après un repas correct, l'effet mesurable est proche de zéro.", pratique: "Réserve l'intra-entraînement aux séances longues, aux journées à deux séances ou aux sorties en montagne." },
      { t: "Après la séance", preuve: "probable", texte: "Dans les deux heures, un repas riche en glucides à index modéré ou élevé relance la glycogène synthétase et arrête le catabolisme. L'urgence est réelle quand une seconde séance suit dans la journée ; sinon, le total sur 24 h prime largement sur le minutage.", pratique: "Une séance par jour et un total quotidien correct : mange quand ça t'arrange." },
      { t: "Refeeds et flexibilité métabolique", preuve: "debat", texte: "Des journées à glucides élevés stimulent la conversion périphérique de la thyroxine T4 en triiodothyronine T3 et relancent la production de leptine. La réponse hormonale aiguë est bien documentée. En revanche, la supériorité des refeeds sur un déficit linéaire pour la perte de gras à moyen terme n'est pas clairement établie : le bénéfice le mieux démontré est psychologique et comportemental, et il n'est pas négligeable.", pratique: "Un refeed hebdomadaire aide surtout à tenir un déficit dans la durée. C'est déjà une bonne raison." },
    ],
    sources: ["ACSM et Academy of Nutrition and Dietetics — nutrition et performance sportive", "Burke et al. — disponibilité en glucides et adaptation à l'entraînement"],
  },
  {
    id: "lip", titre: "Lipides — hormones, membranes, inflammation", couleur: "rouge",
    intro: "Les lipides régulent le système endocrinien et l'intégrité des membranes cellulaires. Ce sont les premiers coupés en sèche, et c'est presque toujours une erreur.",
    points: [
      { t: "Répartition en trois tiers", preuve: "probable", texte: "Une répartition équilibrée vise environ 25 à 30 % d'acides gras saturés, 45 à 50 % de mono-insaturés et 20 à 25 % de poly-insaturés. Les mono-insaturés — huile d'olive, avocat, oléagineux — sont les mieux documentés sur la sensibilité à l'insuline et la santé cardiovasculaire.", pratique: "En pratique, cette répartition arrive presque toute seule si tu combines huile d'olive, œufs entiers, poissons gras et oléagineux." },
      { t: "Cholestérol et testostérone", preuve: "mecanisme", texte: "Le cholestérol est le précurseur de la prégnénolone, elle-même convertie en testostérone dans les cellules de Leydig : la chaîne biochimique est établie. Mais augmenter l'apport en lipides au-delà d'un seuil relativement bas n'augmente pas la testostérone de façon significative. Ce qui est démontré, c'est l'inverse : un apport lipidique très bas la fait chuter.", pratique: "Respecte le plancher de 0,8 à 1 g/kg. Monter à 1,5 g/kg n'apportera pas de bénéfice hormonal supplémentaire." },
      { t: "Oméga-3 EPA et DHA", preuve: "debat", texte: "Ils s'intègrent dans la bicouche phospholipidique des membranes musculaires, ce qui améliorerait la fluidité membranaire, l'affinité des récepteurs à l'insuline et l'entrée des acides aminés. Le mécanisme est plausible et documenté in vitro. Sur l'hypertrophie et la performance chez l'humain entraîné, les résultats sont mitigés. Les bénéfices les mieux établis portent sur l'inflammation, la santé cardiovasculaire et probablement la récupération.", pratique: "Une dose de 1 à 2 g d'EPA et DHA combinés couvre l'essentiel des bénéfices documentés. Au-delà de 3 g par jour, l'intérêt supplémentaire n'est pas démontré et le risque de saignement augmente : c'est un seuil à ne pas franchir sans avis médical, surtout sous anticoagulant." },
    ],
    sources: ["EFSA et ANSES — références nutritionnelles sur les lipides", "ISSN — position stand sur les acides gras oméga-3"],
  },
];

/* Micronutriments ciblés — activables en mode avancé */
const CIBLES_AVANCEES = [
  { id: "omega3", nom: "Oméga-3 EPA et DHA", dose: "1 à 2 g d'EPA et DHA combinés par jour", couleur: "bleu",
    entrainement: "Modération de l'inflammation post-effort et probable amélioration de la récupération entre séances rapprochées. L'effet sur l'hypertrophie elle-même reste discuté.",
    quotidien: "Bénéfices cardiovasculaires bien établis, rôle dans la fonction cérébrale et la santé de la rétine. C'est le nutriment pour lequel l'alimentation française moyenne est la plus déficitaire.",
    alimentaire: "Deux portions de poisson gras par semaine — maquereau, sardine, saumon — couvrent l'essentiel. Noix, huile de colza et graines de lin apportent la forme végétale, qui se convertit mal en EPA et DHA.",
    prudence: "Au-delà de 3 g par jour, risque accru de saignement. Avis médical impératif sous anticoagulant ou avant une chirurgie." },
  { id: "d3k2", nom: "Vitamine D3 et K2", dose: "Selon dosage sanguin, souvent 1000 à 2000 UI de D3 par jour en hiver", couleur: "jaune",
    entrainement: "La vitamine D intervient dans la fonction musculaire et la solidité osseuse, ce qui compte directement sous charge lourde. Un statut bas est associé à une force réduite, même si le lien de causalité reste discuté.",
    quotidien: "Immunité, humeur, densité osseuse. Le déficit est très fréquent en France d'octobre à avril, où l'ensoleillement ne suffit plus à la synthèse cutanée.",
    alimentaire: "Poissons gras, jaune d'œuf, produits enrichis. L'alimentation seule couvre rarement les besoins en hiver. La K2 se trouve dans les fromages affinés et les aliments fermentés.",
    prudence: "La vitamine D est liposoluble et s'accumule : un surdosage prolongé est toxique. Ne te supplémente pas à l'aveugle — une prise de sang coûte peu et évite de deviner." },
  { id: "magnesium", nom: "Magnésium", dose: "Référence de 380 mg par jour, apports alimentaires souvent en dessous", couleur: "vert",
    entrainement: "Fonction neuromusculaire et contraction. Un statut bas se traduit d'abord par des crampes, une récupération dégradée et une fatigue diffuse.",
    quotidien: "Plus de trois cents réactions enzymatiques en dépendent, dont la production d'énergie et la régulation du système nerveux. Le stress chronique augmente les pertes urinaires.",
    alimentaire: "Oléagineux, chocolat noir, légumineuses, céréales complètes, eaux minérales riches en magnésium. Les formes bisglycinate et citrate sont mieux tolérées que l'oxyde, très laxatif.",
    prudence: "Des doses élevées provoquent des diarrhées. Prudence en cas d'insuffisance rénale : avis médical nécessaire." },
  { id: "zinc", nom: "Zinc", dose: "Référence de 11 mg par jour chez l'homme, 8 mg chez la femme", couleur: "blanc",
    entrainement: "Impliqué dans la synthèse protéique et la production de testostérone. La supplémentation ne relève la testostérone que chez les sujets réellement déficitaires — chez les autres, aucun effet.",
    quotidien: "Immunité, cicatrisation, santé de la peau et des cheveux, perception du goût.",
    alimentaire: "Viandes, fruits de mer, œufs, légumineuses, graines de courge. Les phytates des céréales complètes réduisent son absorption.",
    prudence: "Un excès prolongé bloque l'absorption du cuivre et affaiblit l'immunité. Ne dépasse pas les doses indiquées sans dosage préalable." },
];


/* --------------------------------------------------------------------------
   Moteur d'avis nutritionnel — A.1.4
   Règles déterministes calculées sur le profil de l'aliment.
   Informatif et bienveillant, jamais de classement bon/mauvais aliment.
   -------------------------------------------------------------------------- */

function avisAliment(f, g, ctx = {}) {
  const r = (x) => Math.round((x * g) / 100 * 10) / 10;
  const forts = [], attention = [], moment = [], suggestions = [];
  const densiteProt = (f.prot / Math.max(f.kcal, 1)) * 100;

  if (f.prot >= 15) forts.push(`${r(f.prot)} g de protéines pour cette portion${densiteProt >= 10 ? ", avec une excellente densité protéique" : ""}.`);
  if (f.fibres >= 5) forts.push(`${r(f.fibres)} g de fibres : bon pour le transit et la satiété.`);
  Object.entries(f.micros).forEach(([k, v]) => {
    const m = MICRO_LABELS[k]; if (!m) return;
    const pct = ((v * g) / 100 / m.rda) * 100;
    if (pct >= 25) forts.push(`Couvre environ ${Math.round(pct)} % des apports de référence en ${m.n.toLowerCase()}.`);
  });
  if (f.cat === "leg" || f.cat === "fru") forts.push("Densité calorique faible : du volume alimentaire pour peu de calories, utile pour la satiété.");

  if (f.sat >= 8 && g >= 30) attention.push(`Riche en lipides saturés (${r(f.sat)} g) — à équilibrer sur la journée, pas à éviter.`);
  if (f.sucres >= 25 && f.cat !== "fru") attention.push(`${r(f.sucres)} g de sucres : plutôt à placer autour de la séance qu'à distance.`);
  if (f.cat === "fec" && f.fibres < 2) attention.push("Peu de fibres pour un féculent : la version complète en apporte souvent 3× plus.");
  if (f.cat === "boisson" && ["Bière blonde 5%", "Vin rouge"].includes(f.nom)) attention.push("L'alcool dégrade la synthèse protéique et la qualité du sommeil, donc la récupération. Ce sont aussi des calories qui ne rassasient pas.");
  if (f.kcal >= 500 && f.cat !== "gras") attention.push("Densité calorique élevée : le grammage compte beaucoup ici, quelques grammes changent le total.");

  const h = ctx.heure ?? new Date().getHours();
  const seance = ctx.seance;
  const rapide = f.sucres >= 10 && (f.cat === "fru" || f.cat === "fec" || f.cat === "snack");
  const lent = f.cat === "fec" && f.fibres >= 3;
  if (seance && rapide && f.prot < 10) moment.push("Bon choix autour de la séance : les glucides rapides accélèrent la reconstitution du glycogène.");
  else if (seance && lent) moment.push("Glucides à libération lente : à placer à distance de la séance plutôt que juste avant.");
  if (seance && f.prot >= 15) moment.push("Apport protéique en jour d'entraînement : répartir 3 à 4 prises sur la journée soutient mieux la synthèse protéique qu'une seule grosse prise.");
  if (h >= 20 && f.cat === "boisson" && f.nom === "Café noir") moment.push("Caféine tardive : la demi-vie est d'environ 5 h, l'endormissement et la profondeur du sommeil peuvent en pâtir.");

  const gly = chargeGlycemique(f, g);
  if (gly && gly.glucides >= 5) {
    const n = igNiveau(gly.ig), nc = cgNiveau(gly.cg);
    if (n === "eleve" && nc !== "bas") moment.push(`Index glycémique ${gly.ig}, charge ${gly.cg} pour cette portion : montée rapide de la glycémie. Utile autour de la séance, moins pertinent à distance.`);
    else if (n === "bas") moment.push(`Index glycémique ${gly.ig}, charge ${gly.cg} : libération progressive, énergie stable. À placer à distance de la séance.`);
    else moment.push(`Index glycémique ${gly.ig}, charge ${gly.cg} pour cette portion.`);
    if (n === "eleve" && nc === "bas") suggestions.push("Index élevé mais charge basse sur cette portion : l'effet réel sur la glycémie reste faible. C'est la charge qui compte, pas l'index seul.");
  }
  const ferVeg = (f.micros.fer || 0) >= 2 && (f.cat === "vege" || f.cat === "leg" || f.cat === "fec");
  if (ferVeg) suggestions.push("Associe-le à une source de vitamine C (poivron, agrume, kiwi) : le fer non héminique s'absorbe beaucoup mieux.");
  if (f.prot >= 15 && f.fibres < 1 && f.cat !== "lait") suggestions.push("Complète avec une source de fibres : légumes verts ou légumineuses.");
  if (f.cat === "fec" && f.prot < 6) suggestions.push("Seul, cet aliment couvre peu de protéines — associe-le à une source protéique pour équilibrer le repas.");

  return { forts, attention, moment, suggestions };
}

/* --------------------------------------------------------------------------
   Moteur de carences — A.3 (avec sources identifiables)
   -------------------------------------------------------------------------- */

const SOURCES = {
  issn: "International Society of Sports Nutrition — position stand sur les apports protéiques chez le sportif",
  morton: "Morton et al., 2018 — méta-analyse sur la relation apport protéique / hypertrophie",
  acsm: "ACSM / Academy of Nutrition and Dietetics — position sur nutrition et performance sportive",
  efsa: "EFSA / ANSES — références nutritionnelles pour la population",
  cio: "CIO — consensus sur le RED-S (Relative Energy Deficiency in Sport)",
};

function analyseCarences(historique, objectifs, profil) {
  // historique : [{date, kcal, prot, lip, gluc, fibres, micros}]
  const jours = historique.slice(-7).filter(Boolean);
  if (jours.length < 3) return [];
  const moy = (k) => jours.reduce((s, j) => s + (j[k] || 0), 0) / jours.length;
  const alertes = [];
  const seuil = 0.85;

  const mProt = moy("prot");
  if (mProt < objectifs.prot * seuil) {
    alertes.push({
      cle: "prot", couleur: "blanc", titre: "Apport protéique durablement sous la cible",
      chiffre: `${Math.round(mProt)} g/j en moyenne sur ${jours.length} jours, cible ${objectifs.prot} g`,
      consequence: "En déficit calorique, un apport protéique insuffisant se traduit par une perte de masse maigre plutôt que de gras. La synthèse protéique musculaire ne peut pas compenser la dégradation, et la récupération entre séances ralentit.",
      sources: [SOURCES.issn, SOURCES.morton],
      certitude: "Consensus solide : c'est un des points les mieux établis en nutrition du sport.",
      action: "Ajoute une source dense sur le repas le plus pauvre : 150 g de skyr, 130 g de blanc de poulet ou une dose de whey couvrent 25 à 40 g.",
    });
  }
  const mGluc = moy("gluc");
  if (mGluc < objectifs.gluc * seuil) {
    alertes.push({
      cle: "gluc", couleur: "jaune", titre: "Apport glucidique durablement sous la cible",
      chiffre: `${Math.round(mGluc)} g/j en moyenne, cible ${objectifs.gluc} g`,
      consequence: "Glycogène musculaire bas : chute de performance sur les séries longues et l'endurance, sensation de jambes vides, qualité d'entraînement dégradée et catabolisme potentiellement accru.",
      sources: [SOURCES.acsm],
      certitude: "Bien établi pour les efforts répétés et prolongés ; l'ampleur varie selon le volume d'entraînement.",
      action: "Concentre les glucides autour des séances : c'est là qu'ils servent le plus.",
    });
  }
  const mLip = moy("lip");
  const plancherLip = Math.round(profil.poids * 0.8);
  if (mLip < plancherLip) {
    alertes.push({
      cle: "lip", couleur: "rouge", titre: "Apport lipidique sous le plancher physiologique",
      chiffre: `${Math.round(mLip)} g/j en moyenne, plancher ${plancherLip} g (0,8 g/kg)`,
      consequence: "Impact sur la production hormonale, dont la testostérone, sur l'absorption des vitamines liposolubles A, D, E et K, et sur la santé articulaire. Un plancher lipidique doit toujours être respecté, y compris en sèche.",
      sources: [SOURCES.acsm, SOURCES.efsa],
      certitude: "Le plancher fait consensus ; la relation dose-réponse exacte avec les hormones est moins tranchée dans la littérature.",
      action: "Huile d'olive, oléagineux, œufs entiers, poissons gras : quelques grammes suffisent à corriger.",
    });
  }
  const mFibres = moy("fibres");
  if (mFibres < 25) {
    alertes.push({
      cle: "fibres", couleur: "vert", titre: "Apport en fibres insuffisant",
      chiffre: `${Math.round(mFibres)} g/j en moyenne, référence 25 à 30 g`,
      consequence: "Transit ralenti, satiété dégradée — ce qui rend un déficit calorique nettement plus difficile à tenir — et appauvrissement du microbiote.",
      sources: [SOURCES.efsa],
      certitude: "Recommandation de référence, applicable en population générale.",
      action: "Légumineuses, flocons d'avoine, légumes verts et fruits entiers plutôt qu'en jus.",
    });
  }
  const mKcal = moy("kcal");
  if (mKcal > 0 && mKcal < objectifs.maintenance * 0.7) {
    alertes.push({
      cle: "kcal", couleur: "rouge", prioritaire: true, titre: "Déficit calorique global très important et prolongé",
      chiffre: `${Math.round(mKcal)} kcal/j en moyenne, maintenance estimée ${objectifs.maintenance} kcal`,
      consequence: "Un déficit de cette ampleur maintenu dans la durée correspond à une faible disponibilité énergétique (RED-S) : chute des performances, perturbations hormonales, fragilité osseuse, troubles du sommeil et de l'humeur.",
      sources: [SOURCES.cio],
      certitude: "Syndrome décrit et documenté ; les seuils individuels varient.",
      action: "Remonte progressivement l'apport et prends l'avis d'un médecin ou d'un diététicien. Ce n'est pas un réglage à faire seul.",
    });
  }
  ["fer", "calcium", "vitD", "magnesium"].forEach((k) => {
    const m = MICRO_LABELS[k];
    const val = jours.reduce((s, j) => s + ((j.micros || {})[k] || 0), 0) / jours.length;
    if (val > 0 && val < m.rda * 0.6) {
      alertes.push({
        cle: k, couleur: "bleu", titre: `Apport en ${m.n.toLowerCase()} bas`,
        chiffre: `${Math.round(val)} ${m.u}/j estimés, référence ${m.rda} ${m.u}`,
        consequence: k === "fer" ? "Le fer transporte l'oxygène : un statut bas se traduit d'abord par une fatigue diffuse et une baisse de performance en endurance."
          : k === "vitD" ? "Rôle osseux et musculaire. Le statut dépend surtout de l'exposition solaire ; l'alimentation seule couvre rarement la référence en hiver."
          : k === "calcium" ? "Santé osseuse, particulièrement importante sous charge lourde."
          : "Fonction neuromusculaire : un statut bas favorise les crampes et dégrade la récupération.",
        sources: [SOURCES.efsa],
        certitude: "Estimation calculée sur les aliments loggés uniquement — la base ne contient pas tous les micronutriments de tous les aliments, la valeur réelle est probablement plus élevée. Seule une prise de sang permet de conclure.",
        action: "À confirmer avec un professionnel de santé avant toute supplémentation.",
      });
    }
  });
  return alertes;
}

/* --------------------------------------------------------------------------
   Recettes — A.5. Base locale, ingrédients référencés à la base d'aliments.
   -------------------------------------------------------------------------- */

const RECETTES = [
  { id: "r1", nom: "Poulet riz brocoli", temps: 25, diff: "facile", budget: "eco", regimes: [], moment: "dej", ing: [["Blanc de poulet", 180], ["Riz blanc cuit", 220], ["Brocoli cuit", 200], ["Huile d'olive", 10], ["Sauce soja", 15]], etapes: ["Cuire le riz à l'eau salée.", "Saisir le poulet coupé en morceaux dans l'huile 6 à 8 min.", "Cuire le brocoli à la vapeur 6 min pour garder le croquant et limiter la perte de vitamine C.", "Assembler, déglacer à la sauce soja."] },
  { id: "r2", nom: "Bowl lentilles fromage légumes", temps: 20, diff: "facile", budget: "eco", regimes: ["vegetarien"], moment: "dej", ing: [["Lentilles cuites", 250], ["Poivron rouge", 120], ["Tomate", 100], ["Comté", 30], ["Huile d'olive", 12]], etapes: ["Réchauffer les lentilles.", "Couper poivron et tomate en dés.", "Assembler, ajouter le fromage et l'huile.", "Le poivron apporte la vitamine C qui améliore nettement l'absorption du fer des lentilles."] },
  { id: "r3", nom: "Omelette épinards fromage", temps: 12, diff: "facile", budget: "eco", regimes: ["vegetarien"], moment: "diner", ing: [["Oeuf entier", 165], ["Épinards cuits", 150], ["Comté", 25], ["Huile d'olive", 8]], etapes: ["Faire tomber les épinards à la poêle.", "Battre les œufs, verser sur les épinards.", "Cuire à feu moyen, ajouter le fromage, plier."] },
  { id: "r4", nom: "Saumon patate douce haricots", temps: 30, diff: "facile", budget: "moyen", regimes: [], moment: "diner", ing: [["Saumon frais", 150], ["Patate douce cuite", 250], ["Haricots verts cuits", 150], ["Huile de colza", 10]], etapes: ["Cuire la patate douce au four 25 min à 200 degrés.", "Cuire le saumon 12 min au four ou 4 min par face à la poêle.", "Vapeur pour les haricots.", "Poisson gras et huile de colza : double apport en oméga-3 sur un seul repas."] },
  { id: "r5", nom: "Porridge avoine banane beurre de cacahuète", temps: 8, diff: "facile", budget: "eco", regimes: ["vegetarien"], moment: "petitdej", ing: [["Flocons d'avoine", 80], ["Lait demi-écrémé", 250], ["Banane", 120], ["Beurre de cacahuète", 16]], etapes: ["Chauffer le lait avec les flocons 5 min en remuant.", "Ajouter la banane écrasée et le beurre de cacahuète.", "Index glycémique modéré et beaucoup de fibres : à privilégier les matins sans séance rapprochée."] },
  { id: "r6", nom: "Chili pois chiches", temps: 25, diff: "facile", budget: "eco", regimes: ["vegetarien", "vegetalien"], moment: "diner", ing: [["Pois chiches cuits", 250], ["Tomate", 200], ["Poivron rouge", 120], ["Oignon", 80], ["Huile d'olive", 12], ["Riz blanc cuit", 180]], etapes: ["Faire revenir oignon et poivron.", "Ajouter tomates concassées et pois chiches, mijoter 15 min.", "Servir avec le riz.", "Association céréale et légumineuse : le profil d'acides aminés du repas devient complet."] },
  { id: "r7", nom: "Skyr fruits rouges amandes", temps: 3, diff: "facile", budget: "moyen", regimes: ["vegetarien"], moment: "collation", ing: [["Skyr / 0% MG", 200], ["Myrtilles", 100], ["Amandes", 25], ["Miel", 7]], etapes: ["Mélanger.", "Densité protéique très élevée pour peu de calories : utile en sèche quand l'enveloppe est serrée."] },
  { id: "r8", nom: "Pâtes complètes thon tomate", temps: 18, diff: "facile", budget: "eco", regimes: [], moment: "dej", ing: [["Pâtes complètes cuites", 250], ["Thon naturel", 120], ["Tomate", 200], ["Huile d'olive", 12], ["Oignon", 60]], etapes: ["Cuire les pâtes al dente : l'index glycémique reste nettement plus bas que trop cuites.", "Revenir oignon et tomates, ajouter le thon égoutté.", "Mélanger."] },
  { id: "r9", nom: "Steak purée maison épinards", temps: 25, diff: "facile", budget: "moyen", regimes: [], moment: "diner", ing: [["Steak haché 5% MG", 150], ["Pomme de terre cuite", 300], ["Épinards cuits", 150], ["Lait demi-écrémé", 60], ["Beurre", 10]], etapes: ["Cuire les pommes de terre, écraser avec lait et beurre.", "Saisir le steak 3 min par face.", "Faire tomber les épinards.", "Viande rouge et épinards : deux sources de fer, dont une héminique bien absorbée."] },
  { id: "r10", nom: "Tofu sauté riz complet légumes", temps: 22, diff: "moyen", budget: "eco", regimes: ["vegetarien", "vegetalien"], moment: "dej", ing: [["Tofu ferme", 200], ["Riz complet cuit", 220], ["Poivron rouge", 120], ["Courgette", 150], ["Sauce soja", 20], ["Huile de colza", 12]], etapes: ["Presser et couper le tofu, saisir jusqu'à coloration.", "Sauter les légumes 6 min.", "Ajouter la sauce soja, servir sur le riz."] },
  { id: "r11", nom: "Wrap dinde crudités", temps: 10, diff: "facile", budget: "eco", regimes: [], moment: "dej", ing: [["Pain complet", 70], ["Dinde escalope", 130], ["Salade verte", 40], ["Tomate", 80], ["Moutarde", 10]], etapes: ["Cuire la dinde, émincer.", "Garnir, rouler.", "Format transportable : utile les jours où le déjeuner se prend hors de chez soi."] },
  { id: "r12", nom: "Œufs brouillés pain complet avocat", temps: 10, diff: "facile", budget: "moyen", regimes: ["vegetarien"], moment: "petitdej", ing: [["Oeuf entier", 165], ["Pain complet", 70], ["Avocat", 80], ["Huile d'olive", 6]], etapes: ["Brouiller les œufs à feu doux : ils restent moelleux et le jaune garde ses lipides intacts.", "Toaster le pain, écraser l'avocat dessus.", "Servir ensemble."] },
  { id: "r13", nom: "Poulet quinoa courgettes", temps: 25, diff: "facile", budget: "moyen", regimes: [], moment: "dej", ing: [["Blanc de poulet", 170], ["Quinoa cuit", 220], ["Courgette", 200], ["Huile d'olive", 12], ["Oignon", 60]], etapes: ["Cuire le quinoa 12 min.", "Saisir le poulet, réserver.", "Sauter courgette et oignon 8 min.", "Le quinoa apporte un profil d'acides aminés complet, rare pour une graine."] },
  { id: "r14", nom: "Cabillaud pommes de terre poireaux", temps: 30, diff: "facile", budget: "moyen", regimes: [], moment: "diner", ing: [["Cabillaud", 180], ["Pomme de terre cuite", 280], ["Poireau cuit", 150], ["Huile d'olive", 12]], etapes: ["Cuire les pommes de terre à l'eau.", "Fondue de poireaux 12 min à feu doux.", "Cuire le cabillaud 8 min à la vapeur ou au four.", "Repas très rassasiant pour peu de calories : intéressant en déficit."] },
  { id: "r15", nom: "Bowl saumon fumé avocat riz", temps: 12, diff: "facile", budget: "large", regimes: [], moment: "dej", ing: [["Saumon fumé", 90], ["Riz blanc cuit", 200], ["Avocat", 80], ["Kiwi", 75], ["Sauce soja", 15]], etapes: ["Riz tiède au fond du bol.", "Disposer saumon, avocat et kiwi en dés.", "Assaisonner à la sauce soja."] },
  { id: "r16", nom: "Curry de lentilles corail", temps: 25, diff: "facile", budget: "eco", regimes: ["vegetarien", "vegetalien"], moment: "diner", ing: [["Lentilles cuites", 280], ["Tomate", 200], ["Oignon", 80], ["Carotte", 100], ["Huile de colza", 12], ["Riz complet cuit", 180]], etapes: ["Revenir oignon et carotte.", "Ajouter tomates et lentilles, mijoter 15 min.", "Servir avec le riz.", "Très riche en fibres : environ 15 g sur l'assiette, plus de la moitié de la référence quotidienne."] },
  { id: "r17", nom: "Shaker post-séance banane whey", temps: 2, diff: "facile", budget: "moyen", regimes: ["vegetarien"], moment: "autour", ing: [["Protéine whey poudre", 30], ["Banane", 120], ["Lait demi-écrémé", 250]], etapes: ["Mixer.", "Glucides à index modéré et protéines rapides : le format le plus pratique quand l'appétit manque après l'effort.", "Un repas solide dans les deux heures fait tout aussi bien : ce shaker est une commodité, pas une obligation."] },
  { id: "r18", nom: "Salade de pois chiches feta légumes", temps: 15, diff: "facile", budget: "eco", regimes: ["vegetarien"], moment: "dej", ing: [["Pois chiches cuits", 250], ["Tomate", 150], ["Poivron rouge", 100], ["Comté", 40], ["Huile d'olive", 15], ["Oignon", 50]], etapes: ["Tout couper en dés.", "Mélanger avec les pois chiches et l'huile.", "Se conserve 48 h au frais : idéal à préparer la veille."] },
  { id: "r19", nom: "Poêlée de porc riz haricots verts", temps: 25, diff: "facile", budget: "moyen", regimes: [], moment: "diner", ing: [["Filet de porc", 170], ["Riz blanc cuit", 200], ["Haricots verts cuits", 180], ["Huile d'olive", 12], ["Moutarde", 10]], etapes: ["Saisir le filet coupé en médaillons 4 min par face.", "Déglacer à la moutarde.", "Servir avec riz et haricots."] },
  { id: "r20", nom: "Overnight oats chia myrtilles", temps: 5, diff: "facile", budget: "moyen", regimes: ["vegetarien"], moment: "petitdej", ing: [["Flocons d'avoine", 70], ["Lait demi-écrémé", 220], ["Graines de chia", 12], ["Myrtilles", 100], ["Miel", 7]], etapes: ["Tout mélanger dans un bocal la veille.", "Laisser au frais toute la nuit.", "Les graines de chia apportent des fibres solubles et des oméga-3 végétaux."] },
  { id: "r21", nom: "Omelette champignons jambon", temps: 12, diff: "facile", budget: "eco", regimes: [], moment: "diner", ing: [["Oeuf entier", 165], ["Champignons de Paris", 150], ["Jambon blanc", 90], ["Huile d'olive", 8]], etapes: ["Sauter les champignons jusqu'à évaporation de l'eau.", "Ajouter le jambon en dés.", "Verser les œufs battus, cuire à feu moyen."] },
  { id: "r22", nom: "Boulgour poulet légumes rôtis", temps: 35, diff: "moyen", budget: "eco", regimes: [], moment: "dej", ing: [["Boulgour cuit", 220], ["Blanc de poulet", 170], ["Courgette", 150], ["Poivron rouge", 120], ["Huile d'olive", 15]], etapes: ["Rôtir les légumes 25 min à 200 degrés.", "Cuire le boulgour 12 min.", "Saisir le poulet, assembler.", "Boulgour : index glycémique bas et 4,5 g de fibres pour 100 g, nettement mieux que la semoule blanche."] },
  { id: "r23", nom: "Sardines pain complet tomates", temps: 6, diff: "facile", budget: "eco", regimes: [], moment: "dej", ing: [["Sardines à l'huile", 100], ["Pain complet", 80], ["Tomate", 150], ["Huile d'olive", 6]], etapes: ["Toaster le pain, écraser les sardines dessus.", "Ajouter les tomates en rondelles.", "Les sardines avec arêtes apportent près de 400 mg de calcium pour 100 g, autant qu'un gros morceau de fromage."] },
  { id: "r24", nom: "Crevettes sautées nouilles de courgette", temps: 15, diff: "moyen", budget: "large", regimes: [], moment: "diner", ing: [["Crevettes", 200], ["Courgette", 300], ["Poivron rouge", 100], ["Huile de colza", 12], ["Sauce soja", 15]], etapes: ["Tailler la courgette en tagliatelles.", "Saisir les crevettes 3 min.", "Sauter les légumes 4 min, assembler.", "Assiette très volumineuse pour environ 350 kcal : la satiété vient du volume autant que des calories."] },
  { id: "r25", nom: "Riz au thon et œuf", temps: 15, diff: "facile", budget: "eco", regimes: [], moment: "dej", ing: [["Riz blanc cuit", 220], ["Thon naturel", 120], ["Oeuf entier", 110], ["Huile d'olive", 10], ["Sauce soja", 15]], etapes: ["Cuire le riz.", "Cuire les œufs durs ou au plat.", "Mélanger avec le thon, assaisonner."] },
  { id: "r26", nom: "Poulet patate douce brocoli", temps: 30, diff: "facile", budget: "moyen", regimes: [], moment: "dej", ing: [["Blanc de poulet", 180], ["Patate douce cuite", 250], ["Brocoli cuit", 180], ["Huile d'olive", 12]], etapes: ["Rôtir la patate douce en cubes 25 min.", "Saisir le poulet.", "Vapeur pour le brocoli.", "Patate douce : index glycémique 63 contre 78 pour la pomme de terre, et davantage de fibres."] },
  { id: "r27", nom: "Salade de quinoa avocat crevettes", temps: 18, diff: "facile", budget: "large", regimes: [], moment: "dej", ing: [["Quinoa cuit", 200], ["Crevettes", 150], ["Avocat", 80], ["Tomate", 120], ["Huile d'olive", 12]], etapes: ["Cuire le quinoa, refroidir.", "Assembler avec crevettes, avocat et tomate.", "Assaisonner."] },
  { id: "r28", nom: "Fromage blanc noix miel", temps: 3, diff: "facile", budget: "eco", regimes: ["vegetarien"], moment: "collation", ing: [["Fromage blanc 3%", 250], ["Noix", 25], ["Miel", 10], ["Pomme", 150]], etapes: ["Mélanger.", "Les noix sont la meilleure source végétale d'oméga-3 à courte chaîne : environ 2 g pour 25 g."] },
  { id: "r29", nom: "Tempeh sauté brocoli riz", temps: 22, diff: "moyen", budget: "moyen", regimes: ["vegetarien", "vegetalien"], moment: "diner", ing: [["Tempeh", 150], ["Brocoli cuit", 200], ["Riz complet cuit", 200], ["Sauce soja", 20], ["Huile de colza", 12]], etapes: ["Saisir le tempeh en tranches jusqu'à coloration.", "Vapeur pour le brocoli.", "Assembler et déglacer à la sauce soja.", "Le tempeh est fermenté : il se digère mieux que le tofu et apporte 19 g de protéines pour 100 g."] },
  { id: "r30", nom: "Pâtes au saumon et épinards", temps: 20, diff: "facile", budget: "large", regimes: [], moment: "diner", ing: [["Pâtes complètes cuites", 240], ["Saumon frais", 150], ["Épinards cuits", 150], ["Crème fraîche 30%", 30], ["Huile d'olive", 8]], etapes: ["Cuire les pâtes al dente.", "Saisir le saumon en cubes 5 min.", "Faire tomber les épinards, ajouter la crème.", "Mélanger le tout."] },
  { id: "r31", nom: "Couscous poulet légumes", temps: 30, diff: "moyen", budget: "eco", regimes: [], moment: "dej", ing: [["Semoule couscous cuite", 250], ["Cuisse de poulet sans peau", 180], ["Carotte", 120], ["Courgette", 150], ["Pois chiches cuits", 120], ["Huile d'olive", 12]], etapes: ["Mijoter le poulet avec les légumes 25 min.", "Préparer la semoule.", "Servir avec les pois chiches.", "La légumineuse abaisse l'index glycémique global du plat et ajoute 8 g de fibres."] },
  { id: "r32", nom: "Toast avocat œuf poché", temps: 12, diff: "moyen", budget: "moyen", regimes: ["vegetarien"], moment: "petitdej", ing: [["Pain complet", 70], ["Avocat", 90], ["Oeuf entier", 110], ["Huile d'olive", 5]], etapes: ["Pocher les œufs 3 min dans l'eau frémissante vinaigrée.", "Écraser l'avocat sur le pain toasté.", "Déposer les œufs dessus."] },
  { id: "r33", nom: "Chili haricots rouges viande", temps: 35, diff: "moyen", budget: "eco", regimes: [], moment: "diner", ing: [["Steak haché 5% MG", 180], ["Haricots rouges cuits", 250], ["Tomate", 250], ["Oignon", 80], ["Poivron rouge", 100], ["Huile d'olive", 12]], etapes: ["Revenir oignon et poivron.", "Ajouter la viande, faire colorer.", "Tomates et haricots, mijoter 25 min à couvert.", "Se conserve 3 jours et se congèle : idéal à préparer en double."] },
  { id: "r34", nom: "Poêlée de pois cassés et jambon", temps: 25, diff: "facile", budget: "eco", regimes: [], moment: "diner", ing: [["Pois cassés cuits", 260], ["Jambon blanc", 100], ["Carotte", 100], ["Oignon", 70], ["Huile d'olive", 12]], etapes: ["Revenir carotte et oignon.", "Ajouter les pois cassés et le jambon en dés.", "Mijoter 12 min.", "Plus de 20 g de fibres sur l'assiette, pour un index glycémique très bas."] },
  { id: "r35", nom: "Maquereau riz complet salade", temps: 20, diff: "facile", budget: "eco", regimes: [], moment: "dej", ing: [["Maquereau", 130], ["Riz complet cuit", 220], ["Salade verte", 60], ["Tomate", 120], ["Huile de colza", 12]], etapes: ["Cuire le riz.", "Griller le maquereau 4 min par face.", "Assembler avec la salade assaisonnée.", "Le maquereau est parmi les poissons les plus riches en EPA et DHA, pour un prix très bas."] },
  { id: "r36", nom: "Seitan sauté champignons boulgour", temps: 22, diff: "moyen", budget: "moyen", regimes: ["vegetarien", "vegetalien"], moment: "diner", ing: [["Seitan", 150], ["Champignons de Paris", 200], ["Boulgour cuit", 200], ["Sauce soja", 20], ["Huile d'olive", 12]], etapes: ["Saisir le seitan en tranches.", "Sauter les champignons jusqu'à évaporation.", "Assembler avec le boulgour.", "Le seitan est très riche en protéines mais pauvre en lysine : associe-le à une légumineuse dans la journée."] },
  { id: "r37", nom: "Shaker avoine fruits", temps: 4, diff: "facile", budget: "eco", regimes: ["vegetarien"], moment: "petitdej", ing: [["Flocons d'avoine", 60], ["Lait demi-écrémé", 250], ["Banane", 120], ["Protéine whey poudre", 25], ["Beurre de cacahuète", 12]], etapes: ["Mixer le tout.", "Format liquide dense : utile en prise de masse quand l'appétit est un frein."] },
  { id: "r38", nom: "Salade complète poulet œuf", temps: 15, diff: "facile", budget: "moyen", regimes: [], moment: "dej", ing: [["Blanc de poulet", 150], ["Salade verte", 80], ["Oeuf entier", 110], ["Tomate", 150], ["Comté", 25], ["Huile d'olive", 15]], etapes: ["Cuire le poulet et les œufs durs.", "Assembler sur un lit de salade.", "Assaisonner.", "Plus de 45 g de protéines pour environ 550 kcal."] },
  { id: "r39", nom: "Poulet crémé riz champignons", temps: 25, diff: "facile", budget: "moyen", regimes: [], moment: "diner", ing: [["Blanc de poulet", 180], ["Champignons de Paris", 180], ["Riz blanc cuit", 200], ["Crème fraîche 30%", 30], ["Oignon", 60]], etapes: ["Saisir le poulet, réserver.", "Sauter oignon et champignons.", "Ajouter la crème, remettre le poulet, mijoter 6 min."] },
  { id: "r40", nom: "Assiette petit-déjeuner salé", temps: 12, diff: "facile", budget: "moyen", regimes: [], moment: "petitdej", ing: [["Oeuf entier", 165], ["Jambon blanc", 80], ["Pain complet", 70], ["Fromage blanc 3%", 100], ["Kiwi", 75]], etapes: ["Cuire les œufs comme tu préfères.", "Assembler avec le jambon, le pain et le fromage blanc.", "Le kiwi apporte la vitamine C qui améliore l'absorption du fer du repas.", "Petit-déjeuner protéiné : environ 40 g de protéines, ce qui aide à tenir la matinée sans fringale."] },
];

function resoudreIngredient(nom, foods) {
  const cible = nom.includes("|") ? nom.split("|")[1] : nom;
  const alias = nom.includes("|") ? nom.split("|")[0] : nom;
  const f = foods.find((x) => x.nom === cible) || foods.find((x) => x.nom.toLowerCase() === alias.toLowerCase());
  return f || null;
}

function nutritionRecette(rec, foods) {
  const tot = { kcal: 0, prot: 0, gluc: 0, lip: 0, fibres: 0 };
  rec.ing.forEach(([nom, g]) => {
    const f = resoudreIngredient(nom, foods); if (!f) return;
    tot.kcal += (f.kcal * g) / 100; tot.prot += (f.prot * g) / 100;
    tot.gluc += (f.gluc * g) / 100; tot.lip += (f.lip * g) / 100; tot.fibres += (f.fibres * g) / 100;
  });
  Object.keys(tot).forEach((k) => (tot[k] = Math.round(tot[k])));
  return tot;
}

/* --------------------------------------------------------------------------
   Génération du programme — B.6
   -------------------------------------------------------------------------- */


function choisirExercice(pattern, role, materiel, niveau, seed, dejaPris, zones) {
  const rang = { debutant: 1, inter: 2, avance: 3 };
  const plafond = (NIVEAUX[niveau] || NIVEAUX.intermediaire).complexite;
  const sain = (e) => !exerciceDeconseille(e, zones);
  const base = (l) => l.filter((e) => e.pattern === pattern && !dejaPris.includes(e.id));
  // Priorité : matériel disponible, niveau adapté, aucune contre-indication déclarée.
  let pool = base(EXERCICES).filter((e) => materiel.includes(e.materiel) && rang[e.niveau] <= plafond && sain(e));
  if (!pool.length) pool = base(EXERCICES).filter((e) => materiel.includes(e.materiel) && rang[e.niveau] <= plafond);
  if (!pool.length) pool = base(EXERCICES).filter((e) => ["pdc", "aucun", "elastique"].includes(e.materiel) && sain(e));
  if (!pool.length) pool = base(EXERCICES);
  if (!pool.length) pool = EXERCICES.filter((e) => e.pattern === pattern);
  if (!pool.length) return null;
  const poly = pool.filter((e) => e.type === "poly");
  const iso = pool.filter((e) => e.type === "iso");
  const cible = role === "principal" || role === "secondaire" ? (poly.length ? poly : pool) : (iso.length ? iso : pool);
  return cible[seed % cible.length];
}

function genererProgramme(p, splitId, semaine = 1) {
  const split = SPLITS.find((s) => s.id === splitId)
    || SPLITS.find((s) => s.freq === p.frequence && s.objectifs.includes(p.objectif))
    || SPLITS.find((s) => s.freq === p.frequence);
  if (!split) return null;
  const obj = OBJECTIFS_ENTRAINEMENT[p.objectif] || OBJECTIFS_ENTRAINEMENT.hybride;
  const niv = NIV(p);
  const deload = semaine % niv.deloadToutes === 0;
  const volMult = niv.volMult * (deload ? 0.55 : 1);
  const materiel = p.materiel?.length ? [...p.materiel, "aucun"] : ["pdc", "aucun"];
  const zones = p.zonesSensibles || [];
  const nivKey = p.niveau || "intermediaire";

  const seances = split.jours.map((jourKey, idx) => {
    const modele = JOURS[jourKey];
    const pris = [];
    const slots = modele.slots.slice(0, niv.exosMax);
    const exos = slots.map(([pattern, role], si) => {
      let ex = null;
      if (modele.forceEx && si === 0) ex = EXERCICES.find((e) => e.nom === modele.forceEx[0]);
      if (!ex) ex = choisirExercice(pattern, role, materiel, nivKey, semaine + idx * 3 + si, pris, zones);
      if (!ex) return null;
      pris.push(ex.id);
      const sch = obj.schemes[role] || obj.schemes.accessoire;
      const series = Math.max(2, Math.round(sch.series * volMult));
      // Le plafond d'intensité dépend du niveau : un débutant garde toujours
      // deux répétitions en réserve, un expert peut aller à l'échec en isolation.
      const plafond = role === "accessoire" ? niv.rpePlafond : Math.min(niv.rpePlafond, 8);
      let rpe = [Math.min(sch.rpe[0], plafond), Math.min(sch.rpe[1], plafond)];
      if (deload) rpe = [rpe[0] - 1, rpe[1] - 1];
      // Ondulation hebdomadaire pour les experts : lourd, moyen, léger.
      let reps = sch.reps;
      const ondule = niv.progression === "ondulatoire" || split.methode === "dup";
      if (ondule && role !== "gainage") {
        const vague = idx % 3;
        if (vague === 1) reps = [reps[0] + 2, reps[1] + 3];
        else if (vague === 2) reps = [reps[0] + 4, reps[1] + 6];
      }
      let repos = sch.repos;
      if (split.methode === "circuit") repos = Math.round(repos * 0.35);
      else if (split.methode === "antagonistes") repos = Math.round(repos * 0.6);
      else if (split.methode === "minimal") repos = Math.round(repos * 0.85);
      // La première semaine sert de repérage : on note les charges sans forcer
      // les techniques d'intensification, qui arrivent une fois la référence posée.
      const adaptation = semaine === 1;
      return {
        exId: ex.id, role, series, reps, rpe, repos, intensite: sch.intensite,
        unite: sch.unite || "reps", pourquoiRepos: sch.pourquoiRepos,
        tempo: tempoPour(role, p.objectif),
        techniques: adaptation || deload ? [] : techniquesPour(role, p.objectif, nivKey, ex),
        alerte: exerciceDeconseille(ex, zones),
      };
    }).filter(Boolean);
    return { jourKey, nom: modele.nom, exos };
  });

  return {
    genereLe: new Date().toISOString(), splitId: split.id, splitNom: split.nom,
    pourquoiSplit: split.pourquoi, objectif: p.objectif, semaine, deload,
    niveau: nivKey, progression: niv.progression, frequence: split.freq,
    methode: split.methode || "standard", adaptation: semaine === 1, seances,
  };
}

function prochaineSerie(historique, exId, scheme, niveau = "intermediaire") {
  const niv = NIVEAUX[niveau] || NIVEAUX.intermediaire;
  const h = (historique[exId] || []).slice(-1)[0];
  if (!h) return { charge: null, reps: scheme.reps[0], note: "Première fois sur cet exercice : commence prudemment et note la charge. La référence se construira à partir de là." };
  const [min, max] = scheme.reps;
  const inc = h.charge >= 60 ? 5 : 2.5;

  if (niv.progression === "lineaire") {
    // Débutant : la progression vient de l'apprentissage moteur, on charge dès
    // que la séance précédente est passée proprement.
    if (h.reps >= min && (h.rpe || 8) <= 8) {
      return { charge: Math.round((h.charge + inc) * 2) / 2, reps: min,
        note: `Séance précédente propre à RPE ${h.rpe || 8} : on ajoute ${inc} kg. À ton niveau, la progression est linéaire — tant que la technique tient, on charge à chaque séance.` };
    }
    return { charge: h.charge, reps: Math.min(h.reps + 1, max),
      note: "La dernière série était exigeante : on garde la charge et on cherche une répétition de plus avant de remonter." };
  }

  if (niv.progression === "ondulatoire") {
    // Expert : la charge du jour se règle au RPE, pas à un pourcentage figé.
    const rm = epley(h.charge, h.reps);
    const cible = Math.round((rm * (1 - (max - 1) * 0.0275)) * 2) / 2;
    return { charge: cible, reps: min,
      note: `Autorégulation : à partir d'un maximum estimé à ${Math.round(rm)} kg, la charge du jour pour ${min} à ${max} répétitions ressort à ${cible} kg. Ajuste au ressenti — si le RPE monte de deux points par rapport à d'habitude, c'est la fatigue qui parle, baisse la charge plutôt que de forcer.` };
  }

  // Confirmé : double progression, le modèle le plus robuste.
  if (h.reps >= max) {
    return { charge: Math.round((h.charge + inc) * 2) / 2, reps: min,
      note: `Tu as atteint ${max} répétitions à ${h.charge} kg : on monte la charge et on redescend en bas de fourchette. C'est la double progression.` };
  }
  return { charge: h.charge, reps: Math.min(h.reps + 1, max),
    note: `Même charge qu'à la dernière séance, une répétition de plus visée. Plafond de la fourchette : ${max}.` };
}

function detecterStagnation(historique, exId) {
  const h = (historique[exId] || []).slice(-4);
  if (h.length < 4) return null;
  const e1 = epley(h[0].charge, h[0].reps), e4 = epley(h[3].charge, h[3].reps);
  if (e4 <= e1 * 1.005) {
    return "Aucune progression sur les 4 dernières séances de cet exercice. Avant de changer le programme, vérifie le sommeil et les calories : c'est là que se joue la récupération. Si le contexte est bon, change de fourchette de répétitions, insère une décharge ou varie le mouvement.";
  }
  return null;
}

/* --------------------------------------------------------------------------
   MOTEUR COACHING — READINESS
   Score de préparation quotidien. Chaque facteur est noté sur 100 à partir de
   signaux réellement disponibles dans le modèle existant — aucune donnée
   inventée, aucune mesure biométrique qui n'existe pas dans l'application.
   Le score global ne s'affiche jamais seul : il est toujours accompagné du
   détail qui l'explique, conformément au principe du "pourquoi" qui gouverne
   le reste de l'application.
   -------------------------------------------------------------------------- */

const POIDS_READINESS = { sommeil: 0.22, stress: 0.13, charge: 0.30, douleur: 0.15, regularite: 0.20 };

function joursConsecutifsEntraines(seances, dateKey) {
  let n = 0;
  const d = new Date(dateKey);
  for (let i = 0; i < 14; i++) {
    const actif = seances.some((s) => s.date === todayKey(d));
    if (!actif) break;
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function rpeMoyen7j(seances, dateKey) {
  const debut = new Date(dateKey); debut.setDate(debut.getDate() - 7);
  const valeurs = [];
  seances.filter((s) => new Date(s.date) >= debut).forEach((s) => {
    Object.values(s.logs || {}).flat().forEach((x) => { if (x.rpe != null) valeurs.push(x.rpe); });
  });
  return valeurs.length ? valeurs.reduce((a, b) => a + b, 0) / valeurs.length : null;
}

function scoreSommeil(h) {
  if (h == null) return { score: 70, etat: "non renseigné", detail: "Renseigne les heures de cette nuit pour un score plus juste." };
  // Courbe par paliers plutôt qu'une chute linéaire symétrique : le manque de
  // sommeil coûte plus cher, plus vite, que l'excès n'en coûte à l'inverse.
  // 4h30 doit tomber nettement sous la moyenne, pas juste "moyen".
  const points = [[3, 5], [4.5, 25], [6, 55], [7, 78], [7.75, 95], [9, 100], [10, 80], [11, 55]];
  let score = points[points.length - 1][1];
  if (h <= points[0][0]) score = points[0][1];
  else if (h >= points[points.length - 1][0]) score = points[points.length - 1][1];
  else {
    for (let i = 0; i < points.length - 1; i++) {
      const [h1, s1] = points[i], [h2, s2] = points[i + 1];
      if (h >= h1 && h <= h2) { score = Math.round(s1 + (s2 - s1) * ((h - h1) / (h2 - h1))); break; }
    }
  }
  const etat = score >= 75 ? "bon" : score >= 45 ? "moyen" : "faible";
  const detail = h < 5 ? `${h} h dormies : très en dessous du seuil de récupération.`
    : h < 6.5 ? `${h} h dormies : nettement insuffisant pour une séance normale.`
    : score >= 75 ? `${h} h dormies : dans la fourchette utile.`
    : `${h} h dormies : correct sans être optimal.`;
  return { score, etat, detail };
}

function scoreStress(niveau) {
  const n = niveau ?? 3;
  const score = Math.round(((5 - n) / 4) * 100);
  return { score, etat: score >= 70 ? "bon" : score >= 40 ? "moyen" : "élevé", detail: `Stress perçu ${n}/5.` };
}

function scoreCharge(seances, dateKey) {
  const consecutifs = joursConsecutifsEntraines(seances, dateKey);
  const rpe = rpeMoyen7j(seances, dateKey);
  let score = 100 - Math.max(0, consecutifs - 2) * 14 - (rpe != null ? Math.max(0, rpe - 7.5) * 18 : 0);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const morceaux = [];
  if (consecutifs >= 3) morceaux.push(`${consecutifs} jours d'affilée sans repos`);
  if (rpe != null && rpe >= 8) morceaux.push(`RPE moyen ${rpe.toFixed(1)} sur 7 jours`);
  return { score, etat: score >= 70 ? "bonne" : score >= 40 ? "moyenne" : "élevée", detail: morceaux.join(" · ") || "Charge récente maîtrisée." };
}

function scoreDouleur(niveau) {
  const n = niveau ?? 0;
  const score = Math.max(0, 100 - n * 14);
  return { score, etat: n === 0 ? "aucune" : n <= 3 ? "faible" : n <= 6 ? "modérée" : "élevée",
    detail: n === 0 ? "Aucune gêne déclarée." : `Gêne déclarée à ${n}/10.` };
}

function scoreRegularite(seances, prog, dateKey) {
  if (!prog) return { score: 80, etat: "n/a", detail: "Programme non généré." };
  const auj = new Date(dateKey);
  const debutSem = new Date(auj); debutSem.setDate(auj.getDate() - ((auj.getDay() + 6) % 7));
  const sem = seances.filter((s) => new Date(s.date) >= debutSem).length;
  const cible = prog.frequence || 4;
  const score = Math.max(0, Math.min(100, Math.round(100 - Math.abs(sem / cible - 1) * 60)));
  return { score, etat: score >= 70 ? "bonne" : score >= 40 ? "moyenne" : "à surveiller",
    detail: `${sem} séance${sem > 1 ? "s" : ""} cette semaine, cible ${cible}.` };
}

function evaluerReadiness(profil, jour, entrainement, dateKey) {
  const s = scoreSommeil(jour.sommeilNuit ?? profil.sommeil);
  const st = scoreStress(jour.stressJour ?? profil.stress);
  const c = scoreCharge(entrainement.seances, dateKey);
  const d = scoreDouleur(jour.douleur);
  const r = scoreRegularite(entrainement.seances, entrainement.programme, dateKey);

  const score = Math.round(
    s.score * POIDS_READINESS.sommeil + st.score * POIDS_READINESS.stress +
    c.score * POIDS_READINESS.charge + d.score * POIDS_READINESS.douleur +
    r.score * POIDS_READINESS.regularite
  );

  const facteurs = [
    { cle: "sommeil", nom: "Sommeil", ...s }, { cle: "stress", nom: "Stress", ...st },
    { cle: "charge", nom: "Charge récente", ...c }, { cle: "douleur", nom: "Douleur", ...d },
    { cle: "regularite", nom: "Régularité", ...r },
  ];

  let decision = "normale", adaptation = null;
  if (score < 45) {
    decision = "repos";
    adaptation = { volumeMult: 0.55, rpePlafondDelta: -2,
      message: "Ce score justifie un repos complet ou une séance très allégée, technique uniquement et loin de l'échec. Ce n'est pas de la faiblesse, c'est de la gestion." };
  } else if (score < 70) {
    decision = "adaptee";
    adaptation = { volumeMult: 0.8, rpePlafondDelta: -1,
      message: "Volume réduit d'environ 20 % et RPE plafonné un cran plus bas. Les mouvements principaux restent, les séries d'isolation sautent en premier." };
  }
  return { score, decision, facteurs, adaptation };
}

/* --------------------------------------------------------------------------
   MOTEUR D'ACTIONS
   Le coach ne se contente plus d'expliquer ce que l'utilisateur pourrait
   faire : il lui permet de le faire. Chaque action déclare ce qu'elle change,
   sait produire le détail avant/après, et reste annulable. Rien ne s'applique
   sans validation explicite.
   -------------------------------------------------------------------------- */

/* Réduit le volume et l'intensité d'un programme sans le régénérer : les
   exercices choisis restent les mêmes, seule la dose change. Régénérer
   ferait perdre la continuité avec l'historique de charges. */
function adapterProgramme(prog, { volumeMult = 1, rpeDelta = 0, motif = null }) {
  if (!prog) return prog;
  return {
    ...prog,
    adapte: { volumeMult, rpeDelta, motif, le: new Date().toISOString() },
    seances: prog.seances.map((sc) => ({
      ...sc,
      exos: sc.exos.map((e) => ({
        ...e,
        series: Math.max(2, Math.round(e.series * volumeMult)),
        rpe: [Math.max(5, e.rpe[0] + rpeDelta), Math.max(5, e.rpe[1] + rpeDelta)],
        // Les techniques d'intensification sautent en premier : ce sont elles
        // qui coûtent le plus en récupération pour le stimulus qu'elles ajoutent.
        techniques: volumeMult < 0.9 ? [] : e.techniques,
      })),
    })),
  };
}

const totalSeries = (prog) => (prog?.seances || []).reduce((s, sc) => s + sc.exos.reduce((a, e) => a + e.series, 0), 0);

const ACTIONS_COACH = {
  adapter_seance: {
    nom: "Adapter la séance",
    valider: (p) => typeof p?.volumeMult === "number" && p.volumeMult >= 0.4 && p.volumeMult <= 1,
    diff: (p, app) => {
      const av = app.entrainement.programme;
      const ap = adapterProgramme(av, p);
      return [
        { champ: "Séries sur la semaine", avant: totalSeries(av), apres: totalSeries(ap) },
        { champ: "Plafond de RPE", avant: "inchangé", apres: `${p.rpeDelta || 0} point${Math.abs(p.rpeDelta || 0) > 1 ? "s" : ""}` },
        { champ: "Techniques d'intensification", avant: "actives", apres: p.volumeMult < 0.9 ? "retirées" : "actives" },
      ];
    },
    appliquer: (p, app) => {
      const avant = app.entrainement.programme;
      app.setEntrainement({ ...app.entrainement, programme: adapterProgramme(avant, { ...p, motif: "adaptation" }) });
      return { programme: avant };
    },
    annuler: (snap, app) => app.setEntrainement({ ...app.entrainement, programme: snap.programme }),
  },

  activer_deload: {
    nom: "Passer en décharge",
    valider: () => true,
    diff: (p, app) => {
      const av = app.entrainement.programme;
      const ap = adapterProgramme(av, { volumeMult: 0.55, rpeDelta: -1 });
      return [
        { champ: "Séries sur la semaine", avant: totalSeries(av), apres: totalSeries(ap) },
        { champ: "Plafond de RPE", avant: "normal", apres: "-1 point" },
        { champ: "Techniques d'intensification", avant: "actives", apres: "retirées" },
      ];
    },
    appliquer: (p, app) => {
      const avant = app.entrainement.programme;
      app.setEntrainement({ ...app.entrainement, programme: adapterProgramme(avant, { volumeMult: 0.55, rpeDelta: -1, motif: "décharge" }) });
      return { programme: avant };
    },
    annuler: (snap, app) => app.setEntrainement({ ...app.entrainement, programme: snap.programme }),
  },

  appliquer_cible_calorique: {
    nom: "Appliquer cette cible",
    valider: (p) => ["kcal", "prot", "gluc", "lip"].some((k) => typeof p?.[k] === "number"),
    diff: (p, app) => {
      const o = app.objectifsCourants || {};
      return ["kcal", "prot", "gluc", "lip"].filter((k) => typeof p[k] === "number").map((k) => ({
        champ: { kcal: "Calories", prot: "Protéines", gluc: "Glucides", lip: "Lipides" }[k],
        avant: o[k] != null ? Math.round(o[k]) : "calcul auto", apres: Math.round(p[k]),
      }));
    },
    appliquer: (p, app) => {
      const avant = app.profil.overrides || {};
      const maj = { ...avant };
      ["kcal", "prot", "gluc", "lip"].forEach((k) => { if (typeof p[k] === "number") maj[k] = p[k]; });
      app.setProfil({ ...app.profil, overrides: maj });
      return { overrides: avant };
    },
    annuler: (snap, app) => app.setProfil({ ...app.profil, overrides: snap.overrides }),
  },

  changer_split: {
    nom: "Changer de structure",
    valider: (p) => !!SPLITS.find((s) => s.id === p?.splitId),
    diff: (p, app) => {
      const s = SPLITS.find((x) => x.id === p.splitId);
      return [
        { champ: "Structure", avant: app.entrainement.programme?.splitNom || "aucune", apres: s?.nom || p.splitId },
        { champ: "Séances par semaine", avant: app.entrainement.programme?.frequence ?? "—", apres: s?.freq ?? "—" },
      ];
    },
    appliquer: (p, app) => {
      const avant = { programme: app.entrainement.programme, splitId: app.profil.splitId };
      const semaine = app.entrainement.programme?.semaine || 1;
      app.setEntrainement({ ...app.entrainement, programme: genererProgramme(app.profil, p.splitId, semaine) });
      app.setProfil({ ...app.profil, splitId: p.splitId });
      return avant;
    },
    annuler: (snap, app) => {
      app.setEntrainement({ ...app.entrainement, programme: snap.programme });
      app.setProfil({ ...app.profil, splitId: snap.splitId });
    },
  },

  ajouter_courses: {
    nom: "Ajouter aux courses",
    valider: (p) => Array.isArray(p?.articles) && p.articles.length > 0 && p.articles.every((x) => typeof x === "string"),
    diff: (p) => p.articles.slice(0, 12).map((a) => ({ champ: a, avant: "absent", apres: "ajouté" })),
    appliquer: (p, app) => {
      const avant = app.cuisine.courses || [];
      app.setCuisine({ ...app.cuisine, courses: [...new Set([...avant, ...p.articles])] });
      return { courses: avant };
    },
    annuler: (snap, app) => app.setCuisine({ ...app.cuisine, courses: snap.courses }),
  },
};

/* Extrait les blocs d'action de la réponse du modèle. Tout bloc mal formé ou
   portant un nom d'action inconnu est ignoré silencieusement : mieux vaut une
   réponse en texte seul qu'un bouton qui casserait les données. */
function extraireActions(texte) {
  if (!texte) return { texte: "", actions: [] };
  const re = /```action\s*([\s\S]*?)```/g;
  const actions = [];
  let m;
  while ((m = re.exec(texte)) !== null) {
    try {
      const o = JSON.parse(m[1].trim());
      const def = ACTIONS_COACH[o?.action];
      if (def && def.valider(o.params || {})) actions.push({ action: o.action, params: o.params || {}, resume: o.resume || def.nom, pourquoi: o.pourquoi || "" });
    } catch (e) { /* bloc illisible : on l'ignore et on garde le texte */ }
  }
  return { texte: texte.replace(re, "").trim(), actions: actions.slice(0, 1) };
}

/* --------------------------------------------------------------------------
   POURQUOI JE STAGNE ?
   Croise l'historique de charges, le volume par groupe, la récupération et
   l'alimentation. Chaque cause porte un niveau de confiance explicite, calé
   sur la quantité de données réellement disponibles — une cause déduite de
   trois jours de journal ne vaut pas une cause déduite de trois semaines.
   -------------------------------------------------------------------------- */

const CONFIANCE = { faible: "faible", moyen: "moyen", eleve: "élevé" };

function exercicesStagnants(historique) {
  const out = [];
  Object.entries(historique || {}).forEach(([exId, series]) => {
    if (!series || series.length < 4) return;
    const h = series.slice(-4);
    const e1 = epley(h[0].charge, h[0].reps), e4 = epley(h[3].charge, h[3].reps);
    if (e4 <= e1 * 1.005) out.push({ exId, nom: exById(exId)?.nom || exId, depart: Math.round(e1), arrivee: Math.round(e4), seances: h.length });
  });
  return out;
}

function diagnostiquerStagnation(app) {
  const { entrainement, profil, journalMois, jour, dateKey } = app;
  const stagnants = exercicesStagnants(entrainement.historiqueCharges);
  const causes = [];
  const prog = entrainement.programme;
  const niv = NIV(profil);

  // 1 — Volume hebdomadaire sous la fourchette utile
  const vol = volumeParGroupe(entrainement.seances, 2);
  const basVolume = vol.filter((v) => v.series < FOURCHETTE_VOLUME[0]);
  if (basVolume.length) {
    causes.push({
      titre: "Volume insuffisant sur certains groupes",
      detail: `${basVolume.map((v) => GROUPES_MUSCULAIRES[v.groupe]?.nom || v.groupe).join(", ")} ${basVolume.length > 1 ? "reçoivent" : "reçoit"} moins de ${FOURCHETTE_VOLUME[0]} séries efficaces par semaine. Le volume est le premier levier de l'hypertrophie : en dessous de cette fourchette, le stimulus est trop faible pour forcer une adaptation.`,
      confiance: entrainement.seances.length >= 6 ? CONFIANCE.eleve : CONFIANCE.moyen,
      action: null,
    });
  }

  // 2 — Séries menées trop loin de l'échec
  const toutesSeries = entrainement.seances.slice(-8).flatMap((s) => Object.values(s.logs || {}).flat());
  const avecRpe = toutesSeries.filter((x) => x.rpe != null);
  if (avecRpe.length >= 10) {
    const moy = avecRpe.reduce((a, b) => a + b.rpe, 0) / avecRpe.length;
    if (moy < 7) {
      causes.push({
        titre: "Séries arrêtées trop loin de l'échec",
        detail: `RPE moyen de ${moy.toFixed(1)} sur tes dernières séances. En dessous de 7, il reste plus de trois répétitions en réserve : la série ne compte quasiment pas comme stimulus. Ajouter du volume ne servirait à rien tant que l'intensité n'est pas corrigée.`,
        confiance: CONFIANCE.eleve, action: null,
      });
    }
  }

  // 3 — Décharge sautée
  if (prog && prog.semaine >= niv.deloadToutes && !prog.deload && !prog.adapte) {
    causes.push({
      titre: "Aucune décharge depuis trop longtemps",
      detail: `Tu es en semaine ${prog.semaine} et ton niveau appelle une décharge toutes les ${niv.deloadToutes} semaines. La fatigue accumulée masque l'adaptation : c'est la cause de stagnation la plus fréquente chez les pratiquants assidus, et la plus facile à corriger.`,
      confiance: CONFIANCE.eleve,
      action: { action: "activer_deload", params: {}, resume: "Je passe la semaine en cours en décharge.", pourquoi: "Volume à 55 % et RPE abaissé d'un point pour laisser la supercompensation s'exprimer." },
    });
  }

  // 4 — Récupération dégradée
  const r = evaluerReadiness(profil, jour, entrainement, dateKey);
  const facteursFaibles = r.facteurs.filter((f) => f.score < 50);
  if (facteursFaibles.length) {
    causes.push({
      titre: "Récupération dégradée",
      detail: `${facteursFaibles.map((f) => `${f.nom.toLowerCase()} — ${f.detail}`).join(" ")} Un système nerveux fatigué ne produit pas de force, quelle que soit la qualité du programme.`,
      confiance: (jour.sommeilNuit != null || jour.douleur) ? CONFIANCE.moyen : CONFIANCE.faible,
      action: r.adaptation ? { action: "adapter_seance", params: { volumeMult: r.adaptation.volumeMult, rpeDelta: r.adaptation.rpePlafondDelta }, resume: "J'allège la séance en fonction de ton score de readiness.", pourquoi: r.adaptation.message } : null,
    });
  }

  // 5 — Apport énergétique incompatible avec l'objectif
  const joursNutri = Object.keys(journalMois || {}).sort().slice(-14)
    .map((k) => totauxJour(journalMois[k])).filter((t) => t.kcal > 200);
  if (joursNutri.length >= 4) {
    const obj = objectifsDuJour(profil, jour);
    const moyKcal = joursNutri.reduce((a, b) => a + b.kcal, 0) / joursNutri.length;
    const moyProt = joursNutri.reduce((a, b) => a + b.prot, 0) / joursNutri.length;
    if (moyKcal < obj.maintenance * 0.95 && (profil.objNutrition === "lean_bulk" || profil.objNutrition === "bulk_rapide" || profil.objNutrition === "force_stable")) {
      causes.push({
        titre: "Apport calorique sous la maintenance",
        detail: `${Math.round(moyKcal)} kcal en moyenne sur ${joursNutri.length} jours, pour une maintenance estimée à ${obj.maintenance} kcal, alors que ton objectif est une prise. Construire du muscle en déficit est possible en début de pratique, beaucoup moins à ton niveau.`,
        confiance: joursNutri.length >= 10 ? CONFIANCE.eleve : CONFIANCE.moyen,
        action: { action: "appliquer_cible_calorique", params: { kcal: Math.round(obj.maintenance * 1.1) }, resume: `Je passe ta cible à ${Math.round(obj.maintenance * 1.1)} kcal.`, pourquoi: "Un surplus modéré d'environ 10 % suffit à soutenir la construction musculaire sans gain de gras excessif." },
      });
    }
    if (moyProt < obj.prot * 0.85) {
      causes.push({
        titre: "Apport protéique sous la cible",
        detail: `${Math.round(moyProt)} g par jour en moyenne pour une cible de ${obj.prot} g. La récupération entre séances ralentit et la progression de charge s'arrête avant que le muscle n'ait pu s'adapter.`,
        confiance: joursNutri.length >= 10 ? CONFIANCE.eleve : CONFIANCE.moyen, action: null,
      });
    }
  } else {
    causes.push({
      titre: "Données alimentaires insuffisantes",
      detail: "Moins de quatre jours de journal exploitables sur les deux dernières semaines. Impossible de dire si la nutrition est en cause : c'est pourtant la première chose à vérifier avant de toucher au programme.",
      confiance: CONFIANCE.faible, action: null,
    });
  }

  // 6 — Fréquence réelle sous la fréquence prévue
  if (prog) {
    const debut = new Date(dateKey); debut.setDate(debut.getDate() - 21);
    const faites = entrainement.seances.filter((s) => new Date(s.date) >= debut).length;
    const attendues = (prog.frequence || 4) * 3;
    if (faites < attendues * 0.7) {
      causes.push({
        titre: "Fréquence réelle inférieure au programme",
        detail: `${faites} séances sur les trois dernières semaines, contre ${attendues} prévues. Un programme n'agit que s'il est suivi : à ce rythme, c'est la régularité qu'il faut corriger avant les paramètres.`,
        confiance: CONFIANCE.eleve, action: null,
      });
    }
  }

  const ordre = { [CONFIANCE.eleve]: 0, [CONFIANCE.moyen]: 1, [CONFIANCE.faible]: 2 };
  causes.sort((a, b) => ordre[a.confiance] - ordre[b.confiance]);
  return { stagnants, causes, donneesSuffisantes: entrainement.seances.length >= 4 };
}

/* ==========================================================================
   SYSTÈME D'INTERFACE
   ========================================================================== */

const CSS = `
${FONTS}
:root { color-scheme: dark; }
* { -webkit-tap-highlight-color: transparent; }
.fit-root { font-family: ${FF.body}; background: ${THEME.noir}; color: ${THEME.craie};
  min-height: 100vh; min-height: 100dvh; overscroll-behavior-y: contain; }
.fit-root ::-webkit-scrollbar { width: 0; height: 0; }
.fit-scroll { -webkit-overflow-scrolling: touch; scroll-behavior: smooth; }
.fit-display { font-family: ${FF.display}; letter-spacing: -0.02em; }
.fit-data { font-family: ${FF.data}; font-variant-numeric: tabular-nums; }
.fit-eyebrow { font-family: ${FF.data}; font-size: max(11px, 0.69rem); letter-spacing: 0.14em;
  text-transform: uppercase; color: ${THEME.gris}; font-weight: 500; }
/* Dynamic Type : les tailles suivent le réglage système, avec un plancher
   lisible. Sous 11 px, un texte devient inconfortable pour beaucoup de monde. */
.fit-root { font-size: 100%; }
.fit-min { font-size: max(11px, 0.7rem) !important; }
@media (prefers-contrast: more) {
  .fit-root { --contraste: 1; }
  .fit-eyebrow { color: ${THEME.craie}; }
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.fit-input { font-size: 16px; font-family: ${FF.data}; background: ${THEME.surface2};
  border: 1px solid ${THEME.rule}; border-radius: 10px; color: ${THEME.craie};
  padding: 12px 14px; width: 100%; outline: none; }
.fit-input:focus-visible { border-color: ${THEME.craie}; box-shadow: 0 0 0 2px rgba(237,234,227,.25); }
button:focus-visible, [role="button"]:focus-visible { outline: 2px solid ${THEME.craie}; outline-offset: 2px; }
.fit-tap { min-height: 44px; min-width: 44px; }
.fit-sheet { animation: fitUp .22s cubic-bezier(.2,.8,.2,1); }
@keyframes fitUp { from { transform: translateY(14px); opacity: 0 } to { transform: none; opacity: 1 } }
.fit-fade { animation: fitFade .18s ease-out; }
@keyframes fitFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes glypheMonte { from { transform: scaleY(.15); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes fitEcran { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.fit-ecran { animation: fitEcran .26s cubic-bezier(.2,.8,.2,1) }
/* Verre fumé sur fonte : la profondeur vient de la lumière rasante en haut de
   carte, pas d'une teinte pastel. Le fond reste noir OLED. */
.fit-verre { background: linear-gradient(158deg, rgba(255,255,255,.062), rgba(255,255,255,.014) 46%, rgba(0,0,0,.20));
  backdrop-filter: blur(22px) saturate(1.25); -webkit-backdrop-filter: blur(22px) saturate(1.25);
  border: 1px solid rgba(255,255,255,.10); box-shadow: 0 18px 44px -22px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.11) }
.fit-scene { perspective: 1400px; perspective-origin: 50% 42% }
.fit-piste { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory;
  transform-style: preserve-3d; padding: 22px 0 26px; scrollbar-width: none }
.fit-piste > * { scroll-snap-align: center; flex: 0 0 auto; transform-style: preserve-3d;
  transition: transform .42s cubic-bezier(.2,.8,.2,1), opacity .42s, filter .42s }
.fit-atmo { position: fixed; inset: 0; pointer-events: none; z-index: 0;
  background:
    radial-gradient(84% 50% at 14% -6%, rgba(228,50,43,.13), transparent 62%),
    radial-gradient(76% 46% at 92% 4%, rgba(53,119,214,.11), transparent 60%),
    radial-gradient(120% 62% at 50% 108%, rgba(242,194,48,.055), transparent 66%) }
.fit-grain { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: .17;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px) }
.fit-lueur { position: relative }
.fit-lueur::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 0%, rgba(237,234,227,.055), transparent 62%) }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important } }
input[type=range] { -webkit-appearance: none; height: 4px; background: ${THEME.rule}; border-radius: 2px; }
input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 26px; height: 26px;
  border-radius: 50%; background: ${THEME.craie}; border: 3px solid ${THEME.noir}; }
`;

const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch (e) { /* vibreur absent, iOS notamment */ } };

/* Signal sonore de fin de repos — synthétisé, aucun fichier à charger */
function sonnerie() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.52);
    setTimeout(() => ctx.close(), 900);
  } catch (e) { /* audio indisponible, le retour visuel suffit */ }
}
const C = (k) => THEME[k] || THEME.craie;
const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateFr = (k) => { const [, m, d] = k.split("-"); return `${d}/${m}`; };
const JOURS_FR = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];


/* Carte de verre — même API que Card, traitement de surface différent */
function CarteVerre({ children, style, onClick, accent, className = "" }) {
  const interactif = !!onClick;
  return (
    <div onClick={onClick} role={interactif ? "button" : undefined} tabIndex={interactif ? 0 : undefined}
      onKeyDown={interactif ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={`fit-verre rounded-2xl overflow-hidden ${className}`}
      style={{ borderLeft: accent ? `3px solid ${C(accent)}` : undefined, ...style }}>
      {children}
    </div>
  );
}

/* Carrousel en perspective — les cartes latérales pivotent et reculent,
   celle du centre revient de face. Le défilement reste natif, donc fluide
   au doigt, et chaque carte s'aimante au centre. */
function Carrousel({ enfants, largeur = 232, titre, sousTitre }) {
  const piste = useRef(null);
  const [centre, setCentre] = useState(0);

  const recalculer = useCallback(() => {
    const el = piste.current; if (!el) return;
    const milieu = el.scrollLeft + el.clientWidth / 2;
    let meilleur = 0, ecartMin = Infinity;
    Array.from(el.children).forEach((carte, i) => {
      const c = carte.offsetLeft + carte.offsetWidth / 2;
      const d = c - milieu;
      const norm = Math.max(-1.6, Math.min(1.6, d / (largeur * 0.94)));
      carte.style.transform = `rotateY(${norm * -26}deg) translateZ(${-Math.abs(norm) * 108}px) scale(${1 - Math.abs(norm) * 0.055})`;
      carte.style.opacity = String(Math.max(0.34, 1 - Math.abs(norm) * 0.46));
      carte.style.filter = `saturate(${Math.max(0.5, 1 - Math.abs(norm) * 0.45)})`;
      carte.style.zIndex = String(100 - Math.round(Math.abs(norm) * 50));
      if (Math.abs(d) < ecartMin) { ecartMin = Math.abs(d); meilleur = i; }
    });
    setCentre(meilleur);
  }, [largeur]);

  useEffect(() => {
    recalculer();
    const el = piste.current; if (!el) return;
    el.addEventListener("scroll", recalculer, { passive: true });
    window.addEventListener("resize", recalculer);
    return () => { el.removeEventListener("scroll", recalculer); window.removeEventListener("resize", recalculer); };
  }, [recalculer, enfants.length]);

  const bord = "max(16px, calc(50vw - " + Math.round(largeur / 2) + "px - 20px))";
  return (
    <div>
      {titre && (
        <div className="flex items-end justify-between mb-1">
          <div>
            <h2 className="fit-display" style={{ fontSize: 21, lineHeight: 1.1 }}>{titre}</h2>
            {sousTitre && <div className="fit-eyebrow" style={{ marginTop: 4 }}>{sousTitre}</div>}
          </div>
          <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{centre + 1}/{enfants.length}</span>
        </div>
      )}
      <div className="fit-scene" style={{ marginLeft: -20, marginRight: -20 }}>
        <div ref={piste} className="fit-piste" style={{ paddingLeft: bord, paddingRight: bord }}>
          {enfants.map((n, i) => <div key={i} style={{ width: largeur }}>{n}</div>)}
        </div>
      </div>
      <div className="flex justify-center gap-1.5" style={{ marginTop: -8 }}>
        {enfants.map((_, i) => (
          <span key={i} style={{ width: i === centre ? 16 : 5, height: 5, borderRadius: 3,
            background: i === centre ? THEME.craie : THEME.rule, transition: "width .3s, background .3s" }} />
        ))}
      </div>
    </div>
  );
}

/* Enveloppe de graphique : affiche un substitut de la bonne hauteur pendant le
   chargement, pour que la mise en page ne saute pas. */
function Graphique({ hauteur = 160, rendu, aria }) {
  const [R, setR] = useState(RC);
  const [echec, setEchec] = useState(false);
  useEffect(() => {
    if (R) return;
    let vivant = true;
    chargerRecharts().then((m) => vivant && setR(m)).catch(() => vivant && setEchec(true));
    return () => { vivant = false; };
  }, [R]);
  if (echec) return (
    <div style={{ height: hauteur, display: "grid", placeItems: "center" }}>
      <span className="fit-eyebrow">Graphique indisponible hors connexion</span>
    </div>
  );
  if (!R) return (
    <div style={{ height: hauteur, borderRadius: 12, background: "linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.06), rgba(255,255,255,.03))" }}
      aria-busy="true" aria-label="Chargement du graphique" />
  );
  return (
    <div style={{ height: hauteur }} role="img" aria-label={aria || "Graphique"}>
      <R.ResponsiveContainer width="100%" height="100%">{rendu(R)}</R.ResponsiveContainer>
    </div>
  );
}

function Eyebrow({ children, right }) {
  return (
    <div className="flex items-end gap-3 mb-3">
      <span className="fit-eyebrow whitespace-nowrap">{children}</span>
      <span className="flex-1 h-px" style={{ background: THEME.rule }} />
      {right}
    </div>
  );
}

function Card({ children, style, onClick, accent }) {
  const interactif = !!onClick;
  return (
    <div onClick={onClick}
      role={interactif ? "button" : undefined} tabIndex={interactif ? 0 : undefined}
      onKeyDown={interactif ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className="rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(158deg, rgba(255,255,255,.045), rgba(255,255,255,.008) 52%, rgba(0,0,0,.16))",
        border: `1px solid ${THEME.rule}`, boxShadow: "0 12px 30px -20px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.055)",
        borderLeft: accent ? `3px solid ${C(accent)}` : `1px solid ${THEME.rule}`, ...style }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", full, small, disabled, icon: Icon, style, ariaLabel }) {
  const v = {
    primary: { background: THEME.craie, color: THEME.noir, border: "none" },
    ghost: { background: "transparent", color: THEME.craie, border: `1px solid ${THEME.rule}` },
    danger: { background: "transparent", color: THEME.rouge, border: `1px solid ${THEME.rouge}` },
    solidAccent: { background: THEME.rouge, color: "#fff", border: "none" },
  }[variant];
  return (
    <button onClick={() => { if (!disabled) { haptic(); onClick?.(); } }} disabled={disabled}
      aria-label={ariaLabel || (typeof children === "string" && children.trim() ? undefined : "Action")}
      className={`fit-tap rounded-xl font-semibold flex items-center justify-center gap-2 ${full ? "w-full" : ""}`}
      style={{ ...v, opacity: disabled ? 0.4 : 1, padding: small ? "8px 14px" : "13px 18px",
        fontSize: small ? 13 : 15, ...style }}>
      {Icon && <Icon size={small ? 15 : 17} />}{children}
    </button>
  );
}

function NumField({ label, value, onChange, suffix, step = 1, placeholder }) {
  return (
    <label className="block">
      {label && <div className="fit-eyebrow mb-1.5">{label}</div>}
      <div className="relative">
        <input className="fit-input" inputMode="decimal" type="text" placeholder={placeholder}
          value={value ?? ""} onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (v === "") return onChange(null);
            if (/^\d*\.?\d*$/.test(v)) onChange(v.endsWith(".") ? v : parseFloat(v));
          }} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 fit-data text-xs" style={{ color: THEME.gris }}>{suffix}</span>}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder, multi }) {
  return (
    <label className="block">
      {label && <div className="fit-eyebrow mb-1.5">{label}</div>}
      {multi
        ? <textarea className="fit-input" rows={3} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: FF.body }} />
        : <input className="fit-input" value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: FF.body }} />}
    </label>
  );
}

function Segmented({ options, value, onChange, cols }) {
  return (
    <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${cols || Math.min(options.length, 3)}, minmax(0,1fr))` }}>
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button key={o.v} onClick={() => { haptic(); onChange(o.v); }} className="fit-tap rounded-lg px-2 text-center"
            style={{ background: on ? THEME.craie : THEME.surface2, color: on ? THEME.noir : THEME.gris,
              border: `1px solid ${on ? THEME.craie : THEME.rule}`, fontSize: 13, fontWeight: on ? 700 : 500, lineHeight: 1.2, padding: "10px 6px" }}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

/* SIGNATURE 1 — « Le pourquoi » : chaque prescription porte sa justification,
   attachée par un filet vertical de la couleur du disque correspondant. */
function Pourquoi({ titre = "Le pourquoi", couleur = "craie", children, ouvertParDefaut }) {
  const [open, setOpen] = useState(!!ouvertParDefaut);
  return (
    <div className="mt-2.5">
      <button onClick={() => { haptic(6); setOpen(!open); }} className="flex items-center gap-2 py-1"
        style={{ color: C(couleur) }}>
        <span className="fit-eyebrow" style={{ color: C(couleur) }}>{titre}</span>
        <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>
      {open && (
        <div className="fit-fade pl-3 mt-1" style={{ borderLeft: `2px solid ${C(couleur)}` }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: THEME.craie, opacity: 0.88 }}>{children}</div>
        </div>
      )}
    </div>
  );
}

/* SIGNATURE 2 — Le chargement de barre en disques calibrés.
   Fonctionnel au rack : c'est le calcul que tout pratiquant fait de tête. */
function PlateStack({ total, barre = 20 }) {
  const { possible, cote, reste } = chargerBarre(total, barre);
  if (!possible) return <div className="fit-data text-xs" style={{ color: THEME.gris }}>Sous le poids de la barre ({barre} kg)</div>;
  const H = { 25: 34, 20: 32, 15: 29, 10: 25, 5: 20, 2.5: 15, 1.25: 12 };
  return (
    <div>
      <div className="flex items-center gap-0.5 h-9">
        <div style={{ width: 26, height: 5, background: THEME.gris2, borderRadius: 2 }} />
        {cote.map((d, i) => (
          <div key={i} title={`${d.kg} kg`} style={{
            width: d.kg >= 15 ? 9 : d.kg >= 5 ? 7 : 5, height: H[d.kg],
            background: d.c === "gris" ? THEME.gris2 : C(d.c), borderRadius: 2,
            border: d.c === "blanc" ? `1px solid ${THEME.gris2}` : "none",
          }} />
        ))}
        <div style={{ width: 8, height: 8, background: THEME.gris2, borderRadius: 2, marginLeft: 2 }} />
        <span className="fit-data ml-2.5" style={{ fontSize: 11, color: THEME.gris }}>
          {cote.map((d) => d.kg).join(" · ") || "barre nue"} <span style={{ opacity: .6 }}>par côté</span>
        </span>
      </div>
      {reste > 0 && <div className="fit-data text-xs mt-0.5" style={{ color: THEME.jaune }}>
        Charge non atteignable exactement — {reste} kg par côté manquants, arrondis à {Math.round((total - reste * 2) * 2) / 2} kg.
      </div>}
    </div>
  );
}

/* Barre de progression avec tolérance ±5 % — A.2 */
function MacroBar({ label, val, cible, unite = "g", couleur }) {
  const pct = cible > 0 ? (val / cible) * 100 : 0;
  const dansCible = pct >= 95 && pct <= 105;
  const w = Math.min(pct, 118);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="fit-eyebrow">{label}</span>
        <span className="fit-data" style={{ fontSize: 12, color: dansCible ? THEME.vert : THEME.craie }}>
          {Math.round(val)}<span style={{ color: THEME.gris }}>/{Math.round(cible)} {unite}</span>
          {/* Redondance textuelle : la couleur seule exclut les daltoniens,
              soit environ huit pour cent des hommes. */}
          {dansCible && <span aria-label="dans la cible" style={{ color: THEME.vert, marginLeft: 5 }}>✓</span>}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: THEME.surface2 }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{
          width: `${w}%`, background: dansCible ? THEME.vert : C(couleur), transition: "width .35s cubic-bezier(.2,.8,.2,1)" }} />
        <div className="absolute inset-y-0" style={{ left: "95%", width: "10%", background: "rgba(237,234,227,.10)" }} />
      </div>
    </div>
  );
}

function Sheet({ open, onClose, titre, children, plein }) {
  const panneau = useRef(null);
  const ouvrant = useRef(null);
  useEffect(() => {
    if (!open) return;
    ouvrant.current = document.activeElement;
    const h = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      // Piégeage du focus : sans lui, la tabulation sort du panneau et navigue
      // dans la page masquée derrière, ce qui désoriente au lecteur d'écran.
      if (e.key !== "Tab" || !panneau.current) return;
      const cibles = panneau.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!cibles.length) return;
      const premier = cibles[0], dernier = cibles[cibles.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    };
    window.addEventListener("keydown", h);
    const t = setTimeout(() => panneau.current?.querySelector("button, input")?.focus(), 60);
    return () => { window.removeEventListener("keydown", h); clearTimeout(t); ouvrant.current?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: "rgba(0,0,0,.72)" }} onClick={onClose}>
      <div ref={panneau} role="dialog" aria-modal="true" aria-label={titre}
        className="fit-sheet rounded-t-2xl flex flex-col" onClick={(e) => e.stopPropagation()}
        style={{ background: THEME.fonte, borderTop: `1px solid ${THEME.rule}`, maxHeight: plein ? "94dvh" : "86dvh" }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: `1px solid ${THEME.rule}` }}>
          <span className="fit-display" style={{ fontSize: 16 }}>{titre}</span>
          <button onClick={onClose} className="fit-tap flex items-center justify-center" style={{ color: THEME.gris }}><X size={20} /></button>
        </div>
        <div className="fit-scroll overflow-y-auto px-5 py-4" style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }}>{children}</div>
      </div>
    </div>
  );
}

function Vide({ titre, action, onAction, icone: Icone }) {
  return (
    <div className="text-center py-10 px-6">
      {Icone && <Icone size={26} style={{ color: THEME.gris2, margin: "0 auto 12px" }} />}
      <div style={{ fontSize: 14, color: THEME.gris, marginBottom: action ? 14 : 0, lineHeight: 1.5 }}>{titre}</div>
      {action && <Btn small onClick={onAction}>{action}</Btn>}
    </div>
  );
}

function Ligne({ g, d, couleur }) {
  return (
    <div className="flex items-baseline justify-between py-1.5" style={{ borderBottom: `1px solid ${THEME.rule}` }}>
      <span style={{ fontSize: 13, color: THEME.gris }}>{g}</span>
      <span className="fit-data" style={{ fontSize: 13, color: couleur ? C(couleur) : THEME.craie }}>{d}</span>
    </div>
  );
}


/* ==========================================================================
   IDENTITÉ — Wonna Grow Up
   Le glyphe est une barre chargée vue de face : les disques calibrés en
   croissance de gauche à droite disent le nom sans l'écrire.
   ========================================================================== */

const MARQUE = {
  nom: "Wonna Grow Up",
  wordmark: ["WONNA", "GROW UP"],
  signature: "Le pourquoi derrière chaque série.",
};

function Glyphe({ taille = 24, anime }) {
  const barres = [
    { h: 0.38, c: THEME.craie }, { h: 0.58, c: THEME.jaune },
    { h: 0.80, c: THEME.rouge }, { h: 1.0, c: THEME.rouge },
  ];
  return (
    <svg width={taille * 1.25} height={taille} viewBox="0 0 50 40" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <rect x="1" y="18" width="48" height="4" rx="2" fill={THEME.craie} opacity="0.9" />
      {barres.map((b, i) => {
        const w = 5 + i * 1.4, x = 4 + i * 12, h = 34 * b.h;
        return <rect key={i} x={x} y={20 - h / 2} width={w} height={h} rx={2} fill={b.c}
          style={anime ? { animation: `glypheMonte .5s ${i * 0.09}s cubic-bezier(.2,.8,.2,1) both` } : undefined} />;
      })}
    </svg>
  );
}

function Wordmark({ taille = 20, signature }) {
  return (
    <div className="flex items-center gap-3">
      <Glyphe taille={taille * 1.15} />
      <div>
        <div className="fit-display" style={{ fontSize: taille, lineHeight: 0.94, letterSpacing: "-0.035em" }}>
          {MARQUE.wordmark[0]}<br />{MARQUE.wordmark[1]}
        </div>
        {signature && <div className="fit-eyebrow" style={{ marginTop: 6 }}>{MARQUE.signature}</div>}
      </div>
    </div>
  );
}

/* Anneau de progression — le chiffre du jour vit à l'intérieur */
function Anneau({ pct, taille = 176, epaisseur = 9, couleur = "craie", enfant, secondaire }) {
  const r = (taille - epaisseur) / 2 - 1;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(pct, 132));
  const trait = (circ * Math.min(p, 100)) / 100;
  const surplus = p > 100 ? (circ * (p - 100)) / 100 : 0;
  return (
    <div style={{ position: "relative", width: taille, height: taille }}>
      <svg width={taille} height={taille} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={taille / 2} cy={taille / 2} r={r} fill="none" stroke={THEME.surface2} strokeWidth={epaisseur} />
        <circle cx={taille / 2} cy={taille / 2} r={r} fill="none" stroke={C(couleur)} strokeWidth={epaisseur}
          strokeLinecap="round" strokeDasharray={`${trait} ${circ}`}
          style={{ transition: "stroke-dasharray .6s cubic-bezier(.2,.8,.2,1), stroke .3s" }} />
        {surplus > 0 && (
          <circle cx={taille / 2} cy={taille / 2} r={r} fill="none" stroke={THEME.rouge} strokeWidth={epaisseur}
            strokeLinecap="round" strokeDasharray={`${surplus} ${circ}`}
            style={{ transition: "stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)" }} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">{enfant}</div>
      {secondaire}
    </div>
  );
}

function EcranLancement() {
  return (
    <div className="fit-root flex flex-col items-center justify-center gap-5" style={{ minHeight: "100dvh" }}>
      <style>{CSS}</style>
      <Glyphe taille={54} anime />
      <div className="fit-display" style={{ fontSize: 15, letterSpacing: "0.14em", opacity: .82 }}>WONNA GROW UP</div>
    </div>
  );
}

/* ==========================================================================
   ÉTAT DE L'APPLICATION
   ========================================================================== */

const PROFIL_DEFAUT = {
  onboarde: false, prenom: "", sexe: "H", age: 22, taille: 178, poids: 75, mg: null,
  tourTaille: null, tourBras: null, tourCuisse: null,
  niveau: "intermediaire", metier: "assis", pasMoyens: 7000, sommeil: 7, stress: 3,
  alcool: "rare", activitesAnnexes: "", regime: [], allergies: "", aversions: "",
  budget: "moyen", tempsCuisine: 20, blessures: "",
  materiel: ["barre", "halteres", "poulie", "machine", "pdc", "banc"],
  objectif: "hybride", objNutrition: "lean_bulk", vitesse: "moderee", frequence: 4,
  horaireSeance: "soir", zonesSensibles: [], modeAvance: false,
  splitId: null, overrides: {}, echeanceRando: null,
};

const JOUR_VIDE = () => ({ repas: { petitdej: [], dej: [], diner: [], collation: [] }, eau: 0, pas: null, entrainementPrevu: null, seanceFaite: null, sommeilNuit: null, stressJour: null, douleur: 0 });

function totauxJour(jour) {
  const t = { kcal: 0, prot: 0, gluc: 0, lip: 0, sat: 0, sucres: 0, fibres: 0, micros: {} };
  if (!jour) return t;
  Object.values(jour.repas || {}).flat().forEach((it) => {
    const f = it.g / 100;
    t.kcal += it.kcal100 * f; t.prot += it.prot100 * f; t.gluc += it.gluc100 * f;
    t.lip += it.lip100 * f; t.sat += (it.sat100 || 0) * f; t.sucres += (it.sucres100 || 0) * f;
    t.fibres += (it.fibres100 || 0) * f;
    Object.entries(it.micros || {}).forEach(([k, v]) => { t.micros[k] = (t.micros[k] || 0) + v * f; });
  });
  return t;
}

const REPAS_LABELS = { petitdej: "Petit-déjeuner", dej: "Déjeuner", diner: "Dîner", collation: "Collations" };

/* Les séances sont regroupées par trimestre. La clé d'entraînement contenait
   auparavant tout l'historique et était réécrite intégralement à chaque série
   validée : un demi-mégaoctet sérialisé entre deux séries après trois ans. */
const trimestreDe = (dateKey) => {
  const [a, m] = dateKey.split("-");
  return `${a}-T${Math.floor((parseInt(m, 10) - 1) / 3) + 1}`;
};

function moisDe(dateKey) { return dateKey.slice(0, 7); }

/* ==========================================================================
   ÉCRAN — ONBOARDING
   ========================================================================== */

function Onboarding({ profil, setProfil, terminer, app }) {
  const [etape, setEtape] = useState(0);
  const p = profil;
  const set = (k, v) => setProfil({ ...p, [k]: v });

  const etapes = [
    {
      cle: "accueil", titre: "Wonna Grow Up", sous: "Un coach qui explique le pourquoi de chaque série et de chaque gramme. Dix questions, puis ton programme et tes besoins sont calculés.",
      contenu: (
        <div className="space-y-3">
          {[
            ["Chaque prescription porte sa raison", "Pourquoi cinq séries de trois et pas quatre de dix : c'est écrit, à chaque exercice."],
            ["299 exercices fichés", "Muscles ciblés, mécanique de travail, erreurs fréquentes et risque de blessure nommé."],
            ["Nutrition sans dogme", "Aucun aliment interdit, des sources citées, et un niveau de certitude honnête quand la science hésite."],
          ].map(([t, d2]) => (
            <Card key={t} style={{ padding: 14 }}>
              <div className="fit-display" style={{ fontSize: 14 }}>{t}</div>
              <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 5, lineHeight: 1.5 }}>{d2}</div>
            </Card>
          ))}
          <div style={{ fontSize: 11.5, color: THEME.gris2, lineHeight: 1.5 }}>
            Outil d'aide et de pédagogie, pas un dispositif médical. Il ne pose aucun diagnostic et ne remplace ni médecin, ni diététicien, ni kinésithérapeute.
          </div>
        </div>
      ), valide: () => true,
    },
    {
      cle: "base", titre: "L'essentiel", sous: "Le minimum pour calculer ta dépense. Tout s'affine ensuite.",
      contenu: (
        <div className="space-y-3">
          <TextField label="Prénom" value={p.prenom} onChange={(v) => set("prenom", v)} placeholder="Nathan" />
          <Segmented options={[{ v: "H", l: "Homme" }, { v: "F", l: "Femme" }]} value={p.sexe} onChange={(v) => set("sexe", v)} />
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Âge" value={p.age} onChange={(v) => set("age", v)} suffix="ans" />
            <NumField label="Taille" value={p.taille} onChange={(v) => set("taille", v)} suffix="cm" />
            <NumField label="Poids" value={p.poids} onChange={(v) => set("poids", v)} suffix="kg" />
          </div>
        </div>
      ), valide: () => p.age > 12 && p.taille > 120 && p.poids > 35,
    },
    {
      cle: "compo", titre: "Composition", sous: "Facultatif, mais ça change le calcul. Passe si tu ne sais pas.", option: true,
      contenu: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Masse grasse estimée" value={p.mg} onChange={(v) => set("mg", v)} suffix="%" />
            <NumField label="Tour de taille" value={p.tourTaille} onChange={(v) => set("tourTaille", v)} suffix="cm" />
          </div>
          <Pourquoi couleur="bleu" ouvertParDefaut titre="Ce que ça change concrètement">
            Avec le taux de masse grasse, le métabolisme de base passe de Mifflin-St Jeor à Katch-McArdle, qui calcule à partir de la masse maigre : plus précis chez un sujet musclé. Les protéines sont alors calculées sur la masse maigre plutôt que sur le poids total. Le tour de taille sert de garde-fou : s'il grimpe pendant une prise de masse, le surplus est trop élevé.
          </Pourquoi>
        </div>
      ), valide: () => true,
    },
    {
      cle: "niveau", titre: "Ton niveau", sous: "C'est le réglage qui a le plus d'effet. Mieux vaut se sous-estimer : un programme trop léger se corrige en deux semaines, un programme trop lourd coûte une blessure.",
      contenu: (
        <div className="space-y-3">
          {Object.entries(NIVEAUX).map(([k, n]) => (
            <Card key={k} accent={p.niveau === k ? n.couleur : undefined} onClick={() => { haptic(); set("niveau", k); }}
              style={{ padding: 14, cursor: "pointer", opacity: p.niveau === k ? 1 : 0.55 }}>
              <div className="flex items-center justify-between">
                <span className="fit-display" style={{ fontSize: 15 }}>{n.nom}</span>
                {p.niveau === k && <Check size={16} style={{ color: C(n.couleur) }} />}
              </div>
              <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 3 }}>{n.duree}</div>
              {p.niveau === k && (
                <div className="fit-fade mt-3">
                  <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{n.principe}</div>
                  <div className="mt-2.5">
                    {n.changements.map((c, i) => (
                      <div key={i} className="flex gap-2 py-1">
                        <span style={{ color: C(n.couleur), fontSize: 12 }}>—</span>
                        <span style={{ fontSize: 12, lineHeight: 1.45, opacity: .85 }}>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      ), valide: () => true,
    },
    {
      cle: "objectif", titre: "Objectif d'entraînement", sous: "Il pilote les répétitions, les temps de repos et le choix des exercices.",
      contenu: (
        <div className="space-y-3">
          {Object.entries(OBJECTIFS_ENTRAINEMENT).map(([k, o]) => (
            <Card key={k} accent={p.objectif === k ? o.couleur : undefined} onClick={() => { haptic(); set("objectif", k); }}
              style={{ padding: 14, cursor: "pointer", opacity: p.objectif === k ? 1 : 0.55 }}>
              <div className="flex items-center justify-between">
                <span className="fit-display" style={{ fontSize: 14 }}>{o.nom}</span>
                {p.objectif === k && <Check size={16} style={{ color: C(o.couleur) }} />}
              </div>
              <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 6, lineHeight: 1.45 }}>{o.logique.split(".")[0]}.</div>
            </Card>
          ))}
        </div>
      ), valide: () => true,
    },
    {
      cle: "nutri", titre: "Objectif nutritionnel", sous: "Chaque option a ses compromis — ils sont écrits, pas cachés.",
      contenu: (
        <div className="space-y-3">
          {Object.entries(OBJECTIFS_NUTRI).map(([k, o]) => (
            <Card key={k} accent={p.objNutrition === k ? o.couleur : undefined} onClick={() => { haptic(); set("objNutrition", k); }}
              style={{ padding: 14, cursor: "pointer", opacity: p.objNutrition === k ? 1 : 0.55 }}>
              <div className="flex items-center justify-between">
                <span className="fit-display" style={{ fontSize: 14 }}>{o.nom}</span>
                {p.objNutrition === k && <Check size={16} style={{ color: C(o.couleur) }} />}
              </div>
              <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 6, lineHeight: 1.45 }}>{o.vitesse}</div>
              {p.objNutrition === k && <div className="fit-fade mt-2" style={{ fontSize: 12, color: THEME.jaune, lineHeight: 1.45 }}>Compromis — {o.compromis}</div>}
            </Card>
          ))}
          <div>
            <div className="fit-eyebrow mb-2">Vitesse</div>
            <Segmented cols={3} value={p.vitesse} onChange={(v) => set("vitesse", v)} options={[{ v: "douce", l: "Douce" }, { v: "moderee", l: "Modérée" }, { v: "agressive", l: "Agressive" }]} />
          </div>
        </div>
      ), valide: () => true,
    },
    {
      cle: "semaine", titre: "Ta semaine", sous: "La fréquence détermine le split, jamais l'inverse. Le reste sert à estimer ta dépense réelle.",
      contenu: (
        <div className="space-y-4">
          <div>
            <div className="fit-eyebrow mb-2">Séances par semaine</div>
            <Segmented cols={5} value={p.frequence} onChange={(v) => set("frequence", v)} options={[2, 3, 4, 5, 6].map((n) => ({ v: n, l: String(n) }))} />
          </div>
          <div>
            <div className="fit-eyebrow mb-2">Moment habituel de la séance</div>
            <Segmented cols={3} value={p.horaireSeance} onChange={(v) => set("horaireSeance", v)}
              options={[{ v: "matin", l: "Matin" }, { v: "midi", l: "Midi" }, { v: "soir", l: "Soir" }]} />
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.45 }}>
              Sert à placer les glucides : rapides autour de la séance, lents à distance. Les recettes proposées suivent ce repère.
            </div>
          </div>
          <div>
            <div className="fit-eyebrow mb-2">Métier / activité professionnelle</div>
            <Segmented cols={2} value={p.metier} onChange={(v) => set("metier", v)} options={Object.entries(METIERS).map(([k, m]) => ({ v: k, l: m.nom }))} />
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.45 }}>{METIERS[p.metier].desc}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Pas quotidiens moyens" value={p.pasMoyens} onChange={(v) => set("pasMoyens", v)} suffix="pas/j" />
            <NumField label="Sommeil moyen" value={p.sommeil} onChange={(v) => set("sommeil", v)} suffix="h" />
          </div>
          <div>
            <div className="fit-eyebrow mb-2">Stress perçu</div>
            <Segmented cols={5} value={p.stress} onChange={(v) => set("stress", v)} options={[1, 2, 3, 4, 5].map((n) => ({ v: n, l: String(n) }))} />
          </div>
        </div>
      ), valide: () => p.frequence >= 2,
    },
    {
      cle: "materiel", titre: "Matériel disponible", sous: "Les exercices sont choisis dans ce que tu as réellement sous la main.",
      contenu: (
        <div>
          <div className="grid grid-cols-2 gap-2">
            {[["barre", "Barre & disques"], ["halteres", "Haltères"], ["poulie", "Poulies"], ["machine", "Machines"], ["banc", "Banc"], ["pdc", "Poids du corps"], ["elastique", "Élastiques"], ["kettlebell", "Kettlebell"]].map(([k, l]) => {
              const on = p.materiel.includes(k);
              return (
                <button key={k} onClick={() => { haptic(); set("materiel", on ? p.materiel.filter((x) => x !== k) : [...p.materiel, k]); }}
                  className="fit-tap rounded-lg px-3 text-left" style={{ background: on ? THEME.surface2 : "transparent",
                    border: `1px solid ${on ? THEME.craie : THEME.rule}`, color: on ? THEME.craie : THEME.gris, fontSize: 13 }}>
                  {on && <Check size={13} className="inline mr-1.5" />}{l}
                </button>
              );
            })}
          </div>
          <div className="fit-data mt-3" style={{ fontSize: 11.5, color: THEME.gris }}>
            {EXERCICES.filter((e) => p.materiel.includes(e.materiel) || e.materiel === "aucun").length} exercices disponibles sur {EXERCICES.length}
          </div>
        </div>
      ), valide: () => p.materiel.length > 0,
    },
    {
      cle: "corps", titre: "Zones sensibles", sous: "Les exercices contre-indiqués seront écartés du programme. Coche seulement ce qui te gêne réellement.", option: true,
      contenu: (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(ZONES_SENSIBLES).map(([k, z]) => {
              const on = (p.zonesSensibles || []).includes(k);
              return (
                <button key={k} onClick={() => { haptic(); const l = p.zonesSensibles || []; set("zonesSensibles", on ? l.filter((x) => x !== k) : [...l, k]); }}
                  className="fit-tap rounded-lg px-3 text-left" style={{ background: on ? THEME.surface2 : "transparent",
                    border: `1px solid ${on ? THEME.rouge : THEME.rule}`, color: on ? THEME.craie : THEME.gris, fontSize: 13 }}>
                  {on && <Check size={13} className="inline mr-1.5" style={{ color: THEME.rouge }} />}{z.nom}
                </button>
              );
            })}
          </div>
          {(p.zonesSensibles || []).length > 0 && (
            <Card accent="rouge" style={{ padding: 13 }}>
              <div className="fit-data" style={{ fontSize: 12 }}>
                {EXERCICES.filter((e) => exerciceDeconseille(e, p.zonesSensibles)).length} exercices écartés du programme
              </div>
              <div style={{ fontSize: 12, color: THEME.gris, marginTop: 6, lineHeight: 1.5 }}>
                Ce filtre repose sur les contre-indications décrites dans chaque fiche. Il ne remplace pas l'avis d'un kinésithérapeute : une douleur qui persiste plus de quelques jours se fait évaluer.
              </div>
            </Card>
          )}
          <TextField label="Précisions libres" multi value={p.blessures} onChange={(v) => set("blessures", v)} placeholder="Épaule droite sensible sur les développés depuis six mois" />
        </div>
      ), valide: () => true,
    },
    {
      cle: "cuisine", titre: "Ton assiette", sous: "Ces réponses filtrent les recettes proposées et la liste de courses.", option: true,
      contenu: (
        <div className="space-y-4">
          <div>
            <div className="fit-eyebrow mb-2">Régime</div>
            <div className="flex flex-wrap gap-1.5">
              {[["vegetarien", "Végétarien"], ["vegetalien", "Végétalien"], ["sans_gluten", "Sans gluten"], ["sans_lactose", "Sans lactose"], ["halal", "Halal"]].map(([k, l]) => (
                <Chip key={k} actif={p.regime.includes(k)} onClick={() => set("regime", p.regime.includes(k) ? p.regime.filter((x) => x !== k) : [...p.regime, k])}>{l}</Chip>
              ))}
            </div>
          </div>
          <TextField label="Allergies et intolérances" value={p.allergies} onChange={(v) => set("allergies", v)} placeholder="Fruits à coque" />
          <TextField label="Aversions" value={p.aversions} onChange={(v) => set("aversions", v)} placeholder="Poisson blanc, fromage de chèvre" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="fit-eyebrow mb-2">Budget</div>
              <Segmented cols={3} value={p.budget} onChange={(v) => set("budget", v)} options={[{ v: "eco", l: "Serré" }, { v: "moyen", l: "Moyen" }, { v: "large", l: "Large" }]} />
            </div>
            <NumField label="Temps de cuisine" value={p.tempsCuisine} onChange={(v) => set("tempsCuisine", v)} suffix="min" />
          </div>
          <div className="fit-data" style={{ fontSize: 11.5, color: THEME.gris }}>
            {recettesCompatibles(p).length} recettes compatibles sur {RECETTES.length}
          </div>
        </div>
      ), valide: () => true,
    },
    {
      cle: "coach", titre: "Connecter le coach", sous: "Le coach conversationnel s'appuie sur un modèle Claude. Sans lui, tout le reste fonctionne : programme, journal, séances, fiches, recettes.", option: true,
      contenu: <ConnexionCoach app={app} />, valide: () => true,
    },
    {
      cle: "recap", titre: "Ce que tes réponses changent", sous: "Voilà le programme et les besoins calculés à partir de ce que tu viens de renseigner.",
      contenu: <Recapitulatif p={p} />, valide: () => true,
    },
  ];

  const e = etapes[etape];
  const dernier = etape === etapes.length - 1;
  return (
    <div className="min-h-dvh flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="px-5 pt-5 pb-3">
        <div className="flex gap-1 mb-5">
          {etapes.map((_, i) => <div key={i} className="flex-1 rounded-full" style={{ height: 3, background: i <= etape ? THEME.craie : THEME.rule, transition: "background .3s" }} />)}
        </div>
        {etape === 0
          ? <Wordmark taille={30} />
          : <>
              <div className="fit-eyebrow mb-2">Étape {etape} sur {etapes.length - 1}{e.option ? " · facultatif" : ""}</div>
              <h1 className="fit-display" style={{ fontSize: 27, lineHeight: 1.08 }}>{e.titre}</h1>
            </>}
        <p style={{ fontSize: 13.5, color: THEME.gris, marginTop: 9, lineHeight: 1.5 }}>{e.sous}</p>
      </div>
      <div className="fit-scroll flex-1 overflow-y-auto px-5 pb-4">{e.contenu}</div>
      <div className="px-5 pt-3 flex gap-2" style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))", borderTop: `1px solid ${THEME.rule}` }}>
        {etape > 0 && <Btn variant="ghost" onClick={() => setEtape(etape - 1)} icon={ChevronLeft}>{""}</Btn>}
        {e.option && !dernier && <Btn variant="ghost" onClick={() => setEtape(etape + 1)}>Passer</Btn>}
        <Btn full disabled={!e.valide()} onClick={() => { if (!dernier) setEtape(etape + 1); else terminer(); }}>
          {etape === 0 ? "Commencer" : dernier ? "C'est parti" : "Continuer"}
        </Btn>
      </div>
    </div>
  );
}

function recettesCompatibles(p) {
  const aver = (p.aversions || "").toLowerCase().split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const aller = (p.allergies || "").toLowerCase().split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  return RECETTES.filter((r) => {
    if (p.regime?.length && !p.regime.every((rg) => r.regimes.includes(rg))) return false;
    if (p.tempsCuisine && r.temps > p.tempsCuisine + 12) return false;
    if (p.budget === "eco" && r.budget === "large") return false;
    const noms = r.ing.map(([n]) => n.toLowerCase()).join(" ");
    if ([...aver, ...aller].some((a) => a.length > 2 && noms.includes(a))) return false;
    return true;
  });
}

function Recapitulatif({ p }) {
  const obj = useMemo(() => calculBesoins(p), [p]);
  const prog = useMemo(() => genererProgramme(p, null, 1), [p]);
  const niv = NIV(p);
  const ecartes = EXERCICES.filter((e) => exerciceDeconseille(e, p.zonesSensibles));
  const dispo = EXERCICES.filter((e) => (p.materiel.includes(e.materiel) || e.materiel === "aucun") && !exerciceDeconseille(e, p.zonesSensibles));
  const rec = recettesCompatibles(p);
  return (
    <div className="space-y-3">
      <Card accent={OBJECTIFS_ENTRAINEMENT[p.objectif].couleur} style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-1">Ton programme</div>
        <div className="fit-display" style={{ fontSize: 18 }}>{prog?.splitNom}</div>
        <div className="fit-data mt-1.5" style={{ fontSize: 11.5, color: THEME.gris }}>
          {p.frequence} séances · {OBJECTIFS_ENTRAINEMENT[p.objectif].nom} · progression {niv.progression === "lineaire" ? "linéaire" : niv.progression === "double" ? "en double palier" : "ondulatoire"}
        </div>
        <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 8, lineHeight: 1.5 }}>{prog?.pourquoiSplit}</div>
      </Card>
      <Card accent={obj.obj.couleur} style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-2">Tes besoins</div>
        <Ligne g={`Maintenance estimée — ${obj.methodeBmr}`} d={`${obj.maintenance} kcal`} />
        <Ligne g={`Cible — ${obj.obj.court}`} d={`${obj.cible} kcal`} couleur={obj.obj.couleur} />
        <Ligne g={`Protéines — ${obj.gProtKg} g/kg`} d={`${obj.prot} g`} couleur="blanc" />
        <Ligne g="Glucides" d={`${obj.gluc} g`} couleur="jaune" />
        <Ligne g="Lipides" d={`${obj.lip} g`} couleur="rouge" />
      </Card>
      <Card style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-2">Ce que tes réponses ont filtré</div>
        <Ligne g="Exercices retenus pour toi" d={`${dispo.length} / ${EXERCICES.length}`} />
        {ecartes.length > 0 && <Ligne g="Écartés pour zones sensibles" d={String(ecartes.length)} couleur="rouge" />}
        <Ligne g="Complexité technique maximale" d={niv.complexite === 1 ? "Débutant" : niv.complexite === 2 ? "Intermédiaire" : "Toutes"} />
        <Ligne g="Recettes compatibles" d={`${rec.length} / ${RECETTES.length}`} />
        <Ligne g="Décharge programmée" d={`toutes les ${niv.deloadToutes} semaines`} couleur="vert" />
        <Ligne g="Plafond d'intensité" d={`RPE ${niv.rpePlafond}`} />
      </Card>
      {obj.alerte && (
        <Card accent="rouge" style={{ padding: 14 }}>
          <div className="flex gap-2.5"><AlertTriangle size={16} style={{ color: THEME.rouge, flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{obj.alerte}</div></div>
        </Card>
      )}
      <div style={{ fontSize: 11.5, color: THEME.gris2, lineHeight: 1.5 }}>
        Tout reste modifiable à tout moment depuis Profil, et chaque valeur calculée peut être surchargée à la main.
      </div>
    </div>
  );
}

function ConnexionCoach({ app }) {
  const { reglages, setReglages } = app;
  const [choix, setChoix] = useState(store.hote === "artefact" ? "auto" : "proxy");
  if (store.hote === "artefact") {
    return (
      <Card accent="vert" style={{ padding: 14 }}>
        <div className="flex gap-2.5">
          <Check size={16} style={{ color: THEME.vert, flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            Le coach est déjà connecté : l'application tourne dans l'atelier Claude, l'accès au modèle est fourni directement. Rien à configurer.
          </div>
        </div>
        <div style={{ fontSize: 12, color: THEME.gris, marginTop: 10, lineHeight: 1.5 }}>
          Si tu installes ensuite l'application sur ton écran d'accueil, il faudra renseigner un accès ici même : Profil puis iPhone.
        </div>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card style={{ padding: 13 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          Anthropic ne propose pas de bouton de connexion pour les applications tierces : l'accès au modèle passe par une clé. Deux façons de la fournir, et elles ne se valent pas.
        </div>
      </Card>
      <Segmented cols={2} value={choix} onChange={setChoix} options={[{ v: "proxy", l: "Proxy — recommandé" }, { v: "cle", l: "Clé directe" }]} />
      {choix === "proxy" ? (
        <div className="space-y-3">
          <TextField label="Adresse du proxy" value={reglages.proxy} onChange={(v) => setReglages({ ...reglages, proxy: v })} placeholder="https://mon-proxy.workers.dev" />
          <div style={{ fontSize: 12, color: THEME.gris, lineHeight: 1.5 }}>
            La clé reste sur le serveur, jamais dans le téléphone ni dans le code de la page. Le fichier worker.js du paquet se déploie sur Cloudflare en quelques minutes.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <TextField label="Clé API Anthropic" value={reglages.cle} onChange={(v) => setReglages({ ...reglages, cle: v })} placeholder="sk-ant-…" />
          <div style={{ fontSize: 12, color: THEME.jaune, lineHeight: 1.5 }}>
            Elle est stockée sur cet appareil et repart dans chaque requête depuis le navigateur. Quiconque atteint l'adresse de ton site peut la lire. À réserver à un essai, pas à un usage durable.
          </div>
        </div>
      )}
      <TestConnexion app={app} />
      <div style={{ fontSize: 11.5, color: THEME.gris2, lineHeight: 1.5 }}>
        Tu peux passer cette étape et connecter le coach plus tard depuis Profil.
      </div>
    </div>
  );
}

/* ==========================================================================
   ÉCRAN — TABLEAU DE BORD
   ========================================================================== */

function Dashboard({ app }) {
  const { profil, jour, setJour, dateKey, entrainement, poidsHist, aller, journalMois } = app;
  const obj = useMemo(() => objectifsDuJour(profil, jour), [profil, jour]);
  const tot = useMemo(() => totauxJour(jour), [jour]);
  const restant = Math.round(obj.kcal - tot.kcal);
  const restantAccroche = restant;
  const seanceDuJour = useMemo(() => {
    if (!entrainement.programme) return null;
    const idx = (new Date(dateKey).getDay() + 6) % 7;
    const s = entrainement.programme.seances;
    return s[idx % s.length];
  }, [entrainement.programme, dateKey]);
  const faite = entrainement.seances.some((s) => s.date === dateKey);

  const tendance = useMemo(() => {
    const jours = Object.keys(journalMois).sort().slice(-7);
    return jours.map((k) => ({ j: dateFr(k), kcal: Math.round(totauxJour(journalMois[k]).kcal) }));
  }, [journalMois]);

  const accroche = useMemo(() => {
    const prog = entrainement.programme;
    if (!prog) return "Ton programme n'est pas encore généré : quelques réglages et il est prêt.";
    if (faite) return "Séance faite. Le reste de la journée se joue dans l'assiette et sur le sommeil.";
    if (prog.deload) return "Semaine de décharge : le volume baisse, c'est là que l'adaptation s'exprime.";
    if (prog.adaptation) return "Semaine de repérage : note tes charges, elles serviront de référence à tout le cycle.";
    if (tot.kcal > 0 && restantAccroche < 0) return "Tu es au-dessus de ta cible du jour. Ce qui compte est la moyenne de la semaine, pas une journée isolée.";
    return "Ta séance est prête. Chaque prescription porte sa raison, ouvre-la si tu veux savoir pourquoi.";
  }, [entrainement.programme, faite, tot.kcal, restantAccroche]);

  const alertes = useMemo(() => {
    const jours = Object.keys(journalMois).sort().slice(-7).map((k) => {
      const t = totauxJour(journalMois[k]); return t.kcal > 200 ? t : null;
    }).filter(Boolean);
    return analyseCarences(jours, obj, profil);
  }, [journalMois, obj, profil]);

  return (
    <div className="px-5 pb-6 space-y-6">
      <BandeauInstallation app={app} />

      {/* Accroche : on s'adresse à la personne avant de lui montrer des chiffres */}
      <div className="pt-4">
        <div className="fit-eyebrow">{JOURS_FR[new Date(dateKey).getDay()]} {dateFr(dateKey)}{obj.surcharge ? " · valeurs surchargées" : ""}</div>
        <h1 className="fit-display" style={{ fontSize: 27, lineHeight: 1.08, marginTop: 6 }}>
          {salutation()}{profil.prenom ? `, ${profil.prenom}` : ""}
        </h1>
        <div style={{ fontSize: 13, color: THEME.gris, marginTop: 6, lineHeight: 1.5 }}>{accroche}</div>
      </div>

      <Serie journalMois={journalMois} entrainement={entrainement} />

      <CarteReadiness app={app} />

      {/* Hero : l'anneau porte le chiffre du jour, les macros l'entourent */}
      <div>
        <div className="flex items-center gap-4 mt-3">
          <Anneau pct={obj.kcal > 0 ? (tot.kcal / obj.kcal) * 100 : 0} taille={158} epaisseur={10}
            couleur={restant < -100 ? "rouge" : Math.abs(restant) <= obj.kcal * 0.05 ? "vert" : "craie"}
            enfant={
              <>
                <span className="fit-display" style={{ fontSize: 40, lineHeight: 0.9, color: restant < -100 ? THEME.rouge : THEME.craie }}>
                  {Math.abs(restant)}
                </span>
                <span className="fit-eyebrow" style={{ marginTop: 5 }}>kcal {restant >= 0 ? "restantes" : "au-dessus"}</span>
              </>
            } />
          <div className="flex-1 space-y-3">
            <MacroBar label="Protéines" val={tot.prot} cible={obj.prot} couleur="blanc" />
            <MacroBar label="Glucides" val={tot.gluc} cible={obj.gluc} couleur="jaune" />
            <MacroBar label="Lipides" val={tot.lip} cible={obj.lip} couleur="rouge" />
            <MacroBar label="Fibres" val={tot.fibres} cible={28} couleur="vert" />
          </div>
        </div>
        <div className="fit-data mt-3" style={{ fontSize: 11.5, color: THEME.gris }}>
          {Math.round(tot.kcal)} consommées · cible {obj.kcal} · maintenance {obj.maintenance}
        </div>
      </div>

      {obj.alerte && (
        <Card accent="rouge" style={{ padding: 14 }}>
          <div className="flex gap-2.5">
            <AlertTriangle size={16} style={{ color: THEME.rouge, flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{obj.alerte}</div>
          </div>
        </Card>
      )}

      {/* Collecte quotidienne */}
      <div>
        <Eyebrow>Aujourd'hui</Eyebrow>
        <div className="grid grid-cols-2 gap-2.5">
          <Card style={{ padding: 12 }}>
            <div className="flex items-center gap-1.5 mb-1.5"><Footprints size={13} style={{ color: THEME.gris }} /><span className="fit-eyebrow">Pas</span></div>
            <NumField value={jour.pas} onChange={(v) => setJour({ ...jour, pas: v })} placeholder={String(profil.pasMoyens)} />
            {jour.pas != null && <div className="fit-data mt-1.5" style={{ fontSize: 11, color: THEME.gris }}>≈ {kcalPas(jour.pas, profil.poids)} kcal</div>}
          </Card>
          <Card style={{ padding: 12 }}>
            <div className="flex items-center gap-1.5 mb-1.5"><Droplet size={13} style={{ color: THEME.bleu }} /><span className="fit-eyebrow">Eau</span></div>
            <div className="flex items-center gap-2">
              <span className="fit-data" style={{ fontSize: 20 }}>{((jour.eau || 0) / 1000).toFixed(1)}<span style={{ fontSize: 11, color: THEME.gris }}> L</span></span>
              <button onClick={() => { haptic(); setJour({ ...jour, eau: (jour.eau || 0) + 250 }); }}
                className="fit-tap rounded-lg px-3 ml-auto" style={{ border: `1px solid ${THEME.rule}`, color: THEME.craie }}>+25cl</button>
            </div>
          </Card>
        </div>
        <Card style={{ padding: 12, marginTop: 10 }}>
          <div className="fit-eyebrow mb-2">Entraînement prévu — ajuste les calories du jour</div>
          <Segmented cols={4} value={jour.entrainementPrevu} onChange={(v) => setJour({ ...jour, entrainementPrevu: jour.entrainementPrevu === v ? null : v })}
            options={[{ v: "leger", l: "Léger" }, { v: "muscu", l: "Muscu" }, { v: "cardio", l: "Cardio" }, { v: "sortie", l: "Sortie" }]} />
          {jour.entrainementPrevu && <div className="fit-data mt-2" style={{ fontSize: 11, color: THEME.jaune }}>
            +{obj.kSeance} kcal ajoutées à la cible du jour, majoritairement en glucides autour de la séance.
          </div>}
        </Card>
      </div>

      {/* Séance du jour */}
      <div>
        <Eyebrow right={<button className="fit-eyebrow" onClick={() => aller("entrainement")} style={{ color: THEME.craie }}>Ouvrir</button>}>Séance</Eyebrow>
        {seanceDuJour ? (
          <CarteVerre accent={faite ? "vert" : OBJECTIFS_ENTRAINEMENT[profil.objectif].couleur} onClick={() => aller("entrainement")} style={{ padding: 0, cursor: "pointer" }}>
            <div className="flex items-center gap-3" style={{ padding: "14px 16px" }}>
              <div className="flex-1">
                <div className="fit-display" style={{ fontSize: 17, lineHeight: 1.1 }}>{seanceDuJour.nom}</div>
                <div className="fit-data mt-1.5" style={{ fontSize: 11.5, color: THEME.gris }}>
                  {seanceDuJour.exos.length} exercices · {entrainement.programme.deload ? "semaine de décharge" : `semaine ${entrainement.programme.semaine}`}
                </div>
              </div>
              {faite ? <Check size={22} style={{ color: THEME.vert }} /> : <Play size={22} style={{ color: THEME.craie }} />}
            </div>
            {exById(seanceDuJour.exos[0]?.exId) && (
              <div style={{ padding: "0 10px 12px" }}>
                <Execution exercice={exById(seanceDuJour.exos[0].exId)} hauteur={210}
                  nom={exById(seanceDuJour.exos[0].exId).nom} />
              </div>
            )}
          </CarteVerre>
        ) : <Vide titre="Aucun programme généré pour l'instant." action="Générer" onAction={() => aller("entrainement")} icone={Dumbbell} />}
      </div>

      {/* Alertes carences */}
      {alertes.length > 0 && (
        <div>
          <Eyebrow>Points de vigilance</Eyebrow>
          <div className="space-y-2.5">
            {alertes.slice(0, 3).map((a) => <AlerteCarence key={a.cle} a={a} />)}
          </div>
        </div>
      )}

      {/* Tendance */}
      {tendance.length >= 2 && (
        <div>
          <Eyebrow>Apport sur 7 jours</Eyebrow>
          <Graphique hauteur={130} rendu={(R) => (
              <R.BarChart data={tendance}>
                  <R.CartesianGrid stroke={THEME.rule} vertical={false} />
                  <R.XAxis dataKey="j" tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} />
                  <R.YAxis tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} width={34} />
                  <R.Tooltip contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderRadius: 8, fontFamily: FF.data, fontSize: 12 }} />
                  <R.Bar dataKey="kcal" fill={THEME.jaune} radius={[3, 3, 0, 0]} />
                </R.BarChart>
            )} />
          <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.5 }}>
            La moyenne hebdomadaire est plus pertinente qu'un jour isolé : le poids et les totaux varient avec l'eau, la digestion et le sel.
          </div>
        </div>
      )}

      <div>
        <Eyebrow>Aller directement à</Eyebrow>
        <div className="grid grid-cols-2 gap-2">
          {[["Semainier & budget", "nutrition", Calendar], ["Muscles en 3D", "entrainement", Dumbbell],
            ["Plan de recomposition", "profil", TrendingUp], ["Glossaire", "profil", Info]].map(([l, t, I]) => (
            <button key={l} onClick={() => { haptic(); aller(t); }} className="fit-tap rounded-xl px-3 py-3 text-left flex items-center gap-2.5"
              style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
              <I size={16} style={{ color: THEME.gris, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.25 }}>{l}</span>
            </button>
          ))}
        </div>
      </div>

      {poidsHist.length >= 2 && (
        <div>
          <Eyebrow>Poids</Eyebrow>
          <Graphique hauteur={120} rendu={(R) => (
              <R.LineChart data={poidsHist.slice(-30).map((x) => ({ j: dateFr(x.d), p: x.poids }))}>
                  <R.CartesianGrid stroke={THEME.rule} vertical={false} />
                  <R.XAxis dataKey="j" tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} />
                  <R.YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} width={34} />
                  <R.Tooltip contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderRadius: 8, fontFamily: FF.data, fontSize: 12 }} />
                  <R.Line type="monotone" dataKey="p" stroke={THEME.craie} strokeWidth={2} dot={{ r: 2, fill: THEME.craie }} />
                </R.LineChart>
            )} />
          <BoucleAjustement poidsHist={poidsHist} obj={obj} profil={profil} />
        </div>
      )}
    </div>
  );
}

function BandeauInstallation({ app }) {
  const [masque, setMasque] = useState(false);
  if (masque || app.installe || store.hote === "artefact") return null;
  return (
    <Card accent="jaune" style={{ padding: 13, marginTop: 8 }}>
      <div className="flex items-start gap-2.5">
        <div className="flex-1" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {estIOS()
            ? <>Ajoute FIT à ton écran d'accueil : <strong>Partager</strong> puis <strong>Sur l'écran d'accueil</strong>. Tu gagnes le plein écran, le fonctionnement hors-ligne et les notifications de fin de repos.</>
            : <>Ouvre cette page sur ton iPhone pour l'installer sur l'écran d'accueil.</>}
        </div>
        <button onClick={() => { haptic(); setMasque(true); }} className="fit-tap flex items-start justify-center" style={{ color: THEME.gris2, minHeight: 24, minWidth: 24 }}><X size={15} /></button>
      </div>
      <button onClick={() => app.aller("profil")} className="fit-eyebrow mt-2" style={{ color: THEME.jaune }}>Voir tous les réglages iPhone</button>
    </Card>
  );
}

function salutation() {
  const h = new Date().getHours();
  if (h < 6) return "Encore debout";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

/* Régularité : la mesure qui prédit le mieux les résultats sur un an. */
function Serie({ journalMois, entrainement }) {
  const stats = useMemo(() => {
    const auj = new Date();
    let serie = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date(auj); d.setDate(d.getDate() - i);
      const k = todayKey(d);
      const actif = (totauxJour(journalMois[k]).kcal > 200) || entrainement.seances.some((s) => s.date === k);
      if (actif) serie++;
      else if (i > 0) break;
    }
    const debutSem = new Date(auj); debutSem.setDate(auj.getDate() - ((auj.getDay() + 6) % 7));
    const sem = entrainement.seances.filter((s) => new Date(s.date) >= debutSem).length;
    const cible = entrainement.programme?.frequence || 4;
    const jours = ["L", "M", "M", "J", "V", "S", "D"].map((l, i) => {
      const d = new Date(debutSem); d.setDate(debutSem.getDate() + i);
      const k = todayKey(d);
      return { l, fait: entrainement.seances.some((s) => s.date === k), futur: d > auj };
    });
    return { serie, sem, cible, jours };
  }, [journalMois, entrainement]);

  return (
    <Card style={{ padding: 14 }}>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="fit-eyebrow">Cette semaine</div>
          <div className="fit-data" style={{ fontSize: 15, marginTop: 4 }}>
            {stats.sem} <span style={{ color: THEME.gris }}>/ {stats.cible} séances</span>
          </div>
        </div>
        {stats.serie > 1 && (
          <div className="text-right">
            <div className="fit-eyebrow">Régularité</div>
            <div className="fit-data" style={{ fontSize: 15, marginTop: 4, color: THEME.jaune }}>{stats.serie} jours</div>
          </div>
        )}
      </div>
      <div className="flex gap-1.5">
        {stats.jours.map((j, i) => (
          <div key={i} className="flex-1 text-center">
            <div style={{ height: 34, borderRadius: 8, background: j.fait ? THEME.vert : THEME.surface2,
              border: `1px solid ${j.fait ? THEME.vert : THEME.rule}`, opacity: j.futur ? 0.45 : 1,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              {j.fait && <Check size={14} color={THEME.noir} />}
            </div>
            <div className="fit-eyebrow" style={{ marginTop: 4, fontSize: 11 }}>{j.l}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CarteReadiness({ app }) {
  const { profil, jour, setJour, entrainement, dateKey } = app;
  const [ouvert, setOuvert] = useState(false);
  const r = useMemo(() => evaluerReadiness(profil, jour, entrainement, dateKey), [profil, jour, entrainement, dateKey]);
  const couleur = r.score >= 70 ? "vert" : r.score >= 45 ? "jaune" : "rouge";
  const libelleDecision = { normale: "Séance normale", adaptee: "Séance adaptée conseillée", repos: "Repos ou séance très allégée" }[r.decision];

  return (
    <CarteVerre accent={couleur} style={{ padding: 0 }}>
      <button onClick={() => { haptic(6); setOuvert(!ouvert); }} className="w-full text-left" style={{ padding: "14px 16px" }}>
        <div className="flex items-center gap-4">
          <Anneau pct={r.score} taille={64} epaisseur={6} couleur={couleur}
            enfant={<span className="fit-data" style={{ fontSize: 19 }}>{r.score}</span>} />
          <div className="flex-1">
            <div className="fit-eyebrow">Readiness</div>
            <div className="fit-display" style={{ fontSize: 15, marginTop: 3 }}>{libelleDecision}</div>
          </div>
          <ChevronDown size={16} style={{ color: THEME.gris2, transform: ouvert ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </div>
      </button>
      {ouvert && (
        <div className="fit-fade" style={{ padding: "0 16px 16px" }}>
          {r.facteurs.map((f) => (
            <div key={f.cle} className="flex items-baseline justify-between py-1.5" style={{ borderTop: `1px solid ${THEME.rule}` }}>
              <span style={{ fontSize: 12.5 }}>{f.nom}</span>
              <span className="fit-data" style={{ fontSize: 11.5, color: THEME.gris, textAlign: "right", maxWidth: "62%" }}>{f.etat} — {f.detail}</span>
            </div>
          ))}
          {r.adaptation && (
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${THEME.rule}` }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{r.adaptation.message}</div>
            </div>
          )}
          <div className="mt-3 pt-3 space-y-3" style={{ borderTop: `1px solid ${THEME.rule}` }}>
            <div className="fit-eyebrow">Ajuster pour aujourd'hui</div>
            <NumField label="Sommeil cette nuit" value={jour.sommeilNuit} onChange={(v) => setJour({ ...jour, sommeilNuit: v })} suffix="h" placeholder={String(profil.sommeil)} />
            <div>
              <div className="fit-eyebrow mb-1.5">Stress aujourd'hui</div>
              <Segmented cols={5} value={jour.stressJour ?? profil.stress} onChange={(v) => setJour({ ...jour, stressJour: v })} options={[1, 2, 3, 4, 5].map((n) => ({ v: n, l: String(n) }))} />
            </div>
            <NumField label="Douleur ou gêne" value={jour.douleur} onChange={(v) => setJour({ ...jour, douleur: v })} suffix="/10" placeholder="0" />
          </div>
        </div>
      )}
    </CarteVerre>
  );
}

function AlerteCarence({ a }) {
  return (
    <Card accent={a.couleur} style={{ padding: 14 }}>
      <div className="flex items-start justify-between gap-3">
        <span className="fit-display" style={{ fontSize: 13.5, lineHeight: 1.3 }}>{a.titre}</span>
        {a.prioritaire && <AlertTriangle size={15} style={{ color: THEME.rouge, flexShrink: 0 }} />}
      </div>
      <div className="fit-data mt-1" style={{ fontSize: 11.5, color: C(a.couleur) }}>{a.chiffre}</div>
      <Pourquoi titre="Conséquences et sources" couleur={a.couleur}>
        <p>{a.consequence}</p>
        <p className="mt-2">{a.action}</p>
        <div className="mt-2.5 pt-2" style={{ borderTop: `1px solid ${THEME.rule}` }}>
          <div className="fit-eyebrow mb-1">Sources</div>
          {a.sources.map((s, i) => <div key={i} style={{ fontSize: 11.5, color: THEME.gris, lineHeight: 1.45 }}>{s}</div>)}
          <div style={{ fontSize: 11.5, color: THEME.gris, marginTop: 6, fontStyle: "italic", lineHeight: 1.45 }}>Niveau de certitude — {a.certitude}</div>
        </div>
      </Pourquoi>
    </Card>
  );
}

function BoucleAjustement({ poidsHist, obj, profil }) {
  const pts = poidsHist.slice(-21);
  if (pts.length < 4) return null;
  const j0 = new Date(pts[0].d), j1 = new Date(pts[pts.length - 1].d);
  const sem = Math.max((j1 - j0) / 6048e5, 0.5);
  const delta = pts[pts.length - 1].poids - pts[0].poids;
  const parSem = delta / sem;
  const pctSem = (parSem / profil.poids) * 100;
  const o = obj.obj;
  const attendu = o.ecart[1] > 0 ? [0.15, 0.6] : o.ecart[1] < 0 ? [-1.1, -0.35] : [-0.15, 0.15];
  const dans = pctSem >= attendu[0] && pctSem <= attendu[1];
  const trop = pctSem > attendu[1], pas = pctSem < attendu[0];
  const ajust = trop ? -200 : pas ? +200 : 0;
  // Indicateur de qualité : en sèche, environ un centimètre de tour de taille
  // pour trois cents grammes perdus signale que la perte vient bien du gras.
  const tailles = poidsHist.filter((x) => x.taille);
  let qualite = null;
  if (tailles.length >= 2 && Math.abs(delta) >= 0.5) {
    const dTaille = tailles[tailles.length - 1].taille - tailles[0].taille;
    const attendu = (delta / 0.3) * 1;
    if (delta < 0) qualite = dTaille <= attendu * 0.6
      ? { ok: true, t: `Tour de taille en baisse de ${Math.abs(Math.round(dTaille * 10) / 10)} cm pour ${Math.abs(Math.round(delta * 10) / 10)} kg perdus : la perte vient bien du gras.` }
      : { ok: false, t: `Le poids baisse de ${Math.abs(Math.round(delta * 10) / 10)} kg mais le tour de taille suit peu. Un repère utile : environ un centimètre pour trois cents grammes. Si l'écart persiste, monte les protéines et garde les charges lourdes — c'est la charge qui préserve le muscle, pas le cardio.` };
    else qualite = dTaille >= 2 && delta > 0
      ? { ok: false, t: `Le tour de taille monte de ${Math.round(dTaille * 10) / 10} cm en même temps que le poids : le surplus est trop élevé. Réduis-le de 150 à 200 kcal.` }
      : { ok: true, t: "Le poids monte sans que le tour de taille suive : la prise est de bonne qualité." };
  }
  return (
    <Card accent={dans ? "vert" : "jaune"} style={{ padding: 14, marginTop: 10 }}>
      <div className="fit-eyebrow mb-1">Boucle d'ajustement — {Math.round(sem * 10) / 10} semaines observées</div>
      <div className="fit-data" style={{ fontSize: 13 }}>
        {parSem > 0 ? "+" : ""}{(Math.round(parSem * 100) / 100).toFixed(2)} kg/sem · {pctSem > 0 ? "+" : ""}{pctSem.toFixed(2)} % du poids de corps
      </div>
      {qualite && <div className="fit-data mt-2" style={{ fontSize: 11.5, color: qualite.ok ? THEME.vert : THEME.jaune, lineHeight: 1.5 }}>{qualite.t}</div>}
      <Pourquoi couleur={dans ? "vert" : "jaune"} titre={dans ? "Tendance conforme" : "Ajustement proposé"}>
        {dans
          ? <p>La tendance correspond à l'objectif ({o.vitesse}). Rien à changer : laisse tourner et continue de mesurer.</p>
          : <p>La tendance observée ne correspond pas à l'objectif ({o.vitesse}). Proposition : {ajust > 0 ? "+" : ""}{ajust} kcal/j sur les glucides, puis réévaluation dans deux semaines. C'est la réalité observée qui prime toujours sur la formule théorique — une équation estime, la balance mesure.</p>}
      </Pourquoi>
    </Card>
  );
}

/* ==========================================================================
   ÉCRAN — NUTRITION
   ========================================================================== */

function Nutrition({ app }) {
  const { profil, jour, setJour, dateKey, setDateKey, cuisine, setCuisine, journalMois } = app;
  const [onglet, setOnglet] = useState("journal");
  const [ajout, setAjout] = useState(null); // repas ciblé
  const foods = useMemo(() => [...cuisine.customFoods, ...BASE_FOODS], [cuisine.customFoods]);
  const obj = useMemo(() => objectifsDuJour(profil, jour), [profil, jour]);
  const tot = useMemo(() => totauxJour(jour), [jour]);

  const ajouterItem = (item, repas) => {
    const j = { ...jour, repas: { ...jour.repas, [repas]: [...jour.repas[repas], item] } };
    setJour(j);
    setCuisine({ ...cuisine, recents: [item.nom, ...(cuisine.recents || []).filter((n) => n !== item.nom)].slice(0, 25) });
  };
  const supprimerItem = (repas, i) => {
    const arr = [...jour.repas[repas]]; arr.splice(i, 1);
    setJour({ ...jour, repas: { ...jour.repas, [repas]: arr } });
  };
  const dupliquerRepas = (repas) => {
    const veille = todayKey(new Date(new Date(dateKey).getTime() - 864e5));
    const src = journalMois[veille]?.repas?.[repas];
    if (!src?.length) return;
    setJour({ ...jour, repas: { ...jour.repas, [repas]: [...jour.repas[repas], ...src] } });
    haptic(14);
  };

  return (
    <div className="pb-6">
      <div className="px-5 pt-2">
        <Segmented cols={5} value={onglet} onChange={setOnglet} options={[
          { v: "journal", l: "Journal" }, { v: "base", l: "Aliments" }, { v: "recettes", l: "Recettes" }, { v: "semaine", l: "Semaine" }, { v: "avance", l: "Avancé" }]} />
      </div>

      {onglet === "journal" && (
        <div className="px-5 pt-5 space-y-5">
          <div className="flex items-center justify-between">
            <button className="fit-tap flex items-center" onClick={() => setDateKey(todayKey(new Date(new Date(dateKey).getTime() - 864e5)))} style={{ color: THEME.gris }}><ChevronLeft size={20} /></button>
            <div className="text-center">
              <div className="fit-display" style={{ fontSize: 15 }}>{JOURS_FR[new Date(dateKey).getDay()]} {dateFr(dateKey)}</div>
              <div className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{Math.round(tot.kcal)} / {obj.kcal} kcal</div>
            </div>
            <button className="fit-tap flex items-center" disabled={dateKey >= todayKey()} onClick={() => setDateKey(todayKey(new Date(new Date(dateKey).getTime() + 864e5)))}
              style={{ color: dateKey >= todayKey() ? THEME.rule : THEME.gris }}><ChevronRight size={20} /></button>
          </div>

          {Object.entries(REPAS_LABELS).map(([k, label]) => {
            const items = jour.repas[k] || [];
            const kcalRepas = items.reduce((s, it) => s + (it.kcal100 * it.g) / 100, 0);
            return (
              <div key={k}>
                <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{Math.round(kcalRepas)} kcal</span>}>{label}</Eyebrow>
                <div className="space-y-1.5">
                  {items.map((it, i) => <ItemJournal key={i} it={it} onDelete={() => supprimerItem(k, i)} jour={jour} />)}
                  <div className="flex gap-2">
                    <button onClick={() => { haptic(); setAjout(k); }} className="fit-tap flex-1 rounded-lg flex items-center justify-center gap-1.5"
                      style={{ border: `1px dashed ${THEME.rule}`, color: THEME.gris, fontSize: 13 }}><Plus size={14} />Ajouter</button>
                    <button onClick={() => dupliquerRepas(k)} className="fit-tap rounded-lg px-3" title="Reprendre le même repas qu'hier"
                      style={{ border: `1px dashed ${THEME.rule}`, color: THEME.gris, fontSize: 12 }}>Comme hier</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {onglet === "base" && <BaseAliments foods={foods} cuisine={cuisine} setCuisine={setCuisine} onAjout={(item) => ajouterItem(item, "collation")} jour={jour} />}
      {onglet === "recettes" && <Recettes app={app} foods={foods} obj={obj} tot={tot} ajouterItem={ajouterItem} />}
      {onglet === "semaine" && <Semainier app={app} obj={obj} foods={foods} />}
      {onglet === "avance" && <NutritionAvancee app={app} tot={tot} obj={obj} />}

      <SheetAjout open={!!ajout} onClose={() => setAjout(null)} repas={ajout} foods={foods} cuisine={cuisine} setCuisine={setCuisine}
        onAjout={(item) => { ajouterItem(item, ajout); setAjout(null); }} jour={jour} />
    </div>
  );
}

function ItemJournal({ it, onDelete, jour }) {
  const [open, setOpen] = useState(false);
  const f = it.g / 100;
  const avis = useMemo(() => it.avisCache || avisAliment({
    nom: it.nom, cat: it.cat || "fec", kcal: it.kcal100, prot: it.prot100, gluc: it.gluc100,
    sucres: it.sucres100 || 0, lip: it.lip100, sat: it.sat100 || 0, fibres: it.fibres100 || 0, micros: it.micros || {},
  }, it.g, { seance: jour.entrainementPrevu }), [it, jour.entrainementPrevu]);
  return (
    <div className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
      <div className="flex items-center px-3 py-2.5 gap-3">
        <button onClick={() => { haptic(6); setOpen(!open); }} className="flex-1 text-left">
          <div style={{ fontSize: 13.5 }}>{it.nom}</div>
          <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
            {it.g} g · {Math.round(it.kcal100 * f)} kcal · P {Math.round(it.prot100 * f)} G {Math.round(it.gluc100 * f)} L {Math.round(it.lip100 * f)}
          </div>
        </button>
        <button onClick={() => { haptic(); onDelete(); }} className="fit-tap flex items-center justify-center" style={{ color: THEME.gris2 }}><Trash2 size={15} /></button>
      </div>
      {open && <div className="px-3 pb-3 fit-fade"><AvisBloc avis={avis} /></div>}
    </div>
  );
}

function AvisBloc({ avis }) {
  const blocs = [
    ["Points forts", avis.forts, "vert"], ["Points d'attention", avis.attention, "jaune"],
    ["Moment de la journée", avis.moment, "bleu"], ["Pour aller plus loin", avis.suggestions, "craie"],
  ].filter(([, l]) => l.length);
  if (!blocs.length) return <div style={{ fontSize: 12, color: THEME.gris }}>Rien de particulier à signaler sur cet aliment.</div>;
  return (
    <div className="space-y-2.5">
      {blocs.map(([t, lignes, c]) => (
        <div key={t} className="pl-2.5" style={{ borderLeft: `2px solid ${C(c)}` }}>
          <div className="fit-eyebrow" style={{ color: C(c) }}>{t}</div>
          {lignes.map((l, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 3, opacity: .9 }}>{l}</div>)}
        </div>
      ))}
      <div style={{ fontSize: 11, color: THEME.gris2, fontStyle: "italic" }}>
        Aucun aliment n'est interdit : c'est l'ensemble de la journée et de la semaine qui compte.
      </div>
    </div>
  );
}

function SheetAjout({ open, onClose, repas, foods, cuisine, setCuisine, onAjout, jour }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [g, setG] = useState(100);
  const [mode, setMode] = useState("recherche");
  useEffect(() => { if (open) { setQ(""); setSel(null); setG(100); setMode("recherche"); } }, [open]);

  const resultats = useMemo(() => {
    const recents = cuisine.recents || [];
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let list = q.trim() ? foods.filter((f) => norm(f.nom).includes(norm(q))) : foods;
    return [...list].sort((a, b) => {
      const ra = recents.indexOf(a.nom), rb = recents.indexOf(b.nom);
      if (ra !== rb) return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
      return a.nom.localeCompare(b.nom);
    }).slice(0, 60);
  }, [q, foods, cuisine.recents]);

  const valider = () => {
    if (!sel || !g) return;
    onAjout({
      nom: sel.nom, g: Math.round(g), cat: sel.cat, kcal100: sel.kcal, prot100: sel.prot,
      gluc100: sel.gluc, lip100: sel.lip, sat100: sel.sat, sucres100: sel.sucres,
      fibres100: sel.fibres, micros: sel.micros,
    });
    haptic(14);
  };

  return (
    <Sheet open={open} onClose={onClose} titre={REPAS_LABELS[repas] || "Ajouter"} plein>
      {!sel ? (
        <>
          <Segmented cols={3} value={mode} onChange={setMode} options={[
            { v: "recherche", l: "Rechercher" }, { v: "scan", l: "Code-barres" }, { v: "perso", l: "Créer" }]} />
          {mode === "recherche" && (
            <div className="mt-4">
              <div className="relative mb-3">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: THEME.gris }} />
                <input className="fit-input" style={{ paddingLeft: 38, fontFamily: FF.body }} placeholder="Poulet, avoine, skyr…"
          aria-label="Rechercher un aliment" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1">
                {resultats.map((f) => (
                  <button key={f.id} onClick={() => { haptic(); setSel(f); setG(f.pg || 100); }} className="w-full text-left rounded-lg px-3 py-2.5 flex items-center justify-between"
                    style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
                    <div>
                      <div style={{ fontSize: 13.5 }}>{f.nom}</div>
                      <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
                        {f.kcal} kcal · P {f.prot} · G {f.gluc} · L {f.lip} <span style={{ opacity: .6 }}>/100 g</span>
                      </div>
                    </div>
                    <ChevronRight size={15} style={{ color: THEME.gris2 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === "scan" && <ScanCodeBarres cuisine={cuisine} setCuisine={setCuisine} onTrouve={(f) => { setSel(f); setG(f.pg || 100); }} />}
          {mode === "perso" && <AlimentPerso cuisine={cuisine} setCuisine={setCuisine} onCree={(f) => { setSel(f); setG(f.pg || 100); }} />}
        </>
      ) : (
        <div className="space-y-4">
          <button onClick={() => setSel(null)} className="fit-eyebrow flex items-center gap-1"><ChevronLeft size={12} />Changer d'aliment</button>
          <div>
            <div className="fit-display" style={{ fontSize: 19 }}>{sel.nom}</div>
            {sel.incomplet && <div className="fit-data mt-1.5 flex items-start gap-1.5" style={{ fontSize: 11.5, color: THEME.jaune }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />Données produit incomplètes dans la base ouverte : vérifie l'emballage avant de te fier à ces valeurs.
            </div>}
          </div>
          <div>
            <NumField label="Quantité — en grammes réels" value={g} onChange={setG} suffix="g" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sel.pg && <Chip onClick={() => setG(sel.pg)}>{sel.portion} · {sel.pg} g</Chip>}
              {[50, 100, 150, 200].map((n) => <Chip key={n} onClick={() => setG(n)}>{n} g</Chip>)}
            </div>
            <div className="fit-eyebrow mt-3 mb-1.5">Équivalences pratiques</div>
            <div className="flex flex-wrap gap-1.5">
              {EQUIV.slice(0, 5).map(([l, v]) => <Chip key={l} onClick={() => setG(v)}>{l} ≈ {v} g</Chip>)}
            </div>
          </div>
          <Card style={{ padding: 12 }}>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[["kcal", Math.round((sel.kcal * g) / 100), "craie"], ["Prot", Math.round((sel.prot * g) / 100) + " g", "blanc"],
                ["Gluc", Math.round((sel.gluc * g) / 100) + " g", "jaune"], ["Lip", Math.round((sel.lip * g) / 100) + " g", "rouge"]].map(([l, v, c]) => (
                <div key={l}><div className="fit-data" style={{ fontSize: 17, color: C(c) }}>{v}</div><div className="fit-eyebrow">{l}</div></div>
              ))}
            </div>
          </Card>
          <div>
            <Eyebrow>Avis</Eyebrow>
            <AvisBloc avis={avisAliment(sel, g, { seance: jour?.entrainementPrevu })} />
          </div>
          <BlocEquivalences food={sel} grammes={g} foods={foods} onChoisir={(f, ng) => { setSel(f); setG(ng); }} />
          <Btn full onClick={valider} icon={Plus}>Ajouter {Math.round(g)} g au journal</Btn>
        </div>
      )}
    </Sheet>
  );
}

function BlocEquivalences({ food, grammes, foods, onChoisir }) {
  const [open, setOpen] = useState(false);
  const eq = useMemo(() => equivalences(food, grammes, foods), [food, grammes, foods]);
  if (!eq.liste.length) return null;
  return (
    <div>
      <button onClick={() => { haptic(6); setOpen(!open); }} className="flex items-center gap-2 py-1">
        <span className="fit-eyebrow" style={{ color: THEME.bleu }}>Remplacer par un équivalent</span>
        <ChevronDown size={13} style={{ color: THEME.bleu, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>
      {open && (
        <div className="fit-fade mt-2">
          <div style={{ fontSize: 12, color: THEME.gris, lineHeight: 1.5, marginBottom: 10 }}>
            Équivalences calculées à {eq.cible} g de {LABEL_CRITERE[eq.critere]}, l'apport dominant de cet aliment. Le total calorique bouge un peu d'une ligne à l'autre : c'est normal, deux aliments ne sont jamais identiques. Varier les sources est ce qui couvre le mieux les micronutriments.
          </div>
          <div className="space-y-1.5">
            {eq.liste.map((x) => (
              <button key={x.f.id} onClick={() => { haptic(); onChoisir(x.f, x.g); }}
                className="w-full text-left rounded-lg px-3 py-2.5 flex items-center justify-between"
                style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
                <div>
                  <div style={{ fontSize: 13 }}>{x.f.nom}</div>
                  <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
                    {x.kcal} kcal · P {x.prot} · G {x.gluc} · L {x.lip}
                  </div>
                </div>
                <span className="fit-data" style={{ fontSize: 13, color: THEME.craie, whiteSpace: "nowrap" }}>{x.g} g</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, onClick, actif }) {
  return <button onClick={() => { haptic(6); onClick?.(); }} className="rounded-full px-3 py-1.5 fit-data"
    style={{ fontSize: 11, background: actif ? THEME.craie : THEME.surface2, color: actif ? THEME.noir : THEME.gris, border: `1px solid ${THEME.rule}`, minHeight: 32 }}>{children}</button>;
}

/* Scan de code-barres — A.1.2. Détection native si disponible, sinon saisie du code. */
function ScanCodeBarres({ cuisine, setCuisine, onTrouve }) {
  const [code, setCode] = useState("");
  const [etat, setEtat] = useState("pret");
  const [msg, setMsg] = useState("");
  const videoRef = useRef(null);
  const [camOn, setCamOn] = useState(false);
  const supporte = typeof window !== "undefined" && "BarcodeDetector" in window;

  const chercher = async (ean) => {
    const memorise = cuisine.barcodes?.[ean];
    if (memorise) { onTrouve(memorise); return; }
    setEtat("charge"); setMsg("");
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,brands,nutriments,serving_quantity`);
      const d = await r.json();
      if (d.status !== 1 || !d.product) throw new Error("introuvable");
      const n = d.product.nutriments || {};
      const val = (k) => (typeof n[k] === "number" ? Math.round(n[k] * 10) / 10 : null);
      const kcal = val("energy-kcal_100g");
      const f = {
        id: "of" + ean, nom: [d.product.product_name, d.product.brands].filter(Boolean).join(" — ") || `Produit ${ean}`,
        cat: "snack", kcal: kcal ?? 0, prot: val("proteins_100g") ?? 0, gluc: val("carbohydrates_100g") ?? 0,
        sucres: val("sugars_100g") ?? 0, lip: val("fat_100g") ?? 0, sat: val("saturated-fat_100g") ?? 0,
        fibres: val("fiber_100g") ?? 0, micros: {}, portion: "portion", pg: d.product.serving_quantity ? Math.round(d.product.serving_quantity) : 100,
        source: "openfoodfacts",
        incomplet: kcal == null || val("proteins_100g") == null,
      };
      setCuisine({ ...cuisine, barcodes: { ...(cuisine.barcodes || {}), [ean]: f } });
      setEtat("pret"); onTrouve(f);
    } catch (e) {
      setEtat("echec");
      setMsg("Produit introuvable dans la base ouverte, ou réseau indisponible. Crée-le manuellement : le code sera mémorisé pour les prochaines fois.");
    }
  };

  const lancerCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCamOn(true);
      const detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
      const boucle = async () => {
        if (!videoRef.current) return;
        try {
          const res = await detector.detect(videoRef.current);
          if (res[0]?.rawValue) {
            haptic(20);
            stream.getTracks().forEach((t) => t.stop()); setCamOn(false);
            chercher(res[0].rawValue); return;
          }
        } catch (e) { /* aucun code lisible sur cette image */ }
        requestAnimationFrame(boucle);
      };
      boucle();
    } catch {
      setMsg("Accès caméra refusé ou indisponible. Saisis le code chiffre par chiffre juste en dessous — le résultat est identique.");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {supporte ? (
        <>
          {camOn && <video ref={videoRef} playsInline muted className="w-full rounded-xl" style={{ maxHeight: 220, objectFit: "cover", background: THEME.surface2 }} />}
          <Btn full variant="ghost" icon={Barcode} onClick={lancerCamera}>{camOn ? "Vise le code-barres…" : "Ouvrir la caméra"}</Btn>
        </>
      ) : (
        <Card accent="jaune" style={{ padding: 12 }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            La lecture par caméra n'est pas disponible sur ce navigateur — Safari iOS n'expose pas encore le détecteur de codes-barres aux applications web. Saisis le code à la main ici ; la lecture caméra arrivera avec la version native.
          </div>
        </Card>
      )}
      <div className="flex gap-2">
        <input className="fit-input" inputMode="numeric" placeholder="3017620425035" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        <Btn onClick={() => chercher(code)} disabled={code.length < 8 || etat === "charge"}>
          {etat === "charge" ? <Loader2 size={16} className="animate-spin" /> : "Chercher"}
        </Btn>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: THEME.jaune, lineHeight: 1.5 }}>{msg}</div>}
      <div style={{ fontSize: 11.5, color: THEME.gris2, lineHeight: 1.5 }}>
        Source produit : Open Food Facts, base ouverte et collaborative. Couverture large en France, mais les valeurs sont saisies par des contributeurs : en cas de doute, l'emballage fait foi.
      </div>
    </div>
  );
}

function AlimentPerso({ cuisine, setCuisine, onCree }) {
  const [f, setF] = useState({ nom: "", kcal: null, prot: null, gluc: null, lip: null, fibres: null, sucres: null, sat: null, pg: 100 });
  const ok = f.nom && f.kcal != null;
  return (
    <div className="mt-4 space-y-3">
      <TextField label="Nom de l'aliment" value={f.nom} onChange={(v) => setF({ ...f, nom: v })} placeholder="Pain de ma boulangerie" />
      <div className="fit-eyebrow">Valeurs pour 100 g</div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Calories" value={f.kcal} onChange={(v) => setF({ ...f, kcal: v })} suffix="kcal" />
        <NumField label="Protéines" value={f.prot} onChange={(v) => setF({ ...f, prot: v })} suffix="g" />
        <NumField label="Glucides" value={f.gluc} onChange={(v) => setF({ ...f, gluc: v })} suffix="g" />
        <NumField label="dont sucres" value={f.sucres} onChange={(v) => setF({ ...f, sucres: v })} suffix="g" />
        <NumField label="Lipides" value={f.lip} onChange={(v) => setF({ ...f, lip: v })} suffix="g" />
        <NumField label="dont saturés" value={f.sat} onChange={(v) => setF({ ...f, sat: v })} suffix="g" />
        <NumField label="Fibres" value={f.fibres} onChange={(v) => setF({ ...f, fibres: v })} suffix="g" />
        <NumField label="Portion usuelle" value={f.pg} onChange={(v) => setF({ ...f, pg: v })} suffix="g" />
      </div>
      <Btn full disabled={!ok} onClick={() => {
        const nf = { id: "c" + Date.now(), cat: "fec", micros: {}, portion: "portion", source: "perso",
          ...f, kcal: +f.kcal || 0, prot: +f.prot || 0, gluc: +f.gluc || 0, lip: +f.lip || 0,
          sucres: +f.sucres || 0, sat: +f.sat || 0, fibres: +f.fibres || 0, pg: +f.pg || 100 };
        setCuisine({ ...cuisine, customFoods: [nf, ...cuisine.customFoods] });
        onCree(nf);
      }}>Enregistrer et utiliser</Btn>
    </div>
  );
}

function BaseAliments({ foods, cuisine, setCuisine, jour }) {
  const [filtre, setFiltre] = useState("tous");
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState("");
  const liste = useMemo(() => {
    let l = foods;
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (q.trim()) l = l.filter((f) => norm(f.nom).includes(norm(q)));
    if (cat) l = l.filter((f) => f.cat === cat);
    const fn = LISTES_FONCTION.find((x) => x.id === filtre);
    if (fn) l = l.filter(fn.test);
    return l.slice(0, 80);
  }, [foods, filtre, cat, q]);
  const fnActive = LISTES_FONCTION.find((x) => x.id === filtre);

  return (
    <div className="px-5 pt-5 space-y-4">
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: THEME.gris }} />
        <input className="fit-input" style={{ paddingLeft: 38, fontFamily: FF.body }} placeholder="Rechercher un aliment" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div>
        <Eyebrow>Listes orientées fonction</Eyebrow>
        <div className="flex flex-wrap gap-1.5">
          <Chip actif={filtre === "tous"} onClick={() => setFiltre("tous")}>Tous</Chip>
          {LISTES_FONCTION.map((f) => <Chip key={f.id} actif={filtre === f.id} onClick={() => setFiltre(filtre === f.id ? "tous" : f.id)}>{f.titre}</Chip>)}
        </div>
        {fnActive && (
          <Card accent={fnActive.couleur} style={{ padding: 12, marginTop: 10 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{fnActive.pourquoi}</div>
          </Card>
        )}
      </div>
      <div>
        <Eyebrow>Catégories</Eyebrow>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CAT_LABELS).map(([k, l]) => <Chip key={k} actif={cat === k} onClick={() => setCat(cat === k ? null : k)}>{l}</Chip>)}
        </div>
      </div>
      <div className="space-y-1.5">
        <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{liste.length}</span>}>Aliments</Eyebrow>
        {liste.map((f) => <CarteAliment key={f.id} f={f} jour={jour} />)}
      </div>
    </div>
  );
}

function CarteAliment({ f, jour }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
      <button onClick={() => { haptic(6); setOpen(!open); }} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 13.5 }}>{f.nom}</span>
          <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{f.kcal} kcal</span>
        </div>
        <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
          P {f.prot} · G {f.gluc} · L {f.lip} · F {f.fibres} <span style={{ opacity: .6 }}>/100 g · {f.portion} ≈ {f.pg} g</span>
        </div>
        {IG[f.nom] != null && <div className="fit-data" style={{ fontSize: 11, color: C(IG_LABEL[igNiveau(IG[f.nom])].c), marginTop: 2 }}>
          IG {IG[f.nom]} · CG {chargeGlycemique(f, f.pg || 100).cg} pour {f.pg} g
        </div>}
      </button>
      {open && (
        <div className="px-3 pb-3 fit-fade space-y-2.5">
          <AvisBloc avis={avisAliment(f, f.pg || 100, { seance: jour?.entrainementPrevu })} />
          {Object.keys(f.micros).length > 0 && (
            <div>
              <div className="fit-eyebrow mb-1">Micronutriments — pour {f.pg} g</div>
              {Object.entries(f.micros).map(([k, v]) => {
                const m = MICRO_LABELS[k]; if (!m) return null;
                const q = (v * (f.pg || 100)) / 100;
                return <Ligne key={k} g={m.n} d={`${Math.round(q * 10) / 10} ${m.u} · ${Math.round((q / m.rda) * 100)} % AR`} />;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailMicro({ tot, obj, profil, journalMois, nu }) {
  const jours = Object.keys(journalMois).sort().slice(-7).map((k) => { const t = totauxJour(journalMois[k]); return t.kcal > 200 ? t : null; }).filter(Boolean);
  const alertes = analyseCarences(jours, obj, profil);
  return (
    <div className={nu ? "space-y-6" : "px-5 pt-5 space-y-6"}>
      <div>
        {!nu && <Eyebrow>Répartition du jour</Eyebrow>}
        <Card style={{ padding: 14 }}>
          {[["Protéines", tot.prot, obj.prot, (tot.prot * 4)], ["Glucides", tot.gluc, obj.gluc, (tot.gluc * 4)], ["Lipides", tot.lip, obj.lip, (tot.lip * 9)]].map(([l, v, c, kc]) => (
            <Ligne key={l} g={l} d={`${Math.round(v)} g · ${Math.round(v * 100 / Math.max(c, 1))} % de la cible · ${tot.kcal > 0 ? Math.round((kc / tot.kcal) * 100) : 0} % des kcal`} />
          ))}
          <Ligne g="dont sucres" d={`${Math.round(tot.sucres)} g`} />
          <Ligne g="dont saturés" d={`${Math.round(tot.sat)} g`} />
          <Ligne g="Fibres" d={`${Math.round(tot.fibres)} g / 28 g`} couleur={tot.fibres >= 25 ? "vert" : "jaune"} />
        </Card>
      </div>
      <div>
        <Eyebrow>Micronutriments estimés</Eyebrow>
        <Card style={{ padding: 14 }}>
          {Object.entries(MICRO_LABELS).map(([k, m]) => {
            const v = tot.micros[k] || 0; const pct = Math.round((v / m.rda) * 100);
            return <Ligne key={k} g={m.n} d={`${Math.round(v * 10) / 10} ${m.u} · ${pct} % AR`} couleur={pct >= 70 ? "vert" : pct >= 35 ? "jaune" : "gris"} />;
          })}
          <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 10, lineHeight: 1.5 }}>
            Estimation calculée uniquement sur les micronutriments renseignés dans la base : la valeur réelle est presque toujours supérieure. À lire comme un ordre de grandeur, pas comme un dosage.
          </div>
        </Card>
      </div>
      {alertes.length > 0 && (
        <div>
          <Eyebrow>Analyse sur 7 jours</Eyebrow>
          <div className="space-y-2.5">{alertes.map((a) => <AlerteCarence key={a.cle} a={a} />)}</div>
        </div>
      )}
    </div>
  );
}

function FicheComplement({ c }) {
  const [open, setOpen] = useState(false);
  const pr = PREUVE[c.preuve];
  return (
    <div className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderLeft: `3px solid ${C(c.couleur)}` }}>
      <button onClick={() => { haptic(6); setOpen(!open); }} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.nom}</span>
          <span className="fit-eyebrow" style={{ color: C(pr.c) }}>{pr.l}</span>
        </div>
        {c.dose !== "—" && <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 3 }}>{c.dose}</div>}
      </button>
      {open && (
        <div className="px-3 pb-3 fit-fade space-y-2" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          <p>{c.quoi}</p>
          <div className="pl-2.5" style={{ borderLeft: `2px solid ${C(c.couleur)}` }}>
            <div className="fit-eyebrow" style={{ color: C(c.couleur) }}>Verdict</div>
            <p className="mt-1">{c.verdict}</p>
          </div>
          <p style={{ color: THEME.gris }}>{c.reserve}</p>
        </div>
      )}
    </div>
  );
}

function PlanJournee({ profil, obj }) {
  const plan = useMemo(() => planJournee(profil, obj), [profil, obj]);
  return (
    <div>
      <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>séance vers {plan.seance}</span>}>Placement des repas</Eyebrow>
      <Card style={{ padding: 14 }}>
        <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5, marginBottom: 12 }}>{plan.principe}</div>
        {plan.repas.map(([h, titre, d], i) => (
          <div key={i} className="flex gap-3 py-2.5" style={{ borderTop: i ? `1px solid ${THEME.rule}` : "none" }}>
            <span className="fit-data" style={{ fontSize: 11.5, color: THEME.jaune, minWidth: 46, paddingTop: 2 }}>{h}</span>
            <div className="flex-1">
              <div style={{ fontSize: 13, fontWeight: 600 }}>{titre}</div>
              <div style={{ fontSize: 12, color: THEME.gris, marginTop: 3, lineHeight: 1.5 }}>{d}</div>
            </div>
          </div>
        ))}
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${THEME.rule}` }}>
          <Ligne g="Cible d'hydratation" d={`≈ ${plan.hydratation} L par jour`} couleur="bleu" />
          <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 8, lineHeight: 1.5 }}>
            Environ 35 ml par kilo, majorés selon ton volume d'entraînement. La couleur des urines reste le meilleur indicateur au quotidien : claires, c'est bon.
          </div>
        </div>
        <Pourquoi couleur="jaune" titre="Si tes horaires ne collent pas">
          Ce plan est un repère, pas une contrainte. Décale-le entièrement si tu travailles en horaires décalés : ce qui compte est de garder les prises protéiques espacées et les glucides concentrés autour de la séance. Un plan que tu ne peux pas tenir vaut moins qu'un plan approximatif que tu tiens.
        </Pourquoi>
      </Card>
    </div>
  );
}

function NutritionAvancee({ app, tot, obj }) {
  const { profil, setProfil, jour, setJour, journalMois } = app;
  const [ouvert, setOuvert] = useState(null);
  const avance = !!profil.modeAvance;
  const cibles = jour.cibles || {};

  const serie = useMemo(() => {
    const cles = Object.keys(journalMois).sort().slice(-7);
    const m = {};
    CIBLES_AVANCEES.forEach((c) => { m[c.id] = cles.filter((k) => journalMois[k]?.cibles?.[c.id]).length; });
    return { m, jours: cles.length };
  }, [journalMois]);

  const leucine = Math.round(obj.prot / 4);

  return (
    <div className="px-5 pt-5 pb-6 space-y-6">
      <Card accent={avance ? "vert" : undefined} style={{ padding: 14 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="fit-display" style={{ fontSize: 14.5 }}>Aller plus loin</div>
            <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 6, lineHeight: 1.5 }}>
              Active le suivi de quatre nutriments ciblés et l'accès aux mécanismes avancés. Rien de tout cela ne remplace les bases : total calorique, protéines, sommeil. C'est le dernier pourcentage, pas le premier.
            </div>
          </div>
          <Interrupteur on={avance} onChange={(v) => setProfil({ ...profil, modeAvance: v })} />
        </div>
      </Card>

      {avance && (
        <div>
          <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{serie.jours} derniers jours</span>}>Nutriments ciblés — aujourd'hui</Eyebrow>
          <div className="space-y-2.5">
            {CIBLES_AVANCEES.map((c) => {
              const on = !!cibles[c.id];
              const n = serie.m[c.id] || 0;
              return (
                <Card key={c.id} accent={on ? c.couleur : undefined} style={{ padding: 13 }}>
                  <div className="flex items-center gap-3">
                    <button onClick={() => { haptic(); setJour({ ...jour, cibles: { ...cibles, [c.id]: !on } }); }}
                      className="fit-tap flex items-center justify-center" style={{ minWidth: 26, minHeight: 26 }}>
                      <span className="rounded flex items-center justify-center" style={{ width: 20, height: 20,
                        border: `1.5px solid ${on ? C(c.couleur) : THEME.rule}`, background: on ? C(c.couleur) : "transparent" }}>
                        {on && <Check size={13} color={THEME.noir} />}
                      </span>
                    </button>
                    <button className="flex-1 text-left" onClick={() => { haptic(6); setOuvert(ouvert === c.id ? null : c.id); }}>
                      <div style={{ fontSize: 13.5 }}>{c.nom}</div>
                      <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
                        {n} / {serie.jours} jours · {c.dose}
                      </div>
                    </button>
                    <ChevronDown size={14} style={{ color: THEME.gris2, transform: ouvert === c.id ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                  </div>
                  {ouvert === c.id && (
                    <div className="fit-fade mt-3 space-y-2.5" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                      <div className="pl-2.5" style={{ borderLeft: `2px solid ${C(c.couleur)}` }}>
                        <div className="fit-eyebrow" style={{ color: C(c.couleur) }}>Pour l'entraînement</div>
                        <p className="mt-1">{c.entrainement}</p>
                      </div>
                      <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.rule}` }}>
                        <div className="fit-eyebrow">Au quotidien</div>
                        <p className="mt-1">{c.quotidien}</p>
                      </div>
                      <p><span style={{ color: THEME.gris }}>Par l'alimentation — </span>{c.alimentaire}</p>
                      <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.rouge}` }}>
                        <div className="fit-eyebrow" style={{ color: THEME.rouge }}>Prudence</div>
                        <p className="mt-1">{c.prudence}</p>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 10, lineHeight: 1.5 }}>
            Cocher une case enregistre une prise, rien de plus : l'application ne dose rien et ne recommande aucun produit. Une supplémentation se décide avec un professionnel de santé, idéalement après un dosage sanguin.
          </div>
        </div>
      )}

      {avance && (
        <div>
          <Eyebrow>Repère du jour</Eyebrow>
          <Card style={{ padding: 14 }}>
            <Ligne g="Cible protéique" d={`${obj.prot} g`} couleur="blanc" />
            <Ligne g="Soit par prise sur 4 repas" d={`≈ ${leucine} g`} />
            <Ligne g="Consommé pour l'instant" d={`${Math.round(tot.prot)} g`} couleur={tot.prot >= obj.prot * 0.95 ? "vert" : "jaune"} />
            <Pourquoi couleur="blanc" titre="Pourquoi répartir">
              Répartir l'apport en trois ou quatre prises de 30 à 40 g franchit le seuil de leucine à chaque fois, alors qu'une seule grosse prise ne déclenche le signal qu'une fois. L'effet est réel mais modeste : le total quotidien reste de loin le facteur dominant.
            </Pourquoi>
          </Card>
        </div>
      )}

      <div>
        <Eyebrow>Index et charge glycémiques</Eyebrow>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{PEDAGO_IG.texte}</div>
          <div className="fit-data mt-3" style={{ fontSize: 11.5, color: THEME.jaune }}>{PEDAGO_IG.reperes}</div>
          <Pourquoi couleur="jaune" titre="Les limites de ces chiffres">
            <p>{PEDAGO_IG.nuances}</p>
            <p className="mt-2">{PEDAGO_IG.usage}</p>
          </Pourquoi>
        </Card>
      </div>

      <div>
        <Eyebrow>Mécanismes avancés</Eyebrow>
        <div className="space-y-2.5">
          {AVANCE.map((sec) => (
            <Card key={sec.id} accent={sec.couleur} style={{ padding: 14 }}>
              <button className="w-full text-left" onClick={() => { haptic(6); setOuvert(ouvert === sec.id ? null : sec.id); }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="fit-display" style={{ fontSize: 14.5 }}>{sec.titre}</span>
                  <ChevronDown size={15} style={{ color: THEME.gris2, transform: ouvert === sec.id ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                </div>
                <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 6, lineHeight: 1.5 }}>{sec.intro}</div>
              </button>
              {ouvert === sec.id && (
                <div className="fit-fade mt-4 space-y-4">
                  {sec.points.map((pt) => {
                    const pr = PREUVE[pt.preuve];
                    return (
                      <div key={pt.t} className="pl-3" style={{ borderLeft: `2px solid ${C(pr.c)}` }}>
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{pt.t}</span>
                          <span className="fit-eyebrow" style={{ color: C(pr.c) }}>{pr.l}</span>
                        </div>
                        <p style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 5 }}>{pt.texte}</p>
                        <p style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 6, color: THEME.craie, opacity: .75 }}>
                          <span style={{ color: THEME.gris }}>En pratique — </span>{pt.pratique}
                        </p>
                      </div>
                    );
                  })}
                  <div className="pt-2" style={{ borderTop: `1px solid ${THEME.rule}` }}>
                    <div className="fit-eyebrow mb-1">Sources</div>
                    {sec.sources.map((x, i) => <div key={i} style={{ fontSize: 11.5, color: THEME.gris, lineHeight: 1.45 }}>{x}</div>)}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
        <Card style={{ padding: 13, marginTop: 10 }}>
          <div className="fit-eyebrow mb-2">Lire les niveaux de preuve</div>
          {Object.values(PREUVE).map((pr) => (
            <div key={pr.l} className="flex gap-2.5 py-1.5" style={{ borderBottom: `1px solid ${THEME.rule}` }}>
              <span className="fit-eyebrow" style={{ color: C(pr.c), minWidth: 96 }}>{pr.l}</span>
              <span style={{ fontSize: 11.5, color: THEME.gris, lineHeight: 1.45, flex: 1 }}>{pr.d}</span>
            </div>
          ))}
        </Card>
      </div>

      <PlanJournee profil={profil} obj={obj} />

      <div>
        <Eyebrow>Cardio — quelle zone, pour quoi</Eyebrow>
        <div className="space-y-2.5">
          {ZONES_CARDIO.map((z) => (
            <Card key={z.id} accent={z.couleur} style={{ padding: 14 }}>
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="fit-display" style={{ fontSize: 14.5 }}>{z.nom}</span>
                <span className="fit-data" style={{ fontSize: 11, color: C(z.couleur) }}>{z.pct}</span>
              </div>
              <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 4 }}>{z.duree} · {z.freq}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 8 }}>{z.quoi}</div>
              <Pourquoi couleur={z.couleur} titre="Ce que ça développe">
                <p>{z.pourquoi}</p>
                <p className="mt-2" style={{ color: THEME.jaune }}>À savoir — {z.attention}</p>
              </Pourquoi>
            </Card>
          ))}
          <Card style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-2">Règles de placement</div>
            {REGLES_CARDIO.map((x, i) => (
              <div key={i} className="py-2" style={{ borderBottom: i < REGLES_CARDIO.length - 1 ? `1px solid ${THEME.rule}` : "none" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{x.r}</div>
                <div style={{ fontSize: 12, color: THEME.gris, marginTop: 4, lineHeight: 1.5 }}>{x.d}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div>
        <Eyebrow right={<span className="fit-eyebrow">Sans affiliation</span>}>Compléments — ce qui tient</Eyebrow>
        <div className="space-y-2">
          {COMPLEMENTS.map((c) => <FicheComplement key={c.nom} c={c} />)}
        </div>
        <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 10, lineHeight: 1.5 }}>
          Aucun produit ni marque n'est recommandé ici, et cette application ne touche aucune commission. Un complément ne compense jamais une alimentation, un entraînement ou un sommeil mal réglés — c'est là que se joue l'essentiel.
        </div>
      </div>

      <div>
        <Eyebrow>Idées reçues</Eyebrow>
        <div className="space-y-2">
          {IDEES_RECUES.map((x, i) => (
            <Card key={i} style={{ padding: 13 }}>
              <div className="flex gap-2.5">
                <X size={15} style={{ color: THEME.rouge, flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, textDecoration: "line-through", opacity: .6 }}>{x.faux}</div>
              </div>
              <div className="flex gap-2.5 mt-2">
                <Check size={15} style={{ color: THEME.vert, flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{x.vrai}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <Eyebrow>Techniques d'intensification</Eyebrow>
        <div className="space-y-2">
          {Object.keys(TECHNIQUES).map((k) => <FicheTechnique key={k} id={k} />)}
        </div>
      </div>

      <div>
        <Eyebrow>Détail du jour</Eyebrow>
        <DetailMicro tot={tot} obj={obj} profil={profil} journalMois={journalMois} nu />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Recettes à partir du frigo — A.5
   -------------------------------------------------------------------------- */

function Recettes({ app, foods, obj, tot, ajouterItem }) {
  const { cuisine, setCuisine, profil, appelClaude, apiEtat } = app;
  const [vue, setVue] = useState("suggestions");
  const [q, setQ] = useState("");
  const [ia, setIa] = useState(null);
  const [chargeIa, setChargeIa] = useState(false);
  const frigo = useMemo(() => cuisine.frigo || [], [cuisine.frigo]);
  const restant = { kcal: Math.max(0, Math.round(obj.kcal - tot.kcal)), prot: Math.max(0, Math.round(obj.prot - tot.prot)) };

  const classees = useMemo(() => {
    const noms = frigo.map((x) => x.toLowerCase());
    const toutes = RECETTES.map((r) => {
      const ing = r.ing.map(([n]) => (n.includes("|") ? n.split("|")[0] : n));
      const dispo = ing.filter((n) => noms.some((f) => n.toLowerCase().includes(f) || f.includes(n.toLowerCase())));
      const manque = ing.filter((n) => !dispo.includes(n));
      const nut = nutritionRecette(r, foods);
      const ecart = Math.abs(nut.kcal - restant.kcal);
      return { ...r, dispo, manque, nut, score: dispo.length * 100 - ecart / 20 };
    });
    const compat = recettesCompatibles(profil).map((r) => r.id);
    return toutes.filter((r) => compat.includes(r.id)).sort((a, b) => b.score - a.score);
  }, [frigo, foods, restant.kcal, profil]);

  const genererIa = async () => {
    setChargeIa(true); setIa(null);
    const prompt = `Frigo disponible : ${frigo.join(", ") || "non renseigné"}.
Macros restantes à couvrir aujourd'hui : ${restant.kcal} kcal dont ${restant.prot} g de protéines.
Contraintes : régime ${profil.regime.join(", ") || "aucun"} ; allergies ${profil.allergies || "aucune"} ; aversions ${profil.aversions || "aucune"} ; budget ${profil.budget} ; ${profil.tempsCuisine} minutes disponibles.
Propose 2 recettes utilisant en priorité ce qui est disponible. Réponds UNIQUEMENT en JSON, sans texte autour, sans balises Markdown, au format :
[{"nom":"","temps":0,"difficulte":"","ingredients":[{"nom":"","grammes":0}],"nutrition":{"kcal":0,"prot":0,"gluc":0,"lip":0,"fibres":0},"etapes":[""],"substitutions":""}]`;
    const rep = await appelClaude([{ role: "user", content: prompt }],
      "Tu es un coach nutrition. Tes grammages sont exacts et réalistes. Tes estimations nutritionnelles sont des ordres de grandeur honnêtes, jamais inventées avec une fausse précision. Tu réponds uniquement en JSON valide.");
    setChargeIa(false);
    if (!rep) return;
    try { setIa(JSON.parse(rep.replace(/```json|```/g, "").trim())); }
    catch { setIa("erreur"); }
  };

  return (
    <div className="px-5 pt-5 space-y-5">
      <Segmented cols={2} value={vue} onChange={setVue} options={[{ v: "suggestions", l: "Recettes" }, { v: "frigo", l: `Mon frigo (${frigo.length})` }]} />

      {vue === "frigo" ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input className="fit-input" style={{ fontFamily: FF.body }} placeholder="Ajouter un aliment disponible" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { setCuisine({ ...cuisine, frigo: [...frigo, q.trim()] }); setQ(""); } }} />
            <Btn onClick={() => { if (q.trim()) { setCuisine({ ...cuisine, frigo: [...frigo, q.trim()] }); setQ(""); } }} icon={Plus}>{""}</Btn>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {frigo.map((x, i) => (
              <button key={i} onClick={() => { haptic(); setCuisine({ ...cuisine, frigo: frigo.filter((_, j) => j !== i) }); }}
                className="rounded-full px-3 py-2 flex items-center gap-1.5" style={{ background: THEME.surface2, border: `1px solid ${THEME.rule}`, fontSize: 12.5 }}>
                {x}<X size={12} style={{ color: THEME.gris2 }} />
              </button>
            ))}
          </div>
          {!frigo.length && <Vide icone={Refrigerator} titre="Renseigne ce que tu as sous la main : les recettes se classeront en fonction, et la liste de courses se remplira toute seule avec ce qui manque." />}
        </div>
      ) : (
        <>
          <Card accent="jaune" style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-1">Reste à couvrir aujourd'hui</div>
            <div className="fit-data" style={{ fontSize: 15 }}>{restant.kcal} kcal · {restant.prot} g de protéines</div>
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 6, lineHeight: 1.45 }}>Les recettes sont classées par disponibilité dans ton frigo, puis par adéquation avec ce qu'il te reste.</div>
          </Card>

          <Btn full variant="ghost" icon={chargeIa ? Loader2 : Refrigerator} onClick={genererIa} disabled={chargeIa || apiEtat === "hs"}>
            {chargeIa ? "Le coach compose…" : "Générer 2 recettes sur mesure"}
          </Btn>
          {ia === "erreur" && <div style={{ fontSize: 12.5, color: THEME.jaune }}>Réponse illisible. Relance la génération.</div>}
          {Array.isArray(ia) && ia.map((r, i) => (
            <Card key={i} accent="bleu" style={{ padding: 14 }}>
              <div className="flex items-baseline justify-between">
                <span className="fit-display" style={{ fontSize: 15 }}>{r.nom}</span>
                <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{r.temps} min · {r.difficulte}</span>
              </div>
              <div className="fit-data mt-1.5" style={{ fontSize: 11.5, color: THEME.jaune }}>
                ≈ {r.nutrition?.kcal} kcal · P {r.nutrition?.prot} · G {r.nutrition?.gluc} · L {r.nutrition?.lip}
              </div>
              <div className="mt-2.5">
                {(r.ingredients || []).map((x, j) => <Ligne key={j} g={x.nom} d={`${x.grammes} g`} />)}
              </div>
              <ol className="mt-2.5 space-y-1.5">
                {(r.etapes || []).map((e, j) => <li key={j} style={{ fontSize: 12.5, lineHeight: 1.5, color: THEME.craie, opacity: .9 }}>{j + 1}. {e}</li>)}
              </ol>
              {r.substitutions && <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.45 }}>Substitutions — {r.substitutions}</div>}
              <div style={{ fontSize: 11, color: THEME.gris2, marginTop: 8 }}>Valeurs générées : ordre de grandeur, à recouper si la précision compte.</div>
            </Card>
          ))}

          <Carrousel titre="Ce soir" sousTitre={`${classees.length} recettes compatibles avec ton profil`} largeur={228}
            enfants={classees.slice(0, 10).map((r) => (
              <CarteVerre key={r.id} accent={r.manque.length === 0 ? "vert" : "jaune"} style={{ padding: 15 }}>
                <div className="fit-eyebrow" style={{ color: r.manque.length === 0 ? THEME.vert : THEME.jaune }}>
                  {r.manque.length === 0 ? "Tout est dans ton frigo" : `${r.manque.length} ingrédient${r.manque.length > 1 ? "s" : ""} à acheter`}
                </div>
                <div className="fit-display" style={{ fontSize: 18, lineHeight: 1.1, marginTop: 7, minHeight: 40 }}>{r.nom}</div>
                <div className="fit-data" style={{ fontSize: 24, marginTop: 12 }}>{r.nut.kcal}<span style={{ fontSize: 11, color: THEME.gris }}> kcal</span></div>
                <div className="flex gap-3 mt-2">
                  {[["P", r.nut.prot, "blanc"], ["G", r.nut.gluc, "jaune"], ["L", r.nut.lip, "rouge"]].map(([l, v, c]) => (
                    <div key={l}><span className="fit-eyebrow" style={{ color: C(c) }}>{l}</span>
                      <span className="fit-data" style={{ fontSize: 12, marginLeft: 4 }}>{v}</span></div>
                  ))}
                </div>
                <div className="fit-data mt-3" style={{ fontSize: 11, color: THEME.gris }}>{r.temps} min · {r.diff}</div>
              </CarteVerre>
            ))} />
          <div className="space-y-2.5">
            <Eyebrow>Toutes les recettes</Eyebrow>
            {classees.slice(0, 12).map((r) => <CarteRecette key={r.id} r={r} foods={foods} ajouterItem={ajouterItem} cuisine={cuisine} setCuisine={setCuisine} />)}
          </div>
        </>
      )}
    </div>
  );
}

function CarteRecette({ r, foods, ajouterItem, cuisine, setCuisine }) {
  const [open, setOpen] = useState(false);
  const fav = (cuisine.favoris || []).includes(r.id);
  const logger = () => {
    r.ing.forEach(([nom, g]) => {
      const f = resoudreIngredient(nom, foods); if (!f) return;
      ajouterItem({ nom: f.nom, g, cat: f.cat, kcal100: f.kcal, prot100: f.prot, gluc100: f.gluc, lip100: f.lip, sat100: f.sat, sucres100: f.sucres, fibres100: f.fibres, micros: f.micros }, "dej");
    });
    haptic(16); setOpen(false);
  };
  return (
    <Card accent={r.manque.length === 0 ? "vert" : undefined} style={{ padding: 14 }}>
      <button className="w-full text-left" onClick={() => { haptic(6); setOpen(!open); }}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="fit-display" style={{ fontSize: 14.5 }}>{r.nom}</span>
          <span className="fit-data" style={{ fontSize: 11, color: THEME.gris, whiteSpace: "nowrap" }}>{r.temps} min</span>
        </div>
        <div className="fit-data mt-1" style={{ fontSize: 11.5, color: THEME.gris }}>
          {r.nut.kcal} kcal · P {r.nut.prot} · G {r.nut.gluc} · L {r.nut.lip} · F {r.nut.fibres}
        </div>
        {r.manque.length > 0
          ? <div style={{ fontSize: 11.5, color: THEME.jaune, marginTop: 5 }}>Manque : {r.manque.join(", ")}</div>
          : <div style={{ fontSize: 11.5, color: THEME.vert, marginTop: 5 }}>Tout est dans ton frigo</div>}
      </button>
      {open && (
        <div className="fit-fade mt-3 space-y-3">
          <div>{r.ing.map(([n, g], i) => <Ligne key={i} g={n.includes("|") ? n.split("|")[0] : n} d={`${g} g`} />)}</div>
          <ol className="space-y-1.5">{r.etapes.map((e, i) => <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, opacity: .9 }}>{i + 1}. {e}</li>)}</ol>
          <div className="flex gap-2">
            <Btn small full onClick={logger} icon={Plus}>Logger au déjeuner</Btn>
            <Btn small variant="ghost" icon={Star} onClick={() => setCuisine({ ...cuisine, favoris: fav ? cuisine.favoris.filter((x) => x !== r.id) : [...(cuisine.favoris || []), r.id] })}>
              {fav ? "Retirer" : "Favori"}
            </Btn>
          </div>
          {r.manque.length > 0 && <Btn small full variant="ghost" icon={ShoppingCart}
            onClick={() => { setCuisine({ ...cuisine, courses: [...new Set([...(cuisine.courses || []), ...r.manque])] }); haptic(14); }}>
            Ajouter le manquant aux courses
          </Btn>}
        </div>
      )}
    </Card>
  );
}

/* ==========================================================================
   ÉCRAN — ENTRAÎNEMENT
   ========================================================================== */

function Entrainement({ app }) {
  const { profil, setProfil, entrainement, setEntrainement } = app;
  const [onglet, setOnglet] = useState("programme");
  const [enCours, setEnCours] = useState(null);
  const prog = entrainement.programme;
  const obj = OBJECTIFS_ENTRAINEMENT[profil.objectif];

  const generer = (splitId) => {
    const p = genererProgramme(profil, splitId || profil.splitId, prog?.semaine || 1);
    setEntrainement({ ...entrainement, programme: p });
    if (splitId) setProfil({ ...profil, splitId });
    haptic(16);
  };
  const genererRef = useRef(generer); genererRef.current = generer;
  useEffect(() => { if (!prog && profil.onboarde) genererRef.current(); }, [prog, profil.onboarde]);

  const splitsDispo = SPLITS.filter((s) => s.freq === profil.frequence);

  if (enCours) return <SeanceEnCours seance={enCours} app={app} fermer={() => setEnCours(null)} />;

  return (
    <div className="pb-6">
      <div className="px-5 pt-2">
        <Segmented cols={4} value={onglet} onChange={setOnglet} options={[
          { v: "programme", l: "Programme" }, { v: "progression", l: "Suivi" },
          { v: "muscles", l: "Muscles" }, { v: "exos", l: "Exercices" }]} />
      </div>

      {onglet === "programme" && (
        <div className="px-5 pt-5 space-y-5">
          {prog && (
            <>
              <div>
                <div className="fit-eyebrow">{obj.nom} · {prog.frequence} séances/semaine</div>
                <h2 className="fit-display" style={{ fontSize: 24, lineHeight: 1.1, marginTop: 4 }}>{prog.splitNom}</h2>
                <div className="fit-data mt-1.5" style={{ fontSize: 11.5, color: prog.deload ? THEME.vert : THEME.gris }}>
                  Semaine {prog.semaine}{prog.deload ? " — décharge" : ""} · méthode {METHODES[prog.methode]?.court || "standard"}
                </div>
                <Pourquoi couleur={obj.couleur} titre="Pourquoi ce split">{prog.pourquoiSplit}</Pourquoi>
                {METHODES[prog.methode] && (
                  <Pourquoi couleur="jaune" titre={`Méthode — ${METHODES[prog.methode].nom}`}>
                    <p>{METHODES[prog.methode].quoi}</p>
                    <p className="mt-2" style={{ color: THEME.gris }}>{METHODES[prog.methode].quand}</p>
                  </Pourquoi>
                )}
                <Pourquoi couleur={obj.couleur} titre={`La logique ${obj.nom.toLowerCase()}`}>
                  <p>{obj.logique}</p>
                  <p className="mt-2">{obj.comparaison}</p>
                  <p className="mt-2" style={{ color: THEME.gris }}>{obj.frequenceMouvement}</p>
                </Pourquoi>
              </div>

              {prog.adaptation && (
                <Card accent="jaune" style={{ padding: 14 }}>
                  <div className="fit-display" style={{ fontSize: 14 }}>Semaine de repérage</div>
                  <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
                    Cette première semaine sert à poser tes références : note chaque charge, reste deux répétitions sous l'échec, et ne cherche pas de record. Les techniques d'intensification arrivent à partir de la semaine 2, une fois que l'application sait où tu en es sur chaque mouvement. Sans référence de départ, la surcharge progressive n'a rien sur quoi s'appuyer.
                  </div>
                </Card>
              )}
              {prog.deload && (
                <Card accent="vert" style={{ padding: 14 }}>
                  <div className="fit-display" style={{ fontSize: 14 }}>Semaine de décharge</div>
                  <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
                    Volume réduit d'environ 45 %, RPE abaissé d'un point. Ce n'est pas une semaine perdue : c'est le moment où la supercompensation s'exprime. Sauter les décharges est la cause la plus fréquente de stagnation chez les pratiquants assidus.
                  </div>
                </Card>
              )}

              <Carrousel titre="Ta semaine" sousTitre={`${prog.frequence} séances · ${METHODES[prog.methode]?.court || "standard"}`} largeur={244}
                enfants={prog.seances.map((sc, i) => {
                  const faite = entrainement.seances.some((x) => x.jourKey === sc.jourKey && x.semaine === prog.semaine);
                  const premier = exById(sc.exos[0]?.exId);
                  return (
                    <CarteVerre key={i} accent={faite ? "vert" : obj.couleur} style={{ padding: 0 }}>
                      <div style={{ padding: "14px 16px 0" }}>
                        <div className="flex items-center justify-between">
                          <span className="fit-eyebrow" style={{ color: faite ? THEME.vert : C(obj.couleur) }}>
                            {faite ? "Terminée" : `Séance ${i + 1}`}
                          </span>
                          <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{sc.exos.length} exos</span>
                        </div>
                        <div className="fit-display" style={{ fontSize: 19, lineHeight: 1.08, marginTop: 6 }}>{sc.nom}</div>
                      </div>
                      {premier && <div style={{ padding: "6px 10px 0" }}><AnimExecution pattern={premier.pattern} hauteur={118} legende={premier.nom} /></div>}
                      <div style={{ padding: "8px 16px 16px" }}>
                        <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, lineHeight: 1.5, minHeight: 30 }}>
                          {sc.exos.map((e) => exById(e.exId)?.nom).filter(Boolean).slice(0, 3).join(" · ")}{sc.exos.length > 3 ? ` +${sc.exos.length - 3}` : ""}
                        </div>
                        <Btn small full onClick={() => setEnCours({ ...sc, semaine: prog.semaine })} icon={Play} style={{ marginTop: 10 }}>
                          {faite ? "Refaire" : "Lancer"}
                        </Btn>
                      </div>
                    </CarteVerre>
                  );
                })} />

              <div>
                <Eyebrow>Conseils sur cet objectif</Eyebrow>
                <Card style={{ padding: 14 }}>
                  {obj.conseils.map((c, i) => (
                    <div key={i} className="flex gap-2.5 py-1.5" style={{ borderBottom: i < obj.conseils.length - 1 ? `1px solid ${THEME.rule}` : "none" }}>
                      <span className="fit-data" style={{ fontSize: 11, color: C(obj.couleur), paddingTop: 2 }}>{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{c}</span>
                    </div>
                  ))}
                </Card>
              </div>

              <div>
                <Eyebrow>Changer de structure</Eyebrow>
                <div className="space-y-2">
                  {splitsDispo.map((s) => (
                    <Card key={s.id} accent={prog.splitId === s.id ? obj.couleur : undefined} onClick={() => generer(s.id)} style={{ padding: 12, cursor: "pointer", opacity: prog.splitId === s.id ? 1 : .65 }}>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.nom}</span>
                        <span className="fit-eyebrow" style={{ color: s.objectifs.includes(profil.objectif) ? THEME.gris : THEME.jaune }}>
                          {s.objectifs.includes(profil.objectif) ? METHODES[s.methode]?.court : "hors objectif"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: THEME.gris, marginTop: 4, lineHeight: 1.45 }}>{s.pourquoi}</div>
                    </Card>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Btn full variant="ghost" icon={RotateCcw} onClick={() => {
                  setEntrainement({ ...entrainement, programme: genererProgramme(profil, prog.splitId, prog.semaine + 1) }); haptic(14);
                }}>Passer à la semaine {prog.semaine + 1}</Btn>
              </div>
            </>
          )}
          {!prog && <Vide icone={Dumbbell} titre="Pas encore de programme." action="Générer" onAction={() => generer()} />}
        </div>
      )}

      {onglet === "progression" && <Progression app={app} />}
      {onglet === "muscles" && <Anatomie app={app} />}
      {onglet === "exos" && <BaseExercices profil={profil} />}
    </div>
  );
}

function SeanceEnCours({ seance, app, fermer }) {
  const { profil, entrainement, setEntrainement, dateKey } = app;
  const obj = OBJECTIFS_ENTRAINEMENT[profil.objectif];
  const [idx, setIdx] = useState(0);
  const [logs, setLogs] = useState({});
  // Le minuteur mémorise son instant de fin plutôt qu'un compte à rebours :
  // il se reconstitue correctement après un verrouillage d'écran ou un retour
  // depuis une autre application, là où un décompte en mémoire repartait à zéro.
  const [finRepos, setFinRepos] = useState(() => {
    try { const v = sessionStorage.getItem("wgu-repos"); return v ? parseInt(v, 10) : null; } catch { return null; }
  });
  const [repos, setReposBrut] = useState(null);
  const setRepos = useCallback((secondes) => {
    if (secondes == null) { setFinRepos(null); setReposBrut(null); try { sessionStorage.removeItem("wgu-repos"); } catch (e) { /* stockage de session refusé */ } return; }
    const fin = Date.now() + secondes * 1000;
    setFinRepos(fin); setReposBrut(secondes);
    try { sessionStorage.setItem("wgu-repos", String(fin)); } catch (e) { /* stockage de session refusé */ }
  }, []);
  const [notes, setNotes] = useState("");
  const timerRef = useRef(null);

  const reposActif = finRepos != null;
  useEffect(() => {
    if (!reposActif) return;
    const battement = () => {
      const restant = Math.ceil((finRepos - Date.now()) / 1000);
      if (restant <= 0) {
        clearInterval(timerRef.current); haptic(60); sonnerie();
        notifier("Repos terminé", `${exoRef.current?.nom || "Série suivante"} — c'est reparti.`);
        poserBadge(1); setTimeout(() => poserBadge(0), 30000);
        setFinRepos(null); setReposBrut(null);
        try { sessionStorage.removeItem("wgu-repos"); } catch (e) { /* stockage de session refusé */ }
      } else setReposBrut(restant);
    };
    battement();
    timerRef.current = setInterval(battement, 500);
    return () => clearInterval(timerRef.current);
  }, [reposActif, finRepos]);

  const ex = seance.exos[idx];
  const exo = exById(ex.exId);
  const exoRef = useRef(exo); exoRef.current = exo;
  const suggestion = prochaineSerie(entrainement.historiqueCharges, ex.exId, ex, profil.niveau);
  const stagnation = detecterStagnation(entrainement.historiqueCharges, ex.exId);
  const series = logs[ex.exId] || [];

  const [record, setRecord] = useState(null);
  const validerSerie = (charge, reps, rpe) => {
    const c = +charge || 0, r = +reps || 0;
    const arr = [...series, { charge: c, reps: r, rpe: +rpe || 8 }];
    setLogs({ ...logs, [ex.exId]: arr });
    setRepos(ex.repos);
    const rec = recordBattu(entrainement.historiqueCharges, ex.exId, c, r);
    setRecord(rec);
    haptic(rec ? 40 : 20);
  };

  const terminer = () => {
    const hist = { ...entrainement.historiqueCharges };
    Object.entries(logs).forEach(([exId, arr]) => {
      const meilleure = arr.reduce((a, b) => (epley(b.charge, b.reps) > epley(a.charge, a.reps) ? b : a), arr[0]);
      if (meilleure) hist[exId] = [...(hist[exId] || []), { d: dateKey, ...meilleure }];
    });
    setEntrainement({
      ...entrainement, historiqueCharges: hist,
      seances: [...entrainement.seances, { date: dateKey, jourKey: seance.jourKey, nom: seance.nom, semaine: seance.semaine, logs, notes }],
    });
    haptic(30); fermer();
  };

  return (
    <div className="pb-8">
      <div className="px-5 pt-2 flex items-center justify-between">
        <button onClick={fermer} className="fit-tap flex items-center gap-1" style={{ color: THEME.gris, fontSize: 13 }}><ChevronLeft size={16} />Quitter</button>
        <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{idx + 1} / {seance.exos.length}</span>
      </div>

      {record && (
        <div className="px-5 pt-4">
          <Card accent="rouge" style={{ padding: 13 }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="fit-eyebrow" style={{ color: THEME.rouge }}>Record battu</div>
                <div style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.5 }}>{record.texte}</div>
              </div>
              <button onClick={() => setRecord(null)} className="fit-tap flex items-start justify-center"
                aria-label="Masquer le record" style={{ color: THEME.gris2, minWidth: 26, minHeight: 26 }}><X size={15} /></button>
            </div>
          </Card>
        </div>
      )}

      {repos != null && (
        <div className="px-5 pt-4">
          <Card accent={obj.couleur} style={{ padding: 16 }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="fit-eyebrow">Repos</div>
                <div className="fit-display" style={{ fontSize: 40, lineHeight: 1 }} aria-hidden="true">
                  {Math.floor(repos / 60)}:{String(repos % 60).padStart(2, "0")}
                </div>
                {/* Annonce vocale à chaque palier, sans réciter chaque seconde */}
                <div className="sr-only" role="timer" aria-live="polite" aria-atomic="true">
                  {repos > 60 ? `${Math.ceil(repos / 60)} minutes de repos restantes`
                    : repos > 10 ? `${Math.ceil(repos / 10) * 10} secondes de repos restantes`
                    : `${repos} secondes`}
                </div>
              </div>
              <div className="flex gap-2">
                <Btn small variant="ghost" onClick={() => setRepos((repos || 0) + 30)}>+30 s</Btn>
                <Btn small variant="ghost" onClick={() => setRepos(null)}>Passer</Btn>
              </div>
            </div>
            <Pourquoi couleur={obj.couleur} titre="Pourquoi ce temps de repos">{ex.pourquoiRepos}</Pourquoi>
          </Card>
        </div>
      )}

      <div className="px-5 pt-5">
        <div className="fit-eyebrow" style={{ color: C(obj.couleur) }}>{ROLE_LABEL[ex.role]} · {exo.groupe}</div>
        <h2 className="fit-display" style={{ fontSize: 26, lineHeight: 1.08, marginTop: 4 }}>{exo.nom}</h2>
        <div className="fit-data mt-2" style={{ fontSize: 13 }}>
          {ex.series} × {ex.reps[0]}-{ex.reps[1]} {ex.unite === "s" ? "s" : "reps"} · RPE {ex.rpe[0]}-{ex.rpe[1]} · repos {Math.floor(ex.repos / 60)}′{ex.repos % 60 ? String(ex.repos % 60) + "″" : ""}
          {ex.tempo && ex.tempo.code !== "—" && <> · tempo {ex.tempo.code}</>}
        </div>
        {ex.tempo && ex.tempo.code !== "—" && (
          <Pourquoi couleur={obj.couleur} titre={`Tempo ${ex.tempo.code}`}>
            <p>{ex.tempo.texte}</p>
            <p className="mt-2" style={{ color: THEME.gris }}>{ex.tempo.pourquoi}</p>
          </Pourquoi>
        )}
        {ex.techniques?.length > 0 && (
          <div className="mt-3">
            <Eyebrow>Intensifier la dernière série</Eyebrow>
            <div className="space-y-2">
              {ex.techniques.map((t) => <FicheTechnique key={t} id={t} />)}
            </div>
            <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 8, lineHeight: 1.45 }}>
              Ce sont des options, pas des obligations. Une seule technique par séance suffit : elles coûtent toutes en récupération.
            </div>
          </div>
        )}

        <div className="mt-4"><Execution exercice={exo} hauteur={300} nom={exo.nom} /></div>

        {suggestion.charge != null && (
          <Card style={{ padding: 14, marginTop: 14 }}>
            <div className="fit-eyebrow mb-2">Charge de travail proposée</div>
            <div className="flex items-baseline gap-2 mb-2.5">
              <span className="fit-display" style={{ fontSize: 30 }}>{suggestion.charge}</span>
              <span style={{ fontSize: 13, color: THEME.gris }}>kg × {suggestion.reps}</span>
            </div>
            {(exo.materiel === "barre") && <PlateStack total={suggestion.charge} />}
            <Pourquoi couleur={obj.couleur} titre="Pourquoi cette charge">{suggestion.note}</Pourquoi>
          </Card>
        )}
        {suggestion.charge == null && <Card style={{ padding: 14, marginTop: 14 }}><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{suggestion.note}</div></Card>}

        {ex.alerte && (
          <Card accent="rouge" style={{ padding: 13, marginTop: 10 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Cet exercice reste proposé faute d'alternative avec ton matériel, mais il figure parmi ceux à surveiller pour ta zone sensible ({ex.alerte}). Charge prudente, et remplace-le si la moindre douleur apparaît.
            </div>
          </Card>
        )}
        {stagnation && <Card accent="jaune" style={{ padding: 14, marginTop: 10 }}><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{stagnation}</div></Card>}

        <div className="mt-5">
          <Eyebrow>Séries</Eyebrow>
          <div className="space-y-1.5">
            {series.map((s, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
                <span className="fit-data" style={{ fontSize: 12, color: THEME.gris }}>Série {i + 1}</span>
                <span className="fit-data" style={{ fontSize: 13 }}>{s.charge} kg × {s.reps} · RPE {s.rpe} <span style={{ color: THEME.gris }}>· 1RM ≈ {epley(s.charge, s.reps)}</span></span>
              </div>
            ))}
            {series.length < ex.series && <SaisieSerie defautCharge={suggestion.charge ?? series.at(-1)?.charge ?? 20} defautReps={suggestion.reps ?? ex.reps[0]} onValider={validerSerie} unite={ex.unite} />}
            {series.length >= ex.series && <div className="fit-data text-center py-2" style={{ fontSize: 12, color: THEME.vert }}>Séries prescrites terminées</div>}
          </div>
        </div>

        <Pourquoi couleur={obj.couleur} titre="Exécution et erreurs fréquentes">
          <p>{exo.interet}</p>
          <p className="mt-2"><span style={{ color: THEME.gris }}>Consignes — </span>{exo.consignes}</p>
          <p className="mt-2"><span style={{ color: THEME.gris }}>Erreurs — </span>{exo.erreurs}</p>
          {exo.contre && <p className="mt-2" style={{ color: THEME.rouge }}>Prudence — {exo.contre}</p>}
        </Pourquoi>

        <div className="flex gap-2 mt-5">
          <Btn variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)} icon={ChevronLeft}>{""}</Btn>
          {idx < seance.exos.length - 1
            ? <Btn full onClick={() => { setIdx(idx + 1); setRepos(null); }}>Exercice suivant</Btn>
            : <Btn full onClick={terminer} icon={Check}>Terminer la séance</Btn>}
        </div>

        {idx === seance.exos.length - 1 && (
          <div className="mt-4">
            <TextField label="Notes libres — douleurs, sensations, contexte" multi value={notes} onChange={setNotes} placeholder="Épaule droite un peu sensible sur le développé, sommeil court." />
          </div>
        )}
      </div>
    </div>
  );
}

function FicheTechnique({ id, ouvert }) {
  const t = TECHNIQUES[id];
  const [open, setOpen] = useState(!!ouvert);
  const pr = PREUVE[t.preuve];
  if (!t) return null;
  return (
    <div className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderLeft: `3px solid ${C(t.couleur)}` }}>
      <button onClick={() => { haptic(6); setOpen(!open); }} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.nom}</span>
          <ChevronDown size={14} style={{ color: THEME.gris2, transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
        </div>
        <div className="fit-data" style={{ fontSize: 11, color: C(t.couleur), marginTop: 3 }}>{t.notation}</div>
      </button>
      {open && (
        <div className="px-3 pb-3 fit-fade space-y-2" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          <p>{t.quoi}</p>
          <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.bleu}` }}>
            <div className="fit-eyebrow" style={{ color: THEME.bleu }}>Pourquoi ça marche</div>
            <p className="mt-1">{t.pourquoi}</p>
          </div>
          <p><span style={{ color: THEME.gris }}>Quand l'utiliser — </span>{t.quand}</p>
          <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.rouge}` }}>
            <div className="fit-eyebrow" style={{ color: THEME.rouge }}>Coût en récupération</div>
            <p className="mt-1">{t.cout}</p>
          </div>
          <div className="fit-eyebrow" style={{ color: C(pr.c) }}>{pr.l}</div>
        </div>
      )}
    </div>
  );
}

function SaisieSerie({ defautCharge, defautReps, onValider, unite }) {
  const [c, setC] = useState(defautCharge);
  const [r, setR] = useState(defautReps);
  const [rpe, setRpe] = useState(8);
  useEffect(() => { setC(defautCharge); setR(defautReps); }, [defautCharge, defautReps]);
  return (
    <div className="rounded-lg p-3 space-y-3" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
      <div className="grid grid-cols-2 gap-2">
        <NumField label={unite === "s" ? "Charge" : "Charge"} value={c} onChange={setC} suffix="kg" />
        <NumField label={unite === "s" ? "Secondes" : "Répétitions"} value={r} onChange={setR} />
      </div>
      <div>
        <div className="flex justify-between mb-1.5">
          <span className="fit-eyebrow">RPE ressenti</span>
          <span className="fit-data" style={{ fontSize: 12 }}>{rpe} · {rpe >= 10 ? "échec" : `${10 - rpe} rép. en réserve`}</span>
        </div>
        <input type="range" min={5} max={10} step={0.5} value={rpe} onChange={(e) => setRpe(+e.target.value)} className="w-full" />
      </div>
      <Btn full onClick={() => onValider(c, r, rpe)} icon={Check}>Valider la série</Btn>
    </div>
  );
}

function Progression({ app }) {
  const { entrainement } = app;
  const hist = entrainement.historiqueCharges;
  const exIds = Object.keys(hist).filter((k) => hist[k].length >= 2);
  const [sel, setSel] = useState(exIds[0] || null);
  const volumeParSemaine = useMemo(() => {
    const m = {};
    entrainement.seances.forEach((s) => {
      const sem = `S${s.semaine}`;
      let v = 0;
      Object.values(s.logs || {}).flat().forEach((x) => { v += (x.charge || 0) * (x.reps || 0); });
      m[sem] = (m[sem] || 0) + v;
    });
    return Object.entries(m).map(([sem, v]) => ({ sem, v: Math.round(v) }));
  }, [entrainement.seances]);

  if (!entrainement.seances.length) return <div className="px-5"><Vide icone={TrendingUp} titre="Aucune séance enregistrée. Les courbes de progression apparaîtront dès la deuxième séance sur un même exercice." /></div>;

  const data = sel ? hist[sel].map((h) => ({ j: dateFr(h.d), charge: h.charge, rm: epley(h.charge, h.reps) })) : [];

  return (
    <div className="px-5 pt-5 space-y-6">
      <div>
        <Eyebrow>Charge et 1RM estimé</Eyebrow>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {exIds.map((id) => <Chip key={id} actif={sel === id} onClick={() => setSel(id)}>{exById(id)?.nom}</Chip>)}
        </div>
        {sel && (
          <>
            <Graphique hauteur={160} rendu={(R) => (
                <R.LineChart data={data}>
                    <R.CartesianGrid stroke={THEME.rule} vertical={false} />
                    <R.XAxis dataKey="j" tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} />
                    <R.YAxis tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} width={34} />
                    <R.Tooltip contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderRadius: 8, fontFamily: FF.data, fontSize: 12 }} />
                    <R.Line type="monotone" dataKey="charge" name="Charge" stroke={THEME.craie} strokeWidth={2} dot={{ r: 2 }} />
                    <R.Line type="monotone" dataKey="rm" name="1RM estimé" stroke={THEME.rouge} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  </R.LineChart>
              )} />
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.5 }}>
              Le 1RM est estimé par la formule d'Epley à partir des séries loggées : cela permet de piloter les pourcentages sans jamais avoir à tester un maximum réel, ce qui est coûteux en fatigue et risqué seul.
            </div>
            {chargerBarre(hist[sel].at(-1).charge).possible && exById(sel)?.materiel === "barre" && (
              <Card style={{ padding: 12, marginTop: 10 }}>
                <div className="fit-eyebrow mb-2">Dernière charge — chargement de barre</div>
                <PlateStack total={hist[sel].at(-1).charge} />
              </Card>
            )}
          </>
        )}
      </div>
      {volumeParSemaine.length > 1 && (
        <div>
          <Eyebrow>Volume total par semaine (kg soulevés)</Eyebrow>
          <Graphique hauteur={130} rendu={(R) => (
              <R.BarChart data={volumeParSemaine}>
                  <R.CartesianGrid stroke={THEME.rule} vertical={false} />
                  <R.XAxis dataKey="sem" tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} />
                  <R.YAxis tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} width={44} />
                  <R.Tooltip contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderRadius: 8, fontFamily: FF.data, fontSize: 12 }} />
                  <R.Bar dataKey="v" fill={THEME.bleu} radius={[3, 3, 0, 0]} />
                </R.BarChart>
            )} />
        </div>
      )}
      <BlocStagnation app={app} />
      <VolumeHebdo seances={entrainement.seances} />
      <Records historique={entrainement.historiqueCharges} />

      <div>
        <Eyebrow>Historique des séances</Eyebrow>
        <div className="space-y-1.5">
          {[...entrainement.seances].reverse().slice(0, 12).map((s, i) => (
            <Card key={i} style={{ padding: 12 }}>
              <div className="flex justify-between items-baseline">
                <span style={{ fontSize: 13.5 }}>{s.nom}</span>
                <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{dateFr(s.date)}</span>
              </div>
              {s.notes && <div style={{ fontSize: 12, color: THEME.gris, marginTop: 5, lineHeight: 1.45 }}>{s.notes}</div>}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function VolumeHebdo({ seances }) {
  const [fenetre, setFenetre] = useState(1);
  const vol = useMemo(() => volumeParGroupe(seances, fenetre), [seances, fenetre]);
  if (!vol.length) return null;
  const max = Math.max(...vol.map((v) => v.series), FOURCHETTE_VOLUME[1]);
  const couleurs = { bas: "jaune", cible: "vert", haut: "rouge" };
  const bas = vol.filter((v) => v.etat === "bas");
  return (
    <div>
      <Eyebrow right={
        <div className="flex gap-1.5">
          {[1, 4].map((f) => <Chip key={f} actif={fenetre === f} onClick={() => setFenetre(f)}>{f === 1 ? "7 j" : "4 sem"}</Chip>)}
        </div>
      }>Séries efficaces par groupe</Eyebrow>
      <Card style={{ padding: 14 }}>
        <div style={{ fontSize: 12, color: THEME.gris, lineHeight: 1.5, marginBottom: 12 }}>
          Ne sont comptées que les séries menées à RPE {SERIE_EFFICACE_RPE} ou plus. Le travail indirect compte pour moitié.
          La fourchette utile va de {FOURCHETTE_VOLUME[0]} à {FOURCHETTE_VOLUME[1]} séries par groupe et par semaine.
        </div>
        {vol.map((v) => (
          <div key={v.groupe} className="py-1.5">
            <div className="flex items-baseline justify-between mb-1">
              <span style={{ fontSize: 12.5 }}>{GROUPES_MUSCULAIRES[v.groupe]?.nom || v.groupe}</span>
              <span className="fit-data" style={{ fontSize: 11.5, color: C(couleurs[v.etat]) }}>
                {v.series} <span style={{ color: THEME.gris }}>séries/sem</span>
              </span>
            </div>
            <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: THEME.surface2 }}>
              <div className="absolute inset-y-0" style={{
                left: `${(FOURCHETTE_VOLUME[0] / max) * 100}%`,
                width: `${((FOURCHETTE_VOLUME[1] - FOURCHETTE_VOLUME[0]) / max) * 100}%`,
                background: "rgba(67,160,110,.16)" }} />
              <div className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.min((v.series / max) * 100, 100)}%`, background: C(couleurs[v.etat]), transition: "width .4s" }} />
            </div>
          </div>
        ))}
        {bas.length > 0 && (
          <Pourquoi couleur="jaune" titre={`${bas.length} groupe${bas.length > 1 ? "s" : ""} sous la fourchette`}>
            <p>{bas.map((v) => GROUPES_MUSCULAIRES[v.groupe]?.nom || v.groupe).join(", ")} {bas.length > 1 ? "reçoivent" : "reçoit"} moins de {FOURCHETTE_VOLUME[0]} séries efficaces par semaine.</p>
            <p className="mt-2" style={{ color: THEME.gris }}>Deux causes possibles : le split ne les couvre pas assez, ou les séries s'arrêtent trop loin de l'échec pour compter. Vérifie ton RPE avant d'ajouter du volume — une série à RPE 6 ne stimule presque rien.</p>
          </Pourquoi>
        )}
      </Card>
    </div>
  );
}

function Records({ historique }) {
  const recs = useMemo(() => recordsPersonnels(historique), [historique]);
  const [tout, setTout] = useState(false);
  if (!recs.length) return null;
  const liste = tout ? recs : recs.slice(0, 6);
  return (
    <div>
      <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{recs.length}</span>}>Records personnels</Eyebrow>
      <div className="space-y-1.5">
        {liste.map((r) => (
          <Card key={r.exId} style={{ padding: 12 }}>
            <div className="flex items-baseline justify-between gap-2">
              <span style={{ fontSize: 13 }}>{r.nom}</span>
              <span className="fit-data" style={{ fontSize: 12, color: THEME.rouge, whiteSpace: "nowrap" }}>{Math.round(r.rm)} kg</span>
            </div>
            <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 3 }}>
              maximum estimé depuis {r.rmSerie.charge} kg × {r.rmSerie.reps} · charge record {r.charge.charge} kg · {r.n} séances
            </div>
          </Card>
        ))}
      </div>
      {recs.length > 6 && (
        <button onClick={() => { haptic(6); setTout(!tout); }} className="fit-eyebrow mt-2" style={{ color: THEME.craie }}>
          {tout ? "Réduire" : `Voir les ${recs.length - 6} autres`}
        </button>
      )}
    </div>
  );
}

function BaseExercices({ profil }) {
  const [q, setQ] = useState("");
  const [ouvertId, setOuvertId] = useState(null);
  const [groupe, setGroupe] = useState(null);
  const [mat, setMat] = useState(false);
  const [niveau, setNiveau] = useState(null);
  const groupes = [...new Set(EXERCICES.map((e) => e.groupe))];
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dispo = (e) => profil.materiel.includes(e.materiel) || e.materiel === "aucun";
  const liste = EXERCICES.filter((e) =>
    (!q || norm(e.nom).includes(norm(q)) || e.chefs.some((c) => norm(nomMuscle(c)).includes(norm(q))))
    && (!groupe || e.groupe === groupe)
    && (!niveau || e.niveau === niveau)
    && (!mat || dispo(e)));
  return (
    <div className="px-5 pt-5 space-y-4">
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: THEME.gris }} />
        <input className="fit-input" style={{ paddingLeft: 38, fontFamily: FF.body }} placeholder="Exercice ou muscle" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {groupes.map((g) => <Chip key={g} actif={groupe === g} onClick={() => setGroupe(groupe === g ? null : g)}>{g}</Chip>)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[["debutant", "Débutant"], ["inter", "Intermédiaire"], ["avance", "Avancé"]].map(([k, l]) =>
          <Chip key={k} actif={niveau === k} onClick={() => setNiveau(niveau === k ? null : k)}>{l}</Chip>)}
      </div>
      <div className="flex items-center justify-between">
        <span className="fit-eyebrow">Uniquement mon matériel</span>
        <Interrupteur on={mat} onChange={setMat} />
      </div>
      <div className="space-y-1.5">
        <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{liste.length} / {EXERCICES.length}</span>}>Exercices</Eyebrow>
        {liste.map((e) => <FicheExercice key={e.id} e={e} dispo={dispo(e)} deconseille={exerciceDeconseille(e, profil.zonesSensibles)} ouvertId={ouvertId} setOuvertId={setOuvertId} />)}
        {!liste.length && <Vide titre="Aucun exercice ne correspond à ces filtres." />}
      </div>
    </div>
  );
}

function FicheExercice({ e, dispo, compact, deconseille, ouvertId, setOuvertId }) {
  // Accordéon piloté par le parent quand il en fournit un : cela garantit
  // qu'une seule représentation 3D est montée à la fois, là où le navigateur
  // ne concède qu'une poignée de contextes WebGL par page.
  const [localOpen, setLocalOpen] = useState(false);
  const controle = typeof setOuvertId === "function";
  const open = controle ? ouvertId === e.id : localOpen;
  const setOpen = (v) => (controle ? setOuvertId(v ? e.id : null) : setLocalOpen(v));
  return (
    <div className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, opacity: dispo === false ? .55 : 1 }}>
      <button onClick={() => { haptic(6); setOpen(!open); }} className="w-full text-left px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span style={{ fontSize: 13.5 }}>{e.nom}</span>
          <span className="fit-eyebrow whitespace-nowrap">{e.type === "poly" ? "Polyarticulaire" : e.type === "cardio" ? "Cardio" : "Isolation"}</span>
        </div>
        <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
          {e.chefs.map(nomMuscle).join(" · ")}{compact ? "" : ` — ${e.materiel}`}
        </div>
        {deconseille && <div className="fit-eyebrow mt-1" style={{ color: THEME.rouge }}>Déconseillé — {deconseille}</div>}
      </button>
      {open && (
        <div className="px-3 pb-3 fit-fade space-y-2.5" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          <Execution exercice={e} hauteur={252} nom={e.nom} />
          <p>{e.interet}</p>
          <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.bleu}` }}>
            <div className="fit-eyebrow" style={{ color: THEME.bleu }}>Comment le muscle travaille</div>
            <p className="mt-1">{e.mecanique}</p>
          </div>
          <div>
            <div className="fit-eyebrow mb-1">Muscles sollicités</div>
            {e.chefs.map((c) => (
              <div key={c} className="py-1" style={{ borderBottom: `1px solid ${THEME.rule}` }}>
                <div style={{ fontSize: 12.5, color: THEME.craie }}>{nomMuscleLong(c)}</div>
                <div style={{ fontSize: 11.5, color: THEME.gris, lineHeight: 1.45, marginTop: 2 }}>{MUSCLES[c]?.fonction}</div>
              </div>
            ))}
            {e.secondaires.length > 0 && <div style={{ fontSize: 11.5, color: THEME.gris, marginTop: 6 }}>
              En soutien — {e.secondaires.map(nomMuscleLong).join(", ")}.
            </div>}
          </div>
          <p><span style={{ color: THEME.gris }}>Exécution — </span>{e.consignes}</p>
          <p><span style={{ color: THEME.gris }}>Erreurs fréquentes — </span>{e.erreurs}</p>
          {e.risques && (
            <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.rouge}` }}>
              <div className="fit-eyebrow" style={{ color: THEME.rouge }}>Risque de blessure</div>
              <p className="mt-1">{e.risques}</p>
            </div>
          )}
          <p><span style={{ color: THEME.gris }}>Variantes — </span>{e.variantes}</p>
          {e.contre && <p style={{ color: THEME.rouge }}>Contre-indications — {e.contre}. En cas de doute, l'avis d'un kinésithérapeute prime sur cette fiche.</p>}
          {dispo === false && <p style={{ color: THEME.jaune }}>Matériel absent de ton profil : une substitution automatique sera proposée dans le programme.</p>}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   ÉCRAN — ANATOMIE : mannequin cliquable, muscle puis faisceau
   ========================================================================== */



/* ==========================================================================
   ANIMATIONS D'EXÉCUTION
   Une figure articulée dessinée en direct, interpolée entre la position de
   départ et la position d'arrivée du schéma moteur. Tout est vectoriel :
   aucun fichier à charger, fonctionne hors connexion, pèse quelques kilo-octets.
   ========================================================================== */

const POSES = {
  squat: {
    nom: "Flexion complète sous charge axiale", vue: "profil", charge: "dos",
    a: { tete: [70, 30], epaule: [70, 46], coude: [56, 52], main: [52, 44], hanche: [70, 82], genou: [70, 114], pied: [70, 150], barre: [70, 44] },
    b: { tete: [64, 54], epaule: [63, 70], coude: [49, 76], main: [45, 68], hanche: [56, 104], genou: [84, 118], pied: [70, 150], barre: [63, 68] },
  },
  charniere: {
    nom: "Charnière de hanche, dos neutre", vue: "profil", charge: "mains",
    a: { tete: [70, 30], epaule: [70, 46], coude: [70, 64], main: [70, 82], hanche: [70, 82], genou: [70, 114], pied: [70, 150], barre: [70, 82] },
    b: { tete: [96, 56], epaule: [88, 68], coude: [86, 86], main: [84, 106], hanche: [56, 86], genou: [72, 116], pied: [70, 150], barre: [84, 106] },
  },
  fente: {
    nom: "Appui unilatéral, descente verticale", vue: "profil", charge: "mains",
    a: { tete: [72, 30], epaule: [72, 46], coude: [72, 64], main: [72, 82], hanche: [72, 84], genou: [78, 116], pied: [80, 150], barre: null, pied2: [62, 150], genou2: [66, 116] },
    b: { tete: [70, 46], epaule: [70, 62], coude: [70, 80], main: [70, 98], hanche: [70, 100], genou: [96, 122], pied: [98, 150], barre: null, pied2: [42, 148], genou2: [46, 126] },
  },
  unipodal: {
    nom: "Montée sur un appui", vue: "profil", charge: "mains",
    a: { tete: [58, 44], epaule: [58, 60], coude: [58, 78], main: [58, 96], hanche: [58, 96], genou: [58, 124], pied: [58, 152], pied2: [92, 118], genou2: [80, 122] },
    b: { tete: [90, 24], epaule: [90, 40], coude: [90, 58], main: [90, 76], hanche: [90, 76], genou: [92, 98], pied: [94, 118], pied2: [72, 128], genou2: [86, 100] },
  },
  pousseeH: {
    nom: "Poussée horizontale, allongé", vue: "profil", charge: "mains", banc: true,
    a: { tete: [34, 84], epaule: [52, 90], coude: [52, 68], main: [52, 46], hanche: [86, 92], genou: [104, 114], pied: [104, 146], barre: [52, 46] },
    b: { tete: [34, 84], epaule: [52, 90], coude: [36, 78], main: [54, 72], hanche: [86, 92], genou: [104, 114], pied: [104, 146], barre: [54, 72] },
  },
  pousseeV: {
    nom: "Poussée verticale au-dessus de la tête", vue: "profil", charge: "mains",
    a: { tete: [70, 44], epaule: [70, 60], coude: [54, 66], main: [58, 50], hanche: [70, 96], genou: [70, 124], pied: [70, 150], barre: [58, 50] },
    b: { tete: [70, 44], epaule: [70, 60], coude: [64, 40], main: [66, 20], hanche: [70, 96], genou: [70, 124], pied: [70, 150], barre: [66, 20] },
  },
  tirageV: {
    nom: "Traction verticale, suspension", vue: "profil", charge: "fixe",
    a: { tete: [70, 60], epaule: [70, 76], coude: [70, 52], main: [70, 26], hanche: [70, 110], genou: [74, 136], pied: [66, 154], barre: [70, 26] },
    b: { tete: [70, 36], epaule: [70, 54], coude: [54, 44], main: [70, 26], hanche: [70, 92], genou: [80, 116], pied: [70, 136], barre: [70, 26] },
  },
  tirageH: {
    nom: "Tirage horizontal, buste penché", vue: "profil", charge: "mains",
    a: { tete: [98, 56], epaule: [88, 68], coude: [86, 88], main: [84, 108], hanche: [58, 86], genou: [66, 116], pied: [62, 150], barre: [84, 108] },
    b: { tete: [98, 56], epaule: [88, 68], coude: [104, 82], main: [84, 84], hanche: [58, 86], genou: [66, 116], pied: [62, 150], barre: [84, 84] },
  },
  bras: {
    nom: "Flexion de coude, coudes fixes", vue: "profil", charge: "mains",
    a: { tete: [70, 30], epaule: [70, 48], coude: [70, 76], main: [72, 102], hanche: [70, 92], genou: [70, 122], pied: [70, 150], barre: [72, 102] },
    b: { tete: [70, 30], epaule: [70, 48], coude: [70, 76], main: [82, 56], hanche: [70, 92], genou: [70, 122], pied: [70, 150], barre: [82, 56] },
  },
  epauleIso: {
    nom: "Abduction du bras, vue de face", vue: "face", charge: "mains",
    a: { tete: [70, 28], epaule: [70, 48], coude: [54, 66], main: [50, 92], hanche: [70, 96], genou: [70, 124], pied: [70, 150], epauleD: [70, 48], coudeD: [86, 66], mainD: [90, 92] },
    b: { tete: [70, 28], epaule: [70, 48], coude: [44, 52], main: [22, 50], hanche: [70, 96], genou: [70, 124], pied: [70, 150], epauleD: [70, 48], coudeD: [96, 52], mainD: [118, 50] },
  },
  mollet: {
    nom: "Extension de cheville", vue: "profil", charge: "dos",
    a: { tete: [70, 38], epaule: [70, 54], coude: [58, 60], main: [54, 52], hanche: [70, 90], genou: [70, 120], pied: [70, 152], barre: [70, 52] },
    b: { tete: [70, 18], epaule: [70, 34], coude: [58, 40], main: [54, 32], hanche: [70, 70], genou: [70, 104], pied: [70, 152], barre: [70, 32] },
  },
  gainage: {
    nom: "Maintien isométrique, corps aligné", vue: "profil", charge: null,
    a: { tete: [32, 116], epaule: [52, 122], coude: [52, 150], main: [28, 152], hanche: [92, 134], genou: [112, 144], pied: [128, 152] },
    b: { tete: [32, 112], epaule: [52, 118], coude: [52, 150], main: [28, 152], hanche: [92, 128], genou: [112, 141], pied: [128, 152] },
  },
  excentrique: {
    nom: "Descente freinée, contrôle lent", vue: "profil", charge: null,
    a: { tete: [62, 34], epaule: [62, 50], coude: [50, 62], main: [46, 76], hanche: [62, 86], genou: [62, 118], pied: [62, 150], pied2: [92, 120], genou2: [80, 112] },
    b: { tete: [62, 56], epaule: [62, 72], coude: [50, 84], main: [46, 98], hanche: [58, 106], genou: [80, 122], pied: [62, 150], pied2: [98, 150], genou2: [92, 128] },
  },
  cardio: {
    nom: "Cycle de marche chargée", vue: "profil", charge: "sac",
    a: { tete: [68, 30], epaule: [68, 48], coude: [58, 66], main: [54, 84], hanche: [68, 92], genou: [58, 120], pied: [50, 148], pied2: [88, 148], genou2: [80, 120] },
    b: { tete: [68, 30], epaule: [68, 48], coude: [80, 64], main: [86, 82], hanche: [68, 92], genou: [84, 118], pied: [92, 148], pied2: [48, 146], genou2: [56, 122] },
  },
  mobilite: {
    nom: "Amplitude contrôlée", vue: "face", charge: null,
    a: { tete: [70, 30], epaule: [70, 50], coude: [52, 66], main: [46, 88], hanche: [70, 96], genou: [70, 124], pied: [70, 150], epauleD: [70, 50], coudeD: [88, 66], mainD: [94, 88] },
    b: { tete: [70, 30], epaule: [70, 50], coude: [48, 40], main: [38, 20], hanche: [70, 96], genou: [70, 124], pied: [70, 150], epauleD: [70, 50], coudeD: [92, 40], mainD: [102, 20] },
  },
  adducteur: {
    nom: "Travail dans le plan frontal", vue: "face", charge: null,
    a: { tete: [70, 28], epaule: [70, 48], coude: [56, 68], main: [54, 90], hanche: [70, 94], genou: [60, 122], pied: [56, 150], epauleD: [70, 48], coudeD: [84, 68], mainD: [86, 90], genou2: [80, 122], pied2: [84, 150] },
    b: { tete: [70, 40], epaule: [70, 58], coude: [56, 76], main: [58, 96], hanche: [70, 102], genou: [34, 124], pied: [20, 150], epauleD: [70, 58], coudeD: [84, 76], mainD: [82, 96], genou2: [106, 124], pied2: [120, 150] },
  },
  avantbras: {
    nom: "Flexion et extension du poignet", vue: "profil", charge: "mains",
    a: { tete: [70, 30], epaule: [70, 48], coude: [58, 76], main: [86, 88], hanche: [70, 92], genou: [70, 122], pied: [70, 150], barre: [92, 96] },
    b: { tete: [70, 30], epaule: [70, 48], coude: [58, 76], main: [86, 88], hanche: [70, 92], genou: [70, 122], pied: [70, 150], barre: [94, 76] },
  },
  lombaire: {
    nom: "Extension du tronc, banc à 45 degrés", vue: "profil", charge: null,
    a: { tete: [40, 74], epaule: [52, 76], coude: [46, 92], main: [42, 108], hanche: [86, 92], genou: [106, 112], pied: [110, 142] },
    b: { tete: [34, 104], epaule: [50, 100], coude: [44, 116], main: [40, 130], hanche: [86, 92], genou: [106, 112], pied: [110, 142] },
  },
};
const poseDe = (pattern) => POSES[pattern] || POSES.gainage;

function AnimExecution({ pattern, hauteur = 172, vitesse = 1, legende }) {
  const [t, setT] = useState(0);
  const [joue, setJoue] = useState(true);
  const ref = useRef();
  const pose = poseDe(pattern);

  useEffect(() => {
    if (!joue) return;
    let brut;
    const debut = performance.now();
    const boucle = (maintenant) => {
      const cycle = 2600 / vitesse;
      const phase = ((maintenant - debut) % cycle) / cycle;
      // Aller-retour avec un ralenti aux extrémités : le regard a le temps de
      // lire la position de départ et la position d'arrivée.
      setT(0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
      brut = requestAnimationFrame(boucle);
    };
    brut = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(brut);
  }, [joue, vitesse]);

  const pt = (cle) => {
    const a = pose.a[cle], b = pose.b[cle];
    if (!a || !b) return a || b || null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const seg = (p1, p2, ep = 5, col = THEME.craie, op = 1) => {
    const A = pt(p1), B = pt(p2);
    if (!A || !B) return null;
    return <line key={p1 + p2} x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={col} strokeWidth={ep} strokeLinecap="round" opacity={op} />;
  };
  const fantome = (cle1, cle2) => {
    const A = pose.b[cle1], B = pose.b[cle2];
    if (!A || !B) return null;
    return <line key={"f" + cle1 + cle2} x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={THEME.gris2} strokeWidth={2} strokeLinecap="round" opacity={0.28} strokeDasharray="3 4" />;
  };
  const tete = pt("tete");
  const barre = pt("barre");
  const paires = [["epaule", "hanche"], ["hanche", "genou"], ["genou", "pied"], ["epaule", "coude"], ["coude", "main"]];
  const pairesSec = [["hanche", "genou2"], ["genou2", "pied2"], ["epauleD", "coudeD"], ["coudeD", "mainD"]];

  return (
    <div>
      <div className="rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg, rgba(255,255,255,.035), rgba(0,0,0,0))", border: `1px solid ${THEME.rule}` }}>
        <svg ref={ref} viewBox="0 0 140 170" style={{ width: "100%", height: hauteur, display: "block" }} role="img" aria-label={`Schéma d'exécution — ${pose.nom}`}>
          <line x1="8" y1="156" x2="132" y2="156" stroke={THEME.rule} strokeWidth="1.5" />
          {pose.banc && <rect x="26" y="94" width="74" height="7" rx="3" fill={THEME.surface2} stroke={THEME.rule} />}
          {pose.charge === "fixe" && <line x1="30" y1="26" x2="110" y2="26" stroke={THEME.gris2} strokeWidth="4" strokeLinecap="round" />}
          {/* trace de la position d'arrivée : l'amplitude devient lisible d'un coup d'œil */}
          {paires.map(([a, b]) => fantome(a, b))}
          {pairesSec.map(([a, b]) => fantome(a, b))}
          {pose.b.tete && <circle cx={pose.b.tete[0]} cy={pose.b.tete[1]} r="8" fill="none" stroke={THEME.gris2} strokeWidth="1.5" opacity="0.28" strokeDasharray="3 4" />}
          {/* figure animée */}
          {pairesSec.map(([a, b]) => seg(a, b, 4, THEME.gris, 0.8))}
          {paires.map(([a, b]) => seg(a, b, 5))}
          {tete && <circle cx={tete[0]} cy={tete[1]} r="8.5" fill={THEME.craie} />}
          {barre && pose.charge !== "fixe" && (
            <g>
              <line x1={barre[0] - 22} y1={barre[1]} x2={barre[0] + 22} y2={barre[1]} stroke={THEME.craie} strokeWidth="3" strokeLinecap="round" />
              <rect x={barre[0] - 24} y={barre[1] - 7} width="5" height="14" rx="2" fill={THEME.rouge} />
              <rect x={barre[0] + 19} y={barre[1] - 7} width="5" height="14" rx="2" fill={THEME.rouge} />
            </g>
          )}
          {pose.charge === "sac" && tete && <rect x={pt("epaule")[0] - 12} y={pt("epaule")[1] - 2} width="14" height="26" rx="5" fill={THEME.jaune} opacity="0.85" />}
        </svg>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="fit-eyebrow">{legende || pose.nom}</span>
        <button onClick={() => { haptic(6); setJoue(!joue); }} className="fit-tap flex items-center gap-1.5" style={{ color: THEME.gris, minHeight: 32 }}>
          {joue ? <Pause size={13} /> : <Play size={13} />}
          <span className="fit-eyebrow">{joue ? "Pause" : "Lire"}</span>
        </button>
      </div>
    </div>
  );
}


/* ==========================================================================
   REPRÉSENTATION 3D ANIMÉE DES EXERCICES
   Squelette articulé de quinze os, habillé de volumes musculaires. Les poses
   sont stockées en angles articulaires et interpolées ; la figure est reposée
   au sol à chaque image pour qu'aucune position ne flotte. Les muscles
   sollicités par l'exercice s'éclairent pendant le mouvement.
   ========================================================================== */

const SQUELETTE = {
  racine:  { parent: null,      L: 0.00, dir: 1,  off: [0, 0, 0],       ep: 0.00 },
  colonne: { parent: "racine",  L: 0.46, dir: 1,  off: [0, 0, 0],       ep: 0.128 },
  cou:     { parent: "colonne", L: 0.14, dir: 1,  off: [0, 0, 0],       ep: 0.055 },
  brasG:   { parent: "colonne", L: 0.30, dir: -1, off: [-0.215, -0.03, 0], ep: 0.057 },
  avbrasG: { parent: "brasG",   L: 0.27, dir: -1, off: [0, 0, 0],       ep: 0.048 },
  mainG:   { parent: "avbrasG", L: 0.10, dir: -1, off: [0, 0, 0],       ep: 0.042 },
  brasD:   { parent: "colonne", L: 0.30, dir: -1, off: [0.215, -0.03, 0],  ep: 0.057 },
  avbrasD: { parent: "brasD",   L: 0.27, dir: -1, off: [0, 0, 0],       ep: 0.048 },
  mainD:   { parent: "avbrasD", L: 0.10, dir: -1, off: [0, 0, 0],       ep: 0.042 },
  cuisseG: { parent: "racine",  L: 0.45, dir: -1, off: [-0.11, 0, 0],   ep: 0.088 },
  molletG: { parent: "cuisseG", L: 0.43, dir: -1, off: [0, 0, 0],       ep: 0.068 },
  piedG:   { parent: "molletG", L: 0.17, dir: -1, off: [0, 0, 0],       ep: 0.048 },
  cuisseD: { parent: "racine",  L: 0.45, dir: -1, off: [0.11, 0, 0],    ep: 0.088 },
  molletD: { parent: "cuisseD", L: 0.43, dir: -1, off: [0, 0, 0],       ep: 0.068 },
  piedD:   { parent: "molletD", L: 0.17, dir: -1, off: [0, 0, 0],       ep: 0.048 },
};
const OS_ORDRE = Object.keys(SQUELETTE);

/* Volumes musculaires : chaque groupe est rattaché à l'os qui le porte.
   pos est exprimé en fraction de la longueur de l'os. */
const MUSCLES_3D = [
  { g: "pectoraux",  os: "colonne", pos: 0.72, s: [0.10, 0.078, 0.062], off: [0.075, 0, 0.098], miroir: true },
  { g: "abdominaux", os: "colonne", pos: 0.36, s: [0.10, 0.16, 0.06],  off: [0, 0, 0.10] },
  { g: "dos",        os: "colonne", pos: 0.62, s: [0.115, 0.20, 0.072], off: [0.10, 0, -0.082], miroir: true },
  { g: "trapezes",   os: "colonne", pos: 0.94, s: [0.16, 0.10, 0.075], off: [0, 0, -0.05] },
  { g: "lombaires",  os: "colonne", pos: 0.22, s: [0.085, 0.13, 0.05], off: [0, 0, -0.095] },
  { g: "deltoides",  os: "brasG",   pos: 0.94, s: [0.098, 0.105, 0.105], off: [-0.012, 0, 0] },
  { g: "deltoides",  os: "brasD",   pos: 0.94, s: [0.098, 0.105, 0.105], off: [0.012, 0, 0] },
  { g: "biceps",     os: "brasG",   pos: 0.50, s: [0.052, 0.115, 0.05], off: [0, 0, 0.035] },
  { g: "biceps",     os: "brasD",   pos: 0.50, s: [0.052, 0.115, 0.05], off: [0, 0, 0.035] },
  { g: "triceps",    os: "brasG",   pos: 0.48, s: [0.05, 0.12, 0.048],  off: [0, 0, -0.04] },
  { g: "triceps",    os: "brasD",   pos: 0.48, s: [0.05, 0.12, 0.048],  off: [0, 0, -0.04] },
  { g: "avantbras",  os: "avbrasG", pos: 0.68, s: [0.05, 0.10, 0.05],  off: [0, 0, 0] },
  { g: "avantbras",  os: "avbrasD", pos: 0.68, s: [0.05, 0.10, 0.05],  off: [0, 0, 0] },
  { g: "quadriceps", os: "cuisseG", pos: 0.52, s: [0.078, 0.20, 0.065], off: [0, 0, 0.045] },
  { g: "quadriceps", os: "cuisseD", pos: 0.52, s: [0.078, 0.20, 0.065], off: [0, 0, 0.045] },
  { g: "ischios",    os: "cuisseG", pos: 0.50, s: [0.07, 0.19, 0.058],  off: [0, 0, -0.05] },
  { g: "ischios",    os: "cuisseD", pos: 0.50, s: [0.07, 0.19, 0.058],  off: [0, 0, -0.05] },
  { g: "adducteurs", os: "cuisseG", pos: 0.62, s: [0.04, 0.15, 0.055],  off: [0.045, 0, 0] },
  { g: "adducteurs", os: "cuisseD", pos: 0.62, s: [0.04, 0.15, 0.055],  off: [-0.045, 0, 0] },
  { g: "fessiers",   os: "racine",  pos: 0,    s: [0.09, 0.095, 0.08],  off: [0.085, 0.02, -0.075], miroir: true },
  { g: "mollets",    os: "molletG", pos: 0.68, s: [0.062, 0.14, 0.058], off: [0, 0, -0.032] },
  { g: "mollets",    os: "molletD", pos: 0.68, s: [0.062, 0.14, 0.058], off: [0, 0, -0.032] },
];

const POSES_3D = {"squat":[{"_vue":42,"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[6,0,0],"brasG":[-8,0,-46],"avbrasG":[-14,0,-104],"brasD":[-8,0,46],"avbrasD":[-14,0,104],"cuisseG":[0,0,0],"molletG":[0,0,0],"piedG":[-90,0,0],"cuisseD":[0,0,0],"molletD":[0,0,0],"piedD":[-90,0,0],"_barre":false},{"racine":{"pos":[0,0.55,-0.25],"rot":[0,0,0]},"colonne":[38,0,0],"brasG":[-8,0,-46],"avbrasG":[-14,0,-104],"brasD":[-8,0,46],"avbrasD":[-14,0,104],"cuisseG":[-81,0,0],"molletG":[107,0,0],"piedG":[-116,0,0],"cuisseD":[-81,0,0],"molletD":[107,0,0],"piedD":[-116,0,0]}],"charniere":[{"_vue":62,"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[4,0,0],"brasG":[2,0,0],"avbrasG":[0,0,0],"brasD":[2,0,0],"avbrasD":[0,0,0],"cuisseG":[0,0,0],"molletG":[0,0,0],"piedG":[-90,0,0],"cuisseD":[0,0,0],"molletD":[0,0,0],"piedD":[-90,0,0],"_barre":true},{"racine":{"pos":[0,0.86,-0.14],"rot":[0,0,0]},"colonne":[74,0,0],"brasG":[-72,0,0],"avbrasG":[0,0,0],"brasD":[-72,0,0],"avbrasD":[0,0,0],"cuisseG":[-14,0,0],"molletG":[16,0,0],"piedG":[-72,0,0],"cuisseD":[-14,0,0],"molletD":[16,0,0],"piedD":[-72,0,0],"_barre":true}],"pousseeV":[{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[2,0,0],"brasG":[-18,0,-16],"avbrasG":[-130,0,0],"brasD":[-18,0,16],"avbrasD":[-130,0,0],"piedG":[-90,0,0],"piedD":[-90,0,0],"_barre":true},{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[2,0,0],"brasG":[-162,0,-10],"avbrasG":[-8,0,0],"brasD":[-162,0,10],"avbrasD":[-8,0,0],"piedG":[-90,0,0],"piedD":[-90,0,0],"_barre":true}],"tirageV":[{"racine":{"pos":[0,1.02,0],"rot":[0,0,0]},"colonne":[0,0,0],"brasG":[-178,0,-8],"avbrasG":[0,0,0],"brasD":[-178,0,8],"avbrasD":[0,0,0],"cuisseG":[8,0,0],"molletG":[-34,0,0],"piedG":[-60,0,0],"cuisseD":[8,0,0],"molletD":[-34,0,0],"piedD":[-60,0,0],"_ancrage":"libre"},{"racine":{"pos":[0,0.62,-0.02],"rot":[0,0,0]},"colonne":[-6,0,0],"brasG":[-152,0,-30],"avbrasG":[-52,0,0],"brasD":[-152,0,30],"avbrasD":[-52,0,0],"cuisseG":[24,0,0],"molletG":[-70,0,0],"piedG":[-60,0,0],"cuisseD":[24,0,0],"molletD":[-70,0,0],"piedD":[-60,0,0],"_ancrage":"libre"}],"tirageH":[{"_vue":62,"racine":{"pos":[0,0.84,-0.06],"rot":[0,0,0]},"colonne":[66,0,0],"brasG":[-64,0,0],"avbrasG":[0,0,0],"brasD":[-64,0,0],"avbrasD":[0,0,0],"cuisseG":[-16,0,0],"molletG":[18,0,0],"piedG":[-72,0,0],"cuisseD":[-16,0,0],"molletD":[18,0,0],"piedD":[-72,0,0],"_barre":true},{"racine":{"pos":[0,0.84,-0.06],"rot":[0,0,0]},"colonne":[66,0,0],"brasG":[6,0,0],"avbrasG":[-116,0,0],"brasD":[6,0,0],"avbrasD":[-116,0,0],"cuisseG":[-16,0,0],"molletG":[18,0,0],"piedG":[-72,0,0],"cuisseD":[-16,0,0],"molletD":[18,0,0],"piedD":[-72,0,0],"_barre":true}],"bras":[{"_vue":36,"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[2,0,0],"brasG":[0,0,-6],"avbrasG":[0,0,0],"brasD":[0,0,6],"avbrasD":[0,0,0],"piedG":[-90,0,0],"piedD":[-90,0,0],"_barre":true},{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[2,0,0],"brasG":[-8,0,-6],"avbrasG":[-142,0,0],"brasD":[-8,0,6],"avbrasD":[-142,0,0],"piedG":[-90,0,0],"piedD":[-90,0,0],"_barre":true}],"epauleIso":[{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[0,0,0],"brasG":[0,0,-8],"avbrasG":[0,0,-6],"brasD":[0,0,8],"avbrasD":[0,0,6],"piedG":[-90,0,0],"piedD":[-90,0,0]},{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[0,0,0],"brasG":[0,0,-92],"avbrasG":[0,0,-10],"brasD":[0,0,92],"avbrasD":[0,0,10],"piedG":[-90,0,0],"piedD":[-90,0,0]}],"fente":[{"_vue":72,"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[4,0,0],"brasG":[4,0,-8],"brasD":[4,0,8],"cuisseG":[-16,0,0],"molletG":[16,0,0],"piedG":[-90,0,0],"cuisseD":[16,0,0],"molletD":[-16,0,0],"piedD":[-90,0,0]},{"racine":{"pos":[0,0.62,0],"rot":[0,0,0]},"colonne":[8,0,0],"brasG":[6,0,-9],"brasD":[6,0,9],"cuisseG":[-58,0,0],"molletG":[58,0,0],"piedG":[-90,0,0],"cuisseD":[34,0,0],"molletD":[-118,0,0],"piedD":[-56,0,0]}],"mollet":[{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[0,0,0],"brasG":[0,0,-8],"brasD":[0,0,8],"piedG":[-90,0,0],"piedD":[-90,0,0]},{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[0,0,0],"brasG":[0,0,-8],"brasD":[0,0,8],"piedG":[-48,0,0],"piedD":[-48,0,0]}],"pousseeH":[{"_vue":90,"racine":{"pos":[0,0.42,0],"rot":[-88,0,0]},"colonne":[0,0,0],"cou":[-18,0,0],"brasG":[-92,0,-24],"avbrasG":[0,0,0],"brasD":[-92,0,24],"avbrasD":[0,0,0],"cuisseG":[-84,0,-6],"molletG":[96,0,0],"piedG":[-90,0,0],"cuisseD":[-84,0,6],"molletD":[96,0,0],"piedD":[-90,0,0],"_barre":true},{"racine":{"pos":[0,0.42,0],"rot":[-88,0,0]},"colonne":[0,0,0],"cou":[-18,0,0],"brasG":[-42,0,-40],"avbrasG":[-78,0,0],"brasD":[-42,0,40],"avbrasD":[-78,0,0],"cuisseG":[-84,0,-6],"molletG":[96,0,0],"piedG":[-90,0,0],"cuisseD":[-84,0,6],"molletD":[96,0,0],"piedD":[-90,0,0],"_barre":true}],"gainage":[{"_vue":78,"racine":{"pos":[0,0.34,0],"rot":[-82,0,0]},"colonne":[0,0,0],"cou":[-16,0,0],"brasG":[-96,0,-10],"avbrasG":[-84,0,0],"brasD":[-96,0,10],"avbrasD":[-84,0,0],"cuisseG":[-96,0,-4],"molletG":[4,0,0],"piedG":[-58,0,0],"cuisseD":[-96,0,4],"molletD":[4,0,0],"piedD":[-58,0,0]},{"racine":{"pos":[0,0.36,0],"rot":[-84,0,0]},"colonne":[0,0,0],"cou":[-16,0,0],"brasG":[-96,0,-10],"avbrasG":[-84,0,0],"brasD":[-96,0,10],"avbrasD":[-84,0,0],"cuisseG":[-96,0,-4],"molletG":[4,0,0],"piedG":[-58,0,0],"cuisseD":[-96,0,4],"molletD":[4,0,0],"piedD":[-58,0,0]}],"cardio":[{"_vue":80,"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[6,0,0],"brasG":[-30,0,-6],"avbrasG":[-46,0,0],"brasD":[28,0,6],"avbrasD":[-40,0,0],"cuisseG":[-30,0,0],"molletG":[34,0,0],"piedG":[-78,0,0],"cuisseD":[26,0,0],"molletD":[-16,0,0],"piedD":[-52,0,0]},{"racine":{"pos":[0,0.9,0],"rot":[0,0,0]},"colonne":[6,0,0],"brasG":[30,0,-6],"avbrasG":[-40,0,0],"brasD":[-30,0,6],"avbrasD":[-46,0,0],"cuisseG":[26,0,0],"molletG":[-16,0,0],"piedG":[-52,0,0],"cuisseD":[-30,0,0],"molletD":[34,0,0],"piedD":[-78,0,0]}]};

const POSE_PAR_PATTERN = {
  squat: "squat", excentrique: "squat", charniere: "charniere", lombaire: "charniere",
  fente: "fente", unipodal: "fente", pousseeH: "pousseeH", pousseeV: "pousseeV",
  tirageV: "tirageV", tirageH: "tirageH", bras: "bras", avantbras: "bras",
  epauleIso: "epauleIso", adducteur: "epauleIso", mollet: "mollet",
  gainage: "gainage", cardio: "cardio", mobilite: "epauleIso",
};
const posesDe = (pattern) => POSES_3D[POSE_PAR_PATTERN[pattern] || "gainage"] || POSES_3D.gainage;

/* ==========================================================================
   MANNEQUIN 3D
   Volumes musculaires modelés en ellipsoïdes, orientés selon la direction
   réelle des fibres. Rotation au doigt, sélection au toucher via raycasting.
   Repli automatique sur la silhouette plate si WebGL n'est pas disponible.
   ========================================================================== */

const VOLUMES = [
  // Parties neutres, non sélectionnables
  { n: null, p: [0, 1.54, 0.01], s: [0.15, 0.185, 0.16] },
  { n: null, p: [0, 1.35, 0], s: [0.075, 0.085, 0.075] },
  { n: null, p: [0, 0.55, 0], s: [0.22, 0.15, 0.155] },
  { n: null, p: [0.44, 0.52, 0.01], s: [0.055, 0.085, 0.035] },
  { n: null, p: [-0.44, 0.52, 0.01], s: [0.055, 0.085, 0.035] },
  { n: null, p: [0.145, -0.07, 0.01], s: [0.085, 0.075, 0.085] },
  { n: null, p: [-0.145, -0.07, 0.01], s: [0.085, 0.075, 0.085] },
  { n: null, p: [0.145, -0.63, 0.05], s: [0.075, 0.055, 0.14] },
  { n: null, p: [-0.145, -0.63, 0.05], s: [0.075, 0.055, 0.14] },
  { n: null, p: [0, 1.03, -0.02], s: [0.19, 0.26, 0.13] }, // cage thoracique
  // Face avant
  { n: "pectoraux", p: [0.115, 1.16, 0.11], s: [0.125, 0.095, 0.075], r: [0, 0, -0.25] },
  { n: "pectoraux", p: [-0.115, 1.16, 0.11], s: [0.125, 0.095, 0.075], r: [0, 0, 0.25] },
  { n: "deltoides", p: [0.275, 1.21, 0.02], s: [0.095, 0.105, 0.105] },
  { n: "deltoides", p: [-0.275, 1.21, 0.02], s: [0.095, 0.105, 0.105] },
  { n: "biceps", p: [0.315, 0.99, 0.035], s: [0.062, 0.135, 0.062], r: [0, 0, 0.06] },
  { n: "biceps", p: [-0.315, 0.99, 0.035], s: [0.062, 0.135, 0.062], r: [0, 0, -0.06] },
  { n: "avantbras", p: [0.365, 0.73, 0.02], s: [0.055, 0.155, 0.055], r: [0, 0, 0.05] },
  { n: "avantbras", p: [-0.365, 0.73, 0.02], s: [0.055, 0.155, 0.055], r: [0, 0, -0.05] },
  { n: "abdominaux", p: [0, 0.82, 0.115], s: [0.105, 0.165, 0.06] },
  { n: "abdominaux", p: [0.155, 0.85, 0.075], s: [0.05, 0.145, 0.06] },
  { n: "abdominaux", p: [-0.155, 0.85, 0.075], s: [0.05, 0.145, 0.06] },
  { n: "quadriceps", p: [0.155, 0.25, 0.06], s: [0.105, 0.265, 0.095] },
  { n: "quadriceps", p: [-0.155, 0.25, 0.06], s: [0.105, 0.265, 0.095] },
  { n: "adducteurs", p: [0.065, 0.27, 0.005], s: [0.05, 0.225, 0.075] },
  { n: "adducteurs", p: [-0.065, 0.27, 0.005], s: [0.05, 0.225, 0.075] },
  // Face arrière
  { n: "trapezes", p: [0, 1.24, -0.075], s: [0.175, 0.135, 0.075] },
  { n: "dos", p: [0.135, 1.0, -0.11], s: [0.125, 0.185, 0.07], r: [0, 0, 0.12] },
  { n: "dos", p: [-0.135, 1.0, -0.11], s: [0.125, 0.185, 0.07], r: [0, 0, -0.12] },
  { n: "lombaires", p: [0, 0.78, -0.115], s: [0.095, 0.135, 0.055] },
  { n: "triceps", p: [0.315, 0.99, -0.045], s: [0.058, 0.135, 0.058], r: [0, 0, 0.06] },
  { n: "triceps", p: [-0.315, 0.99, -0.045], s: [0.058, 0.135, 0.058], r: [0, 0, -0.06] },
  { n: "fessiers", p: [0.105, 0.48, -0.115], s: [0.115, 0.115, 0.095] },
  { n: "fessiers", p: [-0.105, 0.48, -0.115], s: [0.115, 0.115, 0.095] },
  { n: "ischios", p: [0.155, 0.26, -0.07], s: [0.095, 0.245, 0.075] },
  { n: "ischios", p: [-0.155, 0.26, -0.07], s: [0.095, 0.245, 0.075] },
  { n: "mollets", p: [0.145, -0.31, -0.035], s: [0.08, 0.2, 0.085] },
  { n: "mollets", p: [-0.145, -0.31, -0.035], s: [0.08, 0.2, 0.085] },
  { n: "mollets", p: [0.145, -0.31, 0.055], s: [0.04, 0.175, 0.035] },
  { n: "mollets", p: [-0.145, -0.31, 0.055], s: [0.04, 0.175, 0.035] },
];

function Mannequin3D({ selection, onSelect, onEchec }) {
  const hote = useRef(null);
  const echecRef = useRef(onEchec); echecRef.current = onEchec;
  const selectRef = useRef(onSelect); selectRef.current = onSelect;
  const etat = useRef({});
  const [survol, setSurvol] = useState(null);
  const [pret, setPret] = useState(false);
  const selRef = useRef(selection); selRef.current = selection;

  useEffect(() => {
    const conteneur = hote.current; if (!conteneur) return;
    let renderer, animation, annule = false;
    let nettoyer = () => { annule = true; };
    chargerThree().then(() => { if (!annule) demarrer(); }).catch(() => echecRef.current?.());
    return () => nettoyer();

    function demarrer() {
    // Sonde préalable : WebGL manque sur certains navigateurs anciens ou en
    // mode économie de données. On bascule alors sur la silhouette plate.
    try {
      const sonde = document.createElement("canvas");
      const ctx = sonde.getContext("webgl2") || sonde.getContext("webgl") || sonde.getContext("experimental-webgl");
      if (!ctx) throw new Error("webgl indisponible");
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      if (!renderer.getContext()) throw new Error("contexte vide");
    } catch (e) { echecRef.current?.(); return; }

    const L = () => conteneur.clientWidth || 320;
    const H = () => Math.min(Math.round(L() * 1.15), 460);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(L(), H());
    renderer.setClearColor(0x000000, 0);
    conteneur.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, L() / H(), 0.1, 100);
    camera.position.set(0, 0.55, 5.4);
    camera.lookAt(0, 0.48, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e6, 1.0); key.position.set(2.5, 4, 3.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fa8ff, 0.5); rim.position.set(-3, 1.5, -2.5); scene.add(rim);
    const bas = new THREE.DirectionalLight(0xffffff, 0.22); bas.position.set(0, -3, 1.5); scene.add(bas);

    const corps = new THREE.Group();
    scene.add(corps);
    const geo = new THREE.SphereGeometry(1, 26, 18);
    const cliquables = [];
    const parGroupe = {};

    VOLUMES.forEach((v) => {
      const neutre = !v.n;
      const mat = new THREE.MeshStandardMaterial({
        color: neutre ? 0x24272d : 0x3c4149,
        roughness: neutre ? 0.95 : 0.62, metalness: 0.04,
        emissive: 0x000000,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(v.p[0], v.p[1], v.p[2]);
      m.scale.set(v.s[0], v.s[1], v.s[2]);
      if (v.r) m.rotation.set(v.r[0], v.r[1], v.r[2]);
      m.userData.groupe = v.n || null;
      corps.add(m);
      if (v.n) { cliquables.push(m); (parGroupe[v.n] = parGroupe[v.n] || []).push(m); }
    });

    const teinte = (nom) => new THREE.Color(C(GROUPES_MUSCULAIRES[nom]?.couleur || "craie")).getHex();
    const peindre = () => {
      Object.entries(parGroupe).forEach(([nom, meshes]) => {
        const actif = selRef.current === nom;
        const hov = etat.current.survol === nom;
        meshes.forEach((m) => {
          m.material.color.setHex(actif ? teinte(nom) : hov ? 0x555c66 : 0x3c4149);
          m.material.emissive.setHex(actif ? teinte(nom) : 0x000000);
          m.material.emissiveIntensity = actif ? 0.28 : 0;
        });
      });
    };
    etat.current.peindre = peindre;
    peindre();

    // Interaction : glisser pour tourner, toucher bref pour sélectionner.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let actif = false, depart = null, bouge = false, derniere = 0;
    let cibleY = 0, cibleX = 0, curY = 0, curX = 0;

    const coord = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    const viser = () => {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(cliquables, false);
      return hits[0]?.object?.userData?.groupe || null;
    };
    const down = (e) => { actif = true; bouge = false; depart = { x: e.clientX, y: e.clientY }; derniere = Date.now(); renderer.domElement.setPointerCapture?.(e.pointerId); };
    const move = (e) => {
      if (actif && depart) {
        const dx = e.clientX - depart.x, dy = e.clientY - depart.y;
        if (Math.abs(dx) + Math.abs(dy) > 7) bouge = true;
        cibleY += dx * 0.0085;
        cibleX = Math.max(-0.42, Math.min(0.42, cibleX + dy * 0.004));
        depart = { x: e.clientX, y: e.clientY };
        derniere = Date.now();
      } else if (e.pointerType === "mouse") {
        coord(e);
        const g = viser();
        if (g !== etat.current.survol) { etat.current.survol = g; setSurvol(g); peindre();
          renderer.domElement.style.cursor = g ? "pointer" : "grab"; }
      }
    };
    const up = (e) => {
      if (actif && !bouge) { coord(e); const g = viser(); if (g) { haptic(); selectRef.current?.(g); } }
      actif = false; depart = null; derniere = Date.now();
    };
    const el = renderer.domElement;
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", () => { actif = false; depart = null; });
    el.addEventListener("pointerleave", () => { if (etat.current.survol) { etat.current.survol = null; setSurvol(null); peindre(); } });

    etat.current.tourner = (y) => { cibleY = y; cibleX = 0; derniere = Date.now(); };

    const boucle = () => {
      animation = requestAnimationFrame(boucle);
      // Rotation lente au repos : la figure reste vivante sans distraire.
      if (!actif && Date.now() - derniere > 3500) cibleY += 0.0022;
      curY += (cibleY - curY) * 0.12;
      curX += (cibleX - curX) * 0.12;
      corps.rotation.y = curY;
      corps.rotation.x = curX;
      renderer.render(scene, camera);
    };
    boucle();
    setPret(true);

    const redim = () => { camera.aspect = L() / H(); camera.updateProjectionMatrix(); renderer.setSize(L(), H()); };
    window.addEventListener("resize", redim);

    nettoyer = () => {
      cancelAnimationFrame(animation);
      window.removeEventListener("resize", redim);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      geo.dispose();
      corps.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); });
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* contexte deja perdu */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    }
  }, []);

  useEffect(() => { etat.current.peindre?.(); }, [selection]);

  const nomSurvol = survol && GROUPES_MUSCULAIRES[survol]?.nom;
  return (
    <div>
      <div ref={hote} style={{ width: "100%", minHeight: 240, position: "relative" }} />
      <div className="flex items-center justify-between mt-2">
        <span className="fit-eyebrow" style={{ color: nomSurvol ? THEME.craie : THEME.gris2 }}>
          {nomSurvol || (pret ? "Fais tourner du doigt, touche un muscle" : "Chargement…")}
        </span>
        <div className="flex gap-1.5">
          <Chip onClick={() => etat.current.tourner?.(0)}>Face</Chip>
          <Chip onClick={() => etat.current.tourner?.(Math.PI)}>Dos</Chip>
          <Chip onClick={() => etat.current.tourner?.(-Math.PI / 2)}>Profil</Chip>
        </div>
      </div>
    </div>
  );
}

/* Silhouette schématique, tracée comme une planche d'atelier. Chaque zone est
   une cible tactile d'au moins 44 points de côté. */
function Mannequin({ vue, selection, onSelect }) {
  const Z = ({ id, d, cx, cy, rx, ry }) => {
    const on = selection === id;
    const g = GROUPES_MUSCULAIRES[id];
    const commun = {
      fill: on ? C(g.couleur) : THEME.surface2,
      stroke: on ? C(g.couleur) : THEME.rule,
      strokeWidth: 1.5, opacity: on ? 0.92 : 1,
      style: { cursor: "pointer", transition: "fill .18s" },
      onClick: () => { haptic(); onSelect(on ? null : id); },
    };
    return d ? <path d={d} {...commun} /> : <ellipse cx={cx} cy={cy} rx={rx} ry={ry} {...commun} />;
  };
  const inerte = { fill: THEME.surface, stroke: THEME.rule, strokeWidth: 1.5 };

  return (
    <svg viewBox="0 0 240 520" style={{ width: "100%", maxHeight: 440 }} role="img" aria-label={`Silhouette ${vue}`}>
      {/* tête et cou, non cliquables */}
      <ellipse cx="120" cy="40" rx="25" ry="31" {...inerte} />
      <rect x="108" y="66" width="24" height="18" rx="6" {...inerte} />
      {vue === "avant" ? (
        <>
          <Z id="deltoides" cx="72" cy="107" rx="21" ry="24" />
          <Z id="deltoides" cx="168" cy="107" rx="21" ry="24" />
          <path d="M96 88 H144 A10 10 0 0 1 154 98 V128 A10 10 0 0 1 144 138 H96 A10 10 0 0 1 86 128 V98 A10 10 0 0 1 96 88 Z" fill="none" />
          <Z id="pectoraux" d="M97 89 H119 V137 H97 A10 10 0 0 1 87 127 V99 A10 10 0 0 1 97 89 Z" />
          <Z id="pectoraux" d="M121 89 H143 A10 10 0 0 1 153 99 V127 A10 10 0 0 1 143 137 H121 Z" />
          <Z id="abdominaux" d="M99 142 H141 A8 8 0 0 1 149 150 V212 A14 14 0 0 1 135 226 H105 A14 14 0 0 1 91 212 V150 A8 8 0 0 1 99 142 Z" />
          <Z id="biceps" cx="61" cy="156" rx="16" ry="35" />
          <Z id="biceps" cx="179" cy="156" rx="16" ry="35" />
          <Z id="avantbras" cx="53" cy="219" rx="14" ry="36" />
          <Z id="avantbras" cx="187" cy="219" rx="14" ry="36" />
          <rect x="92" y="228" width="56" height="26" rx="10" {...inerte} />
          <Z id="quadriceps" d="M95 256 H115 V370 A9 9 0 0 1 106 379 H99 A9 9 0 0 1 90 370 L92 266 A10 10 0 0 1 95 256 Z" />
          <Z id="quadriceps" d="M125 256 H145 A10 10 0 0 1 148 266 L150 370 A9 9 0 0 1 141 379 H134 A9 9 0 0 1 125 370 Z" />
          <Z id="adducteurs" d="M117 256 H123 V330 A6 6 0 0 1 117 336 Z" />
          <Z id="adducteurs" d="M123 256 H129 V336 A6 6 0 0 1 123 330 Z" />
          <Z id="mollets" cx="102" cy="424" rx="14" ry="42" />
          <Z id="mollets" cx="138" cy="424" rx="14" ry="42" />
        </>
      ) : (
        <>
          <Z id="trapezes" d="M97 84 H143 L156 104 L143 168 H97 L84 104 Z" />
          <Z id="deltoides" cx="70" cy="110" rx="21" ry="24" />
          <Z id="deltoides" cx="170" cy="110" rx="21" ry="24" />
          <Z id="dos" d="M86 116 L118 132 V196 H98 A12 12 0 0 1 86 184 Z" />
          <Z id="dos" d="M154 116 V184 A12 12 0 0 1 142 196 H122 V132 Z" />
          <Z id="lombaires" d="M100 200 H140 A8 8 0 0 1 148 208 V228 A10 10 0 0 1 138 238 H102 A10 10 0 0 1 92 228 V208 A8 8 0 0 1 100 200 Z" />
          <Z id="triceps" cx="59" cy="158" rx="16" ry="35" />
          <Z id="triceps" cx="181" cy="158" rx="16" ry="35" />
          <Z id="avantbras" cx="51" cy="221" rx="14" ry="36" />
          <Z id="avantbras" cx="189" cy="221" rx="14" ry="36" />
          <Z id="fessiers" d="M94 242 H119 V286 H104 A10 10 0 0 1 94 276 Z" />
          <Z id="fessiers" d="M121 242 H146 V276 A10 10 0 0 1 136 286 H121 Z" />
          <Z id="ischios" d="M96 290 H117 V372 A9 9 0 0 1 108 381 H101 A9 9 0 0 1 92 372 Z" />
          <Z id="ischios" d="M123 290 H144 L148 372 A9 9 0 0 1 139 381 H132 A9 9 0 0 1 123 372 Z" />
          <Z id="mollets" cx="102" cy="424" rx="15" ry="43" />
          <Z id="mollets" cx="138" cy="424" rx="15" ry="43" />
        </>
      )}
    </svg>
  );
}


function Exo3D({ pattern, muscles = [], hauteur = 300, nom, onEchec }) {
  const hote = useRef(null);
  // Les rappels passent par une ref : sans cela, une fonction recreee a chaque
  // rendu par le parent reconstruirait toute la scene.
  const echecRef = useRef(onEchec); echecRef.current = onEchec;
  const api = useRef({});
  const [pret, setPret] = useState(false);
  const [joue, setJoue] = useState(true);
  const [vitesse, setVitesse] = useState(1);
  const musclesRef = useRef(muscles); musclesRef.current = muscles;

  useEffect(() => {
    const conteneur = hote.current; if (!conteneur) return;
    let renderer, anim, annule = false;
    let nettoyer = () => { annule = true; };
    // Le moteur 3D est chargé à la demande : construire la scène avant qu'il
    // soit disponible n'aurait aucun sens.
    chargerThree().then(() => { if (!annule) demarrer(); }).catch(() => echecRef.current?.());
    return () => nettoyer();

    function demarrer() {
    try {
      const sonde = document.createElement("canvas");
      if (!(sonde.getContext("webgl2") || sonde.getContext("webgl"))) throw new Error("webgl");
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      if (!renderer.getContext()) throw new Error("contexte");
    } catch (e) { echecRef.current?.(); return; }

    const L = () => conteneur.clientWidth || 320;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(L(), hauteur);
    renderer.setClearColor(0x000000, 0);
    conteneur.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, L() / hauteur, 0.1, 100);
    camera.position.set(0, 1.0, 3.2);
    camera.lookAt(0, 0.8, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    const key = new THREE.DirectionalLight(0xfff2e2, 1.35); key.position.set(2.4, 3.6, 2.8); scene.add(key);
    const rim = new THREE.DirectionalLight(0x74a6ff, 0.7); rim.position.set(-2.8, 1.6, -2.4); scene.add(rim);
    // Contre-jour rasant : détache la silhouette du fond noir.
    const dos = new THREE.DirectionalLight(0xffd9b0, 0.42); dos.position.set(-0.6, 2.2, -3.2); scene.add(dos);

    // Sol : un disque discret qui donne l'échelle et ancre la figure.
    const sol = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48),
      new THREE.MeshBasicMaterial({ color: 0x14161a, transparent: true, opacity: 0.75 }));
    sol.rotation.x = -Math.PI / 2; sol.position.y = 0.001; scene.add(sol);
    const grille = new THREE.GridHelper(2.3, 8, 0x2a2d33, 0x1c1f24);
    grille.position.y = 0.002; scene.add(grille);

    const monde = new THREE.Group(); scene.add(monde);
    const corps = new THREE.Group(); monde.add(corps);

    const geoS = new THREE.SphereGeometry(1, 26, 18);
    // Tronc de cône légèrement arrondi : base large, extrémité plus fine.
    const geoTronc = new THREE.CylinderGeometry(0.78, 1.0, 2, 20, 1);
    // Cage thoracique en V et bassin : ce sont eux qui donnent la silhouette.
    const geoBuste = new THREE.SphereGeometry(1, 28, 20);
    const matOs = () => new THREE.MeshStandardMaterial({ color: 0x474d57, roughness: 0.62, metalness: 0.12, flatShading: false });
    const groupes = {}, habillage = [], parGroupeMusc = {};

    OS_ORDRE.forEach((nomOs) => {
      const o = SQUELETTE[nomOs];
      const g = new THREE.Group();
      g.position.set(o.off[0], o.off[1], o.off[2]);
      const conteneurOs = new THREE.Group();
      conteneurOs.add(g);
      if (o.parent) groupes[o.parent].bout.add(conteneurOs); else corps.add(conteneurOs);
      const bout = new THREE.Group();
      bout.position.y = o.dir * o.L;
      g.add(bout);
      groupes[nomOs] = { g, bout, conteneur: conteneurOs, o };
      if (o.L > 0 && o.ep > 0) {
        // Segment effilé plutôt que cylindre : un membre est plus épais près
        // de la racine que près de l'articulation distale.
        const m = new THREE.Mesh(geoTronc, matOs());
        m.position.y = (o.dir * o.L) / 2;
        m.scale.set(o.ep, (o.L / 2 + o.ep * 0.45) * o.dir, o.ep);
        g.add(m); habillage.push(m);
        // Sphère d'articulation : sans elle, les segments se détachent
        // visuellement dès que l'angle dépasse quelques degrés.
        const j = new THREE.Mesh(geoS, matOs());
        j.scale.setScalar(o.ep * 1.02);
        g.add(j); habillage.push(j);
        const j2 = new THREE.Mesh(geoS, matOs());
        j2.position.y = o.dir * o.L; j2.scale.setScalar(o.ep * 0.86);
        g.add(j2); habillage.push(j2);
      }
    });
    // Buste : cage thoracique large en haut, taille marquée, bassin.
    const cage = new THREE.Mesh(geoBuste, matOs());
    cage.position.y = 0.32; cage.scale.set(0.185, 0.15, 0.108);
    groupes.colonne.g.add(cage); habillage.push(cage);
    const taille = new THREE.Mesh(geoBuste, matOs());
    taille.position.y = 0.14; taille.scale.set(0.128, 0.11, 0.088);
    groupes.colonne.g.add(taille); habillage.push(taille);
    const bassin = new THREE.Mesh(geoBuste, matOs());
    bassin.position.y = 0.02; bassin.scale.set(0.155, 0.10, 0.10);
    groupes.colonne.g.add(bassin); habillage.push(bassin);
    // Tête et mâchoire
    const tete = new THREE.Mesh(geoS, matOs());
    tete.scale.set(0.098, 0.125, 0.112); tete.position.set(0, 0.10, 0.006);
    groupes.cou.bout.add(tete); habillage.push(tete);

    MUSCLES_3D.forEach((mu) => {
      const cible = groupes[mu.os]; if (!cible) return;
      const cotes = mu.miroir ? [1, -1] : [1];
      cotes.forEach((c) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x4c525c, roughness: 0.55, metalness: 0.06, emissive: 0x000000 });
        const m = new THREE.Mesh(geoS, mat);
        const o = cible.o;
        m.position.set(mu.off[0] * c, o.dir * o.L * mu.pos + (mu.off[1] || 0), mu.off[2]);
        m.scale.set(mu.s[0], mu.s[1], mu.s[2]);
        cible.g.add(m);
        (parGroupeMusc[mu.g] = parGroupeMusc[mu.g] || []).push(mat);
      });
    });

    // Barre : suspendue entre les deux mains, reconstruite à chaque image.
    const barre = new THREE.Group();
    const matBarre = new THREE.MeshStandardMaterial({ color: 0xd8d5ce, roughness: 0.4, metalness: 0.55 });
    const axe = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 1.15, 12), matBarre);
    axe.rotation.z = Math.PI / 2; barre.add(axe);
    [-0.5, 0.5].forEach((x) => {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.036, 20),
        new THREE.MeshStandardMaterial({ color: 0xe4322b, roughness: 0.5 }));
      d.rotation.z = Math.PI / 2; d.position.x = x; barre.add(d);
    });
    monde.add(barre); barre.visible = false;

    const peindre = () => {
      const actifs = musclesRef.current || [];
      Object.entries(parGroupeMusc).forEach(([g, mats]) => {
        const on = actifs.includes(g);
        const col = on ? new THREE.Color(C(GROUPES_MUSCULAIRES[g]?.couleur || "rouge")).getHex() : 0x4c525c;
        mats.forEach((mt) => {
          mt.color.setHex(col);
          mt.emissive.setHex(on ? col : 0x000000);
          mt.emissiveIntensity = on ? 0.42 : 0;
        });
      });
    };
    peindre(); api.current.peindre = peindre;

    const frames = posesDe(pattern);
    const lerp = (a, b, t) => a + (b - a) * t;
    const angle = (f, os, i) => (f[os] ? f[os][i] : 0) * Math.PI / 180;
    const v3 = new THREE.Vector3();

    const appliquer = (t) => {
      const n = frames.length;
      const pos = t * (n - 1);
      const i = Math.min(Math.floor(pos), n - 2);
      const u = pos - i;
      const A = frames[i], B = frames[i + 1];
      OS_ORDRE.forEach((os) => {
        if (os === "racine") return;
        const g = groupes[os].g;
        g.rotation.set(lerp(angle(A, os, 0), angle(B, os, 0), u),
                       lerp(angle(A, os, 1), angle(B, os, 1), u),
                       lerp(angle(A, os, 2), angle(B, os, 2), u));
      });
      const ra = A.racine || { pos: [0, 0.9, 0], rot: [0, 0, 0] };
      const rb = B.racine || ra;
      corps.position.set(lerp(ra.pos[0], rb.pos[0], u), lerp(ra.pos[1], rb.pos[1], u), lerp(ra.pos[2], rb.pos[2], u));
      corps.rotation.set(lerp((ra.rot?.[0] || 0), (rb.rot?.[0] || 0), u) * Math.PI / 180,
                         lerp((ra.rot?.[1] || 0), (rb.rot?.[1] || 0), u) * Math.PI / 180,
                         lerp((ra.rot?.[2] || 0), (rb.rot?.[2] || 0), u) * Math.PI / 180);
      corps.updateMatrixWorld(true);

      // Ancrage : on repose la figure au sol, sauf en suspension.
      const libre = (A._ancrage || B._ancrage) === "libre";
      if (!libre) {
        let bas = Infinity;
        habillage.forEach((m) => { m.getWorldPosition(v3); bas = Math.min(bas, v3.y - Math.abs(m.scale.y) * 0.8); });
        if (isFinite(bas)) { corps.position.y -= bas; corps.updateMatrixWorld(true); }
      }

      // Barre entre les mains si l'exercice en utilise une.
      const avecBarre = A._barre || B._barre;
      barre.visible = !!avecBarre;
      if (avecBarre) {
        const mg = new THREE.Vector3(), md = new THREE.Vector3();
        groupes.mainG.bout.getWorldPosition(mg);
        groupes.mainD.bout.getWorldPosition(md);
        barre.position.copy(mg).add(md).multiplyScalar(0.5);
        barre.rotation.z = Math.atan2(md.y - mg.y, md.x - mg.x);
        barre.rotation.y = -Math.atan2(md.z - mg.z, md.x - mg.x);
      }
    };

    // Rotation au doigt
    const vueInit = ((frames[0] && frames[0]._vue) || 22) * Math.PI / 180;
    let actif = false, dep = null, cibleY = vueInit, curY = vueInit, derniere = 0;
    const el = renderer.domElement;
    el.addEventListener("pointerdown", (e) => { actif = true; dep = e.clientX; derniere = Date.now(); el.setPointerCapture?.(e.pointerId); });
    el.addEventListener("pointermove", (e) => { if (!actif) return; cibleY += (e.clientX - dep) * 0.009; dep = e.clientX; derniere = Date.now(); });
    const fin = () => { actif = false; derniere = Date.now(); };
    el.addEventListener("pointerup", fin); el.addEventListener("pointercancel", fin);
    api.current.tourner = (y) => { cibleY = y; derniere = Date.now(); };

    let phase = 0, dernierTemps = performance.now();
    const boucle = (maintenant) => {
      anim = requestAnimationFrame(boucle);
      const dt = Math.min((maintenant - dernierTemps) / 1000, 0.05);
      dernierTemps = maintenant;
      if (api.current.joue) phase = (phase + dt / (2.9 / (api.current.vitesse || 1))) % 1;
      // Aller-retour adouci : la lecture s'attarde sur les positions extrêmes.
      appliquer(0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
      if (!actif && Date.now() - derniere > 5000) cibleY += 0.0018;
      curY += (cibleY - curY) * 0.11;
      monde.rotation.y = curY;
      if (api.current.cibleY3 != null) camera.lookAt(0, api.current.cibleY3, 0);
      renderer.render(scene, camera);
    };
    // Cadrage automatique : on échantillonne tout le cycle, on mesure
    // l'encombrement réel, et on règle la caméra pour que la figure remplisse
    // le cadre. Une pose couchée et une pose debout n'ont pas du tout la même
    // emprise : une caméra fixe en laisserait forcément une des deux minuscule.
    const boite = new THREE.Box3();
    const mesurer = () => {
      // On mesure toujours dans un repère neutre : sans remise à zéro, la
      // rotation en cours et le recentrage précédent fausseraient la boîte.
      const rotMemo = monde.rotation.y;
      monde.rotation.y = 0; monde.position.set(0, 0, 0);
      boite.makeEmpty();
      const tmp = new THREE.Box3();
      for (let k = 0; k <= 14; k++) {
        appliquer(0.5 - 0.5 * Math.cos((k / 14) * Math.PI * 2));
        monde.updateMatrixWorld(true);
        corps.traverse((n) => { if (n.isMesh) { tmp.setFromObject(n); boite.union(tmp); } });
        if (barre.visible) { tmp.setFromObject(barre); boite.union(tmp); }
      }
      monde.rotation.y = rotMemo;
      const taille = new THREE.Vector3(), centre = new THREE.Vector3();
      boite.getSize(taille); boite.getCenter(centre);
      // Le pivot de rotation passe par le centre : la figure ne dérive pas
      // quand on la fait tourner du doigt.
      monde.position.set(-centre.x, 0, -centre.z);
      corps.userData.centre = centre;
      const aspect = L() / hauteur;
      const fov = (camera.fov * Math.PI) / 180;
      // Rayon horizontal pris sur la diagonale : la largeur change avec la rotation.
      const rayonH = Math.hypot(taille.x, taille.z) / 2;
      const dH = rayonH / Math.tan(fov / 2) / aspect;
      const dV = (taille.y / 2) / Math.tan(fov / 2);
      const dist = Math.max(dH, dV) * 1.2 + 0.28;
      api.current.dist = dist;
      api.current.cibleY3 = centre.y;
      camera.position.set(0, centre.y + dist * 0.13, dist);
      camera.lookAt(0, centre.y, 0);
      // Le sol et la grille se dimensionnent sur la figure.
      const r = Math.max(rayonH * 1.5, 0.55);
      sol.scale.setScalar(r / 1.15);
      grille.scale.setScalar((r * 2) / 2.3);
    };
    mesurer();
    boucle(performance.now());
    setPret(true);

    const redim = () => { camera.aspect = L() / hauteur; camera.updateProjectionMatrix(); renderer.setSize(L(), hauteur); mesurer(); };
    window.addEventListener("resize", redim);
    nettoyer = () => {
      cancelAnimationFrame(anim); window.removeEventListener("resize", redim);
      // Libération complète : dispose() seul ne rend pas le contexte WebGL au
      // navigateur, qui n'en accorde qu'un nombre limité par page.
      scene.traverse((o) => {
        if (o.isMesh) { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); }
      });
      geoS.dispose(); geoTronc.dispose(); geoBuste.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (e) { /* contexte deja perdu */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    };
    }
  }, [pattern, hauteur]);

  useEffect(() => { api.current.joue = joue; }, [joue]);
  useEffect(() => { api.current.vitesse = vitesse; }, [vitesse]);
  useEffect(() => { api.current.peindre?.(); }, [muscles]);

  return (
    <div>
      <div className="rounded-2xl overflow-hidden" ref={hote}
        style={{ background: "radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,.05), rgba(0,0,0,0))",
          border: `1px solid ${THEME.rule}`, minHeight: hauteur }} />
      {nom && <div className="fit-eyebrow mt-2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nom}</div>}
      <div className="flex items-center justify-between mt-1.5 gap-2">
        <span className="fit-eyebrow" style={{ flex: 1, minWidth: 0 }}>{pret ? "Tourne du doigt" : "Chargement…"}</span>
        <div className="flex gap-1.5 items-center">
          <button onClick={() => { haptic(6); setJoue(!joue); }} className="fit-tap flex items-center justify-center"
            style={{ color: THEME.craie, minWidth: 34 }}>{joue ? <Pause size={14} /> : <Play size={14} />}</button>
          <Chip actif={vitesse === 0.45} onClick={() => setVitesse(vitesse === 0.45 ? 1 : 0.45)}>Ralenti</Chip>
          <Chip onClick={() => api.current.tourner?.(0)}>Face</Chip>
          <Chip onClick={() => api.current.tourner?.(Math.PI / 2)}>Profil</Chip>
        </div>
      </div>
    </div>
  );
}

/* Choisit la représentation : 3D si le navigateur suit, schéma vectoriel sinon. */
function Execution({ exercice, pattern, hauteur = 300, nom, plat2D }) {
  const [plat, setPlat] = useState(!!plat2D);
  const pat = pattern || exercice?.pattern;
  const muscles = useMemo(() => {
    if (!exercice) return [];
    const ids = [...(exercice.chefs || []), ...(exercice.secondaires || [])];
    return [...new Set(ids.map((i) => MUSCLES[i]?.groupe).filter(Boolean))];
  }, [exercice]);
  if (plat) return <AnimExecution pattern={pat} hauteur={Math.min(hauteur, 170)} legende={nom} />;
  return (
    <div>
      <Exo3D pattern={pat} muscles={muscles} hauteur={hauteur} nom={nom} onEchec={() => setPlat(true)} />
      {muscles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {muscles.slice(0, 6).map((g) => (
            <span key={g} className="rounded-full px-2.5 py-1 fit-data"
              style={{ fontSize: 11, background: THEME.surface2, border: `1px solid ${C(GROUPES_MUSCULAIRES[g]?.couleur || "craie")}`,
                color: C(GROUPES_MUSCULAIRES[g]?.couleur || "craie") }}>
              {GROUPES_MUSCULAIRES[g]?.nom || g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Anatomie({ app }) {
  const { profil } = app;
  const [vue, setVue] = useState("avant");
  const [groupe, setGroupe] = useState(null);
  const [plat, setPlat] = useState(false);
  const [apercu, setApercu] = useState(null);
  const [ouvertId, setOuvertId] = useState(null);
  const [faisceau, setFaisceau] = useState(null);
  const [filtreMateriel, setFiltreMateriel] = useState(false);

  const dispo = (e) => profil.materiel.includes(e.materiel) || e.materiel === "aucun";
  const filtrer = (l) => (filtreMateriel ? l.filter(dispo) : l);

  if (faisceau) {
    const m = MUSCLES[faisceau];
    const { primaires, secondaires } = exercicesPourMuscle(faisceau);
    return (
      <div className="px-5 pt-2 pb-6 space-y-5">
        <button onClick={() => setFaisceau(null)} className="fit-eyebrow flex items-center gap-1"><ChevronLeft size={12} />{GROUPES_MUSCULAIRES[m.groupe].nom}</button>
        <div>
          <h2 className="fit-display" style={{ fontSize: 22, lineHeight: 1.12 }}>{m.nom}</h2>
          <Card accent={GROUPES_MUSCULAIRES[m.groupe].couleur} style={{ padding: 14, marginTop: 12 }}>
            <div className="fit-eyebrow mb-1.5">Ce qu'il fait, et comment</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>{m.fonction}</div>
          </Card>
        </div>
        <div className="flex items-center justify-between">
          <span className="fit-eyebrow">Filtrer sur mon matériel</span>
          <Interrupteur on={filtreMateriel} onChange={setFiltreMateriel} />
        </div>
        <div>
          <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{filtrer(primaires).length}</span>}>Exercices qui le ciblent directement</Eyebrow>
          <div className="space-y-1.5">
            {filtrer(primaires).map((e) => <FicheExercice key={e.id} e={e} dispo={dispo(e)} compact ouvertId={ouvertId} setOuvertId={setOuvertId} />)}
            {!filtrer(primaires).length && <Vide titre="Aucun exercice avec le matériel sélectionné." />}
          </div>
        </div>
        {filtrer(secondaires).length > 0 && (
          <div>
            <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{filtrer(secondaires).length}</span>}>Exercices qui le sollicitent en soutien</Eyebrow>
            <div className="space-y-1.5">{filtrer(secondaires).map((e) => <FicheExercice key={e.id} e={e} dispo={dispo(e)} compact ouvertId={ouvertId} setOuvertId={setOuvertId} />)}</div>
          </div>
        )}
      </div>
    );
  }

  if (groupe) {
    const g = GROUPES_MUSCULAIRES[groupe];
    const ids = musclesDuGroupe(groupe);
    const { primaires } = exercicesPourGroupe(groupe);
    return (
      <div className="px-5 pt-2 pb-6 space-y-5">
        <button onClick={() => setGroupe(null)} className="fit-eyebrow flex items-center gap-1"><ChevronLeft size={12} />Silhouette</button>
        <div>
          <div className="fit-eyebrow" style={{ color: C(g.couleur) }}>{primaires.length} exercices ciblent ce groupe</div>
          <h2 className="fit-display" style={{ fontSize: 24, lineHeight: 1.1, marginTop: 4 }}>{g.nom}</h2>
          <p style={{ fontSize: 12.5, color: THEME.gris, marginTop: 8, lineHeight: 1.5 }}>
            Un groupe musculaire n'est pas une masse uniforme : chaque faisceau a une orientation de fibres et une ligne de traction propres. Choisis celui que tu veux travailler.
          </p>
        </div>
        <div className="space-y-2.5">
          {ids.map((id) => {
            const m = MUSCLES[id];
            const n = exercicesPourMuscle(id);
            return (
              <Card key={id} accent={g.couleur} onClick={() => { haptic(); setFaisceau(id); }} style={{ padding: 14, cursor: "pointer" }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="fit-display" style={{ fontSize: 14.5 }}>{m.nom}</div>
                    <div className="fit-data mt-1" style={{ fontSize: 11, color: THEME.gris }}>
                      {n.primaires.length} en ciblage direct · {n.secondaires.length} en soutien
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: THEME.gris2 }} />
                </div>
                <div style={{ fontSize: 12.5, color: THEME.craie, opacity: .82, marginTop: 8, lineHeight: 1.5 }}>{m.fonction}</div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  const groupesVue = Object.entries(GROUPES_MUSCULAIRES).filter(([, g]) => (plat ? g.vue === vue : g.vue !== "aucune"));
  return (
    <div className="px-5 pt-2 pb-6 space-y-4">
      {plat && <Segmented cols={2} value={vue} onChange={setVue} options={[{ v: "avant", l: "Vue de face" }, { v: "arriere", l: "Vue de dos" }]} />}
      <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5 }}>
        Fais tourner la figure du doigt et touche un muscle. Tu obtiens ses faisceaux, ce que chacun fait, et tous les exercices qui le travaillent.
      </div>
      <Card style={{ padding: 12 }}>
        {plat
          ? <Mannequin vue={vue} selection={null} onSelect={(id) => id && setGroupe(id)} />
          : <Mannequin3D selection={apercu} onSelect={(id) => setApercu(apercu === id ? null : id)} onEchec={() => setPlat(true)} />}
        {!plat && apercu && (
          <div className="fit-fade mt-3 pt-3" style={{ borderTop: `1px solid ${THEME.rule}` }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="fit-display" style={{ fontSize: 15 }}>{GROUPES_MUSCULAIRES[apercu].nom}</div>
                <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
                  {exercicesPourGroupe(apercu).primaires.length} exercices · {musclesDuGroupe(apercu).length} faisceaux
                </div>
              </div>
              <Btn small onClick={() => setGroupe(apercu)}>Ouvrir</Btn>
            </div>
          </div>
        )}
      </Card>
      {!plat && <button onClick={() => setPlat(true)} className="fit-eyebrow" style={{ color: THEME.gris2 }}>Passer à la silhouette plate</button>}
      {plat && <div className="flex items-center justify-between">
        <span className="fit-eyebrow">Vue</span>
        <button onClick={() => setPlat(false)} className="fit-eyebrow" style={{ color: THEME.craie }}>Revenir en trois dimensions</button>
      </div>}
      <div>
        <Eyebrow>{plat ? (vue === "avant" ? "Chaîne antérieure" : "Chaîne postérieure") : "Tous les groupes"}</Eyebrow>
        <Carrousel largeur={188}
          enfants={groupesVue.map(([k, g]) => {
            const n = exercicesPourGroupe(k);
            const ex = n.primaires[0];
            return (
              <CarteVerre key={k} accent={g.couleur} onClick={() => { haptic(); setGroupe(k); }} style={{ padding: 0 }}>
                {ex && <div style={{ padding: "10px 8px 0" }}><AnimExecution pattern={ex.pattern} hauteur={112} legende={" "} /></div>}
                <div style={{ padding: "4px 14px 14px" }}>
                  <div className="fit-display" style={{ fontSize: 15, lineHeight: 1.12 }}>{g.nom}</div>
                  <div className="fit-data" style={{ fontSize: 11, color: C(g.couleur), marginTop: 4 }}>
                    {n.primaires.length} exercices · {musclesDuGroupe(k).length} faisceaux
                  </div>
                </div>
              </CarteVerre>
            );
          })} />
      </div>
      <div>
        <Eyebrow>Hors silhouette</Eyebrow>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(GROUPES_MUSCULAIRES).filter(([, g]) => g.vue === "aucune").map(([k, g]) => (
            <button key={k} onClick={() => { haptic(); setGroupe(k); }} className="fit-tap rounded-lg px-3 py-2.5 text-left"
              style={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderLeft: `3px solid ${C(g.couleur)}` }}>
              <div style={{ fontSize: 13 }}>{g.nom}</div>
              <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>{exercicesPourGroupe(k).primaires.length} exercices</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Interrupteur({ on, onChange }) {
  return (
    <button onClick={() => { haptic(); onChange(!on); }} className="fit-tap flex items-center" style={{ minWidth: 52 }} role="switch" aria-checked={on}>
      <span style={{ width: 46, height: 27, borderRadius: 14, background: on ? THEME.vert : THEME.surface2,
        border: `1px solid ${on ? THEME.vert : THEME.rule}`, position: "relative", transition: "background .18s" }}>
        <span style={{ position: "absolute", top: 2.5, left: on ? 22 : 2.5, width: 20, height: 20, borderRadius: 10,
          background: on ? THEME.noir : THEME.gris, transition: "left .18s" }} />
      </span>
    </button>
  );
}

/* ==========================================================================
   ÉCRAN — COACH CONVERSATIONNEL
   ========================================================================== */

const SYSTEME_COACH = `Tu es le coach de cette application : préparateur physique et coach nutrition expérimenté. Tu réponds en français, ton direct et technique, sans jargon inutile et sans flatterie.

RÈGLES NON NÉGOCIABLES
1. Honnêteté épistémique. Quand la science n'est pas tranchée, tu le dis. Tu n'inventes JAMAIS une étude, un chiffre, un pourcentage ou une statistique pour faire autorité. Si tu ne connais pas une donnée précise, tu dis que tu ne la connais pas et tu donnes un ordre de grandeur en le présentant comme tel.
2. Sources. Quand tu avances un fait précis, tu cites l'organisme ou la publication de référence (ISSN, ACSM, EFSA/ANSES, consensus CIO sur le RED-S, méta-analyses identifiées). Pas de référence inventée.
3. Pas de diagnostic. Tu n'es pas un dispositif médical. Face à une douleur persistante, un symptôme inquiétant ou une question de santé, tu orientes vers un médecin, un kinésithérapeute ou un diététicien. Tu sais distinguer une courbature normale d'une douleur articulaire anormale, et dans le second cas tu ne proposes pas d'adaptation hasardeuse : tu orientes.
4. Sécurité. Tu ne valides JAMAIS un objectif de poids ou un déficit calorique dangereux, même sur demande insistante. Si l'utilisateur exprime un rapport problématique à l'alimentation, au poids ou à l'entraînement (restriction extrême, culpabilité, compensation systématique, entraînement malgré blessure), tu n'encourages pas et tu ne fournis pas de plan qui faciliterait cela : tu en parles avec bienveillance et tu orientes vers un accompagnement professionnel.
5. Pédagogie. Tu expliques toujours le pourquoi d'une prescription : pourquoi ce nombre de répétitions, pourquoi cet ordre dans la séance, pourquoi ce temps de repos, pourquoi cet exercice à ce moment du cycle. Tu vulgarises sans simplifier à l'excès.
6. Concision. Réponses courtes par défaut (quelques phrases), détaillées seulement si on te le demande.
7. Compléments. Tu ne recommandes aucune marque et tu ne touches aucune commission. Tu distingues clairement ce qui est établi (créatine monohydrate, caféine, protéine en poudre comme simple aliment pratique, vitamine D en cas de déficit avéré) de ce qui ne l'est pas (BCAA, glutamine, L-carnitine, brûleurs de graisse). Aucun aliment ni gélule ne brûle du gras : seul le déficit calorique le fait.
8. Techniques d'intensification. Tu les connais (dégressives, rest-pause, supersets, bi-sets, séries longues, excentrique accentué, séries avec pause, myo-reps) et tu rappelles qu'elles coûtent toutes en récupération : une par séance suffit, en fin de séance, jamais sur un mouvement lourd où l'échec est dangereux.
9. En sèche, tu ne conseilles jamais de passer aux séries longues et légères : c'est la charge lourde qui préserve la masse musculaire. On maintient l'intensité et on réduit éventuellement le volume.

10. ACTIONS. Quand ta réponse débouche sur une modification concrète que l'application sait exécuter, tu ajoutes à la fin de ta réponse un bloc de code délimité par trois accents graves suivis du mot action, contenant UNIQUEMENT du JSON valide. Format :
{"action":"nom_action","params":{...},"resume":"une phrase à la première personne décrivant ce qui va changer","pourquoi":"la justification physiologique en une ou deux phrases"}

Actions disponibles et leurs paramètres exacts :
- adapter_seance — params: {"volumeMult":0.8,"rpeDelta":-1}. Réduit le volume et l'intensité du programme en cours. volumeMult entre 0.5 et 1, rpeDelta entre -2 et 0.
- activer_deload — params: {}. Passe la semaine en cours en décharge (volume à 55 %, RPE -1).
- appliquer_cible_calorique — params: {"kcal":2700,"prot":180,"gluc":300,"lip":75}. Tous les champs sont optionnels, tu ne mets que ceux que tu veux changer.
- changer_split — params: {"splitId":"hb4"}. Uniquement un identifiant de split existant.
- ajouter_courses — params: {"articles":["Skyr","Flocons d'avoine"]}.

Règles sur les actions : au maximum une action par réponse. Tu ne proposes une action que si l'utilisateur a exprimé un besoin qui la justifie — jamais spontanément pour meubler. Tu n'inventes JAMAIS un nom d'action ou un paramètre hors de cette liste. Tu expliques toujours ta recommandation en texte AVANT le bloc : l'action complète l'explication, elle ne la remplace pas. L'utilisateur garde toujours le dernier mot : c'est lui qui valide.`;

function CarteAction({ proposition, app }) {
  const def = ACTIONS_COACH[proposition.action];
  const [etat, setEtat] = useState("propose");
  const [voirDiff, setVoirDiff] = useState(false);
  const snap = useRef(null);
  if (!def) return null;

  const lignes = useMemo(() => {
    try { return def.diff(proposition.params, app) || []; } catch (e) { return []; }
  }, [def, proposition.params, app]);

  if (etat === "refuse") return (
    <div className="fit-eyebrow" style={{ color: THEME.gris2 }}>Proposition écartée</div>
  );

  return (
    <Card accent={etat === "applique" ? "vert" : "bleu"} style={{ padding: 13 }}>
      <div className="fit-eyebrow" style={{ color: etat === "applique" ? THEME.vert : THEME.bleu }}>
        {etat === "applique" ? "Appliqué" : "Proposition"}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 5 }}>{proposition.resume}</div>
      {proposition.pourquoi && (
        <div className="pl-2.5 mt-2.5" style={{ borderLeft: `2px solid ${THEME.bleu}` }}>
          <div className="fit-eyebrow" style={{ color: THEME.bleu }}>Pourquoi</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 3 }}>{proposition.pourquoi}</div>
        </div>
      )}
      {voirDiff && lignes.length > 0 && (
        <div className="fit-fade mt-3">
          <div className="fit-eyebrow mb-1">Ce qui change</div>
          {lignes.map((l, i) => (
            <div key={i} className="flex items-baseline justify-between py-1.5" style={{ borderBottom: `1px solid ${THEME.rule}` }}>
              <span style={{ fontSize: 12.5 }}>{l.champ}</span>
              <span className="fit-data" style={{ fontSize: 11.5 }}>
                <span style={{ color: THEME.gris2, textDecoration: "line-through" }}>{l.avant}</span>
                <span style={{ color: THEME.craie, marginLeft: 8 }}>{l.apres}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {etat === "propose" ? (
        <div className="flex gap-2 mt-3">
          <Btn small onClick={() => { snap.current = def.appliquer(proposition.params, app); setEtat("applique"); haptic(20); }}>Appliquer</Btn>
          <Btn small variant="ghost" onClick={() => setVoirDiff(!voirDiff)}>{voirDiff ? "Masquer" : "Voir le détail"}</Btn>
          <Btn small variant="ghost" onClick={() => setEtat("refuse")}>Non</Btn>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <Btn small variant="ghost" icon={RotateCcw}
            onClick={() => { if (snap.current) def.annuler(snap.current, app); setEtat("propose"); haptic(14); }}>Annuler</Btn>
        </div>
      )}
    </Card>
  );
}

function BlocStagnation({ app }) {
  const [ouvert, setOuvert] = useState(false);
  const d = useMemo(() => diagnostiquerStagnation(app), [app]);
  if (!d.donneesSuffisantes) return null;
  const couleurConf = { "élevé": "rouge", moyen: "jaune", faible: "gris" };

  return (
    <div>
      <Eyebrow right={d.stagnants.length > 0
        ? <span className="fit-data" style={{ fontSize: 11, color: THEME.rouge }}>{d.stagnants.length} exercice{d.stagnants.length > 1 ? "s" : ""}</span>
        : <span className="fit-data" style={{ fontSize: 11, color: THEME.vert }}>aucune</span>}>
        Stagnation
      </Eyebrow>
      <Card accent={d.stagnants.length ? "rouge" : "vert"} style={{ padding: 14 }}>
        {d.stagnants.length === 0 ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
            Aucun mouvement ne stagne sur les quatre dernières séances loggées. Rien à corriger pour l'instant : laisse tourner.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Maximum estimé stable ou en baisse sur quatre séances consécutives : {d.stagnants.map((s) => `${s.nom} (${s.depart} → ${s.arrivee} kg)`).join(", ")}.
            </div>
            <button onClick={() => { haptic(6); setOuvert(!ouvert); }} className="flex items-center gap-2 mt-3">
              <span className="fit-eyebrow" style={{ color: THEME.rouge }}>Causes probables</span>
              <ChevronDown size={13} style={{ color: THEME.rouge, transform: ouvert ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>
            {ouvert && (
              <div className="fit-fade mt-2 space-y-3">
                {d.causes.length === 0 && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: THEME.gris }}>
                    Aucune cause évidente dans les données disponibles. Une stagnation de quatre séances peut aussi être une variation normale : ce n'est un signal qu'au-delà.
                  </div>
                )}
                {d.causes.map((c, i) => (
                  <div key={i} className="pl-3" style={{ borderLeft: `2px solid ${C(couleurConf[c.confiance] || "gris")}` }}>
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{i + 1}. {c.titre}</span>
                      <span className="fit-eyebrow" style={{ color: C(couleurConf[c.confiance] || "gris") }}>confiance {c.confiance}</span>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 4 }}>{c.detail}</div>
                    {c.action && <div className="mt-2.5"><CarteAction proposition={c.action} app={app} /></div>}
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: THEME.gris2, lineHeight: 1.5 }}>
                  Ces causes sont déduites de tes données loggées, par ordre de confiance décroissante. Une confiance faible signifie que l'application manque de données pour trancher, pas que la piste est mauvaise.
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Coach({ app }) {
  const { profil, jour, entrainement, chat, setChat, appelClaude, apiEtat, apiDiag, aller } = app;
  const glossaireDispo = true;
  const [saisie, setSaisie] = useState("");
  const [charge, setCharge] = useState(false);
  const finRef = useRef(null);
  const obj = useMemo(() => objectifsDuJour(profil, jour), [profil, jour]);
  const tot = useMemo(() => totauxJour(jour), [jour]);

  useEffect(() => { finRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }); }, [chat.messages, charge]);

  const contexte = () => {
    const prog = entrainement.programme;
    const dernieres = entrainement.seances.slice(-3).map((s) => `${s.date} ${s.nom}`).join(" ; ");
    return `PROFIL — ${profil.prenom || "utilisateur"}, ${profil.sexe}, ${profil.age} ans, ${profil.taille} cm, ${profil.poids} kg${profil.mg ? `, ${profil.mg} % de masse grasse` : ""}. Niveau ${profil.niveau}. Métier : ${METIERS[profil.metier].nom}. ${profil.pasMoyens} pas/jour en moyenne. Sommeil ${profil.sommeil} h. Stress perçu ${profil.stress}/5.${profil.blessures ? ` Antécédents : ${profil.blessures}.` : ""}${profil.regime.length ? ` Régime : ${profil.regime.join(", ")}.` : ""}${profil.allergies ? ` Allergies : ${profil.allergies}.` : ""}
OBJECTIFS — entraînement : ${OBJECTIFS_ENTRAINEMENT[profil.objectif].nom} ; nutrition : ${obj.obj.nom} (vitesse ${profil.vitesse}).
BESOINS DU JOUR — cible ${obj.kcal} kcal (maintenance estimée ${obj.maintenance}), P ${obj.prot} g / G ${obj.gluc} g / L ${obj.lip} g. Consommé à l'instant : ${Math.round(tot.kcal)} kcal, P ${Math.round(tot.prot)} G ${Math.round(tot.gluc)} L ${Math.round(tot.lip)}, fibres ${Math.round(tot.fibres)} g. Pas du jour : ${jour.pas ?? "non renseignés"}. Entraînement prévu : ${jour.entrainementPrevu || "aucun"}.
PROGRAMME — ${prog ? `${prog.splitNom}, semaine ${prog.semaine}${prog.deload ? " (décharge)" : ""}, ${prog.frequence} séances.` : "non généré"} Dernières séances : ${dernieres || "aucune"}.
${chat.resume ? `RÉSUMÉ DES ÉCHANGES ANTÉRIEURS — ${chat.resume}` : ""}`;
  };

  const envoyer = async (texte) => {
    const t = (texte ?? saisie).trim();
    if (!t || charge) return;
    setSaisie(""); setCharge(true);
    const msgs = [...chat.messages, { role: "user", content: t }];
    setChat({ ...chat, messages: msgs });

    // Gestion locale sans appel API quand la réponse est déjà en base
    const local = reponseLocale(t, { profil, obj, entrainement });
    if (local) {
      setChat((c) => ({ ...c, messages: [...msgs, { role: "assistant", content: local, local: true }] }));
      setCharge(false); return;
    }

    const historique = msgs.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    const rep = await appelClaude([{ role: "user", content: contexte() }, { role: "assistant", content: "Contexte enregistré." }, ...historique], SYSTEME_COACH);
    setCharge(false);
    if (rep == null) {
      const texte = apiEtat === "sansCle"
        ? "Le coach n'est pas encore connecté à l'API. Ouvre Profil puis iPhone pour renseigner un proxy ou une clé. En attendant, les fiches d'exercices, le programme et le journal fonctionnent hors connexion."
        : (apiDiag ? apiDiag + "\n\nLes fiches d'exercices, le programme et le journal restent accessibles hors connexion."
                   : "Le coach est injoignable pour le moment. Les fiches d'exercices, le programme et le journal restent accessibles hors connexion — réessaie dans un instant.");
      setChat((c) => ({ ...c, messages: [...msgs, { role: "assistant", content: texte, erreur: true }] }));
      return;
    }
    const { texte: repTexte, actions: repActions } = extraireActions(rep);
    setChat((c) => {
      const nouveaux = [...msgs, { role: "assistant", content: repTexte, actions: repActions }];
      // Résumé des échanges anciens pour ne pas envoyer l'historique complet indéfiniment
      let resume = c.resume;
      if (nouveaux.length > 16) resume = `${c.resume ? c.resume + " " : ""}Échanges antérieurs portant sur : ${nouveaux.slice(0, 8).filter((m) => m.role === "user").map((m) => m.content.slice(0, 60)).join(" / ")}.`;
      return { ...c, messages: nouveaux.length > 16 ? nouveaux.slice(-10) : nouveaux, resume };
    });
  };

  const suggestions = [
    jour.pas == null ? "Combien de pas aujourd'hui ?" : null,
    "Pourquoi 5×3 sur le squat et pas 4×10 ?",
    "Il me reste quoi à manger ce soir ?",
    "J'ai mal dormi, je fais quoi de ma séance ?",
  ].filter(Boolean);

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 150px)" }}>
      <div className="px-5 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="fit-eyebrow">Coach</div>
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 2 }}>
              Accès en lecture à ton profil, ton journal et ton programme.
            </div>
          </div>
          <div className="text-right">
            <div className="fit-eyebrow">Tokens</div>
            <div className="fit-data" style={{ fontSize: 12, color: THEME.gris }}>{(chat.tokens?.in || 0) + (chat.tokens?.out || 0)}</div>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-4 space-y-3">
        {!chat.messages.length && (
          <>
            <Card accent="bleu" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                Je réponds sur l'entraînement, la nutrition, la récupération et la technique. Je ne pose aucun diagnostic : si quelque chose relève de la santé, je le dis et j'oriente.
              </div>
              {glossaireDispo && (
                <button onClick={() => { haptic(); aller("profil"); }} className="fit-eyebrow mt-2.5" style={{ color: THEME.bleu }}>
                  Un terme t'échappe ? Le glossaire est dans Profil
                </button>
              )}
            </Card>
            <div className="flex flex-wrap gap-1.5">{suggestions.map((s) => <Chip key={s} onClick={() => envoyer(s)}>{s}</Chip>)}</div>
          </>
        )}
        {chat.messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className="rounded-xl px-3.5 py-2.5" style={{
              maxWidth: "88%", background: m.role === "user" ? THEME.craie : THEME.surface,
              color: m.role === "user" ? THEME.noir : THEME.craie,
              border: m.role === "user" ? "none" : `1px solid ${m.erreur ? THEME.rouge : THEME.rule}`,
              fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
            }}>{m.content}
              {m.local && <div className="fit-eyebrow mt-1.5" style={{ color: THEME.gris2 }}>Réponse locale — aucun appel réseau</div>}
              {m.actions?.length > 0 && (
                <div className="space-y-2" style={{ marginTop: 12 }}>
                  {m.actions.map((a, k) => <CarteAction key={k} proposition={a} app={app} />)}
                </div>
              )}
            </div>
          </div>
        ))}
        {charge && <div className="flex items-center gap-2" style={{ color: THEME.gris, fontSize: 13 }}><Loader2 size={14} className="animate-spin" />Le coach réfléchit…</div>}
        <div ref={finRef} />
      </div>

      <div className="px-5 pt-2 sticky z-20" style={{ background: THEME.noir, paddingBottom: 8, bottom: "calc(72px + env(safe-area-inset-bottom))" }}>
        {chat.messages.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">{suggestions.slice(0, 2).map((s) => <Chip key={s} onClick={() => envoyer(s)}>{s}</Chip>)}</div>}
        <div className="flex gap-2">
          <input className="fit-input" style={{ fontFamily: FF.body }} placeholder="Pose ta question…" value={saisie}
            onChange={(e) => setSaisie(e.target.value)} onKeyDown={(e) => e.key === "Enter" && envoyer()} />
          <Btn onClick={() => envoyer()} disabled={charge || !saisie.trim()} icon={Send}>{""}</Btn>
        </div>
      </div>
    </div>
  );
}

/* Réponses gérées localement — évite un appel API quand la donnée est déjà en base */
function reponseLocale(q, { profil, obj, entrainement }) {
  const n = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ex = EXERCICES.find((e) => n.includes(e.nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
  if (ex && (n.includes("comment") || n.includes("execut") || n.includes("technique") || n.includes("erreur"))) {
    return `${ex.nom}\n\n${ex.interet}\n\nExécution — ${ex.consignes}\n\nErreurs fréquentes — ${ex.erreurs}\n\nVariantes — ${ex.variantes}${ex.contre ? `\n\nPrudence — ${ex.contre}` : ""}`;
  }
  if (n.includes("combien de calorie") || n.includes("mes besoins") || n.includes("ma cible")) {
    return `Cible du jour : ${obj.kcal} kcal, pour une maintenance estimée à ${obj.maintenance} kcal.\n\nRépartition : ${obj.prot} g de protéines (${obj.gProtKg} g/kg), ${obj.gluc} g de glucides, ${obj.lip} g de lipides.\n\nMétabolisme de base ${obj.bmr} kcal par ${obj.methodeBmr}. ${obj.pourquoiBmr}`;
  }
  return null;
}


/* ==========================================================================
   ÉCRAN — PLAN DE RECOMPOSITION
   ========================================================================== */

function PlanRecomposition({ app }) {
  const { profil, setProfil } = app;
  const [cible, setCible] = useState(profil.sexe === "H" ? 13 : 24);
  const [mois, setMois] = useState(10);
  const [phases, setPhases] = useState(profil.plan?.phases || null);
  const [ouvert, setOuvert] = useState(null);

  const proj = useMemo(() => (phases ? projeterPlan(profil, phases) : null), [profil, phases]);
  const propose = () => { const ph = proposerPlan(profil, cible, mois); setPhases(ph); haptic(14); };
  const enregistrer = () => { setProfil({ ...profil, plan: { phases, creeLe: new Date().toISOString(), cible, mois } }); haptic(16); };

  const mgDepart = profil.mg && profil.mg > 3 ? profil.mg : (profil.sexe === "H" ? 20 : 30);
  const palierDepart = palierDe(profil.sexe, mgDepart);
  const palierCible = palierDe(profil.sexe, cible);
  const plancher = MG_PLANCHER[profil.sexe] || 8;

  const donnees = useMemo(() => (proj ? proj.points.filter((_, i) => i % 2 === 0 || i === proj.points.length - 1)
    .map((p) => ({ s: "S" + p.sem, poids: p.poids, mg: p.mg, maigre: p.maigre })) : []), [proj]);

  return (
    <div className="space-y-5">
      <Card style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-2">D'où tu pars</div>
        <Ligne g="Poids actuel" d={`${profil.poids} kg`} />
        <Ligne g={profil.mg ? "Masse grasse renseignée" : "Masse grasse estimée par défaut"} d={`${mgDepart} %`} couleur={palierDepart.couleur} />
        <Ligne g="Masse maigre" d={`${Math.round(profil.poids * (1 - mgDepart / 100) * 10) / 10} kg`} couleur="blanc" />
        {!profil.mg && <div style={{ fontSize: 11.5, color: THEME.jaune, marginTop: 8, lineHeight: 1.5 }}>
          Sans taux de masse grasse renseigné, la projection part d'une valeur moyenne. Renseigne-le dans Mesures pour une trajectoire fiable — une balance à impédance ou une pince à pli cutané suffisent comme point de repère, l'important étant de toujours mesurer dans les mêmes conditions.
        </div>}
      </Card>

      <Card style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-3">Où tu veux arriver</div>
        <div className="flex justify-between mb-1.5">
          <span style={{ fontSize: 13 }}>Masse grasse visée</span>
          <span className="fit-data" style={{ fontSize: 13, color: C(palierCible.couleur) }}>{cible} %</span>
        </div>
        <input type="range" min={plancher} max={profil.sexe === "H" ? 30 : 40} step={1} value={cible}
          onChange={(e) => setCible(+e.target.value)} className="w-full" />
        <Card accent={palierCible.couleur} style={{ padding: 12, marginTop: 12 }}>
          <div className="fit-display" style={{ fontSize: 14 }}>{palierCible.nom}</div>
          <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>{palierCible.apparence}</div>
          <Pourquoi couleur={palierCible.couleur} titre="Ce que ça demande vraiment">
            <p>{palierCible.cout}</p>
            <p className="mt-2" style={{ color: THEME.gris }}>Durée — {palierCible.duree}</p>
          </Pourquoi>
        </Card>
        <div className="mt-3">
          <div className="flex justify-between mb-1.5">
            <span style={{ fontSize: 13 }}>Horizon</span>
            <span className="fit-data" style={{ fontSize: 13 }}>{mois} mois</span>
          </div>
          <input type="range" min={3} max={18} step={1} value={mois} onChange={(e) => setMois(+e.target.value)} className="w-full" />
        </div>
        <Btn full style={{ marginTop: 14 }} onClick={propose} icon={Calendar}>Construire le plan</Btn>
      </Card>

      {proj && (
        <>
          {Math.abs(proj.arrivee.mg - cible) > 2 && (
            <Card accent="jaune" style={{ padding: 14 }}>
              <div className="flex gap-2.5">
                <Info size={16} style={{ color: THEME.jaune, flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  Ce plan aboutit à {proj.arrivee.mg.toFixed(1)} % alors que tu visais {cible} %.
                  {proj.arrivee.mg > cible
                    ? " L'horizon est trop court pour la distance à parcourir : allonge la durée, ou vise un palier intermédiaire et reprends ensuite. Une sèche menée trop vite se paie en masse musculaire."
                    : " Le rythme naturel des phases te fait dépasser la cible. Raccourcis la phase de sèche de quelques semaines, ou laisse-toi arriver plus bas si tu t'y sens bien."}
                </div>
              </div>
            </Card>
          )}
          {proj.alertes.map((a, i) => (
            <Card key={i} accent={a.n === "danger" ? "rouge" : "jaune"} style={{ padding: 14 }}>
              <div className="flex gap-2.5">
                <AlertTriangle size={16} style={{ color: a.n === "danger" ? THEME.rouge : THEME.jaune, flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{a.t}</div>
              </div>
            </Card>
          ))}

          <div>
            <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{proj.semaines} semaines</span>}>Trajectoire projetée</Eyebrow>
            <Graphique hauteur={180} rendu={(R) => (
                <R.LineChart data={donnees}>
                    <R.CartesianGrid stroke={THEME.rule} vertical={false} />
                    <R.XAxis dataKey="s" tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <R.YAxis yAxisId="p" domain={["dataMin - 2", "dataMax + 2"]} tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} width={30} />
                    <R.YAxis yAxisId="m" orientation="right" domain={["dataMin - 2", "dataMax + 2"]} tick={{ fill: THEME.gris, fontSize: 11, fontFamily: FF.data }} axisLine={false} tickLine={false} width={30} />
                    <R.Tooltip contentStyle={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderRadius: 8, fontFamily: FF.data, fontSize: 12 }} />
                    <R.Line yAxisId="p" type="monotone" dataKey="poids" name="Poids kg" stroke={THEME.craie} strokeWidth={2} dot={false} />
                    <R.Line yAxisId="p" type="monotone" dataKey="maigre" name="Masse maigre kg" stroke={THEME.bleu} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                    <R.Line yAxisId="m" type="monotone" dataKey="mg" name="Masse grasse %" stroke={THEME.rouge} strokeWidth={2} dot={false} />
                  </R.LineChart>
              )} />
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[["Poids", `${proj.depart.poids} → ${proj.arrivee.poids} kg`, "craie"],
                ["Masse grasse", `${proj.depart.mg.toFixed(1)} → ${proj.arrivee.mg.toFixed(1)} %`, "rouge"],
                ["Masse maigre", `${proj.depart.maigre.toFixed(1)} → ${proj.arrivee.maigre.toFixed(1)} kg`, "bleu"]].map(([l, v, c]) => (
                <Card key={l} style={{ padding: 11 }}>
                  <div className="fit-eyebrow">{l}</div>
                  <div className="fit-data" style={{ fontSize: 12, color: C(c), marginTop: 4 }}>{v}</div>
                </Card>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 10, lineHeight: 1.5 }}>
              C'est une projection, pas une promesse. Elle suppose une part de muscle dans le gain de {Math.round((PART_MUSCLE[profil.niveau] || 0.45) * 100)} %, cohérente avec ton niveau, et une régularité constante. La réalité observée sur la balance prime toujours : la boucle d'ajustement du tableau de bord corrigera au fil des semaines.
            </div>
          </div>

          <div>
            <Eyebrow>Les phases</Eyebrow>
            <div className="space-y-2.5">
              {phases.map((ph, i) => {
                const t = TYPES_PHASE[ph.type];
                const j = proj.jalons[i];
                const debut = i === 0 ? proj.depart : proj.jalons[i - 1];
                return (
                  <Card key={i} accent={t.couleur} style={{ padding: 14 }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="fit-display" style={{ fontSize: 15 }}>{t.nom}</span>
                      <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{ph.semaines} sem.</span>
                    </div>
                    <div className="fit-data" style={{ fontSize: 11.5, color: C(t.couleur), marginTop: 5 }}>
                      {debut.poids} kg à {debut.mg.toFixed(1)} % → {j.poids} kg à {j.mg.toFixed(1)} %
                    </div>
                    <div className="fit-data" style={{ fontSize: 11, color: THEME.gris2, marginTop: 3 }}>
                      jusqu'au {j.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                    </div>
                    <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 8, lineHeight: 1.5 }}>{t.quoi}</div>
                    <div className="flex gap-2 mt-3">
                      <Btn small variant="ghost" onClick={() => setPhases(phases.map((x, k) => k === i ? { ...x, semaines: Math.max(1, x.semaines - 2) } : x))}>− 2 sem.</Btn>
                      <Btn small variant="ghost" onClick={() => setPhases(phases.map((x, k) => k === i ? { ...x, semaines: x.semaines + 2 } : x))}>+ 2 sem.</Btn>
                      <Btn small variant="ghost" onClick={() => { setProfil({ ...profil, objNutrition: t.objNutri }); haptic(14); }}>Appliquer</Btn>
                    </div>
                    <Pourquoi couleur={t.couleur} titre="Durée conseillée">{t.duree}</Pourquoi>
                  </Card>
                );
              })}
            </div>
            <Btn full style={{ marginTop: 12 }} onClick={enregistrer} icon={Check}>Enregistrer ce plan</Btn>
          </div>
        </>
      )}

      <div>
        <Eyebrow>Les paliers, sans détour</Eyebrow>
        <div className="space-y-2">
          {(PALIERS_MG[profil.sexe] || PALIERS_MG.H).map((pa) => (
            <div key={pa.id} className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}`, borderLeft: `3px solid ${C(pa.couleur)}` }}>
              <button onClick={() => { haptic(6); setOuvert(ouvert === pa.id ? null : pa.id); }} className="w-full text-left px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{pa.nom}</span>
                  {pa.danger && <span className="fit-eyebrow" style={{ color: THEME.rouge }}>Zone à risque</span>}
                </div>
                <div style={{ fontSize: 12, color: THEME.gris, marginTop: 3, lineHeight: 1.45 }}>{pa.apparence}</div>
              </button>
              {ouvert === pa.id && (
                <div className="px-3 pb-3 fit-fade space-y-2" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  <div className="pl-2.5" style={{ borderLeft: `2px solid ${C(pa.couleur)}` }}>
                    <div className="fit-eyebrow" style={{ color: C(pa.couleur) }}>Ce que ça coûte</div>
                    <p className="mt-1">{pa.cout}</p>
                  </div>
                  <p><span style={{ color: THEME.gris }}>Durée tenable — </span>{pa.duree}</p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 10, lineHeight: 1.55 }}>
          Ces paliers décrivent des états, pas des modèles à imiter. La répartition de la graisse, la largeur d'épaules et l'insertion des muscles sont en grande partie génétiques : deux personnes au même taux de masse grasse n'auront pas la même allure. Ce que tu contrôles, c'est ton taux, ta force et ta régularité.
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   ÉCRAN — SEMAINIER ET BUDGET
   ========================================================================== */

function Semainier({ app, obj, foods }) {
  const { profil, cuisine, setCuisine } = app;
  const [graine, setGraine] = useState(0);
  const [jourOuvert, setJourOuvert] = useState(0);
  const sem = useMemo(() => genererSemaine(profil, obj, foods, graine), [profil, obj, foods, graine]);
  const j = sem.jours[jourOuvert];

  return (
    <div className="px-5 pt-5 pb-6 space-y-5">
      <Card accent="jaune" style={{ padding: 14 }}>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="fit-eyebrow">Budget de la semaine</div>
            <div className="fit-display" style={{ fontSize: 30, lineHeight: 1, marginTop: 6 }}>{euro(sem.coutSemaine)}</div>
          </div>
          <div className="text-right">
            <div className="fit-eyebrow">Par jour</div>
            <div className="fit-data" style={{ fontSize: 15, marginTop: 6 }}>{euro(sem.coutJour)}</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: THEME.gris, marginTop: 10, lineHeight: 1.5 }}>
          Prix moyens de grande surface, hors promotion. Un ordre de grandeur pour comparer des menus et anticiper un budget, pas un ticket de caisse.
        </div>
      </Card>

      <div>
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {sem.jours.map((x, i) => (
            <Chip key={i} actif={jourOuvert === i} onClick={() => setJourOuvert(i)}>{x.nom.slice(0, 3)}</Chip>
          ))}
        </div>
        <Card style={{ padding: 14, marginTop: 12 }}>
          <div className="flex items-baseline justify-between">
            <span className="fit-display" style={{ fontSize: 16 }}>{j.nom}</span>
            <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{euro(j.tot.cout * j.facteur)}</span>
          </div>
          <div className="fit-data" style={{ fontSize: 11.5, color: THEME.jaune, marginTop: 4 }}>
            {Math.round(j.tot.kcal * j.facteur)} kcal · P {Math.round(j.tot.prot * j.facteur)} · G {Math.round(j.tot.gluc * j.facteur)} · L {Math.round(j.tot.lip * j.facteur)}
          </div>
          {j.facteur !== 1 && <div style={{ fontSize: 11.5, color: THEME.gris, marginTop: 6, lineHeight: 1.45 }}>
            Portions ajustées à {Math.round(j.facteur * 100)} % pour tomber sur ta cible de {obj.kcal} kcal.
          </div>}
          <div className="mt-3">
            {j.repas.map((r, i) => (
              <div key={i} className="flex gap-3 py-2.5" style={{ borderTop: i ? `1px solid ${THEME.rule}` : "none" }}>
                <span className="fit-eyebrow" style={{ minWidth: 62, paddingTop: 2 }}>{REPAS_LABELS[r.moment]?.slice(0, 9) || r.moment}</span>
                <div className="flex-1">
                  <div style={{ fontSize: 13 }}>{r.recette.nom}</div>
                  <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 2 }}>
                    {Math.round(r.nut.kcal * j.facteur)} kcal · {euro(r.cout * j.facteur)} · {r.recette.temps} min
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Btn full variant="ghost" style={{ marginTop: 10 }} icon={RotateCcw} onClick={() => { setGraine(graine + 1); haptic(); }}>
          Proposer une autre semaine
        </Btn>
      </div>

      <div>
        <Eyebrow right={<span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{sem.courses.length} articles</span>}>Courses de la semaine</Eyebrow>
        <Card style={{ padding: 14 }}>
          {sem.courses.slice(0, 26).map((c, i) => (
            <div key={i} className="flex items-baseline justify-between py-1.5" style={{ borderBottom: i < 25 ? `1px solid ${THEME.rule}` : "none" }}>
              <span style={{ fontSize: 12.5 }}>{c.nom}</span>
              <span className="fit-data" style={{ fontSize: 11.5, color: THEME.gris, whiteSpace: "nowrap", marginLeft: 10 }}>
                {c.g >= 1000 ? (c.g / 1000).toFixed(1) + " kg" : c.g + " g"} · {euro(c.prix)}
              </span>
            </div>
          ))}
        </Card>
        <Btn full variant="ghost" style={{ marginTop: 10 }} icon={ShoppingCart}
          onClick={() => { setCuisine({ ...cuisine, courses: [...new Set([...(cuisine.courses || []), ...sem.courses.map((c) => c.nom)])] }); haptic(16); }}>
          Envoyer vers ma liste de courses
        </Btn>
      </div>
    </div>
  );
}

/* ==========================================================================
   ÉCRAN — GLOSSAIRE
   ========================================================================== */

function Glossaire() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(null);
  const [ouvert, setOuvert] = useState(null);
  const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const liste = GLOSSAIRE.filter((g) => (!cat || g.cat === cat)
    && (!q || norm(g.t + " " + g.dev + " " + g.d).includes(norm(q))));
  return (
    <div className="space-y-4">
      <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.55 }}>
        Le vocabulaire de la salle sert souvent à impressionner plus qu'à expliquer. Voilà ce que chaque terme veut vraiment dire, avec un exemple concret et la raison pour laquelle il existe.
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: THEME.gris }} />
        <input className="fit-input" style={{ paddingLeft: 38, fontFamily: FF.body }} placeholder="RPE, tempo, déficit…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CAT_GLOSSAIRE.map((c) => <Chip key={c} actif={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c}</Chip>)}
      </div>
      <div className="space-y-2">
        {liste.map((g) => (
          <div key={g.t} className="rounded-lg" style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
            <button onClick={() => { haptic(6); setOuvert(ouvert === g.t ? null : g.t); }} className="w-full text-left px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="fit-display" style={{ fontSize: 14 }}>{g.t}</span>
                <span className="fit-eyebrow">{g.cat}</span>
              </div>
              {g.dev && <div className="fit-data" style={{ fontSize: 11, color: THEME.gris, marginTop: 3 }}>{g.dev}</div>}
            </button>
            {ouvert === g.t && (
              <div className="px-3 pb-3 fit-fade space-y-2" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                <p>{g.d}</p>
                <div className="pl-2.5" style={{ borderLeft: `2px solid ${THEME.jaune}` }}>
                  <div className="fit-eyebrow" style={{ color: THEME.jaune }}>Exemple</div>
                  <p className="mt-1">{g.ex}</p>
                </div>
                <p style={{ color: THEME.gris }}>{g.pourquoi}</p>
              </div>
            )}
          </div>
        ))}
        {!liste.length && <Vide titre="Aucun terme ne correspond." />}
      </div>
    </div>
  );
}

/* ==========================================================================
   ÉCRAN — COURSES
   ========================================================================== */

function Courses({ app }) {
  const { cuisine, setCuisine } = app;
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const [erreurGeo, setErreurGeo] = useState("");
  const liste = cuisine.courses || [];
  const coches = cuisine.coches || [];

  const RAYONS = {
    "Fruits & légumes": ["tomate", "salade", "banane", "pomme", "brocoli", "courgette", "carotte", "poivron", "epinard", "orange", "kiwi", "avocat", "champignon", "oignon", "poireau", "haricot vert", "fraise", "myrtille", "raisin", "chou"],
    "Boucherie & poissonnerie": ["poulet", "dinde", "steak", "porc", "jambon", "saumon", "thon", "cabillaud", "maquereau", "sardine", "crevette", "boeuf"],
    "Crèmerie": ["lait", "yaourt", "skyr", "fromage", "comte", "mozzarella", "parmesan", "beurre", "oeuf", "creme"],
    "Épicerie salée": ["riz", "pate", "quinoa", "semoule", "boulgour", "lentille", "pois", "haricot rouge", "tofu", "tempeh", "seitan", "huile", "sauce", "moutarde", "ketchup"],
    "Épicerie sucrée & petit-déjeuner": ["avoine", "miel", "chocolat", "barre", "biscuit", "beurre de cacahuete", "amande", "noix", "noisette", "graine", "datte"],
    "Boulangerie": ["pain", "baguette"],
  };
  const rayonDe = (item) => {
    const n = item.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const [r, mots] of Object.entries(RAYONS)) if (mots.some((m) => n.includes(m))) return r;
    return "Divers";
  };
  const parRayon = liste.reduce((acc, it) => { const r = rayonDe(it); (acc[r] = acc[r] || []).push(it); return acc; }, {});

  const localiser = () => {
    if (!navigator.geolocation) { setErreurGeo("La géolocalisation n'est pas disponible sur ce navigateur. Tu peux ouvrir une recherche générique dans Plans."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setErreurGeo(""); haptic(14); },
      () => setErreurGeo("Position refusée ou indisponible. Autorise la localisation dans les réglages, ou ouvre une recherche générique dans Plans.")
    );
  };
  const lien = (terme) => pos
    ? `https://maps.apple.com/?q=${encodeURIComponent(terme)}&sll=${pos.lat},${pos.lng}`
    : `https://maps.apple.com/?q=${encodeURIComponent(terme)}`;

  return (
    <div className="px-5 pt-2 pb-6 space-y-6">
      <div>
        <div className="flex gap-2">
          <input className="fit-input" style={{ fontFamily: FF.body }} placeholder="Ajouter à la liste" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { setCuisine({ ...cuisine, courses: [...liste, q.trim()] }); setQ(""); } }} />
          <Btn onClick={() => { if (q.trim()) { setCuisine({ ...cuisine, courses: [...liste, q.trim()] }); setQ(""); } }} icon={Plus}>{""}</Btn>
        </div>
      </div>

      {!liste.length ? (
        <Vide icone={ShoppingCart} titre="Ta liste est vide. Elle se remplit toute seule depuis les recettes : ouvre une recette et ajoute ce qui manque." />
      ) : (
        <div className="space-y-5">
          {Object.entries(parRayon).map(([rayon, items]) => (
            <div key={rayon}>
              <Eyebrow>{rayon}</Eyebrow>
              <div className="space-y-1.5">
                {items.map((it) => {
                  const on = coches.includes(it);
                  return (
                    <button key={it} onClick={() => { haptic(); setCuisine({ ...cuisine, coches: on ? coches.filter((x) => x !== it) : [...coches, it] }); }}
                      className="w-full fit-tap px-3 rounded-lg flex items-center gap-3 text-left"
                      style={{ background: THEME.surface, border: `1px solid ${THEME.rule}` }}>
                      <div className="rounded flex items-center justify-center" style={{ width: 18, height: 18, border: `1.5px solid ${on ? THEME.vert : THEME.rule}`, background: on ? THEME.vert : "transparent" }}>
                        {on && <Check size={12} color={THEME.noir} />}
                      </div>
                      <span style={{ fontSize: 13.5, textDecoration: on ? "line-through" : "none", color: on ? THEME.gris2 : THEME.craie }}>{it}</span>
                      <span className="ml-auto"><X size={14} style={{ color: THEME.gris2 }} onClick={(e) => { e.stopPropagation(); setCuisine({ ...cuisine, courses: liste.filter((x) => x !== it) }); }} /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <Eyebrow>Où faire ces courses</Eyebrow>
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5, marginBottom: 12 }}>
            Les commerces sont ouverts dans Plans à partir de ta position, par pertinence géographique. Aucune enseigne n'est mise en avant : cette application n'accepte aucun placement commercial.
          </div>
          <Btn full variant="ghost" icon={MapPin} onClick={localiser}>{pos ? "Position mise à jour" : "Utiliser ma position"}</Btn>
          {erreurGeo && <div style={{ fontSize: 12, color: THEME.jaune, marginTop: 8, lineHeight: 1.45 }}>{erreurGeo}</div>}
          <div className="grid grid-cols-2 gap-2 mt-3">
            {["Supermarché", "Primeur", "Boucherie", "Magasin bio", "Marché", "Poissonnerie"].map((t) => (
              <a key={t} href={lien(t)} target="_blank" rel="noreferrer" className="fit-tap rounded-lg flex items-center justify-center gap-1.5"
                style={{ border: `1px solid ${THEME.rule}`, color: THEME.craie, fontSize: 13 }}>
                <MapPin size={13} />{t}
              </a>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ==========================================================================
   ÉCRAN — PROFIL & RÉGLAGES
   ========================================================================== */

function Profil({ app }) {
  const { profil, setProfil, poidsHist, setPoidsHist, jour, dateKey, exporter, reinitialiser, entrainement } = app;
  const p = profil;
  const set = (k, v) => setProfil({ ...p, [k]: v });
  const obj = useMemo(() => objectifsDuJour(p, jour), [p, jour]);
  const [section, setSection] = useState("mesures");
  const [nouveauPoids, setNouveauPoids] = useState(null);

  const enregistrerPoids = () => {
    if (!nouveauPoids) return;
    setPoidsHist([...poidsHist.filter((x) => x.d !== dateKey), { d: dateKey, poids: +nouveauPoids, taille: p.tourTaille }].sort((a, b) => a.d.localeCompare(b.d)));
    set("poids", +nouveauPoids); setNouveauPoids(null); haptic(14);
  };

  const sections = [
    { v: "mesures", l: "Mesures" }, { v: "vie", l: "Mode de vie" },
    { v: "objectifs", l: "Objectifs" }, { v: "calculs", l: "Calculs" },
    { v: "plan", l: "Plan" }, { v: "glossaire", l: "Glossaire" },
    { v: "appareil", l: "iPhone" }, { v: "donnees", l: "Données" },
  ];

  return (
    <div className="px-5 pt-2 pb-6 space-y-5">
      <div className="flex flex-wrap gap-1.5">{sections.map((s) => <Chip key={s.v} actif={section === s.v} onClick={() => setSection(s.v)}>{s.l}</Chip>)}</div>

      {section === "mesures" && (
        <div className="space-y-4">
          <TextField label="Prénom" value={p.prenom} onChange={(v) => set("prenom", v)} />
          <div className="grid grid-cols-3 gap-2">
            <NumField label="Âge" value={p.age} onChange={(v) => set("age", v)} suffix="ans" />
            <NumField label="Taille" value={p.taille} onChange={(v) => set("taille", v)} suffix="cm" />
            <NumField label="Masse grasse" value={p.mg} onChange={(v) => set("mg", v)} suffix="%" />
          </div>
          <Card style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-2">Peser aujourd'hui</div>
            <div className="flex gap-2">
              <NumField value={nouveauPoids ?? ""} onChange={setNouveauPoids} suffix="kg" placeholder={String(p.poids)} />
              <Btn onClick={enregistrerPoids} disabled={!nouveauPoids}>Noter</Btn>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Tour de taille" value={p.tourTaille} onChange={(v) => set("tourTaille", v)} suffix="cm" />
            <NumField label="Tour de bras" value={p.tourBras} onChange={(v) => set("tourBras", v)} suffix="cm" />
            <NumField label="Tour de cuisse" value={p.tourCuisse} onChange={(v) => set("tourCuisse", v)} suffix="cm" />
          </div>
          <Pourquoi couleur="bleu" titre="Pourquoi mesurer le tour de taille">
            Le poids seul est trompeur : en prise de masse, il monte que le gain soit musculaire ou adipeux. Le tour de taille tranche. S'il reste stable pendant que le poids monte, la prise est de bonne qualité ; s'il grimpe en parallèle, le surplus est trop élevé.
          </Pourquoi>
        </div>
      )}

      {section === "vie" && (
        <div className="space-y-4">
          <div>
            <div className="fit-eyebrow mb-2">Métier / activité professionnelle</div>
            <Segmented cols={2} value={p.metier} onChange={(v) => set("metier", v)} options={Object.entries(METIERS).map(([k, m]) => ({ v: k, l: m.nom }))} />
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.45 }}>{METIERS[p.metier].desc}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Pas quotidiens moyens" value={p.pasMoyens} onChange={(v) => set("pasMoyens", v)} suffix="pas" />
            <NumField label="Sommeil moyen" value={p.sommeil} onChange={(v) => set("sommeil", v)} suffix="h" />
          </div>
          <div>
            <div className="fit-eyebrow mb-2">Stress perçu</div>
            <Segmented cols={5} value={p.stress} onChange={(v) => set("stress", v)} options={[1, 2, 3, 4, 5].map((n) => ({ v: n, l: String(n) }))} />
          </div>
          <div>
            <div className="fit-eyebrow mb-2">Consommation d'alcool</div>
            <Segmented cols={4} value={p.alcool} onChange={(v) => set("alcool", v)} options={[{ v: "jamais", l: "Jamais" }, { v: "rare", l: "Rare" }, { v: "hebdo", l: "Hebdo" }, { v: "souvent", l: "Souvent" }]} />
          </div>
          <TextField label="Activités annexes hors entraînement" value={p.activitesAnnexes} onChange={(v) => set("activitesAnnexes", v)} placeholder="Vélo le week-end, jardinage" />
          <div>
            <div className="fit-eyebrow mb-2">Contraintes alimentaires</div>
            <div className="flex flex-wrap gap-1.5">
              {["vegetarien", "vegetalien", "sans_gluten", "sans_lactose", "halal"].map((r) => (
                <Chip key={r} actif={p.regime.includes(r)} onClick={() => set("regime", p.regime.includes(r) ? p.regime.filter((x) => x !== r) : [...p.regime, r])}>
                  {r.replace("_", " ")}
                </Chip>
              ))}
            </div>
          </div>
          <TextField label="Allergies et intolérances" value={p.allergies} onChange={(v) => set("allergies", v)} />
          <TextField label="Aversions" value={p.aversions} onChange={(v) => set("aversions", v)} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="fit-eyebrow mb-2">Budget</div>
              <Segmented cols={3} value={p.budget} onChange={(v) => set("budget", v)} options={[{ v: "eco", l: "Serré" }, { v: "moyen", l: "Moyen" }, { v: "large", l: "Large" }]} />
            </div>
            <NumField label="Temps de cuisine" value={p.tempsCuisine} onChange={(v) => set("tempsCuisine", v)} suffix="min" />
          </div>
          <TextField label="Antécédents de blessure ou zones sensibles" multi value={p.blessures} onChange={(v) => set("blessures", v)} placeholder="Épaule droite sensible en développé" />
        </div>
      )}

      {section === "objectifs" && (
        <div className="space-y-5">
          <div>
            <Eyebrow>Objectif nutritionnel</Eyebrow>
            <div className="space-y-2">
              {Object.entries(OBJECTIFS_NUTRI).map(([k, o]) => (
                <Card key={k} accent={p.objNutrition === k ? o.couleur : undefined} onClick={() => { haptic(); set("objNutrition", k); }} style={{ padding: 12, cursor: "pointer", opacity: p.objNutrition === k ? 1 : .6 }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{o.nom}</span>
                    <span className="fit-data" style={{ fontSize: 11, color: THEME.gris }}>{o.ecart[0] === o.ecart[1] ? "maintenance" : `${o.ecart[0] > 0 ? "+" : ""}${o.ecart[0]} à ${o.ecart[1] > 0 ? "+" : ""}${o.ecart[1]} %`}</span>
                  </div>
                  {p.objNutrition === k && (
                    <div className="mt-2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                      <p>{o.explication}</p>
                      <p className="mt-2" style={{ color: THEME.gris }}>Vitesse attendue — {o.vitesse}</p>
                      <p className="mt-2" style={{ color: THEME.jaune }}>Compromis — {o.compromis}</p>
                      {o.demarrage && <p className="mt-2"><span style={{ color: THEME.gris }}>Mise en route — </span>{o.demarrage}</p>}
                      {o.quantite && <p className="mt-2"><span style={{ color: THEME.gris }}>Gérer les quantités — </span>{o.quantite}</p>}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
          <div>
            <div className="fit-eyebrow mb-2">Vitesse</div>
            <Segmented cols={3} value={p.vitesse} onChange={(v) => set("vitesse", v)} options={[{ v: "douce", l: "Douce" }, { v: "moderee", l: "Modérée" }, { v: "agressive", l: "Agressive" }]} />
            <div style={{ fontSize: 12, color: THEME.gris, marginTop: 8, lineHeight: 1.45 }}>
              {p.vitesse === "agressive" ? "Résultat plus rapide, mais qualité de composition corporelle et durabilité dégradées. Un garde-fou empêche toute valeur dangereuse." : p.vitesse === "douce" ? "Plus lent, mais la performance et la récupération restent intactes et le plan tient dans la durée." : "Le compromis par défaut : progression nette sans sacrifier la qualité d'entraînement."}
            </div>
          </div>
          <div>
            <Eyebrow>Objectif d'entraînement</Eyebrow>
            <Segmented cols={2} value={p.objectif} onChange={(v) => set("objectif", v)} options={Object.entries(OBJECTIFS_ENTRAINEMENT).map(([k, o]) => ({ v: k, l: o.nom }))} />
            <div className="mt-3">
              <div className="fit-eyebrow mb-2">Séances par semaine</div>
              <Segmented cols={5} value={p.frequence} onChange={(v) => set("frequence", v)} options={[2, 3, 4, 5, 6].map((n) => ({ v: n, l: String(n) }))} />
            </div>
            <div className="mt-4">
              <Eyebrow>Ton profil de pratiquant</Eyebrow>
              <div className="space-y-2">
                {Object.entries(NIVEAUX).map(([k, n]) => (
                  <Card key={k} accent={p.niveau === k ? n.couleur : undefined} onClick={() => { haptic(); set("niveau", k); }}
                    style={{ padding: 13, cursor: "pointer", opacity: p.niveau === k ? 1 : .6 }}>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{n.nom}</span>
                      <span className="fit-eyebrow">{n.duree}</span>
                    </div>
                    {p.niveau === k && (
                      <div className="fit-fade mt-2.5">
                        <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>{n.principe}</div>
                        <Pourquoi couleur={n.couleur} titre="Ce que ce niveau change">
                          {n.changements.map((c, i) => <p key={i} className="mb-1.5">— {c}</p>)}
                          <p className="mt-2" style={{ color: THEME.gris }}>Côté nutrition — {n.nutrition}</p>
                        </Pourquoi>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <Eyebrow>Zones sensibles</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(ZONES_SENSIBLES).map(([k, z]) => {
                  const on = (p.zonesSensibles || []).includes(k);
                  return <Chip key={k} actif={on} onClick={() => { const l = p.zonesSensibles || []; set("zonesSensibles", on ? l.filter((x) => x !== k) : [...l, k]); }}>{z.nom}</Chip>;
                })}
              </div>
              {(p.zonesSensibles || []).length > 0 && (
                <div className="fit-data mt-2" style={{ fontSize: 11.5, color: THEME.rouge }}>
                  {EXERCICES.filter((e) => exerciceDeconseille(e, p.zonesSensibles)).length} exercices écartés du programme
                </div>
              )}
            </div>
            <div className="mt-4">
              <div className="fit-eyebrow mb-2">Moment habituel de la séance</div>
              <Segmented cols={3} value={p.horaireSeance} onChange={(v) => set("horaireSeance", v)}
                options={[{ v: "matin", l: "Matin" }, { v: "midi", l: "Midi" }, { v: "soir", l: "Soir" }]} />
            </div>
          </div>
          <div>
            <Eyebrow>Matériel</Eyebrow>
            <div className="flex flex-wrap gap-1.5">
              {["barre", "halteres", "poulie", "machine", "banc", "pdc", "elastique", "kettlebell"].map((k) => (
                <Chip key={k} actif={p.materiel.includes(k)} onClick={() => set("materiel", p.materiel.includes(k) ? p.materiel.filter((x) => x !== k) : [...p.materiel, k])}>{k}</Chip>
              ))}
            </div>
          </div>
        </div>
      )}

      {section === "calculs" && (
        <div className="space-y-4">
          <Card style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-2">Décomposition de la dépense</div>
            <Ligne g={`Métabolisme de base — ${obj.methodeBmr}`} d={`${obj.bmr} kcal`} />
            <Ligne g="Thermogenèse & activité résiduelle" d={`+${obj.neat} kcal`} />
            <Ligne g={`Travail — ${METIERS[p.metier].nom}`} d={`+${obj.metier} kcal`} />
            <Ligne g={`Pas (${obj.pas})`} d={`+${obj.kPas} kcal`} />
            <Ligne g="Entraînement" d={`+${obj.kSeance} kcal`} />
            <Ligne g="Maintenance estimée" d={`${obj.maintenance} kcal`} couleur="craie" />
            <Ligne g={`Objectif — ${obj.obj.court} (${obj.ecart > 0 ? "+" : ""}${obj.ecart} %)`} d={`${obj.cible} kcal`} couleur={obj.obj.couleur} />
            <Pourquoi couleur="bleu" titre="Pourquoi cette formule">{obj.pourquoiBmr}</Pourquoi>
          </Card>
          <Card style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-2">Macros calculées</div>
            <Ligne g={`Protéines — ${obj.gProtKg} g/kg`} d={`${obj.prot} g`} couleur="blanc" />
            <Ligne g="Lipides — plancher hormonal" d={`${obj.lip} g`} couleur="rouge" />
            <Ligne g="Glucides — solde de l'enveloppe" d={`${obj.gluc} g`} couleur="jaune" />
            <Pourquoi couleur="jaune" titre="La logique de répartition">
              Les protéines sont fixées en premier car elles conditionnent la masse maigre. Les lipides viennent ensuite, avec un plancher de 0,8 à 1 g/kg pour la production hormonale et l'absorption des vitamines A, D, E et K. Les glucides prennent le solde : ce sont eux qui alimentent la performance, donc on les majore les jours d'entraînement lourd.
            </Pourquoi>
          </Card>
          <div>
            <Eyebrow>Surcharge manuelle</Eyebrow>
            <div style={{ fontSize: 12, color: THEME.gris, marginBottom: 10, lineHeight: 1.45 }}>
              Toute valeur calculée peut être remplacée. Laisse vide pour revenir au calcul automatique.
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[["kcal", "Calories", "kcal"], ["prot", "Protéines", "g"], ["gluc", "Glucides", "g"], ["lip", "Lipides", "g"]].map(([k, l, u]) => (
                <NumField key={k} label={l} suffix={u} value={p.overrides?.[k] ?? ""} placeholder={String(obj[k])}
                  onChange={(v) => set("overrides", { ...p.overrides, [k]: v })} />
              ))}
            </div>
          </div>
        </div>
      )}

      {section === "plan" && <PlanRecomposition app={app} />}
      {section === "glossaire" && <Glossaire />}
      {section === "appareil" && <SectionAppareil app={app} />}

      {section === "donnees" && (
        <div className="space-y-4">
          <Card style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-2">Cadre de responsabilité</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Cette application est un outil d'aide et de pédagogie, pas un dispositif médical. Elle ne pose aucun diagnostic et ne remplace ni médecin, ni diététicien, ni kinésithérapeute. Elle refuse les déficits caloriques extrêmes et les objectifs de poids dangereux, et oriente vers un professionnel de santé quand les paramètres sortent des plages raisonnables.
            </div>
          </Card>
          <DiagnosticStockage />
          <Sauvegarde app={app} />
          <Card style={{ padding: 14 }}>
            <div className="fit-eyebrow mb-2">Tes données</div>
            <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5, marginBottom: 12 }}>
              Stockage strictement personnel, jamais partagé. {entrainement.seances.length} séances, {poidsHist.length} pesées enregistrées.
            </div>
            <div className="flex gap-2">
              <Btn small variant="ghost" icon={Download} onClick={() => exporter("json")}>Exporter en JSON</Btn>
              <Btn small variant="ghost" icon={Download} onClick={() => exporter("csv")}>Exporter en CSV</Btn>
            </div>
          </Card>
          <ZoneDanger reinitialiser={reinitialiser} />
        </div>
      )}
    </div>
  );
}

function TestConnexion({ app }) {
  const { appelClaude, apiDiag } = app;
  const [etat, setEtat] = useState(null);
  const tester = async () => {
    setEtat("cours");
    const r = await appelClaude([{ role: "user", content: "Réponds exactement : connexion établie." }],
      "Tu réponds en un seul mot, sans ponctuation superflue.", { maxTokens: 20 });
    setEtat(r ? "ok" : "ko");
  };
  return (
    <div className="mt-3">
      <Btn full variant="ghost" small onClick={tester} disabled={etat === "cours"}
        icon={etat === "cours" ? Loader2 : etat === "ok" ? Check : undefined}>
        {etat === "cours" ? "Test en cours…" : "Tester la connexion"}
      </Btn>
      {etat === "ok" && <div className="fit-data mt-2" style={{ fontSize: 11.5, color: THEME.vert }}>Le coach répond. Tout est en place.</div>}
      {etat === "ko" && <div style={{ fontSize: 12, color: THEME.jaune, marginTop: 8, lineHeight: 1.5 }}>{apiDiag || "Connexion impossible."}</div>}
    </div>
  );
}

function SectionAppareil({ app }) {
  const { reglages, setReglages, installe } = app;
  const [notif, setNotif] = useState(typeof Notification !== "undefined" ? Notification.permission : "indisponible");
  const [testEnvoye, setTestEnvoye] = useState(false);
  const autonome = store.hote === "autonome";
  const ios = estIOS();

  return (
    <div className="space-y-4">
      <Card accent={installe ? "vert" : "jaune"} style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-1.5">Écran d'accueil</div>
        {installe ? (
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            L'application tourne en mode plein écran, sans barre de navigateur. Les gestes iOS, le mode hors-ligne et les notifications sont actifs.
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            {ios
              ? <>Pour l'installer : bouton <strong>Partager</strong> dans Safari, puis <strong>Sur l'écran d'accueil</strong>. Elle s'ouvrira ensuite en plein écran, comme une application. Sur iPhone, les notifications ne fonctionnent qu'une fois cette étape faite — c'est une règle d'iOS, pas un réglage de l'application.</>
              : <>Ouvre cette page dans Safari sur ton iPhone, puis Partager → Sur l'écran d'accueil.</>}
          </div>
        )}
      </Card>

      <Card style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-1.5">Notifications de fin de repos</div>
        <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5, marginBottom: 12 }}>
          Une bannière et une pastille sur l'icône quand le minuteur arrive au bout. Le son et la vibration ne marchent que si l'écran est allumé et l'application au premier plan : iOS ne laisse pas une application web tourner en arrière-plan.
        </div>
        {notif === "granted" ? (
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 flex-1" style={{ fontSize: 13, color: THEME.vert }}><Check size={15} />Autorisées</div>
            <Btn small variant="ghost" onClick={async () => { await notifier("Test", "Voilà à quoi ressemblera la fin de ton repos."); poserBadge(1); setTestEnvoye(true); setTimeout(() => poserBadge(0), 8000); }}>
              Envoyer un test
            </Btn>
          </div>
        ) : (
          <Btn full variant="ghost" onClick={async () => setNotif(await demanderNotifications())} disabled={notif === "denied" || notif === "indisponible"}>
            {notif === "denied" ? "Refusées — à réactiver dans Réglages iOS" : notif === "indisponible" ? "Indisponible dans ce contexte" : "Autoriser les notifications"}
          </Btn>
        )}
        {testEnvoye && <div className="fit-data mt-2" style={{ fontSize: 11.5, color: THEME.gris }}>Test envoyé. Si rien n'apparaît, vérifie que l'application est bien installée sur l'écran d'accueil.</div>}
        {!installe && notif !== "granted" && (
          <div style={{ fontSize: 11.5, color: THEME.jaune, marginTop: 8, lineHeight: 1.45 }}>
            Installe d'abord l'application sur l'écran d'accueil : Safari ne propose pas les notifications avant.
          </div>
        )}
      </Card>

      {autonome && (
        <Card style={{ padding: 14 }}>
          <div className="fit-eyebrow mb-1.5">Connexion du coach</div>
          <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5, marginBottom: 12 }}>
            Hors de l'atelier Claude, le coach a besoin d'un accès à l'API. Deux options, et elles ne se valent pas.
          </div>
          <TextField label="Proxy — recommandé" value={reglages.proxy} onChange={(v) => setReglages({ ...reglages, proxy: v })}
            placeholder="https://mon-proxy.workers.dev" />
          <div style={{ fontSize: 11.5, color: THEME.gris, marginTop: 6, lineHeight: 1.45 }}>
            La clé reste sur le serveur, jamais dans le téléphone ni dans le code de la page. Le fichier <span className="fit-data">worker.js</span> du paquet se déploie en quelques minutes sur Cloudflare.
          </div>
          <TestConnexion app={app} />
          <div className="mt-3">
            <TextField label="Ou clé API directe" value={reglages.cle} onChange={(v) => setReglages({ ...reglages, cle: v })} placeholder="sk-ant-…" />
            <div style={{ fontSize: 11.5, color: THEME.jaune, marginTop: 6, lineHeight: 1.45 }}>
              La clé est stockée sur cet appareil et repart dans chaque requête depuis le navigateur. Quiconque atteint l'adresse de ton site et ouvre les outils de développement peut la lire. À réserver à un essai rapide, pas à un usage durable.
            </div>
          </div>
        </Card>
      )}

      <Card style={{ padding: 14 }}>
        <div className="fit-eyebrow mb-1.5">Ce qu'une application web ne peut pas faire sur iPhone</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          <p>Widgets d'écran d'accueil, activités en direct dans l'îlot dynamique, lecture de code-barres par la caméra et minuteur qui continue écran verrouillé : ces quatre-là passent obligatoirement par une application native, avec compte développeur Apple et validation App Store.</p>
          <p className="mt-2" style={{ color: THEME.gris }}>Ce qui reste accessible ici : plein écran sans barre de navigateur, fonctionnement hors-ligne, notifications, pastille sur l'icône et raccourcis par appui long.</p>
        </div>
      </Card>
    </div>
  );
}

function Sauvegarde({ app }) {
  const { sauvegarder, restaurer, restauration, reglages } = app;
  const fichierRef = useRef(null);
  const derniere = reglages.derniereSauvegarde ? new Date(reglages.derniereSauvegarde) : null;
  const jours = derniere ? Math.floor((Date.now() - derniere.getTime()) / 86400000) : null;
  const vieille = jours == null || jours > 30;
  return (
    <Card accent={vieille ? "jaune" : "vert"} style={{ padding: 14 }}>
      <div className="fit-eyebrow mb-2">Sauvegarde</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
        {derniere
          ? `Dernière sauvegarde il y a ${jours} jour${jours > 1 ? "s" : ""}.`
          : "Aucune sauvegarde effectuée."}
        {vieille && " Tes données vivent uniquement sur cet appareil : un téléphone perdu, un cache purgé par iOS, et tout disparaît. Le fichier se range où tu veux et se relit d'un tap."}
      </div>
      <div className="flex gap-2 mt-3">
        <Btn small full onClick={sauvegarder} icon={Download}>Sauvegarder</Btn>
        <Btn small full variant="ghost" onClick={() => fichierRef.current?.click()} icon={RotateCcw}>Restaurer</Btn>
      </div>
      <input ref={fichierRef} type="file" accept="application/json,.json" style={{ display: "none" }}
        aria-label="Choisir un fichier de sauvegarde"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) restaurer(f); e.target.value = ""; }} />
      {restauration && (
        <div className="fit-data mt-3" style={{ fontSize: 11.5, color: restauration.ok ? THEME.vert : THEME.rouge, lineHeight: 1.5 }}>
          {restauration.ok
            ? `${restauration.n} ensembles restaurés. L'application se recharge…`
            : `Restauration impossible — ${restauration.msg}`}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: THEME.gris2, marginTop: 10, lineHeight: 1.5 }}>
        La sauvegarde contient tout : profil, journal, séances, programme, plan, réglages. Elle porte son numéro de schéma et sera migrée automatiquement si tu la rouvres après une mise à jour.
      </div>
    </Card>
  );
}

function DiagnosticStockage() {
  const [r, setR] = useState(null);
  const [encours, setEncours] = useState(false);
  const modes = {
    atelier: { l: "Atelier Claude", c: "vert", d: "Tes données sont enregistrées dans l'espace de stockage de l'atelier et te suivent d'une session à l'autre." },
    indexeddb: { l: "Base locale de l'appareil", c: "vert", d: "Tes données sont enregistrées sur cet appareil, dans IndexedDB. Elles survivent à la fermeture de l'application et fonctionnent hors connexion." },
    memoire: { l: "Mémoire de session", c: "jaune", d: "L'écriture durable a échoué : tes données sont conservées le temps de la session mais seront perdues à la fermeture. Trois causes possibles — navigation privée, espace de stockage saturé, ou blocage du site dans les réglages du navigateur. Exporte tes données pour ne rien perdre." },
    inconnu: { l: "Non testé", c: "gris", d: "" },
  };
  const m = modes[r?.mode] || modes.inconnu;
  return (
    <Card accent={r ? m.c : undefined} style={{ padding: 14 }}>
      <div className="fit-eyebrow mb-2">Où sont enregistrées tes données</div>
      {r ? (
        <>
          <div className="fit-data" style={{ fontSize: 13, color: C(m.c) }}>
            {m.l} · écriture {r.ecrit ? "réussie" : "échouée"} · relecture {r.relu ? "conforme" : "échouée"}
          </div>
          <div style={{ fontSize: 12.5, color: THEME.gris, marginTop: 8, lineHeight: 1.5 }}>{m.d}</div>
          {r.detail && r.mode === "memoire" && <div className="fit-data" style={{ fontSize: 11, color: THEME.gris2, marginTop: 6 }}>{r.detail}</div>}
        </>
      ) : (
        <div style={{ fontSize: 12.5, color: THEME.gris, lineHeight: 1.5 }}>
          Le test écrit une valeur témoin, la relit, puis l'efface. Il dit exactement où vivent tes données et si la sauvegarde est durable.
        </div>
      )}
      <Btn full small variant="ghost" style={{ marginTop: 12 }} disabled={encours}
        onClick={async () => { setEncours(true); setR(await store.tester()); setEncours(false); }}>
        {encours ? "Test en cours…" : "Tester la sauvegarde"}
      </Btn>
    </Card>
  );
}

function ZoneDanger({ reinitialiser }) {
  const [arme, setArme] = useState(false);
  if (!arme) return <Btn full variant="danger" icon={RotateCcw} onClick={() => setArme(true)}>Réinitialiser toutes les données</Btn>;
  return (
    <Card accent="rouge" style={{ padding: 14 }}>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        Journal, séances, mesures, programme et historique du coach seront effacés définitivement. Pense à exporter avant.
      </div>
      <div className="flex gap-2 mt-3">
        <Btn small full variant="ghost" onClick={() => setArme(false)}>Annuler</Btn>
        <Btn small full variant="danger" onClick={reinitialiser}>Effacer définitivement</Btn>
      </div>
    </Card>
  );
}

/* ==========================================================================
   FRONTIÈRE D'ERREUR
   Sans elle, une exception dans n'importe quel composant démonte l'arbre React
   entier : écran noir, et surtout plus aucun accès aux données ni moyen de les
   exporter. Sur une application dont tout vit sur l'appareil, c'est le pire
   scénario possible — d'où l'export de secours proposé ici même.
   ========================================================================== */

class FrontiereErreur extends React.Component {
  constructor(props) { super(props); this.state = { erreur: null, exporte: false }; }
  static getDerivedStateFromError(erreur) { return { erreur }; }
  componentDidCatch(erreur, info) { console.error("Erreur capturée", erreur, info?.componentStack); }

  async sauverDonnees() {
    try {
      const cles = ["profil", "entrainement", "cuisine", "chat", "reglages"];
      const listees = await store.liste("");
      const toutes = [...new Set([...cles, ...listees])];
      const data = {};
      for (const c of toutes) data[c] = await store.get(c);
      const url = URL.createObjectURL(new Blob([JSON.stringify({ secours: true, le: new Date().toISOString(), data }, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "wonna-grow-up-secours.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      this.setState({ exporte: true });
    } catch (e) { console.error("Export de secours impossible", e); }
  }

  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <div className="fit-root flex items-center justify-center px-6" style={{ minHeight: "100dvh" }}>
        <style>{CSS}</style>
        <div style={{ maxWidth: 420 }}>
          <div className="fit-eyebrow" style={{ color: THEME.rouge }}>Interruption</div>
          <h1 className="fit-display" style={{ fontSize: 24, lineHeight: 1.1, marginTop: 8 }}>
            L'application s'est arrêtée
          </h1>
          <p style={{ fontSize: 13.5, color: THEME.gris, marginTop: 10, lineHeight: 1.55 }}>
            Un défaut a interrompu l'affichage. Tes données sont intactes sur l'appareil : rien n'est perdu.
            Récupère-les par sécurité, puis relance.
          </p>
          <div className="mt-5 space-y-2">
            <Btn full onClick={() => this.sauverDonnees()} icon={Download}>
              {this.state.exporte ? "Sauvegarde téléchargée" : "Sauvegarder mes données"}
            </Btn>
            <Btn full variant="ghost" onClick={() => this.setState({ erreur: null })}>Réessayer</Btn>
            <Btn full variant="ghost" onClick={() => window.location.reload()} icon={RotateCcw}>Recharger l'application</Btn>
          </div>
          <details style={{ marginTop: 22 }}>
            <summary className="fit-eyebrow" style={{ cursor: "pointer" }}>Détail technique</summary>
            <pre className="fit-data" style={{ fontSize: 11, color: THEME.gris2, whiteSpace: "pre-wrap", marginTop: 8, lineHeight: 1.45 }}>
              {String(this.state.erreur?.stack || this.state.erreur).slice(0, 700)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

/* ==========================================================================
   COQUILLE DE L'APPLICATION
   ========================================================================== */

/* Chaque écran est mémoïsé : changer d'onglet ou taper dans un champ ne
   déclenche plus le rendu des cinq autres. */
const ECRANS = {
  dashboard: React.memo(Dashboard),
  nutrition: React.memo(Nutrition),
  entrainement: React.memo(Entrainement),
  coach: React.memo(Coach),
  courses: React.memo(Courses),
  profil: React.memo(Profil),
};

const TABS = [
  { id: "dashboard", l: "Aujourd'hui", i: Home },
  { id: "nutrition", l: "Nutrition", i: Apple },
  { id: "entrainement", l: "Séance", i: Dumbbell },
  { id: "coach", l: "Coach", i: MessageSquare },
  { id: "courses", l: "Courses", i: ShoppingCart },
  { id: "profil", l: "Profil", i: User },
];

export default function App() {
  return <FrontiereErreur><Application /></FrontiereErreur>;
}

function Application() {
  const [pret, setPret] = useState(false);
  const [tab, setTab] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      return ["dashboard", "nutrition", "entrainement", "coach", "courses", "profil"].includes(t) ? t : "dashboard";
    } catch { return "dashboard"; }
  });
  const [dateKey, setDateKey] = useState(todayKey());
  const [profil, setProfil] = useState(PROFIL_DEFAUT);
  const [poidsHist, setPoidsHist] = useState([]);
  const [journalMois, setJournalMois] = useState({});
  const [entrainement, setEntrainement] = useState({ programme: null, seances: [], historiqueCharges: {} });
  const [cuisine, setCuisine] = useState({ customFoods: [], barcodes: {}, frigo: [], favoris: [], courses: [], coches: [], recents: [] });
  const [chat, setChat] = useState({ messages: [], resume: "", tokens: { in: 0, out: 0 } });
  const [apiEtat, setApiEtat] = useState("ok");
  const [erreurStockage, setErreurStockage] = useState(false);
  const [reglages, setReglages] = useState({ cle: "", proxy: "", notifications: "default" });
  const [apiDiag, setApiDiag] = useState("");
  const [installe, setInstalle] = useState(estInstalle());

  useEffect(() => {
    setInstalle(estInstalle());
    if (store.hote === "autonome" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }, []);

  const mois = moisDe(dateKey);
  const jour = useMemo(() => journalMois[dateKey] || JOUR_VIDE(), [journalMois, dateKey]);
  const setJour = useCallback((j) => setJournalMois((m) => ({ ...m, [dateKey]: j })), [dateKey]);

  /* Chargement initial — clés groupées par domaine pour limiter les appels */
  useEffect(() => {
    (async () => {
      try {
        const brut = await Promise.all([
          store.get("profil"), store.get("entrainement"), store.get("cuisine"), store.get("chat"), store.get("reglages"),
        ]);
        const [pr, en, cu, ch, rg] = ["profil", "entrainement", "cuisine", "chat", "reglages"]
          .map((c, i) => (brut[i] ? migrer(c, brut[i]) : null));
        if (rg) setReglages((r) => ({ ...r, ...rg }));
        if (pr) { setProfil({ ...PROFIL_DEFAUT, ...pr.profil }); setPoidsHist(pr.poidsHist || []); }
        if (en) {
          // Les séances vivent dans des partitions trimestrielles ; la clé
          // principale ne porte plus que le programme et l'historique de charges.
          const partitions = (await store.liste("seances:")) || [];
          const anciennes = Array.isArray(en.seances) ? en.seances : [];
          const chargees = [];
          for (const c of partitions) {
            const bloc = await store.get(c);
            if (Array.isArray(bloc?.seances)) chargees.push(...bloc.seances);
          }
          const parCle = new Map();
          [...anciennes, ...chargees].forEach((sc) => parCle.set(sc.date + "|" + sc.jourKey, sc));
          const e2 = { programme: null, historiqueCharges: {}, ...en, seances: [...parCle.values()].sort((a, b) => a.date.localeCompare(b.date)) };
          // La base d'exercices a pu évoluer : un programme qui référence des
          // identifiants disparus est régénéré au lieu de planter.
          const valide = !e2.programme || e2.programme.seances?.every((sc) => sc.exos.every((x) => exById(x.exId)));
          if (!valide) e2.programme = null;
          setEntrainement(e2);
        }
        if (cu) setCuisine((c) => ({ ...c, ...cu }));
        if (ch) setChat((c) => ({ ...c, ...ch }));
        const j = await store.get(`journal:${moisDe(todayKey())}`);
        if (j) setJournalMois(j);
      } catch (e) {
        console.error("Chargement partiel", e);
      } finally { setPret(true); }
    })();
  }, []);

  /* Chargement du mois quand on navigue dans le calendrier */
  const moisCharges = useRef(new Set([moisDe(todayKey())]));
  useEffect(() => {
    if (!pret || moisCharges.current.has(mois)) return;
    moisCharges.current.add(mois);
    store.get(`journal:${mois}`).then((j) => { if (j) setJournalMois((m) => ({ ...j, ...m })); });
  }, [mois, pret]);

  /* Sauvegardes groupées et différées */
  const useSave = (key, value, deps) => {
    const first = useRef(true);
    // La valeur passe par une ref : le tableau de dependances reste explicite
    // et verifiable, sans refermer sur une valeur perimee.
    const valRef = useRef(value); valRef.current = value;
    const cleRef = useRef(key); cleRef.current = key;
    useEffect(() => {
      if (!pret) return;
      if (first.current) { first.current = false; return; }
      const t = setTimeout(async () => {
        const charge = valRef.current;
        const marque = charge && typeof charge === "object" && !Array.isArray(charge)
          ? { ...charge, __schema: SCHEMA } : charge;
        const ok = await store.set(cleRef.current, marque);
        // On ne signale que la perte réelle de persistance : un échec isolé est
        // absorbé par la mémoire de session sans inquiéter inutilement.
        setErreurStockage(!ok && store.diag.mode === "memoire");
      }, 900);
      return () => clearTimeout(t);
      // Les dépendances sont fournies par l'appelant, avec une liste fixe et un
      // ordre d'appel constant. La valeur et la clé transitant par des refs,
      // l'effet ne peut pas se refermer sur une donnée périmée.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
  };
  useSave("profil", { profil, poidsHist }, [profil, poidsHist, pret]);
  // La clé d'entraînement ne porte plus les séances : elles sont écrites dans
  // leur partition trimestrielle, ce qui divise par cinquante le volume
  // sérialisé entre deux séries après plusieurs années d'usage.
  const entrainementLeger = useMemo(
    () => ({ programme: entrainement.programme, historiqueCharges: entrainement.historiqueCharges, partitionne: true }),
    [entrainement.programme, entrainement.historiqueCharges]);
  useSave("entrainement", entrainementLeger, [entrainementLeger, pret]);

  const trimestreCourant = trimestreDe(dateKey);
  const seancesDuTrimestre = useMemo(
    () => ({ seances: entrainement.seances.filter((sc) => trimestreDe(sc.date) === trimestreCourant) }),
    [entrainement.seances, trimestreCourant]);
  useSave(`seances:${trimestreCourant}`, seancesDuTrimestre, [seancesDuTrimestre, trimestreCourant, pret]);
  useSave("cuisine", cuisine, [cuisine, pret]);
  useSave("chat", chat, [chat, pret]);
  useSave("reglages", reglages, [reglages, pret]);
  useSave(`journal:${mois}`, Object.fromEntries(Object.entries(journalMois).filter(([k]) => moisDe(k) === mois)), [journalMois, mois, pret]);

  /* Appel au modèle — contexte maîtrisé, erreurs gérées proprement */
  const appelClaude = useCallback(async (messages, systeme, opts = {}) => {
    const direct = "https://api.anthropic.com/v1/messages";
    try {
      // Dans l'atelier Claude, l'appel passe sans authentification. En autonome,
      // il faut soit un proxy (recommandé), soit une clé stockée sur l'appareil.
      const proxy = (reglages.proxy || "").trim().replace(/\/$/, "");
      const url = store.hote === "artefact" ? direct : (proxy || direct);
      const headers = { "Content-Type": "application/json" };
      if (store.hote !== "artefact" && !proxy) {
        if (!reglages.cle) { setApiEtat("sansCle"); return null; }
        headers["x-api-key"] = reglages.cle.trim();
        headers["anthropic-version"] = "2023-06-01";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      }
      const r = await fetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: opts.maxTokens || 1000, system: systeme, messages }),
      });
      if (!r.ok) {
        let detail = "";
        try { const e = await r.json(); detail = e?.error?.message || ""; } catch (x) { /* corps illisible */ }
        const diag = r.status === 401 ? "Clé refusée (401). Vérifie la clé, ou la variable CLE_ANTHROPIC du proxy."
          : r.status === 403 ? "Accès refusé (403). Le proxy n'autorise probablement pas l'adresse de ton site : vérifie ORIGINES_AUTORISEES dans worker.js."
          : r.status === 404 ? "Adresse introuvable (404). L'adresse du proxy est incorrecte."
          : r.status === 429 ? "Trop de requêtes (429). Attends une minute."
          : r.status >= 500 ? `Erreur côté serveur (${r.status}).`
          : `Réponse inattendue (${r.status}).`;
        setApiEtat("hs"); setApiDiag(detail ? `${diag} — ${detail}` : diag);
        return null;
      }
      const d = await r.json();
      if (d.usage) setChat((c) => ({ ...c, tokens: { in: (c.tokens?.in || 0) + (d.usage.input_tokens || 0), out: (c.tokens?.out || 0) + (d.usage.output_tokens || 0) } }));
      setApiEtat("ok"); setApiDiag("");
      return (d.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n").trim();
    } catch (e) {
      setApiEtat("hs");
      setApiDiag(store.hote === "artefact" ? "Réseau indisponible."
        : reglages.proxy
          ? "Impossible de joindre le proxy. Soit il est hors service, soit il ne renvoie pas les en-têtes CORS attendus : vérifie que ORIGINES_AUTORISEES contient exactement l'adresse de ton site, sans barre oblique finale."
          : "Impossible de joindre l'API depuis le navigateur. Sans proxy, Anthropic exige l'en-tête d'accès direct et la clé peut être bloquée par la politique de sécurité du navigateur. Le proxy est le chemin fiable.");
      return null;
    }
  }, [reglages]);

  const [restauration, setRestauration] = useState(null);

  /* Sauvegarde intégrale : toutes les clés, y compris les partitions, avec le
     numéro de schéma. C'est le seul filet contre un téléphone perdu ou un cache
     purgé par iOS — l'export partiel ne suffisait pas. */
  const sauvegarder = useCallback(async () => {
    const cles = [...new Set(["profil", "entrainement", "cuisine", "chat", "reglages", ...(await store.liste(""))])];
    const data = {};
    for (const c of cles) { const v = await store.get(c); if (v != null) data[c] = v; }
    const paquet = { application: "wonna-grow-up", schema: SCHEMA, le: new Date().toISOString(), data };
    const url = URL.createObjectURL(new Blob([JSON.stringify(paquet, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `wonna-grow-up-sauvegarde-${todayKey()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    setReglages((r) => ({ ...r, derniereSauvegarde: new Date().toISOString() }));
    haptic(16);
  }, []);

  const restaurer = useCallback(async (fichier) => {
    try {
      const texte = await fichier.text();
      const paquet = JSON.parse(texte);
      if (paquet.application !== "wonna-grow-up" || !paquet.data) throw new Error("Ce fichier n'est pas une sauvegarde de l'application.");
      let n = 0;
      for (const [c, v] of Object.entries(paquet.data)) { await store.set(c, migrer(c, v)); n++; }
      setRestauration({ ok: true, n });
      setTimeout(() => window.location.reload(), 1400);
    } catch (e) {
      setRestauration({ ok: false, msg: String(e?.message || e) });
    }
  }, []);

  const exporter = useCallback((format) => {
    const data = { profil, poidsHist, journal: journalMois, entrainement, cuisine, exporteLe: new Date().toISOString() };
    let contenu, type, nom;
    if (format === "csv") {
      const lignes = ["date;repas;aliment;grammes;kcal;proteines;glucides;lipides;fibres"];
      Object.entries(journalMois).forEach(([d, j]) => Object.entries(j.repas || {}).forEach(([r, items]) =>
        items.forEach((it) => { const f = it.g / 100;
          lignes.push([d, r, it.nom.replace(/;/g, ","), it.g, Math.round(it.kcal100 * f), Math.round(it.prot100 * f), Math.round(it.gluc100 * f), Math.round(it.lip100 * f), Math.round((it.fibres100 || 0) * f)].join(";")); })));
      contenu = lignes.join("\n"); type = "text/csv"; nom = "fit-journal.csv";
    } else { contenu = JSON.stringify(data, null, 2); type = "application/json"; nom = "fit-donnees.json"; }
    const url = URL.createObjectURL(new Blob([contenu], { type }));
    const a = document.createElement("a"); a.href = url; a.download = nom; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000); haptic(14);
  }, [profil, poidsHist, journalMois, entrainement, cuisine]);

  const reinitialiser = useCallback(async () => {
    await Promise.all([store.del("profil"), store.del("entrainement"), store.del("cuisine"), store.del("chat"), store.del("reglages"), store.del(`journal:${mois}`)]);
    setProfil(PROFIL_DEFAUT); setPoidsHist([]); setJournalMois({});
    setEntrainement({ programme: null, seances: [], historiqueCharges: {} });
    setCuisine({ customFoods: [], barcodes: {}, frigo: [], favoris: [], courses: [], coches: [], recents: [] });
    setChat({ messages: [], resume: "", tokens: { in: 0, out: 0 } });
  }, [mois]);

  // L'objet de contexte était recréé à chaque rendu et passé à tous les écrans :
  // une frappe dans un champ de recherche re-rendait la scène 3D et les
  // graphiques. Le figer ici coupe la propagation à la racine.
  const app = useMemo(() => ({
    profil, setProfil, poidsHist, setPoidsHist, jour, setJour, dateKey, setDateKey,
    journalMois, entrainement, setEntrainement, cuisine, setCuisine, chat, setChat,
    appelClaude, apiEtat, exporter, reinitialiser, aller: setTab,
    reglages, setReglages, installe, apiDiag,
    sauvegarder, restaurer, restauration,
  }), [profil, poidsHist, jour, setJour, dateKey, journalMois, entrainement, cuisine, chat,
       appelClaude, apiEtat, exporter, reinitialiser, reglages, installe, apiDiag,
       sauvegarder, restaurer, restauration]);

  if (!pret) return <EcranLancement />;

  if (!profil.onboarde) {
    return (
      <div className="fit-root">
        <style>{CSS}</style>
        <Onboarding profil={profil} setProfil={setProfil} app={app} terminer={() => {
          setProfil({ ...profil, onboarde: true });
          setPoidsHist([{ d: todayKey(), poids: profil.poids }]);
          setEntrainement((e) => ({ ...e, programme: genererProgramme({ ...profil, onboarde: true }, null, 1) }));
        }} />
      </div>
    );
  }

  const Ecran = ECRANS[tab];

  return (
    <div className="fit-root">
      <style>{CSS}</style>

      {/* En-tête : le nom de l'app et l'état du jour, hors îlot dynamique */}
      <header className="sticky top-0 z-30" style={{ background: "rgba(0,0,0,.9)", backdropFilter: "blur(14px)", paddingTop: "env(safe-area-inset-top)" }}>
        <div className="flex items-center justify-between px-5" style={{ height: 52 }}>
          <button onClick={() => { haptic(); setTab("dashboard"); }} className="flex items-center gap-2.5">
            <Glyphe taille={22} />
            <span className="fit-display" style={{ fontSize: 13, letterSpacing: "0.10em", lineHeight: 1 }}>WONNA GROW UP</span>
          </button>
          <div className="flex items-center gap-2">
            {apiEtat === "hs" && <span className="fit-eyebrow" style={{ color: THEME.jaune }}>Coach hors ligne</span>}
            {apiEtat === "sansCle" && <button className="fit-eyebrow" onClick={() => setTab("profil")} style={{ color: THEME.jaune }}>Coach à connecter</button>}
            {erreurStockage && <button className="fit-eyebrow" onClick={() => setTab("profil")} style={{ color: THEME.jaune }}>Sauvegarde en mémoire</button>}
            {profil.prenom && apiEtat === "ok" && !erreurStockage &&
              <span className="fit-eyebrow">{profil.prenom}</span>}
          </div>
        </div>
        <div style={{ height: 1, background: `linear-gradient(90deg, ${THEME.rule}, ${THEME.rule} 60%, transparent)` }} />
      </header>

      <main key={tab} className="fit-scroll fit-ecran relative z-10" style={{ paddingBottom: "calc(82px + env(safe-area-inset-bottom))" }}>
        {/* Une erreur dans un écran ne fait plus tomber la navigation : les
            autres onglets et la sauvegarde restent accessibles. */}
        <FrontiereErreur key={tab}><Ecran app={app} /></FrontiereErreur>
      </main>

      {/* Barre d'onglets : accessible au pouce, 44 points minimum, au-dessus de la barre d'accueil */}
      <nav className="fixed bottom-0 left-0 right-0 z-40" aria-label="Navigation principale" style={{
        background: "rgba(6,6,7,.93)", backdropFilter: "blur(18px)", borderTop: `1px solid ${THEME.rule}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        <div className="grid grid-cols-6 relative">
          <span style={{ position: "absolute", top: 0, left: `calc(${TABS.findIndex((t) => t.id === tab)} * 100% / 6 + 100% / 12 - 13px)`,
            width: 26, height: 2.5, background: THEME.craie, borderRadius: 2,
            transition: "left .28s cubic-bezier(.2,.8,.2,1)" }} />
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => { haptic(); setTab(t.id); }} className="fit-tap flex flex-col items-center justify-center gap-1"
                aria-current={on ? "page" : undefined} aria-label={t.l}
                style={{ color: on ? THEME.craie : THEME.gris2, paddingTop: 9, paddingBottom: 7 }}>
                <t.i size={19} strokeWidth={on ? 2.4 : 1.7} aria-hidden="true" />
                <span className="fit-eyebrow" style={{ fontSize: 11, color: on ? THEME.craie : THEME.gris2, letterSpacing: ".07em" }}>{t.l}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
