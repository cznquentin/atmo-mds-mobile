// Doivent rester identiques aux seuils de l'objet : voir docs/contrat-mqtt.md
export const SEUIL_TEMPERATURE = 28; // °C
export const SEUIL_HUMIDITE = 70; // %

// Adresse du broker, lue dans mobile/.env (modèle : .env.example).
// Elle n'est pas secrète : le mot de passe, lui, est saisi dans l'app.
export const MQTT_URL = process.env.EXPO_PUBLIC_MQTT_URL ?? '';

// L'objet publie toutes les 10 s : au-delà de 3 cycles manqués, la mesure est jugée ancienne.
export const MESURE_ANCIENNE_MS = 30_000;
