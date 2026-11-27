import { useEffect, useState } from 'react';

import { API_URL } from './config';
import type { Mesures, Piece, StatutBroker } from './types';

const PERIODE_MS = 5_000; // délai entre deux interrogations
const DELAI_MAX_MS = 4_000; // au-delà, l'API est jugée injoignable

// Réponse de GET /api/mesures/derniere : voir backend/README.md
type Releve = Mesures & { ts: number }; // ts : réception par le back-end, en millisecondes

function lireReleve(r: Partial<Releve> | null): Releve | null {
  const { ts, temperature, humidite } = r ?? {};
  return Number.isFinite(ts) && Number.isFinite(temperature) && Number.isFinite(humidite)
    ? ({ ts, temperature, humidite } as Releve)
    : null;
}

// Dernière mesure lue sur l'API du back-end. L'API est en lecture seule et ne connaît que les mesures :
// l'état de l'objet reste inconnu, ce qui bloque les commandes à l'écran.
export function usePieceApi(): Piece {
  const [releve, setReleve] = useState<Releve | null>(null);
  const [liaison, setLiaison] = useState<StatutBroker>('connexion');

  useEffect(() => {
    let arrete = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let requete: AbortController | undefined;

    // La suivante n'est programmée qu'une fois la précédente terminée : jamais deux requêtes à la fois.
    const interroger = async () => {
      requete = new AbortController();
      const delai = setTimeout(() => requete?.abort(), DELAI_MAX_MS);
      try {
        const reponse = await fetch(`${API_URL}/api/mesures/derniere`, { signal: requete.signal });
        // 404 : l'API répond, mais n'a encore rien enregistré.
        if (!reponse.ok && reponse.status !== 404) throw new Error(`HTTP ${reponse.status}`);
        const lu = reponse.ok ? lireReleve(await reponse.json()) : null;
        if (arrete) return;
        if (lu) setReleve(lu);
        setLiaison('connecte');
      } catch {
        if (!arrete) setLiaison('reconnexion');
      } finally {
        clearTimeout(delai);
        if (!arrete) minuteur = setTimeout(interroger, PERIODE_MS);
      }
    };
    interroger();

    return () => {
      arrete = true;
      clearTimeout(minuteur);
      requete?.abort();
    };
  }, []);

  return {
    source: 'api',
    broker: liaison,
    objet: 'inconnu',
    mesures: releve && { temperature: releve.temperature, humidite: releve.humidite },
    recuA: releve && new Date(releve.ts),
    etat: null,
    commanderFenetre: () => {},
    commanderVmc: () => {},
    changerMode: () => {},
  };
}
