import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { SEUIL_FROID, SEUIL_HUMIDITE, SEUIL_TEMPERATURE } from './config';
import type { Etat, Mesures } from './types';

// ---------- Projection isométrique ----------
// Repère de la pièce : x vers la droite et le bas, y vers la gauche et le bas, z vers le haut.
// 1 unité ≈ 40 cm : pièce de 4 × 4 m, 2,80 m sous plafond.
// Le dessin SVG ne se redessine que lorsqu'une valeur change ; les effets (vent, chaleur…) sont
// des vues animées par le moteur natif, sans boucle de rendu JavaScript (batterie).
const K = 16; // taille d'une unité à l'écran
const LARGEUR = 10; // x
const PROFONDEUR = 10; // y
const HAUTEUR = 7; // z
const EP = 0.4; // épaisseur des murs et du sol
const OX = 170;
const OY = 10 + HAUTEUR * K;
const VB_L = 340;
const VB_H = OY + (LARGEUR + PROFONDEUR) * (K / 2) + EP * K + 8;
const NATIF = Platform.OS !== 'web';

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
const ligne = (iso: Projection, a: P3, b: P3) => `M${iso(a).join(',')} L${iso(b).join(',')}`;

// Rectangles dans un plan : x constant (mur de gauche), y constant (mur du fond), z constant (sol).
const planX = (x: number, y0: number, y1: number, z0: number, z1: number): P3[] => [
  [x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1],
];
const planY = (y: number, x0: number, x1: number, z0: number, z1: number): P3[] => [
  [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1],
];
const planZ = (z: number, x0: number, x1: number, y0: number, y1: number): P3[] => [
  [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z],
];

// Pseudo-hasard stable : les particules gardent leur place d'un rendu à l'autre.
const alea = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// ---------- Couleurs ----------
type RVB = [number, number, number];

