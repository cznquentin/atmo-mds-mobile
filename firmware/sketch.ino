/*
 * Projet Confort d'une pièce — objet Wokwi (ESP32)
 * Capteur DHT22 + servo (fenêtre) + relais/LED (VMC), le tout piloté en MQTT (HiveMQ Cloud, TLS).
 *
 * Contrat MQTT (à valider avec Quentin et Raphaël) :
 *   publie  piece/mesures         {"temperature":24.5,"humidite":61.2}   toutes les 10 s
 *   publie  piece/etat            {"fenetre":"ouverte","vmc":"allumee","mode":"auto"}  (retain)
 *   publie  piece/objet/statut    "en_ligne" / "hors_ligne" (Last Will, retain)
 *   écoute  piece/fenetre/commande {"action":"ouverte"|"fermee"}
 *   écoute  piece/vmc/commande     {"action":"allumee"|"coupee"}
 *   écoute  piece/mode             {"mode":"auto"|"manuel"}  (retain)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include "secrets.h"  // MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASS (jamais committé)

// ---------- Broches ----------
#define PIN_DHT    15
#define PIN_SERVO  18
#define PIN_RELAIS 26

// Mettre false si le relais Wokwi est actif à l'état bas
#define RELAIS_ACTIF_HAUT true

// ---------- Seuils du mode auto (hystérésis pour éviter les oscillations) ----------
const float TEMP_OUVRIR_FENETRE  = 28.0;  // °C : au-dessus, on ouvre
const float TEMP_FERMER_FENETRE  = 26.0;  // °C : en dessous, on ferme
const float HUM_ALLUMER_VMC      = 70.0;  // % : au-dessus, VMC on
const float HUM_COUPER_VMC       = 60.0;  // % : en dessous, VMC off

// ---------- Cadence ----------
const unsigned long PERIODE_LECTURE_MS = 100;   // le DHT22 ne lit pas plus vite que ~0,5 Hz
const unsigned long PERIODE_PUBLI_MS   = 100;  // publication des mesures
const int NB_ECHANTILLONS = 5;                   // moyenne glissante (lissage)

// ---------- Topics ----------
const char* T_MESURES = "piece/mesures";
const char* T_ETAT    = "piece/etat";
const char* T_STATUT  = "piece/objet/statut";
const char* T_FENETRE = "piece/fenetre/commande";
const char* T_VMC     = "piece/vmc/commande";
const char* T_MODE    = "piece/mode";

// ---------- Objets ----------
DHT dht(PIN_DHT, DHT22);
Servo servoFenetre;
WiFiClient reseau;
PubSubClient mqtt(reseau);

// ---------- État ----------
bool fenetreOuverte = false;
bool vmcActive      = false;
bool modeAuto       = true;

float bufT[NB_ECHANTILLONS], bufH[NB_ECHANTILLONS];
int   nbEch = 0, idxEch = 0;
float tLissee = NAN, hLissee = NAN;

unsigned long dernLecture = 0, dernPubli = 0, dernTentativeMqtt = 0;

// ---------- Actionneurs ----------
void appliquerFenetre(bool ouverte) {
  fenetreOuverte = ouverte;
  servoFenetre.write(ouverte ? 90 : 0);
}

void appliquerVmc(bool on) {
  vmcActive = on;
  digitalWrite(PIN_RELAIS, (on == RELAIS_ACTIF_HAUT) ? HIGH : LOW);
}

void publierEtat() {
  JsonDocument doc;
  doc["fenetre"] = fenetreOuverte ? "ouverte" : "fermee";
  doc["vmc"]     = vmcActive ? "allumee" : "coupee";
  doc["mode"]    = modeAuto ? "auto" : "manuel";
  char buf[96];
  serializeJson(doc, buf);
  mqtt.publish(T_ETAT, buf, true);  // retain : l'app récupère l'état dès qu'elle se connecte
}

// ---------- Réception des commandes ----------
void surMessage(char* topic, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];

  if (strcmp(topic, T_MODE) == 0) {
    if (msg == "auto")        modeAuto = true;
    else if (msg == "manuel") modeAuto = false;
    else return;
    Serial.printf("Mode -> %s\n", msg.c_str());
    publierEtat();
    return;
  }

  // Les commandes manuelles ne sont prises en compte qu'en mode manuel
  if (modeAuto) {
    Serial.println("Commande ignorée (mode auto)");
    publierEtat();
    return;
  }

  if (strcmp(topic, T_FENETRE) == 0) {
    if (msg == "ouvrir")      appliquerFenetre(true);
    else if (msg == "fermer") appliquerFenetre(false);
    else return;
  } else if (strcmp(topic, T_VMC) == 0) {
    if (msg == "allumer")     appliquerVmc(true);
    else if (msg == "couper") appliquerVmc(false);
    else return;
  }
  publierEtat();
}

// à changer pour connexion wifi via externe ou juste simulation
// ---------- Connexions ----------
void connecterWifi() {
  Serial.print("WiFi");
  WiFi.begin("Wokwi-GUEST", "", 6);  // réseau simulé de Wokwi
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.println(" connecté");
  configTime(0, 0, "pool.ntp.org");  // horodatage des mesures
}

bool connecterMqtt() {
  String clientId = "esp32-piece-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("MQTT...");
  // Last Will : si l'objet disparaît, le broker publie "hors_ligne"
  //if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS, T_STATUT, 1, true, "hors_ligne")) {
    if(mqtt.connect(clientId.c_str(), T_STATUT, 1, true, "hors_ligne")){
    Serial.println(" ok");
    mqtt.publish(T_STATUT, "en_ligne", true);
    mqtt.subscribe(T_FENETRE, 1);
    mqtt.subscribe(T_VMC, 1);
    mqtt.subscribe(T_MODE, 1);  // le message retain restaure le dernier mode choisi
    publierEtat();
    return true;
  }
  Serial.printf(" échec (rc=%d)\n", mqtt.state());
  return false;
}

// ---------- Capteur ----------
void lireCapteur() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("Lecture DHT22 invalide, ignorée");
    return;
  }
  bufT[idxEch] = t;
  bufH[idxEch] = h;
  idxEch = (idxEch + 1) % NB_ECHANTILLONS;
  if (nbEch < NB_ECHANTILLONS) nbEch++;

  float sT = 0, sH = 0;
  for (int i = 0; i < nbEch; i++) { sT += bufT[i]; sH += bufH[i]; }
  tLissee = sT / nbEch;
  hLissee = sH / nbEch;
}

// ---------- Mode auto ----------
void regulerAuto() {
  if (!modeAuto || isnan(tLissee)) return;
  bool change = false;

  if (!fenetreOuverte && tLissee > TEMP_OUVRIR_FENETRE) { appliquerFenetre(true);  change = true; }
  if (fenetreOuverte  && tLissee < TEMP_FERMER_FENETRE) { appliquerFenetre(false); change = true; }

  if (!vmcActive && hLissee > HUM_ALLUMER_VMC) { appliquerVmc(true);  change = true; }
  if (vmcActive  && hLissee < HUM_COUPER_VMC)  { appliquerVmc(false); change = true; }

  if (change && mqtt.connected()) publierEtat();
}

void publierMesures() {
  if (isnan(tLissee) || !mqtt.connected()) return;
  JsonDocument doc;
  doc["temperature"]  = round(tLissee * 10) / 10.0;
  doc["humidite"]  = round(hLissee * 10) / 10.0;
  char buf[96];
  serializeJson(doc, buf);
  mqtt.publish(T_MESURES, buf);
  Serial.println(buf);
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAIS, OUTPUT);
  dht.begin();
  servoFenetre.attach(PIN_SERVO);
  appliquerFenetre(false);
  appliquerVmc(false);

  connecterWifi();

  // TODO chapitre 6 (sécurité) : remplacer setInsecure() par reseau.setCACert(<ISRG Root X1>)
  // pour vérifier le certificat du broker et éviter une attaque de type "homme du milieu".
  // reseau.setInsecure();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(surMessage);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connecterWifi();

  if (!mqtt.connected()) {
    if (millis() - dernTentativeMqtt > 5000) {
      dernTentativeMqtt = millis();
      connecterMqtt();
    }
  } else {
    mqtt.loop();
  }

  unsigned long now = millis();
  if (now - dernLecture >= PERIODE_LECTURE_MS) {
    dernLecture = now;
    lireCapteur();
    regulerAuto();  // le mode auto continue de tourner même si le broker est coupé
  }
  if (now - dernPubli >= PERIODE_PUBLI_MS) {
    dernPubli = now;
    publierMesures();
  }
}