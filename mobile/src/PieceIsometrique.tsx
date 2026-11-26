import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon } from 'react-native-svg';

import { SEUIL_HUMIDITE, SEUIL_TEMPERATURE } from './config';
import type { Etat, Mesures } from './types';

// ---------- Projection isométrique ----------
// Repère de la pièce : x vers la droite et le bas, y vers la gauche et le bas, z vers le haut.
// L'écran ne se redessine que lorsqu'une valeur change : pas de boucle de rendu continue (batterie).
const K = 16; // taille d'une unité à l'écran
const LARGEUR = 10; // x
const PROFONDEUR = 10; // y
const HAUTEUR = 7; // z
const EP = 0.4; // épaisseur des murs et du sol
const OX = 170;
const OY = 10 + HAUTEUR * K;
const VB_L = 340;
const VB_H = OY + (LARGEUR + PROFONDEUR) * (K / 2) + EP * K + 8;

type P3 = [number, number, number];
type Projection = (p: P3) => [number, number];

// Angle de vue autour de l'axe vertical : 45° = vue de face sur le coin.
// Entre 15° et 75°, les deux mêmes murs restent au fond : fenêtre et VMC toujours visibles.
const AZIMUT_DEFAUT = 45;
const AZIMUT_MIN = 15;
const AZIMUT_MAX = 75;
const DEGRES_PAR_PIXEL = 0.35;

