import { SEUIL_FROID, SEUIL_HUMIDITE, SEUIL_TEMPERATURE } from './config';
import type { Etat, Mesures } from './types';

// Hystérésis identiques au firmware (sketch.ino) : on ne bascule pas à chaque dixième de degré.
const FERMER_FENETRE = SEUIL_TEMPERATURE - 2; // 26 °C
const COUPER_VMC = SEUIL_HUMIDITE - 10; // 60 %
const COUPER_CHAUFFAGE = SEUIL_FROID + 2; // 21 °C

// Règle de sécurité, dans tous les modes : on ne chauffe pas fenêtre ouverte.
export function securiser(e: Etat): Etat {
  return e.fenetre === 'ouverte' && e.chauffage === 'allume' ? { ...e, chauffage: 'eteint' } : e;
}

// Décision du mode auto à partir de la dernière mesure.
export function decisionAuto({ temperature: t, humidite: h }: Mesures, e: Etat): Etat {
  let { fenetre, vmc, chauffage } = e;
  if (t >= SEUIL_TEMPERATURE) fenetre = 'ouverte';
  else if (t <= FERMER_FENETRE) fenetre = 'fermee';

  if (h >= SEUIL_HUMIDITE) vmc = 'allumee';
  else if (h <= COUPER_VMC) vmc = 'coupee';

  if (t < SEUIL_FROID) chauffage = 'allume';
  else if (t >= COUPER_CHAUFFAGE) chauffage = 'eteint';

  return securiser({ ...e, fenetre, vmc, chauffage });
}

// ---------- Simulation de la pièce (mode démo) ----------
export const EXTERIEUR = { temperature: 9, humidite: 75 }; // journée d'automne

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const arrondi = (v: number) => Math.round(v * 10) / 10;

// Un pas de simulation (≈ quelques minutes de temps réel, accéléré pour la démo).
// bruit : entre -1 et 1, pour que les courbes ne soient pas parfaitement lisses.
export function evoluer(m: Mesures, e: Etat, bruit = 0): Mesures {
  const ouverte = e.fenetre === 'ouverte';
  const ecartT = m.temperature - EXTERIEUR.temperature;
  const dT =
    (e.chauffage === 'allume' ? 0.45 : 0) - // radiateur
    ecartT * (ouverte ? 0.09 : 0.012) + // pertes : murs, et beaucoup plus fenêtre ouverte
    (e.vmc === 'allumee' ? -0.04 : 0) + // la VMC renouvelle l'air, donc le refroidit un peu
    bruit * 0.05;

  const dH =
    0.35 - // occupants, cuisine, douche…
    (e.vmc === 'allumee' ? (m.humidite - 35) * 0.07 : 0) -
    (ouverte ? (m.humidite - EXTERIEUR.humidite * 0.6) * 0.05 : 0) - // air extérieur, plus sec une fois réchauffé
    (e.chauffage === 'allume' ? 0.15 : 0) + // l'air chauffé est relativement plus sec
    bruit * 0.3;

  return {
    temperature: arrondi(borner(m.temperature + dT, -10, 45)),
    humidite: arrondi(borner(m.humidite + dH, 15, 99)),
  };
}
