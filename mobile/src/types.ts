// Types du contrat MQTT : voir docs/contrat-mqtt.md

export type Mesures = {
  temperature: number; // °C
  humidite: number; // %
};

export type Fenetre = 'ouverte' | 'fermee';
export type Vmc = 'allumee' | 'coupee';
export type Mode = 'auto' | 'manuel';

export type Etat = {
  fenetre: Fenetre;
  vmc: Vmc;
  mode: Mode;
};

export type CommandeFenetre = 'ouvrir' | 'fermer';
export type CommandeVmc = 'allumer' | 'couper';

// Connexion de l'app au broker.
export type StatutBroker = 'connexion' | 'connecte' | 'reconnexion' | 'refuse';
// Contenu de piece/objet/statut, ou « inconnu » tant que rien n'est reçu.
export type StatutObjet = 'en_ligne' | 'hors_ligne' | 'inconnu';

// Ce que l'écran attend d'une source de données, factice ou MQTT.
export type Piece = {
  source: 'mqtt' | 'demo';
  broker: StatutBroker;
  objet: StatutObjet;
  mesures: Mesures | null; // null tant qu'aucune mesure n'est reçue
  recuA: Date | null; // heure de réception de la dernière mesure
  etat: Etat | null; // null tant que l'objet n'a pas publié son état
  commanderFenetre: (commande: CommandeFenetre) => void;
  commanderVmc: (commande: CommandeVmc) => void;
  changerMode: (mode: Mode) => void;
};

// Saisis au premier lancement, rangés dans le stockage sécurisé du téléphone.
export type Identifiants = {
  utilisateur: string;
  motDePasse: string;
};
