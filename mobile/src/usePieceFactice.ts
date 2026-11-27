import { useEffect, useRef, useState } from 'react';

import { decisionAuto, evoluer, securiser } from './logique';
import type { Etat, Mesures, Piece } from './types';

// Plus rapide que l'objet (10 s) pour voir la pièce réagir pendant la démo.
const PERIODE_MS = 2_000;

// Mode démo : pièce simulée, sans broker. Renvoie le même type Piece que usePieceMqtt.
// La pièce réagit au chauffage, à la fenêtre et à la VMC ; en mode auto, elle se régule seule.
export function usePieceFactice(): Piece {
  const [mesures, setMesures] = useState<Mesures>({ temperature: 17.6, humidite: 58 });
  const [recuA, setRecuA] = useState(() => new Date());
  const [etat, setEtat] = useState<Etat>({ fenetre: 'fermee', vmc: 'coupee', chauffage: 'eteint', mode: 'auto' });

  // Le minuteur lit l'état courant sans être recréé à chaque changement.
  const courant = useRef({ mesures, etat });
  courant.current = { mesures, etat };

  useEffect(() => {
    const minuteur = setInterval(() => {
      const { mesures: m, etat: e } = courant.current;
      const suivantes = evoluer(m, e, Math.random() * 2 - 1);
      setMesures(suivantes);
      setRecuA(new Date());
      if (e.mode === 'auto') setEtat(decisionAuto(suivantes, e));
    }, PERIODE_MS);
    return () => clearInterval(minuteur);
  }, []);

  const changer = (modif: Partial<Etat>) => setEtat((e) => securiser({ ...e, ...modif }));

  return {
    source: 'demo',
    broker: 'connecte',
    objet: 'en_ligne',
    mesures,
    recuA,
    etat,
    commanderFenetre: (c) => changer({ fenetre: c === 'ouvrir' ? 'ouverte' : 'fermee' }),
    commanderVmc: (c) => changer({ vmc: c === 'allumer' ? 'allumee' : 'coupee' }),
    commanderChauffage: (c) => changer({ chauffage: c === 'allumer' ? 'allume' : 'eteint' }),
    changerMode: (mode) =>
      setEtat((e) => (mode === 'auto' ? decisionAuto(courant.current.mesures, { ...e, mode }) : { ...e, mode })),
  };
}