// Rotation autour du centre du sol, puis projection : à 45°, on retrouve l'isométrie classique.
function creerProjection(azimutDeg: number): Projection {
  const a = (azimutDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const [cx, cy] = [LARGEUR / 2, PROFONDEUR / 2];
  return ([x, y, z]) => {
    const [u, v] = [x - cx, y - cy];
    return [
      OX + (u * cos - v * sin) * K * Math.SQRT2,
      OY + cy * K + ((u * sin + v * cos) * K * Math.SQRT2) / 2 - z * K,
    ];
  };
}

const points = (iso: Projection, liste: P3[]) => liste.map((p) => iso(p).join(',')).join(' ');

// ---------- Couleurs ----------
type RVB = [number, number, number];

const versRvb = (hex: string): RVB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RVB;
const versHex = (c: RVB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function melanger(a: string, b: string, t: number): string {
  const [ca, cb] = [versRvb(a), versRvb(b)];
  return versHex(ca.map((v, i) => v + (cb[i] - v) * t) as RVB);
}

const assombrir = (hex: string, t: number) => melanger(hex, '#000000', t);

// Teinte des murs : frais en bleu, neutre vers 22 °C, orange au seuil, rouge au-delà.
const PALIERS: [number, string][] = [
  [16, '#CFE0EE'],
  [22, '#EEE8DD'],
  [SEUIL_TEMPERATURE, '#F5C89B'],
  [SEUIL_TEMPERATURE + 4, '#EE9C8C'],
];

function couleurMur(temperature: number | null): string {
  if (temperature === null) return '#E4E7E6';
  if (temperature <= PALIERS[0][0]) return PALIERS[0][1];
  for (let i = 1; i < PALIERS.length; i++) {
    const [t1, c1] = PALIERS[i];
    if (temperature <= t1) {
      const [t0, c0] = PALIERS[i - 1];
      return melanger(c0, c1, (temperature - t0) / (t1 - t0));
    }
  }
  return PALIERS[PALIERS.length - 1][1];
}

// 0 en dessous de 15 points sous le seuil d'humidité, 1 au seuil et au-delà.
function niveauBuee(humidite: number | null): number {
  if (humidite === null) return 0;
  return Math.min(1, Math.max(0, (humidite - (SEUIL_HUMIDITE - 15)) / 15));
}

// ---------- Animation courte, seulement quand la cible change ----------
function useProgression(cible: number, dureeMs = 600): number {
  const [valeur, setValeur] = useState(cible);
  const actuelle = useRef(cible);

  useEffect(() => {
    const depart = actuelle.current;
    if (depart === cible) return;
    const debut = Date.now();
    let id = 0;
    const pas = () => {
      const p = Math.min(1, (Date.now() - debut) / dureeMs);
      const v = depart + (cible - depart) * (1 - (1 - p) ** 3);
      actuelle.current = v;
      setValeur(v);
      if (p < 1) id = requestAnimationFrame(pas);
    };
    id = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(id);
  }, [cible, dureeMs]);

  return valeur;
}

// ---------- Éléments ----------
function Boite({ iso, o, d, couleur }: { iso: Projection; o: P3; d: P3; couleur: string }) {
  const [x, y, z] = o;
  const [dx, dy, dz] = d;
  return (
    <G>
      <Polygon
        points={points(iso, [[x + dx, y, z], [x + dx, y + dy, z], [x + dx, y + dy, z + dz], [x + dx, y, z + dz]])}
        fill={assombrir(couleur, 0.18)}
      />
      <Polygon
        points={points(iso, [[x, y + dy, z], [x + dx, y + dy, z], [x + dx, y + dy, z + dz], [x, y + dy, z + dz]])}
        fill={assombrir(couleur, 0.08)}
      />
      <Polygon
        points={points(iso, [[x, y, z + dz], [x + dx, y, z + dz], [x + dx, y + dy, z + dz], [x, y + dy, z + dz]])}
        fill={couleur}
      />
    </G>
  );
}

// Fenêtre dans le mur de gauche (x = 0), charnière côté y = Y0, ouverture vers l'intérieur.
const FEN = { y0: 3, y1: 7, z0: 2.5, z1: 5.5 };
const GOUTTES: [number, number][] = [
  [0.2, 0.3], [0.55, 0.2], [0.8, 0.45], [0.35, 0.6], [0.7, 0.75], [0.15, 0.82], [0.5, 0.45], [0.88, 0.15],
];

function Fenetre({ iso, ouverture, buee }: { iso: Projection; ouverture: number; buee: number }) {
  const largeur = FEN.y1 - FEN.y0;
  const angle = ouverture * (65 * Math.PI) / 180;
  const bout: [number, number] = [Math.sin(angle) * largeur, FEN.y0 + Math.cos(angle) * largeur];
  const coin = (s: number, t: number): P3 => [
    bout[0] * s,
    FEN.y0 + (bout[1] - FEN.y0) * s,
    FEN.z0 + (FEN.z1 - FEN.z0) * t,
  ];
  const vitre = melanger('#CBE8F5', '#F1F5F6', buee);
  const nbGouttes = Math.round(buee * GOUTTES.length);

  return (
    <G>
      {/* Ouverture dans le mur : le ciel apparaît quand le battant s'écarte */}
      <Polygon
        points={points(iso, [[0, FEN.y0, FEN.z0], [0, FEN.y1, FEN.z0], [0, FEN.y1, FEN.z1], [0, FEN.y0, FEN.z1]])}
        fill="#9FD3EE"
      />
      <Polygon
        points={points(iso, [[0, FEN.y0, FEN.z0], [0, FEN.y1, FEN.z0], [0.5, FEN.y1, FEN.z0], [0.5, FEN.y0, FEN.z0]])}
        fill="#F7F7F5"
      />
      {/* Battant */}
      <Polygon
        points={points(iso, [coin(0, 0), coin(1, 0), coin(1, 1), coin(0, 1)])}
        fill={vitre}
        stroke="#FFFFFF"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Polygon
        points={points(iso, [coin(0, 0), coin(1, 0), coin(1, 1), coin(0, 1)])}
        fill="none"
        stroke="#8E9A97"
        strokeWidth={0.8}
      />
      <Path
        d={`M${iso(coin(0.5, 0)).join(',')} L${iso(coin(0.5, 1)).join(',')}`}
        stroke="#FFFFFF"
        strokeWidth={2}
      />
      {GOUTTES.slice(0, nbGouttes).map(([s, t], i) => {
        const [cx, cy] = iso(coin(s, t));
        return <Circle key={i} cx={cx} cy={cy} r={2.2} fill="#5FA8CF" opacity={0.75} />;
      })}
    </G>
  );
}

// Grille de la VMC dans le mur du fond à droite (y = 0).
const VMC = { x: 7.2, z: 5, demiCote: 0.9 };

function Plante({ iso }: { iso: Projection }) {
  const [cx, cy] = iso([1.4, 1.4, 1.3]);
  return (
    <G>
      <Boite iso={iso} o={[0.9, 0.9, 0]} d={[1, 1, 1.1]} couleur="#C97B52" />
      <Circle cx={cx - 8} cy={cy - 10} r={10} fill="#4E8F5A" />
      <Circle cx={cx + 7} cy={cy - 14} r={11} fill="#5DA067" />
      <Circle cx={cx} cy={cy - 24} r={10} fill="#6CB075" />
    </G>
  );
}

function Canape({ iso }: { iso: Projection }) {
  return (
    <G>
      <Boite iso={iso} o={[2.6, 0.2, 0]} d={[4, 0.7, 2.6]} couleur="#6E8FA8" />
      <Boite iso={iso} o={[2.6, 0.9, 0]} d={[4, 1.5, 1.2]} couleur="#7FA1BA" />
      <Boite iso={iso} o={[2.2, 0.2, 0]} d={[0.4, 2.2, 1.7]} couleur="#6E8FA8" />
      <Boite iso={iso} o={[6.6, 0.2, 0]} d={[0.4, 2.2, 1.7]} couleur="#6E8FA8" />
    </G>
  );
}

// Hélice dessinée de face, puis inclinée dans le plan du mur et tournée par le moteur natif.
function Helice({ allumee, taille }: { allumee: boolean; taille: number }) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!allumee) {
      rotation.stopAnimation();
      return;
    }
    rotation.setValue(0);
    const boucle = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    boucle.start();
    return () => boucle.stop();
  }, [allumee, rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ width: taille, height: taille, transform: [{ rotate }] }}>
      <Svg width={taille} height={taille} viewBox="-10 -10 20 20">
        {[0, 120, 240].map((a) => (
          <Path
            key={a}
            d="M0,0 C2,-2 3,-7 0,-9 C-3,-7 -2,-2 0,0 Z"
            fill={allumee ? '#0B6E5F' : '#8E9A97'}
            transform={`rotate(${a})`}
          />
        ))}
        <Circle r={1.6} fill="#FFFFFF" stroke="#5A6865" strokeWidth={0.6} />
      </Svg>
    </Animated.View>
  );
}

