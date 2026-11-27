import { useEffect, useState, type ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { SEUIL_FROID, SEUIL_HUMIDITE, SEUIL_TEMPERATURE } from './config';
import type { Etat, Mesures } from './types';

// ---------- Historique ----------
export type Point = { t: number; temperature: number; humidite: number; chauffage: boolean; fenetre: boolean; vmc: boolean };

const MAX_POINTS = 300; // 10 min en démo (2 s), 50 min avec l'objet (10 s)

// Garde les dernières mesures en mémoire, avec l'état des équipements au même instant.
// ponytail: mémoire seulement, l'historique repart à zéro au redémarrage ; lire l'API du back-end si besoin de plus.
export function useHistorique(mesures: Mesures | null, recuA: Date | null, etat: Etat | null): Point[] {
  const [points, setPoints] = useState<Point[]>([]);
  const t = recuA?.getTime() ?? null;
  useEffect(() => {
    if (t === null || mesures === null) return;
    setPoints((p) => {
      if (p.length && p[p.length - 1].t === t) return p;
      const point: Point = {
        t,
        temperature: mesures.temperature,
        humidite: mesures.humidite,
        chauffage: etat?.chauffage === 'allume',
        fenetre: etat?.fenetre === 'ouverte',
        vmc: etat?.vmc === 'allumee',
      };
      return [...p, point].slice(-MAX_POINTS);
    });
    // Un point par mesure reçue : seul l'horodatage déclenche l'ajout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  return points;
}

// ---------- Couleurs ----------
const C = {
  texte: '#17211F',
  discret: '#5A6865',
  grille: '#E6EBE9',
  fond: '#F7F9F8',
  froid: '#1565C0',
  chaud: '#B3261E',
  humidite: '#2B7BB9',
  // Validées (scripts dataviz) : séparables pour les daltoniens, chaque ligne porte aussi son nom.
  chauffage: '#E8710A',
  fenetre: '#3B82C4',
  vmc: '#10A37F',
};

// Échelle de couleur de la température : du bleu glacial au rouge, vert au confort.
const ECHELLE_T: [number, string][] = [
  [SEUIL_TEMPERATURE + 3, '#B71C1C'],
  [SEUIL_TEMPERATURE, '#E4572E'],
  [SEUIL_TEMPERATURE - 3, '#F29F05'],
  [SEUIL_FROID + 2, '#22A06B'],
  [SEUIL_FROID, '#3D8FD6'],
  [SEUIL_FROID - 2, '#1F4FB5'],
];

// Zones de fond, du haut vers le bas.
const ZONES = [
  { de: SEUIL_TEMPERATURE, a: 99, nom: 'Trop chaud', couleur: '#FBE3DE' },
  { de: SEUIL_TEMPERATURE - 3, a: SEUIL_TEMPERATURE, nom: 'Chaud', couleur: '#FEF1DF' },
  { de: SEUIL_FROID, a: SEUIL_TEMPERATURE - 3, nom: 'Confort', couleur: '#E9F6F0' },
  { de: -99, a: SEUIL_FROID, nom: 'Froid', couleur: '#E3EEFB' },
];

const couleurTemperature = (v: number) =>
  v < SEUIL_FROID ? C.froid : v >= SEUIL_TEMPERATURE ? C.chaud : v >= SEUIL_TEMPERATURE - 3 ? '#C46A00' : '#1E7D62';

// ---------- Géométrie ----------
// Sur le web, le texte SVG retomberait sur une police à empattements.
const POLICE = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, sans-serif' : undefined;
const MARGE = { gauche: 36, droite: 12 };
const Y_T = 14; // haut de la courbe de température
const H_T = 170;
const Y_H = Y_T + H_T + 40; // haut de la courbe d'humidité
const H_H = 80;
const Y_E = Y_H + H_H + 34; // haut des lignes d'équipements
const H_BANDE = 14;
const ECART_BANDE = 6;
const EQUIPEMENTS = [
  { cle: 'chauffage', nom: 'Chauffage', court: 'Chauf.', on: 'allumé', off: 'éteint', couleur: C.chauffage },
  { cle: 'fenetre', nom: 'Fenêtre', court: 'Fen.', on: 'ouverte', off: 'fermée', couleur: C.fenetre },
  { cle: 'vmc', nom: 'VMC', court: 'VMC', on: 'allumée', off: 'coupée', couleur: C.vmc },
] as const;
type CleEquipement = (typeof EQUIPEMENTS)[number]['cle'];
const H_TOTAL = Y_E + EQUIPEMENTS.length * (H_BANDE + ECART_BANDE) + 4;

const PERIODES = [
  { nom: '1 min', ms: 60_000 },
  { nom: '5 min', ms: 300_000 },
  { nom: 'Tout', ms: Infinity },
] as const;

const heure = (t: number) => new Date(t).toLocaleTimeString('fr-FR');
const heureCourte = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Graduations « rondes » couvrant le domaine.
function graduations(min: number, max: number, nbMax = 5): number[] {
  const pas = [0.5, 1, 2, 5, 10, 20].find((p) => (max - min) / p <= nbMax) ?? 20;
  const liste: number[] = [];
  for (let v = Math.ceil(min / pas) * pas; v <= max + 1e-9; v += pas) liste.push(Math.round(v * 10) / 10);
  return liste;
}

// Pente par moindres carrés, en °C par minute.
function tendance(points: Point[]): number {
  const n = points.length;
  if (n < 3) return 0;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 60_000);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = points.reduce((a, p) => a + p.temperature, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (xs[i] - mx) * (p.temperature - my);
    den += (xs[i] - mx) ** 2;
  });
  return den ? num / den : 0;
}

type Evenement = { t: number; i: number; cle: CleEquipement; actif: boolean };

function evenements(points: Point[]): Evenement[] {
  const liste: Evenement[] = [];
  for (let i = 1; i < points.length; i++) {
    for (const { cle } of EQUIPEMENTS) {
      if (points[i][cle] !== points[i - 1][cle]) liste.push({ t: points[i].t, i, cle, actif: points[i][cle] });
    }
  }
  return liste;
}

// ---------- Indicateur ----------
function Indicateur({ libelle, valeur, detail, couleur }: { libelle: string; valeur: string; detail?: string; couleur: string }) {
  return (
    <View style={styles.indicateur}>
      <View style={styles.indicateurTete}>
        <View style={[styles.pastille, { backgroundColor: couleur }]} />
        <Text style={styles.indicateurLibelle}>{libelle}</Text>
      </View>
      <Text style={styles.indicateurValeur}>{valeur}</Text>
      {detail ? <Text style={styles.indicateurDetail}>{detail}</Text> : null}
    </View>
  );
}

// ---------- Graphique ----------
export function GraphiqueTemperature({ points: tous }: { points: Point[] }) {
  const [largeur, setLargeur] = useState(0);
  const [survol, setSurvol] = useState<number | null>(null);
  const [periode, setPeriode] = useState<number>(PERIODES[1].ms);

  if (tous.length < 2) {
    return <Text style={styles.vide}>Le graphique apparaît après deux mesures.</Text>;
  }

  const fin = tous[tous.length - 1].t;
  const points = tous.filter((p) => p.t >= fin - periode);
  const n = points.length;
  const temps = points.map((p) => p.temperature);
  const hums = points.map((p) => p.humidite);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const moyenne = temps.reduce((a, b) => a + b, 0) / n;
  const pente = tendance(points.slice(-15));
  const confort = Math.round((points.filter((p) => p.temperature >= SEUIL_FROID && p.temperature < SEUIL_TEMPERATURE).length / n) * 100);
  const part = (cle: CleEquipement) => Math.round((points.filter((q) => q[cle]).length / n) * 100);
  const journal = evenements(points);
  const dernier = points[n - 1];

  // Domaines : la zone de confort reste visible, et le domaine s'étend aux seuils quand on s'en approche.
  const yMin = Math.floor(Math.min(tMin, SEUIL_FROID - 1)) - 0.5;
  const yMax = Math.ceil(Math.max(tMax, SEUIL_FROID + 4)) + 0.5;
  const hMin = Math.max(0, Math.floor(Math.min(...hums, SEUIL_HUMIDITE - 15) / 5) * 5);
  const hMax = Math.min(100, Math.ceil(Math.max(...hums, SEUIL_HUMIDITE + 3) / 5) * 5);

  const l = Math.max(1, largeur - MARGE.gauche - MARGE.droite);
  const debut = points[0].t;
  const duree = Math.max(1, fin - debut);
  const x = (t: number) => MARGE.gauche + ((t - debut) / duree) * l;
  const yT = (v: number) => Y_T + ((yMax - v) / (yMax - yMin)) * H_T;
  const yH = (v: number) => Y_H + ((hMax - v) / (hMax - hMin)) * H_H;

  const traceT = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${yT(p.temperature).toFixed(1)}`).join(' ');
  const aireT = `${traceT} L${x(fin)},${Y_T + H_T} L${x(debut)},${Y_T + H_T} Z`;
  const traceH = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${yH(p.humidite).toFixed(1)}`).join(' ');
  const aireH = `${traceH} L${x(fin)},${Y_H + H_H} L${x(debut)},${Y_H + H_H} Z`;
  const iMin = temps.indexOf(tMin);
  const iMax = temps.indexOf(tMax);

  const toucher = (px: number) => {
    const t = debut + ((px - MARGE.gauche) / l) * duree;
    let meilleur = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - t) < Math.abs(points[meilleur].t - t)) meilleur = i;
    });
    setSurvol(meilleur);
  };
  const p = survol !== null && survol < n ? points[survol] : null;
  const ticksX = [0, 1 / 3, 2 / 3, 1].map((f) => debut + f * duree);

  const resume =
    `Température de ${tMin.toFixed(1)} à ${tMax.toFixed(1)} °C, moyenne ${moyenne.toFixed(1)} °C, ` +
    `${confort} % du temps au confort. Humidité de ${Math.min(...hums).toFixed(0)} à ${Math.max(...hums).toFixed(0)} %. ` +
    EQUIPEMENTS.map((e) => `${e.nom} ${e.on} ${part(e.cle)} % du temps`).join(', ') +
    '.';

  // Texte d'axe : police, taille et couleur par défaut, surchargeables.
  const texte = ({ key, ...props }: ComponentProps<typeof SvgText> & { key?: number }) => (
    <SvgText key={key} fontFamily={POLICE} fontSize={10} fill={C.discret} {...props} />
  );

  return (
    <View style={styles.racine}>
      {/* Période affichée */}
      <View style={styles.periodes} accessibilityRole="radiogroup">
        {PERIODES.map((pe) => {
          const actif = periode === pe.ms;
          return (
            <Pressable
              key={pe.nom}
              accessibilityRole="radio"
              accessibilityState={{ selected: actif }}
              onPress={() => setPeriode(pe.ms)}
              style={[styles.puce, actif && styles.puceActive]}
            >
              <Text style={[styles.puceTexte, actif && styles.puceTexteActive]}>{pe.nom}</Text>
            </Pressable>
          );
        })}
        <Text style={styles.nbMesures}>{n} mesures</Text>
      </View>

      {/* Indicateurs */}
      <View style={styles.indicateurs}>
        <Indicateur libelle="Actuelle" valeur={`${dernier.temperature.toFixed(1)} °C`} couleur={couleurTemperature(dernier.temperature)} />
        <Indicateur libelle="Minimum" valeur={`${tMin.toFixed(1)} °C`} detail={heureCourte(points[iMin].t)} couleur={couleurTemperature(tMin)} />
        <Indicateur libelle="Maximum" valeur={`${tMax.toFixed(1)} °C`} detail={heureCourte(points[iMax].t)} couleur={couleurTemperature(tMax)} />
        <Indicateur libelle="Moyenne" valeur={`${moyenne.toFixed(1)} °C`} couleur={couleurTemperature(moyenne)} />
        <Indicateur
          libelle="Tendance"
          valeur={`${pente > 0.05 ? '↗' : pente < -0.05 ? '↘' : '→'} ${pente >= 0 ? '+' : ''}${pente.toFixed(2)}`}
          detail="°C par minute"
          couleur={pente > 0.05 ? C.chaud : pente < -0.05 ? C.froid : C.discret}
        />
        <Indicateur libelle="Au confort" valeur={`${confort} %`} detail={`${SEUIL_FROID}–${SEUIL_TEMPERATURE} °C`} couleur="#1E7D62" />
      </View>

      <View
        style={{ height: H_TOTAL }}
        onLayout={(e) => setLargeur(e.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={`Graphiques de la pièce. ${resume}`}
        // Toucher ou glisser : détail du moment choisi. Un défilement vertical reprend la main.
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => toucher(e.nativeEvent.locationX)}
        onResponderMove={(e) => toucher(e.nativeEvent.locationX)}
        onResponderRelease={() => setSurvol(null)}
        onResponderTerminate={() => setSurvol(null)}
        onResponderTerminationRequest={() => true}
      >
        {largeur > 0 && (
          <Svg width={largeur} height={H_TOTAL}>
            <Defs>
              {/* La couleur de la courbe suit la température, au même niveau que l'axe */}
              <LinearGradient id="degradeT" gradientUnits="userSpaceOnUse" x1="0" y1={Y_T} x2="0" y2={Y_T + H_T}>
                {ECHELLE_T.map(([v, c]) => (
                  <Stop key={v} offset={borner((yMax - v) / (yMax - yMin), 0, 1)} stopColor={c} />
                ))}
              </LinearGradient>
              <LinearGradient id="aireT" gradientUnits="userSpaceOnUse" x1="0" y1={Y_T} x2="0" y2={Y_T + H_T}>
                {ECHELLE_T.map(([v, c]) => (
                  <Stop key={v} offset={borner((yMax - v) / (yMax - yMin), 0, 1)} stopColor={c} stopOpacity={0.22} />
                ))}
              </LinearGradient>
              <LinearGradient id="aireH" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={C.humidite} stopOpacity={0.35} />
                <Stop offset="1" stopColor={C.humidite} stopOpacity={0.03} />
              </LinearGradient>
            </Defs>

            {/* ===== Température ===== */}
            {texte({ x: MARGE.gauche, y: Y_T - 4, fontSize: 11, fontWeight: '700', fill: C.texte, children: 'Température (°C)' })}
            {ZONES.map((z) => {
              const haut = yT(Math.min(z.a, yMax));
              const bas = yT(Math.max(z.de, yMin));
              if (bas - haut <= 0) return null;
              return (
                <G key={z.nom}>
                  <Rect x={MARGE.gauche} y={haut} width={l} height={bas - haut} fill={z.couleur} />
                  {bas - haut > 14 &&
                    texte({ x: MARGE.gauche + l - 4, y: bas - 4, textAnchor: 'end', fontSize: 9, fontWeight: '600', fill: C.discret, children: z.nom })}
                </G>
              );
            })}
            {graduations(yMin, yMax).map((v) => (
              <G key={v}>
                <Line x1={MARGE.gauche} x2={MARGE.gauche + l} y1={yT(v)} y2={yT(v)} stroke="#FFFFFF" strokeWidth={1} opacity={0.9} />
                {texte({ x: MARGE.gauche - 6, y: yT(v) + 3.5, textAnchor: 'end', children: `${v}°` })}
              </G>
            ))}
            {/* Seuils du mode auto */}
            {[
              { v: SEUIL_FROID, nom: `chauffage < ${SEUIL_FROID}°`, c: C.froid },
              { v: SEUIL_FROID + 2, nom: `coupure ${SEUIL_FROID + 2}°`, c: C.chauffage },
              { v: SEUIL_TEMPERATURE, nom: `fenêtre ≥ ${SEUIL_TEMPERATURE}°`, c: C.chaud },
            ]
              .filter((s) => s.v > yMin && s.v < yMax)
              .map((s) => (
                <G key={s.v}>
                  <Line x1={MARGE.gauche} x2={MARGE.gauche + l} y1={yT(s.v)} y2={yT(s.v)} stroke={s.c} strokeWidth={1} strokeDasharray="4,3" opacity={0.8} />
                  {texte({ x: MARGE.gauche + 4, y: yT(s.v) - 3, fontSize: 9, fill: C.discret, children: s.nom })}
                </G>
              ))}
            {/* Périodes de chauffe en filigrane derrière la courbe */}
            {points.map((q, i) =>
              q.chauffage && i < n - 1 ? (
                <Rect key={i} x={x(q.t)} y={Y_T + H_T - 4} width={x(points[i + 1].t) - x(q.t) + 0.5} height={4} fill={C.chauffage} opacity={0.7} />
              ) : null,
            )}
            <Path d={aireT} fill="url(#aireT)" />
            <Path d={traceT} stroke="url(#degradeT)" strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {/* Changements d'état des équipements : repères verticaux */}
            {journal.map((ev, k) => {
              const eq = EQUIPEMENTS.find((e) => e.cle === ev.cle)!;
              const xe = x(ev.t);
              return (
                <G key={k}>
                  <Line x1={xe} x2={xe} y1={Y_T} y2={Y_T + H_T} stroke={eq.couleur} strokeWidth={1} strokeDasharray="2,3" opacity={0.7} />
                  <Circle cx={xe} cy={Y_T + 5} r={4} fill={ev.actif ? eq.couleur : '#FFFFFF'} stroke={eq.couleur} strokeWidth={1.5} />
                </G>
              );
            })}
            {/* Minimum et maximum */}
            {[
              { i: iMax, v: tMax, dy: -8 },
              { i: iMin, v: tMin, dy: 15 },
            ].map(({ i, v, dy }, k) => (
              <G key={k}>
                <Circle cx={x(points[i].t)} cy={yT(v)} r={3.5} fill="#FFFFFF" stroke={couleurTemperature(v)} strokeWidth={2} />
                {texte({
                  x: borner(x(points[i].t), MARGE.gauche + 14, MARGE.gauche + l - 14),
                  y: yT(v) + dy,
                  textAnchor: 'middle',
                  fontSize: 9,
                  fontWeight: '700',
                  fill: C.texte,
                  children: `${k ? 'min' : 'max'} ${v.toFixed(1)}°`,
                })}
              </G>
            ))}
            {survol === null && (
              <Circle cx={x(fin)} cy={yT(dernier.temperature)} r={4.5} fill={couleurTemperature(dernier.temperature)} stroke="#FFFFFF" strokeWidth={2} />
            )}
            {/* Axe du temps */}
            {ticksX.map((t, k) =>
              texte({ key: k, x: x(t), y: Y_T + H_T + 13, textAnchor: k === 0 ? 'start' : k === 3 ? 'end' : 'middle', children: heureCourte(t) }),
            )}

            {/* ===== Humidité ===== */}
            {texte({ x: MARGE.gauche, y: Y_H - 6, fontSize: 11, fontWeight: '700', fill: C.texte, children: 'Humidité (%)' })}
            <Rect x={MARGE.gauche} y={Y_H} width={l} height={H_H} fill={C.fond} />
            {hMax > SEUIL_HUMIDITE && (
              <G>
                <Rect x={MARGE.gauche} y={Y_H} width={l} height={yH(SEUIL_HUMIDITE) - Y_H} fill="#E3EEFB" />
                {texte({ x: MARGE.gauche + l - 4, y: Y_H + 10, textAnchor: 'end', fontSize: 9, fontWeight: '600', children: 'Trop humide' })}
              </G>
            )}
            {graduations(hMin, hMax, 3).map((v) => (
              <G key={v}>
                <Line x1={MARGE.gauche} x2={MARGE.gauche + l} y1={yH(v)} y2={yH(v)} stroke={C.grille} strokeWidth={1} />
                {texte({ x: MARGE.gauche - 6, y: yH(v) + 3.5, textAnchor: 'end', children: `${v}%` })}
              </G>
            ))}
            {[
              { v: SEUIL_HUMIDITE, nom: `VMC ≥ ${SEUIL_HUMIDITE} %` },
              { v: SEUIL_HUMIDITE - 10, nom: `coupure ${SEUIL_HUMIDITE - 10} %` },
            ]
              .filter((s) => s.v > hMin && s.v < hMax)
              .map((s) => (
                <G key={s.v}>
                  <Line x1={MARGE.gauche} x2={MARGE.gauche + l} y1={yH(s.v)} y2={yH(s.v)} stroke={C.vmc} strokeWidth={1} strokeDasharray="4,3" />
                  {texte({ x: MARGE.gauche + 4, y: yH(s.v) - 3, fontSize: 9, children: s.nom })}
                </G>
              ))}
            <Path d={aireH} fill="url(#aireH)" />
            <Path d={traceH} stroke={C.humidite} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {survol === null && <Circle cx={x(fin)} cy={yH(dernier.humidite)} r={4} fill={C.humidite} stroke="#FFFFFF" strokeWidth={2} />}

            {/* ===== Équipements ===== */}
            {texte({ x: MARGE.gauche, y: Y_E - 8, fontSize: 11, fontWeight: '700', fill: C.texte, children: 'Équipements' })}
            {EQUIPEMENTS.map(({ cle, court, couleur }, b) => {
              const yb = Y_E + b * (H_BANDE + ECART_BANDE);
              return (
                <G key={cle}>
                  {texte({ x: MARGE.gauche - 6, y: yb + 10, textAnchor: 'end', fontSize: 9, children: court })}
                  <Rect x={MARGE.gauche} y={yb} width={l} height={H_BANDE} rx={4} fill={C.grille} />
                  {points.map((q, i) =>
                    q[cle] && i < n - 1 ? (
                      <Rect key={i} x={x(q.t)} y={yb} width={x(points[i + 1].t) - x(q.t) + 0.5} height={H_BANDE} fill={couleur} />
                    ) : null,
                  )}
                </G>
              );
            })}

            {/* Repère du moment touché, sur les trois graphiques */}
            {p && (
              <G>
                <Line x1={x(p.t)} x2={x(p.t)} y1={Y_T} y2={H_TOTAL - 4} stroke={C.texte} strokeWidth={1} strokeDasharray="3,3" />
                <Circle cx={x(p.t)} cy={yT(p.temperature)} r={5} fill={couleurTemperature(p.temperature)} stroke="#FFFFFF" strokeWidth={2} />
                <Circle cx={x(p.t)} cy={yH(p.humidite)} r={4.5} fill={C.humidite} stroke="#FFFFFF" strokeWidth={2} />
              </G>
            )}
          </Svg>
        )}

        {p && (
          <View pointerEvents="none" style={[styles.bulle, x(p.t) > largeur / 2 ? { right: largeur - x(p.t) + 10 } : { left: x(p.t) + 10 }]}>
            <Text style={styles.bulleTitre}>{heure(p.t)}</Text>
            <View style={styles.bulleLigne}>
              <View style={[styles.pastille, { backgroundColor: couleurTemperature(p.temperature) }]} />
              <Text style={styles.bulleValeur}>{p.temperature.toFixed(1)} °C</Text>
            </View>
            <View style={styles.bulleLigne}>
              <View style={[styles.pastille, { backgroundColor: C.humidite }]} />
              <Text style={styles.bulleValeur}>{p.humidite.toFixed(1)} %</Text>
            </View>
            {EQUIPEMENTS.map((e) => (
              <View key={e.cle} style={styles.bulleLigne}>
                <View style={[styles.pastille, p[e.cle] ? { backgroundColor: e.couleur } : styles.pastilleVide]} />
                <Text style={styles.bulleDetail}>
                  {e.nom} {p[e.cle] ? e.on : e.off}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Légende avec temps de marche */}
      <View style={styles.legende}>
        {EQUIPEMENTS.map((e) => (
          <View key={e.cle} style={styles.legendeItem}>
            <View style={[styles.pastille, { backgroundColor: e.couleur }]} />
            <Text style={styles.legendeTexte}>
              {e.nom} {e.on} · <Text style={styles.gras}>{part(e.cle)} %</Text> du temps
            </Text>
          </View>
        ))}
        <View style={styles.legendeItem}>
          <View style={[styles.pastille, styles.pastilleVide]} />
          <Text style={styles.legendeTexte}>Repère : ● mise en marche, ○ arrêt</Text>
        </View>
      </View>

      {/* Journal des derniers changements */}
      <Text style={styles.journalTitre}>Journal</Text>
      {journal.length === 0 ? (
        <Text style={styles.legendeTexte}>Aucun changement d'état sur la période.</Text>
      ) : (
        journal
          .slice(-6)
          .reverse()
          .map((ev, k) => {
            const eq = EQUIPEMENTS.find((e) => e.cle === ev.cle)!;
            const q = points[ev.i];
            return (
              <View key={k} style={styles.journalLigne}>
                <Text style={styles.journalHeure}>{heureCourte(ev.t)}</Text>
                <View style={[styles.pastille, ev.actif ? { backgroundColor: eq.couleur } : [styles.pastilleVide, { borderColor: eq.couleur }]]} />
                <Text style={styles.journalTexte}>
                  {eq.nom} {ev.actif ? eq.on : eq.off}
                </Text>
                <Text style={styles.journalContexte}>
                  {q.temperature.toFixed(1)} °C · {q.humidite.toFixed(0)} %
                </Text>
              </View>
            );
          })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  racine: { gap: 12 },
  vide: { fontSize: 13, color: C.discret, paddingVertical: 24, textAlign: 'center' },
  periodes: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  puce: { paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: '#DDE3E1' },
  puceActive: { backgroundColor: C.texte, borderColor: C.texte },
  puceTexte: { fontSize: 13, fontWeight: '600', color: C.texte },
  puceTexteActive: { color: '#FFFFFF' },
  nbMesures: { marginLeft: 'auto', fontSize: 12, color: C.discret },
  indicateurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  indicateur: { flexGrow: 1, flexBasis: '30%', minWidth: 96, backgroundColor: C.fond, borderRadius: 10, padding: 10, gap: 2 },
  indicateurTete: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  indicateurLibelle: { fontSize: 11, fontWeight: '600', color: C.discret },
  indicateurValeur: { fontSize: 18, fontWeight: '700', color: C.texte, fontVariant: ['tabular-nums'] },
  indicateurDetail: { fontSize: 11, color: C.discret },
  pastille: { width: 10, height: 10, borderRadius: 3 },
  pastilleVide: { borderWidth: 1.5, borderColor: C.discret, backgroundColor: '#FFFFFF' },
  bulle: {
    position: 'absolute',
    top: Y_T + 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDE3E1',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  bulleTitre: { fontSize: 11, color: C.discret, marginBottom: 2 },
  bulleLigne: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bulleValeur: { fontSize: 14, fontWeight: '700', color: C.texte, fontVariant: ['tabular-nums'] },
  bulleDetail: { fontSize: 12, color: C.texte },
  legende: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendeTexte: { fontSize: 12, color: C.texte },
  gras: { fontWeight: '700' },
  journalTitre: { fontSize: 13, fontWeight: '700', color: C.texte, marginTop: 4 },
  journalLigne: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  journalHeure: { fontSize: 12, color: C.discret, fontVariant: ['tabular-nums'], width: 64 },
  journalTexte: { fontSize: 13, fontWeight: '600', color: C.texte, flex: 1 },
  journalContexte: { fontSize: 12, color: C.discret, fontVariant: ['tabular-nums'] },
});
