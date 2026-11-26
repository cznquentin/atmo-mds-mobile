# Firmware : simulation Wokwi

Responsable : Keyrhan.

ESP32 avec un capteur DHT22, un servomoteur pour la fenêtre et un relais avec une LED pour la VMC. Les topics et les formats de message sont définis dans le [contrat MQTT](../docs/contrat-mqtt.md).

## Fonctionnement

- Lecture du DHT22 toutes les 2 s, lissage par moyenne glissante sur 5 échantillons, publication périodique sur `piece/mesures`.
- **Mode auto** (par défaut) : humidité > 70 % → VMC allumée (coupée sous 60 %), température > 28 °C → fenêtre ouverte (fermée sous 26 °C). Les seuils sont des constantes en haut de `sketch.ino`.
- **Mode manuel** : les commandes de l'app sont appliquées. En mode auto, elles sont ignorées.
- L'état est publié en retain sur `piece/etat`, et un Last Will publie `hors_ligne` sur `piece/objet/statut` si l'objet disparaît.

## Câblage

| Composant | Broche ESP32 |
| --- | --- |
| DHT22 (données) | GPIO 15 |
| Servomoteur (fenêtre) | GPIO 18 |
| Relais (bobine), qui commande la LED de la VMC | GPIO 26 |

## Fichiers attendus

| Fichier | Rôle |
| --- | --- |
| `sketch.ino` | Code de l'ESP32 |
| `diagram.json` | Montage Wokwi |
| `libraries.txt` | Bibliothèques utilisées |
| `secrets.example.h` | Modèle des identifiants, sans vraies valeurs |

Bibliothèques : `PubSubClient`, `ArduinoJson` (version 7), `DHT sensor library`, `Adafruit Unified Sensor`, `ESP32Servo`.

## Lancer la simulation

À compléter : lien du projet Wokwi.

1. Créer un projet **ESP32 DevKit V1** (Arduino C++) sur Wokwi.
2. Coller `sketch.ino` et `diagram.json`, ajouter `libraries.txt`.
3. Créer `secrets.h` à partir du modèle (voir plus bas).
4. Lancer la simulation. Le moniteur série doit afficher `MQTT... ok`.

Le WiFi simulé de Wokwi s'appelle `Wokwi-GUEST`. Sur un autre simulateur (Velxio, par exemple), le câblage et le réseau WiFi peuvent différer.

## Broker

| Cas | Hôte | Port |
| --- | --- | --- |
| Tests avec un broker public | `broker.hivemq.com` | 1883, sans TLS, préfixe de topics unique obligatoire |
| Broker HiveMQ en local dans Docker | IP du conteneur | 1883 |
| Cluster HiveMQ Cloud (version finale) | adresse fournie par Raphaël | 8883, TLS |

`localhost` ne fonctionne pas dans un simulateur : il désigne le simulateur lui-même et pas ton ordinateur.

## Secrets

Copier `secrets.example.h` en `secrets.h` et le remplir. `secrets.h` est ignoré par Git.

Un projet Wokwi partagé par lien montre ses fichiers : vérifier comment fournir le mot de passe sans l'y exposer avant d'utiliser le vrai compte.

## Tester

1. Se connecter au broker avec un client MQTT (client web de HiveMQ, MQTTX) et s'abonner à `piece/#`, avec le préfixe si le broker est public.
2. Vérifier la réception de `piece/mesures`, `piece/etat` et `piece/objet/statut`.
3. Changer la température ou l'humidité du DHT22 dans le simulateur et vérifier que le servo et la LED réagissent en mode auto.
4. Publier `{"mode":"manuel"}` sur `piece/mode`, puis une commande sur `piece/fenetre/commande` ou `piece/vmc/commande`.

## Limites connues

- La bobine du relais est commandée directement par une broche de l'ESP32 et réglée en 3,3 V dans le simulateur. Sur un montage réel, il faudrait un transistor.
- La connexion est sans TLS pour les tests. La version finale doit passer en TLS (port 8883) avec vérification du certificat du broker.
- Un seul DHT22 : toutes les fenêtres et VMC suivent la même mesure.