const versRvb = (hex: string): RVB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RVB;
const versHex = (c: RVB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function melanger(a: string, b: string, t: number): string {
  const [ca, cb] = [versRvb(a), versRvb(b)];
  const u = Math.min(1, Math.max(0, t));
  return versHex(ca.map((v, i) => v + (cb[i] - v) * u) as RVB);
}

const assombrir = (hex: string, t: number) => melanger(hex, '#000000', t);
const eclaircir = (hex: string, t: number) => melanger(hex, '#FFFFFF', t);

// Teinte des murs : bleue sous le seuil de froid, neutre au confort, rouge au-delà du seuil chaud.
const PALIERS: [number, string][] = [
  [SEUIL_FROID - 4, '#B9D4EE'],
  [SEUIL_FROID, '#DCE7F0'],
  [21.5, '#EFEAE1'],
  [SEUIL_TEMPERATURE - 2, '#F4DDC4'],
  [SEUIL_TEMPERATURE, '#F3BFA0'],
  [SEUIL_TEMPERATURE + 4, '#EC9682'],
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

// 0 au seuil de froid, 1 quatre degrés en dessous : givre sur la vitre.
function niveauGivre(temperature: number | null): number {
  if (temperature === null) return 0;
  return Math.min(1, Math.max(0, (SEUIL_FROID - temperature) / 4));
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

// ---------- Volumes ----------
// Pavé vu depuis le coin x+, y+ : seules trois faces sont visibles. Chaque face reçoit un dégradé
// d'éclairage (reflet en haut, ombrage vers le bas) ; « rayon » arrondit les angles (coussins, tissus).
function Boite({ iso, o, d, couleur, rayon = 0 }: { iso: Projection; o: P3; d: P3; couleur: string; rayon?: number }) {
  const [x, y, z] = o;
  const [dx, dy, dz] = d;
  const faces: [P3[], string, string][] = [
    [planX(x + dx, y, y + dy, z, z + dz), assombrir(couleur, 0.22), 'url(#ombrage)'],
    [planY(y + dy, x, x + dx, z, z + dz), assombrir(couleur, 0.1), 'url(#ombrage)'],
    [planZ(z + dz, x, x + dx, y, y + dy), couleur, 'url(#reflet)'],
  ];
  return (
    <G>
      {faces.map(([p, c, lumiere], i) => {
        const pts = points(iso, p);
        return (
          <G key={i}>
            <Polygon points={pts} fill={c} stroke={rayon ? c : undefined} strokeWidth={rayon} strokeLinejoin="round" />
            <Polygon points={pts} fill={lumiere} />
          </G>
        );
      })}
    </G>
  );
}

// Ombre de contact douce (dégradé radial), un peu décalée à l'opposé de la fenêtre.
function Ombre({ iso, x0, x1, y0, y1, force = 1, marge = 0.45 }: { iso: Projection; x0: number; x1: number; y0: number; y1: number; force?: number; marge?: number }) {
  return (
    <Polygon
      points={points(iso, planZ(0.006, x0 - marge + 0.25, x1 + marge + 0.35, y0 - marge + 0.1, y1 + marge + 0.25))}
      fill="url(#ombreDouce)"
      opacity={force}
    />
  );
}

// Lumière chaude d'une lampe sur le mur ou le sol.
function Halo({ iso, p, r, force = 1 }: { iso: Projection; p: P3; r: number; force?: number }) {
  const [cx, cy] = iso(p);
  return <Ellipse cx={cx} cy={cy} rx={r} ry={r * 0.8} fill="url(#halo)" opacity={force} />;
}

// ---------- Sol et murs ----------
const TEINTES_CHENE = ['#CDA57A', '#C59B6E', '#D4AF86', '#BE9265', '#C9A074', '#D8B68E'];

function Sol({ iso, teinte, force }: { iso: Projection; teinte: string; force: number }) {
  // Parquet en lames de longueurs et de teintes variées, joints décalés d'une rangée à l'autre.
  const lames: ReactNode[] = [];
  const LAME = 0.62;
  for (let r = 0, y = 0; y < PROFONDEUR - 0.01; r++, y += LAME) {
    let x = -alea(r * 7 + 1) * 2.6;
    for (let k = 0; x < LARGEUR; k++) {
      const long = 2.4 + alea(r * 31 + k * 7) * 1.6;
      const [a, b] = [Math.max(0, x), Math.min(LARGEUR, x + long)];
      lames.push(
        <Polygon
          key={`${r}-${k}`}
          points={points(iso, planZ(0, a, b, y, Math.min(PROFONDEUR, y + LAME)))}
          fill={TEINTES_CHENE[Math.floor(alea(r * 13 + k * 5 + 3) * TEINTES_CHENE.length)]}
          stroke="#9E7651"
          strokeWidth={0.45}
        />,
      );
      x += long;
    }
  }
  return (
    <G>
      <Polygon points={points(iso, planY(PROFONDEUR, -EP, LARGEUR, -EP, 0))} fill="#7E6044" />
      <Polygon points={points(iso, planX(LARGEUR, -EP, PROFONDEUR, -EP, 0))} fill="#6C5139" />
      {lames}
      {/* Vernis : léger brillant, et teinte de l'ambiance (bleue s'il fait froid, orangée s'il fait chaud) */}
      <Polygon points={points(iso, planZ(0, 0, LARGEUR, 0, PROFONDEUR))} fill="url(#vernis)" />
      <Polygon points={points(iso, planZ(0, 0, LARGEUR, 0, PROFONDEUR))} fill={teinte} opacity={force} />
      {/* Occlusion ambiante le long des murs : le sol s'assombrit au pied des murs */}
      {[0.18, 0.45, 0.9].map((l, i) => (
        <G key={i} opacity={0.07}>
          <Polygon points={points(iso, planZ(0.002, 0, l, 0, PROFONDEUR))} fill="#000000" />
          <Polygon points={points(iso, planZ(0.002, 0, LARGEUR, 0, l))} fill="#000000" />
        </G>
      ))}
    </G>
  );
}

function Murs({ iso }: { iso: Projection }) {
  return (
    <G>
      <Polygon points={points(iso, planX(0, 0, PROFONDEUR, 0, HAUTEUR))} fill="url(#murGauche)" />
      <Polygon points={points(iso, planY(0, 0, LARGEUR, 0, HAUTEUR))} fill="url(#murFond)" />
      {/* Lumière du jour renvoyée par la fenêtre sur le mur du fond */}
      <Polygon points={points(iso, planY(0.005, 0, 7, 0.3, 6.5))} fill="url(#jourMur)" />
      {/* Occlusion ambiante dans le coin et sous le plafond */}
      {[0.2, 0.5, 1].map((l, i) => (
        <G key={i} opacity={0.06}>
          <Polygon points={points(iso, planX(0.003, 0, l, 0, HAUTEUR))} fill="#000000" />
          <Polygon points={points(iso, planY(0.003, 0, l, 0, HAUTEUR))} fill="#000000" />
          <Polygon points={points(iso, planX(0.003, 0, PROFONDEUR, 0.3, 0.3 + l * 0.6))} fill="#000000" />
          <Polygon points={points(iso, planY(0.003, 0, LARGEUR, 0.3, 0.3 + l * 0.6))} fill="#000000" />
        </G>
      ))}
      {/* Corniche */}
      <Polygon points={points(iso, planX(0.02, 0, PROFONDEUR, HAUTEUR - 0.28, HAUTEUR))} fill="#FFFFFF" opacity={0.7} />
      <Polygon points={points(iso, planY(0.02, 0, LARGEUR, HAUTEUR - 0.28, HAUTEUR))} fill="#FFFFFF" opacity={0.55} />
      <Path d={ligne(iso, [0.02, 0, HAUTEUR - 0.28], [0.02, PROFONDEUR, HAUTEUR - 0.28])} stroke="#000000" strokeWidth={0.5} opacity={0.12} />
      <Path d={ligne(iso, [0, 0.02, HAUTEUR - 0.28], [LARGEUR, 0.02, HAUTEUR - 0.28])} stroke="#000000" strokeWidth={0.5} opacity={0.12} />
      {/* Plinthes avec leur filet d'ombre */}
      <Polygon points={points(iso, planX(0.04, 0, PROFONDEUR, 0, 0.32))} fill="#FAF8F3" />
      <Polygon points={points(iso, planY(0.04, 0, LARGEUR, 0, 0.32))} fill="#EFECE5" />
      <Path d={ligne(iso, [0.04, 0, 0.32], [0.04, PROFONDEUR, 0.32])} stroke="#B9B2A4" strokeWidth={0.6} />
      <Path d={ligne(iso, [0, 0.04, 0.32], [LARGEUR, 0.04, 0.32])} stroke="#B9B2A4" strokeWidth={0.6} />
      {/* Arête du coin */}
      <Path d={ligne(iso, [0, 0, 0], [0, 0, HAUTEUR])} stroke="#000000" strokeWidth={0.7} opacity={0.15} />
      {/* Coupe des murs et du sol */}
      <Polygon
        points={points(iso, [[-EP, -EP, HAUTEUR], [-EP, PROFONDEUR, HAUTEUR], [0, PROFONDEUR, HAUTEUR], [0, 0, HAUTEUR], [LARGEUR, 0, HAUTEUR], [LARGEUR, -EP, HAUTEUR]])}
        fill="#3E4342"
      />
      <Polygon points={points(iso, planY(PROFONDEUR, -EP, 0, 0, HAUTEUR))} fill="#D8D4CC" />
      <Polygon points={points(iso, planX(LARGEUR, -EP, 0, 0, HAUTEUR))} fill="#C9C4BB" />
    </G>
  );
}

// ---------- Fenêtre (mur de gauche, x = 0), charnière côté y0, ouverture vers l'intérieur ----------
const FEN = { y0: 3, y1: 7, z0: 2.6, z1: 5.6 };
const GOUTTES: [number, number][] = [
  [0.2, 0.3], [0.55, 0.2], [0.8, 0.45], [0.35, 0.6], [0.7, 0.75], [0.15, 0.82], [0.5, 0.45], [0.88, 0.15],
];

function Baie({ iso, givre, chaleur }: { iso: Projection; givre: number; chaleur: number }) {
  const { y0, y1, z0, z1 } = FEN;
  const dehors = (y: number, z: number): P3 => [-0.01, y, z];
  // Paysage : collines et arbres, enneigés quand il fait froid.
  const colline = (base: number, amp: number, phase: number) => {
    const p: P3[] = [dehors(y0, z0)];
    for (let i = 0; i <= 10; i++) {
      const y = y0 + ((y1 - y0) * i) / 10;
      p.push(dehors(y, z0 + base + Math.sin(i * 0.9 + phase) * amp));
    }
    p.push(dehors(y1, z0));
    return points(iso, p);
  };
  const neige = (c: string) => melanger(c, '#F2F5F8', givre);
  const arbre = (y: number, h: number, i: number) => {
    const [bx, by] = iso(dehors(y, z0 + 0.6));
    const r = h * 3.2;
    return (
      <G key={i}>
        <Path d={`M${bx},${by} L${bx},${by - r * 1.2}`} stroke="#5B4636" strokeWidth={1} />
        <Circle cx={bx} cy={by - r * 1.5} r={r} fill={neige('#3F7A4A')} />
        <Circle cx={bx - r * 0.55} cy={by - r * 1.1} r={r * 0.75} fill={neige('#4A8A55')} />
        <Circle cx={bx + r * 0.6} cy={by - r * 1.15} r={r * 0.7} fill={neige('#36703F')} />
      </G>
    );
  };
  const nuage = (y: number, z: number, r: number) => {
    const [cx, cy] = iso(dehors(y, z));
    return (
      <G opacity={0.85}>
        <Ellipse cx={cx} cy={cy} rx={r * 1.6} ry={r * 0.8} fill="#FFFFFF" />
        <Circle cx={cx - r * 0.4} cy={cy - r * 0.4} r={r * 0.75} fill="#FFFFFF" />
        <Circle cx={cx + r * 0.45} cy={cy - r * 0.25} r={r * 0.6} fill="#FFFFFF" />
      </G>
    );
  };
  const [sx, sy] = iso(dehors(y0 + 1.1, z1 - 0.65));

  return (
    <G>
      {/* Lumière du jour autour de la baie */}
      <Polygon points={points(iso, planX(0.005, y0 - 1.4, y1 + 1.4, z0 - 1.2, z1 + 1))} fill="url(#jourBaie)" />
      {/* Cadre dormant */}
      <Polygon points={points(iso, planX(0.01, y0 - 0.24, y1 + 0.24, z0 - 0.24, z1 + 0.24))} fill="#FCFCFA" stroke="#D6D2C9" strokeWidth={0.5} />
      {/* Extérieur */}
      <Polygon points={points(iso, planX(0, y0, y1, z0, z1))} fill="url(#ciel)" />
      <Circle cx={sx} cy={sy} r={9 + chaleur * 4} fill="url(#halo)" />
      <Circle cx={sx} cy={sy} r={3.5 + chaleur * 1.5} fill="#FFF1B8" />
      {nuage(y0 + 2.7, z1 - 0.55, 3.2)}
      {nuage(y0 + 1.6, z1 - 1.2, 2.2)}
      <Polygon points={colline(0.95, 0.22, 0.5)} fill={neige('#8DB98A')} />
      {[3.5, 4.2, 5.6, 6.3].map((y, i) => arbre(y, 0.8 + alea(i + 300) * 0.5, i))}
      <Polygon points={colline(0.45, 0.15, 2)} fill={neige('#6FA36C')} />
      {/* Embrasure côté charnière, dans l'épaisseur du mur */}
      <Polygon points={points(iso, [[0, y0, z0], [0, y0, z1], [-EP, y0, z1], [-EP, y0, z0]])} fill="#E3DFD7" />
      {/* Tablette intérieure en pierre claire */}
      <Polygon points={points(iso, planZ(z0, 0, 0.6, y0 - 0.35, y1 + 0.35))} fill="#F4F2EE" />
      <Polygon points={points(iso, planX(0.6, y0 - 0.35, y1 + 0.35, z0 - 0.12, z0))} fill="#CFCAC1" />
      <Polygon points={points(iso, planX(0.01, y0 - 0.3, y1 + 0.3, z0 - 0.5, z0 - 0.12))} fill="#000000" opacity={0.06} />
    </G>
  );
}

function Battant({ iso, ouverture, buee, givre }: { iso: Projection; ouverture: number; buee: number; givre: number }) {
  const largeur = FEN.y1 - FEN.y0;
  const angle = ouverture * (65 * Math.PI) / 180;
  const bout: [number, number] = [Math.sin(angle) * largeur, FEN.y0 + Math.cos(angle) * largeur];
  const coin = (s: number, t: number): P3 => [
    bout[0] * s + 0.02,
    FEN.y0 + (bout[1] - FEN.y0) * s,
    FEN.z0 + (FEN.z1 - FEN.z0) * t,
  ];
  const quad = (s0: number, s1: number, t0: number, t1: number) =>
    points(iso, [coin(s0, t0), coin(s1, t0), coin(s1, t1), coin(s0, t1)]);
  const nbGouttes = Math.round(buee * GOUTTES.length);

  return (
    <G>
      <Polygon points={quad(0, 1, 0, 1)} fill="url(#vitre)" />
      <Polygon points={quad(0, 1, 0, 1)} fill="#EEF3F5" opacity={Math.max(buee * 0.55, givre * 0.35)} />
      {/* Reflets en biais */}
      <Polygon points={points(iso, [coin(0.08, 0.2), coin(0.3, 0.95), coin(0.42, 0.95), coin(0.2, 0.2)])} fill="#FFFFFF" opacity={0.3} />
      <Polygon points={points(iso, [coin(0.55, 0.1), coin(0.7, 0.6), coin(0.75, 0.6), coin(0.6, 0.1)])} fill="#FFFFFF" opacity={0.22} />
      {/* Givre : il gagne les angles bas puis remonte */}
      {givre > 0 && (
        <G opacity={0.85}>
          <Polygon points={points(iso, [coin(0, 0), coin(0.5 * givre, 0), coin(0, 0.6 * givre)])} fill="#FFFFFF" />
          <Polygon points={points(iso, [coin(1, 0), coin(1 - 0.5 * givre, 0), coin(1, 0.6 * givre)])} fill="#FFFFFF" />
          <Polygon points={quad(0, 1, 0, 0.12 * givre)} fill="#FFFFFF" />
        </G>
      )}
      {GOUTTES.slice(0, nbGouttes).map(([s, t], i) => {
        const [cx, cy] = iso(coin(s, t));
        return (
          <G key={i}>
            <Ellipse cx={cx} cy={cy} rx={1.5} ry={2.3} fill="#5E9EC4" opacity={0.65} />
            <Circle cx={cx - 0.5} cy={cy - 0.8} r={0.5} fill="#FFFFFF" opacity={0.9} />
          </G>
        );
      })}
      {/* Ouvrant : profilés blancs, petits-bois, poignée */}
      <Polygon points={quad(0, 1, 0, 1)} fill="none" stroke="#FFFFFF" strokeWidth={3.4} strokeLinejoin="round" />
      <Polygon points={quad(0, 1, 0, 1)} fill="none" stroke="#A8B0AD" strokeWidth={0.6} />
      <Path d={`M${iso(coin(0.5, 0)).join(',')} L${iso(coin(0.5, 1)).join(',')}`} stroke="#FFFFFF" strokeWidth={2.4} />
      <Path d={`M${iso(coin(0, 0.55)).join(',')} L${iso(coin(1, 0.55)).join(',')}`} stroke="#FFFFFF" strokeWidth={1.8} />
      <Path d={`M${iso(coin(0.95, 0.45)).join(',')} L${iso(coin(0.95, 0.6)).join(',')}`} stroke="#5C6461" strokeWidth={2} strokeLinecap="round" />
    </G>
  );
}

// Voilages de lin ; fenêtre ouverte, le bas se soulève sous le vent.
function Rideaux({ iso, ouverture }: { iso: Projection; ouverture: number }) {
  const haut = FEN.z1 + 0.95;
  const bas = 0.35;
  const pan = (ya: number, yb: number, gonfle: number) => {
    const xb = 0.18 + gonfle;
    const n = 6;
    // Plis : bandes alternées claires et ombrées.
    const bandes = Array.from({ length: n }, (_, i) => {
      const [t0, t1] = [i / n, (i + 1) / n];
      const [ga, gb] = [ya + (yb - ya) * t0, ya + (yb - ya) * t1];
      const pli = i % 2 ? 0.1 : 0;
      return (
        <Polygon
          key={i}
          points={points(iso, [[0.18 + pli, ga, haut], [0.18 + pli, gb, haut], [xb + pli, gb, bas], [xb + pli, ga, bas]])}
          fill={i % 2 ? '#E7DED0' : '#D6CAB7'}
          opacity={0.94}
        />
      );
    });
    return <G>{bandes}</G>;
  };
  return (
    <G>
      {pan(FEN.y0 - 1.05, FEN.y0 - 0.2, ouverture * 0.8)}
      {pan(FEN.y1 + 0.2, FEN.y1 + 1.05, ouverture * 0.9)}
      <Path d={ligne(iso, [0.2, FEN.y0 - 1.2, haut + 0.08], [0.2, FEN.y1 + 1.2, haut + 0.08])} stroke="#2E2A26" strokeWidth={1.4} strokeLinecap="round" />
    </G>
  );
}

// Radiateur à panneau sous la fenêtre ; il rougit progressivement en chauffant.
const RAD = { y0: 3.5, y1: 6.5, z0: 0.55, z1: 2.15, x: 0.12, ep: 0.3 };

function Radiateur({ iso, chauffe }: { iso: Projection; chauffe: number }) {
  const couleur = melanger('#F1F2F1', '#F08655', chauffe);
  const ailettes: string[] = [];
  for (let y = RAD.y0 + 0.18; y < RAD.y1 - 0.05; y += 0.18) {
    ailettes.push(ligne(iso, [RAD.x + RAD.ep, y, RAD.z0 + 0.12], [RAD.x + RAD.ep, y, RAD.z1 - 0.12]));
  }
  const [vx, vy] = iso([RAD.x + RAD.ep, RAD.y0 - 0.15, RAD.z0 + 0.15]);
  return (
    <G>
      <Polygon points={points(iso, planX(0.01, RAD.y0 - 0.4, RAD.y1 + 0.4, RAD.z0, RAD.z1 + 1))} fill="url(#halo)" opacity={chauffe} />
      <Polygon points={points(iso, planX(0.01, RAD.y0 + 0.1, RAD.y1 + 0.25, RAD.z0 - 0.15, RAD.z1 - 0.1))} fill="#000000" opacity={0.07} />
      <Path d={ligne(iso, [0.05, RAD.y0 + 0.3, RAD.z0], [0.05, RAD.y0 + 0.3, 0.32])} stroke="#B9BEBC" strokeWidth={1.4} />
      <Path d={ligne(iso, [0.05, RAD.y1 - 0.3, RAD.z0], [0.05, RAD.y1 - 0.3, 0.32])} stroke="#B9BEBC" strokeWidth={1.4} />
      <Boite iso={iso} o={[RAD.x, RAD.y0, RAD.z0]} d={[RAD.ep, RAD.y1 - RAD.y0, RAD.z1 - RAD.z0]} couleur={couleur} rayon={0.8} />
      <Path d={ailettes.join(' ')} stroke={assombrir(couleur, 0.25)} strokeWidth={0.7} />
      <Circle cx={vx} cy={vy} r={2.6} fill="#F4F5F4" stroke="#8E9A97" strokeWidth={0.6} />
      <Circle cx={vx} cy={vy} r={1} fill={chauffe > 0.5 ? '#E4572E' : '#8E9A97'} />
    </G>
  );
}

// Thermostat d'ambiance : écran coloré selon la température, voyant de chauffe.
function Thermostat({ iso, temperature, chauffe }: { iso: Projection; temperature: number | null; chauffe: boolean }) {
  const ecran =
    temperature === null
      ? '#9AA4A1'
      : temperature < SEUIL_FROID
        ? '#2F7FD1'
        : temperature >= SEUIL_TEMPERATURE
          ? '#D84A35'
          : '#2E9C7E';
  const [tx, ty] = iso([0.04, 8.72, 4.25]);
  const [lx, ly] = iso([0.04, 8.72, 3.85]);
  return (
    <G>
      <Polygon points={points(iso, planX(0.01, 8.4, 9.15, 3.55, 4.6))} fill="#000000" opacity={0.08} />
      <Polygon points={points(iso, planX(0.03, 8.35, 9.1, 3.65, 4.65))} fill="#FBFBFA" stroke="#C3BDB2" strokeWidth={0.5} />
      <Polygon points={points(iso, planX(0.04, 8.45, 9.0, 4.05, 4.5))} fill={ecran} />
      <SvgText x={tx} y={ty + 2} fontFamily={NATIF ? undefined : 'system-ui, sans-serif'} fontSize={3.6} fontWeight="700" fill="#FFFFFF" textAnchor="middle">
        {temperature === null ? '--' : `${temperature.toFixed(1)}°`}
      </SvgText>
      <Circle cx={lx} cy={ly} r={1.3} fill={chauffe ? '#FF8A3D' : '#C9D1CF'} />
      {/* Interrupteur */}
      <Polygon points={points(iso, planX(0.03, 9.45, 9.8, 3.6, 4.05))} fill="#FBFBFA" stroke="#C3BDB2" strokeWidth={0.5} />
    </G>
  );
}

// ---------- Mur du fond (y = 0) ----------
const VMC = { x: 9.05, z: 6.15, demiCote: 0.5 };

function BouchesVmc({ iso, allumee }: { iso: Projection; allumee: boolean }) {
  const { x, z, demiCote: c } = VMC;
  const [cx, cy] = iso([x, 0.02, z]);
  return (
    <G>
      <Polygon points={points(iso, planY(0.008, x - c - 0.1, x + c + 0.14, z - c - 0.16, z + c + 0.06))} fill="#000000" opacity={0.08} />
      <Polygon points={points(iso, planY(0.01, x - c - 0.12, x + c + 0.12, z - c - 0.12, z + c + 0.12))} fill="#FFFFFF" stroke="#B4BAB7" strokeWidth={0.6} />
      <Ellipse cx={cx} cy={cy} rx={c * K * 0.95} ry={c * K * 0.95} fill={allumee ? '#2C3A37' : '#59615F'} />
    </G>
  );
}

function Tableau({ iso }: { iso: Projection }) {
  const [x0, x1, z0, z1] = [2.9, 5.9, 3.35, 5.35];
  const p = (u: number, v: number): P3 => [x0 + 0.28 + (x1 - x0 - 0.56) * u, 0.035, z0 + 0.28 + (z1 - z0 - 0.56) * v];
  const [sx, sy] = iso(p(0.74, 0.8));
  return (
    <G>
      <Polygon points={points(iso, planY(0.015, x0 + 0.14, x1 + 0.14, z0 - 0.16, z1 - 0.12))} fill="#000000" opacity={0.13} />
      <Polygon points={points(iso, planY(0.02, x0, x1, z0, z1))} fill="#2B241E" />
      <Polygon points={points(iso, planY(0.03, x0 + 0.08, x1 - 0.08, z0 + 0.08, z1 - 0.08))} fill="#F7F3EA" />
      <Polygon points={points(iso, [p(0, 0), p(1, 0), p(1, 1), p(0, 1)])} fill="#F0DFC4" />
      <Circle cx={sx} cy={sy} r={4} fill="#E58E4A" />
      <Polygon points={points(iso, [p(0, 0), p(0.25, 0.62), p(0.5, 0.3), p(0.78, 0.72), p(1, 0.38), p(1, 0)])} fill="#7E9EA8" />
      <Polygon points={points(iso, [p(0, 0), p(0.38, 0.38), p(0.62, 0.14), p(1, 0.26), p(1, 0)])} fill="#3E6470" />
    </G>
  );
}

// ---------- Mobilier ----------
function Plante({ iso }: { iso: Projection }) {
  const [cx, cy] = iso([1.05, 1.05, 1.35]);
  // Ficus lyrata : grandes feuilles le long de trois tiges.
  const feuilles: [number, number, number, number][] = [];
  [[-12, 62], [4, 78], [18, 58]].forEach(([inclinaison, hauteur], t) => {
    for (let i = 0; i < 6; i++) {
      const h = 12 + (i / 5) * hauteur * 0.85;
      const cote = i % 2 ? 1 : -1;
      feuilles.push([
        cx + Math.sin((inclinaison * Math.PI) / 180) * h,
        cy - h,
        cote * (35 + alea(t * 10 + i) * 30) + inclinaison,
        9 + alea(t * 7 + i + 50) * 5,
      ]);
    }
  });
  return (
    <G>
      <Ombre iso={iso} x0={0.5} x1={1.6} y0={0.5} y1={1.6} />
      {[[-12, 62], [4, 78], [18, 58]].map(([a, h], i) => (
        <Path
          key={i}
          d={`M${cx},${cy} Q${cx + Math.sin((a * Math.PI) / 180) * h * 0.4},${cy - h * 0.5} ${cx + Math.sin((a * Math.PI) / 180) * h},${cy - h}`}
          stroke="#5B4636"
          strokeWidth={1.1}
          fill="none"
        />
      ))}
      {feuilles.map(([x, y, a, l], i) => (
        <Path
          key={i}
          d={`M0,0 C${l * 0.55},${-l * 0.2} ${l * 0.5},${-l * 0.95} 0,${-l * 1.15} C${-l * 0.5},${-l * 0.95} ${-l * 0.55},${-l * 0.2} 0,0 Z`}
          fill={i % 3 === 0 ? 'url(#feuilleClaire)' : 'url(#feuille)'}
          transform={`translate(${x},${y}) rotate(${a})`}
        />
      ))}
      {/* Panier tressé */}
      <Boite iso={iso} o={[0.5, 0.5, 0]} d={[1.1, 1.1, 1.35]} couleur="#C8A77C" rayon={1.5} />
      {[0.35, 0.7, 1.05].map((z) => (
        <Path
          key={z}
          d={`${ligne(iso, [0.5, 1.6, z], [1.6, 1.6, z])} ${ligne(iso, [1.6, 1.6, z], [1.6, 0.5, z])}`}
          stroke="#A68459"
          strokeWidth={0.7}
        />
      ))}
    </G>
  );
}

function Canape({ iso }: { iso: Projection }) {
  const tissu = '#5D7A8C';
  const pied = (x: number, y: number) => <Boite iso={iso} o={[x, y, 0]} d={[0.14, 0.14, 0.26]} couleur="#3A2A1E" />;
  return (
    <G>
      <Ombre iso={iso} x0={2.0} x1={6.8} y0={0.2} y1={2.45} force={0.9} />
      {pied(2.1, 2.2)}
      {pied(6.55, 2.2)}
      <Boite iso={iso} o={[2.0, 0.2, 0.26]} d={[0.44, 2.25, 1.4]} couleur={assombrir(tissu, 0.04)} rayon={2.5} />
      <Boite iso={iso} o={[2.44, 0.2, 0.26]} d={[3.92, 2.25, 0.5]} couleur={assombrir(tissu, 0.14)} rayon={1.5} />
      <Boite iso={iso} o={[2.5, 0.2, 0.76]} d={[3.8, 0.6, 1.8]} couleur={tissu} rayon={3} />
      {/* Coussins de dossier */}
      <Boite iso={iso} o={[2.55, 0.62, 1.2]} d={[1.85, 0.45, 1.25]} couleur={eclaircir(tissu, 0.06)} rayon={4} />
      <Boite iso={iso} o={[4.45, 0.62, 1.2]} d={[1.85, 0.45, 1.25]} couleur={eclaircir(tissu, 0.06)} rayon={4} />
      {/* Assises */}
      <Boite iso={iso} o={[2.5, 1.0, 0.76]} d={[1.88, 1.42, 0.44]} couleur={eclaircir(tissu, 0.12)} rayon={3.5} />
      <Boite iso={iso} o={[4.45, 1.0, 0.76]} d={[1.88, 1.42, 0.44]} couleur={eclaircir(tissu, 0.12)} rayon={3.5} />
      {/* Coussins décoratifs et plaid */}
      <Boite iso={iso} o={[2.65, 1.05, 1.2]} d={[0.85, 0.3, 0.85]} couleur="#E2B04A" rayon={4} />
      <Boite iso={iso} o={[5.35, 1.05, 1.2]} d={[0.85, 0.3, 0.85]} couleur="#D98B6A" rayon={4} />
      <Boite iso={iso} o={[4.9, 1.6, 0.9]} d={[1.0, 0.85, 0.32]} couleur="#EDE6DA" rayon={2} />
      <Boite iso={iso} o={[6.36, 0.2, 0.26]} d={[0.44, 2.25, 1.4]} couleur={assombrir(tissu, 0.04)} rayon={2.5} />
    </G>
  );
}

// Guéridon rond et sa lampe, entre le canapé et la bibliothèque.
function Gueridon({ iso }: { iso: Projection }) {
  const [c, h] = [[7.45, 1.0] as const, 1.6];
  const [tx, ty] = iso([c[0], c[1], h]);
  const [bx, by] = iso([c[0], c[1], 0]);
  const [lx, ly] = iso([c[0], c[1], h + 0.9]);
  const r = 0.5 * K * Math.SQRT2;
  return (
    <G>
      <Ellipse cx={bx + 4} cy={by + 1} rx={r * 1.1} ry={r * 0.5} fill="url(#ombreDouce)" />
      <Path d={`M${bx},${by} L${tx},${ty}`} stroke="#2F2620" strokeWidth={1.6} />
      <Ellipse cx={bx} cy={by} rx={r * 0.45} ry={r * 0.22} fill="#2F2620" />
      <Ellipse cx={tx} cy={ty + 1.2} rx={r} ry={r * 0.5} fill="#7A5236" />
      <Ellipse cx={tx} cy={ty} rx={r} ry={r * 0.5} fill="#9C6B43" />
      {/* Lampe : pied céramique, abat-jour allumé */}
      <Path d={`M${tx - 3},${ty} C${tx - 5},${ty - 6} ${tx - 2},${ty - 9} ${tx},${ly + 5} C${tx + 2},${ty - 9} ${tx + 5},${ty - 6} ${tx + 3},${ty} Z`} fill="#E9E3D7" />
      <Path d={`M${lx - 5.5},${ly - 7} L${lx + 5.5},${ly - 7} L${lx + 8},${ly + 5} L${lx - 8},${ly + 5} Z`} fill="url(#abatJour)" />
      <Ellipse cx={lx} cy={ly + 5} rx={8} ry={1.8} fill="#FFF2CF" />
    </G>
  );
}

// Bibliothèque contre le mur du fond, remplie de livres.
const LIVRES = ['#2F5566', '#C0583E', '#E2B04A', '#EDE6DA', '#5D7A8C', '#7C8F5B', '#3B2E23', '#B98B6A', '#9A3F3F'];

function Bibliotheque({ iso }: { iso: Projection }) {
  const [x0, x1, p, h] = [8.25, 9.9, 0.95, 5.3];
  const niveaux = [0.3, 1.55, 2.8, 4.05];
  const bois = '#E9E1D3';
  return (
    <G>
      <Ombre iso={iso} x0={x0} x1={x1} y0={0} y1={p} force={0.8} />
      <Polygon points={points(iso, planY(0.02, x0, x1, 0, h))} fill={assombrir(bois, 0.2)} />
      <Boite iso={iso} o={[x0, 0, 0]} d={[0.1, p, h]} couleur={bois} />
      {niveaux.map((z, n) => {
        const livres: ReactNode[] = [];
        let x = x0 + 0.15 + alea(n + 400) * 0.2;
        for (let k = 0; x < x1 - 0.3; k++) {
          const ep = 0.1 + alea(n * 17 + k) * 0.1;
          const haut = 0.75 + alea(n * 23 + k + 9) * 0.35;
          // Quelques trous pour un objet ou un livre couché.
          if (alea(n * 5 + k * 3) > 0.86) {
            x += 0.25;
            continue;
          }
          livres.push(
            <Boite
              key={k}
              iso={iso}
              o={[x, 0.18 + alea(k + n) * 0.1, z + 0.1]}
              d={[ep, 0.55 + alea(k * 3 + n) * 0.1, haut]}
              couleur={LIVRES[Math.floor(alea(n * 31 + k * 7 + 2) * LIVRES.length)]}
            />,
          );
          x += ep + 0.01;
        }
        return (
          <G key={n}>
            <Boite iso={iso} o={[x0 + 0.1, 0, z]} d={[x1 - x0 - 0.2, p, 0.1]} couleur={bois} />
            {livres}
          </G>
        );
      })}
      <Boite iso={iso} o={[x0 + 0.1, 0, h - 0.1]} d={[x1 - x0 - 0.2, p, 0.1]} couleur={bois} />
      {/* Vase sur le dessus */}
      <Boite iso={iso} o={[8.55, 0.3, h]} d={[0.28, 0.28, 0.45]} couleur="#EDE6DA" rayon={2} />
      <Boite iso={iso} o={[x1 - 0.1, 0, 0]} d={[0.1, p, h]} couleur={bois} />
    </G>
  );
}

function Fauteuil({ iso }: { iso: Projection }) {
  const tissu = '#C98A4F';
  const [x0, y0, y1] = [0.45, 7.7, 9.6];
  const pied = (x: number, y: number) => <Boite iso={iso} o={[x, y, 0]} d={[0.13, 0.13, 0.4]} couleur="#3A2A1E" />;
  return (
    <G>
      <Ombre iso={iso} x0={x0} x1={2.5} y0={y0} y1={y1} force={0.9} />
      {pied(0.6, 7.85)}
      {pied(2.25, 7.85)}
      {pied(2.25, 9.35)}
      {/* Dossier contre le mur, accoudoir côté fenêtre, assise, accoudoir côté pièce */}
      <Boite iso={iso} o={[x0, y0, 0.4]} d={[0.5, y1 - y0, 2.1]} couleur={assombrir(tissu, 0.05)} rayon={4} />
      <Boite iso={iso} o={[x0 + 0.5, y0, 0.4]} d={[1.6, 0.38, 1.05]} couleur={assombrir(tissu, 0.08)} rayon={3} />
      <Boite iso={iso} o={[x0 + 0.5, y0 + 0.38, 0.4]} d={[1.6, y1 - y0 - 0.76, 0.55]} couleur={eclaircir(tissu, 0.08)} rayon={3.5} />
      <Boite iso={iso} o={[x0 + 0.5, y0 + 0.45, 0.95]} d={[0.32, 0.9, 0.8]} couleur="#EDE6DA" rayon={4} />
      <Boite iso={iso} o={[x0 + 0.5, y1 - 0.38, 0.4]} d={[1.6, 0.38, 1.05]} couleur={assombrir(tissu, 0.02)} rayon={3} />
    </G>
  );
}

function Tapis({ iso }: { iso: Projection }) {
  const [x0, x1, y0, y1] = [3.0, 8.6, 3.8, 8.8];
  const motif: string[] = [];
  // Losanges berbères.
  for (let i = 0; i < 5; i++) {
    const x = x0 + 0.9 + i * 0.95;
    for (let j = 0; j < 4; j++) {
      const y = y0 + 1 + j * 1.0;
      motif.push(
        `M${iso([x - 0.3, y - 0.3, 0.013]).join(',')} L${iso([x + 0.3, y - 0.3, 0.013]).join(',')} L${iso([x + 0.3, y + 0.3, 0.013]).join(',')} L${iso([x - 0.3, y + 0.3, 0.013]).join(',')} Z`,
      );
    }
  }
  const franges: string[] = [];
  for (let y = y0 + 0.12; y < y1; y += 0.2) {
    franges.push(ligne(iso, [x1, y, 0.01], [x1 + 0.22, y, 0.01]), ligne(iso, [x0 - 0.22, y, 0.01], [x0, y, 0.01]));
  }
  return (
    <G>
      <Path d={franges.join(' ')} stroke="#E6DFD2" strokeWidth={0.7} />
      <Polygon points={points(iso, planZ(0.01, x0, x1, y0, y1))} fill="#EFE8DC" stroke="#E0D7C7" strokeWidth={1.2} strokeLinejoin="round" />
      <Polygon points={points(iso, planZ(0.012, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3))} fill="none" stroke="#3B3530" strokeWidth={0.9} opacity={0.75} />
      <Path d={motif.join(' ')} fill="none" stroke="#3B3530" strokeWidth={0.7} opacity={0.6} />
      <Polygon points={points(iso, planZ(0.012, x0, x1, y0, y1))} fill="url(#vernis)" />
    </G>
  );
}

function TableBasse({ iso }: { iso: Projection }) {
  const bois = '#9C6B43';
  const [x0, x1, y0, y1, h] = [4.3, 7.3, 5.0, 6.6, 0.95];
  const pied = (x: number, y: number) => <Boite iso={iso} o={[x, y, 0]} d={[0.14, 0.14, h]} couleur={assombrir(bois, 0.2)} />;
  const [mx, my] = iso([6.6, 5.6, h + 0.14]);
  const [vx, vy] = iso([5.4, 6.1, h + 0.14]);
  return (
    <G>
      <Ombre iso={iso} x0={x0} x1={x1} y0={y0} y1={y1} force={0.75} />
      {pied(x0 + 0.12, y0 + 0.12)}
      {pied(x1 - 0.26, y0 + 0.12)}
      {pied(x0 + 0.12, y1 - 0.26)}
      {pied(x1 - 0.26, y1 - 0.26)}
      <Boite iso={iso} o={[x0 + 0.1, y0 + 0.1, 0.3]} d={[x1 - x0 - 0.2, y1 - y0 - 0.2, 0.06]} couleur={assombrir(bois, 0.08)} />
      <Boite iso={iso} o={[x0, y0, h]} d={[x1 - x0, y1 - y0, 0.14]} couleur={bois} rayon={1} />
      {/* Livres, vase et tasse */}
      <Boite iso={iso} o={[4.6, 5.25, h + 0.14]} d={[1.0, 0.75, 0.12]} couleur="#2F5566" />
      <Boite iso={iso} o={[4.68, 5.3, h + 0.26]} d={[0.85, 0.65, 0.1]} couleur="#E2B04A" />
      <Path d={`M${vx - 2.5},${vy} C${vx - 4},${vy - 5} ${vx - 1.5},${vy - 8} ${vx - 1.2},${vy - 11} L${vx + 1.2},${vy - 11} C${vx + 1.5},${vy - 8} ${vx + 4},${vy - 5} ${vx + 2.5},${vy} Z`} fill="#3E6470" />
      <Path d={`M${vx},${vy - 11} Q${vx - 6},${vy - 22} ${vx - 9},${vy - 26} M${vx},${vy - 11} Q${vx + 3},${vy - 20} ${vx + 6},${vy - 28}`} stroke="#6B5444" strokeWidth={0.8} fill="none" />
      <Circle cx={vx - 9} cy={vy - 26} r={1.6} fill="#E8B7A3" />
      <Circle cx={vx + 6} cy={vy - 28} r={1.8} fill="#F0D7CB" />
      <Path d={`M${mx - 3},${my} L${mx - 3},${my + 4} A3,1.5 0 0 0 ${mx + 3},${my + 4} L${mx + 3},${my}`} fill="#F7F4EE" />
      <Ellipse cx={mx} cy={my} rx={3} ry={1.5} fill="#6B4630" stroke="#F7F4EE" strokeWidth={0.8} />
      <Path d={`M${mx + 3},${my + 1} q2.5,0.5 0,2.6`} stroke="#F7F4EE" strokeWidth={0.9} fill="none" />
    </G>
  );
}

// ---------- Effets animés (vues natives par-dessus le dessin) ----------
type Pt = [number, number];

// Une particule qui va de « de » à « a » en boucle, en apparaissant puis en s'effaçant.
function Particule({ de, a, duree, delai, children }: { de: Pt; a: Pt; duree: number; delai: number; children: ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const boucle = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: duree, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIF }),
    );
    const id = setTimeout(() => boucle.start(), delai);
    return () => {
      clearTimeout(id);
      boucle.stop();
    };
  }, [duree, delai, t]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: de[0],
        top: de[1],
        opacity: t.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 0.8, 0] }),
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, a[0] - de[0]] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, a[1] - de[1]] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

