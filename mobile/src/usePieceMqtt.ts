import mqtt, { type MqttClient } from 'mqtt';
import { useEffect, useRef, useState } from 'react';

import { MQTT_URL } from './config';
import type { Etat, Identifiants, Mesures, Piece, StatutBroker, StatutObjet } from './types';

// Topics du contrat : voir docs/contrat-mqtt.md. Abonnement topic par topic, jamais piece/#.
const T = {
  mesures: 'piece/mesures',
  etat: 'piece/etat',
  statut: 'piece/objet/statut',
  fenetre: 'piece/fenetre/commande',
  vmc: 'piece/vmc/commande',
  mode: 'piece/mode',
} as const;

function lireMesures(texte: string): Mesures | null {
  try {
    const m = JSON.parse(texte);
    if (Number.isFinite(m?.temperature) && Number.isFinite(m?.humidite)) {
      return { temperature: m.temperature, humidite: m.humidite };
    }
  } catch {
    // message mal formé : ignoré
  }
  return null;
}

function lireEtat(texte: string): Etat | null {
  try {
    const e = JSON.parse(texte);
    const valide =
      ['ouverte', 'fermee'].includes(e?.fenetre) &&
      ['allumee', 'coupee'].includes(e?.vmc) &&
      ['auto', 'manuel'].includes(e?.mode);
    if (valide) return { fenetre: e.fenetre, vmc: e.vmc, mode: e.mode };
  } catch {
    // message mal formé : ignoré
  }
  return null;
}

// Sans identifiants : connexion anonyme, acceptée par le broker local de test (pas par EMQX).
export function usePieceMqtt(identifiants?: Identifiants): Piece {
  const client = useRef<MqttClient | null>(null);
  const [broker, setBroker] = useState<StatutBroker>('connexion');
  const [objet, setObjet] = useState<StatutObjet>('inconnu');
  const [mesures, setMesures] = useState<Mesures | null>(null);
  const [recuA, setRecuA] = useState<Date | null>(null);
  const [etat, setEtat] = useState<Etat | null>(null);

  useEffect(() => {
    const c = mqtt.connect(MQTT_URL, {
      username: identifiants?.utilisateur,
      password: identifiants?.motDePasse,
      // Identifiant unique : deux clients avec le même identifiant s'éjectent mutuellement.
      clientId: `app-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
    });
    client.current = c;

    c.on('connect', () => {
      setBroker('connecte');
      c.subscribe([T.mesures, T.etat, T.statut], { qos: 1 });
    });
    c.on('reconnect', () => setBroker((b) => (b === 'refuse' ? b : 'reconnexion')));
    c.on('offline', () => setBroker((b) => (b === 'refuse' ? b : 'reconnexion')));
    c.on('error', (erreur) => {
      // Codes MQTT 4 et 5 : identifiants refusés. Inutile de réessayer en boucle.
      const code = (erreur as { code?: number }).code;
      if (code === 4 || code === 5) {
        setBroker('refuse');
        c.end(true);
      }
    });

    c.on('message', (topic, contenu) => {
      const texte = contenu.toString();
      if (topic === T.mesures) {
        const m = lireMesures(texte);
        if (m) {
          setMesures(m);
          setRecuA(new Date());
        }
      } else if (topic === T.etat) {
        const e = lireEtat(texte);
        if (e) setEtat(e);
      } else if (topic === T.statut && (texte === 'en_ligne' || texte === 'hors_ligne')) {
        setObjet(texte);
      }
    });

    return () => {
      c.end(true);
      client.current = null;
    };
  }, [identifiants]);

  // L'état affiché ne change que lorsque l'objet confirme sur piece/etat.
  const publier = (topic: string, message: string, retain = false) =>
    client.current?.publish(topic, message, { qos: 1, retain });

  return {
    source: 'mqtt',
    broker,
    objet,
    mesures,
    recuA,
    etat,
    commanderFenetre: (commande) => publier(T.fenetre, commande),
    commanderVmc: (commande) => publier(T.vmc, commande),
    changerMode: (mode) => publier(T.mode, mode, true), // retenu : l'objet le retrouve au redémarrage
  };
}