// ---------- Pièce ----------
type Props = {
  mesures: Mesures | null;
  etat: Etat | null;
};

export function PieceIsometrique({ mesures, etat }: Props) {
  const [largeurEcran, setLargeurEcran] = useState(0);
  const [azimut, setAzimut] = useState(AZIMUT_DEFAUT);
  const iso = creerProjection(azimut);

  // Glisser horizontalement fait pivoter la pièce ; un glissement vertical laisse défiler l'écran.
  const depart = useRef(AZIMUT_DEFAUT);
  const azimutActuel = useRef(AZIMUT_DEFAUT);
  azimutActuel.current = azimut;
  const borner = (v: number) => Math.min(AZIMUT_MAX, Math.max(AZIMUT_MIN, v));
  const geste = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        depart.current = azimutActuel.current;
      },
      onPanResponderMove: (_, g) => setAzimut(borner(depart.current - g.dx * DEGRES_PAR_PIXEL)),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;
  const ouverture = useProgression(etat?.fenetre === 'ouverte' ? 1 : 0);
  const vmcAllumee = etat?.vmc === 'allumee';

  const mur = couleurMur(mesures?.temperature ?? null);
  const murGauche = mur;
  const murDroit = assombrir(mur, 0.07);
  const buee = niveauBuee(mesures?.humidite ?? null);

  // Position de l'hélice à l'écran : coordonnées du dessin × échelle réelle.
  const echelle = largeurEcran / VB_L;
  const [hx, hy] = iso([VMC.x, 0, VMC.z]);
  const tailleHelice = VMC.demiCote * 2 * K * echelle * 0.85;
  // L'hélice est dessinée de face : on l'écrase et on l'incline pour la poser dans le plan du mur.
  // Le long du mur (axe x), une unité devient (cos·√2, sin·√2/2) fois K à l'écran.
  const a = (azimut * Math.PI) / 180;
  const etirementX = Math.cos(a) * Math.SQRT2;
  const penteY = (Math.sin(a) * Math.SQRT2) / 2;
  const inclinaison = (Math.atan(penteY / etirementX) * 180) / Math.PI;

  const description = [
    mesures ? `${mesures.temperature.toFixed(1)} °C, ${mesures.humidite.toFixed(1)} % d'humidité` : 'Pas encore de mesure',
    etat ? `fenêtre ${etat.fenetre === 'ouverte' ? 'ouverte' : 'fermée'}` : null,
    etat ? `VMC ${vmcAllumee ? 'allumée' : 'coupée'}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      style={styles.cadre}
      onLayout={(e) => setLargeurEcran(e.nativeEvent.layout.width)}
      {...geste.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Vue de la pièce : ${description}`}
      accessibilityHint="Glisser horizontalement pour faire pivoter la pièce"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        setAzimut((v) => borner(v + (e.nativeEvent.actionName === 'increment' ? 10 : -10)))
      }
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VB_L} ${VB_H}`}>
        {/* Dalle du sol */}
        <Polygon
          points={points(iso, [[-EP, PROFONDEUR, 0], [LARGEUR, PROFONDEUR, 0], [LARGEUR, PROFONDEUR, -EP], [-EP, PROFONDEUR, -EP]])}
          fill="#A88B66"
        />
        <Polygon
          points={points(iso, [[LARGEUR, -EP, 0], [LARGEUR, PROFONDEUR, 0], [LARGEUR, PROFONDEUR, -EP], [LARGEUR, -EP, -EP]])}
          fill="#96795A"
        />
        <Polygon
          points={points(iso, [[0, 0, 0], [LARGEUR, 0, 0], [LARGEUR, PROFONDEUR, 0], [0, PROFONDEUR, 0]])}
          fill="#D8C09C"
        />
        <Polygon points={points(iso, [[3.2, 4, 0], [8.4, 4, 0], [8.4, 8.6, 0], [3.2, 8.6, 0]])} fill="#E9DCC5" />
        <Polygon
          points={points(iso, [[3.6, 4.4, 0], [8, 4.4, 0], [8, 8.2, 0], [3.6, 8.2, 0]])}
          fill="none"
          stroke="#C9B58F"
          strokeWidth={1}
        />

        {/* Murs du fond : leur teinte suit la température */}
        <Polygon
          points={points(iso, [[0, 0, 0], [0, PROFONDEUR, 0], [0, PROFONDEUR, HAUTEUR], [0, 0, HAUTEUR]])}
          fill={murGauche}
        />
        <Polygon
          points={points(iso, [[0, 0, 0], [LARGEUR, 0, 0], [LARGEUR, 0, HAUTEUR], [0, 0, HAUTEUR]])}
          fill={murDroit}
        />
        <Polygon
          points={points(iso, [[-EP, -EP, HAUTEUR], [-EP, PROFONDEUR, HAUTEUR], [0, PROFONDEUR, HAUTEUR], [0, 0, HAUTEUR], [LARGEUR, 0, HAUTEUR], [LARGEUR, -EP, HAUTEUR]])}
          fill="#FAFAF8"
          stroke="#C9D1CF"
          strokeWidth={0.6}
        />
        <Polygon
          points={points(iso, [[0, PROFONDEUR, 0], [-EP, PROFONDEUR, 0], [-EP, PROFONDEUR, HAUTEUR], [0, PROFONDEUR, HAUTEUR]])}
          fill="#D5DAD8"
        />
        <Polygon
          points={points(iso, [[LARGEUR, 0, 0], [LARGEUR, -EP, 0], [LARGEUR, -EP, HAUTEUR], [LARGEUR, 0, HAUTEUR]])}
          fill="#C4CAC8"
        />

        {/* Boîtier de la VMC ; l'hélice est dessinée par-dessus */}
        <Polygon
          points={points(iso, [
            [VMC.x - VMC.demiCote, 0, VMC.z - VMC.demiCote],
            [VMC.x + VMC.demiCote, 0, VMC.z - VMC.demiCote],
            [VMC.x + VMC.demiCote, 0, VMC.z + VMC.demiCote],
            [VMC.x - VMC.demiCote, 0, VMC.z + VMC.demiCote],
          ])}
          fill="#F4F6F5"
          stroke="#8E9A97"
          strokeWidth={1}
        />

        <Plante iso={iso} />
        <Canape iso={iso} />
        <Fenetre iso={iso} ouverture={ouverture} buee={buee} />
      </Svg>

      {largeurEcran > 0 && (
        <View
          pointerEvents="none"
          style={[
            styles.helice,
            {
              left: hx * echelle - tailleHelice / 2,
              top: hy * echelle - tailleHelice / 2,
              transform: [{ skewY: `${inclinaison}deg` }, { scaleX: etirementX }],
            },
          ]}
        >
          <Helice allumee={vmcAllumee} taille={tailleHelice} />
        </View>
      )}
      <Text style={styles.astuce} pointerEvents="none">
        ↔ Glisser pour pivoter
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cadre: { width: '100%', aspectRatio: VB_L / VB_H },
  helice: { position: 'absolute' },
  astuce: { position: 'absolute', right: 8, bottom: 4, fontSize: 12, color: '#5A6865' },
});