// Trait de vent orienté dans la direction du souffle.
function Souffle({ de, a, couleur, longueur }: { de: Pt; a: Pt; couleur: string; longueur: number }) {
  const angle = (Math.atan2(a[1] - de[1], a[0] - de[0]) * 180) / Math.PI;
  return (
    <View
      style={{
        width: longueur,
        height: 2.5,
        borderRadius: 2,
        backgroundColor: couleur,
        marginLeft: -longueur / 2,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

// Ondulation verticale (air chaud qui monte).
function Onde({ couleur, taille }: { couleur: string; taille: number }) {
  return (
    <Svg width={taille * 0.6} height={taille} viewBox="0 0 6 10" style={{ marginLeft: -taille * 0.3, marginTop: -taille / 2 }}>
      <Path d="M3,10 C0.5,8.5 5.5,6.5 3,5 C0.5,3.5 5.5,1.5 3,0" stroke={couleur} strokeWidth={1.1} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

type Effets = { vent: boolean; chauffage: boolean; froid: boolean; chaud: boolean; vmc: boolean; humide: boolean };

function CoucheEffets({ iso, echelle, effets }: { iso: Projection; echelle: number; effets: Effets }) {
  const e = (p: P3): Pt => {
    const [x, y] = iso(p);
    return [x * echelle, y * echelle];
  };
  const s = echelle; // tailles en unités du dessin
  const liste: ReactNode[] = [];
  const ajouter = (cle: string, de: P3, a: P3, duree: number, delai: number, contenu: (d: Pt, f: Pt) => ReactNode) => {
    const [d, f] = [e(de), e(a)];
    liste.push(
      <Particule key={cle} de={d} a={f} duree={duree} delai={delai}>
        {contenu(d, f)}
      </Particule>,
    );
  };

  if (effets.vent) {
    // L'air entre par la baie et balaie la pièce en descendant.
    for (let i = 0; i < 9; i++) {
      const y = FEN.y0 + 0.4 + alea(i) * (FEN.y1 - FEN.y0 - 0.8);
      const z = FEN.z0 + 0.3 + alea(i + 20) * (FEN.z1 - FEN.z0 - 0.6);
      ajouter(`vent${i}`, [0.3, y, z], [6 + alea(i + 40) * 2, y + 1.2, z - 1.8], 1500 + alea(i + 60) * 700, i * 180, (d, f) => (
        <Souffle de={d} a={f} couleur={effets.froid ? '#7FB2E5' : '#9CC9E8'} longueur={(14 + alea(i) * 10) * s} />
      ));
    }
  }
  if (effets.chauffage) {
    // Convection : l'air chaud monte du radiateur et longe la fenêtre.
    for (let i = 0; i < 7; i++) {
      const y = RAD.y0 + 0.3 + (i / 6) * (RAD.y1 - RAD.y0 - 0.6);
      ajouter(`rad${i}`, [RAD.x + 0.4, y, RAD.z1], [1.2 + alea(i) * 0.8, y + 0.3, RAD.z1 + 2.6], 2200 + alea(i + 5) * 800, i * 260, () => (
        <Onde couleur="#F0703C" taille={16 * s} />
      ));
    }
  }
  if (effets.chaud) {
    // Chaleur étouffante : l'air ondule dans toute la pièce.
    for (let i = 0; i < 8; i++) {
      const x = 2 + alea(i + 80) * 7;
      const y = 3 + alea(i + 90) * 6;
      ajouter(`chaud${i}`, [x, y, 0.4], [x, y, 4.2], 2600 + alea(i) * 1200, i * 320, () => (
        <Onde couleur="#E4572E" taille={20 * s} />
      ));
    }
  }
  if (effets.froid) {
    // Flocons qui tombent lentement en dérivant.
    for (let i = 0; i < 10; i++) {
      const x = 1 + alea(i + 100) * 8;
      const y = 1 + alea(i + 110) * 8;
      ajouter(`froid${i}`, [x, y, 6.5], [x + 0.6, y + 0.4, 0.3], 4200 + alea(i) * 2200, i * 420, () => (
        <Text style={{ fontSize: (9 + alea(i + 3) * 6) * s, color: '#5E9BD6', marginLeft: -6 * s, marginTop: -8 * s }}>❄</Text>
      ));
    }
  }
  if (effets.vmc) {
    // L'air est aspiré vers la bouche de la VMC.
    for (let i = 0; i < 8; i++) {
      const x = 5 + alea(i + 130) * 4.5;
      const y = 2.5 + alea(i + 140) * 4;
      const z = 2.5 + alea(i + 150) * 3;
      ajouter(`vmc${i}`, [x, y, z], [VMC.x + (alea(i) - 0.5), 0.1, VMC.z + (alea(i + 1) - 0.5)], 1600 + alea(i + 7) * 600, i * 200, () => (
        <View style={[styles.point, { width: 4 * s, height: 4 * s, marginLeft: -2 * s, marginTop: -2 * s }]} />
      ));
    }
  }
  if (effets.humide) {
    // Vapeur qui stagne et monte doucement.
    for (let i = 0; i < 6; i++) {
      const x = 2 + alea(i + 170) * 6;
      const y = 3 + alea(i + 180) * 5;
      ajouter(`vap${i}`, [x, y, 1.5], [x - 0.5, y - 0.5, 5], 4000 + alea(i) * 1500, i * 600, () => (
        <View style={[styles.vapeur, { width: 22 * s, height: 12 * s, marginLeft: -11 * s, marginTop: -6 * s }]} />
      ));
    }
  }
  return <>{liste}</>;
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
      Animated.timing(rotation, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: NATIF }),
    );
    boucle.start();
    return () => boucle.stop();
  }, [allumee, rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ width: taille, height: taille, transform: [{ rotate }] }}>
      <Svg width={taille} height={taille} viewBox="-10 -10 20 20">
        {[0, 90, 180, 270].map((a) => (
          <Path
            key={a}
            d="M0,0 C2.5,-2 3.5,-7 0.5,-9 C-2.5,-7 -2,-2 0,0 Z"
            fill={allumee ? '#DDE6E3' : '#9AA4A1'}
            transform={`rotate(${a})`}
          />
        ))}
        <Circle r={1.8} fill="#FFFFFF" stroke="#5A6865" strokeWidth={0.6} />
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

  const temperature = mesures?.temperature ?? null;
  const humidite = mesures?.humidite ?? null;
  const fenetreOuverte = etat?.fenetre === 'ouverte';
  const vmcAllumee = etat?.vmc === 'allumee';
  const chauffageAllume = etat?.chauffage === 'allume';
  const ouverture = useProgression(fenetreOuverte ? 1 : 0);
  const chauffe = useProgression(chauffageAllume ? 1 : 0, 2500); // le radiateur met du temps à chauffer

  const mur = couleurMur(temperature);
  const buee = niveauBuee(humidite);
  const givre = niveauGivre(temperature);
  const chaleur = temperature === null ? 0 : Math.min(1, Math.max(0, (temperature - 24) / 6));
  const effets: Effets = {
    vent: ouverture > 0.6,
    chauffage: chauffe > 0.6,
    froid: temperature !== null && temperature < SEUIL_FROID,
    chaud: temperature !== null && temperature >= SEUIL_TEMPERATURE,
    vmc: vmcAllumee,
    humide: humidite !== null && humidite >= SEUIL_HUMIDITE,
  };

  // Position de l'hélice à l'écran : coordonnées du dessin × échelle réelle.
  const echelle = largeurEcran / VB_L;
  const [hx, hy] = iso([VMC.x, 0, VMC.z]);
  const tailleHelice = VMC.demiCote * 2 * K * echelle * 0.9;
  // L'hélice est dessinée de face : on l'écrase et on l'incline pour la poser dans le plan du mur.
  // Le long du mur (axe x), une unité devient (cos·√2, sin·√2/2) fois K à l'écran.
  const a = (azimut * Math.PI) / 180;
  const etirementX = Math.cos(a) * Math.SQRT2;
  const penteY = (Math.sin(a) * Math.SQRT2) / 2;
  const inclinaison = (Math.atan(penteY / etirementX) * 180) / Math.PI;

  const description = [
    mesures ? `${mesures.temperature.toFixed(1)} °C, ${mesures.humidite.toFixed(1)} % d'humidité` : 'Pas encore de mesure',
    etat ? `fenêtre ${fenetreOuverte ? 'ouverte' : 'fermée'}` : null,
    etat ? `VMC ${vmcAllumee ? 'allumée' : 'coupée'}` : null,
    etat ? `chauffage ${chauffageAllume ? 'allumé' : 'éteint'}` : null,
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
        <Defs>
          {/* Murs éclairés par le haut, teintés par la température */}
          <LinearGradient id="murGauche" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={eclaircir(mur, 0.2)} />
            <Stop offset="1" stopColor={assombrir(mur, 0.06)} />
          </LinearGradient>
          <LinearGradient id="murFond" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={eclaircir(assombrir(mur, 0.06), 0.1)} />
            <Stop offset="1" stopColor={assombrir(mur, 0.16)} />
          </LinearGradient>
          <RadialGradient id="jourMur" cx="0.25" cy="0.55" r="0.65">
            <Stop offset="0" stopColor="#FFF8E6" stopOpacity={0.45 + chaleur * 0.2} />
            <Stop offset="1" stopColor="#FFF8E6" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="jourBaie" cx="0.5" cy="0.5" r="0.55">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.5} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="ciel" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={melanger(melanger('#4D97D6', '#93A9BD', givre), '#3F8FDB', chaleur)} />
            <Stop offset="1" stopColor={melanger(melanger('#CBE6F6', '#E6ECF1', givre), '#FFE1A0', chaleur)} />
          </LinearGradient>
          <LinearGradient id="vitre" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.35} />
            <Stop offset="0.5" stopColor="#CFE8F5" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.3} />
          </LinearGradient>
          <LinearGradient id="vernis" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.16} />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.08} />
          </LinearGradient>
          <RadialGradient id="ombreDouce" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#1E140A" stopOpacity={0.38} />
            <Stop offset="0.55" stopColor="#1E140A" stopOpacity={0.2} />
            <Stop offset="1" stopColor="#1E140A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor="#FFD58A" stopOpacity={0.6} />
            <Stop offset="1" stopColor="#FFD58A" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="soleil" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFF3CC" stopOpacity={0.55 + chaleur * 0.25} />
            <Stop offset="1" stopColor="#FFF3CC" stopOpacity={0.05} />
          </LinearGradient>
          {/* Éclairage des volumes : reflet sur le dessus, ombrage vers le bas des côtés */}
          <LinearGradient id="reflet" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="ombrage" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.16} />
          </LinearGradient>
          <LinearGradient id="feuille" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#5E9E58" />
            <Stop offset="1" stopColor="#2E5E34" />
          </LinearGradient>
          <LinearGradient id="feuilleClaire" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#86BE6C" />
            <Stop offset="1" stopColor="#467E44" />
          </LinearGradient>
          <LinearGradient id="abatJour" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F8EEDB" />
            <Stop offset="1" stopColor="#FFE3A8" />
          </LinearGradient>
        </Defs>

        <Sol iso={iso} teinte={givre > 0 ? '#3F7FD0' : '#F07A3C'} force={givre > 0 ? givre * 0.12 : chaleur * 0.1} />
        <Murs iso={iso} />

        {/* Mur du fond : tableau, halo de la lampe, VMC */}
        <Tableau iso={iso} />
        <Halo iso={iso} p={[7.45, 0, 3.1]} r={34} />
        <BouchesVmc iso={iso} allumee={vmcAllumee} />

        {/* Mur de gauche : fenêtre, thermostat, rideaux, radiateur */}
        <Baie iso={iso} givre={givre} chaleur={chaleur} />
        <Thermostat iso={iso} temperature={temperature} chauffe={chauffageAllume} />
        <Rideaux iso={iso} ouverture={ouverture} />
        <Radiateur iso={iso} chauffe={chauffe} />

        {/* Sol : tapis, puis le soleil qui entre par la baie */}
        <Tapis iso={iso} />
        <Polygon
          points={points(iso, [[0.6, FEN.y0 + 0.4, 0.02], [0.6, FEN.y1 + 0.4, 0.02], [5.4, FEN.y1 + 1.7, 0.02], [5.4, FEN.y0 + 1.7, 0.02]])}
          fill="url(#soleil)"
        />

        {/* Mobilier, du fond vers l'avant */}
        <Plante iso={iso} />
        <Canape iso={iso} />
        <Gueridon iso={iso} />
        <Bibliotheque iso={iso} />
        <TableBasse iso={iso} />
        <Battant iso={iso} ouverture={ouverture} buee={buee} givre={givre} />
        <Fauteuil iso={iso} />
      </Svg>

      {largeurEcran > 0 && (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.absolu,
              {
                left: hx * echelle - tailleHelice / 2,
                top: hy * echelle - tailleHelice / 2,
                transform: [{ skewY: `${inclinaison}deg` }, { scaleX: etirementX }],
              },
            ]}
          >
            <Helice allumee={vmcAllumee} taille={tailleHelice} />
          </View>
          <CoucheEffets iso={iso} echelle={echelle} effets={effets} />
        </>
      )}
      <Text style={styles.astuce} pointerEvents="none">
        ↔ Glisser pour pivoter
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sur le web (écran large), la pièce garde une taille raisonnable, centrée.
  cadre: { width: '100%', aspectRatio: VB_L / VB_H, overflow: 'hidden', ...(NATIF ? {} : { maxWidth: 440, alignSelf: 'center' }) },
  absolu: { position: 'absolute' },
  point: { borderRadius: 99, backgroundColor: '#7FA7C2' },
  vapeur: { borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.55)' },
  astuce: { position: 'absolute', right: 8, bottom: 4, fontSize: 12, color: '#5A6865' },
});
