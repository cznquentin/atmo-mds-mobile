// Doivent rester identiques aux seuils de l'objet : voir docs/contrat-mqtt.md
export const SEUIL_TEMPERATURE = 28; // °C
export const SEUIL_HUMIDITE = 70; // %
export const SEUIL_FROID = 19; // °C : en dessous, le mode auto chauffe

// Adresse du broker, lue dans mobile/.env (modèle : .env.example).
// Elle n'est pas secrète. L'app se connecte pour l'instant sans identifiants (broker local de test).
export const MQTT_URL = process.env.EXPO_PUBLIC_MQTT_URL ?? '';

// Adresse du back-end d'historique, ex. http://192.168.1.20:3000 (mobile/.env). Vide : mode démo.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

// L'objet publie toutes les 10 s : au-delà de 3 cycles manqués, la mesure est jugée ancienne.
export const MESURE_ANCIENNE_MS = 30_000;
